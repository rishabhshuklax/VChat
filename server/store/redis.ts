/**
 * Redis-backed room store for multi-instance deployments.
 *
 * Vercel explicitly does not guarantee that two WebSocket connections for the
 * same room reach the same Function instance. When that happens, a module-level
 * Map is invisible to the other instance and the two callers never discover
 * each other. This adapter moves the roster into Redis and the fanout onto
 * Redis pub/sub, so a room behaves identically no matter how many instances are
 * serving it.
 *
 * Enabled automatically when `REDIS_URL` is set.
 *
 * Key layout:
 *   vchat:room:{id}:meta   hash    createdAt, passwordHash
 *   vchat:room:{id}:peers  hash    peerId -> JSON(peer + lastSeen)
 *   vchat:rooms            set     every live room id, for sweeping
 *   vchat:room:{id}        channel envelopes
 */
import Redis from 'ioredis';

import { hashPassword, verifyPassword } from '../security.js';
import { log } from '../logger.js';
import { ERROR_CODES, type MediaState, type Peer } from '../../shared/protocol.js';
import type { Envelope, JoinRequest, JoinResult, RoomStore, Unsubscribe } from './types.js';

/** Rooms self-destruct after this long without activity, as a backstop against leaks. */
const ROOM_TTL_SECONDS = 12 * 60 * 60;

const DEFAULT_PREFIX = 'vchat';

interface StoredPeer extends Peer {
  lastSeen: number;
}

/**
 * Claims a room for this joiner if it does not exist yet.
 * Returns 1 when this call created the room, 0 when it already existed.
 */
const CREATE_ROOM = `
local created = redis.call('HSETNX', KEYS[1], 'createdAt', ARGV[1])
if created == 1 then
  redis.call('HSET', KEYS[1], 'passwordHash', ARGV[2])
  redis.call('EXPIRE', KEYS[1], ARGV[3])
  redis.call('SADD', KEYS[2], ARGV[4])
end
return created
`;

/**
 * Adds a peer if there is room for them.
 * Returns 1 on success, 0 if the room vanished, 2 if it is full.
 */
const ADD_PEER = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
local existing = redis.call('HEXISTS', KEYS[2], ARGV[1])
if existing == 0 and redis.call('HLEN', KEYS[2]) >= tonumber(ARGV[3]) then return 2 end
redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
redis.call('EXPIRE', KEYS[1], ARGV[4])
redis.call('EXPIRE', KEYS[2], ARGV[4])
return 1
`;

/**
 * Removes a peer and tears the room down once it is empty, so a room code is
 * never permanently claimed by an abandoned room.
 */
const REMOVE_PEER = `
redis.call('HDEL', KEYS[2], ARGV[1])
if redis.call('HLEN', KEYS[2]) == 0 then
  redis.call('DEL', KEYS[1])
  redis.call('DEL', KEYS[2])
  redis.call('SREM', KEYS[3], ARGV[2])
  return 1
