/**
 * The WebRTC mesh: one RTCPeerConnection per remote participant.
 *
 * Two decisions carry most of the reliability here:
 *
 *  1. **Perfect negotiation.** Both sides may try to offer at the same moment
 *     ("glare"). Rather than inventing a turn-taking scheme, each connection
 *     designates one side polite purely from the two peer ids, and follows the
 *     WHATWG/MDN algorithm. Renegotiation then works from either side at any
 *     time, which is what makes mid-call device switching and screen sharing
 *     safe.
 *     @see https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Perfect_negotiation
 *
 *  2. **Fixed transceivers.** Each connection creates its audio and video
 *     transceivers up front, before any track exists. The m-line layout is then
 *     stable for the life of the call, so turning a camera on, switching
 *     cameras, or starting a screen share is a `replaceTrack()` on an existing
 *     sender — no renegotiation, no black-frame gap, and it works even for
 *     someone who joined with their camera off.
 */
import { isPolite, type SignalPayload } from '@shared/protocol';

export interface MeshEvents {
  /** A remote stream became available or changed. */
  onStream: (peerId: string, stream: MediaStream) => void;
  onConnectionState: (peerId: string, state: RTCPeerConnectionState) => void;
  /**
   * The remote video track stopped or resumed delivering frames — network
   * starvation, not departure. The UI softens the frozen frame instead of
   * pretending nothing is wrong.
   */
  onInterruption: (peerId: string, interrupted: boolean) => void;
  sendSignal: (to: string, payload: SignalPayload) => void;
}

interface PeerEntry {
  pc: RTCPeerConnection;
  stream: MediaStream;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  settingRemoteAnswerPending: boolean;
  audioSender: RTCRtpSender;
  videoSender: RTCRtpSender;
  /** Candidates that arrived before the remote description was applied. */
  pendingCandidates: RTCIceCandidateInit[];
  /** Escalation timers: nudge a wobbly connection, rebuild a dead one. */
  timers: { disconnected?: ReturnType<typeof setTimeout>; failed?: ReturnType<typeof setTimeout> };
}

export class PeerMesh {
  readonly #peers = new Map<string, PeerEntry>();
  readonly #events: MeshEvents;
  readonly #iceServers: RTCIceServer[];
  #selfId: string;
  #audioTrack: MediaStreamTrack | null = null;
  #videoTrack: MediaStreamTrack | null = null;

  constructor(selfId: string, iceServers: RTCIceServer[], events: MeshEvents) {
    this.#selfId = selfId;
    this.#iceServers = iceServers;
    this.#events = events;
  }

