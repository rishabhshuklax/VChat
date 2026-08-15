import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';

import { LIMITS, normalizeRoomCode } from '@shared/protocol';
import { ArrowRightIcon, LockIcon, PeopleIcon, ScreenIcon, VideoLogo } from '@/components/Icons';
import { Button } from '@/components/ui/Button';
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

const TICKER = [
  'No sign-up',
  'End-to-end encrypted',
  'Up to 8 people',
  'Screen sharing',
  'Live reactions',
  'Runs in your browser',
  'Nothing recorded',
  'Open source',
];

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
    <main className="scheme-light grain relative flex min-h-dvh flex-col bg-paper text-soot">
      <header className="flex items-center justify-between px-5 py-5 sm:px-8">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-soot">
            <VideoLogo className="h-4 w-4 text-accent" />
          </span>
          <span className="text-lg font-semibold tracking-tight">VChat</span>
        </div>
        <a
          href="https://github.com/rishabhshuklax/VChat"
          target="_blank"
          rel="noreferrer noopener"
          className="text-sm text-soot-muted underline-offset-4 transition-colors hover:text-soot hover:underline"
        >
          Source
        </a>
      </header>

      <section className="relative mx-auto flex w-full max-w-4xl flex-1 flex-col justify-center px-5 py-10 sm:px-8">
        {/* Editorial ornament — a slowly turning asterisk, nothing more. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-2 right-2 animate-spin-slow font-display text-[7rem] leading-none text-accent select-none sm:top-6 sm:right-10 sm:text-[11rem]"
        >
          ✳
        </span>

        <p
          className="flex animate-rise items-center gap-2 font-mono text-[11px] tracking-[0.22em] uppercase"
          style={{ animationDelay: '0ms' }}
        >
          <span className="h-2 w-2 bg-accent" />
          Peer-to-peer video calls
        </p>

        <h1
          className="mt-5 max-w-[13ch] animate-rise font-display text-[clamp(3.1rem,12vw,7rem)] leading-[0.92] tracking-tight text-balance"
          style={{ animationDelay: '70ms' }}
        >
          Face to face, in{' '}
          <span className="inline-block -rotate-1 rounded-lg bg-accent px-3 italic">
            eight seconds.
          </span>
        </h1>

        <p
          className="mt-6 max-w-md animate-rise text-lg leading-relaxed text-pretty text-soot-muted"
          style={{ animationDelay: '140ms' }}
        >
          One link, no accounts, nothing installed. Your video travels browser-to-browser — the
          server only makes the introduction.
        </p>

        <div
          className="mt-9 flex animate-rise flex-col gap-5 sm:flex-row sm:items-center"
          style={{ animationDelay: '210ms' }}
        >
          <Button variant="accent" size="xl" onClick={start} className="w-full sm:w-auto">
            <VideoLogo className="h-5 w-5" />
            Start a call
          </Button>

          <form onSubmit={join} noValidate className="flex-1 sm:max-w-xs">
            <label
              htmlFor="room-code"
              className="mb-1.5 block font-mono text-[11px] tracking-[0.18em] text-soot-muted uppercase"
            >
              Have a code?
            </label>
            <div className="flex items-center gap-2">
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
                  'h-13 w-full rounded-full border bg-white/60 px-5 font-mono text-base tracking-wider',
                  'placeholder:text-soot-faint/70 focus:outline-none',
                  error ? 'border-danger' : 'border-soot/20 focus:border-soot',
                )}
              />
              <button
                type="submit"
                aria-label="Join room"
                disabled={normalizeRoomCode(code).length === 0}
                className="flex h-13 w-13 shrink-0 items-center justify-center rounded-full bg-soot text-paper transition-all duration-200 [transition-timing-function:var(--ease-spring)] hover:scale-105 active:scale-90 disabled:pointer-events-none disabled:opacity-30"
              >
                <ArrowRightIcon className="h-5 w-5" />
              </button>
            </div>
            {error && (
              <p id="room-code-error" className="mt-2 text-xs text-danger">
                {error}
              </p>
            )}
          </form>
        </div>

        <dl
          className="mt-12 flex animate-rise flex-wrap gap-x-8 gap-y-3"
          style={{ animationDelay: '280ms' }}
        >
          {[
            { icon: LockIcon, term: 'DTLS-SRTP', detail: 'encrypted end to end' },
            { icon: PeopleIcon, term: 'Up to 8', detail: 'full mesh, no server mix' },
            { icon: ScreenIcon, term: 'One click', detail: 'to share your screen' },
          ].map((item) => (
            <div key={item.term} className="flex items-center gap-2.5">
              <item.icon className="h-4 w-4 text-soot-muted" />
              <dt className="font-mono text-xs font-bold tracking-wide">{item.term}</dt>
              <dd className="text-xs text-soot-muted">{item.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <footer className="border-t border-soot/10 py-4">
        <div className="marquee" aria-hidden="true">
          <div className="marquee-track font-mono text-[11px] tracking-[0.22em] text-soot-muted uppercase">
            {[...TICKER, ...TICKER].map((item, index) => (
              <span key={index} className="flex items-center">
                <span className="px-5">{item}</span>
                <span className="text-accent-deep">✳</span>
              </span>
            ))}
          </div>
        </div>
      </footer>
    </main>
  );
}
