/**
 * Room store selection.
 *
 * Memory is the default and needs no configuration. Setting `REDIS_URL` swaps
 * in the Redis adapter, which is what makes rooms work when Vercel spreads a
 * room's WebSocket connections across more than one Function instance.
 */
import { log } from '../logger.ts';
import { MemoryRoomStore } from './memory.ts';
import { RedisRoomStore } from './redis.ts';
import type { RoomStore } from './types.ts';

export type { Envelope, JoinRequest, JoinResult, RoomStore, Unsubscribe } from './types.ts';
export { MemoryRoomStore } from './memory.ts';
export { RedisRoomStore } from './redis.ts';

export function createRoomStore(env: NodeJS.ProcessEnv = process.env): RoomStore {
  const url = env.REDIS_URL ?? env.KV_URL ?? '';
  if (!url) {
    log.info('room store: memory', {
      note: 'Set REDIS_URL to share rooms across Function instances.',
    });
    return new MemoryRoomStore();
  }

  try {
    const store = new RedisRoomStore(url);
    log.info('room store: redis');
    return store;
  } catch (error) {
    // A misconfigured Redis URL must degrade to a working single-instance
    // server rather than take the whole deployment down.
    log.error('redis store unavailable, falling back to memory', { error: String(error) });
    return new MemoryRoomStore();
  }
}
