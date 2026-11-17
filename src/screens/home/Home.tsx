/**
 * Home (DESIGN §4.1): "are we square?" and adding. The plank and the sentence, quick add with its live
 * reading, today's entries, and only the banners that are needed: an approval waiting, a change the server
 * refused (OFF-5), changes waiting to sync. Settings is the gear; Add expense floats in thumb reach, and a
 * long press on it offers "Same as last time" (ADD-7).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Settings as Gear } from 'lucide-react';
import { dismissProblem, useCategories, useDataLayer, useEntries, useSyncStatus, type ExpenseDraft, type ExpenseRow } from '../../data';
import { Logo } from '../../ui/Logo';
import { Button, ICON } from '../../ui/primitives';
import { cx } from '../../ui/primitives/util';
import { closeLayer, openLayer } from '../../ui/history';
import { go } from '../../ui/router';
import { strings } from '../../ui/strings';
import { NO_CATEGORIES, NO_ENTRIES } from '../shared/empty';
import { copyForm } from '../entry/form';
import { ApprovalBanners } from '../shared/Approvals';
import { MonzoBanner } from '../settle/question';
import { usePeople } from '../shared/people';
import { EntryRowView } from '../shared/rows';
import { useSheets } from '../sheets';
import { BalanceRegion } from './Balance';
import { QuickAdd } from './QuickAdd';

/**
 * Toasts on Home sit above the add button, so a Saved toast never covers it: the button floats 5.25rem
 * up (clear of the tab bar, where toasts sit elsewhere), is 3.5rem tall, then a 0.75rem gap.
 */
export const HOME_TOAST_LIFT = '9.5rem';

export function Home() {
  // While quick add is in use the add button steps aside (the reading opens the full form anyway).
  const [typing, setTyping] = useState(false);
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-28">
      <header className="flex min-h-12 items-center gap-2.5">
        <Logo size={30} />
        <h1 className="text-wordmark m-0 flex-1 text-[1.75rem] leading-none">{strings.app.name}</h1>
        <button
          type="button"
          aria-label={strings.home.settings}
          onClick={() => { go({ name: 'settings' }); }}
          className="text-ink -mr-2.5 inline-flex size-11 items-center justify-center rounded-full"
        >
          <Gear size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" />
        </button>
      </header>
      <ApprovalBanners />
      <MonzoBanner />
      <Problems />
      <BalanceRegion />
      <div className="flex flex-col gap-2">
        <QuickAdd onInUse={setTyping} />
        <SyncLine />
      </div>
      <Today />
      <AddButton aside={typing} />
    </div>
  );
}

/** OFF-5: a change the server refused after reconnecting is reported in plain words and kept to fix. */
function Problems() {
  const { problems } = useSyncStatus();
  const sheets = useSheets();
  if (problems.length === 0) return null;
  return (
    <div role="alert" className="bg-surface border-berry flex flex-col gap-3 rounded-[16px] border-2 px-4 py-3">
      {problems.map((p) => (
        <div key={p.id} className="flex flex-col gap-2">
          <p className="m-0 break-words">{strings.sync.problem(p.label, (strings.sync.reasons as Partial<Record<string, string>>)[p.reason] ?? strings.sync.reasons.other)}</p>
          <div className="flex flex-wrap gap-3">
            {p.table === 'expenses' && p.row ? (
              <Button
                variant="plain"
                onClick={() => {
                  sheets.openEntry({ mode: 'edit', id: p.rowId, row: p.row as ExpenseRow, ...(p.input ? { input: p.input as ExpenseDraft } : {}) });
                }}
              >
                {strings.sync.fix}
              </Button>
            ) : null}
            <Button variant="plain" onClick={() => { dismissProblem(p.id); }}>{strings.sync.dismiss}</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

/** OFF-5: "3 changes waiting to sync"; a persistent live region, so the count is announced as it changes. */
function SyncLine() {
  const { waiting, updating } = useSyncStatus();
  return (
    <p role="status" className="text-caption text-ink-2 m-0 min-h-[1.1rem] px-1">
      {updating ? strings.sync.updating : waiting > 0 ? strings.sync.waiting(waiting) : null}
    </p>
  );
}

function Today() {
  const layer = useDataLayer();
  const entries = useEntries().data;
  const categories = useCategories().data ?? NO_CATEGORIES;
  const people = usePeople();
  const { pendingIds } = useSyncStatus();
  const today = layer.today();
  const rows = useMemo(
    () => (entries ?? []).filter((e) => e.date === today && e.deleted_at === null).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    [entries, today],
  );
  return (
    <section aria-labelledby="home-today" className="flex flex-col">
      <div className="rule-ledger flex items-end justify-between gap-3">
        <h2 id="home-today" className="text-title m-0">{strings.home.today}</h2>
        <a
          href="/activity"
          onClick={(e) => { e.preventDefault(); go({ name: 'activity' }); }}
          className="text-forest text-secondary -mb-1 inline-flex min-h-11 items-center px-1"
        >
          {strings.home.seeAll}
        </a>
      </div>
      {rows.length === 0 ? (
        <p className="text-secondary text-ink-2 mt-3 mb-0">{strings.home.nothingToday}</p>
      ) : (
        <ul aria-label={strings.home.today} className="m-0 list-none p-0">
          {rows.map((r) => (
            <li key={r.id} className="border-line border-b last:border-b-0">
              <EntryRowView row={r} categories={categories} people={people.list} pending={pendingIds.has(r.id)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const LONG_PRESS_MS = 500;
/** The long-press menu's place in the history coordinator: back closes it, as it does a sheet (DESIGN §6). */
const MENU_LAYER = 'home-add-menu';

/**
 * The floating add button (DESIGN §3.3: the one soft shadow). Long press: "Same as last time" (ADD-7).
 * `aside` while quick add is in use: it steps out of the way (hidden, not just covered), so on a 320 px
 * phone it never sits over the box being typed in.
 */
function AddButton({ aside }: { aside: boolean }) {
  const sheets = useSheets();
  const { otherWindow } = useSyncStatus();
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
  // A read-only window (smsm open in another) adds nothing.
  if (otherWindow) return null;

  return (
    <div
      className={cx(
        'pointer-events-none fixed right-0 bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] left-0 z-20 mx-auto flex max-w-lg justify-end px-5',
        'transition-[opacity,visibility] duration-150 motion-reduce:transition-none',
        aside && !menu && 'invisible opacity-0',
      )}
    >
      <div className="pointer-events-auto relative">
        {menu && last ? (
          <div ref={menuRef} role="menu" aria-label={strings.home.addMenu} className="bg-surface shadow-float absolute right-0 bottom-full mb-3 w-max min-w-48 rounded-[16px] p-1.5">
            <button
              type="button"
              role="menuitem"
              className="text-ink min-h-11 w-full rounded-[12px] px-4 text-left"
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
            sheets.openEntry({ mode: 'add' });
          }}
          className={cx(
            'bg-forest text-on-forest shadow-float inline-flex min-h-14 min-w-14 items-center justify-center gap-2 rounded-full pr-6 pl-5 font-semibold select-none',
            // On the narrowest phones the button keeps only its +, so it covers less of the page.
            'max-[359px]:px-0',
            'transition-transform duration-150 active:scale-[0.98] [-webkit-touch-callout:none]',
          )}
        >
          <Plus size={ICON.size} strokeWidth={2.25} aria-hidden="true" />
          <span className="max-[359px]:sr-only">{strings.home.addExpense}</span>
        </button>
      </div>
    </div>
  );
}
