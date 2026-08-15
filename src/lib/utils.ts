import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}

/**
 * Copies text, falling back to a hidden textarea where the async clipboard API
 * is unavailable (older Safari, and any non-secure context).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Curated earthy palette for avatars — deterministic per participant, and far
 * more "designed" than random HSL. All pass contrast with cream text.
 */
const AVATAR_PALETTE = [
  '#b3512c', // rust
  '#77893a', // olive
  '#3f7059', // pine
  '#3f6e7e', // petrol
  '#96684a', // clay
  '#7e4e63', // plum
  '#a3842b', // ochre
  '#5c6b7a', // slate
] as const;

export function avatarColor(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length] as string;
}

/** Small stable hash for deriving per-item animation params (0..1). */
export function seededUnit(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619);
  }
  return ((hash >>> 0) % 1000) / 1000;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase();
}

export function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** 65s → "1:05" · 3 665s → "1:01:05". For the in-call timer. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const mm = hours > 0 ? String(minutes).padStart(2, '0') : String(minutes);
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/**
 * Chooses a grid that keeps tiles as close to 16:9 as possible for the given
 * count and container aspect ratio, rather than hard-coding breakpoints.
 */
export function gridDimensions(count: number, aspect: number): { columns: number; rows: number } {
  if (count <= 1) return { columns: 1, rows: 1 };

  let best = { columns: count, rows: 1 };
  let bestScore = Number.POSITIVE_INFINITY;

  for (let columns = 1; columns <= count; columns += 1) {
    const rows = Math.ceil(count / columns);
    const tileAspect = aspect / (columns / rows);
    // Distance from 16:9, in log space so squashing and stretching cost equally.
    const score = Math.abs(Math.log(tileAspect / (16 / 9)));
    if (score < bestScore) {
      bestScore = score;
      best = { columns, rows };
    }
  }
  return best;
}
