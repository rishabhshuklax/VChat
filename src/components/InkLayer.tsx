import { useEffect, useRef } from 'react';

import type { InkPoint } from '@shared/protocol';
import type { CallEngine } from '@/lib/call-engine';
import { avatarColor, cn } from '@/lib/utils';

interface InkLayerProps {
  engine: CallEngine;
  selfId: string | null;
  /** True while this client is in drawing mode (pointer captures the stage). */
  active: boolean;
}

interface Stroke {
  color: string;
  points: InkPoint[];
  done: boolean;
  /** Set when the stroke finishes; drives the evaporation fade. */
  doneAt: number | null;
}

/** How long a finished stroke lingers before it has fully evaporated. */
const FADE_MS = 3200;
/** Outbound point batches per second — bounds signaling traffic while drawing. */
const FLUSH_MS = 55;
/** Ignore movements smaller than this (stage-relative) to keep strokes light. */
const MIN_STEP = 0.004;

/**
 * Air Ink: draw on the call, everyone sees it, it evaporates.
 *
 * The layer is fully imperative — strokes live in refs and render straight to
 * a canvas on animation frames. Routing per-point updates through React state
 * would re-render the whole call UI at pointer speed.
 *
 * Always mounted so remote ink shows even when you are not drawing; it only
 * accepts pointer input while `active`.
 */
export function InkLayer({ engine, selfId, active }: InkLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef(new Map<string, Stroke>());
  const frame = useRef<number | null>(null);

  const drawing = useRef<{
    pointerId: number;
    stroke: string;
    buffer: InkPoint[];
    flushTimer: ReturnType<typeof setInterval>;
    last: InkPoint;
  } | null>(null);

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  const ensureLoop = () => {
    if (frame.current !== null) return;
    const tick = () => {
      frame.current = null;
      const canvas = canvasRef.current;
      const context = canvas?.getContext('2d');
      if (!canvas || !context) return;

      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);
      context.lineCap = 'round';
      context.lineJoin = 'round';

      const now = performance.now();
      for (const [key, stroke] of strokes.current) {
        const age = stroke.doneAt === null ? 0 : now - stroke.doneAt;
        const alpha = stroke.doneAt === null ? 1 : Math.max(0, 1 - age / FADE_MS);
        if (alpha <= 0) {
          strokes.current.delete(key);
          continue;
        }
        if (stroke.points.length < 2) continue;

        context.globalAlpha = alpha;
        context.strokeStyle = stroke.color;
        context.shadowColor = stroke.color;
        context.shadowBlur = 14;
        context.lineWidth = 4.5;
        context.beginPath();

        // Quadratic smoothing through midpoints — hand-drawn, not polygonal.
        const [first, ...rest] = stroke.points;
        if (!first) continue;
        context.moveTo(first.x * width, first.y * height);
        for (let index = 0; index < rest.length - 1; index += 1) {
          const current = rest[index];
          const next = rest[index + 1];
          if (!current || !next) break;
          context.quadraticCurveTo(
            current.x * width,
            current.y * height,
            ((current.x + next.x) / 2) * width,
            ((current.y + next.y) / 2) * height,
          );
        }
        const tail = rest[rest.length - 1];
        if (tail) context.lineTo(tail.x * width, tail.y * height);
        context.stroke();
      }
      context.globalAlpha = 1;
      context.shadowBlur = 0;

      if (strokes.current.size > 0) {
        frame.current = requestAnimationFrame(tick);
      }
    };
    frame.current = requestAnimationFrame(tick);
  };

  const addPoints = (key: string, color: string, points: InkPoint[], done: boolean) => {
    let stroke = strokes.current.get(key);
    if (!stroke) {
      stroke = { color, points: [], done: false, doneAt: null };
      strokes.current.set(key, stroke);
    }
    stroke.points.push(...points);
    if (done && stroke.doneAt === null) {
      stroke.done = true;
      stroke.doneAt = performance.now();
    }
    ensureLoop();
  };

  // Remote strokes.
  useEffect(
    () =>
      engine.onInk((event) => {
        addPoints(
          `${event.from}:${event.stroke}`,
          avatarColor(event.from),
          event.points,
          event.done,
        );
      }),
    // addPoints is stable (closure over refs only).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine],
  );

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      if (drawing.current) clearInterval(drawing.current.flushTimer);
    },
    [],
  );

  // ---------------------------------------------------------------------
  // Local drawing
  // ---------------------------------------------------------------------

  const toPoint = (event: React.PointerEvent): InkPoint | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const selfColor = () => avatarColor(selfId ?? 'self');

  const onPointerDown = (event: React.PointerEvent) => {
    if (!active || drawing.current) return;
    const point = toPoint(event);
    if (!point) return;

    const stroke = crypto.randomUUID().slice(0, 13);
    canvasRef.current?.setPointerCapture(event.pointerId);

    const session = {
      pointerId: event.pointerId,
      stroke,
      buffer: [point],
      last: point,
      flushTimer: setInterval(() => {
        const current = drawing.current;
        if (!current || current.buffer.length === 0) return;
        engine.sendInk(current.stroke, current.buffer.splice(0), false);
      }, FLUSH_MS),
    };
    drawing.current = session;
    addPoints(`self:${stroke}`, selfColor(), [point], false);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const session = drawing.current;
    if (!session || event.pointerId !== session.pointerId) return;
    const point = toPoint(event);
    if (!point) return;
    const dx = point.x - session.last.x;
    const dy = point.y - session.last.y;
    if (dx * dx + dy * dy < MIN_STEP * MIN_STEP) return;
    session.last = point;
    session.buffer.push(point);
    addPoints(`self:${session.stroke}`, selfColor(), [point], false);
  };

  const endStroke = () => {
    const session = drawing.current;
    if (!session) return;
    drawing.current = null;
    clearInterval(session.flushTimer);
    engine.sendInk(session.stroke, session.buffer.splice(0), true);
    addPoints(`self:${session.stroke}`, selfColor(), [], true);
  };

  return (
    <canvas
      ref={canvasRef}
      data-ink
      aria-hidden="true"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endStroke}
      onPointerCancel={endStroke}
      className={cn(
        'absolute inset-0 z-[15] h-full w-full',
        active ? 'cursor-crosshair touch-none' : 'pointer-events-none',
      )}
    />
  );
}
