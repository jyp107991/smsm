import { createContext, use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import { X } from 'lucide-react';
import { strings } from '../strings';
import { cx, ICON } from './util';

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
  const reduce = useReducedMotion() ?? false;
  const current = showing(toasts);
  const layer = useRef<HTMLDivElement>(null);
  const place = useClearPlace(layer, current !== undefined, current?.about);
  // Toasts already read out: the update prompt coming back after a passing toast isn't read again.
  const [announced] = useState(() => new Set<number>());
  return (
    <div
      ref={layer}
      role="status"
      aria-label={strings.ui.notifications}
      style={place.top !== null ? { top: `${String(place.top)}px` } : { bottom: `max(${String(place.bottom)}px, calc(env(safe-area-inset-bottom) + 1rem))` }}
      className="pointer-events-none fixed inset-x-0 z-[90] flex flex-col items-center gap-2 px-4"
    >
      <AnimatePresence initial={false}>
        {current ? <ToastSlot key="toast" toast={current} reduce={reduce} onDismiss={onDismiss} announced={announced} /> : null}
      </AnimatePresence>
    </div>
  );
}

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
 * is open only the sheet's own marks count (the page under the scrim can be covered); a sheet that is
 * closing counts for nothing, so the tab bar is avoided again the moment Save is pressed.
 *
 * Measured before the first paint, then only when something changes: the window or the visual viewport
 * resizes or scrolls, a marked element or the toast changes size, or a sheet opens or closes. After each
 * change it follows every frame for a short while (sheets slide), then stops, so a toast that stays (the
 * update prompt) costs nothing while nothing moves.
 */
function useClearPlace(layer: RefObject<HTMLDivElement | null>, active: boolean, about: string | undefined): { bottom: number; top: number | null } {
  const [place, setPlace] = useState<{ bottom: number; top: number | null }>({ bottom: EDGE, top: null });
  useLayoutEffect(() => {
    if (!active) return;
    let frame = 0;
    let until = 0;
    const measure = () => {
      const card = layer.current?.firstElementChild;
      if (card instanceof HTMLElement) {
        const next = clearPlace(card.getBoundingClientRect(), about);
        setPlace((was) => (was.bottom === next.bottom && was.top === next.top ? was : next));
      }
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
    mutated.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-state', 'data-toast-avoid', 'data-row', 'hidden'] });
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
  return place;
}

/**
 * The visible page's bottom edge, in the page's coordinates. On iPhone the keyboard covers the page without
 * shrinking it (Safari ignores `interactive-widget`); only the visual viewport knows where the keyboard starts.
 */
function visibleBottom(): number {
  const viewport = window.visualViewport;
  return viewport ? Math.min(window.innerHeight, viewport.offsetTop + viewport.height) : window.innerHeight;
}

function clearPlace(card: DOMRect, about: string | undefined): { bottom: number; top: number | null } {
  const page = window.innerHeight;
  const height = visibleBottom();
  const tall = card.height || 64;
  // Row ids are uuids; anything else is not looked for.
  const row = about !== undefined && /^[\w-]+$/.test(about) ? `, [data-row="${about}"]` : '';
  const marked = [...document.querySelectorAll<HTMLElement>(`[data-toast-avoid]${row}`)];
  // Only an open sheet's marks; a sheet sliding away (data-state="closed") counts for nothing.
  const inOpenSheet = marked.filter((m) => m.closest('[role="dialog"][data-state="open"]'));
  const onPage = marked.filter((m) => !m.closest('[role="dialog"]'));
  const rects = (inOpenSheet.length > 0 ? inOpenSheet : onPage)
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
  return height - bottom - tall < viewTop + EDGE ? { bottom: EDGE, top: Math.round(viewTop) + EDGE } : { bottom: bottom + Math.max(0, Math.round(page - height)), top: null };
}

/**
 * The slot. While the last toast plays its exit it is still on screen, so it is made inert and hidden from
 * assistive tech: its Undo can't be pressed once it is going. A toast shown meanwhile takes the slot back.
 */
function ToastSlot({ toast, reduce, onDismiss, announced }: {
  toast: ToastEntry;
  reduce: boolean;
  onDismiss: (id: number) => void;
  announced: Set<number>;
}) {
  const present = useIsPresent();
  return (
    <motion.div
      // Size only: where the toast sits is placed before it paints (useClearPlace), never slid into place.
      layout={reduce ? false : 'size'}
      // It rises less than the room it keeps (CLEARANCE), so even arriving it never touches what it avoids.
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98, transition: { duration: 0.18 } }}
      transition={reduce ? { duration: 0.18 } : { type: 'spring', stiffness: 520, damping: 40, mass: 1 }}
      className={cx('w-full max-w-md', present ? 'pointer-events-auto' : 'pointer-events-none')}
    >
      <div inert={!present} aria-hidden={present ? undefined : true}>
        {/* Keyed by toast: a replacement starts its own timer and makes its own small arrival. */}
        <Arrival key={toast.id} id={toast.id} reduce={reduce} announced={announced}>
          <Toast {...toast} onDismiss={() => { onDismiss(toast.id); }} />
        </Arrival>
      </div>
    </motion.div>
  );
}

/**
 * One toast's arrival in the slot. The first time a toast shows it is read out by the live region; when it
 * comes back (the sticky update prompt after a passing toast), its content is marked `aria-live="off"`, so it
 * is shown again without being announced again.
 */
function Arrival({ id, reduce, announced, children }: { id: number; reduce: boolean; announced: Set<number>; children: ReactNode }) {
  const [quiet] = useState(() => announced.has(id));
  useEffect(() => { announced.add(id); }, [announced, id]);
  return (
    <motion.div
      aria-live={quiet ? 'off' : undefined}
      initial={reduce ? false : { scale: 0.98 }}
      animate={{ scale: 1 }}
      transition={{ type: 'spring', stiffness: 520, damping: 40, mass: 1 }}
    >
      {children}
    </motion.div>
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
