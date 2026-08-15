import { useEffect, useRef, useState, type FormEvent } from 'react';

import { LIMITS, formatRoomCode } from '@shared/protocol';
import { DeviceSelect } from '@/components/ControlBar';
import {
  CameraIcon,
  CameraOffIcon,
  CheckIcon,
  CopyIcon,
  MicIcon,
  MicOffIcon,
  VideoLogo,
} from '@/components/Icons';
import { Button } from '@/components/ui/Button';
import {
  acquireLocalMedia,
  describeMediaError,
  listDevices,
  stopStream,
  type DeviceList,
} from '@/lib/media';
import { avatarColor, cn, copyText, initials } from '@/lib/utils';

export interface LobbyResult {
  name: string;
  audio: boolean;
  video: boolean;
  cameraId: string | null;
  microphoneId: string | null;
  password: string;
}

interface LobbyProps {
  roomId: string;
  /** Set when a previous join attempt was rejected, e.g. a wrong password. */
  error: string | null;
  requiresPassword: boolean;
  busy: boolean;
  onJoin: (result: LobbyResult) => void;
}

const NAME_KEY = 'vchat:name';

/**
 * Pre-join screen.
 *
 * Letting people see themselves, pick devices, and arrive muted *before*
 * entering is the single biggest UX difference between a call app that feels
 * considered and one that does not. It also front-loads the permission prompt,
 * so a denial is recoverable outside the call.
 */
