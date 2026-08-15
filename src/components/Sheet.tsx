import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

interface SheetProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}

/**
 * The one panel container, in two shapes:
 *  · phones — a bottom sheet over the video, with a drag handle and
 *    swipe-to-dismiss, the way every native app does it. The call stays
 *    visible behind it instead of being shoved off-screen.
 *  · desktop — a floating card over the right edge of the stage.
 */
export function Sheet({ open, onClose, children }: SheetProps) {
  const [dragY, setDragY] = useState(0);
  const dragStart = useRef<number | null>(null);

  // Close on Escape — cheap, and expected on desktop.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const onHandleDown = (event: React.PointerEvent) => {
    dragStart.current = event.clientY;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  };

  const onHandleMove = (event: React.PointerEvent) => {
    if (dragStart.current === null) return;
    setDragY(Math.max(0, event.clientY - dragStart.current));
  };

  const onHandleUp = () => {
    if (dragStart.current === null) return;
    const shouldClose = dragY > 90;
    dragStart.current = null;
    setDragY(0);
    if (shouldClose) onClose();
  };

  return (
    <>
      {/* Backdrop, phones only — the desktop card floats without dimming. */}
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="fixed inset-0 z-30 cursor-default bg-black/50 animate-fade lg:hidden"
      />

      <div
        role="dialog"
        aria-modal="false"
        style={dragY > 0 ? { transform: `translateY(${dragY}px)`, transition: 'none' } : undefined}
        className={cn(
          'fixed inset-x-0 bottom-0 z-40 flex h-[68dvh] flex-col overflow-hidden',
          'rounded-t-3xl border-t border-line bg-surface shadow-2xl animate-rise-spring',
          'pb-[env(safe-area-inset-bottom)]',
          'lg:inset-auto lg:top-[4.5rem] lg:right-3 lg:bottom-[6.75rem] lg:h-auto lg:w-[24rem]',
          'lg:rounded-3xl lg:border lg:pb-0',
        )}
      >
        {/* Drag handle, phones only. */}
        <div
          className="flex shrink-0 cursor-grab touch-none justify-center py-2.5 active:cursor-grabbing lg:hidden"
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
        >
          <span className="h-1 w-10 rounded-full bg-line-bright" />
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </>
  );
}
