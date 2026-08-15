import { describe, expect, it } from 'vitest';

import {
  MAX_MESSAGE_BYTES,
  decodeClientMessage,
  encode,
  formatRoomCode,
  isPolite,
  normalizeRoomCode,
} from '../shared/protocol.ts';

describe('room codes', () => {
  it('normalizes case, spaces and dashes so any transcription of a code works', () => {
    expect(normalizeRoomCode('  AbCd-EfGh ')).toBe('abcdefgh');
    expect(normalizeRoomCode('ab cd ef gh')).toBe('abcdefgh');
  });

  it('formats eight-character codes into readable halves', () => {
    expect(formatRoomCode('abcdefgh')).toBe('abcd-efgh');
    expect(formatRoomCode('short')).toBe('short');
  });
});

describe('decodeClientMessage', () => {
  it('accepts a well-formed join and normalizes the room code', () => {
    const result = decodeClientMessage(
      encode({
        type: 'join',
        roomId: 'ABCD-EFGH',
        name: 'Rishabh',
        state: { audio: true, video: true, screen: false },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.type).toBe('join');
    if (result.value.type !== 'join') return;
    expect(result.value.roomId).toBe('abcdefgh');
  });

  it('rejects malformed JSON instead of throwing', () => {
    const result = decodeClientMessage('{not json');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/JSON/);
  });

  it('rejects an unknown message type', () => {
    const result = decodeClientMessage(JSON.stringify({ type: 'drop-tables' }));
    expect(result.ok).toBe(false);
  });

  it('rejects a join with no display name', () => {
    const result = decodeClientMessage(
      JSON.stringify({
        type: 'join',
        roomId: 'abcdefgh',
        name: '   ',
        state: { audio: true, video: true, screen: false },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('rejects oversized frames before attempting to parse them', () => {
    const result = decodeClientMessage('x'.repeat(MAX_MESSAGE_BYTES + 1));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/maximum allowed size/);
  });

  it('rejects a signal addressed to a non-uuid peer', () => {
    const result = decodeClientMessage(
      JSON.stringify({
        type: 'signal',
        to: 'not-a-uuid',
        payload: { kind: 'candidate', candidate: { candidate: 'a' } },
      }),
    );
    expect(result.ok).toBe(false);
  });

  it('trims chat text and rejects an empty message', () => {
    const ok = decodeClientMessage(JSON.stringify({ type: 'chat', text: '  hello  ' }));
    expect(ok.ok).toBe(true);
    if (ok.ok && ok.value.type === 'chat') expect(ok.value.text).toBe('hello');

    expect(decodeClientMessage(JSON.stringify({ type: 'chat', text: '   ' })).ok).toBe(false);
  });
});

describe('isPolite', () => {
  it('designates exactly one side of every pair as polite', () => {
    const a = '00000000-0000-4000-8000-000000000001';
    const b = '00000000-0000-4000-8000-000000000002';
    expect(isPolite(a, b)).toBe(true);
    expect(isPolite(b, a)).toBe(false);
    // Both peers must agree, which is the whole point of deriving it from ids.
    expect(isPolite(a, b)).not.toBe(isPolite(b, a));
  });
});