export function Lobby({ roomId, error, requiresPassword, busy, onJoin }: LobbyProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? '');
  const [audio, setAudio] = useState(true);
  const [video, setVideo] = useState(true);
  const [devices, setDevices] = useState<DeviceList>({
    cameras: [],
    microphones: [],
    speakers: [],
  });
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [microphoneId, setMicrophoneId] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Re-acquire the preview whenever the camera selection or toggle changes.
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      stopStream(streamRef.current);
      streamRef.current = null;

      if (!video) {
        if (videoRef.current) videoRef.current.srcObject = null;
        return;
      }

      try {
        const { stream, errors } = await acquireLocalMedia({
          audio: false,
          video: true,
          cameraId: cameraId ?? undefined,
        });
        if (cancelled) {
          stopStream(stream);
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) videoRef.current.srcObject = stream;
        setMediaError(errors[0]?.message ?? null);
        setDevices(await listDevices());
      } catch (caught) {
        if (!cancelled) setMediaError(describeMediaError(caught).message);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [video, cameraId]);

  // Release the preview when leaving the lobby, so the call's own request does
  // not collide with a device this page still holds.
  useEffect(
    () => () => {
      stopStream(streamRef.current);
      streamRef.current = null;
    },
    [],
  );

  useEffect(() => {
    void listDevices().then(setDevices);
  }, []);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;

    localStorage.setItem(NAME_KEY, trimmed);
    stopStream(streamRef.current);
    streamRef.current = null;

    onJoin({ name: trimmed, audio, video, cameraId, microphoneId, password });
  };

  const shareUrl = `${window.location.origin}/r/${roomId}`;

  const previewToggle = (
    on: boolean,
    toggle: () => void,
    OnIcon: typeof MicIcon,
    OffIcon: typeof MicOffIcon,
    labelOn: string,
    labelOff: string,
  ) => (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={on}
      aria-label={on ? labelOn : labelOff}
      className={cn(
        'flex h-12 w-12 items-center justify-center rounded-full backdrop-blur-md',
        'transition-all duration-200 [transition-timing-function:var(--ease-spring)] hover:scale-105 active:scale-90',
        on ? 'bg-white/15 text-white hover:bg-white/25' : 'bg-danger text-white',
      )}
    >
      {on ? <OnIcon className="h-5 w-5" /> : <OffIcon className="h-5 w-5" />}
    </button>
  );

  return (
    <main className="scheme-light grain flex min-h-dvh flex-col bg-paper text-soot">
      <header className="flex items-center gap-2.5 px-5 py-5 sm:px-8">
        <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-soot">
          <VideoLogo className="h-4 w-4 text-accent" />
        </span>
        <span className="text-lg font-semibold tracking-tight">VChat</span>
      </header>

      <div className="mx-auto grid w-full max-w-5xl flex-1 content-center gap-6 px-5 pb-10 sm:px-8 lg:grid-cols-[1.25fr_1fr] lg:gap-10">
        {/* Preview */}
        <div
          className="relative animate-rise overflow-hidden rounded-[1.75rem] bg-soot shadow-2xl max-lg:h-[42dvh] lg:aspect-video"
          style={{ animationDelay: '60ms' }}
        >
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={cn(
              'h-full w-full scale-x-[-1] object-cover transition-opacity duration-300',
              video && !mediaError ? 'opacity-100' : 'opacity-0',
            )}
          />

          {(!video || mediaError) && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <div
                className="flex h-20 w-20 items-center justify-center rounded-full font-display text-3xl text-ink"
                style={{ background: avatarColor(name || roomId) }}
              >
                {initials(name || '?')}
              </div>
              <p className="max-w-[30ch] px-4 text-center text-sm text-ink-muted">
                {mediaError ?? 'Your camera is off'}
              </p>
            </div>
          )}

          <div className="absolute inset-x-0 bottom-0 flex justify-center gap-3 bg-gradient-to-t from-black/70 to-transparent p-4 pt-12">
            {previewToggle(
              audio,
              () => setAudio((v) => !v),
              MicIcon,
              MicOffIcon,
              'Join muted',
              'Join with microphone on',
            )}
            {previewToggle(
              video,
              () => setVideo((v) => !v),
              CameraIcon,
              CameraOffIcon,
              'Join with camera off',
              'Join with camera on',
            )}
          </div>
        </div>

        {/* Join form */}
        <form
          onSubmit={submit}
          className="flex animate-rise flex-col justify-center"
          style={{ animationDelay: '130ms' }}
        >
          <h1 className="font-display text-4xl tracking-tight sm:text-5xl">Ready when you are.</h1>

          <p className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-soot-muted">
            Room
            <code className="font-mono font-bold tracking-wider text-soot">
              {formatRoomCode(roomId)}
            </code>
            <button
              type="button"
              onClick={() => {
                void copyText(shareUrl).then((ok) => {
                  if (!ok) return;
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
              className="inline-flex items-center gap-1 rounded-full bg-soot/5 px-2.5 py-1 text-xs font-medium transition-colors hover:bg-soot/10"
            >
              {copied ? <CheckIcon className="h-3 w-3" /> : <CopyIcon className="h-3 w-3" />}
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </p>

          <div className="mt-6">
            <label
              htmlFor="display-name"
              className="mb-1.5 block font-mono text-[11px] tracking-[0.18em] text-soot-muted uppercase"
            >
              Your name
            </label>
            <input
              id="display-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={LIMITS.displayName.max}
              placeholder="Ada Lovelace"
              autoComplete="name"
              autoFocus
              required
              className="w-full rounded-2xl border border-soot/20 bg-white/60 px-4 py-3.5 text-base focus:border-soot focus:outline-none"
            />
          </div>

          {requiresPassword ? (
            <div className="mt-4">
              <label
                htmlFor="room-password"
                className="mb-1.5 block font-mono text-[11px] tracking-[0.18em] text-soot-muted uppercase"
              >
                Room password
              </label>
              <input
                id="room-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                maxLength={LIMITS.password.max}
                placeholder="Required for this room"
                autoComplete="current-password"
                className="w-full rounded-2xl border border-soot/20 bg-white/60 px-4 py-3.5 text-base focus:border-soot focus:outline-none"
              />
            </div>
          ) : (
            <details className="mt-4">
              <summary className="cursor-pointer list-none font-mono text-[11px] tracking-[0.18em] text-soot-muted uppercase transition-colors hover:text-soot">
                Set a password · optional ›
              </summary>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                maxLength={LIMITS.password.max}
                placeholder="Anyone joining will need this"
                autoComplete="new-password"
                className="mt-2 w-full rounded-2xl border border-soot/20 bg-white/60 px-4 py-3 text-sm focus:border-soot focus:outline-none"
              />
              <p className="mt-1.5 text-xs text-soot-faint">
                The first person to join sets the password for the room.
              </p>
            </details>
          )}

          <details className="mt-4">
            <summary className="cursor-pointer list-none font-mono text-[11px] tracking-[0.18em] text-soot-muted uppercase transition-colors hover:text-soot">
              Camera &amp; microphone ›
            </summary>
            <div className="mt-3">
              <DeviceSelect
                label="Camera"
                tone="light"
                options={devices.cameras}
                value={cameraId}
                onChange={setCameraId}
              />
              <DeviceSelect
                label="Microphone"
                tone="light"
                options={devices.microphones}
                value={microphoneId}
                onChange={setMicrophoneId}
              />
            </div>
          </details>

          {error && (
            <p
              role="alert"
              className="mt-4 animate-pop rounded-2xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger"
            >
              {error}
            </p>
          )}

          <Button
            type="submit"
            variant="accent"
            size="lg"
            disabled={!name.trim() || busy}
            className="mt-6 w-full"
          >
            {busy ? 'Joining…' : 'Join now'}
          </Button>
        </form>
      </div>
    </main>
  );
}
