import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { LIMITS, formatRoomCode, normalizeRoomCode } from '@shared/protocol';
import { Button } from '@/components/ui/Button';
import { CameraIcon, LockIcon, ScreenIcon, VideoLogo } from '@/components/Icons';
import { cn } from '@/lib/utils';

/** Client-side room code generator, matching the server's alphabet. */
function generateRoomCode(length = 8): string {
  const alphabet = '23456789abcdefghjkmnpqrstuvwxyz';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += alphabet[byte % alphabet.length];
  return out;
}

export function Home() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const start = () => navigate(`/r/${generateRoomCode()}`);

  const join = (event: FormEvent) => {
    event.preventDefault();
    const normalized = normalizeRoomCode(code);
    if (normalized.length < LIMITS.roomCode.min) {
      setError(`Room codes are at least ${LIMITS.roomCode.min} characters.`);
      return;
    }
    if (!/^[a-z0-9]+$/.test(normalized)) {
      setError('Room codes use letters and numbers only.');
      return;
    }
    navigate(`/r/${normalized}`);
  };

  return (
    <main className="aurora relative flex min-h-dvh flex-col">
      <header className="flex items-center justify-between px-6 py-5 sm:px-10">
        <div className="flex items-center gap-2.5">
          <VideoLogo className="h-6 w-6 text-accent" />
          <span className="text-lg font-semibold tracking-tight">VChat</span>
        </div>
        <a
          href="https://github.com/rishabhshuklax/VChat"
          target="_blank"
          rel="noreferrer noopener"
          className="text-sm text-ink-muted transition-colors hover:text-ink"
        >
          Source
        </a>
      </header>

      <div className="flex flex-1 items-center justify-center px-6 py-10 sm:px-10">
        <div className="w-full max-w-5xl">
          <div className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
            <div className="animate-rise">
              <p className="mb-4 inline-flex items-center gap-2 rounded-full border border-line bg-surface/60 px-3 py-1 text-xs font-medium text-ink-muted backdrop-blur">
                <span className="h-1.5 w-1.5 rounded-full bg-positive" />
                Peer-to-peer · no accounts · nothing recorded
              </p>

              <h1 className="text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
                Video calls that
                <span className="bg-gradient-to-r from-accent-bright to-[#5eb0ff] bg-clip-text text-transparent">
                  {' '}
                  just work
                </span>
                .
              </h1>

              <p className="mt-5 max-w-md text-base leading-relaxed text-ink-muted text-pretty">
                Share a link, talk face to face. Video and audio travel directly between
                participants — the server only introduces you.
              </p>

              <ul className="mt-8 grid gap-3 sm:grid-cols-3">
                {[
                  { icon: CameraIcon, label: 'HD video', detail: 'Up to 8 people' },
                  { icon: ScreenIcon, label: 'Screen share', detail: 'One click' },
                  { icon: LockIcon, label: 'Encrypted', detail: 'DTLS-SRTP' },
                ].map((feature) => (
                  <li
                    key={feature.label}
                    className="rounded-xl border border-line bg-surface/50 p-3 backdrop-blur"
                  >
                    <feature.icon className="mb-2 h-4 w-4 text-accent" />
                    <p className="text-sm font-medium">{feature.label}</p>
                    <p className="text-xs text-ink-faint">{feature.detail}</p>
                  </li>
                ))}
              </ul>
            </div>

            <div
              className="glass rounded-2xl border border-line p-6 shadow-2xl animate-rise sm:p-8"
              style={{ animationDelay: '80ms', animationFillMode: 'backwards' }}
            >
              <h2 className="text-lg font-semibold">Start or join a call</h2>
              <p className="mt-1 text-sm text-ink-muted">No download, no sign-up.</p>

              <Button variant="primary" size="lg" onClick={start} className="mt-6 w-full">
                <VideoLogo className="h-5 w-5" />
                New meeting
              </Button>

              <div className="my-6 flex items-center gap-3">
                <span className="h-px flex-1 bg-line" />
                <span className="text-xs font-medium text-ink-faint">OR JOIN ONE</span>
                <span className="h-px flex-1 bg-line" />
              </div>

              <form onSubmit={join} noValidate>
                <label
                  htmlFor="room-code"
                  className="mb-1.5 block text-xs font-medium text-ink-muted"
                >
                  Room code
                </label>
                <input
                  id="room-code"
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value);
                    setError(null);
                  }}
                  placeholder="abcd-efgh"
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  aria-invalid={error !== null}
                  aria-describedby={error ? 'room-code-error' : undefined}
                  className={cn(
                    'w-full rounded-xl border bg-surface-2 px-4 py-3 font-mono text-base tracking-wider',
                    'placeholder:text-ink-faint/60 focus:outline-none',
                    error ? 'border-danger' : 'border-line focus:border-accent',
                  )}
                />
                {error && (
                  <p id="room-code-error" className="mt-2 text-xs text-danger">
                    {error}
                  </p>
                )}
                <Button
                  type="submit"
                  size="lg"
                  disabled={normalizeRoomCode(code).length === 0}
                  className="mt-3 w-full"
                >
                  Join {code.trim() && `“${formatRoomCode(code)}”`}
                </Button>
              </form>
            </div>
          </div>
        </div>
      </div>

      <footer className="px-6 pb-6 text-center text-xs text-ink-faint sm:px-10">
        Media is encrypted end to end between participants and never touches the server.
      </footer>
    </main>
  );
}
