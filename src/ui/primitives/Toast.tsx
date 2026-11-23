import { createContext, use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { X } from 'lucide-react';
import { strings } from '../strings';
import { cx, ICON } from './util';
import './toast.css';

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface ToastOptions {
  /** What just happened, in the past tense ("Saved", "Deleted Tesco"). */
  message: string;
  /** One action, usually Undo. Pressing it also dismisses the toast. */
  action?: ToastAction;
  /** Shown before the message, e.g. the payer's animal head. */
  icon?: ReactNode;
  /** Milliseconds before it goes by itself; 0 keeps it until dismissed. Default 4 s, or 5 s with an action (ADD-6). */
  duration?: number;
  /**
   * Stays until it is dismissed or acted on (the update prompt, Q-L1). A passing toast takes the slot over
   * it for its few seconds; when that one goes, this one comes back. A new sticky toast replaces the old one.
   */
  sticky?: boolean;
  /**
   * The id of the row this toast reports (S2 polish Q-U8): the toast keeps clear of that row (`data-row`) as it
   * does of the tab bar, so "Saved Tesco £42.50" never covers the new Tesco line.
   */
  about?: string;
}

export interface ToastApi {
  /** Shows a toast and returns its id. */
  show: (toast: ToastOptions) => number;
  dismiss: (id: number) => void;
}

export interface ToastEntry extends ToastOptions {
  id: number;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * One toast at a time: a new one replaces the one showing (as Android's snackbars do), so a stale Undo is
 * never left beside a new one and the live region reads one message.
 */
const MAX_VISIBLE = 1;

/** The toast that shows: the newest passing one, or else the sticky one under it. */
function showing(toasts: readonly ToastEntry[]): ToastEntry | undefined {
  return toasts.findLast((t) => !t.sticky) ?? toasts.findLast((t) => t.sticky);
}

/** The toast functions from the nearest ToastProvider. */
export function useToast(): ToastApi {
  const api = use(ToastContext);
  if (!api) throw new Error('useToast needs a <ToastProvider> above it');
  return api;
}

/**
 * Holds the toast stack and renders it at the bottom of the screen, clear of what must stay visible (the tab
 * bar, Quick add, an open sheet's footer: see `useClearPlace`). One toast system for the whole page: a
 * provider inside another one (the app's screens inside the shell that shows the update prompt) uses the
 * outer one, so there is only ever one live region.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const outer = use(ToastContext);
  if (outer) return children;
  return <OwnToasts>{children}</OwnToasts>;
}

function OwnToasts({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((toast: ToastOptions) => {
    const id = nextId.current++;
    // One passing toast at a time (MAX_VISIBLE), over at most one sticky one.
    setToasts((all) => {
      const sticky = all.filter((t) => t.sticky);
      const passing = all.filter((t) => !t.sticky);
      const entry = { ...toast, id };
      return toast.sticky ? [...passing, entry] : [...sticky, ...[...passing, entry].slice(-MAX_VISIBLE)];
    });
    return id;
  }, []);

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext value={api}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ToastContext>
  );
}

/**
 * The stack itself (also usable on its own, e.g. in the gallery). It is the one persistent live region
 * (`role="status"`, always in the page), so every toast is announced politely without moving focus:
 * a live region created together with its message is often not read at all.
 *
 * It has one slot. A new toast takes the slot at once, replacing what it shows, and never waits for the old
 * toast to animate out: "Saved" appears the moment a save is made, and a replaced toast's Undo is gone the
 * same moment (ADD-6). Only when the slot empties does the toast animate out.
 */
export function ToastStack({ toasts, onDismiss }: { toasts: ToastEntry[]; onDismiss: (id: number) => void }) {
  const current = showing(toasts);
  // S9 (performance audit P4): the slot comes and goes with CSS animations (toast.css), not a JS animation
  // library measuring the card: the last toast stays for its short exit, inert, then goes.
  const [leaving, setLeaving] = useState<ToastEntry | null>(null);
  const [last, setLast] = useState<ToastEntry | undefined>(current);
  if (current !== last) {
    setLast(current);
    setLeaving(current === undefined && last !== undefined ? last : null);
  }
  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => { setLeaving(null); }, EXIT_MS);
    return () => { clearTimeout(timer); };
  }, [leaving]);
  const layer = useRef<HTMLDivElement>(null);
  const place = useClearPlace(layer, current !== undefined, current?.about);
  // Toasts already read out: the update prompt coming back after a passing toast isn't read again.
  const [announced] = useState(() => new Set<number>());
  // S9b (ADD-6): a sheet with no room above it (the full Add sheet) hides the toast until it closes; it then comes
  // back for its whole time, so its Undo is never lost behind the sheet.
  const slot = place.hidden ? null : (current ?? leaving);
  return (
    <div
      ref={layer}
      role="status"
      // S9b (ADD-6): an explicit live region, so an open sheet (a modal dialog, which hides the rest of the page from
      // assistive tech) leaves the toast and its Undo readable and pressable.
      aria-live="polite"
      aria-label={strings.ui.notifications}
      data-toast-layer=""
      style={place.top !== null ? { top: `${String(place.top)}px` } : { bottom: `max(${String(place.bottom)}px, calc(env(safe-area-inset-bottom) + 1rem))` }}
      className="pointer-events-none fixed inset-x-0 z-[90] flex flex-col items-center gap-2 px-4"
    >
      {slot ? <ToastSlot toast={slot} present={current !== undefined} onDismiss={onDismiss} announced={announced} /> : null}
    </div>
  );
}

