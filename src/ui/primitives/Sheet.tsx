import { useEffect, useEffectEvent, useId, useRef, useState, type ReactNode } from 'react';
import { Drawer } from 'vaul';
import { X } from 'lucide-react';
import { strings } from '../strings';
import { Button } from './Button';
import { cx, ICON } from './util';

export interface SheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The sheet's heading, also its accessible name. */
  title: string;
  /** One line under the title, also read out as the dialog's description. */
  description?: string;
  /**
   * Something typed would be lost by closing. While true, every way of closing (back gesture, Close,
   * Escape, tapping outside) first asks inside the sheet; dragging down springs back instead of closing.
   */
  dirty?: boolean;
  /** Full height (the add sheet, DESIGN §4.2); otherwise as tall as its content. */
  full?: boolean;
  /** Pinned under the scrolling body, above the keyboard and the home indicator (Save goes here). */
  footer?: ReactNode;
  children: ReactNode;
}

const HISTORY_KEY = 'smsmSheet';

function stateObject(state: unknown): Record<string, unknown> {
  return typeof state === 'object' && state !== null ? (state as Record<string, unknown>) : {};
}

function isOwnEntry(state: unknown, id: string): boolean {
  return stateObject(state)[HISTORY_KEY] === id;
}

function pushOwnEntry(id: string) {
  history.pushState({ ...stateObject(history.state), [HISTORY_KEY]: id }, '');
}

/**
 * A bottom sheet (vaul): 28 px top corners, the one soft shadow, drag down to close.
 *
 * Android's back gesture closes it, as people expect (DESIGN §6): while open the sheet owns one
 * history entry, so "back" pops that entry instead of leaving the page. Closing any other way removes
 * the entry again. The page underneath keeps its own history untouched.
 *
 * The keyboard: index.html sets `interactive-widget=resizes-content`, so the viewport (and `dvh`)
 * shrinks when the keyboard opens and the footer stays visible above it. vaul's own input repositioning
 * is turned off so the two don't fight.
 */
export function Sheet({ open, onOpenChange, title, description, dirty = false, full = false, footer, children }: SheetProps) {
  const id = useId();
  const [confirming, setConfirming] = useState(false);
  const active = useRef(false);

  // A closed sheet never reopens still asking.
  if (!open && confirming) setConfirming(false);

  const askOrClose = () => {
    if (dirty) setConfirming(true);
    else onOpenChange(false);
  };

  const onBack = useEffectEvent(() => {
    // The gesture has already popped this sheet's entry.
    if (confirming) {
      // Back while asking means "keep editing".
      pushOwnEntry(id);
      setConfirming(false);
    } else if (dirty) {
      pushOwnEntry(id);
      setConfirming(true);
    } else {
      onOpenChange(false);
    }
  });

  useEffect(() => {
    if (!open) return;
    active.current = true;
    if (!isOwnEntry(history.state, id)) pushOwnEntry(id);
    const onPop = () => {
      // Our own entry still current means the back was for a sheet above this one.
      if (isOwnEntry(history.state, id)) return;
      onBack();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      active.current = false;
      window.removeEventListener('popstate', onPop);
      // Deferred, so a re-run of this effect (StrictMode, a re-render) keeps the entry it already has.
      setTimeout(() => {
        if (!active.current && isOwnEntry(history.state, id)) history.back();
      }, 0);
    };
  }, [open, id]);

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(next) => {
        if (next) onOpenChange(true);
        else askOrClose();
      }}
      dismissible={!dirty}
      repositionInputs={false}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="bg-sunk/60 fixed inset-0 z-40" />
        <Drawer.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          onEscapeKeyDown={(event) => {
            if (confirming) {
              event.preventDefault();
              setConfirming(false);
            } else if (dirty) {
              event.preventDefault();
              setConfirming(true);
            }
          }}
          onPointerDownOutside={(event) => {
            if (dirty) {
              event.preventDefault();
              setConfirming(true);
            }
          }}
          className={cx(
            'bg-surface text-ink shadow-float fixed inset-x-0 bottom-0 z-50 mx-auto flex w-full max-w-lg flex-col rounded-t-[28px] outline-none',
            'max-h-[calc(100dvh-env(safe-area-inset-top)-0.75rem)]',
            full && 'h-[calc(100dvh-env(safe-area-inset-top)-0.75rem)]',
          )}
        >
          {/* The drag handle: decoration only (the whole sheet drags; Close and back are the accessible ways out). */}
          <div aria-hidden="true" className="bg-line mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full" />
          <header className="flex shrink-0 items-start gap-2 pt-2 pr-2 pl-5">
            <div className="min-w-0 flex-1 pt-2">
              <Drawer.Title className="text-title break-words">{title}</Drawer.Title>
              {description ? <Drawer.Description className="text-secondary text-ink-2 mt-1">{description}</Drawer.Description> : null}
            </div>
            <button
              type="button"
              onClick={askOrClose}
              aria-label={strings.ui.close}
              className="text-ink-2 inline-flex size-11 shrink-0 items-center justify-center rounded-full"
            >
              <X size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-3 pb-4">{children}</div>
          {confirming ? (
            <DiscardConfirm
              onKeep={() => {
                setConfirming(false);
              }}
              onDiscard={() => {
                setConfirming(false);
                onOpenChange(false);
              }}
            />
          ) : footer ? (
            <div className="border-line shrink-0 border-t px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>
          ) : (
            <div aria-hidden="true" className="h-[env(safe-area-inset-bottom)] shrink-0" />
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

/** The question asked before typed changes are thrown away, inside the sheet where the footer was. */
function DiscardConfirm({ onKeep, onDiscard }: { onKeep: () => void; onDiscard: () => void }) {
  const titleId = useId();
  const bodyId = useId();
  return (
    <div
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      className="border-line shrink-0 border-t px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]"
    >
      <p id={titleId} className="font-semibold">
        {strings.ui.discardTitle}
      </p>
      <p id={bodyId} className="text-secondary text-ink-2 mt-0.5">
        {strings.ui.discardBody}
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        {/* Focus goes to the safe choice. */}
        <Button variant="plain" onClick={onKeep} autoFocus className="flex-auto">
          {strings.ui.keepEditing}
        </Button>
        <Button variant="destructive" onClick={onDiscard} className="flex-auto">
          {strings.ui.discard}
        </Button>
      </div>
    </div>
  );
}
