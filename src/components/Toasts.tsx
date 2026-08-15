import type { Notice } from '@/lib/call-engine';
import { cn } from '@/lib/utils';
import { CloseIcon } from './Icons';

interface ToastsProps {
  notices: Notice[];
  onDismiss: (id: string) => void;
}

const DOT: Record<Notice['kind'], string> = {
  info: 'bg-accent',
  success: 'bg-positive',
  warning: 'bg-caution',
  error: 'bg-danger',
};

export function Toasts({ notices, onDismiss }: ToastsProps) {
  if (notices.length === 0) return null;

  return (
    <div
      // Announced politely so a screen reader hears "Ana joined" without
      // interrupting whatever it is currently reading.
      role="status"
      aria-live="polite"
      // Below the room header pill, so the two never stack on top of each other.
      className="pointer-events-none fixed top-[max(4.25rem,calc(env(safe-area-inset-top)+3.5rem))] left-1/2 z-50 flex w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 flex-col items-center gap-2"
    >
      {notices.slice(-3).map((notice) => (
        <div
          key={notice.id}
          className="glass pointer-events-auto flex max-w-full animate-rise-spring items-center gap-2.5 rounded-full border border-line py-2 pr-2 pl-4 shadow-2xl"
        >
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT[notice.kind])} />
          <p className="truncate text-sm text-ink">{notice.text}</p>
          <button
            type="button"
            onClick={() => onDismiss(notice.id)}
            aria-label="Dismiss"
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-white/10 hover:text-ink"
          >
            <CloseIcon className="h-3 w-3" />
          </button>
        </div>
      ))}
    </div>
  );
}
