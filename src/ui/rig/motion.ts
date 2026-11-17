import { useSyncExternalStore } from 'react';

/**
 * Whether the person has asked their device for reduced motion (DESIGN §3.4).
 * Safe where matchMedia is missing (tests, very old browsers): then motion is allowed.
 */
const QUERY = '(prefers-reduced-motion: reduce)';

function mediaQuery(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  try {
    return window.matchMedia(QUERY);
  } catch {
    return null;
  }
}

function subscribe(onChange: () => void): () => void {
  const mql = mediaQuery();
  if (!mql) return () => undefined;
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', onChange);
    return () => {
      mql.removeEventListener('change', onChange);
    };
  }
  return () => undefined;
}

function snapshot(): boolean {
  return mediaQuery()?.matches === true;
}

function serverSnapshot(): boolean {
  return false;
}

export function prefersReducedMotion(): boolean {
  return snapshot();
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
