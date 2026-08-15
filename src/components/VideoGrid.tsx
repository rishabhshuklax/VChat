import { useLayoutEffect, useRef, useState } from 'react';

import type { Participant } from '@/lib/call-engine';
import { cn, gridDimensions } from '@/lib/utils';
import { VideoTile } from './VideoTile';

interface VideoGridProps {
  participants: Participant[];
  pinnedId: string | null;
  onTogglePin: (id: string) => void;
  /** Self-view mirroring, false while the back camera publishes. */
  localMirror?: boolean;
  /** Flip-camera handler, rendered on the local tile only. */
  onFlipLocal?: (() => void) | undefined;
}

/**
 * Adaptive layout.
 *
 * Two modes: an even grid, or a spotlight with a filmstrip. Spotlight engages
 * automatically when someone is presenting — you want the shared screen large —
 * and manually when a tile is pinned. The grid itself is computed from the
 * measured container aspect ratio rather than from fixed breakpoints, so tiles
 * stay near 16:9 on an ultrawide monitor and a phone alike.
 */
export function VideoGrid({
  participants,
  pinnedId,
  onTogglePin,
  localMirror = true,
  onFlipLocal,
}: VideoGridProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [aspect, setAspect] = useState(16 / 9);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (height > 0) setAspect(width / height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const presenter = participants.find((participant) => participant.state.screen);
  const featured =
    participants.find((participant) => participant.id === pinnedId) ?? presenter ?? null;

  if (featured && participants.length > 1) {
    const others = participants.filter((participant) => participant.id !== featured.id);
    return (
      <div ref={containerRef} className="flex h-full w-full flex-col gap-3 lg:flex-row">
        <div className="min-h-0 flex-1">
          <VideoTile
            participant={featured}
            featured
            pinned={featured.id === pinnedId}
            onTogglePin={onTogglePin}
            mirror={featured.isLocal ? localMirror : true}
            onFlip={featured.isLocal ? onFlipLocal : undefined}
          />
        </div>
        <div
          className={cn(
            'flex shrink-0 gap-3 overflow-auto',
            'h-24 flex-row sm:h-32 lg:h-auto lg:w-52 lg:flex-col xl:w-64',
          )}
        >
          {others.map((participant) => (
            <div key={participant.id} className="aspect-video h-full shrink-0 lg:h-auto lg:w-full">
              <VideoTile
                participant={participant}
                pinned={participant.id === pinnedId}
                onTogglePin={onTogglePin}
                mirror={participant.isLocal ? localMirror : true}
                onFlip={participant.isLocal ? onFlipLocal : undefined}
              />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const { columns, rows } = gridDimensions(participants.length, aspect);

  return (
    <div
      ref={containerRef}
      className="grid h-full w-full gap-3"
      style={{
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
    >
      {participants.map((participant) => (
        <VideoTile
          key={participant.id}
          participant={participant}
          featured={participants.length === 1}
          pinned={participant.id === pinnedId}
          onTogglePin={participants.length > 1 ? onTogglePin : undefined}
          mirror={participant.isLocal ? localMirror : true}
          onFlip={participant.isLocal ? onFlipLocal : undefined}
        />
      ))}
    </div>
  );
}
