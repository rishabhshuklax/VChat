/**
 * Password hashing, room-code generation, and request throttling.
 *
 * The previous build compared room passwords with `===` against a plaintext
 * string held in memory, and leaked that string to every peer in the room when
 * the host left. Everything here exists to make both of those impossible.
 */
import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

import { ROOM_CODE_ALPHABET } from '../shared/protocol.js';

const scryptAsync = promisify(scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/**
 * Hashes a room password as `scrypt$<saltHex>$<hashHex>`.
 *
 * scrypt is memory-hard and ships with Node, so there is no dependency to keep
 * patched. Room passwords are low-value and short-lived, which is why the
 * default cost parameters are acceptable here.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const derived = await scryptAsync(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/** Constant-time verification. Returns false for malformed stored hashes rather than throwing. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;

  const saltHex = parts[1];
  const hashHex = parts[2];
  if (!saltHex || !hashHex) return false;

  let salt: Buffer;
  let expected: Buffer;
  try {
    salt = Buffer.from(saltHex, 'hex');
    expected = Buffer.from(hashHex, 'hex');
  } catch {
    return false;
  }
  if (expected.length !== KEY_LENGTH) return false;

  const actual = await scryptAsync(password, salt, KEY_LENGTH);
  return timingSafeEqual(actual, expected);
}

/**
 * Generates a room code from a deliberately unambiguous alphabet using
 * rejection sampling, so every character is uniformly distributed rather than
 * biased by a modulo fold.
 */
export function generateRoomCode(length = 8): string {
  const alphabet = ROOM_CODE_ALPHABET;
  const max = Math.floor(256 / alphabet.length) * alphabet.length;
  let out = '';
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= max) continue;
      out += alphabet[byte % alphabet.length];
      if (out.length === length) break;
    }
  }
  return out;
}

export function newPeerId(): string {
  return randomUUID();
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

interface Bucket {
  tokens: number;
  updatedAt: number;
}

/**
 * Token-bucket limiter keyed by an arbitrary string (we use client IP).
 *
 * This is per-instance, which is the correct trade-off for abuse control at
 * this size: it bounds what any single Function instance will do, and Vercel's
 * own firewall rate limits sit in front of the upgrade request.
 */
export class RateLimiter {
  readonly #buckets = new Map<string, Bucket>();
  readonly #capacity: number;
  readonly #refillPerMs: number;

  constructor(capacity: number, refillPerSecond: number) {
    this.#capacity = capacity;
    this.#refillPerMs = refillPerSecond / 1000;
  }

  /** Consumes one token. Returns false when the caller is over budget. */
  take(key: string, now = Date.now()): boolean {
    const bucket = this.#buckets.get(key);
    if (!bucket) {
      this.#buckets.set(key, { tokens: this.#capacity - 1, updatedAt: now });
      return true;
    }
    const refilled = Math.min(
      this.#capacity,
      bucket.tokens + (now - bucket.updatedAt) * this.#refillPerMs,
    );
    bucket.updatedAt = now;
    if (refilled < 1) {
      bucket.tokens = refilled;
      return false;
    }
    bucket.tokens = refilled - 1;
    return true;
  }

  /** Drops buckets that have fully refilled so the map cannot grow without bound. */
  sweep(now = Date.now()): void {
    const fullAfterMs = this.#capacity / this.#refillPerMs;
    for (const [key, bucket] of this.#buckets) {
      if (now - bucket.updatedAt > fullAfterMs) this.#buckets.delete(key);
    }
  }

  get size(): number {
    return this.#buckets.size;
  }
}