  get peerIds(): string[] {
    return [...this.#peers.keys()];
  }

  /** Adds a peer and begins negotiation. Idempotent. */
  addPeer(peerId: string): void {
    if (this.#peers.has(peerId) || peerId === this.#selfId) return;

    const pc = new RTCPeerConnection({
      iceServers: this.#iceServers,
      // Pooling warms candidates before the first offer, shaving setup latency.
      iceCandidatePoolSize: 4,
      bundlePolicy: 'max-bundle',
    });

    const entry: PeerEntry = {
      pc,
      stream: new MediaStream(),
      polite: isPolite(this.#selfId, peerId),
      makingOffer: false,
      ignoreOffer: false,
      settingRemoteAnswerPending: false,
      // Created before any track exists so the m-line order never changes.
      audioSender: pc.addTransceiver('audio', { direction: 'sendrecv' }).sender,
      videoSender: pc.addTransceiver('video', { direction: 'sendrecv' }).sender,
      pendingCandidates: [],
      timers: {},
    };
    this.#peers.set(peerId, entry);

    void entry.audioSender.replaceTrack(this.#audioTrack);
    void entry.videoSender.replaceTrack(this.#videoTrack);

    pc.addEventListener('negotiationneeded', () => {
      void (async () => {
        try {
          entry.makingOffer = true;
          await pc.setLocalDescription();
          if (!pc.localDescription) return;
          this.#events.sendSignal(peerId, {
            kind: 'description',
            description: {
              type: pc.localDescription.type,
              sdp: pc.localDescription.sdp,
            },
          });
        } catch (error) {
          console.error('[mesh] negotiation failed', error);
        } finally {
          entry.makingOffer = false;
        }
      })();
    });

    pc.addEventListener('icecandidate', ({ candidate }) => {
      if (!candidate) return;
      this.#events.sendSignal(peerId, {
        kind: 'candidate',
        candidate: {
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
          usernameFragment: candidate.usernameFragment,
        },
      });
    });

    pc.addEventListener('track', (event) => {
      // Transceiver-based connections do not always carry a stream, so the
      // remote stream is assembled here rather than taken from the event.
      if (!entry.stream.getTracks().includes(event.track)) {
        entry.stream.addTrack(event.track);
      }
      event.track.addEventListener('ended', () => {
        entry.stream.removeTrack(event.track);
        this.#events.onStream(peerId, entry.stream);
      });
      if (event.track.kind === 'video') {
        // 'mute' during an established call means frames stopped arriving.
        // (Every track also starts muted before the first packet, which is
        // why the connected-state guard matters.)
        event.track.addEventListener('mute', () => {
          if (pc.connectionState === 'connected') this.#events.onInterruption(peerId, true);
        });
        event.track.addEventListener('unmute', () => {
          this.#events.onInterruption(peerId, false);
        });
      }
      this.#events.onStream(peerId, entry.stream);
    });

    pc.addEventListener('connectionstatechange', () => {
      const state = pc.connectionState;
      this.#events.onConnectionState(peerId, state);

      // Recovery is a ladder, not a cliff:
      //   disconnected 4s  -> ICE restart (blips usually self-heal first)
      //   failed           -> ICE restart immediately
      //   failed 7s more   -> rebuild the RTCPeerConnection from scratch
      // Perfect negotiation makes each rung safe from either side.
      if (state === 'connected') {
        this.#clearTimers(entry);
        this.#events.onInterruption(peerId, false);
      } else if (state === 'disconnected') {
        entry.timers.disconnected ??= setTimeout(() => {
          entry.timers.disconnected = undefined;
          if (pc.connectionState === 'disconnected') this.#restartIce(pc);
        }, 4000);
      } else if (state === 'failed') {
        this.#restartIce(pc);
        entry.timers.failed ??= setTimeout(() => {
          entry.timers.failed = undefined;
          if (pc.connectionState === 'failed') this.#rebuild(peerId);
        }, 7000);
      }
    });
  }

  #restartIce(pc: RTCPeerConnection): void {
    try {
      pc.restartIce();
    } catch (error) {
      console.warn('[mesh] ICE restart failed', error);
    }
  }

