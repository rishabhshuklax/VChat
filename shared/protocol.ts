/**
 * The VChat wire protocol.
 *
 * This module is the single source of truth for every message that crosses the
 * WebSocket. Both the browser client and the signaling Function import it, so
 * the two ends cannot drift apart. Every inbound message is validated with zod
 * before a handler ever sees it.
 */
import { z } from 'zod';

/** Wire protocol version. Bumped on any breaking change to the schemas below. */
export const PROTOCOL_VERSION = 2;

/** Hard ceiling on a single WebSocket frame. SDP blobs are the largest thing we carry. */
export const MAX_MESSAGE_BYTES = 256 * 1024;

export const LIMITS = {
  displayName: { min: 1, max: 32 },
  chatText: { min: 1, max: 2000 },
  password: { min: 0, max: 128 },
  roomCode: { min: 4, max: 64 },
  /** Mesh topology degrades past this; every peer holds a connection to every other peer. */
  maxPeersPerRoom: 8,
} as const;

// ---------------------------------------------------------------------------
// Room codes
// ---------------------------------------------------------------------------

/**
 * Unambiguous alphabet: no 0/O, 1/I/L. Room codes get read aloud and typed by
 * hand, so the characters people confuse are simply not in the set.
 */
export const ROOM_CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';

/** Canonical form of a room code: lowercased, stripped of spaces and dashes. */
export function normalizeRoomCode(input: string): string {
  return input.trim().toLowerCase().replace(/[\s-]/g, '');
}

/** Renders a code for display as `abcd-efgh`, which is far easier to read back. */
export function formatRoomCode(code: string): string {
  const normalized = normalizeRoomCode(code);
  if (normalized.length !== 8) return normalized;
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

// ---------------------------------------------------------------------------
// Core value schemas
// ---------------------------------------------------------------------------

export const roomCodeSchema = z
  .string()
  .transform(normalizeRoomCode)
  .pipe(
    z
      .string()
      .min(LIMITS.roomCode.min)
      .max(LIMITS.roomCode.max)
      .regex(/^[a-z0-9]+$/, 'Room codes use letters and numbers only.'),
  );

export const displayNameSchema = z
  .string()
  .trim()
  .min(LIMITS.displayName.min)
  .max(LIMITS.displayName.max);

export const peerIdSchema = z.string().uuid();

/** What a participant is currently publishing. Mirrored to every other peer. */
export const mediaStateSchema = z.object({
  audio: z.boolean(),
  video: z.boolean(),
  screen: z.boolean(),
});

export type MediaState = z.infer<typeof mediaStateSchema>;

export const peerSchema = z.object({
  id: peerIdSchema,
  name: displayNameSchema,
  state: mediaStateSchema,
  /** Milliseconds since epoch, set by the server when the peer joined. */
  joinedAt: z.number().int().nonnegative(),
});

export type Peer = z.infer<typeof peerSchema>;

// ---------------------------------------------------------------------------
// WebRTC signaling payloads
// ---------------------------------------------------------------------------

/**
 * A single negotiation datum addressed to exactly one peer. The old build
 * broadcast these to the whole room, which cannot work for a mesh: every peer
 * would try to answer every other peer's offer.
 */
export const signalPayloadSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('description'),
    description: z.object({
      type: z.enum(['offer', 'answer', 'pranswer', 'rollback']),
      sdp: z.string().max(MAX_MESSAGE_BYTES),
    }),
  }),
  z.object({
    kind: z.literal('candidate'),
    candidate: z.object({
      candidate: z.string().max(4096),
      sdpMid: z.string().max(256).nullable().optional(),
      sdpMLineIndex: z.number().int().nullable().optional(),
      usernameFragment: z.string().max(256).nullable().optional(),
    }),
  }),
]);

export type SignalPayload = z.infer<typeof signalPayloadSchema>;