/** Taps and focus in the toast layer are not "outside" an open sheet: pressing Undo never closes the sheet. */
export function inToastLayer(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-toast-layer]') !== null;
}

/** The exit's length (toast.css), in ms. */
const EXIT_MS = 180;

/** The room kept between a toast and what it stays clear of, in px. */
const CLEARANCE = 12;
/** The least room at the screen's edges, in px. */
const EDGE = 16;

/** How long to keep measuring every frame after something changed (a sheet rising or closing takes ~500 ms). */
const SETTLE_MS = 700;

/**
 * Where the toast goes so it never covers what must stay in view (Q-L4): anything marked `data-toast-avoid`
 * (the tab bar, the Quick add box, an open sheet's footer). It starts at the bottom and steps up over each
 * marked thing it would cover; if that would push it off the top, it sits at the top instead. While a sheet
 * is open the toast never covers the sheet at all (S9b, ADD-6: `besideSheet`); a sheet that is closing counts
 * for nothing, so the tab bar is avoided again the moment Save is pressed.
 *
 * Measured before the first paint, then only when something changes: the window or the visual viewport
 * resizes or scrolls, a marked element or the toast changes size, or a sheet opens or closes. After each
 * change it follows every frame for a short while (sheets slide), then stops, so a toast that stays (the
 * update prompt) costs nothing while nothing moves.
 */
function useClearPlace(layer: RefObject<HTMLDivElement | null>, active: boolean, about: string | undefined): Place {
  const [place, setPlace] = useState<Place>({ bottom: EDGE, top: null, hidden: false });
  // The card's last size, for working out where it would go while it is hidden.
  const lastCard = useRef<{ height: number; left: number; right: number } | null>(null);
  useLayoutEffect(() => {
    if (!active) return;
    let frame = 0;
    let until = 0;
    const measure = () => {
      const card = layer.current?.firstElementChild;
      if (card instanceof HTMLElement) {
        const r = card.getBoundingClientRect();
        if (r.height > 0) lastCard.current = { height: r.height, left: r.left, right: r.right };
      }
      const box = lastCard.current ?? { height: 64, left: EDGE, right: window.innerWidth - EDGE };
      const next = clearPlace(box, about);
      setPlace((was) => (was.bottom === next.bottom && was.top === next.top && was.hidden === next.hidden ? was : next));
    };
    const loop = () => {
      frame = 0;
      measure();
      if (performance.now() < until) frame = requestAnimationFrame(loop);
    };
    const changed = () => {
      until = performance.now() + SETTLE_MS;
      if (frame === 0) frame = requestAnimationFrame(loop);
    };
    // (Not every test browser has a ResizeObserver; scrolling and resizing still re-measure without it.)
    const sized = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(changed);
    const watchMarks = () => {
      if (!sized) return;
      sized.disconnect();
      for (const m of document.querySelectorAll('[data-toast-avoid]')) sized.observe(m);
      const card = layer.current?.firstElementChild;
      if (card) sized.observe(card);
    };
    const mutated = new MutationObserver(() => {
      watchMarks();
      changed();
    });
    // Sheets coming and going (their state and their marks), the tab bar hiding for the keyboard.
    // Text changing (a total, a line that wraps) can move what the toast avoids too.
    mutated.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-state', 'data-toast-avoid', 'data-row', 'hidden'] });
    const viewport = window.visualViewport;
    window.addEventListener('resize', changed);
    window.addEventListener('scroll', changed, { capture: true, passive: true });
    viewport?.addEventListener('resize', changed);
    viewport?.addEventListener('scroll', changed);
    watchMarks();
    // Before the first paint, so a toast never flashes over the tab bar; then follow whatever is settling.
    measure();
    changed();
    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      sized?.disconnect();
      mutated.disconnect();
      window.removeEventListener('resize', changed);
      window.removeEventListener('scroll', changed, { capture: true });
      viewport?.removeEventListener('resize', changed);
      viewport?.removeEventListener('scroll', changed);
    };
  }, [layer, active, about]);
  // With no toast to place, nothing is hidden (a hidden one comes back in full when the sheet goes).
  return active || !place.hidden ? place : { ...place, hidden: false };
}

