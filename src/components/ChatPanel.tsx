import { useEffect, useRef, useState } from 'react';

import { LIMITS } from '@shared/protocol';
import type { CallState } from '@/lib/call-engine';
import { avatarGradient, cn, formatTime, initials } from '@/lib/utils';
import { ChatIcon, CloseIcon, SendIcon } from './Icons';

interface ChatPanelProps {
  state: CallState;
  onSend: (text: string) => void;
  onClose: () => void;
}

export function ChatPanel({ state, onSend, onClose }: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const atBottomRef = useRef(true);

  // Follow new messages, but only when the reader is already at the bottom —
  // yanking someone away from scrollback is worse than a missed message.
  useEffect(() => {
    if (!atBottomRef.current) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [state.messages]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
    // Reset the autogrow.
    if (inputRef.current) inputRef.current.style.height = 'auto';
  };

  return (
    <aside className="flex h-full w-full flex-col bg-surface lg:border-l lg:border-line">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-line px-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <ChatIcon className="h-4 w-4 text-ink-muted" />
          Chat
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="rounded-lg p-1.5 text-ink-faint transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <CloseIcon className="h-4 w-4" />
        </button>
      </header>

      <div
        ref={listRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          atBottomRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 60;
        }}
        className="flex-1 space-y-4 overflow-y-auto px-4 py-4"
      >
        {state.messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <ChatIcon className="h-8 w-8 text-ink-faint/60" />
            <p className="text-sm text-ink-faint">No messages yet.</p>
            <p className="max-w-[22ch] text-xs text-ink-faint/70">
              Messages are visible to everyone in the call and are not stored.
            </p>
          </div>
        )}

        {state.messages.map((message, index) => {
          const own = message.from === state.selfId;
          const previous = state.messages[index - 1];
          // Group consecutive messages from one person within two minutes.
          const grouped = previous?.from === message.from && message.ts - previous.ts < 120_000;

          return (
            <div key={message.id} className={cn('flex gap-2.5', grouped && '-mt-3')}>
              <div className="w-8 shrink-0">
                {!grouped && (
                  <div
                    className="flex h-8 w-8 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                    style={{ background: avatarGradient(message.from) }}
                  >
                    {initials(message.name)}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                {!grouped && (
                  <div className="mb-1 flex items-baseline gap-2">
                    <span className="truncate text-[13px] font-medium">
                      {own ? 'You' : message.name}
                    </span>
                    <span className="shrink-0 text-[11px] text-ink-faint">
                      {formatTime(message.ts)}
                    </span>
                  </div>
                )}
                <p className="text-sm leading-relaxed break-words whitespace-pre-wrap text-ink/90">
                  {message.text}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <div className="shrink-0 border-t border-line p-3">
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-surface-2 p-2 transition-colors focus-within:border-accent">
          <textarea
            ref={inputRef}
            value={draft}
            rows={1}
            maxLength={LIMITS.chatText.max}
            placeholder="Send a message"
            onChange={(event) => {
              setDraft(event.target.value);
              const element = event.target;
              element.style.height = 'auto';
              element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
            }}
            onKeyDown={(event) => {
              // Enter sends; Shift+Enter is a newline, as in every chat app.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            className="max-h-30 flex-1 resize-none bg-transparent px-1.5 py-1 text-sm text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!draft.trim()}
            aria-label="Send message"
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-all',
              draft.trim()
                ? 'bg-accent text-white hover:bg-accent-bright'
                : 'bg-surface-3 text-ink-faint',
            )}
          >
            <SendIcon className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
