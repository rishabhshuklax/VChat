/**
 * One conformance suite, run against every room-store backend.
 *
 * Writing it once and parameterizing means the Redis adapter cannot silently
 * diverge from the in-memory one — which matters, because the Redis path only
 * activates on multi-instance deployments where a subtle difference would be
 * very hard to notice.
 *
 * The Redis cases are skipped unless REDIS_TEST_URL points at a live server.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { MemoryRoomStore } from '../server/store/memory.ts';
import { RedisRoomStore } from '../server/store/redis.ts';
import type { RoomStore } from '../server/store/types.ts';
import { ERROR_CODES, type MediaState } from '../shared/protocol.ts';

const REDIS_URL = process.env.REDIS_TEST_URL;
const RUN_ID = Math.random().toString(36).slice(2, 10);

const state: MediaState = { audio: true, video: true, screen: false };
let counter = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

function joinRequest(roomId: string, overrides: Partial<Parameters<RoomStore['join']>[0]> = {}) {
  return {
    roomId,
    peerId: uuid(),
    name: 'Peer',
    state,
    password: '',
    maxPeers: 8,
    ...overrides,
  };
}

const backends: Array<{ name: string; create: () => RoomStore; skip: boolean }> = [
  { name: 'MemoryRoomStore', create: () => new MemoryRoomStore(), skip: false },
  {
    name: 'RedisRoomStore',
    // A per-instance key prefix isolates each test from the others, mirroring
    // how two apps can safely share one Redis in production. RUN_ID keeps runs
    // isolated too — room keys carry a TTL, so a fixed prefix would let one
    // run's leftovers fail the next one.
    create: () =>
      new RedisRoomStore(REDIS_URL as string, { keyPrefix: `vchat-test-${RUN_ID}-${++counter}` }),
    skip: !REDIS_URL,
  },
];

for (const backend of backends) {
  describe.skipIf(backend.skip)(backend.name, () => {
    let store: RoomStore;
    let room: string;
    const created: RoomStore[] = [];

    beforeEach(() => {
      store = backend.create();
      created.push(store);
      room = `room${++counter}`;
    });

    afterAll(async () => {
      await Promise.allSettled(created.map((instance) => instance.close()));
    });

    it('creates the room on first join and reports the creation', async () => {
      const result = await store.join(joinRequest(room));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.createdRoom).toBe(true);
      expect(result.others).toHaveLength(0);
    });

    it('shows earlier peers to a later joiner', async () => {
      const first = await store.join(joinRequest(room, { name: 'Ana' }));
      const second = await store.join(joinRequest(room, { name: 'Ben' }));
      expect(second.ok).toBe(true);
      if (!second.ok || !first.ok) return;
      expect(second.createdRoom).toBe(false);
      expect(second.others.map((peer) => peer.name)).toEqual(['Ana']);
      expect(await store.peers(room)).toHaveLength(2);
    });

    it('locks the room to the password set by its first joiner', async () => {
      await store.join(joinRequest(room, { password: 's3cret' }));

      const noPassword = await store.join(joinRequest(room));
      expect(noPassword.ok).toBe(false);
      if (!noPassword.ok) expect(noPassword.code).toBe(ERROR_CODES.PASSWORD_REQUIRED);

      const wrong = await store.join(joinRequest(room, { password: 'nope' }));
      expect(wrong.ok).toBe(false);
      if (!wrong.ok) expect(wrong.code).toBe(ERROR_CODES.BAD_PASSWORD);

      const right = await store.join(joinRequest(room, { password: 's3cret' }));
      expect(right.ok).toBe(true);
    });

    it('lets anyone in when the room was created without a password', async () => {
      await store.join(joinRequest(room));
      const result = await store.join(joinRequest(room, { password: 'ignored' }));
      expect(result.ok).toBe(true);
    });

    it('enforces the capacity limit', async () => {
      for (let i = 0; i < 3; i += 1) {
        expect((await store.join(joinRequest(room, { maxPeers: 3 }))).ok).toBe(true);
      }
      const overflow = await store.join(joinRequest(room, { maxPeers: 3 }));
      expect(overflow.ok).toBe(false);
      if (!overflow.ok) expect(overflow.code).toBe(ERROR_CODES.ROOM_FULL);
    });

    it('disambiguates duplicate display names instead of rejecting them', async () => {
      await store.join(joinRequest(room, { name: 'Alex' }));
      const second = await store.join(joinRequest(room, { name: 'Alex' }));
      expect(second.ok).toBe(true);
      if (!second.ok) return;
      expect(second.peer.name).toBe('Alex (2)');
    });

    it('deletes the room once the last peer leaves, freeing the code', async () => {
      const first = await store.join(joinRequest(room, { password: 'one' }));
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      await store.leave(room, first.peer.id);
      expect(await store.peers(room)).toHaveLength(0);

      // The code is reusable, and the new occupant sets a fresh password.
      const reused = await store.join(joinRequest(room, { password: 'two' }));
      expect(reused.ok).toBe(true);
      if (!reused.ok) return;
      expect(reused.createdRoom).toBe(true);
    });

    it('updates and broadcasts peer media state', async () => {
      const joined = await store.join(joinRequest(room));
      expect(joined.ok).toBe(true);
      if (!joined.ok) return;

      const updated = await store.setPeerState(room, joined.peer.id, {
        audio: false,
        video: false,
        screen: true,
      });
      expect(updated?.state).toEqual({ audio: false, video: false, screen: true });

      expect(await store.setPeerState(room, uuid(), state)).toBeNull();
    });

    it('delivers published envelopes to subscribers', async () => {
      const received: string[] = [];
      const unsubscribe = await store.subscribe(room, (envelope) => {
        if (envelope.message.type === 'chat') received.push(envelope.message.message.text);
      });

      await store.publish(room, {
        to: 'room',
        message: {
          type: 'chat',
          message: { id: 'm1', from: uuid(), name: 'Ana', text: 'hello', ts: 1 },
        },
      });

      await waitFor(() => received.length === 1);
      expect(received).toEqual(['hello']);

      await unsubscribe();
      await store.publish(room, {
        to: 'room',
        message: {
          type: 'chat',
          message: { id: 'm2', from: uuid(), name: 'Ana', text: 'after', ts: 2 },
        },
      });
      await sleep(50);
      expect(received).toEqual(['hello']);
    });

    it('evicts peers whose heartbeat has gone stale', async () => {
      const joined = await store.join(joinRequest(room));
      expect(joined.ok).toBe(true);
      if (!joined.ok) return;

      expect(await store.sweep(60_000)).toHaveLength(0);

      await sleep(20);
      const evicted = await store.sweep(10);
      expect(evicted).toEqual([{ roomId: room, peerId: joined.peer.id }]);
      expect(await store.peers(room)).toHaveLength(0);
    });

    it('keeps a peer alive across sweeps while it heartbeats', async () => {
      const joined = await store.join(joinRequest(room));
      if (!joined.ok) return;
      await sleep(20);
      await store.heartbeat(room, joined.peer.id);
      expect(await store.sweep(50)).toHaveLength(0);
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(10);
  }
  throw new Error('waitFor timed out');
}
