/**
 * S9 (performance audit P2): the static first paint in index.html (`#boot`), the shape of Home drawn before any
 * script, lies over the page until the app has drawn its first real screen; then it goes in the same frame
 * (`useBootDone`), so nothing jumps. Home remembers where its balance sits (the banners above it, its height)
 * for the next start, and a phone that is signed out remembers that, so its first paint is the plain paper.
 */
import { useLayoutEffect } from 'react';

const KEY = 'smsm-boot';

let shown = false;
let painted = false;
const waiting: (() => void)[] = [];

/** Removes the first paint (once; later calls do nothing): the first real screen is being drawn. */
export function dismissBoot(): void {
  if (typeof document === 'undefined') return;
  document.getElementById('boot')?.remove();
  if (shown) return;
  shown = true;
  // After that screen has painted, and the phone is idle: what can wait for it starts (whenFirstScreen).
  const go = () => {
    painted = true;
    for (const w of waiting.splice(0)) w();
  };
  const idle = () => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 2000 });
    else setTimeout(go, 200);
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { setTimeout(idle, 0); });
  else setTimeout(idle, 0);
}

/**
 * Resolves once the first real screen has painted and the phone is next idle. What the first screen doesn't
 * need waits for this, so it never competes with it for the network or the processor: the Korean font rules,
 * the animation library's features, the other screens.
 */
export function whenFirstScreen(): Promise<void> {
  if (painted) return Promise.resolve();
  return new Promise((resolve) => { waiting.push(resolve); });
}

/** The first paint goes as the screen calling this is drawn. */
export function useBootDone(): void {
  useLayoutEffect(dismissBoot, []);
}

function save(value: { home: boolean; above?: number; balance?: number }): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    /* private mode: the next start draws the default shape */
  }
}

/**
 * Home's shape for the next first paint: the room between the header and the balance (banners), and the
 * balance's height. Measured when the phone is idle, after Home has painted, never while it is drawn.
 */
export function rememberHome(header: HTMLElement | null, balance: HTMLElement | null): () => void {
  const run = () => {
    if (!header || !balance || !header.isConnected || !balance.isConnected) return;
    const h = header.getBoundingClientRect();
    const b = balance.getBoundingClientRect();
    // From the header's foot to the balance's top: the column's gap (in the first paint already) and any banners.
    save({ home: true, above: Math.max(0, Math.round(b.top - h.bottom)), balance: Math.round(b.height) });
  };
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(run, { timeout: 4000 });
    return () => { cancelIdleCallback(id); };
  }
  const id = setTimeout(run, 1500);
  return () => { clearTimeout(id); };
}

/** A screen that isn't Home starts this phone (sign-in, setup): its first paint is the plain paper. */
export function rememberNotHome(): void {
  save({ home: false });
}
