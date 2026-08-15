/**
 * The VChat signaling server.
 *
 * Responsibilities, and nothing more: authenticate a peer into a room, keep the
 * roster accurate, and relay WebRTC negotiation between named peers. Media never
 * touches this server — it flows directly between browsers.
 *
 * Two properties are load-bearing and easy to regress:
 *
 *  1. Exactly one `message` listener is registered per socket. Registering one
 *     per subscribed event (as the original build did) means every frame is
 *     JSON-parsed once per listener and an unparseable frame takes down the
 *     whole process.
 *  2. Signaling is addressed, never broadcast. A mesh requires each offer to
 *     reach exactly one peer.
 */
import type { IncomingMessage } from 'node:http';
import type { WebSocket, WebSocketServer } from 'ws';

import {
  ERROR_CODES,
  LIMITS,
  MAX_MESSAGE_BYTES,
  PROTOCOL_VERSION,
  decodeClientMessage,
  encode,
  type ClientMessage,
  type ErrorCode,
  type MediaState,
  type ServerMessage,
} from '../shared/protocol.js';
import { buildIceServers } from './ice.js';
import { log } from './logger.js';
import { RateLimiter, newPeerId } from './security.js';
import type { Envelope, RoomStore, Unsubscribe } from './store/types.js';

export interface SignalingOptions {
  store: RoomStore;
  /** How long a connection may live before the client should reconnect, in ms. */
  connectionTtlMs?: number;
  heartbeatIntervalMs?: number;
  /** Peers whose heartbeat is older than this are evicted from the roster. */
  peerTimeoutMs?: number;
}

interface Session {
  readonly ws: WebSocket;
  id: string;
  roomId: string | null;
  name: string;
  state: MediaState;
  /** Set false before each ping; a pong flips it back. */
  alive: boolean;
  unsubscribe: Unsubscribe | null;
  readonly ip: string;
}

const DEFAULTS = {
  connectionTtlMs: 800_000,
  heartbeatIntervalMs: 30_000,
  peerTimeoutMs: 90_000,
} as const;

