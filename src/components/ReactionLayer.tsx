import type { ReactionEvent } from '@/lib/call-engine';
import { seededUnit } from '@/lib/utils';

interface ReactionLayerProps {
  reactions: ReactionEvent[];
}

/**
 * Emoji reactions drifting up over the stage. Every client animates the same
 * server-broadcast event, so a reaction lands on everyone's screen at once.
 * Position and sway are derived from the reaction id, so the layout is
 * deterministic without any coordination.
 */
export function ReactionLayer({ reactions }: ReactionLayerProps) {
  if (reactions.length === 0) return null;

  return (
    <div className="pointer-events-none absolute inset-0 z-30 overflow-hidden" aria-hidden="true">
      {reactions.map((reaction) => {
        const unit = seededUnit(reaction.id);
        const left = 12 + unit * 70; // keep clear of the very edges
        const sway = (unit - 0.5) * 120;
        return (
          <div
            key={reaction.id}
            className="absolute bottom-28 flex animate-float-up flex-col items-center"
            style={{ left: `${left}%`, ['--sway' as string]: `${sway}px` }}
          >
            <span className="text-4xl drop-shadow-lg sm:text-5xl">{reaction.emoji}</span>
            <span className="mt-1 rounded-full bg-black/50 px-2 py-0.5 text-[10px] font-medium text-white/90 backdrop-blur-sm">
              {reaction.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
