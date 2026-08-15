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

/** Deterministic accent per participant, so avatars stay stable across renders. */
export function avatarGradient(seed: string): string {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) >>> 0;
  }
  const hue = hash % 360;
  return `linear-gradient(135deg, hsl(${hue} 62% 52%), hsl(${(hue + 48) % 360} 62% 40%))`;
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
