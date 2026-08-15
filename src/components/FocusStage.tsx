import type { Participant } from '@/lib/call-engine';
import { cn } from '@/lib/utils';
import { PinIcon } from './Icons';
import { VideoTile } from './VideoTile';

interface FocusStageProps {
  /** Everyone in the call; the stage decides how to arrange them. */
  participants: Participant[];
  focus: Participant;
  /** True when the person on stage was chosen by hand rather than by voice. */
  pinned: boolean;
  onPin: (id: string) => void;
  onUnpin: () => void;
  localMirror: boolean;
  onFlipLocal: (() => void) | undefined;
}

/**
 * The group-call layout for phones.
 *
 * A portrait screen cannot show five letterboxed strips of foreheads — so it
 * doesn't try. One person fills the stage: whoever is speaking, chosen with
 * hysteresis, the way attention actually moves in a conversation. Everyone
 * else lives in a thumb-reach filmstrip. Tap a face to hold it on stage; tap
 * the stage to let the conversation drive again.
 */
export function FocusStage({
  participants,
  focus,
  pinned,
  onPin,
  onUnpin,
  localMirror,
  onFlipLocal,
}: FocusStageProps) {
  // You first (always findable, flip at hand), then everyone by arrival.
  const strip = [
    ...participants.filter((participant) => participant.isLocal && participant.id !== focus.id),
    ...participants.filter((participant) => !participant.isLocal && participant.id !== focus.id),
  ];

  return (
    <div className="flex h-full w-full flex-col gap-2">
      {/* Stage. Keyed so a focus change crossfades instead of hard-cutting. */}
      <div className="relative min-h-0 flex-1">
        <div key={focus.id} className="h-full w-full animate-fade">
          <VideoTile
            participant={focus}
            featured
            mirror={focus.isLocal ? localMirror : true}
            onFlip={focus.isLocal ? onFlipLocal : undefined}
          />
        </div>

        {pinned && (
          <button
            type="button"
            onClick={onUnpin}
            className={cn(
              'absolute top-2.5 left-1/2 -translate-x-1/2 animate-pop',
              'glass flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5',
              'text-xs text-ink transition-transform active:scale-95',
            )}
          >
            <PinIcon className="h-3 w-3 text-accent" />
            Pinned · tap to follow the conversation
          </button>
        )}
      </div>

      {/* Filmstrip: portrait cards, one thumb away. */}
      {strip.length > 0 && (
        <div
          className="flex shrink-0 snap-x gap-2 overflow-x-auto pb-1"
          role="listbox"
          aria-label="Participants"
        >
          {strip.map((participant) => (
            <button
              key={participant.id}
              type="button"
              onClick={() => onPin(participant.id)}
              aria-label={`Show ${participant.isLocal ? 'yourself' : participant.name} on stage`}
              className={cn(
                'relative h-24 w-18 shrink-0 snap-start overflow-hidden rounded-xl',
                'transition-transform duration-200 [transition-timing-function:var(--ease-spring)] active:scale-95',
              )}
            >
              <VideoTile
                participant={participant}
                compact
                mirror={participant.isLocal ? localMirror : true}
              />
              <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/70 to-transparent px-1 pt-3 pb-0.5 text-center text-[10px] font-medium text-white">
                {participant.isLocal ? 'You' : participant.name.split(' ')[0]}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
