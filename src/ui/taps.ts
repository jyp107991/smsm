/**
 * S2 polish Q-F1: the second half of a double tap must not land on whatever a closing sheet uncovers (on
 * Home, the tab bar sits under Save: a double tap on Save would save and then switch to Activity).
 *
 * The app notes where the last tap came down. When a sheet really closes (not StrictMode's practice run of its
 * effects) straight after a tap, real taps (never scripted events) at about the same spot are ignored for a
 * moment: a double tap's second tap comes down in the same place within a few hundred milliseconds; a
 * person's next deliberate tap is elsewhere or later. A press that began while ignored is ignored to its end
 * (a long press's click comes late, but belongs to the press that was ignored).
 */
const RADIUS_PX = 48;
const WINDOW_MS = 500;
/** However a press ends, the filter stops after this long. */
const MAX_HOLD_MS = 5000;
const TYPES = ['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click'] as const;

export interface TapLike {
  type: string;
  isTrusted: boolean;
  clientX: number;
  clientY: number;
}

/**
 * The decision, kept pure: for each event, true when it is to be ignored. `spot` is where the tap that closed
 * the sheet came down; `until` when a new press there stops counting as the rest of that tap.
 */
export function createRepeatTapFilter(spot: { x: number; y: number }, until: number): (e: TapLike, now: number) => boolean {
  let holding = false;
  return (e, now) => {
    if (!e.isTrusted) return false;
    if (holding) {
      if (e.type === 'click' || e.type === 'pointercancel') holding = false;
      return true;
    }
    if (now > until || e.type === 'pointercancel') return false;
    if (Math.hypot(e.clientX - spot.x, e.clientY - spot.y) > RADIUS_PX) return false;
    if (e.type === 'pointerdown' || e.type === 'mousedown') holding = true;
    return true;
  };
}

let lastTap: { x: number; y: number; t: number } | null = null;
let watching = false;
let armed = 0;

/** Starts noting where taps come down (called by every sheet as it opens). */
export function watchTaps(): void {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  window.addEventListener('pointerdown', (e) => { lastTap = { x: e.clientX, y: e.clientY, t: performance.now() }; }, { capture: true, passive: true });
}

/** How many filters are listening (for tests). */
export function repeatTapFiltersArmed(): number {
  return armed;
}

/** A sheet has just closed: ignore a second tap at the spot of the tap that closed it. */
export function swallowRepeatTap(): void {
  if (typeof window === 'undefined' || lastTap === null) return;
  const spot = lastTap;
  const until = spot.t + WINDOW_MS;
  if (performance.now() > until) return;
  const ignore = createRepeatTapFilter(spot, until);
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    armed -= 1;
    for (const type of TYPES) window.removeEventListener(type, stop, { capture: true });
  };
  function stop(e: Event) {
    if (!(e instanceof MouseEvent)) return;
    const now = performance.now();
    if (ignore(e, now)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    } else if (now > until) {
      finish();
    }
  }
  armed += 1;
  for (const type of TYPES) window.addEventListener(type, stop, { capture: true });
  setTimeout(finish, MAX_HOLD_MS);
}
