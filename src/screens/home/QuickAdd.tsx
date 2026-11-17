/**
 * Quick add (ADD-1, ADD-2, ADD-3, TXT-2, TXT-4): one box; "42.50 tesco" and Enter saves at once. Under it,
 * the live reading as a button ("£42.50 · Tesco · Groceries · Jae paid · 50/50") that opens the full form
 * prefilled. Enter during composition (Hangul) never saves. A reading that isn't clear opens the form instead.
 */
import { useEffect, useMemo, useRef, useState, type FocusEvent, type SyntheticEvent } from 'react';
import { formatPlainPounds } from '../../core/money';
import {
  addExpense, deleteExpense, newId, rememberChoice, useCategories, useCategoryMemory, useDataLayer, useEntries, useHousehold, useSyncStatus,
} from '../../data';
import { registerFocusFallback } from '../../ui/focus';
import { tickSaved } from '../../ui/haptics';
import { holdEnterWhileComposing } from '../../ui/keys';
import { useToast } from '../../ui/primitives';
import { strings } from '../../ui/strings';
import { NO_CATEGORIES, NO_ENTRIES } from '../shared/empty';
import { blankForm, withSplit, type FormState } from '../entry/form';
import { Head } from '../shared/Head';
import { usePeople } from '../shared/people';
import { readingWords, readQuickAdd, type Reading } from '../shared/suggest';
import { useSheets } from '../sheets';

/**
 * `onInUse` hears when the person is in quick add (the box or its reading has focus, so on a phone the
 * keyboard is up): Home moves the add button out of the way meanwhile, so it never covers what is being
 * typed or its reading (320 px phones). The reading opens the full form, so nothing is lost.
 */
export function QuickAdd({ onInUse }: { onInUse?: (inUse: boolean) => void }) {
  const layer = useDataLayer();
  const toast = useToast();
  const sheets = useSheets();
  const people = usePeople();
  const categories = useCategories().data ?? NO_CATEGORIES;
  const entries = useEntries().data ?? NO_ENTRIES;
  const memory = useCategoryMemory();
  const household = useHousehold().data ?? null;
  const [text, setText] = useState('');
  // Q-U3: Enter with nothing it can read as an amount says what it needs.
  const [needsAmount, setNeedsAmount] = useState(false);
  // Q-F1: the text just saved; a second Enter on it before the box clears (Enter held) saves nothing more.
  const savedText = useRef<string | null>(null);
  const box = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  useEffect(() => { onInUse?.(focused); }, [focused, onInUse]);
  // A sheet whose opener has gone (the reading, as it opens the form) gives focus back to this box.
  useEffect(() => (box.current ? registerFocusFallback(box.current) : undefined), []);
  const { otherWindow } = useSyncStatus();
  const today = layer.today();
  const me = people.me;

  const reading: Reading | null = useMemo(() => {
    if (!me || text.trim() === '') return null;
    return readQuickAdd(text, { today, me, partner: people.partner, categories, memory, entries, householdRatio: household?.default_ratio });
  }, [text, today, me, people.partner, categories, memory, entries, household]);
  const words = reading ? readingWords(reading, { categories, people: people.list.length > 0 ? people.list : me ? [me] : [], today }) : null;

  const openForm = (r: Reading) => {
    if (!me) return;
    const base = blankForm({ me: me.id, people: people.list, today, split: r.split });
    const prefill: FormState = withSplit(
      {
        ...base, amountText: formatPlainPounds(r.amount), description: r.description, categoryId: r.categoryId,
        categoryTouched: r.typedCategory, payer: r.payer, splitTouched: r.typedSplit, date: r.date, tags: r.tags,
      },
      r.split,
      people.list,
    );
    sheets.openEntry({ mode: 'add', prefill, fromQuickAdd: { typedCategory: r.typedCategory, typedSplit: r.typedSplit } });
    setText('');
  };

  const save = (e: SyntheticEvent) => {
    e.preventDefault();
    if (savedText.current === text) return;
    if (!reading) {
      if (text.trim() !== '') setNeedsAmount(true);
      return;
    }
    if (!reading.confident || reading.saveAs.trim() === '') {
      openForm(reading);
      return;
    }
    let id: string;
    try {
      id = addExpense({
        id: newId(),
        description: reading.saveAs, amount: reading.amount, date: reading.date, categoryId: reading.categoryId,
        payer: reading.payer, split: reading.split, tags: reading.tags,
      });
    } catch {
      // Something the form can explain better: open it with what was typed.
      openForm(reading);
      return;
    }
    savedText.current = text;
    // CAT-3, CAT-4: a category or split the person typed teaches the app.
    try {
      rememberChoice(reading.saveAs, {
        ...(reading.typedCategory ? { categoryId: reading.categoryId } : {}),
        ...(reading.typedSplit ? { split: reading.split } : {}),
      });
    } catch {
      /* learning never stands in the way of a save */
    }
    tickSaved();
    const payer = people.list.find((p) => p.id === reading.payer) ?? me;
    toast.show({
      message: strings.entry.saved,
      ...(payer ? { icon: <Head animal={payer.animal} size={24} nod /> } : {}),
      action: { label: strings.entry.undo, onAction: () => { deleteExpense(id); } },
      duration: 5000,
    });
    setText('');
  };

  return (
    <form
      onSubmit={save}
      onFocus={() => { setFocused(true); }}
      onBlur={(e: FocusEvent<HTMLFormElement>) => {
        if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) setFocused(false);
      }}
      className="flex flex-col gap-1.5"
      autoComplete="off"
    >
      <div className="bg-sunk focus-within:outline-forest flex min-h-14 items-center rounded-[12px] px-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-solid">
        <input
          ref={box}
          type="text"
          aria-label={strings.home.quickAdd}
          disabled={otherWindow}
          placeholder={strings.home.quickAddPlaceholder}
          value={text}
          onChange={(e) => { setText(e.target.value); setNeedsAmount(false); savedText.current = null; }}
          onKeyDown={holdEnterWhileComposing}
          enterKeyHint="send"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="text-body text-ink placeholder:text-ink-2 w-full min-w-0 bg-transparent py-3 outline-none"
        />
      </div>
      {/* The reading's place is kept whether or not there is one, so nothing below moves as you type. */}
      <div className="min-h-11">
        {reading && words ? (
          <button
            type="button"
            onClick={() => { openForm(reading); }}
            className="text-secondary text-ink-2 nums-list min-h-11 w-full rounded-[12px] px-1 py-2 text-left break-words"
          >
            {words}
          </button>
        ) : needsAmount ? (
          <p className="text-secondary text-ink m-0 px-1 py-2" role="status">{strings.home.quickAddNeedsAmount}</p>
        ) : (
          <p className="text-secondary text-ink-2 m-0 px-1 py-2">{strings.home.quickAddHint}</p>
        )}
        {reading && !reading.confident ? <p className="text-caption text-ink-2 m-0 px-1">{strings.home.checkReading}</p> : null}
      </div>
    </form>
  );
}
