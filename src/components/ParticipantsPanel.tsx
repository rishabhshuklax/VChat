import { LIMITS } from '@shared/protocol';
import type { CallState } from '@/lib/call-engine';
import { avatarColor, cn, initials } from '@/lib/utils';
import { CameraOffIcon, CloseIcon, MicIcon, MicOffIcon, PeopleIcon, ScreenIcon } from './Icons';

interface ParticipantsPanelProps {
  state: CallState;
  onClose: () => void;
}

export function ParticipantsPanel({ state, onClose }: ParticipantsPanelProps) {
  return (
    <aside className="flex h-full w-full flex-col bg-surface">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <PeopleIcon className="h-4 w-4 text-ink-muted" />
          Participants
          <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs font-medium text-ink-muted">
            {state.participants.length}/{LIMITS.maxPeersPerRoom}
          </span>
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close participants"
          className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </header>

      <ul className="flex-1 overflow-y-auto p-2">
        {state.participants.map((participant) => (
          <li
            key={participant.id}
            className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-surface-2"
          >
            <div className="relative shrink-0">
              <div
                className="flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold text-white"
                style={{ background: avatarColor(participant.id) }}
              >
                {initials(participant.name)}
              </div>
              {participant.speaking && (
                <span className="absolute -inset-0.5 rounded-full ring-2 ring-accent [animation:pulse-ring_1.4s_ease-in-out_infinite]" />
              )}
            </div>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">
                {participant.name}
                {participant.isLocal && <span className="text-ink-faint"> (you)</span>}
              </p>
              <p className="text-xs text-ink-faint">
                {participant.state.screen
                  ? 'Presenting'
                  : participant.isLocal
                    ? 'You'
                    : connectionLabel(participant.connection)}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-1.5 text-ink-faint">
              {participant.state.screen && <ScreenIcon className="h-4 w-4 text-accent" />}
              {!participant.state.video && <CameraOffIcon className="h-4 w-4" />}
              {participant.state.audio ? (
                <MicIcon className={cn('h-4 w-4', participant.speaking && 'text-accent')} />
              ) : (
                <MicOffIcon className="h-4 w-4 text-danger" />
              )}
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}

function connectionLabel(state: string): string {
  switch (state) {
    case 'connected':
      return 'Connected';
    case 'connecting':
    case 'new':
      return 'Connecting…';
    case 'disconnected':
      return 'Reconnecting…';
    case 'failed':
      return 'Connection failed';
    case 'closed':
      return 'Disconnected';
    default:
      return 'Connecting…';
  }
}
