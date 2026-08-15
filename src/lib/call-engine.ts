/**
 * The call, as one observable object.
 *
 * Signaling, the peer mesh, local media, and audio metering are coordinated
 * here rather than across a web of React effects. React subscribes through
 * `useSyncExternalStore` and only renders; nothing in this file imports React.
 * That keeps the hard parts — negotiation ordering, device swaps, reconnection
 * — testable and free of stale-closure bugs.
 */
import {
  ERROR_CODES,
  LIMITS,
  type ChatMessage,
  type InkPoint,
  type MediaState,
  type Peer,
  type ServerMessage,
} from '@shared/protocol';

import { AudioMeter } from './audio-meter';
import { PeerMesh, type PeerQuality } from './mesh';
import {
  acquireLocalMedia,
  acquireScreenShare,
  describeMediaError,
  listDevices,
  stopStream,
  MediaError,
  type DeviceList,
} from './media';
import { SignalingClient, type SignalingStatus } from './signaling';

export type CallStatus = 'idle' | 'joining' | 'connected' | 'reconnecting' | 'error' | 'left';

export interface Participant {
  id: string;
  name: string;
  isLocal: boolean;
  state: MediaState;
  stream: MediaStream | null;
  connection: RTCPeerConnectionState | 'local';
  quality: PeerQuality | null;
  level: number;
  speaking: boolean;
  /** Frames stopped arriving over an established connection — soften, don't hide. */
  videoInterrupted: boolean;
}

export interface Notice {
  id: string;
  kind: 'info' | 'success' | 'warning' | 'error';
  text: string;
}

/** A live emoji reaction currently animating on the stage. */
export interface ReactionEvent {
  id: string;
  emoji: string;
  name: string;
}

/** One inbound batch of a remote Air Ink stroke. */
export interface InkEvent {
  from: string;
  stroke: string;
  points: InkPoint[];
  done: boolean;
}

export interface CallState {
  status: CallStatus;
  error: { code: string; message: string } | null;
  selfId: string | null;
  roomId: string;
  participants: Participant[];
  messages: ChatMessage[];
  unread: number;
  latencyMs: number | null;
  devices: DeviceList;
  cameraId: string | null;
  microphoneId: string | null;
  notices: Notice[];
  reactions: ReactionEvent[];
  /** True while a screen share is being published by this client. */
  presenting: boolean;
  /** Which way the camera faces. Drives self-view mirroring. */
  facing: 'user' | 'environment';
  /** Every display name that has been in this call — the call receipt. */
  roster: string[];
  reactionCount: number;
  /**
   * Who currently holds the floor, chosen with hysteresis so the focus view
   * follows the conversation instead of twitching at every interjection.
   */
  activeSpeakerId: string | null;
}

export interface JoinOptions {
  roomId: string;
  name: string;
  password?: string;
  audio: boolean;
  video: boolean;
  cameraId?: string | null;
  microphoneId?: string | null;
}

const EMPTY_DEVICES: DeviceList = { cameras: [], microphones: [], speakers: [] };

const INITIAL: CallState = {
  status: 'idle',
  error: null,
  selfId: null,
  roomId: '',
  participants: [],
  messages: [],
  unread: 0,
  latencyMs: null,
  devices: EMPTY_DEVICES,
  cameraId: null,
  microphoneId: null,
  notices: [],
  reactions: [],
  presenting: false,
  facing: 'user',
  roster: [],
  reactionCount: 0,
  activeSpeakerId: null,
};

let noticeSeq = 0;

export class CallEngine {
  #state: CallState = INITIAL;
  readonly #listeners = new Set<() => void>();
  /** Ink is imperative: the canvas layer registers here, outside React state. */
  readonly #inkHandlers = new Set<(event: InkEvent) => void>();

  readonly #signaling = new SignalingClient();
  readonly #meter = new AudioMeter();
  #mesh: PeerMesh | null = null;

  #localStream: MediaStream | null = null;
  /** Camera track parked while a screen share is on air, so it can be restored. */
  #parkedCameraTrack: MediaStreamTrack | null = null;
  #screenStream: MediaStream | null = null;

  #localState: MediaState = { audio: true, video: true, screen: false };
  #joinOptions: JoinOptions | null = null;

