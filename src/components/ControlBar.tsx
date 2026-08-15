import { useEffect, useRef, useState } from 'react';

import type { CallEngine, CallState } from '@/lib/call-engine';
import { cn } from '@/lib/utils';
import {
  CameraIcon,
  CameraOffIcon,
  ChatIcon,
  CloseIcon,
  HangUpIcon,
  MicIcon,
  MicOffIcon,
  PencilIcon,
  PeopleIcon,
  ScreenIcon,
  ScreenOffIcon,
  SettingsIcon,
  SmileIcon,
} from './Icons';

interface ControlBarProps {
  state: CallState;
  engine: CallEngine;
  chatOpen: boolean;
  participantsOpen: boolean;
  inkActive: boolean;
  onToggleInk: () => void;
  onToggleChat: () => void;
  onToggleParticipants: () => void;
  onLeave: () => void;
}

const REACTIONS = ['❤️', '😂', '👏', '🎉', '😮', '👍'] as const;

interface ControlButtonProps {
  label: string;
  /** false renders the alarmed (red-tinted) state — mic muted, camera off. */
  active: boolean;
  highlight?: boolean;
  badge?: number;
  onClick: () => void;
  children: React.ReactNode;
}

function ControlButton({ label, active, highlight, badge, onClick, children }: ControlButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full sm:h-12 sm:w-12',
        'transition-all duration-200 [transition-timing-function:var(--ease-spring)]',
        'hover:scale-105 active:scale-90',
        active
          ? highlight
            ? 'bg-accent text-soot'
            : 'bg-white/10 text-ink hover:bg-white/15'
          : 'bg-danger/90 text-white hover:bg-danger',
      )}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-0.5 -right-0.5 flex h-5 min-w-5 animate-pop items-center justify-center rounded-full bg-accent px-1 text-[11px] font-bold text-soot">
          {badge > 9 ? '9+' : badge}
        </span>
      )}
    </button>
  );
}

