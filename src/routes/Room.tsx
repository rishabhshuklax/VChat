import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ERROR_CODES, formatRoomCode, normalizeRoomCode } from '@shared/protocol';
import { ChatPanel } from '@/components/ChatPanel';
import { InkLayer } from '@/components/InkLayer';
import { ControlBar } from '@/components/ControlBar';
import { CheckIcon, CopyIcon, VideoLogo } from '@/components/Icons';
import { ParticipantsPanel } from '@/components/ParticipantsPanel';
import { ReactionLayer } from '@/components/ReactionLayer';
import { Sheet } from '@/components/Sheet';
import { Toasts } from '@/components/Toasts';
import { VideoGrid } from '@/components/VideoGrid';
import { VideoTile } from '@/components/VideoTile';
import { Button } from '@/components/ui/Button';
import { CallEngine, type Participant } from '@/lib/call-engine';
import { cn, copyText, formatDuration } from '@/lib/utils';
import { Lobby, type LobbyResult } from './Lobby';

type Phase = 'lobby' | 'call' | 'ended';
type Panel = 'none' | 'chat' | 'participants';

export function Room() {
  const params = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const roomId = normalizeRoomCode(params.roomId ?? '');

  // One engine for the lifetime of the route. The lazy initialiser matters:
  // a bare `new CallEngine()` would construct a throwaway on every render.
  const [engine] = useState(() => new CallEngine());
  const state = useSyncExternalStore(engine.subscribe, engine.getSnapshot);

  const [phase, setPhase] = useState<Phase>('lobby');
  const [panel, setPanel] = useState<Panel>('none');
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Call timer.
  const callStartRef = useRef<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Chrome (header + controls) auto-hides during conversation so faces get
  // the whole screen. Any input brings it back.
  const [chromeVisible, setChromeVisible] = useState(true);

  // FaceTime-mode swap: tap the little card to trade places with the stage.
  const [swapped, setSwapped] = useState(false);
  // Air Ink drawing mode.
  const [inkMode, setInkMode] = useState(false);
  // Push-to-talk: true while Space is held with the mic muted.
  const [pttLive, setPttLive] = useState(false);
  const pttRef = useRef(false);

  useEffect(() => () => engine.dispose(), [engine]);

  // A fatal server error sends us back to the lobby with an explanation
  // instead of stranding the user on a dead call screen.
  useEffect(() => {
    if (state.status !== 'error' || !state.error) return;
    setPhase('lobby');
    setLobbyError(state.error.message);
    if (
      state.error.code === ERROR_CODES.PASSWORD_REQUIRED ||
      state.error.code === ERROR_CODES.BAD_PASSWORD
    ) {
      setRequiresPassword(true);
    }
  }, [state.status, state.error]);

  useEffect(() => {
    engine.setChatVisible(panel === 'chat');
  }, [engine, panel]);

  // Tick the call timer.
  useEffect(() => {
    if (phase !== 'call') return;
    callStartRef.current ??= Date.now();
    const timer = setInterval(() => {
      if (callStartRef.current) setElapsedMs(Date.now() - callStartRef.current);
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // Idle chrome. Only hides when there is an actual conversation on screen
  // and no panel is open.
  const canHideChrome =
    phase === 'call' && panel === 'none' && !inkMode && state.participants.length > 1;
  useEffect(() => {
    if (!canHideChrome) {
      setChromeVisible(true);
      return;
    }
    let timer: number | undefined;
    const bump = () => {
      setChromeVisible(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setChromeVisible(false), 4000);
    };
    bump();
    const events = ['pointermove', 'pointerdown', 'keydown', 'touchstart'] as const;
    for (const event of events) window.addEventListener(event, bump, { passive: true });
    return () => {
      window.clearTimeout(timer);
      for (const event of events) window.removeEventListener(event, bump);
    };
  }, [canHideChrome]);

  const handleJoin = useCallback(
    (result: LobbyResult) => {
      setLobbyError(null);
      setPhase('call');
      void engine.join({
        roomId,
        name: result.name,
        password: result.password,
        audio: result.audio,
        video: result.video,
        cameraId: result.cameraId,
        microphoneId: result.microphoneId,
      });
    },
    [engine, roomId],
  );

  const handleLeave = useCallback(() => {
    engine.leave();
    callStartRef.current = null;
    setPhase('ended');
  }, [engine]);

  const togglePin = useCallback((id: string) => {
    setPinnedId((current) => (current === id ? null : id));
  }, []);

  // Keyboard shortcuts, suppressed while typing so "m" in a chat message does
  // not mute the microphone.
  useEffect(() => {
    if (phase !== 'call') return;

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key.toLowerCase()) {
        case 'm':
          event.preventDefault();
          engine.toggleAudio();
          break;
        case 'v':
          event.preventDefault();
          void engine.toggleVideo();
          break;
        case 's':
          event.preventDefault();
          void engine.toggleScreenShare();
          break;
        case 'c':
          event.preventDefault();
          setPanel((current) => (current === 'chat' ? 'none' : 'chat'));
          break;
        case 'p':
          event.preventDefault();
          setPanel((current) => (current === 'participants' ? 'none' : 'participants'));
          break;
        case 'd':
          event.preventDefault();
          setInkMode((current) => !current);
          break;
        case ' ': {
          // Hold Space to talk while muted; release to go quiet again.
          if (event.repeat) break;
          event.preventDefault();
          const localNow = engine.getSnapshot().participants.find((p) => p.isLocal);
          if (localNow && !localNow.state.audio) {
            pttRef.current = true;
            setPttLive(true);
            engine.toggleAudio();
          }
          break;
        }
        case 'escape':
          setInkMode(false);
          setPanel('none');
          break;
        default:
          break;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ' && pttRef.current) {
        pttRef.current = false;
        setPttLive(false);
        engine.toggleAudio();
      }
    };

    // Losing focus mid-hold must not leave the mic hot.
    const onBlur = () => {
      if (pttRef.current) {
        pttRef.current = false;
        setPttLive(false);
        engine.toggleAudio();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [engine, phase]);

  const shareUrl = `${window.location.origin}/r/${roomId}`;

  const copyLink = useCallback(() => {
    void copyText(shareUrl).then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [shareUrl]);

  if (!roomId) {
    navigate('/', { replace: true });
    return null;
  }

  if (phase === 'lobby') {
    return (
      <Lobby
        roomId={roomId}
        error={lobbyError}
        requiresPassword={requiresPassword}
        busy={state.status === 'joining'}
        onJoin={handleJoin}
      />
    );
  }

  if (phase === 'ended') {
    return (
      <main className="scheme-light grain flex min-h-dvh flex-col items-center justify-center bg-paper px-5 py-10 text-soot">
        <h1 className="animate-rise text-center font-display text-5xl tracking-tight sm:text-6xl">
          That&apos;s a wrap.
        </h1>

        {/* The call receipt — a ticket stub. Rendered from local state only;
            nothing was ever stored anywhere. */}
        <div
          className="mt-8 w-full max-w-sm animate-rise-spring rounded-2xl bg-white/80 p-6 shadow-xl"
          style={{ animationDelay: '90ms' }}
        >
          <div className="flex items-center justify-between">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-soot">
              <VideoLogo className="h-4.5 w-4.5 text-accent" />
            </span>
            <span className="font-mono text-[11px] tracking-[0.22em] text-soot-muted uppercase">
              Call receipt
            </span>
          </div>

          <dl className="mt-5 space-y-2.5 font-mono text-[13px]">
            {[
              ['Room', formatRoomCode(roomId)],
              [
                'Date',
                new Date().toLocaleDateString([], {
                  day: '2-digit',
                  month: 'short',
                  year: 'numeric',
                }),
              ],
              ['Duration', formatDuration(elapsedMs)],
              ['People', state.roster.length > 0 ? state.roster.join(', ') : '—'],
              ['Messages', String(state.messages.length)],
              ['Reactions', String(state.reactionCount)],
            ].map(([term, detail]) => (
              <div key={term} className="flex items-baseline justify-between gap-4">
                <dt className="shrink-0 text-soot-muted uppercase">{term}</dt>
                <dd className="min-w-0 text-right font-bold break-words">{detail}</dd>
              </div>
            ))}
          </dl>

          <div className="my-5 border-t-2 border-dashed border-paper-line" />
          {/* Decorative barcode. */}
          <div
            aria-hidden="true"
            className="h-9 w-full opacity-80"
            style={{
              background:
                'repeating-linear-gradient(90deg, var(--color-soot) 0 2px, transparent 2px 5px, var(--color-soot) 5px 6px, transparent 6px 11px)',
            }}
          />
          <p className="mt-4 text-center text-[11px] leading-relaxed text-soot-faint">
            Nothing was recorded. This stub exists only on your screen.
          </p>
        </div>

        <div
          className="mt-8 flex animate-rise flex-wrap items-center justify-center gap-3"
          style={{ animationDelay: '180ms' }}
        >
          <Button
            variant="accent"
            size="lg"
            onClick={() => {
              setPhase('lobby');
              setLobbyError(null);
              setElapsedMs(0);
            }}
          >
            Rejoin
          </Button>
          <Link to="/">
            <Button variant="outline" size="lg">
              Back home
            </Button>
          </Link>
        </div>
      </main>
    );
  }

  const participants = state.participants;
  const local = participants.find((participant) => participant.isLocal);
  const remote = participants.filter((participant) => !participant.isLocal);
  const presenting = participants.some((participant) => participant.state.screen);

  // FaceTime mode: exactly two people, nothing pinned, nobody presenting —
  // the other person fills the screen and you become a small movable card.
  // Tapping the card swaps the two, which is how you check your own output.
  const faceTime = participants.length === 2 && !presenting && !pinnedId && Boolean(local);
  const featured = faceTime ? (swapped ? local : remote[0]) : null;
  const pipParticipant = faceTime ? (swapped ? remote[0] : local) : null;

  const localMirror = state.facing !== 'environment';
  const canFlip = state.devices.cameras.length > 1;
  const flip = canFlip ? () => void engine.flipCamera() : undefined;

  const chromeHidden = !chromeVisible;

  return (
    <div className="stage-glow relative h-dvh overflow-hidden bg-canvas text-ink">
      <Toasts notices={state.notices} onDismiss={engine.dismissNotice} />
      <ReactionLayer reactions={state.reactions} />

      {/* Header */}
      <header
        className={cn(
          'absolute inset-x-0 top-0 z-20 flex justify-center px-3 pt-[max(0.75rem,env(safe-area-inset-top))]',
          'transition-all duration-300 ease-out',
          chromeHidden && 'pointer-events-none -translate-y-3 opacity-0',
        )}
      >
        <div className="glass flex h-11 max-w-full items-center gap-3 rounded-full border border-line px-4 shadow-xl">
          <VideoLogo className="h-4 w-4 shrink-0 text-accent" />
          <button
            type="button"
            onClick={copyLink}
            title="Copy invite link"
            className="flex min-w-0 items-center gap-1.5 font-mono text-[13px] tracking-wider text-ink-muted transition-colors hover:text-ink"
          >
            <span className="truncate">{formatRoomCode(roomId)}</span>
            {copied ? (
              <CheckIcon className="h-3 w-3 shrink-0 text-accent" />
            ) : (
              <CopyIcon className="h-3 w-3 shrink-0" />
            )}
          </button>
          <span className="h-4 w-px shrink-0 bg-line" />
          <span className="shrink-0 font-mono text-[13px] text-ink-muted tabular-nums">
            {formatDuration(elapsedMs)}
          </span>
          <span className="h-4 w-px shrink-0 bg-line" />
          <span className="shrink-0 text-[13px] text-ink-muted">
            {participants.length === 1 ? '1 person' : `${participants.length} people`}
          </span>
          {state.status === 'reconnecting' && (
            <span className="flex shrink-0 items-center gap-1.5 text-[13px] text-caution">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-caution" />
              <span className="hidden sm:inline">Reconnecting</span>
            </span>
          )}
          {state.status === 'connected' && state.latencyMs !== null && (
            <span className="hidden shrink-0 font-mono text-[11px] text-ink-faint tabular-nums sm:inline">
              {state.latencyMs}ms
            </span>
          )}
        </div>
      </header>

      {/* Stage */}
      <main className="absolute inset-0 px-2 pt-[3.9rem] pb-[6.5rem] sm:px-3">
        {faceTime && featured && pipParticipant ? (
          <>
            <VideoTile
              participant={featured}
              featured
              mirror={featured.isLocal ? localMirror : true}
              onFlip={featured.isLocal ? flip : undefined}
            />
            <FloatingTile
              participant={pipParticipant}
              mirror={pipParticipant.isLocal ? localMirror : true}
              onFlip={pipParticipant.isLocal ? flip : undefined}
              onTap={() => setSwapped((current) => !current)}
            />
          </>
        ) : (
          <VideoGrid
            participants={participants}
            pinnedId={pinnedId}
            onTogglePin={togglePin}
            localMirror={localMirror}
            onFlipLocal={flip}
          />
        )}

        <InkLayer engine={engine} selfId={state.selfId} active={inkMode} />

        {participants.length === 1 && (
          <div className="absolute inset-x-0 bottom-[7.25rem] z-10 flex justify-center px-4">
            <div className="glass flex max-w-full animate-rise-spring items-center gap-3 rounded-full border border-line py-2 pr-2 pl-5 shadow-2xl">
              <span className="hidden text-sm text-ink-muted sm:inline">
                It&apos;s just you — invite someone:
              </span>
              <code className="truncate font-mono text-sm tracking-wider">
                {formatRoomCode(roomId)}
              </code>
              <Button variant="accent" size="sm" onClick={copyLink}>
                {copied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
                {copied ? 'Copied' : 'Copy link'}
              </Button>
            </div>
          </div>
        )}
      </main>

      {/* Panels */}
      <Sheet open={panel !== 'none'} onClose={() => setPanel('none')}>
        {panel === 'chat' ? (
          <ChatPanel state={state} onSend={engine.sendChat} onClose={() => setPanel('none')} />
        ) : (
          <ParticipantsPanel state={state} onClose={() => setPanel('none')} />
        )}
      </Sheet>

      {(inkMode || pttLive) && (
        <div className="pointer-events-none absolute inset-x-0 bottom-[6.75rem] z-20 flex justify-center">
          <span className="glass animate-pop rounded-full border border-line px-4 py-1.5 text-[13px] text-ink">
            {inkMode ? (
              <>
                <span className="text-accent">✏</span> Draw anywhere — ink evaporates ·{' '}
                <span className="text-ink-muted">Esc to stop</span>
              </>
            ) : (
              <>
                <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-accent align-middle" />
                Live — release Space to mute
              </>
            )}
          </span>
        </div>
      )}

      {/* Controls */}
      <footer
        className={cn(
          'absolute inset-x-0 bottom-0 z-20 px-3 pb-[max(1rem,env(safe-area-inset-bottom))]',
          'transition-all duration-300 ease-out',
          chromeHidden && 'pointer-events-none translate-y-3 opacity-0',
        )}
      >
        <ControlBar
          state={state}
          engine={engine}
          chatOpen={panel === 'chat'}
          participantsOpen={panel === 'participants'}
          inkActive={inkMode}
          onToggleInk={() => setInkMode((current) => !current)}
          onToggleChat={() => setPanel((current) => (current === 'chat' ? 'none' : 'chat'))}
          onToggleParticipants={() =>
            setPanel((current) => (current === 'participants' ? 'none' : 'participants'))
          }
          onLeave={handleLeave}
        />
      </footer>
    </div>
  );
}

/**
 * The floating card in a 1:1 call: draggable, and a tap (a press that never
 * really moves) swaps it with the main stage — so checking your own camera is
 * one touch, exactly like the native call apps.
 */
function FloatingTile({
  participant,
  mirror,
  onFlip,
  onTap,
}: {
  participant: Participant;
  mirror: boolean;
  onFlip: (() => void) | undefined;
  onTap: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
    moved: boolean;
  } | null>(null);

  const onPointerDown = (event: React.PointerEvent) => {
    const element = ref.current;
    const parent = element?.parentElement;
    if (!element || !parent) return;

    const parentRect = parent.getBoundingClientRect();
    const rect = element.getBoundingClientRect();
    // Natural (un-offset) position, so clamping stays correct across drags.
    const naturalLeft = rect.left - offset.x;
    const naturalTop = rect.top - offset.y;
    const margin = 8;

    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: offset.x,
      baseY: offset.y,
      minX: parentRect.left + margin - naturalLeft,
      maxX: parentRect.right - margin - rect.width - naturalLeft,
      minY: parentRect.top + margin - naturalTop,
      maxY: parentRect.bottom - margin - rect.height - naturalTop,
      moved: false,
    };
    element.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const current = drag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    const dx = event.clientX - current.startX;
    const dy = event.clientY - current.startY;
    if (!current.moved && dx * dx + dy * dy < 36) return; // 6px slop = still a tap
    current.moved = true;
    const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
    setOffset({
      x: clamp(current.baseX + dx, current.minX, current.maxX),
      y: clamp(current.baseY + dy, current.minY, current.maxY),
    });
  };

  const onPointerUp = () => {
    const current = drag.current;
    drag.current = null;
    if (current && !current.moved) onTap();
  };

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      role="button"
      aria-label={`Swap ${participant.name} with the main view`}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      className={cn(
        // Sits just above the control bar; the stage's own padding does not
        // constrain absolutely-positioned children.
        'absolute right-3 bottom-[7.25rem] z-10 w-32 cursor-grab touch-none select-none sm:w-48',
        'aspect-[3/4] animate-rise-spring shadow-2xl active:cursor-grabbing sm:aspect-video',
      )}
    >
      <VideoTile participant={participant} compact mirror={mirror} onFlip={onFlip} />
    </div>
  );
}
