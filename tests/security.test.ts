import { describe, expect, it } from 'vitest';

import { RateLimiter, generateRoomCode, hashPassword, verifyPassword } from '../server/security.ts';
import { ROOM_CODE_ALPHABET } from '../shared/protocol.ts';

describe('password hashing', () => {
  it('never stores the plaintext', async () => {
    const hash = await hashPassword('hunter2');
    expect(hash).not.toContain('hunter2');
    expect(hash.startsWith('scrypt$')).toBe(true);
  });

  it('salts, so the same password hashes differently every time', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('verifies the correct password and rejects the wrong one', async () => {
    const hash = await hashPassword('correct horse');
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('wrong horse', hash)).toBe(false);
  });

  it('returns false for malformed stored hashes rather than throwing', async () => {
    expect(await verifyPassword('x', 'garbage')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$zz$zz')).toBe(false);
    expect(await verifyPassword('x', '')).toBe(false);
  });
});

describe('generateRoomCode', () => {
  it('only uses the unambiguous alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      for (const char of generateRoomCode()) {
        expect(ROOM_CODE_ALPHABET).toContain(char);
      }
    }
  });

  it('produces the requested length and does not collide in practice', () => {
    const codes = new Set(Array.from({ length: 2000 }, () => generateRoomCode(8)));
    expect(codes.size).toBe(2000);
    for (const code of codes) expect(code).toHaveLength(8);
  });
});

describe('RateLimiter', () => {
  it('allows up to capacity then refuses', () => {
    const limiter = new RateLimiter(3, 1);
    const now = 1_000_000;
    expect(limiter.take('ip', now)).toBe(true);
    expect(limiter.take('ip', now)).toBe(true);
    expect(limiter.take('ip', now)).toBe(true);
    expect(limiter.take('ip', now)).toBe(false);
  });

  it('refills over time', () => {
    const limiter = new RateLimiter(2, 1); // one token per second
    const start = 1_000_000;
    limiter.take('ip', start);
    limiter.take('ip', start);
    expect(limiter.take('ip', start)).toBe(false);
    expect(limiter.take('ip', start + 1_100)).toBe(true);
  });

  it('tracks callers independently', () => {
    const limiter = new RateLimiter(1, 1);
    const now = 1_000_000;
    expect(limiter.take('a', now)).toBe(true);
    expect(limiter.take('a', now)).toBe(false);
    expect(limiter.take('b', now)).toBe(true);
  });

  it('sweeps idle buckets so the map cannot grow without bound', () => {
    const limiter = new RateLimiter(2, 1);
    const now = 1_000_000;
    limiter.take('a', now);
    expect(limiter.size).toBe(1);
    limiter.sweep(now + 60_000);
    expect(limiter.size).toBe(0);
  });
});
