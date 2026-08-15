import { memo, useEffect, useRef } from 'react';

import type { Participant } from '@/lib/call-engine';
import { avatarColor, cn, initials } from '@/lib/utils';
import { FlipIcon, MicOffIcon, PinIcon, ScreenIcon } from './Icons';

interface VideoTileProps {
  participant: Participant;
  /** Renders the larger presentation treatment used by the spotlight slot. */
  featured?: boolean;
  pinned?: boolean;
  onTogglePin?: (id: string) => void;
  /** Self-view mirroring. False when the back camera is publishing. */
  mirror?: boolean;
  /** Renders a flip-camera button on this tile (local tiles on multi-camera devices). */
  onFlip?: () => void;
  /** Tiny picture-in-picture treatment: no name plate, just the essentials. */
  compact?: boolean;
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
  mirror = true,
  onFlip,
  compact = false,
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
  // Only the states that have never carried media get the full overlay. A
  // 'disconnected' blip usually heals in seconds with frames still flowing —
  // hiding live video behind a spinner would manufacture a broken moment.
  const connecting =
    !participant.isLocal &&
    (participant.connection === 'new' || participant.connection === 'connecting');
  // Frames stalled or the transport is wobbling: keep the last picture,
  // soften it, say so quietly.
  const degraded =
    !participant.isLocal &&
    !connecting &&
    (participant.videoInterrupted ||
      participant.connection === 'disconnected' ||
      participant.connection === 'failed');

  // Live mic level drives a tiny equalizer in the name chip. Muted → no bars.
  const level = participant.state.audio ? participant.level : 0;

  return (
    <div
      className={cn(
        'group relative isolate flex h-full w-full items-center justify-center overflow-hidden',
        'rounded-2xl bg-surface ring-1 transition-[box-shadow,--tw-ring-color] duration-300',
        participant.speaking
          ? 'ring-2 ring-accent shadow-[0_0_36px_-8px_var(--color-accent)]'
          : 'ring-line',
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
          // A front-camera self-view that is not mirrored feels wrong; a back
          // camera or a screen share must never be.
          participant.isLocal && !participant.state.screen && mirror && 'scale-x-[-1]',
          participant.state.screen && 'object-contain',
        )}
      />

      {!showVideo && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface">
          <div className={cn('relative', connecting && 'ring-pulse')}>
            <div
              className={cn(
                'flex items-center justify-center rounded-full font-display text-ink select-none',
                featured ? 'h-28 w-28 text-4xl' : 'h-16 w-16 text-xl',
              )}
              style={{ background: avatarColor(participant.id) }}
            >
              {initials(participant.name)}
            </div>
          </div>
        </div>
      )}

      {connecting && showVideo && (
        <div className="absolute inset-0 flex items-center justify-center bg-canvas/60 backdrop-blur-sm">
          <span className="relative flex h-12 w-12 items-center justify-center ring-pulse">
            <span className="h-2 w-2 rounded-full bg-accent" />
          </span>
        </div>
      )}

      {degraded && (
        <div
          className={cn(
            'absolute inset-0 flex items-end justify-center pb-10 animate-fade',
            showVideo && 'bg-canvas/25 backdrop-blur-[6px]',
          )}
        >
          <span className="flex items-center gap-2 rounded-full bg-black/60 px-3.5 py-1.5 text-xs text-white/90 backdrop-blur-md">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-caution" />
            Connection hiccup — hold on…
          </span>
        </div>
      )}

      {/* Name chip — omitted on the tiny PiP card, where it would cover the face. */}
      {compact ? (
        !participant.state.audio && (
          <span className="absolute bottom-1.5 left-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-danger">
            <MicOffIcon className="h-3 w-3 text-white" />
          </span>
        )
      ) : (
        <div className="pointer-events-none absolute inset-x-2 bottom-2 flex items-end justify-between gap-2">
          <span
            className={cn(
              'flex min-w-0 items-center gap-2 rounded-full bg-black/55 py-1 pr-3 pl-2.5 backdrop-blur-md',
              participant.speaking && 'text-accent',
            )}
          >
            {participant.state.audio ? (
              <span className="eq shrink-0" aria-hidden="true">
                <span className="h-[5px]" style={{ transform: `scaleY(${0.5 + level * 2.2})` }} />
                <span className="h-[11px]" style={{ transform: `scaleY(${0.35 + level * 2.6})` }} />
                <span className="h-[7px]" style={{ transform: `scaleY(${0.45 + level * 2})` }} />
              </span>
            ) : (
              <span className="flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full bg-danger">
                <MicOffIcon className="h-2.5 w-2.5 text-white" />
              </span>
            )}
            {participant.state.screen && <ScreenIcon className="h-3.5 w-3.5 shrink-0" />}
            <span className="truncate text-[13px] font-medium text-white">
              {participant.name}
              {participant.isLocal && <span className="text-white/50"> · you</span>}
            </span>
            {participant.quality && participant.quality.level !== 'good' && (
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  participant.quality.level === 'poor' ? 'bg-danger' : 'bg-caution',
                )}
                title={`Connection ${participant.quality.level}`}
              />
            )}
          </span>
        </div>
      )}

      {onFlip && (
        <button
          type="button"
          onClick={onFlip}
          // A parent may be draggable (the PiP); a tap on this button is a
          // button press, not the start of a drag.
          onPointerDown={(event) => event.stopPropagation()}
          aria-label="Flip camera"
          className={cn(
            'absolute flex items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-md',
            'transition-all duration-200 [transition-timing-function:var(--ease-spring)] hover:scale-105 hover:bg-black/75 active:scale-90',
            compact ? 'top-1.5 right-1.5 h-7 w-7' : 'top-2 left-2 h-9 w-9',
          )}
        >
          <FlipIcon className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
        </button>
      )}

      {onTogglePin && !compact && (
        <button
          type="button"
          onClick={() => onTogglePin(participant.id)}
          aria-label={pinned ? `Unpin ${participant.name}` : `Pin ${participant.name}`}
          className={cn(
            'absolute top-2 right-2 flex h-9 w-9 items-center justify-center rounded-full',
            'bg-black/55 text-white backdrop-blur-md transition-all duration-200 [transition-timing-function:var(--ease-spring)]',
            'hover:scale-105 hover:bg-black/75 focus-visible:opacity-100 active:scale-95',
            pinned ? 'text-accent opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
        >
          <PinIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export const VideoTile = memo(VideoTileImpl);