/**
 * The visible page's bottom edge, in the page's coordinates. On iPhone the keyboard covers the page without
 * shrinking it (Safari ignores `interactive-widget`); only the visual viewport knows where the keyboard starts.
 */
function visibleBottom(): number {
  const viewport = window.visualViewport;
  return viewport ? Math.min(window.innerHeight, viewport.offsetTop + viewport.height) : window.innerHeight;
}

interface Place {
  bottom: number;
  top: number | null;
  /** S9b: an open sheet leaves no room for it. */
  hidden: boolean;
}

/** Where a sheet comes to rest: its box without the slide it is still making (vaul rises with a transform). */
function restingBox(el: Element): { top: number; bottom: number } {
  const r = el.getBoundingClientRect();
  const t = getComputedStyle(el).transform;
  const m = /^matrix(3d)?\(([^)]+)\)$/.exec(t);
  const parts = m?.[2]?.split(',').map(Number) ?? [];
  const ty = (m?.[1] ? parts[13] : parts[5]) ?? 0;
  return { top: r.top - (Number.isFinite(ty) ? ty : 0), bottom: r.bottom - (Number.isFinite(ty) ? ty : 0) };
}

/**
 * S9b (ADD-6): with a sheet open, the toast never covers it. It goes below the sheet if there is room there (a
 * centred dialog on a large screen), else above the sheet's top edge, else (the full-height Add sheet) it is hidden
 * until the sheet closes.
 */
function besideSheet(sheets: readonly Element[], tall: number): Place | null {
  const boxes = sheets.map(restingBox).filter((b) => b.bottom > b.top);
  if (boxes.length === 0) return null;
  const height = visibleBottom();
  const viewTop = window.visualViewport?.offsetTop ?? 0;
  const page = window.innerHeight;
  const top = Math.min(...boxes.map((b) => b.top));
  const bottom = Math.max(...boxes.map((b) => b.bottom));
  if (bottom + CLEARANCE + tall <= height - EDGE) return { bottom: EDGE + Math.max(0, Math.round(page - height)), top: null, hidden: false };
  const above = Math.floor(top - CLEARANCE - tall);
  if (above >= viewTop + EDGE) return { bottom: EDGE, top: above, hidden: false };
  return { bottom: EDGE, top: null, hidden: true };
}

function clearPlace(card: { height: number; left: number; right: number }, about: string | undefined): Place {
  const page = window.innerHeight;
  const height = visibleBottom();
  const tall = card.height || 64;
  const sheets = [...document.querySelectorAll('[role="dialog"][data-state="open"]')];
  const placed = besideSheet(sheets, tall);
  if (placed) return placed;
  // Row ids are uuids; anything else is not looked for.
  const row = about !== undefined && /^[\w-]+$/.test(about) ? `, [data-row="${about}"]` : '';
  const marked = [...document.querySelectorAll<HTMLElement>(`[data-toast-avoid]${row}`)];
  // With no sheet open (above), the page's marks; a sheet sliding away (data-state="closed") counts for nothing.
  const rects = marked.filter((m) => !m.closest('[role="dialog"]'))
    .map((m) => m.getBoundingClientRect())
    .filter((r) => r.height > 0 && r.width > 0 && r.bottom > 0 && r.top < height && r.left < card.right && card.left < r.right);
  let bottom = EDGE;
  for (let moved = true, rounds = 0; moved && rounds < 8; rounds += 1) {
    moved = false;
    for (const r of rects) {
      const toastBottom = height - bottom;
      const toastTop = toastBottom - tall;
      if (r.top < toastBottom + CLEARANCE && r.bottom > toastTop - CLEARANCE && height - r.top + CLEARANCE > bottom) {
        bottom = Math.ceil(height - r.top + CLEARANCE);
        moved = true;
      }
    }
  }
  const viewTop = window.visualViewport?.offsetTop ?? 0;
  // `bottom` is measured from the visible bottom; the layer is placed from the page's.
  return height - bottom - tall < viewTop + EDGE
    ? { bottom: EDGE, top: Math.round(viewTop) + EDGE, hidden: false }
    : { bottom: bottom + Math.max(0, Math.round(page - height)), top: null, hidden: false };
}