  #meterTimer: ReturnType<typeof setInterval> | null = null;
  /** Active-speaker hysteresis: a challenger must hold the floor briefly. */
  #speakerCandidate: string | null = null;
  #speakerCandidateSince = 0;
  /** Debounce before surfacing 'reconnecting': sub-second blips stay invisible. */
  #reconnectSurfaceTimer: ReturnType<typeof setTimeout> | null = null;
  #joinRetryTimer: ReturnType<typeof setTimeout> | null = null;
  #outage = false;
  #qualityTimer: ReturnType<typeof setInterval> | null = null;
  #unsubscribers: Array<() => void> = [];
  #chatVisible = false;

  // -------------------------------------------------------------------------
  // Store plumbing
  // -------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  getSnapshot = (): CallState => this.#state;

  #set(patch: Partial<CallState>): void {
    this.#state = { ...this.#state, ...patch };
    for (const listener of this.#listeners) listener();
  }

  #patchParticipant(id: string, patch: Partial<Participant>): void {
    let changed = false;
    const participants = this.#state.participants.map((participant) => {
      if (participant.id !== id) return participant;
      changed = true;
      return { ...participant, ...patch };
    });
    if (changed) this.#set({ participants });
  }

  #notify(kind: Notice['kind'], text: string): void {
    const notice: Notice = { id: `n${++noticeSeq}`, kind, text };
    this.#set({ notices: [...this.#state.notices, notice] });
    setTimeout(() => this.dismissNotice(notice.id), 5000);
  }

  dismissNotice = (id: string): void => {
    this.#set({ notices: this.#state.notices.filter((notice) => notice.id !== id) });
  };

  #noteName(name: string): void {
    if (this.#state.roster.includes(name)) return;
    this.#set({ roster: [...this.#state.roster, name] });
  }

  // -------------------------------------------------------------------------
  // Joining
  // -------------------------------------------------------------------------

  async join(options: JoinOptions): Promise<void> {
    this.#joinOptions = options;
    this.#localState = { audio: options.audio, video: options.video, screen: false };
    this.#set({
      status: 'joining',
      roomId: options.roomId,
      error: null,
      cameraId: options.cameraId ?? null,
      microphoneId: options.microphoneId ?? null,
    });

    // Media first: a permission prompt should never race the room roster.
    try {
      const { stream, errors } = await acquireLocalMedia({
        audio: options.audio,
        video: options.video,
        cameraId: options.cameraId ?? undefined,
        microphoneId: options.microphoneId ?? undefined,
      });
      this.#localStream = stream;
      for (const track of stream.getTracks()) {
        this.#watchLocalTrack(track, track.kind === 'audio' ? 'audio' : 'video');
      }

      // Reflect what we actually got, not what we asked for.
      this.#localState = {
        audio: stream.getAudioTracks().length > 0 && options.audio,
        video: stream.getVideoTracks().length > 0 && options.video,
        screen: false,
      };
      for (const error of errors) this.#notify('warning', error.message);
    } catch (error) {
      const mediaError = error instanceof MediaError ? error : describeMediaError(error);
      // Joining audio-and-video-less is still joining; the call is usable.
      this.#localState = { audio: false, video: false, screen: false };
      this.#notify('warning', mediaError.message);
    }

    void this.#refreshDevices();
    await this.#meter.resume();

    this.#installLocalParticipant(options.name);
    this.#wireSignaling();
    this.#signaling.setJoinFactory(() => {
      const current = this.#joinOptions;
      if (!current) return null;
      return {
        type: 'join',
        roomId: current.roomId,
        name: current.name,
        ...(current.password ? { password: current.password } : {}),
        state: this.#localState,
        // Keeps our identity stable across reconnects so remote peers do not
        // have to rebuild their connection to us.
        ...(this.#state.selfId ? { resumeOf: this.#state.selfId } : {}),
      };
    });
    this.#signaling.connect();
    this.#startTimers();
  }

  #installLocalParticipant(name: string): void {
    const local: Participant = {
      id: 'local',
      name,
      isLocal: true,
      state: this.#localState,
      stream: this.#localStream,
      connection: 'local',
      quality: null,
      level: 0,
      speaking: false,
      videoInterrupted: false,
    };
    this.#set({ participants: [local] });
    if (this.#localStream) this.#meter.attach('local', this.#localStream);
  }

  #wireSignaling(): void {
    this.#unsubscribers.push(
      this.#signaling.onStatus((status: SignalingStatus) => {
        if (status === 'open') {
          if (this.#reconnectSurfaceTimer) {
            clearTimeout(this.#reconnectSurfaceTimer);
            this.#reconnectSurfaceTimer = null;
          }
          return;
        }
        // Surface a drop only once it has lasted long enough to matter.
        // Planned socket swaps and sub-second blips resolve inside this
        // window and the interface never so much as flickers.
        if (
          status === 'reconnecting' &&
          this.#state.status === 'connected' &&
          !this.#reconnectSurfaceTimer
        ) {
          this.#reconnectSurfaceTimer = setTimeout(() => {
            this.#reconnectSurfaceTimer = null;
            if (this.#signaling.status === 'open') return;
            this.#set({ status: 'reconnecting' });
            if (!this.#outage) {
              this.#outage = true;
              this.#notify('warning', 'Connection wobbled — reconnecting…');
            }
          }, 1500);
        }
      }),
    );

    this.#unsubscribers.push(
      this.#signaling.onMessage((message) => {
        void this.#handleMessage(message);
      }),
    );
  }

  async #handleMessage(message: ServerMessage): Promise<void> {
    switch (message.type) {
      case 'welcome': {
        const selfId = message.self.id;
        const firstConnect = this.#state.selfId === null;
        // The resume was refused (rare): our identity changed, so every
        // negotiation role changed with it. A stale mesh would deadlock on
        // glare; rebuild it cleanly.
        const identityChanged = !firstConnect && this.#state.selfId !== selfId;

        if (this.#outage) {
          this.#outage = false;
          this.#notify('success', 'Reconnected');
        }

        this.#set({
          status: 'connected',
          selfId,
          roomId: message.roomId,
          error: null,
        });
        this.#patchParticipant('local', { name: message.self.name });
        this.#noteName(message.self.name);
        for (const peer of message.peers) this.#noteName(peer.name);

        if (!this.#mesh || firstConnect || identityChanged) {
          this.#mesh?.close();
          this.#mesh = new PeerMesh(selfId, message.iceServers as RTCIceServer[], {
            sendSignal: (to, payload) => this.#signaling.send({ type: 'signal', to, payload }),
            onStream: (peerId, stream) => {
              this.#patchParticipant(peerId, { stream });
              this.#meter.attach(peerId, stream);
            },
            onConnectionState: (peerId, state) => {
              this.#patchParticipant(peerId, { connection: state });
            },
            onInterruption: (peerId, interrupted) => {
              this.#patchParticipant(peerId, { videoInterrupted: interrupted });
            },
          });
          this.#publishLocalTracks();
        }

        this.#syncRoster(message.peers);
        // Connections that went stale while signaling was down get a fresh
        // round of ICE now that offers can travel again.
        this.#mesh?.reviveUnhealthy();
        break;
      }

      case 'peer-joined': {
        const alreadyHere = this.#state.participants.some(
          (participant) => participant.id === message.peer.id,
        );
        this.#addParticipant(message.peer);
        this.#noteName(message.peer.name);
        this.#mesh?.addPeer(message.peer.id);
        if (!alreadyHere) this.#notify('info', `${message.peer.name} joined`);
        break;
      }

      case 'peer-left': {
        const leaving = this.#state.participants.find((p) => p.id === message.peerId);
        this.#removeParticipant(message.peerId);
        if (this.#state.activeSpeakerId === message.peerId) {
          this.#set({ activeSpeakerId: null });
        }
        if (leaving && message.reason !== 'replaced') {
          this.#notify('info', `${leaving.name} left`);
        }
        break;
      }

      case 'peer-state': {
        this.#patchParticipant(message.peerId, { state: message.state });
        break;
      }

      case 'signal': {
        await this.#mesh?.handleSignal(message.from, message.payload);
        break;
      }

      case 'chat': {
        const messages = [...this.#state.messages, message.message];
        this.#set({
          messages,
          unread:
            this.#chatVisible || message.message.from === this.#state.selfId
              ? this.#state.unread
              : this.#state.unread + 1,
        });
        break;
      }

      case 'reaction': {
        const reaction: ReactionEvent = {
          id: message.id,
          emoji: message.emoji,
          name: message.from === this.#state.selfId ? 'You' : message.name,
        };
        this.#set({
          reactions: [...this.#state.reactions, reaction],
          reactionCount: this.#state.reactionCount + 1,
        });
        // Matches the float-up animation length, plus a little slack.
        setTimeout(() => {
          this.#set({ reactions: this.#state.reactions.filter((r) => r.id !== reaction.id) });
        }, 2800);
        break;
      }

      case 'ink': {
        const event: InkEvent = {
          from: message.from,
          stroke: message.stroke,
          points: message.points,
          done: message.done,
        };
        for (const handler of this.#inkHandlers) handler(event);
        break;
      }

      case 'error': {
        // A throttled (re)join is a pause, not a verdict — retry quietly
        // instead of surfacing an error for something the network did.
        if (
          !message.fatal &&
          message.code === ERROR_CODES.RATE_LIMITED &&
          this.#state.status !== 'connected'
        ) {
          this.#joinRetryTimer ??= setTimeout(() => {
            this.#joinRetryTimer = null;
            this.#signaling.rejoin();
          }, 4000);
          break;
        }

        this.#set({
          error: { code: message.code, message: message.message },
          ...(message.fatal ? { status: 'error' as const } : {}),
        });
        if (message.fatal) this.#teardown();
        else this.#notify('error', message.message);
        break;
      }

      case 'pong':
        break;

      default:
        break;
    }

    this.#set({ latencyMs: this.#signaling.latencyMs });
  }

  /**
   * Reconciles the roster after a (re)connect: adds anyone new, drops anyone
   * gone. Existing peers keep their RTCPeerConnection and their media.
   */
  #syncRoster(peers: Peer[]): void {
    const seen = new Set(peers.map((peer) => peer.id));

    for (const participant of this.#state.participants) {
      if (participant.isLocal) continue;
      if (!seen.has(participant.id)) this.#removeParticipant(participant.id);
    }

    for (const peer of peers) {
      this.#addParticipant(peer);
      this.#mesh?.addPeer(peer.id);
    }
  }

  #addParticipant(peer: Peer): void {
    const existing = this.#state.participants.find((participant) => participant.id === peer.id);
    if (existing) {
      this.#patchParticipant(peer.id, { name: peer.name, state: peer.state });
      return;
    }
    const participant: Participant = {
      id: peer.id,
      name: peer.name,
      isLocal: false,
      state: peer.state,
      stream: null,
      connection: 'new',
      quality: null,
      level: 0,
      speaking: false,
      videoInterrupted: false,
    };
    this.#set({ participants: [...this.#state.participants, participant] });
  }

  #removeParticipant(peerId: string): void {
    this.#mesh?.removePeer(peerId);
    this.#meter.detach(peerId);
    this.#set({
      participants: this.#state.participants.filter((participant) => participant.id !== peerId),
    });
  }

  // -------------------------------------------------------------------------
  // Local media controls
  // -------------------------------------------------------------------------

  /**
   * A local device can die mid-call — unplugged, grabbed by another app, or
   * revoked by the OS. Reflect it honestly instead of freezing: flip the
   * state, tell the peers, tell the user.
   */
  #watchLocalTrack(track: MediaStreamTrack, kind: 'audio' | 'video'): void {
    track.addEventListener('ended', () => {
      // stop() does not fire 'ended'; this is only external loss.
      this.#localStream?.removeTrack(track);
      this.#mesh?.setLocalTrack(kind, null);
      this.#localState = { ...this.#localState, [kind === 'audio' ? 'audio' : 'video']: false };
      this.#patchParticipant('local', { stream: this.#localStream });
      this.#pushState();
      this.#notify(
        'warning',
        kind === 'audio' ? 'Your microphone was disconnected.' : 'Your camera was disconnected.',
      );
    });
  }

  #publishLocalTracks(): void {
    const stream = this.#localStream;
    this.#mesh?.setLocalTrack('audio', stream?.getAudioTracks()[0] ?? null);
    this.#mesh?.setLocalTrack('video', stream?.getVideoTracks()[0] ?? null);
  }

  #pushState(): void {
    this.#signaling.send({ type: 'state', state: this.#localState });
    this.#patchParticipant('local', { state: this.#localState });
    this.#set({ presenting: this.#localState.screen });
  }

  /** Mute is `enabled = false`: instant, and it keeps the track for unmuting. */
  toggleAudio = (): void => {
    const track = this.#localStream?.getAudioTracks()[0];
    if (!track) {
      void this.#enableAudioFromScratch();
      return;
    }
    track.enabled = !track.enabled;
    this.#localState = { ...this.#localState, audio: track.enabled };
    this.#pushState();
  };

  async #enableAudioFromScratch(): Promise<void> {
    try {
      const { stream } = await acquireLocalMedia({
        audio: true,
        video: false,
        microphoneId: this.#state.microphoneId ?? undefined,
      });
      const track = stream.getAudioTracks()[0];
      if (!track) return;
      this.#localStream ??= new MediaStream();
      this.#localStream.addTrack(track);
      this.#watchLocalTrack(track, 'audio');
      this.#mesh?.setLocalTrack('audio', track);
      this.#meter.attach('local', this.#localStream);
      this.#localState = { ...this.#localState, audio: true };
      this.#patchParticipant('local', { stream: this.#localStream });
      this.#pushState();
    } catch (error) {
      this.#notify('error', describeMediaError(error).message);
    }
  }

  /**
   * Camera off actually stops the track rather than disabling it, so the
   * hardware indicator light goes out — which is what people check.
   */
  toggleVideo = async (): Promise<void> => {
    if (this.#localState.screen) {
      this.#notify('info', 'Stop sharing your screen to use your camera.');
      return;
    }

    if (this.#localState.video) {
      const track = this.#localStream?.getVideoTracks()[0];
      if (track) {
        track.stop();
        this.#localStream?.removeTrack(track);
      }
      this.#mesh?.setLocalTrack('video', null);
      this.#localState = { ...this.#localState, video: false };
      this.#patchParticipant('local', { stream: this.#localStream });
      this.#pushState();
      return;
    }

    try {
      const { stream } = await acquireLocalMedia({
        audio: false,
        video: true,
        cameraId: this.#state.cameraId ?? undefined,
      });
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('no video track');
      this.#localStream ??= new MediaStream();
      this.#localStream.addTrack(track);
      this.#watchLocalTrack(track, 'video');
      this.#mesh?.setLocalTrack('video', track);
      this.#localState = { ...this.#localState, video: true };
      this.#patchParticipant('local', { stream: this.#localStream });
      this.#pushState();
    } catch (error) {
      this.#notify('error', describeMediaError(error).message);
    }
  };

  /**
   * Screen share swaps the outbound video track. Because the transceiver is
   * already in place this needs no renegotiation, and the camera track is
   * parked so it can be restored the moment sharing stops.
   */
  toggleScreenShare = async (): Promise<void> => {
    if (this.#localState.screen) {
      this.#stopScreenShare();
      return;
    }

    try {
      const screen = await acquireScreenShare();
      const track = screen.getVideoTracks()[0];
      if (!track) return;

      this.#screenStream = screen;
      this.#parkedCameraTrack = this.#localStream?.getVideoTracks()[0] ?? null;
      if (this.#parkedCameraTrack) this.#localStream?.removeTrack(this.#parkedCameraTrack);
      this.#localStream ??= new MediaStream();
      this.#localStream.addTrack(track);

      this.#mesh?.setLocalTrack('video', track);
      this.#localState = { ...this.#localState, video: true, screen: true };
      this.#patchParticipant('local', { stream: this.#localStream });
      this.#pushState();

      // The browser's own "Stop sharing" bar bypasses our UI entirely.
      track.addEventListener('ended', () => this.#stopScreenShare());
    } catch (error) {
      const mediaError = error instanceof MediaError ? error : describeMediaError(error);
      if (mediaError.kind !== 'permission-denied') this.#notify('error', mediaError.message);
    }
  };

  #stopScreenShare(): void {
    if (!this.#localState.screen) return;

    const screenTrack = this.#localStream?.getVideoTracks()[0];
    if (screenTrack) {
      screenTrack.stop();
      this.#localStream?.removeTrack(screenTrack);
    }
    stopStream(this.#screenStream);
    this.#screenStream = null;

    const camera = this.#parkedCameraTrack;
    this.#parkedCameraTrack = null;

    if (camera && camera.readyState === 'live') {
      this.#localStream?.addTrack(camera);
      this.#mesh?.setLocalTrack('video', camera);
      this.#localState = { ...this.#localState, video: true, screen: false };
    } else {
      this.#mesh?.setLocalTrack('video', null);
      this.#localState = { ...this.#localState, video: false, screen: false };
    }

    this.#patchParticipant('local', { stream: this.#localStream });
    this.#pushState();
  }

  async switchDevice(kind: 'camera' | 'microphone', deviceId: string): Promise<void> {
    try {
      const { stream } = await acquireLocalMedia({
        audio: kind === 'microphone',
        video: kind === 'camera',
        ...(kind === 'camera' ? { cameraId: deviceId } : { microphoneId: deviceId }),
      });

      const next = kind === 'camera' ? stream.getVideoTracks()[0] : stream.getAudioTracks()[0];
      if (!next) return;

      this.#localStream ??= new MediaStream();
      const previous =
        kind === 'camera'
          ? this.#localStream.getVideoTracks()[0]
          : this.#localStream.getAudioTracks()[0];
      if (previous) {
        previous.stop();
        this.#localStream.removeTrack(previous);
      }
      this.#localStream.addTrack(next);
      this.#watchLocalTrack(next, kind === 'camera' ? 'video' : 'audio');
      this.#mesh?.setLocalTrack(kind === 'camera' ? 'video' : 'audio', next);

      if (kind === 'microphone') this.#meter.attach('local', this.#localStream);

      this.#set(kind === 'camera' ? { cameraId: deviceId } : { microphoneId: deviceId });
      this.#patchParticipant('local', { stream: this.#localStream });
      this.#notify('success', `Switched ${kind}`);
    } catch (error) {
      this.#notify('error', describeMediaError(error).message);
    }
  }

  /**
   * Swaps between front and back camera on phones. A fresh track is acquired
   * with the opposite facingMode and published via replaceTrack, so remote
   * peers see the switch with no renegotiation.
   */
  flipCamera = async (): Promise<void> => {
    if (this.#localState.screen) {
      this.#notify('info', 'Stop sharing your screen to flip the camera.');
      return;
    }
    const next = this.#state.facing === 'user' ? 'environment' : 'user';
    try {
      const { stream } = await acquireLocalMedia({ audio: false, video: true, facing: next });
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error('no video track');

      const previous = this.#localStream?.getVideoTracks()[0];
      if (previous) {
        previous.stop();
        this.#localStream?.removeTrack(previous);
      }
      this.#localStream ??= new MediaStream();
      this.#localStream.addTrack(track);
      this.#watchLocalTrack(track, 'video');
      this.#mesh?.setLocalTrack('video', track);

      this.#localState = { ...this.#localState, video: true };
      // The flip owns camera selection now; a stale deviceId would win over
      // facingMode on the next acquisition.
      this.#set({ facing: next, cameraId: null });
      this.#patchParticipant('local', { stream: this.#localStream });
      this.#pushState();
    } catch (error) {
      this.#notify('error', describeMediaError(error).message);
    }
  };

  async #refreshDevices(): Promise<void> {
    try {
      this.#set({ devices: await listDevices() });
    } catch {
      // Enumeration failures are non-fatal; the call still works on defaults.
    }
  }

  // -------------------------------------------------------------------------
  // Chat
  // -------------------------------------------------------------------------

  sendChat = (text: string): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    this.#signaling.send({ type: 'chat', text: trimmed.slice(0, LIMITS.chatText.max) });
  };

  sendReaction = (emoji: string): void => {
    this.#signaling.send({ type: 'reaction', emoji });
  };

  sendInk = (stroke: string, points: InkPoint[], done: boolean): void => {
    if (points.length === 0 && !done) return;
    this.#signaling.send({ type: 'ink', stroke, points, done });
  };

  /** Registers a listener for remote ink. Returns the unsubscribe. */
  onInk = (handler: (event: InkEvent) => void): (() => void) => {
    this.#inkHandlers.add(handler);
    return () => this.#inkHandlers.delete(handler);
  };

  setChatVisible = (visible: boolean): void => {
    this.#chatVisible = visible;
    if (visible) this.#set({ unread: 0 });
  };

  // -------------------------------------------------------------------------
  // Timers
  // -------------------------------------------------------------------------

  #startTimers(): void {
    this.#meterTimer ??= setInterval(() => {
      const samples = this.#meter.sample();
      let dirty = false;
      const participants = this.#state.participants.map((participant) => {
        const key = participant.isLocal ? 'local' : participant.id;
        const sample = samples.get(key);
        if (!sample) {
          if (participant.speaking || participant.level > 0.01) {
            dirty = true;
            return { ...participant, speaking: false, level: 0 };
          }
          return participant;
        }
        // Muted participants never register as speaking, whatever the meter says.
        const speaking = sample.speaking && participant.state.audio;
        if (
          speaking !== participant.speaking ||
          Math.abs(sample.level - participant.level) > 0.08
        ) {
          dirty = true;
          return { ...participant, speaking, level: sample.level };
        }
        return participant;
      });
      if (dirty) this.#set({ participants });

      // Active-speaker election. Only remote peers compete (you never need to
      // watch yourself), the first voice wins instantly, and after that a new
      // voice must hold the floor for ~1.1s before the focus moves — so brief
      // "mm-hm"s never yank the camera around.
      let loudest: Participant | null = null;
      for (const participant of participants) {
        if (participant.isLocal || !participant.speaking) continue;
        if (!loudest || participant.level > loudest.level) loudest = participant;
      }
      if (loudest) {
        if (loudest.id === this.#state.activeSpeakerId) {
          this.#speakerCandidate = null;
        } else if (this.#state.activeSpeakerId === null) {
          this.#set({ activeSpeakerId: loudest.id });
        } else if (this.#speakerCandidate === loudest.id) {
          if (Date.now() - this.#speakerCandidateSince >= 1100) {
            this.#speakerCandidate = null;
            this.#set({ activeSpeakerId: loudest.id });
          }
        } else {
          this.#speakerCandidate = loudest.id;
          this.#speakerCandidateSince = Date.now();
        }
      }
    }, 150);

    this.#qualityTimer ??= setInterval(() => {
      void (async () => {
        const mesh = this.#mesh;
        if (!mesh) return;
        const quality = await mesh.sampleQuality();
        let dirty = false;
        const participants = this.#state.participants.map((participant) => {
          const next = quality.get(participant.id);
          if (!next) return participant;
          if (next.level !== participant.quality?.level) {
            dirty = true;
            return { ...participant, quality: next };
          }
          return participant;
        });
        if (dirty) this.#set({ participants });
        this.#set({ latencyMs: this.#signaling.latencyMs });
      })();
    }, 5000);
  }

  #stopTimers(): void {
    if (this.#meterTimer) clearInterval(this.#meterTimer);
    if (this.#qualityTimer) clearInterval(this.#qualityTimer);
    this.#meterTimer = null;
    this.#qualityTimer = null;
  }

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------

  #teardown(): void {
    this.#stopTimers();
    if (this.#reconnectSurfaceTimer) clearTimeout(this.#reconnectSurfaceTimer);
    if (this.#joinRetryTimer) clearTimeout(this.#joinRetryTimer);
    this.#reconnectSurfaceTimer = null;
    this.#joinRetryTimer = null;
    this.#outage = false;
    this.#mesh?.close();
    this.#mesh = null;
    stopStream(this.#localStream);
    stopStream(this.#screenStream);
    this.#localStream = null;
    this.#screenStream = null;
    this.#parkedCameraTrack = null;
    this.#meter.close();
    for (const unsubscribe of this.#unsubscribers.splice(0)) unsubscribe();
  }

  leave = (): void => {
    this.#signaling.setJoinFactory(null);
    this.#signaling.close();
    this.#teardown();
    this.#set({ status: 'left', participants: [], selfId: null });
  };

  dispose(): void {
    this.#signaling.setJoinFactory(null);
    this.#signaling.close();
    this.#teardown();
  }
}
