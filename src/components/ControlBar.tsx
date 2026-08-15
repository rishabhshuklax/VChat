import { useEffect, useRef, useState } from 'react';

import type { CallState, CallEngine } from '@/lib/call-engine';
import { cn } from '@/lib/utils';
import {
  CameraIcon,
  CameraOffIcon,
  ChatIcon,
  CloseIcon,
  HangUpIcon,
  MicIcon,
  MicOffIcon,
  PeopleIcon,
  ScreenIcon,
  ScreenOffIcon,
  SettingsIcon,
} from './Icons';

interface ControlBarProps {
  state: CallState;
  engine: CallEngine;
  chatOpen: boolean;
  participantsOpen: boolean;
  onToggleChat: () => void;
  onToggleParticipants: () => void;
  onLeave: () => void;
}

interface ControlButtonProps {
  label: string;
  active: boolean;
  danger?: boolean;
  badge?: number;
  onClick: () => void;
  children: React.ReactNode;
}

function ControlButton({ label, active, danger, badge, onClick, children }: ControlButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'relative flex h-12 w-12 items-center justify-center rounded-2xl transition-all duration-150',
        'active:scale-95 sm:h-13 sm:w-13',
        danger
          ? 'bg-danger text-white hover:brightness-110'
          : active
            ? 'bg-surface-3 text-ink hover:bg-line'
            : 'bg-danger/15 text-danger hover:bg-danger/25',
      )}
    >
      {children}
      {badge !== undefined && badge > 0 && (
        <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold text-white">
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
  onToggleChat,
  onToggleParticipants,
  onLeave,
}: ControlBarProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const local = state.participants.find((participant) => participant.isLocal);

  useEffect(() => {
    if (!settingsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!settingsRef.current?.contains(event.target as Node)) setSettingsOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSettingsOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [settingsOpen]);

  // Screen capture is unavailable on iOS Safari and most mobile browsers;
  // showing a button that can only fail is worse than not showing it.
  const canShare =
    typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia);

  return (
    <div className="relative flex items-center justify-center gap-2 sm:gap-3">
      <ControlButton
        label={local?.state.audio ? 'Mute microphone (M)' : 'Unmute microphone (M)'}
        active={Boolean(local?.state.audio)}
        onClick={engine.toggleAudio}
      >
        {local?.state.audio ? <MicIcon className="h-5 w-5" /> : <MicOffIcon className="h-5 w-5" />}
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
        <ControlButton
          label={state.presenting ? 'Stop sharing (S)' : 'Share your screen (S)'}
          active
          onClick={() => void engine.toggleScreenShare()}
        >
          {state.presenting ? (
            <ScreenOffIcon className="h-5 w-5 text-accent-bright" />
          ) : (
            <ScreenIcon className="h-5 w-5" />
          )}
        </ControlButton>
      )}

      <ControlButton
        label="Participants (P)"
        active={!participantsOpen}
        onClick={onToggleParticipants}
      >
        <PeopleIcon className={cn('h-5 w-5', participantsOpen && 'text-accent-bright')} />
      </ControlButton>

      <ControlButton
        label="Chat (C)"
        active={!chatOpen}
        badge={state.unread}
        onClick={onToggleChat}
      >
        <ChatIcon className={cn('h-5 w-5', chatOpen && 'text-accent-bright')} />
      </ControlButton>

      <div ref={settingsRef} className="relative hidden sm:block">
        <ControlButton
          label="Devices"
          active={!settingsOpen}
          onClick={() => setSettingsOpen((open) => !open)}
        >
          <SettingsIcon className={cn('h-5 w-5', settingsOpen && 'text-accent-bright')} />
        </ControlButton>

        {settingsOpen && (
          <div className="glass absolute bottom-16 left-1/2 w-80 -translate-x-1/2 rounded-2xl border border-line p-4 shadow-2xl animate-rise">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-semibold">Devices</h3>
              <button
                type="button"
                onClick={() => setSettingsOpen(false)}
                aria-label="Close devices"
                className="text-ink-faint hover:text-ink"
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

      <div className="mx-1 h-8 w-px bg-line sm:mx-2" />

      <ControlButton label="Leave call" active danger onClick={onLeave}>
        <HangUpIcon className="h-5 w-5" />
      </ControlButton>
    </div>
  );
}

interface DeviceSelectProps {
  label: string;
  options: Array<{ deviceId: string; label: string }>;
  value: string | null;
  onChange: (deviceId: string) => void;
}

export function DeviceSelect({ label, options, value, onChange }: DeviceSelectProps) {
  const id = `device-${label.toLowerCase()}`;
  return (
    <div className="mb-3 last:mb-0">
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-ink-muted">
        {label}
      </label>
      <select
        id={id}
        value={value ?? options[0]?.deviceId ?? ''}
        disabled={options.length === 0}
        onChange={(event) => onChange(event.target.value)}
        className={cn(
          'w-full rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink',
          'transition-colors hover:border-line-bright focus:border-accent focus:outline-none',
          'disabled:opacity-50',
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