  #clearTimers(entry: PeerEntry): void {
    if (entry.timers.disconnected) clearTimeout(entry.timers.disconnected);
    if (entry.timers.failed) clearTimeout(entry.timers.failed);
    entry.timers = {};
  }

  /** Last rung: a fresh RTCPeerConnection when ICE restarts stopped helping. */
  #rebuild(peerId: string): void {
    this.removePeer(peerId);
    this.addPeer(peerId);
  }

  /**
   * Called after the signaling channel comes back: any connection that went
   * stale while our offers and candidates could not travel gets a fresh
   * round of ICE through the restored channel.
   */
  reviveUnhealthy(): void {
    for (const entry of this.#peers.values()) {
      const state = entry.pc.connectionState;
      if (state === 'failed' || state === 'disconnected') this.#restartIce(entry.pc);
    }
  }

  removePeer(peerId: string): void {
    const entry = this.#peers.get(peerId);
    if (!entry) return;
    this.#clearTimers(entry);
    entry.pc.close();
    for (const track of entry.stream.getTracks()) entry.stream.removeTrack(track);
    this.#peers.delete(peerId);
  }

  /** Applies an inbound description or ICE candidate for one peer. */
  async handleSignal(from: string, payload: SignalPayload): Promise<void> {
    // A signal can arrive fractionally before the roster message that
    // introduces its sender; create the connection on demand.
    if (!this.#peers.has(from)) this.addPeer(from);
    const entry = this.#peers.get(from);
    if (!entry) return;

    const { pc } = entry;

    try {
      if (payload.kind === 'candidate') {
        // Candidates that beat the remote description are queued, not dropped.
        if (!pc.remoteDescription) {
          entry.pendingCandidates.push(payload.candidate);
          return;
        }
        await pc.addIceCandidate(payload.candidate);
        return;
      }

      const description = payload.description;
      const readyForOffer =
        !entry.makingOffer && (pc.signalingState === 'stable' || entry.settingRemoteAnswerPending);
      const offerCollision = description.type === 'offer' && !readyForOffer;

      entry.ignoreOffer = !entry.polite && offerCollision;
      if (entry.ignoreOffer) return;

      entry.settingRemoteAnswerPending = description.type === 'answer';
      await pc.setRemoteDescription(description as RTCSessionDescriptionInit);
      entry.settingRemoteAnswerPending = false;

      for (const candidate of entry.pendingCandidates.splice(0)) {
        await pc.addIceCandidate(candidate).catch(() => undefined);
      }

      if (description.type === 'offer') {
        await pc.setLocalDescription();
        if (!pc.localDescription) return;
        this.#events.sendSignal(from, {
          kind: 'description',
          description: { type: pc.localDescription.type, sdp: pc.localDescription.sdp },
        });
      }
    } catch (error) {
      // Errors caused by an intentionally ignored offer are expected.
      if (!entry.ignoreOffer) console.error('[mesh] failed to apply signal', error);
    }
  }

  /**
   * Publishes a new outbound track to every peer without renegotiating.
   * Passing null stops sending that kind while keeping the transceiver in place.
   */
  setLocalTrack(kind: 'audio' | 'video', track: MediaStreamTrack | null): void {
    if (kind === 'audio') this.#audioTrack = track;
    else this.#videoTrack = track;

    for (const entry of this.#peers.values()) {
      const sender = kind === 'audio' ? entry.audioSender : entry.videoSender;
      void sender.replaceTrack(track).catch((error: unknown) => {
        console.warn('[mesh] replaceTrack failed', error);
      });
    }
  }

  /** Collects a coarse connection-quality read per peer from getStats(). */
  async sampleQuality(): Promise<Map<string, PeerQuality>> {
    const results = new Map<string, PeerQuality>();
    await Promise.all(
      [...this.#peers.entries()].map(async ([peerId, entry]) => {
        try {
          results.set(peerId, await readQuality(entry.pc));
        } catch {
          // A peer that vanishes mid-sample is not an error worth surfacing.
        }
      }),
    );
    return results;
  }

  close(): void {
    for (const peerId of [...this.#peers.keys()]) this.removePeer(peerId);
  }
}

export interface PeerQuality {
  /** Round-trip time in milliseconds, when the pair reports it. */
  rttMs: number | null;
  /** Fraction of inbound packets lost, 0–1. */
  packetLoss: number;
  level: 'good' | 'fair' | 'poor';
}

async function readQuality(pc: RTCPeerConnection): Promise<PeerQuality> {
  const report = await pc.getStats();
  let rttMs: number | null = null;
  let packetsLost = 0;
  let packetsReceived = 0;

  report.forEach((stat) => {
    if (stat.type === 'candidate-pair' && (stat as RTCIceCandidatePairStats).nominated) {
      const rtt = (stat as RTCIceCandidatePairStats).currentRoundTripTime;
      if (typeof rtt === 'number') rttMs = Math.round(rtt * 1000);
    }
    if (stat.type === 'inbound-rtp') {
      const inbound = stat as RTCInboundRtpStreamStats;
      packetsLost += inbound.packetsLost ?? 0;
      packetsReceived += inbound.packetsReceived ?? 0;
    }
  });

  const total = packetsLost + packetsReceived;
  const packetLoss = total > 0 ? packetsLost / total : 0;

  const level: PeerQuality['level'] =
    packetLoss > 0.08 || (rttMs !== null && rttMs > 400)
      ? 'poor'
      : packetLoss > 0.03 || (rttMs !== null && rttMs > 200)
        ? 'fair'
        : 'good';

  return { rttMs, packetLoss, level };
}
