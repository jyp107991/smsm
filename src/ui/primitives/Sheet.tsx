import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Drawer } from 'vaul';
import { X } from 'lucide-react';
import { focusedElement, returnFocus } from '../focus';
import { closeLayer, openLayer } from '../history';
import { strings } from '../strings';
import { Button } from './Button';
import { cx, ICON } from './util';
import { swallowRepeatTap, watchTaps } from '../taps';

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

/**
 * A bottom sheet (vaul): 28 px top corners, the one soft shadow, drag down to close.
 *
 * Android's back gesture closes it, as people expect (DESIGN §6): while open the sheet owns one
 * history entry (through the one history coordinator, src/ui/history.ts), so "back" pops that entry
 * instead of leaving the page. Closing any other way removes the entry again, and navigating away while
 * it is open removes it before the new page is pushed, so it is never left behind.
 *
 * Focus goes back to whatever opened it when it closes, however it closes (Escape, Close, back, Save):
 * what had focus as it opened is kept, and focus returns there, or to the page's fallback (the balance
 * sentence on Home, src/ui/focus.ts; never a text box, which would bring the keyboard up) when that has gone. (Radix would return it to a Drawer.Trigger; there is none.)
 *
 * The keyboard: index.html sets `interactive-widget=resizes-content`, so the viewport (and `dvh`)
 * shrinks when the keyboard opens and the footer stays visible above it. vaul's own input repositioning
 * is turned off so the two don't fight.
 */
export function Sheet({ open, onOpenChange, title, description, dirty = false, full = false, footer, children }: SheetProps) {
  const id = useId();
  const [confirming, setConfirming] = useState(false);
  const active = useRef(false);
  const opener = useRef<HTMLElement | null>(null);

  // Before the content mounts (the portal renders a beat later), so this is still the opener.
  useLayoutEffect(() => {
    if (open) opener.current = focusedElement();
  }, [open]);

  // Q-F1: when the sheet really closes (not StrictMode re-running its effects), the rest of a double tap on
  // Save doesn't land on what the sheet uncovers.
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) swallowRepeatTap();
    wasOpen.current = open;
  }, [open]);

  // A closed sheet never reopens still asking.
  if (!open && confirming) setConfirming(false);

  /**
   * Closed from inside (Close, Escape, a tap outside, Discard): the sheet's history entry goes at once, in
   * the same event, so a navigation that follows straight after (a link, a typed address) isn't cut short
   * by a late "back". Closes from outside (Save) take the entry in the effect below.
   */
  const close = () => {
    closeLayer(id);
    onOpenChange(false);
  };
  const askOrClose = () => {
    if (dirty) setConfirming(true);
    else close();
  };

  // What the history coordinator calls back with reads the latest props (it outlives renders).
  const latest = useRef({ dirty, confirming, onOpenChange });
  useEffect(() => {
    latest.current = { dirty, confirming, onOpenChange };
  });

  useEffect(() => {
    if (!open) return;
    active.current = true;
    const handlers = {
      // The back gesture has already popped this sheet's entry.
      onBack: () => {
        const l = latest.current;
        if (l.confirming) {
          // Back while asking means "keep editing".
          openLayer(id, handlers);
          setConfirming(false);
        } else if (l.dirty) {
          openLayer(id, handlers);
          setConfirming(true);
        } else {
          l.onOpenChange(false);
        }
      },
      // Leaving the page (a navigation) closes the sheet without asking: the person chose to go.
      onLeave: () => { latest.current.onOpenChange(false); },
    };
    openLayer(id, handlers);
    watchTaps();
    return () => {
      active.current = false;
      // Deferred, so a re-run of this effect (StrictMode, a re-render) keeps the entry it already has.
      setTimeout(() => {
        if (!active.current) closeLayer(id);
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
        {/* The scrim (Q-L3): warm ink by day, black by night, so the sheet reads as lifted off a dimmed page. */}
        <Drawer.Overlay className="bg-scrim fixed inset-0 z-40" />
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
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus(opener.current);
            opener.current = null;
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
              className="text-ink-2 press hover:text-ink inline-flex size-11 shrink-0 items-center justify-center rounded-full"
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
                close();
              }}
            />
          ) : footer ? (
            // Toasts stay clear of the footer (Save), wherever the keyboard leaves it.
            <div data-toast-avoid="" className="border-line shrink-0 border-t px-5 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))]">{footer}</div>
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
      data-toast-avoid=""
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
