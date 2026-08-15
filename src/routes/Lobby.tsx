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
import { avatarGradient, cn, copyText, initials } from '@/lib/utils';

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

  return (
    <main className="aurora flex min-h-dvh flex-col items-center justify-center px-5 py-8">
      <div className="mb-8 flex items-center gap-2.5">
        <VideoLogo className="h-6 w-6 text-accent" />
        <span className="text-lg font-semibold tracking-tight">VChat</span>
      </div>

      <div className="grid w-full max-w-4xl gap-6 lg:grid-cols-[1.25fr_1fr]">
        {/* Preview */}
        <div className="relative aspect-video overflow-hidden rounded-2xl border border-line bg-surface">
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
                className="flex h-20 w-20 items-center justify-center rounded-full text-2xl font-semibold text-white"
                style={{ background: avatarGradient(name || roomId) }}
              >
                {initials(name || '?')}
              </div>
              <p className="max-w-[32ch] px-4 text-center text-sm text-ink-muted">
                {mediaError ?? 'Your camera is off'}
              </p>
            </div>
          )}

          <div className="absolute inset-x-0 bottom-0 flex justify-center gap-3 bg-gradient-to-t from-black/70 to-transparent p-4 pt-10">
            <button
              type="button"
              onClick={() => setAudio((on) => !on)}
              aria-pressed={audio}
              aria-label={audio ? 'Join muted' : 'Join with microphone on'}
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-full transition-colors',
                audio
                  ? 'bg-white/15 text-white hover:bg-white/25'
                  : 'bg-danger text-white hover:brightness-110',
              )}
            >
              {audio ? <MicIcon className="h-5 w-5" /> : <MicOffIcon className="h-5 w-5" />}
            </button>
            <button
              type="button"
              onClick={() => setVideo((on) => !on)}
              aria-pressed={video}
              aria-label={video ? 'Join with camera off' : 'Join with camera on'}
              className={cn(
                'flex h-11 w-11 items-center justify-center rounded-full transition-colors',
                video
                  ? 'bg-white/15 text-white hover:bg-white/25'
                  : 'bg-danger text-white hover:brightness-110',
              )}
            >
              {video ? <CameraIcon className="h-5 w-5" /> : <CameraOffIcon className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {/* Join form */}
        <form
          onSubmit={submit}
          className="glass flex flex-col rounded-2xl border border-line p-6 shadow-xl"
        >
          <h1 className="text-xl font-semibold tracking-tight">Ready to join?</h1>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-ink-muted">
            Room
            <code className="font-mono tracking-wider text-ink">{formatRoomCode(roomId)}</code>
            <button
              type="button"
              onClick={() => {
                void copyText(shareUrl).then((ok) => {
                  if (!ok) return;
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                });
              }}
              className="inline-flex items-center gap-1 text-xs text-accent-bright transition-opacity hover:opacity-80"
            >
              {copied ? <CheckIcon className="h-3 w-3" /> : <CopyIcon className="h-3 w-3" />}
              {copied ? 'Copied' : 'Copy link'}
            </button>
          </p>

          <div className="mt-5">
            <label
              htmlFor="display-name"
              className="mb-1.5 block text-xs font-medium text-ink-muted"
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
              className="w-full rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm focus:border-accent focus:outline-none"
            />
          </div>

          {requiresPassword && (
            <div className="mt-4">
              <label
                htmlFor="room-password"
                className="mb-1.5 block text-xs font-medium text-ink-muted"
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
                className="w-full rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm focus:border-accent focus:outline-none"
              />
            </div>
          )}

          {!requiresPassword && (
            <details className="mt-4 text-sm">
              <summary className="cursor-pointer list-none text-xs font-medium text-ink-muted transition-colors hover:text-ink">
                Set a password (optional) ›
              </summary>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                maxLength={LIMITS.password.max}
                placeholder="Anyone joining will need this"
                autoComplete="new-password"
                className="mt-2 w-full rounded-xl border border-line bg-surface-2 px-4 py-3 text-sm focus:border-accent focus:outline-none"
              />
              <p className="mt-1.5 text-xs text-ink-faint">
                The first person to join sets the password for the room.
              </p>
            </details>
          )}

          <details className="mt-4">
            <summary className="cursor-pointer list-none text-xs font-medium text-ink-muted transition-colors hover:text-ink">
              Camera &amp; microphone ›
            </summary>
            <div className="mt-3">
              <DeviceSelect
                label="Camera"
                options={devices.cameras}
                value={cameraId}
                onChange={setCameraId}
              />
              <DeviceSelect
                label="Microphone"
                options={devices.microphones}
                value={microphoneId}
                onChange={setMicrophoneId}
              />
            </div>
          </details>

          {error && (
            <p
              role="alert"
              className="mt-4 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2.5 text-sm text-danger"
            >
              {error}
            </p>
          )}

          <Button
            type="submit"
            variant="primary"
            size="lg"
            disabled={!name.trim() || busy}
            className="mt-5 w-full"
          >
            {busy ? 'Joining…' : 'Join now'}
          </Button>
        </form>
      </div>
    </main>
  );
}
