import { memo, useEffect, useRef } from 'react';

import type { Participant } from '@/lib/call-engine';
import { avatarGradient, cn, initials } from '@/lib/utils';
import { MicOffIcon, PinIcon, ScreenIcon, SignalIcon, SpinnerIcon } from './Icons';

interface VideoTileProps {
  participant: Participant;
  /** Renders the larger presentation treatment used by the spotlight slot. */
  featured?: boolean;
  pinned?: boolean;
  onTogglePin?: (id: string) => void;
}

/**
 * One participant's video.
 *
 * `srcObject` cannot be set declaratively, so the stream is attached through a
 * ref and kept in sync — reassigning the same stream would restart playback and
 * cause a visible flash.
 */
function VideoTileImpl({
  participant,
  featured = false,
  pinned = false,
  onTogglePin,
}: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const element = videoRef.current;
    if (!element) return;
    if (element.srcObject !== participant.stream) {
      element.srcObject = participant.stream;
    }
    if (participant.stream) {
      // Autoplay can reject when a gesture has not been registered yet; the
      // controls remain usable either way, so this failure is not surfaced.
      void element.play().catch(() => undefined);
    }
  }, [participant.stream]);

  const showVideo = participant.state.video && Boolean(participant.stream);
  const connecting =
    !participant.isLocal &&
    (participant.connection === 'new' ||
      participant.connection === 'connecting' ||
      participant.connection === 'disconnected');

  return (
    <div
      className={cn(
        'group relative isolate flex h-full w-full items-center justify-center overflow-hidden',
        'rounded-2xl border bg-surface transition-[border-color,box-shadow] duration-300',
        participant.speaking
          ? 'border-accent shadow-[0_0_0_1px_var(--color-accent),0_0_28px_-6px_var(--color-accent)]'
          : 'border-line',
      )}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        // Muting the local preview is what prevents an audio feedback loop.
        muted={participant.isLocal}
        className={cn(
          'h-full w-full bg-canvas object-cover transition-opacity duration-300',
          showVideo ? 'opacity-100' : 'opacity-0',
          // A self-view that is not mirrored feels wrong; a screen share must not be.
          participant.isLocal && !participant.state.screen && 'scale-x-[-1]',
          participant.state.screen && 'object-contain',
        )}
      />

      {!showVideo && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface">
          <div
            className={cn(
              'flex items-center justify-center rounded-full font-semibold text-white/95 select-none',
              featured ? 'h-28 w-28 text-3xl' : 'h-16 w-16 text-lg',
            )}
            style={{ background: avatarGradient(participant.id) }}
          >
            {initials(participant.name)}
          </div>
        </div>
      )}

      {connecting && (
        <div className="absolute inset-0 flex items-center justify-center bg-canvas/65 backdrop-blur-sm">
          <div className="flex items-center gap-2.5 text-sm text-ink-muted">
            <SpinnerIcon className="h-4 w-4 animate-spin" />
            Connecting…
          </div>
        </div>
      )}

      {/* Name plate */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/75 via-black/25 to-transparent p-2.5 pt-8">
        <div className="flex min-w-0 items-center gap-1.5">
          {!participant.state.audio && (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-danger/90">
              <MicOffIcon className="h-3 w-3 text-white" />
            </span>
          )}
          {participant.state.screen && (
            <ScreenIcon className="h-3.5 w-3.5 shrink-0 text-accent-bright" />
          )}
          <span className="truncate text-[13px] font-medium text-white drop-shadow">
            {participant.name}
            {participant.isLocal && <span className="text-white/60"> (you)</span>}
          </span>
        </div>

        {participant.quality && participant.quality.level !== 'good' && (
          <span
            className={cn(
              'shrink-0',
              participant.quality.level === 'poor' ? 'text-danger' : 'text-caution',
            )}
            title={`Connection ${participant.quality.level}${
              participant.quality.rttMs === null ? '' : ` · ${participant.quality.rttMs}ms`
            }`}
          >
            <SignalIcon className="h-3.5 w-3.5" />
          </span>
        )}
      </div>

      {onTogglePin && (
        <button
          type="button"
          onClick={() => onTogglePin(participant.id)}
          aria-label={pinned ? `Unpin ${participant.name}` : `Pin ${participant.name}`}
          className={cn(
            'absolute top-2 right-2 flex h-8 w-8 items-center justify-center rounded-lg',
            'bg-black/55 text-white backdrop-blur transition-opacity duration-150',
            'hover:bg-black/75 focus-visible:opacity-100',
            pinned ? 'opacity-100 text-accent-bright' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          <PinIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export const VideoTile = memo(VideoTileImpl);
