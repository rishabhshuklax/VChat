/**
 * Room storage and cross-instance fanout.
 *
 * Vercel gives no guarantee that two WebSocket connections land on the same
 * Function instance, so room membership cannot live in a module-level Map the
 * way it did before. Everything the signaling layer needs from shared state is
 * behind this interface: the in-memory adapter serves single-instance and local
 * development, and the Redis adapter serves multi-instance deployments without
 * the signaling layer knowing which one it is talking to.
 */
import type { ErrorCode, MediaState, Peer, ServerMessage } from '../../shared/protocol.js';

/** A message to deliver, plus who should receive it. */
export interface Envelope {
  /** `'room'` targets every peer currently in the room. */
  to: 'room' | string[];
  /** Peer ids to skip. Used so a sender never receives their own broadcast. */
  exclude?: string[];
  message: ServerMessage;
}

export type JoinResult =
  | {
      ok: true;
      /** The peer as the store recorded it. */
      peer: Peer;
      /** Everyone else already present, excluding the joining peer. */
      others: Peer[];
      /** True when this join brought the room into existence. */
      createdRoom: boolean;
      /**
       * True when this peer id was already in the roster — a reconnect
       * resuming its identity. The caller must not re-announce it.
       */
      rejoined: boolean;
    }
  | { ok: false; code: ErrorCode; message: string };

export interface JoinRequest {
  roomId: string;
  peerId: string;
  name: string;
  state: MediaState;
  /** Plaintext attempt. Hashed by the store before anything is persisted. */
  password: string;
  maxPeers: number;
}

/** Unsubscribes a previously registered room listener. */
export type Unsubscribe = () => void | Promise<void>;

export interface RoomStore {
  /** Identifies the active backend; surfaced in logs and the health endpoint. */
  readonly kind: 'memory' | 'redis';

  /**
   * Adds a peer to a room, creating the room if it does not exist yet.
   *
   * The first peer to join establishes the room's password. There is no
   * separate "create" operation, which removes an entire class of bugs the old
   * build had: orphaned rooms, permanently claimed room codes, and a
   * create/join race.
   */
  join(request: JoinRequest): Promise<JoinResult>;

  /** Removes a peer. Deletes the room once its last peer is gone. */
  leave(roomId: string, peerId: string): Promise<void>;

  /** Current roster, oldest join first. */
  peers(roomId: string): Promise<Peer[]>;

  /** Returns the updated peer, or null when the peer is no longer in the room. */
  setPeerState(roomId: string, peerId: string, state: MediaState): Promise<Peer | null>;

  /** Refreshes a peer's liveness timestamp so the sweeper does not evict it. */
  heartbeat(roomId: string, peerId: string): Promise<void>;

  /**
   * When this peer was last seen (join, heartbeat, or state change), or null
   * if it is not in the room. Lets a disconnect grace timer tell "resumed on
   * some instance" apart from "really gone".
   */
  peerLastSeen(roomId: string, peerId: string): Promise<number | null>;

  /** Publishes to every instance holding peers in this room, including this one. */
  publish(roomId: string, envelope: Envelope): Promise<void>;

  /** Registers local delivery for a room. Idempotent per handler. */
  subscribe(roomId: string, handler: (envelope: Envelope) => void): Promise<Unsubscribe>;

  /**
   * Evicts peers whose heartbeat is older than `maxAgeMs`, returning what was
   * removed so the caller can announce the departures.
   */
  sweep(maxAgeMs: number): Promise<Array<{ roomId: string; peerId: string }>>;

  close(): Promise<void>;
}
