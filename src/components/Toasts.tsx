import type { Notice } from '@/lib/call-engine';
import { cn } from '@/lib/utils';
import { CloseIcon } from './Icons';

interface ToastsProps {
  notices: Notice[];
  onDismiss: (id: string) => void;
}

const TONE: Record<Notice['kind'], string> = {
  info: 'border-line text-ink',
  success: 'border-positive/40 text-positive',
  warning: 'border-caution/40 text-caution',
  error: 'border-danger/40 text-danger',
};

export function Toasts({ notices, onDismiss }: ToastsProps) {
  if (notices.length === 0) return null;

  return (
    <div
      // Announced politely so a screen reader hears "Ana joined" without
      // interrupting whatever it is currently reading.
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed top-4 left-1/2 z-50 flex w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2"
    >
      {notices.slice(-4).map((notice) => (
        <div
          key={notice.id}
          className={cn(
            'glass pointer-events-auto flex items-center gap-3 rounded-xl border px-4 py-3 shadow-xl animate-rise',
            TONE[notice.kind],
          )}
        >
          <p className="flex-1 text-sm">{notice.text}</p>
          <button
            type="button"
            onClick={() => onDismiss(notice.id)}
            aria-label="Dismiss"
            className="shrink-0 text-current opacity-50 transition-opacity hover:opacity-100"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
