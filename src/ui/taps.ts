/**
 * S2 polish Q-F1: the second half of a double tap must not land on whatever a closing sheet uncovers (on
 * Home, the tab bar sits under Save: a double tap on Save would save and then switch to Activity).
 *
 * The app notes where the last tap came down. When a sheet closes straight after a tap, real taps (never
 * scripted events) at about the same spot are ignored for a moment: a double tap's second tap comes down in
 * the same place within a few hundred milliseconds; a person's next deliberate tap is elsewhere or later.
 */
const RADIUS_PX = 48;
const WINDOW_MS = 500;
const TYPES = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click'] as const;

let lastTap: { x: number; y: number; t: number } | null = null;
let watching = false;

function watch(): void {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  window.addEventListener('pointerdown', (e) => { lastTap = { x: e.clientX, y: e.clientY, t: performance.now() }; }, { capture: true, passive: true });
}

/** Starts noting where taps come down (called by every sheet as it opens). */
export function watchTaps(): void {
  watch();
}

/** A sheet has just closed: ignore a second tap at the spot of the tap that closed it. */
export function swallowRepeatTap(): void {
  if (typeof window === 'undefined' || lastTap === null) return;
  const spot = lastTap;
  const until = spot.t + WINDOW_MS;
  if (performance.now() > until) return;
  const stop = (e: Event) => {
    if (!e.isTrusted || !(e instanceof MouseEvent)) return;
    if (performance.now() > until) return;
    if (Math.hypot(e.clientX - spot.x, e.clientY - spot.y) > RADIUS_PX) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  for (const type of TYPES) window.addEventListener(type, stop, { capture: true });
  setTimeout(() => {
    for (const type of TYPES) window.removeEventListener(type, stop, { capture: true });
  }, until - performance.now() + 50);
}
