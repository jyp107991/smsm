/**
 * Quick add (ADD-1, ADD-2, ADD-3, TXT-2, TXT-4): one box; "42.50 tesco" and Enter saves at once. Under it,
 * the live reading as a button ("£42.50 · Tesco · Groceries · Jae paid · 50/50") that opens the full form
 * prefilled. Enter during composition (Hangul) never saves. A reading that isn't clear opens the form instead.
 *
 * The one way to add (owner's choice, Q-L4): the box carries "Add expense" at its right end, which opens the
 * full form (prefilled from the reading when there is one). Toasts stay clear of the box (`data-toast-avoid`).
 *
 * While typing (S2 polish Q-U6): with the keyboard up, the box scrolls near the top so the reading stays in
 * view; once the reading is complete a small Save sits inside the box (Enter still saves); the reading keeps
 * two lines' room, so nothing below moves as it appears or wraps; the amount is in ink, the rest in ink-2;
 * the description is read and saved tidy ("tesco" → "Tesco", the merchant list's "IKEA").
 */
import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react';
import { bareAmountCurrency } from '../../core/fx';
import { formatPence, formatPlainPounds } from '../../core/money';
import type { QuickAddProblem } from '../../core/quickadd';
import {
  addExpense, deleteExpense, guessCategory, newId, parseLoose, rateFor, rememberChoice, useCategories, useCategoryMemory, useCurrentCountry, useDataLayer,
  useEntries, useHousehold, useOnline, useSmartFeatures, useSyncStatus, locate, type Located } from '../../data';
import { tickSaved } from '../../ui/haptics';
import { useKeyboardOpen } from '../../ui/keyboard';
import { holdEnterWhileComposing } from '../../ui/keys';
import { useToast } from '../../ui/primitives';
import { cx } from '../../ui/primitives/util';
import { strings } from '../../ui/strings';
import { NO_CATEGORIES, NO_ENTRIES } from '../shared/empty';
import { blankForm, withSplit, type FormState } from '../entry/form';
import { Head } from '../shared/Head';
import { usePeople } from '../shared/people';
import { defaultSplit, quickAddTrouble, readingAmount, readingWords, readQuickAdd, type Reading } from '../shared/suggest';
import { useSheets } from '../sheets';
import { AddButton } from './AddButton';

/** Q-U6: where the box sits while typing with the keyboard up, from the top of what the keyboard leaves (px). */
const NEAR_TOP = 16;

