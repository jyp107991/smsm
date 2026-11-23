/**
 * S9b (DESIGN §4.11): larger screens. From 900 px wide the tabs are a left side rail, Activity shows an entry beside
 * its list, and sheets open as centred dialogs. Below that, the phone layout, unchanged. The layout itself is CSS
 * (`min-[900px]:` utilities, WIDE_QUERY below); this tells the few pieces that must also behave differently (the
 * tabs' arrow keys, the two panes, a sheet's dragging) which one is on screen.
 */
import { useSyncExternalStore } from 'react';

/** The width from which the larger-screen layout applies. Kept with the `min-[900px]:` utilities. */
export const WIDE_QUERY = '(min-width: 900px)';

function query(): MediaQueryList | null {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return null;
  return window.matchMedia(WIDE_QUERY);
}

function subscribe(onChange: () => void): () => void {
  const q = query();
  if (!q) return () => undefined;
  q.addEventListener('change', onChange);
  return () => { q.removeEventListener('change', onChange); };
}

/** True while the screen is at least 900 px wide. */
export function isWide(): boolean {
  return query()?.matches ?? false;
}

export function useWide(): boolean {
  return useSyncExternalStore(subscribe, isWide, () => false);
}