// ---------------------------------------------------------------------------
// Client -> Server
// ---------------------------------------------------------------------------

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('join'),
    roomId: roomCodeSchema,
    password: z.string().max(LIMITS.password.max).optional(),
    name: displayNameSchema,
    state: mediaStateSchema,
    /**
     * Set when the client is re-entering a room it was already in after the
     * socket dropped, which lets the server skip the "new peer" announcement.
     */
    resumeOf: peerIdSchema.optional(),
  }),
  z.object({
    type: z.literal('signal'),
    to: peerIdSchema,
    payload: signalPayloadSchema,
  }),
  z.object({
    type: z.literal('state'),
    state: mediaStateSchema,
  }),
  z.object({
    type: z.literal('chat'),
    text: z.string().trim().min(LIMITS.chatText.min).max(LIMITS.chatText.max),
  }),
  z.object({
    type: z.literal('reaction'),
    /** A single emoji. 16 chars covers multi-codepoint sequences (ZWJ, skin tones). */
    emoji: z.string().trim().min(1).max(16),
  }),
  z.object({ type: z.literal('leave') }),
  z.object({ type: z.literal('ping'), ts: z.number().optional() }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
export type ClientMessageOf<T extends ClientMessage['type']> = Extract<ClientMessage, { type: T }>;

// ---------------------------------------------------------------------------
// Server -> Client
// ---------------------------------------------------------------------------

/** Machine-readable failure reasons. The UI maps these to human copy. */
export const ERROR_CODES = {
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  BAD_PASSWORD: 'BAD_PASSWORD',
  PASSWORD_REQUIRED: 'PASSWORD_REQUIRED',
  INVALID_MESSAGE: 'INVALID_MESSAGE',
  RATE_LIMITED: 'RATE_LIMITED',
  NAME_TAKEN: 'NAME_TAKEN',
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const iceServerSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional(),
});

export type IceServer = z.infer<typeof iceServerSchema>;

export const chatMessageSchema = z.object({
  id: z.string(),
  from: peerIdSchema,
  name: displayNameSchema,
  text: z.string(),
  ts: z.number().int().nonnegative(),
});

export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('welcome'),
    protocol: z.number().int(),
    self: peerSchema,
    roomId: z.string(),
    /** Everyone already in the room, excluding self. */
    peers: z.array(peerSchema),
    iceServers: z.array(iceServerSchema),
    /**
     * Server-side deadline for this connection. Vercel Functions terminate
     * WebSockets at max duration, so the client pre-emptively reconnects
     * shortly before this to avoid a visible drop.
     */
    connectionDeadline: z.number().int().nullable(),
  }),
  z.object({
    type: z.literal('peer-joined'),
    peer: peerSchema,
  }),
  z.object({
    type: z.literal('peer-left'),
    peerId: peerIdSchema,
    reason: z.enum(['left', 'disconnected', 'timeout', 'replaced']),
  }),
  z.object({
    type: z.literal('peer-state'),
    peerId: peerIdSchema,
    state: mediaStateSchema,
  }),
  z.object({
    type: z.literal('signal'),
    from: peerIdSchema,
    payload: signalPayloadSchema,
  }),
  z.object({
    type: z.literal('chat'),
    message: chatMessageSchema,
  }),
  z.object({
    type: z.literal('reaction'),
    /** Server-assigned id so clients can key the animation. */
    id: z.string(),
    from: peerIdSchema,
    name: displayNameSchema,
    emoji: z.string().max(16),
    ts: z.number().int().nonnegative(),
  }),
  z.object({
    type: z.literal('error'),
    code: z.string(),
    message: z.string(),
    /** When true the server is about to close the socket; do not retry blindly. */
    fatal: z.boolean(),
  }),
  z.object({ type: z.literal('pong'), ts: z.number().optional() }),
]);

export type ServerMessage = z.infer<typeof serverMessageSchema>;
export type ServerMessageOf<T extends ServerMessage['type']> = Extract<ServerMessage, { type: T }>;

// ---------------------------------------------------------------------------
// Encoding helpers
// ---------------------------------------------------------------------------

export function encode(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

export type DecodeResult<T> = { ok: true; value: T } | { ok: false; error: string };

function decodeWith<T>(schema: z.ZodType<T>, raw: string): DecodeResult<T> {
  if (raw.length > MAX_MESSAGE_BYTES) {
    return { ok: false, error: 'Message exceeds the maximum allowed size.' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Message is not valid JSON.' };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: result.error.issues[0]?.message ?? 'Invalid message.' };
  }
  return { ok: true, value: result.data };
}

export const decodeClientMessage = (raw: string): DecodeResult<ClientMessage> =>
  decodeWith(clientMessageSchema, raw);

export const decodeServerMessage = (raw: string): DecodeResult<ServerMessage> =>
  decodeWith(serverMessageSchema, raw);

// ---------------------------------------------------------------------------
// Negotiation roles
// ---------------------------------------------------------------------------

/**
 * Perfect negotiation needs exactly one "polite" peer per connection. Deriving
 * it from a lexicographic comparison of the two peer ids means both sides
 * compute the same answer with no extra round trip.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation
 */
export function isPolite(selfId: string, remoteId: string): boolean {
  return selfId < remoteId;
}