export function ControlBar({
  state,
  engine,
  chatOpen,
  participantsOpen,
  inkActive,
  onToggleInk,
  onToggleChat,
  onToggleParticipants,
  onLeave,
}: ControlBarProps) {
  const [popover, setPopover] = useState<'none' | 'settings' | 'reactions'>('none');
  const popoverRef = useRef<HTMLDivElement>(null);
  const local = state.participants.find((participant) => participant.isLocal);

  useEffect(() => {
    if (popover === 'none') return;
    const onPointerDown = (event: PointerEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) setPopover('none');
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPopover('none');
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [popover]);

  // Screen capture is unavailable on iOS Safari and most mobile browsers;
  // showing a button that can only fail is worse than not showing it.
  const canShare =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia);

  return (
    <div ref={popoverRef} className="relative flex justify-center">
      <div className="glass flex items-center gap-1 rounded-full border border-line p-1.5 shadow-2xl sm:gap-2 sm:p-2">
        <ControlButton
          label={local?.state.audio ? 'Mute microphone (M)' : 'Unmute microphone (M)'}
          active={Boolean(local?.state.audio)}
          onClick={engine.toggleAudio}
        >
          {local?.state.audio ? (
            <MicIcon className="h-5 w-5" />
          ) : (
            <MicOffIcon className="h-5 w-5" />
          )}
        </ControlButton>

        <ControlButton
          label={local?.state.video ? 'Turn camera off (V)' : 'Turn camera on (V)'}
          active={Boolean(local?.state.video)}
          onClick={() => void engine.toggleVideo()}
        >
          {local?.state.video ? (
            <CameraIcon className="h-5 w-5" />
          ) : (
            <CameraOffIcon className="h-5 w-5" />
          )}
        </ControlButton>

        {canShare && (
          <div className={cn(!state.presenting && 'hidden sm:block')}>
            <ControlButton
              label={state.presenting ? 'Stop sharing (S)' : 'Share your screen (S)'}
              active
              highlight={state.presenting}
              onClick={() => void engine.toggleScreenShare()}
            >
              {state.presenting ? (
                <ScreenOffIcon className="h-5 w-5" />
              ) : (
                <ScreenIcon className="h-5 w-5" />
              )}
            </ControlButton>
          </div>
        )}

        <ControlButton label="Draw (D)" active highlight={inkActive} onClick={onToggleInk}>
          <PencilIcon className="h-5 w-5" />
        </ControlButton>

        <ControlButton
          label="Reactions"
          active
          highlight={popover === 'reactions'}
          onClick={() => setPopover((current) => (current === 'reactions' ? 'none' : 'reactions'))}
        >
          <SmileIcon className="h-5 w-5" />
        </ControlButton>

        <ControlButton
          label="Chat (C)"
          active
          highlight={chatOpen}
          badge={state.unread}
          onClick={onToggleChat}
        >
          <ChatIcon className="h-5 w-5" />
        </ControlButton>

        <ControlButton
          label="Participants (P)"
          active
          highlight={participantsOpen}
          onClick={onToggleParticipants}
        >
          <PeopleIcon className="h-5 w-5" />
        </ControlButton>

        <div className="hidden sm:block">
          <ControlButton
            label="Devices"
            active
            highlight={popover === 'settings'}
            onClick={() => setPopover((current) => (current === 'settings' ? 'none' : 'settings'))}
          >
            <SettingsIcon className="h-5 w-5" />
          </ControlButton>
        </div>

        <div className="mx-0.5 h-7 w-px bg-line sm:mx-1" />

        <button
          type="button"
          onClick={onLeave}
          title="Leave call"
          aria-label="Leave call"
          className={cn(
            'flex h-10 items-center justify-center rounded-full bg-danger px-3.5 text-white sm:h-12 sm:px-6',
            'transition-all duration-200 [transition-timing-function:var(--ease-spring)] hover:scale-105 hover:brightness-110 active:scale-90',
          )}
        >
          <HangUpIcon className="h-5 w-5" />
        </button>
      </div>

      {popover === 'reactions' && (
        <div className="glass absolute bottom-full mb-3 flex animate-rise-spring gap-1 rounded-full border border-line p-2 shadow-2xl">
          {REACTIONS.map((emoji, index) => (
            <button
              key={emoji}
              type="button"
              aria-label={`React ${emoji}`}
              onClick={() => {
                engine.sendReaction(emoji);
                setPopover('none');
              }}
              style={{ animationDelay: `${index * 30}ms` }}
              className="flex h-11 w-11 animate-pop items-center justify-center rounded-full text-2xl transition-transform duration-150 [transition-timing-function:var(--ease-spring)] hover:scale-125 active:scale-90"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}

      {popover === 'settings' && (
        <div className="glass absolute bottom-full mb-3 w-80 animate-rise-spring rounded-3xl border border-line p-4 shadow-2xl">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold">Devices</h3>
            <button
              type="button"
              onClick={() => setPopover('none')}
              aria-label="Close devices"
              className="text-ink-faint transition-colors hover:text-ink"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>

          <DeviceSelect
            label="Camera"
            options={state.devices.cameras}
            value={state.cameraId}
            onChange={(id) => void engine.switchDevice('camera', id)}
          />
          <DeviceSelect
            label="Microphone"
            options={state.devices.microphones}
            value={state.microphoneId}
            onChange={(id) => void engine.switchDevice('microphone', id)}
          />
        </div>
      )}
    </div>
  );
}

interface DeviceSelectProps {
  label: string;
  options: Array<{ deviceId: string; label: string }>;
  value: string | null;
  onChange: (deviceId: string) => void;
  /** Paper pages pass 'light'; the in-call popover uses the dark default. */
  tone?: 'dark' | 'light';
}

export function DeviceSelect({
  label,
  options,
  value,
  onChange,
  tone = 'dark',
}: DeviceSelectProps) {
  const id = `device-${label.toLowerCase()}`;
  return (
    <div className="mb-3 last:mb-0">
      <label
        htmlFor={id}
        className={cn(
          'mb-1.5 block font-mono text-[11px] tracking-[0.14em] uppercase',
          tone === 'dark' ? 'text-ink-muted' : 'text-soot-muted',
        )}
      >
        {label}
      </label>
      <select
        id={id}
        value={value ?? options[0]?.deviceId ?? ''}
        disabled={options.length === 0}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'w-full rounded-xl border px-3 py-2.5 text-sm transition-colors focus:outline-none disabled:opacity-50',
          tone === 'dark'
            ? 'border-line bg-surface-2 text-ink hover:border-line-bright focus:border-accent'
            : 'border-paper-line bg-white/60 text-soot hover:border-soot/40 focus:border-soot',
        )}
      >
        {options.length === 0 && <option>No {label.toLowerCase()} found</option>}
        {options.map((option) => (
          <option key={option.deviceId} value={option.deviceId}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
