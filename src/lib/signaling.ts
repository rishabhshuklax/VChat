/**
 * Reconnecting signaling transport.
 *
 * Vercel Functions terminate WebSockets when they hit max duration, so a
 * dropped socket is a routine event in a long call, not an error. This client
 * treats it that way: it reconnects with backoff, and it also reconnects
 * *pre-emptively* just before the server-declared deadline so the swap happens
 * while the old socket is still healthy and nothing is lost.
 */
import {
  decodeServerMessage,
  encode,
  type ClientMessage,
  type ServerMessage,
} from '@shared/protocol';

export type SignalingStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

type MessageHandler = (message: ServerMessage) => void;
type StatusHandler = (status: SignalingStatus) => void;

/** Reconnect this long before the server says the connection will be cut. */
const DEADLINE_MARGIN_MS = 30_000;
const PING_INTERVAL_MS = 25_000;
const MAX_BACKOFF_MS = 15_000;

export function signalingUrl(): string {
  const override = import.meta.env.VITE_SIGNALING_URL;
  if (override) return override;
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/api/ws`;
}

export class SignalingClient {
  #ws: WebSocket | null = null;
  #status: SignalingStatus = 'idle';
  #attempt = 0;
  #closedByUser = false;

  #reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  #deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  #pingTimer: ReturnType<typeof setInterval> | null = null;

  readonly #messageHandlers = new Set<MessageHandler>();
  readonly #statusHandlers = new Set<StatusHandler>();

  /**
   * Rebuilt by the owner on every (re)connect. Returning null means "do not
   * announce yet" — used while the call has not been configured.
   */
  #joinFactory: (() => ClientMessage | null) | null = null;

  /** Round-trip time of the most recent ping, in ms. */
  latencyMs: number | null = null;

  get status(): SignalingStatus {
    return this.#status;
  }

  onMessage(handler: MessageHandler): () => void {
    this.#messageHandlers.add(handler);
    return () => this.#messageHandlers.delete(handler);
  }

  onStatus(handler: StatusHandler): () => void {
    this.#statusHandlers.add(handler);
    return () => this.#statusHandlers.delete(handler);
  }

  /** Supplies the join message replayed on every successful connection. */
  setJoinFactory(factory: (() => ClientMessage | null) | null): void {
    this.#joinFactory = factory;
  }

  connect(): void {
    this.#closedByUser = false;
    this.#open();
  }

  #setStatus(status: SignalingStatus): void {
    if (this.#status === status) return;
    this.#status = status;
    for (const handler of this.#statusHandlers) handler(status);
  }

  #open(): void {
    this.#clearTimers();
    this.#setStatus(this.#attempt === 0 ? 'connecting' : 'reconnecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(signalingUrl());
    } catch {
      this.#scheduleReconnect();
      return;
    }
    this.#ws = ws;

    ws.addEventListener('open', () => {
      this.#attempt = 0;
      this.#setStatus('open');

      const join = this.#joinFactory?.();
      if (join) this.send(join);

      this.#pingTimer = setInterval(() => {
        this.send({ type: 'ping', ts: Date.now() });
      }, PING_INTERVAL_MS);
    });

    ws.addEventListener('message', (event) => {
      const decoded = decodeServerMessage(String(event.data));
      if (!decoded.ok) {
        console.warn('[signaling] dropped invalid message:', decoded.error);
        return;
      }
      const message = decoded.value;

      if (message.type === 'pong' && typeof message.ts === 'number') {
        this.latencyMs = Date.now() - message.ts;
        return;
      }

      if (message.type === 'welcome' && message.connectionDeadline) {
        this.#scheduleDeadlineReconnect(message.connectionDeadline);
      }

      for (const handler of this.#messageHandlers) handler(message);
    });

    ws.addEventListener('close', () => {
      this.#clearTimers();
      if (this.#closedByUser) {
        this.#setStatus('closed');
        return;
      }
      this.#scheduleReconnect();
    });

    ws.addEventListener('error', () => {
      // 'close' always follows; reconnection is handled there so it does not
      // run twice.
    });
  }

  /**
   * Swaps to a fresh socket shortly before the server would cut this one. The
   * peer id is preserved via `resumeOf`, so remote RTCPeerConnections are
   * untouched and media keeps flowing straight through the changeover.
   */
  #scheduleDeadlineReconnect(deadline: number): void {
    if (this.#deadlineTimer) clearTimeout(this.#deadlineTimer);
    const delay = Math.max(5_000, deadline - Date.now() - DEADLINE_MARGIN_MS);
    this.#deadlineTimer = setTimeout(() => {
      if (this.#closedByUser) return;
      this.#ws?.close(1000, 'deadline');
    }, delay);
  }

  #scheduleReconnect(): void {
    this.#setStatus('reconnecting');
    // Exponential backoff with jitter, so a Function recycling many sockets at
    // once does not produce a synchronised reconnect stampede.
    const base = Math.min(MAX_BACKOFF_MS, 500 * 2 ** this.#attempt);
    const delay = base * (0.7 + Math.random() * 0.6);
    this.#attempt += 1;
    this.#reconnectTimer = setTimeout(() => this.#open(), delay);
  }

  #clearTimers(): void {
    if (this.#pingTimer) clearInterval(this.#pingTimer);
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    if (this.#deadlineTimer) clearTimeout(this.#deadlineTimer);
    this.#pingTimer = null;
    this.#reconnectTimer = null;
    this.#deadlineTimer = null;
  }

  send(message: ClientMessage): void {
    const ws = this.#ws;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(encode(message));
  }

  close(): void {
    this.#closedByUser = true;
    this.#clearTimers();
    this.send({ type: 'leave' });
    this.#ws?.close(1000, 'left');
    this.#ws = null;
    this.#setStatus('closed');
  }
}