export function attachSignaling(
  wss: WebSocketServer,
  options: SignalingOptions,
): () => Promise<void> {
  const { store } = options;
  const connectionTtlMs = options.connectionTtlMs ?? DEFAULTS.connectionTtlMs;
  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULTS.heartbeatIntervalMs;
  const peerTimeoutMs = options.peerTimeoutMs ?? DEFAULTS.peerTimeoutMs;

  /** Peers whose socket this instance owns. Envelope delivery resolves through here. */
  const localSessions = new Map<string, Session>();

  const joinLimiter = new RateLimiter(10, 0.5);
  const messageLimiter = new RateLimiter(120, 40);

  const iceServers = buildIceServers();

  function send(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState !== ws.OPEN) return;
    ws.send(encode(message));
  }

  function sendError(ws: WebSocket, code: ErrorCode, message: string, fatal = false): void {
    send(ws, { type: 'error', code, message, fatal });
    if (fatal) ws.close(4000, code);
  }

  // -------------------------------------------------------------------------
  // Room fanout
  // -------------------------------------------------------------------------

  /**
   * Delivers an envelope to this instance's sockets. Runs on every instance
   * subscribed to the room; each one filters down to the peers it actually
   * holds, so the same code path is correct for both store backends.
   */
  function makeDeliver(session: Session) {
    return (envelope: Envelope): void => {
      if (envelope.exclude?.includes(session.id)) return;
      if (envelope.to !== 'room' && !envelope.to.includes(session.id)) return;
      send(session.ws, envelope.message);
    };
  }

  async function publish(roomId: string, envelope: Envelope): Promise<void> {
    try {
      await store.publish(roomId, envelope);
    } catch (error) {
      log.error('publish failed', { roomId, error: String(error) });
    }
  }

  // -------------------------------------------------------------------------
  // Message handlers
  // -------------------------------------------------------------------------

  async function handleJoin(
    session: Session,
    message: Extract<ClientMessage, { type: 'join' }>,
  ): Promise<void> {
    if (!joinLimiter.take(session.ip)) {
      sendError(
        session.ws,
        ERROR_CODES.RATE_LIMITED,
        'Too many join attempts. Try again shortly.',
        true,
      );
      return;
    }

    // A second join on a live socket means the client is switching rooms.
    if (session.roomId) await detach(session, 'left');

    // Resuming keeps the peer id stable across a reconnect so remote peers do
    // not have to tear down and rebuild their RTCPeerConnection. Refuse the
    // resume if that id is currently held by a live socket.
    if (message.resumeOf && !localSessions.has(message.resumeOf)) {
      session.id = message.resumeOf;
    }

    const result = await store.join({
      roomId: message.roomId,
      peerId: session.id,
      name: message.name,
      state: message.state,
      password: message.password ?? '',
      maxPeers: LIMITS.maxPeersPerRoom,
    });

    if (!result.ok) {
      sendError(session.ws, result.code, result.message, true);
      return;
    }

    session.roomId = message.roomId;
    session.name = result.peer.name;
    session.state = result.peer.state;
    localSessions.set(session.id, session);
    session.unsubscribe = await store.subscribe(message.roomId, makeDeliver(session));

    send(session.ws, {
      type: 'welcome',
      protocol: PROTOCOL_VERSION,
      self: result.peer,
      roomId: message.roomId,
      peers: result.others,
      iceServers,
      connectionDeadline: Date.now() + connectionTtlMs,
    });

    await publish(message.roomId, {
      to: 'room',
      exclude: [session.id],
      message: { type: 'peer-joined', peer: result.peer },
    });

    log.info('peer joined', {
      roomId: message.roomId,
      peerId: session.id,
      peers: result.others.length + 1,
      createdRoom: result.createdRoom,
    });
  }

  async function handleSignal(
    session: Session,
    message: Extract<ClientMessage, { type: 'signal' }>,
  ): Promise<void> {
    if (!session.roomId) {
      sendError(session.ws, ERROR_CODES.NOT_IN_ROOM, 'Join a room before signaling.');
      return;
    }
    if (message.to === session.id) return;

    await publish(session.roomId, {
      to: [message.to],
      message: { type: 'signal', from: session.id, payload: message.payload },
    });
  }

  async function handleState(
    session: Session,
    message: Extract<ClientMessage, { type: 'state' }>,
  ): Promise<void> {
    if (!session.roomId) return;
    const updated = await store.setPeerState(session.roomId, session.id, message.state);
    if (!updated) return;
    session.state = updated.state;

    await publish(session.roomId, {
      to: 'room',
      exclude: [session.id],
      message: { type: 'peer-state', peerId: session.id, state: updated.state },
    });
  }

  async function handleChat(
    session: Session,
    message: Extract<ClientMessage, { type: 'chat' }>,
  ): Promise<void> {
    if (!session.roomId) {
      sendError(session.ws, ERROR_CODES.NOT_IN_ROOM, 'Join a room before sending messages.');
      return;
    }
    await publish(session.roomId, {
      to: 'room',
      message: {
        type: 'chat',
        message: {
          id: newPeerId(),
          from: session.id,
          name: session.name,
          text: message.text,
          ts: Date.now(),
        },
      },
    });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Removes a session from its room and tells everyone else. Safe to call twice. */
  async function detach(session: Session, reason: 'left' | 'disconnected'): Promise<void> {
    const roomId = session.roomId;
    if (!roomId) return;
    session.roomId = null;

    try {
      await store.leave(roomId, session.id);
      await publish(roomId, {
        to: 'room',
        exclude: [session.id],
        message: { type: 'peer-left', peerId: session.id, reason },
      });
    } catch (error) {
      log.error('detach failed', { roomId, peerId: session.id, error: String(error) });
    } finally {
      if (session.unsubscribe) {
        await session.unsubscribe();
        session.unsubscribe = null;
      }
      if (localSessions.get(session.id) === session) localSessions.delete(session.id);
      log.info('peer left', { roomId, peerId: session.id, reason });
    }
  }

  wss.on('connection', (ws: WebSocket, request: IncomingMessage) => {
    const session: Session = {
      ws,
      id: newPeerId(),
      roomId: null,
      name: '',
      state: { audio: false, video: false, screen: false },
      alive: true,
      unsubscribe: null,
      ip: clientIp(request),
    };

    // A single message listener for the socket's whole lifetime. Every inbound
    // frame is parsed once, validated once, and dispatched once.
    ws.on('message', (data: unknown, isBinary: boolean) => {
      void (async () => {
        try {
          if (isBinary) {
            sendError(ws, ERROR_CODES.INVALID_MESSAGE, 'Binary frames are not supported.');
            return;
          }
          if (!messageLimiter.take(session.ip)) {
            sendError(ws, ERROR_CODES.RATE_LIMITED, 'Slow down.');
            return;
          }

          const raw = String(data);
          if (raw.length > MAX_MESSAGE_BYTES) {
            sendError(ws, ERROR_CODES.INVALID_MESSAGE, 'Message too large.', true);
            return;
          }

          const decoded = decodeClientMessage(raw);
          if (!decoded.ok) {
            sendError(ws, ERROR_CODES.INVALID_MESSAGE, decoded.error);
            return;
          }

          const message = decoded.value;
          switch (message.type) {
            case 'join':
              await handleJoin(session, message);
              break;
            case 'signal':
              await handleSignal(session, message);
              break;
            case 'state':
              await handleState(session, message);
              break;
            case 'chat':
              await handleChat(session, message);
              break;
            case 'leave':
              await detach(session, 'left');
              break;
            case 'ping':
              if (session.roomId) await store.heartbeat(session.roomId, session.id);
              send(ws, { type: 'pong', ts: message.ts });
              break;
            default: {
              // Exhaustiveness guard: adding a message type without a handler
              // becomes a compile error rather than silent no-op.
              const never: never = message;
              throw new Error(`Unhandled message: ${JSON.stringify(never)}`);
            }
          }
        } catch (error) {
          // One bad frame must never take down the instance and every other
          // call it is currently serving.
          log.error('message handler threw', { peerId: session.id, error: String(error) });
          sendError(ws, ERROR_CODES.INTERNAL, 'Something went wrong handling that message.');
        }
      })();
    });

    ws.on('pong', () => {
      session.alive = true;
      if (session.roomId) void store.heartbeat(session.roomId, session.id);
    });

    ws.on('close', () => {
      void detach(session, 'disconnected');
    });

    ws.on('error', (error: Error) => {
      log.warn('socket error', { peerId: session.id, error: error.message });
    });
  });

  // -------------------------------------------------------------------------
  // Timers
  // -------------------------------------------------------------------------

  const heartbeat = setInterval(() => {
    for (const session of localSessions.values()) {
      if (!session.alive) {
        session.ws.terminate();
        continue;
      }
      session.alive = false;
      try {
        session.ws.ping();
      } catch {
        session.ws.terminate();
      }
    }
  }, heartbeatIntervalMs);

  // Evicts peers left behind by an instance that died without closing sockets.
  const sweeper = setInterval(() => {
    void (async () => {
      try {
        const evicted = await store.sweep(peerTimeoutMs);
        for (const { roomId, peerId } of evicted) {
          await publish(roomId, {
            to: 'room',
            exclude: [peerId],
            message: { type: 'peer-left', peerId, reason: 'timeout' },
          });
        }
        joinLimiter.sweep();
        messageLimiter.sweep();
      } catch (error) {
        log.error('sweep failed', { error: String(error) });
      }
    })();
  }, peerTimeoutMs);

  heartbeat.unref?.();
  sweeper.unref?.();

  return async function shutdown(): Promise<void> {
    clearInterval(heartbeat);
    clearInterval(sweeper);
    await Promise.all(
      [...localSessions.values()].map((session) => detach(session, 'disconnected')),
    );
    await store.close();
  };
}

/**
 * Vercel terminates TLS at the edge, so the socket address is a proxy. The
 * left-most `x-forwarded-for` entry is the closest thing to a client identity
 * available for rate limiting.
 */
function clientIp(request: IncomingMessage): string {
  const forwarded = request.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = raw?.split(',')[0]?.trim();
  return first || request.socket.remoteAddress || 'unknown';
}
