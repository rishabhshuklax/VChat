/**
 * In-process room store. This is the default backend: it needs no external
 * service, and it is exactly correct whenever every WebSocket for a room is
 * served by one Function instance (the common case at small scale, and always
 * true in local development).
 *
 * Set `REDIS_URL` to swap in the Redis adapter when you need rooms to span
 * instances. See `./redis.ts`.
 */
import { hashPassword, verifyPassword } from '../security.js';
import { ERROR_CODES, type MediaState, type Peer } from '../../shared/protocol.js';
import type { Envelope, JoinRequest, JoinResult, RoomStore, Unsubscribe } from './types.js';

interface MemoryPeer extends Peer {
  lastSeen: number;
}

interface MemoryRoom {
  id: string;
  /** null means the room was created without a password. */
  passwordHash: string | null;
  createdAt: number;
  peers: Map<string, MemoryPeer>;
  listeners: Set<(envelope: Envelope) => void>;
}

export class MemoryRoomStore implements RoomStore {
  readonly kind = 'memory' as const;
  readonly #rooms = new Map<string, MemoryRoom>();

  #room(roomId: string): MemoryRoom | undefined {
    return this.#rooms.get(roomId);
  }

  /**
   * Rooms are kept alive by their listener set even when empty, because a
   * subscriber may attach a tick before the first peer is recorded. Only drop
   * the room once nobody is listening and nobody is present.
   */
  #maybeDelete(room: MemoryRoom): void {
    if (room.peers.size === 0 && room.listeners.size === 0) {
      this.#rooms.delete(room.id);
    }
  }

  async join(request: JoinRequest): Promise<JoinResult> {
    const { roomId, peerId, name, state, password, maxPeers } = request;
    let room = this.#room(roomId);
    let createdRoom = false;

    if (!room) {
      room = {
        id: roomId,
        passwordHash: password ? await hashPassword(password) : null,
        createdAt: Date.now(),
        peers: new Map(),
        listeners: new Set(),
      };
      this.#rooms.set(roomId, room);
      createdRoom = true;
    } else {
      if (room.passwordHash === null && password) {
        // The room is open; an offered password is simply ignored rather than
        // treated as an error, so a stale invite link still works.
      } else if (room.passwordHash !== null) {
        if (!password) {
          return {
            ok: false,
            code: ERROR_CODES.PASSWORD_REQUIRED,
            message: 'This room is protected by a password.',
          };
        }
        if (!(await verifyPassword(password, room.passwordHash))) {
          return {
            ok: false,
            code: ERROR_CODES.BAD_PASSWORD,
            message: 'That password is not correct.',
          };
        }
      }

      if (room.peers.size >= maxPeers && !room.peers.has(peerId)) {
        return {
          ok: false,
          code: ERROR_CODES.ROOM_FULL,
          message: `This room is full (${maxPeers} participants maximum).`,
        };
      }
    }

    const now = Date.now();
    const peer: MemoryPeer = {
      id: peerId,
      name: this.#uniqueName(room, name, peerId),
      state,
      joinedAt: room.peers.get(peerId)?.joinedAt ?? now,
      lastSeen: now,
    };
    room.peers.set(peerId, peer);

    const others = [...room.peers.values()]
      .filter((candidate) => candidate.id !== peerId)
      .sort((a, b) => a.joinedAt - b.joinedAt)
      .map(stripInternal);

    return { ok: true, peer: stripInternal(peer), others, createdRoom };
  }

  /**
   * Two people called "Alex" in one call is a usability problem, not an error.
   * Later joiners get a numeric suffix instead of a rejection.
   */
  #uniqueName(room: MemoryRoom, requested: string, peerId: string): string {
    const taken = new Set(
      [...room.peers.values()].filter((p) => p.id !== peerId).map((p) => p.name.toLowerCase()),
    );
    if (!taken.has(requested.toLowerCase())) return requested;
    for (let suffix = 2; suffix < 100; suffix += 1) {
      const candidate = `${requested} (${suffix})`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
    return requested;
  }

  async leave(roomId: string, peerId: string): Promise<void> {
    const room = this.#room(roomId);
    if (!room) return;
    room.peers.delete(peerId);
    this.#maybeDelete(room);
  }

  async peers(roomId: string): Promise<Peer[]> {
    const room = this.#room(roomId);
    if (!room) return [];
    return [...room.peers.values()].sort((a, b) => a.joinedAt - b.joinedAt).map(stripInternal);
  }

  async setPeerState(roomId: string, peerId: string, state: MediaState): Promise<Peer | null> {
    const peer = this.#room(roomId)?.peers.get(peerId);
    if (!peer) return null;
    peer.state = state;
    peer.lastSeen = Date.now();
    return stripInternal(peer);
  }

  async heartbeat(roomId: string, peerId: string): Promise<void> {
    const peer = this.#room(roomId)?.peers.get(peerId);
    if (peer) peer.lastSeen = Date.now();
  }

  async publish(roomId: string, envelope: Envelope): Promise<void> {
    const room = this.#room(roomId);
    if (!room) return;
    // Copy first: a handler may unsubscribe during delivery.
    for (const handler of [...room.listeners]) handler(envelope);
  }

  async subscribe(roomId: string, handler: (envelope: Envelope) => void): Promise<Unsubscribe> {
    let room = this.#room(roomId);
    if (!room) {
      room = {
        id: roomId,
        passwordHash: null,
        createdAt: Date.now(),
        peers: new Map(),
        listeners: new Set(),
      };
      this.#rooms.set(roomId, room);
    }
    room.listeners.add(handler);
    return () => {
      const current = this.#room(roomId);
      if (!current) return;
      current.listeners.delete(handler);
      this.#maybeDelete(current);
    };
  }

  async sweep(maxAgeMs: number): Promise<Array<{ roomId: string; peerId: string }>> {
    const cutoff = Date.now() - maxAgeMs;
    const evicted: Array<{ roomId: string; peerId: string }> = [];
    for (const room of [...this.#rooms.values()]) {
      for (const peer of [...room.peers.values()]) {
        if (peer.lastSeen < cutoff) {
          room.peers.delete(peer.id);
          evicted.push({ roomId: room.id, peerId: peer.id });
        }
      }
      this.#maybeDelete(room);
    }
    return evicted;
  }

  async close(): Promise<void> {
    this.#rooms.clear();
  }

  /** Test and diagnostics helper. */
  get roomCount(): number {
    return this.#rooms.size;
  }
}

function stripInternal(peer: MemoryPeer): Peer {
  return { id: peer.id, name: peer.name, state: peer.state, joinedAt: peer.joinedAt };
}