/**
 * The slot. While the last toast plays its exit it is still on screen, so it is made inert and hidden from
 * assistive tech: its Undo can't be pressed once it is going. A toast shown meanwhile takes the slot back.
 * No layout animation: the layer is moved clear of the tab bar as the toast arrives (useClearPlace), and
 * animating that move slid the toast up over the tab bar for a moment (owner, 17 Nov: "clipping"). It rises
 * less than the room it keeps (CLEARANCE), so even arriving it never touches what it avoids.
 */
function ToastSlot({ toast, present, onDismiss, announced }: {
  toast: ToastEntry;
  present: boolean;
  onDismiss: (id: number) => void;
  announced: Set<number>;
}) {
  return (
    <div className={cx('toast-slot w-full max-w-md', present ? 'pointer-events-auto' : 'toast-leaving pointer-events-none')}>
      <div inert={!present} aria-hidden={present ? undefined : true}>
        {/* Keyed by toast: a replacement starts its own timer and makes its own small arrival. */}
        <Arrival key={toast.id} id={toast.id} announced={announced}>
          <Toast {...toast} onDismiss={() => { onDismiss(toast.id); }} />
        </Arrival>
      </div>
    </div>
  );
}

/**
 * One toast's arrival in the slot. The first time a toast shows it is read out by the live region; when it
 * comes back (the sticky update prompt after a passing toast), its content is marked `aria-live="off"`, so it
 * is shown again without being announced again.
 */
function Arrival({ id, announced, children }: { id: number; announced: Set<number>; children: ReactNode }) {
  const [quiet] = useState(() => announced.has(id));
  useEffect(() => { announced.add(id); }, [announced, id]);
  return (
    <div aria-live={quiet ? 'off' : undefined} className="toast-arrival">
      {children}
    </div>
  );
}

export interface ToastProps extends ToastOptions {
  onDismiss: () => void;
}

/** One toast. Announced by the stack's live region; on its own (the gallery) it is a plain group. */
export function Toast({ message, action, icon, duration, onDismiss }: ToastProps) {
  const ms = duration ?? (action ? 5000 : 4000);
  const [paused, setPaused] = useState(false);
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (ms <= 0 || paused) return;
    const timer = setTimeout(() => {
      dismissRef.current();
    }, ms);
    return () => {
      clearTimeout(timer);
    };
  }, [ms, paused]);

  return (
    <div
      // Moving into it with the keyboard holds it on screen (WCAG 2.2.1). Not on hover: on a phone there
      // is none, and a toast appearing under a resting mouse pointer would never go.
      onFocus={() => { setPaused(true); }}
      onBlur={() => { setPaused(false); }}
      className="bg-surface text-ink shadow-float flex min-h-14 w-full items-center gap-3 rounded-[16px] py-1.5 pr-1.5 pl-4"
    >
      {icon ? <span className="flex shrink-0 items-center" aria-hidden="true">{icon}</span> : null}
      <p className="min-w-0 flex-1 py-2 break-words">{message}</p>
      {action ? (
        <button
          type="button"
          onClick={() => {
            action.onAction();
            onDismiss();
          }}
          className="text-forest press min-h-11 shrink-0 rounded-full px-3 font-semibold"
        >
          {action.label}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={strings.ui.dismiss}
        className={cx('text-ink-2 press hover:text-ink inline-flex size-11 shrink-0 items-center justify-center rounded-full')}
      >
        <X size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" />
      </button>
    </div>
  );
}
