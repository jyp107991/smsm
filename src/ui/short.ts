/**
 * S9b (finding 16, review 3): how short this screen is, so Home draws itself closer together and Quick add and Settle
 * up stay above the tab bar. Read from the tallest the window has been at its current width, never from the window as
 * it is now: the on-screen keyboard shrinks the window (index.html sets `interactive-widget=resizes-content`), and
 * Home must not rearrange itself while someone types. Set on <html> as `data-short` before the first paint (the
 * script in index.html, which uses the same limits) and kept up to date here when the window turns or grows.
 *   "1"  under 760 px tall: Home's column closer together, the plank and animals smaller (rig.css, Home.tsx).
 *   "2"  under 600 px tall: also, the banners come after Quick add rather than above the balance.
 */
import { useSyncExternalStore } from 'react';

/** The limits, in CSS px (kept with index.html's first-paint script). */
export const SHORT = 760;
export const TINY = 600;

export type ShortTier = 0 | 1 | 2;

export function tierFor(height: number): ShortTier {
  return height < TINY ? 2 : height < SHORT ? 1 : 0;
}

const tallest = new Map<number, number>();
const listeners = new Set<() => void>();
let installed = false;

function read(): ShortTier {
  if (typeof document === 'undefined') return 0;
  const v = document.documentElement.dataset.short;
  return v === '2' ? 2 : v === '1' ? 1 : 0;
}

function update(): void {
  const width = Math.round(window.innerWidth);
  const most = Math.max(tallest.get(width) ?? 0, window.innerHeight);
  tallest.set(width, most);
  const tier = tierFor(most);
  if (tier === read()) return;
  if (tier === 0) delete document.documentElement.dataset.short;
  else document.documentElement.dataset.short = String(tier);
  for (const l of listeners) l();
}

/** Starts following the window (once). */
export function installShort(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  update();
  window.addEventListener('resize', update);
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

export function useShortTier(): ShortTier {
  return useSyncExternalStore(subscribe, read, () => 0);
}
