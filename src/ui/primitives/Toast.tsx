import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
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
  /** Milliseconds before it goes by itself; 0 keeps it until dismissed. Default 4 s, or 6 s with an action. */
  duration?: number;
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

/** At most this many toasts at once; the oldest goes first. */
const MAX_VISIBLE = 3;

/** The toast functions from the nearest ToastProvider. */
export function useToast(): ToastApi {
  const api = use(ToastContext);
  if (!api) throw new Error('useToast needs a <ToastProvider> above it');
  return api;
}

/**
 * Holds the toast stack and renders it at the bottom of the screen, above the home indicator.
 * Screens with the tab bar set `--toast-lift` (default 1rem) so toasts sit above it.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((toast: ToastOptions) => {
    const id = nextId.current++;
    setToasts((all) => [...all, { ...toast, id }].slice(-MAX_VISIBLE));
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

/** The stack itself (also usable on its own, e.g. in the gallery). Newest at the bottom, nearest the thumb. */
export function ToastStack({ toasts, onDismiss }: { toasts: ToastEntry[]; onDismiss: (id: number) => void }) {
  const reduce = useReducedMotion() ?? false;
  return (
    <section
      aria-label={strings.ui.notifications}
      className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+var(--toast-lift,1rem))] z-[60] flex flex-col items-center gap-2 px-4"
    >
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout={!reduce}
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.98, transition: { duration: 0.18 } }}
            transition={reduce ? { duration: 0.18 } : { type: 'spring', stiffness: 520, damping: 40, mass: 1 }}
            className="pointer-events-auto w-full max-w-md"
          >
            <Toast {...t} onDismiss={() => { onDismiss(t.id); }} />
          </motion.div>
        ))}
      </AnimatePresence>
    </section>
  );
}

export interface ToastProps extends ToastOptions {
  onDismiss: () => void;
}

/** One toast: `role="status"`, so it is announced politely without moving focus. */
export function Toast({ message, action, icon, duration, onDismiss }: ToastProps) {
  const ms = duration ?? (action ? 6000 : 4000);
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
      role="status"
      // Reading or pressing it holds it on screen (WCAG 2.2.1).
      onPointerEnter={() => { setPaused(true); }}
      onPointerLeave={() => { setPaused(false); }}
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
          className="text-forest min-h-11 shrink-0 rounded-full px-3 font-semibold"
        >
          {action.label}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={strings.ui.dismiss}
        className={cx('text-ink-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full')}
      >
        <X size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" />
      </button>
    </div>
  );
}
