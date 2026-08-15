import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { ERROR_CODES, formatRoomCode, normalizeRoomCode } from '@shared/protocol';
import { ChatPanel } from '@/components/ChatPanel';
import { ControlBar } from '@/components/ControlBar';
import { CheckIcon, CopyIcon, VideoLogo } from '@/components/Icons';
import { ParticipantsPanel } from '@/components/ParticipantsPanel';
import { Toasts } from '@/components/Toasts';
import { VideoGrid } from '@/components/VideoGrid';
import { Button } from '@/components/ui/Button';
import { CallEngine } from '@/lib/call-engine';
import { cn, copyText } from '@/lib/utils';
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
        case 'escape':
          setPanel('none');
          break;
        default:
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [engine, phase]);

  const shareUrl = useMemo(() => `${window.location.origin}/r/${roomId}`, [roomId]);

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
      <main className="aurora flex min-h-dvh flex-col items-center justify-center px-6 text-center">
        <VideoLogo className="mb-6 h-9 w-9 text-accent" />
        <h1 className="text-2xl font-semibold tracking-tight">You left the call</h1>
        <p className="mt-2 text-sm text-ink-muted">Room {formatRoomCode(roomId)}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button
            variant="primary"
            onClick={() => {
              setPhase('lobby');
              setLobbyError(null);
            }}
          >
            Rejoin
          </Button>
          <Link to="/">
            <Button variant="secondary">Back to home</Button>
          </Link>
        </div>
      </main>
    );
  }

  const panelOpen = panel !== 'none';

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-canvas">
      <Toasts notices={state.notices} onDismiss={engine.dismissNotice} />

      <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-line px-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <VideoLogo className="h-5 w-5 shrink-0 text-accent" />
          <code className="truncate font-mono text-sm tracking-wider text-ink-muted">
            {formatRoomCode(roomId)}
          </code>
          <button
            type="button"
            onClick={copyLink}
            className="hidden shrink-0 items-center gap-1.5 rounded-lg border border-line px-2.5 py-1 text-xs text-ink-muted transition-colors hover:border-line-bright hover:text-ink sm:inline-flex"
          >
            {copied ? (
              <CheckIcon className="h-3 w-3 text-positive" />
            ) : (
              <CopyIcon className="h-3 w-3" />
            )}
            {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-3 text-xs text-ink-faint">
          {state.status === 'reconnecting' && (
            <span className="flex items-center gap-1.5 text-caution">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-caution" />
              Reconnecting
            </span>
          )}
          {state.status === 'connected' && state.latencyMs !== null && (
            <span className="hidden sm:inline">{state.latencyMs} ms</span>
          )}
          <span>
            {state.participants.length} {state.participants.length === 1 ? 'person' : 'people'}
          </span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className={cn('min-w-0 flex-1 p-3 sm:p-4', panelOpen && 'hidden lg:block')}>
          {state.participants.length === 1 ? (
            <div className="flex h-full flex-col gap-4 lg:flex-row">
              <div className="min-h-0 flex-1">
                <VideoGrid
                  participants={state.participants}
                  pinnedId={pinnedId}
                  onTogglePin={togglePin}
                />
              </div>
              <div className="flex shrink-0 flex-col justify-center rounded-2xl border border-dashed border-line p-6 text-center lg:w-72">
                <h2 className="text-sm font-semibold">You&apos;re the only one here</h2>
                <p className="mt-1.5 text-xs leading-relaxed text-ink-muted">
                  Share this link and anyone can join straight from their browser.
                </p>
                <code className="mt-3 truncate rounded-lg bg-surface-2 px-3 py-2 text-[11px] text-ink-muted">
                  {shareUrl}
                </code>
                <Button variant="primary" size="sm" onClick={copyLink} className="mt-3">
                  {copied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
                  {copied ? 'Copied' : 'Copy invite link'}
                </Button>
              </div>
            </div>
          ) : (
            <VideoGrid
              participants={state.participants}
              pinnedId={pinnedId}
              onTogglePin={togglePin}
            />
          )}
        </main>

        {panelOpen && (
          <div className="w-full shrink-0 lg:w-88">
            {panel === 'chat' ? (
              <ChatPanel state={state} onSend={engine.sendChat} onClose={() => setPanel('none')} />
            ) : (
              <ParticipantsPanel state={state} onClose={() => setPanel('none')} />
            )}
          </div>
        )}
      </div>

      <footer className="shrink-0 px-4 pt-2 pb-4 sm:pb-5">
        <ControlBar
          state={state}
          engine={engine}
          chatOpen={panel === 'chat'}
          participantsOpen={panel === 'participants'}
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
