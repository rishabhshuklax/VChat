/**
 * Per-stream audio level metering, used for the speaking indicator and to
 * highlight the active speaker.
 *
 * One shared AudioContext serves every stream: browsers cap how many contexts a
 * page may create, and a call with several participants would otherwise hit it.
 */

const SMOOTHING = 0.75;
/** RMS above this counts as speech. Chosen to ignore keyboard and fan noise. */
const SPEAKING_THRESHOLD = 0.045;
/** Hold the speaking flag briefly so it does not strobe between syllables. */
const RELEASE_MS = 600;

interface Meter {
  analyser: AnalyserNode;
  source: MediaStreamAudioSourceNode;
  /** Explicitly backed by an ArrayBuffer: getFloatTimeDomainData rejects a SharedArrayBuffer view. */
  buffer: Float32Array<ArrayBuffer>;
  level: number;
  lastLoudAt: number;
}

export class AudioMeter {
  #context: AudioContext | null = null;
  readonly #meters = new Map<string, Meter>();

  #ensureContext(): AudioContext | null {
    if (this.#context) return this.#context;
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    try {
      this.#context = new Ctor();
      return this.#context;
    } catch {
      return null;
    }
  }

  /** Autoplay policy suspends the context until a user gesture; call on join. */
  async resume(): Promise<void> {
    const context = this.#ensureContext();
    if (context?.state === 'suspended') await context.resume().catch(() => undefined);
  }

  attach(id: string, stream: MediaStream): void {
    if (stream.getAudioTracks().length === 0) {
      this.detach(id);
      return;
    }
    const context = this.#ensureContext();
    if (!context) return;

    this.detach(id);

    try {
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      analyser.smoothingTimeConstant = SMOOTHING;
      source.connect(analyser);
      // Deliberately not connected to the destination: playback belongs to the
      // <video> element, and routing here too would double the audio.
      this.#meters.set(id, {
        analyser,
        source,
        buffer: new Float32Array(
          new ArrayBuffer(analyser.fftSize * Float32Array.BYTES_PER_ELEMENT),
        ),
        level: 0,
        lastLoudAt: 0,
      });
    } catch {
      // A stream can end between the track check and the source creation.
    }
  }

  detach(id: string): void {
    const meter = this.#meters.get(id);
    if (!meter) return;
    try {
      meter.source.disconnect();
      meter.analyser.disconnect();
    } catch {
      // Already torn down.
    }
    this.#meters.delete(id);
  }

  /** Samples every attached stream. Cheap enough to call on an animation frame. */
  sample(now = Date.now()): Map<string, { level: number; speaking: boolean }> {
    const out = new Map<string, { level: number; speaking: boolean }>();
    for (const [id, meter] of this.#meters) {
      meter.analyser.getFloatTimeDomainData(meter.buffer);

      let sum = 0;
      for (const sample of meter.buffer) sum += sample * sample;
      const rms = Math.sqrt(sum / meter.buffer.length);

      // Smooth upward slowly, downward quickly: level should track speech, not flicker.
      meter.level = Math.max(rms, meter.level * 0.8);
      if (rms > SPEAKING_THRESHOLD) meter.lastLoudAt = now;

      out.set(id, {
        level: Math.min(1, meter.level * 4),
        speaking: now - meter.lastLoudAt < RELEASE_MS,
      });
    }
    return out;
  }

  close(): void {
    for (const id of [...this.#meters.keys()]) this.detach(id);
    void this.#context?.close().catch(() => undefined);
    this.#context = null;
  }
}
