/**
 * "Add expense", the one way to the full form (owner's choice, S2 polish Q-L4): a quiet button at the right end
 * of the Quick add box, 44 px, always there while the box is, scrolling with it (nothing floats over the page).
 * A tap opens the form, prefilled from the reading when there is one (ADD-2); a long press offers "Same as
 * last time" (ADD-7). At rest it is a quiet mark on a small raised disc; forest only answers a hover or press.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { useDataLayer, useEntries, type ExpenseRow } from '../../data';
import { closeLayer, openLayer } from '../../ui/history';
import { cx } from '../../ui/primitives/util';
import { strings } from '../../ui/strings';
import { NO_ENTRIES } from '../shared/empty';
import { copyForm } from '../entry/form';
import { usePeople } from '../shared/people';
import { useSheets } from '../sheets';

const LONG_PRESS_MS = 500;
/** The long-press menu's place in the history coordinator: back closes it, as it does a sheet (DESIGN §6). */
const MENU_LAYER = 'home-add-menu';

export function AddButton({ onAdd }: { onAdd: () => void }) {
  const sheets = useSheets();
  const layer = useDataLayer();
  const entries = useEntries().data ?? NO_ENTRIES;
  const people = usePeople();
  const [menu, setMenu] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const last = useMemo(() => {
    let best: ExpenseRow | null = null;
    for (const e of entries) if (e.deleted_at === null && e.kind === 'expense' && (best === null || e.created_at > best.created_at)) best = e;
    return best;
  }, [entries]);

  useEffect(() => {
    if (!menu) return;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    /** Closed from the keyboard or by back: focus goes back to the button it came from. */
    const closeToButton = () => {
      setMenu(false);
      button.current?.focus();
    };
    // While open the menu holds a history entry, so back closes it first, as it does a sheet.
    openLayer(MENU_LAYER, { onBack: closeToButton, onLeave: () => { setMenu(false); } });
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key === 'Escape') closeToButton();
        return;
      }
      if (e instanceof PointerEvent && menuRef.current?.contains(e.target as Node)) return;
      // A tap elsewhere: focus goes where the person tapped.
      setMenu(false);
    };
    window.addEventListener('keydown', close);
    window.addEventListener('pointerdown', close);
    return () => {
      // Closed any other way, its entry goes too (a no-op once back has taken it). Clean-ups run before the
      // next effects start, so a sheet opened from the menu stacks on a history without the menu's entry.
      closeLayer(MENU_LAYER);
      window.removeEventListener('keydown', close);
      window.removeEventListener('pointerdown', close);
    };
  }, [menu]);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  return (
    <div className="relative -mr-2 shrink-0">
      {menu && last ? (
        <div ref={menuRef} role="menu" aria-label={strings.home.addMenu} className="bg-surface shadow-float absolute right-0 bottom-full z-30 mb-2 w-max min-w-48 rounded-[16px] p-1.5">
          <button
            type="button"
            role="menuitem"
            className="text-ink press min-h-11 w-full rounded-[12px] px-4 text-left"
            onClick={() => {
              // The item goes with the menu: the sheet takes the add button as the opener to return to.
              button.current?.focus();
              setMenu(false);
              const prefill = copyForm(last, people.list, layer.today());
              sheets.openEntry({ mode: 'add', prefill: { ...prefill, categoryTouched: true, splitTouched: true } });
            }}
          >
            {strings.home.sameAsLast}
          </button>
        </div>
      ) : null}
      <button
        ref={button}
        type="button"
        aria-label={strings.home.addExpense}
        onPointerDown={() => {
          longPressed.current = false;
          cancel();
          timer.current = setTimeout(() => {
            longPressed.current = true;
            if (last) setMenu(true);
          }, LONG_PRESS_MS);
        }}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(e) => {
          // Android's long press: our menu, not the browser's.
          e.preventDefault();
          if (last) {
            longPressed.current = true;
            setMenu(true);
          }
        }}
        onClick={() => {
          if (longPressed.current) {
            longPressed.current = false;
            return;
          }
          onAdd();
        }}
        className={cx(
          // A 44 px target; the visible disc inside it is 34 px.
          'group text-ink inline-flex size-11 items-center justify-center rounded-full select-none',
          'outline-none [-webkit-touch-callout:none] focus-visible:outline-none',
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            'bg-surface flex size-[2.125rem] items-center justify-center rounded-full',
            'transition-[background-color,color,transform] duration-150 group-active:scale-[0.94]',
            'group-hover:bg-forest-tint group-hover:text-forest group-active:bg-forest group-active:text-on-forest',
            'group-focus-visible:outline-forest group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-solid',
          )}
        >
          <Plus size={20} strokeWidth={2} />
        </span>
      </button>
    </div>
  );
}