export function QuickAdd() {
  const layer = useDataLayer();
  const toast = useToast();
  const sheets = useSheets();
  const people = usePeople();
  const categories = useCategories().data ?? NO_CATEGORIES;
  const entries = useEntries().data ?? NO_ENTRIES;
  const memory = useCategoryMemory();
  const household = useHousehold().data ?? null;
  const [text, setText] = useState('');
  // Q-U3, S9a (fix 21): Enter on something it can't save says why, in one line under the box.
  const [trouble, setTrouble] = useState<string | null>(null);
  // ADD-9: loose words being read (by the AI), and what the box holds now (a late reading for old words is dropped).
  const [loose, setLoose] = useState(false);
  const looseFor = useRef<string | null>(null);
  const textNow = useRef('');
  // Q-F1: the text just saved; a second Enter on it before the box clears (Enter held) saves nothing more.
  const savedText = useRef<string | null>(null);
  const { otherWindow } = useSyncStatus();
  const keyboard = useKeyboardOpen();
  const box = useRef<HTMLDivElement>(null);
  const today = layer.today();
  const me = people.me;
  const smart = useSmartFeatures();
  const online = useOnline();
  /** ADD-9: the usual split for a category the reading named (the household's, or the category's own). */
  const defaultSplitFor = (categoryId: string | null) =>
    defaultSplit({ remembered: null, category: categories.find((c) => c.id === categoryId), householdRatio: household?.default_ratio, people: people.list, me: me?.id ?? '' });

  // PLC-6 (S9a): abroad, a bare amount is in the country's money, at the day's rate (or the last one this phone has).
  const currency = bareAmountCurrency(useCurrentCountry());
  const [rated, setRated] = useState<{ currency: string; rate: string } | null>(null);
  useEffect(() => {
    if (currency === null) return;
    let live = true;
    void rateFor(currency).then((r) => { if (live && r) setRated({ currency, rate: r.rate }); });
    return () => { live = false; };
  }, [currency]);
  const rate = currency !== null && rated?.currency === currency ? rated.rate : null;

  const ctx = useMemo(
    () => (me ? { today, me, partner: people.partner, categories, memory, entries, householdRatio: household?.default_ratio, currency, rate } : null),
    [today, me, people.partner, categories, memory, entries, household, currency, rate],
  );
  const reading: Reading | null = useMemo(() => {
    if (!ctx || text.trim() === '') return null;
    return readQuickAdd(text, ctx);
  }, [text, ctx]);
  const words = reading ? readingWords(reading, { categories, people: people.list.length > 0 ? people.list : me ? [me] : [], today }) : null;
  const complete = reading !== null && reading.confident && reading.saveAs.trim() !== '';

  // Q-U6: with the keyboard up, typing keeps the box near the top, so the reading under it stays in view.
  useEffect(() => {
    const el = box.current;
    if (!keyboard || text === '' || !el || document.activeElement?.closest('[data-quick-add]') !== el) return;
    const top = el.getBoundingClientRect().top - (window.visualViewport?.offsetTop ?? 0);
    if (Math.abs(top - NEAR_TOP) > 4) window.scrollBy({ top: top - NEAR_TOP, behavior: 'instant' });
  }, [keyboard, text]);

  const openForm = (r: Reading) => {
    if (!me) return;
    const base = blankForm({ me: me.id, people: people.list, today, split: r.split });
    // PLC-6: abroad, the form opens paying in that currency, with the amount as typed (and the rate, when known).
    const money = r.original
      ? { amountText: r.original.amount, foreign: { currency: r.original.currency, rateText: r.original.rate ?? '' } }
      : { amountText: formatPlainPounds(r.amount) };
    const prefill: FormState = withSplit(
      {
        ...base, ...money, description: r.description, categoryId: r.categoryId,
        categoryTouched: r.typedCategory, payer: r.payer, splitTouched: r.typedSplit, date: r.date, tags: r.tags,
      },
      r.split,
      people.list,
    );
    sheets.openEntry({ mode: 'add', prefill, fromQuickAdd: { typedCategory: r.typedCategory, typedSplit: r.typedSplit } });
    setText('');
  };

  // PLC-2: with location on, the phone looks up where it is once typing starts, so a quick-added entry gets the
  // town too; saving never waits for it.
  const here = useRef<Located | null>(null);
  const looking = useRef(false);
  const lookUp = () => {
    if (looking.current) return;
    looking.current = true;
    void locate().then((where) => { here.current = where; });
  };

  /** S9a (fix 21): the line under the box for something Enter can't save. */
  const troubleWords = (p: QuickAddProblem): string => (p.kind === 'tooLarge' ? strings.entry.tooLarge(formatPence(p.max))
    : p.kind === 'noSuchDate' ? strings.home.noSuchDate(p.day, p.month) : strings.home.quickAddNeedsAmount);

  const save = (e: SyntheticEvent) => {
    e.preventDefault();
    if (savedText.current === text) return;
    const problem = ctx && text.trim() !== '' ? quickAddTrouble(text, ctx) : null;
    // An amount over the maximum, or a day no month has: said at once (the AI would read no better).
    if (problem && problem.kind !== 'amount') {
      setTrouble(troubleWords(problem));
      return;
    }
    if (!reading) {
      if (text.trim() === '') return;
      // ADD-9: words the grammar can't read go to the AI, with smart features on and a connection; the reading
      // opens the full form (never saves by itself). Otherwise, or if it fails, today's answer.
      if (smart && online && me) {
        // Once per wording (a second Enter while it reads sends nothing more).
        if (looseFor.current === text) return;
        const words = text;
        looseFor.current = words;
        setLoose(true);
        void parseLoose(words).then((r) => {
          // A reply for words that have since changed, or arriving after another sheet opened, is let go.
          const stale = textNow.current !== words || document.querySelector('[role="dialog"][data-state="open"]') !== null;
          if (looseFor.current === words) { looseFor.current = null; setLoose(false); }
          if (stale) return;
          if (!r.ok || (r.data.amount === null && r.data.description === null)) { setTrouble(strings.home.quickAddNeedsAmount); return; }
          const d = r.data;
          const partner = people.list.find((p) => p.id !== me.id);
          // The split it read, in the app's terms ("A paid 60%" is this phone's person's share).
          const read = d.split === null ? null
            : d.split.mode === 'treat' ? { mode: 'treat' as const }
            : d.split.mode === 'for_other' ? { mode: 'for_other' as const }
            : d.split.ratio != null && partner ? { mode: 'ratio' as const, ratio: { [me.id]: d.split.ratio, [partner.id]: 100 - d.split.ratio } } : null;
          const base = blankForm({ me: me.id, people: people.list, today, split: read ?? defaultSplitFor(d.categoryId) });
          sheets.openEntry({
            mode: 'add',
            prefill: {
              ...base, amountText: d.amount === null ? '' : formatPlainPounds(d.amount), description: d.description ?? '',
              categoryId: d.categoryId ?? base.categoryId, categoryTouched: d.categoryId !== null, payer: d.payer ?? me.id,
              splitTouched: read !== null, date: d.date ?? today, tags: d.tags, ...(d.chapterId ? { chapterId: d.chapterId } : {}),
            },
          });
          setText('');
        });
        return;
      }
      setTrouble(troubleWords(problem ?? { kind: 'amount' }));
      return;
    }
    if (!complete) {
      openForm(reading);
      return;
    }
    let id: string;
    try {
      id = addExpense({
        id: newId(),
        description: reading.saveAs, amount: reading.amount, date: reading.date, categoryId: reading.categoryId,
        payer: reading.payer, split: reading.split, tags: reading.tags,
        // PLC-6: abroad, the pounds with the amount as typed and the rate, as the sheet stores them.
        ...(reading.original?.rate != null ? { original: { amount: reading.original.amount, currency: reading.original.currency, rate: reading.original.rate } } : {}),
        // PLC-2: the town, if it was found while typing (never waited for).
        ...(here.current && reading.date === layer.today()
          ? { place: here.current.place, lat: here.current.lat, lng: here.current.lng, ...(here.current.country ? { country: here.current.country } : {}) }
          : {}),
      });
    } catch {
      // Something the form can explain better: open it with what was typed.
      openForm(reading);
      return;
    }
    savedText.current = text;
    // CAT-2 step 4: nothing known about the words, so the AI may guess a moment later (marked as a guess).
    void guessCategory(id);
    // The next entry looks again (the phone may have moved).
    here.current = null;
    looking.current = false;
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
    const label = reading.saveAs;
    // Q-U8: the toast says what was saved, keeps clear of its row, and Undo says what it took away.
    toast.show({
      message: strings.entry.savedWhat(label, formatPence(reading.amount)),
      ...(payer ? { icon: <Head animal={payer.animal} size={24} nod /> } : {}),
      action: { label: strings.entry.undo, onAction: () => { if (deleteExpense(id)) toast.show({ message: strings.entry.removed(label) }); } },
      duration: 5000,
      about: id,
    });
    setText('');
  };

  // The reading, the amount in ink and the rest in ink-2 (its words are also the button's name).
  const amountWords = reading ? readingAmount(reading) : '';
  const restWords = words !== null && words.startsWith(amountWords) ? words.slice(amountWords.length) : words;

  return (
    <form onSubmit={save} className="flex flex-col gap-1.5" autoComplete="off">
      <div
        ref={box}
        data-quick-add=""
        data-toast-avoid=""
        className={cx(
          'bg-sunk flex min-h-14 scroll-mt-4 items-center gap-1 rounded-[12px] pr-2 pl-4',
          // The ring is the typing's; the buttons inside draw their own.
          'has-[input:focus-visible]:outline-forest has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-solid',
        )}
      >
        <input
          type="text"
          aria-label={strings.home.quickAdd}
          disabled={otherWindow}
          placeholder={strings.home.quickAddPlaceholder}
          value={text}
          onChange={(e) => { setText(e.target.value); textNow.current = e.target.value; setTrouble(null); savedText.current = null; lookUp(); }}
          onKeyDown={holdEnterWhileComposing}
          enterKeyHint="send"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="text-body text-ink placeholder:text-ink-2 w-full min-w-0 flex-1 bg-transparent py-3 outline-none"
        />
        {/* Q-U6: once the reading is complete, a small Save in the box (Enter does the same). */}
        {complete && !otherWindow ? (
          <button
            type="submit"
            className="bg-forest text-on-forest press text-secondary inline-flex h-11 shrink-0 items-center rounded-full px-4 font-semibold active:scale-[0.97]"
          >
            {strings.entry.save}
          </button>
        ) : null}
        {/* A read-only window (smsm open in another) adds nothing. */}
        {otherWindow ? null : <AddButton onAdd={() => { if (reading) openForm(reading); else sheets.openEntry({ mode: 'add' }); }} />}
      </div>
      {/* The reading's two lines are kept whether or not there is one, so nothing below moves as you type. */}
      <div className="h-[calc(2*1.4*var(--size-secondary)+1rem)] overflow-hidden">
        {trouble !== null ? (
          <p className="text-secondary text-ink m-0 px-1 py-2" role="status">{trouble}</p>
        ) : reading && words ? (
          <>
            <button
              type="button"
              onClick={() => { openForm(reading); }}
              className={cx('text-secondary text-ink-2 nums-list press block w-full rounded-[12px] px-1 pt-2 text-left break-words', reading.confident && 'pb-2')}
            >
              {/* An unsure reading gives its second line to the note that says so. */}
              <span className={reading.confident ? 'line-clamp-2' : 'line-clamp-1'}>
                <span className="text-ink">{amountWords}</span>
                {restWords}
              </span>
            </button>
            {!reading.confident ? <p className="text-caption text-ink-2 m-0 truncate px-1">{strings.home.checkReading}</p> : null}
          </>
        ) : loose ? (
          <p className="text-secondary text-ink-2 m-0 px-1 py-2" role="status">{strings.home.readingWords}</p>
        ) : (
          <p className="text-secondary text-ink-2 m-0 line-clamp-2 px-1 py-2">{strings.home.quickAddHint}</p>
        )}
      </div>
    </form>
  );
}