end
return 0
`;

export class RedisRoomStore implements RoomStore {
  readonly kind = 'redis' as const;

  /** Command connection. */
  readonly #redis: Redis;
  /** Subscriber connection: a Redis client in subscribe mode cannot issue commands. */
  readonly #sub: Redis;
  readonly #handlers = new Map<string, Set<(envelope: Envelope) => void>>();
  readonly #prefix: string;

  constructor(url: string, options_: { keyPrefix?: string } = {}) {
    this.#prefix = options_.keyPrefix ?? process.env.REDIS_KEY_PREFIX ?? DEFAULT_PREFIX;

    const options = {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    } as const;

    this.#redis = new Redis(url, options);
    this.#sub = new Redis(url, options);

    this.#redis.on('error', (error) => log.error('redis error', { error: error.message }));
    this.#sub.on('error', (error) => log.error('redis subscriber error', { error: error.message }));

    this.#sub.on('message', (chan: string, payload: string) => {
      const listeners = this.#handlers.get(chan);
      if (!listeners || listeners.size === 0) return;
      let envelope: Envelope;
      try {
        envelope = JSON.parse(payload) as Envelope;
      } catch {
        log.warn('dropped malformed envelope', { channel: chan });
        return;
      }
      for (const handler of [...listeners]) {
        try {
          handler(envelope);
        } catch (error) {
          log.error('envelope handler threw', { error: String(error) });
        }
      }
    });
  }

  get #roomsIndexKey(): string {
    return `${this.#prefix}:rooms`;
  }

  #metaKey(roomId: string): string {
    return `${this.#prefix}:room:${roomId}:meta`;
  }

  #peersKey(roomId: string): string {
    return `${this.#prefix}:room:${roomId}:peers`;
  }

  #channel(roomId: string): string {
    return `${this.#prefix}:room:${roomId}`;
  }

  async join(request: JoinRequest): Promise<JoinResult> {
    const { roomId, peerId, name, state, password, maxPeers } = request;

    // Establish the room and settle on its password, retrying if another
    // instance wins the creation race between our read and our write.
    let createdRoom = false;
    let passwordHash: string | null = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const existingHash = await this.#redis.hget(this.#metaKey(roomId), 'passwordHash');

      if (existingHash === null) {
        const hash = password ? await hashPassword(password) : '';
        const result = (await this.#redis.eval(
          CREATE_ROOM,
          2,
          this.#metaKey(roomId),
          this.#roomsIndexKey,
          String(Date.now()),
          hash,
          String(ROOM_TTL_SECONDS),
          roomId,
        )) as number;

        if (result === 1) {
          createdRoom = true;
          passwordHash = hash || null;
          break;
        }
        continue; // Lost the race; re-read and verify against the winner's password.
      }

      passwordHash = existingHash === '' ? null : existingHash;
      break;
    }

    if (!createdRoom && passwordHash !== null) {
      if (!password) {
        return {
          ok: false,
          code: ERROR_CODES.PASSWORD_REQUIRED,
          message: 'This room is protected by a password.',
        };
      }
      if (!(await verifyPassword(password, passwordHash))) {
        return {
          ok: false,
          code: ERROR_CODES.BAD_PASSWORD,
          message: 'That password is not correct.',
        };
      }
    }

    const roster = await this.#readPeers(roomId);
    const rejoined = roster.some((candidate) => candidate.id === peerId);
    const now = Date.now();
    const peer: StoredPeer = {
      id: peerId,
      name: uniqueName(roster, name, peerId),
      state,
      joinedAt: roster.find((p) => p.id === peerId)?.joinedAt ?? now,
      lastSeen: now,
    };

    const added = (await this.#redis.eval(
      ADD_PEER,
      2,
      this.#metaKey(roomId),
      this.#peersKey(roomId),
      peerId,
      JSON.stringify(peer),
      String(maxPeers),
      String(ROOM_TTL_SECONDS),
    )) as number;

    if (added === 0) {
      return {
        ok: false,
        code: ERROR_CODES.ROOM_NOT_FOUND,
        message: 'That room no longer exists.',
      };
    }
    if (added === 2) {
      return {
        ok: false,
        code: ERROR_CODES.ROOM_FULL,
        message: `This room is full (${maxPeers} participants maximum).`,
      };
    }

    const others = roster.filter((candidate) => candidate.id !== peerId).map(strip);
    return { ok: true, peer: strip(peer), others, createdRoom, rejoined };
  }

  async leave(roomId: string, peerId: string): Promise<void> {
    await this.#redis.eval(
      REMOVE_PEER,
      3,
      this.#metaKey(roomId),
      this.#peersKey(roomId),
      this.#roomsIndexKey,
      peerId,
      roomId,
    );
  }

  async peers(roomId: string): Promise<Peer[]> {
    return (await this.#readPeers(roomId)).map(strip);
  }

  async #readPeers(roomId: string): Promise<StoredPeer[]> {
    const raw = await this.#redis.hgetall(this.#peersKey(roomId));
    const peers: StoredPeer[] = [];
    for (const value of Object.values(raw)) {
      try {
        peers.push(JSON.parse(value) as StoredPeer);
      } catch {
        // Skip unparseable entries rather than failing the whole join.
      }
    }
    return peers.sort((a, b) => a.joinedAt - b.joinedAt);
  }

  async setPeerState(roomId: string, peerId: string, state: MediaState): Promise<Peer | null> {
    const raw = await this.#redis.hget(this.#peersKey(roomId), peerId);
    if (!raw) return null;
    let peer: StoredPeer;
    try {
      peer = JSON.parse(raw) as StoredPeer;
    } catch {
      return null;
    }
    peer.state = state;
    peer.lastSeen = Date.now();
    await this.#redis.hset(this.#peersKey(roomId), peerId, JSON.stringify(peer));
    return strip(peer);
  }

  async heartbeat(roomId: string, peerId: string): Promise<void> {
    const raw = await this.#redis.hget(this.#peersKey(roomId), peerId);
    if (!raw) return;
    try {
      const peer = JSON.parse(raw) as StoredPeer;
      peer.lastSeen = Date.now();
      await this.#redis
        .multi()
        .hset(this.#peersKey(roomId), peerId, JSON.stringify(peer))
        .expire(this.#metaKey(roomId), ROOM_TTL_SECONDS)
        .expire(this.#peersKey(roomId), ROOM_TTL_SECONDS)
        .exec();
    } catch {
      // Ignore: a corrupt entry will be swept on its own.
    }
  }

  async peerLastSeen(roomId: string, peerId: string): Promise<number | null> {
    const raw = await this.#redis.hget(this.#peersKey(roomId), peerId);
    if (!raw) return null;
    try {
      return (JSON.parse(raw) as StoredPeer).lastSeen ?? null;
    } catch {
      return null;
    }
  }

  async publish(roomId: string, envelope: Envelope): Promise<void> {
    await this.#redis.publish(this.#channel(roomId), JSON.stringify(envelope));
  }

  async subscribe(roomId: string, handler: (envelope: Envelope) => void): Promise<Unsubscribe> {
    const chan = this.#channel(roomId);
    let listeners = this.#handlers.get(chan);
    if (!listeners) {
      listeners = new Set();
      this.#handlers.set(chan, listeners);
      await this.#sub.subscribe(chan);
    }
    listeners.add(handler);

    return async () => {
      const current = this.#handlers.get(chan);
      if (!current) return;
      current.delete(handler);
      if (current.size === 0) {
        this.#handlers.delete(chan);
        await this.#sub.unsubscribe(chan).catch(() => undefined);
      }
    };
  }

  async sweep(maxAgeMs: number): Promise<Array<{ roomId: string; peerId: string }>> {
    const cutoff = Date.now() - maxAgeMs;
    const evicted: Array<{ roomId: string; peerId: string }> = [];
    const roomIds = await this.#redis.smembers(this.#roomsIndexKey);

    for (const roomId of roomIds) {
      const peers = await this.#readPeers(roomId);
      if (peers.length === 0) {
        // Index entry outlived its room; drop it.
        const exists = await this.#redis.exists(this.#metaKey(roomId));
        if (!exists) await this.#redis.srem(this.#roomsIndexKey, roomId);
        continue;
      }
      for (const peer of peers) {
        if (peer.lastSeen < cutoff) {
          await this.leave(roomId, peer.id);
          evicted.push({ roomId, peerId: peer.id });
        }
      }
    }
    return evicted;
  }

  async close(): Promise<void> {
    this.#handlers.clear();
    await Promise.allSettled([this.#redis.quit(), this.#sub.quit()]);
  }
}

function strip(peer: StoredPeer): Peer {
  return { id: peer.id, name: peer.name, state: peer.state, joinedAt: peer.joinedAt };
}

function uniqueName(roster: StoredPeer[], requested: string, peerId: string): string {
  const taken = new Set(
    roster.filter((peer) => peer.id !== peerId).map((peer) => peer.name.toLowerCase()),
  );
  if (!taken.has(requested.toLowerCase())) return requested;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const candidate = `${requested} (${suffix})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return requested;
}
