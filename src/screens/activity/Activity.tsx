/**
 * Activity (DESIGN §4.4; ACT-1, ACT-3, OFF-3, TXT-3): entries and settle-ups, newest first, grouped by day
 * on ruled lines, with search (description, notes, tags; case, width and normalisation ignored) and
 * filters (who paid, category, dates, type). Works from the phone's copy, offline too. Swipe a row left to
 * delete (with Undo) or right to duplicate.
 *
 * S9 (performance audit P1): the list stays quick with eighteen months of entries.
 * - The rows are drawn a screenful at a time (DESIGN §6 allows windowing): the first ones at once, the next as
 *   the end of the list comes within a screen or two of view, or from a button for the keyboard and screen
 *   readers. A new search or filter starts again at the top; new data keeps the rows already drawn.
 * - Search and filters update the box and the chips at once; the list follows a moment later (useDeferredValue),
 *   so typing never waits for the list.
 * - The filter sheets and which one is open live in their own component, so opening one never redraws the list;
 *   rows are memoised.
 * - One swipe handler for the whole list (pointer events), not a drag on every row.
 * - The payer's head is drawn once (an SVG symbol) and used by every row.
 */
import { Check, X } from 'lucide-react';
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, startTransition, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { formatDate, formatDay, type IsoDate } from '../../core/dates';
import { applyFilter, filteredTotal, newestFirst, type Filter, type FilterEntry } from '../../core/filters';
import { formatPence, pence } from '../../core/money';
import {
  addExpense, deleteExpense, newId, restoreExpense, useCategories, useChapters, useDataLayer, useEntries, useSettlements, useSyncStatus,
  type CategoryRow, type ChapterRow, type ExpenseRow, type SettlementRow, useCommentCounts,
} from '../../data';
import { tickSaved } from '../../ui/haptics';
import { holdEnterWhileComposing } from '../../ui/keys';
import { Button, ICON, Sheet, useToast, type ToastApi } from '../../ui/primitives';
import { cx } from '../../ui/primitives/util';
import { Animal, HeadSymbols } from '../../ui/rig/Animal';
import { prefersReducedMotion } from '../../ui/rig/motion';
import { strings } from '../../ui/strings';
import { plainError } from '../shared/plain';
import { duplicateDraft } from '../entry/form';
import { usePeople } from '../shared/people';
import { CategoryMark } from '../shared/CategoryMark';
import { MonthGrid } from '../shared/MonthGrid';
import { EntryRowView, SettlementRowView } from '../shared/rows';
import { payerOf, type Person } from '../shared/words';
import { datesRange, type DatesChoice, type DayRange } from './dates';
import { countryName } from '../chapters/model';

type Item =
  | { kind: 'expense'; row: ExpenseRow; entry: FilterEntry }
  | { kind: 'settlement'; row: SettlementRow; entry: FilterEntry };

type TypeChoice = 'any' | 'expense' | 'money_back' | 'settlement' | 'deleted';

const EVERYDAY = '__everyday';

/** What the list is filtered by. Filters live with the screen: opening Activity again starts afresh. */
interface Filters {
  text: string;
  payer: string | null;
  category: string | null;
  /** CHP-2: '' any chapter, EVERYDAY entries in no chapter, or a chapter's id. */
  chapter: string;
  /** PLC-7, CHP-6: a country ('' any) and a place ('' any). */
  country: string;
  place: string;
  dates: DatesChoice;
  /** Q-U10: the days picked under "Pick dates". */
  range: DayRange | null;
  type: TypeChoice;
}

const NO_FILTERS: Filters = { text: '', payer: null, category: null, chapter: '', country: '', place: '', dates: 'any', range: null, type: 'any' };

/** Q-U10: a filter is on (search has its own clear button). */
const filtering = (f: Filters) => f.payer !== null || f.category !== null || f.chapter !== '' || f.country !== '' || f.place !== '' || f.dates !== 'any' || f.type !== 'any';

export function Activity() {
  const layer = useDataLayer();
  const entries = useEntries().data;
  const settlements = useSettlements().data;
  const categories = useCategories().data;
  const people = usePeople();
  const { pendingIds, otherWindow } = useSyncStatus();
  const commentCounts = useCommentCounts();
  const today = layer.today();
  const chapters = useChapters().data;
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const change = (patch: Partial<Filters>) => { setFilters((f) => ({ ...f, ...patch })); };
  const clearAll = () => { setFilters(NO_FILTERS); };
  // The box and the chips follow at once; the list a moment later, without holding up the next key.
  const shownFilters = useDeferredValue(filters);
  const searchRef = useRef<HTMLInputElement>(null);

  const items = useMemo((): Item[] => {
    const showDeleted = shownFilters.type === 'deleted';
    const out: Item[] = [];
    for (const row of entries ?? []) {
      if ((row.deleted_at !== null) !== showDeleted) continue;
      out.push({
        kind: 'expense', row,
        entry: {
          kind: row.kind === 'money_back' ? 'money_back' : 'expense', description: row.description, notes: row.notes, tags: row.tags,
          place: row.place, payer: payerOf(row.paid, people.list), categoryId: row.category_id, chapterId: row.chapter_id,
          country: row.country, date: row.date, splitMode: row.split_mode as FilterEntry['splitMode'],
        },
      });
    }
    for (const row of settlements ?? []) {
      if ((row.deleted_at !== null) !== showDeleted) continue;
      out.push({
        kind: 'settlement', row,
        entry: {
          kind: 'settlement', description: '', notes: row.note, tags: [], place: null, payer: row.from_user, categoryId: null,
          chapterId: null, country: 'GB', date: row.date, splitMode: null,
        },
      });
    }
    return out;
  }, [entries, settlements, people.list, shownFilters.type]);

  const shown = useMemo(() => {
    const f = shownFilters;
    const filter: Filter = {
      ...(f.text.trim() !== '' ? { text: f.text } : {}),
      ...(f.payer ? { payer: f.payer } : {}),
      ...(f.category ? { categories: [f.category] } : {}),
      ...(f.chapter !== '' ? { chapters: [f.chapter === EVERYDAY ? null : f.chapter] } : {}),
      ...(f.country !== '' ? { countries: [f.country] } : {}),
      ...(f.place !== '' ? { places: [f.place] } : {}),
      ...datesRange(f.dates, today, f.range),
      ...(f.type === 'expense' || f.type === 'money_back' || f.type === 'settlement' ? { kinds: [f.type] } : {}),
    };
    const kept = new Set(applyFilter(items.map((i) => i.entry), filter));
    // S9a (ACT-1): the one order, as Home and the statement: newest first, then the one added last, then by id.
    return items
      .filter((i) => kept.has(i.entry))
      .sort((a, b) => newestFirst({ date: a.row.date, createdAt: a.row.created_at, id: a.row.id }, { date: b.row.date, createdAt: b.row.created_at, id: b.row.id }));
  }, [items, shownFilters, today]);

  // S9a (PLC-7, CHP-6): with a search or a filter on, "12 entries · £340.20" over every match (not only the rows drawn),
  // by the core: money back subtracts, settle-ups are left out, and so is money back whose original is deleted (MB-3).
  const total = useMemo(() => {
    if (shownFilters.type === 'deleted' || (shownFilters.text.trim() === '' && !filtering(shownFilters))) return null;
    const gone = new Set((entries ?? []).filter((e) => e.deleted_at !== null).map((e) => e.id));
    return filteredTotal(shown.map((i) => ({
      ...i.entry, amount: pence(i.row.amount_pence),
      deleted: i.row.deleted_at !== null || (i.kind === 'expense' && i.row.kind === 'money_back' && i.row.refund_of !== null && gone.has(i.row.refund_of)),
    })));
  }, [shown, shownFilters, entries]);

  const loading = entries === undefined || settlements === undefined;
  // The countries and places that occur in the household's entries (PLC-7), by name.
  const countries = useMemo(() => [...new Set((entries ?? []).filter((e) => e.deleted_at === null).map((e) => e.country))]
    .sort((a, b) => (countryName(a) ?? a).localeCompare(countryName(b) ?? b)), [entries]);
  const places = useMemo(() => [...new Set((entries ?? []).filter((e) => e.deleted_at === null && e.place).map((e) => e.place ?? ''))]
    .sort((a, b) => a.localeCompare(b)), [entries]);

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-16">
      <h1 className="text-title m-0 flex min-h-12 items-center">{strings.activity.title}</h1>
      <div className="bg-sunk focus-within:outline-forest flex min-h-12 items-center rounded-[12px] pr-0.5 pl-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-solid">
        <input
          ref={searchRef}
          // Q-L13: a text box in the search role, so no browser draws its own clear button over the app's.
          type="text"
          role="searchbox"
          inputMode="search"
          aria-label={strings.activity.search}
          placeholder={strings.activity.searchPlaceholder}
          value={filters.text}
          onChange={(e) => { change({ text: e.target.value }); }}
          onKeyDown={holdEnterWhileComposing}
          enterKeyHint="search"
          autoComplete="off"
          className="text-body text-ink placeholder:text-ink-2 w-full min-w-0 bg-transparent py-2.5 outline-none"
        />
        {/* Q-L13: the app's own clear button (the browser's is hidden), a 44 px target; focus stays in the search. */}
        {filters.text !== '' ? (
          <button
            type="button"
            aria-label={strings.activity.clearSearch}
            onClick={() => {
              change({ text: '' });
              searchRef.current?.focus();
            }}
            className="text-ink-2 press hover:text-ink inline-flex size-11 shrink-0 items-center justify-center rounded-full"
          >
            <X size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <FilterBar
        filters={filters}
        onChange={change}
        onClear={clearAll}
        people={people.list}
        nameOf={people.name}
        categories={categories ?? NO_ROWS}
        chapters={chapters ?? NO_ROWS}
        countries={countries}
        places={places}
        today={today}
      />

      {loading ? null : shown.length === 0 ? (
        shownFilters.text.trim() !== '' || filtering(shownFilters) ? (
          <Empty animal="dog" mood="curious" pose="head" text={strings.activity.noMatch}>
            <Button variant="plain" onClick={clearAll}>{strings.activity.clearFilters}</Button>
          </Empty>
        ) : (
          <Empty animal="cat" mood="sleepy" pose="curled" text={strings.activity.empty} />
        )
      ) : (
        <>
        {total !== null ? <p className="text-secondary text-ink-2 nums-list m-0">{strings.activity.totalLine(total.count, formatPence(total.total))}</p> : null}
        <ActivityList
          shown={shown}
          filters={shownFilters}
          today={today}
          categories={categories ?? NO_ROWS}
          people={people.list}
          pendingIds={pendingIds}
          commentCounts={commentCounts}
          readOnly={otherWindow}
        />
        </>
      )}
    </div>
  );
}

const NO_ROWS: never[] = [];

/** How many rows are drawn at first (more than a tall phone shows), and how many more each time. */
const FIRST_ROWS = 16;
const MORE_ROWS = 24;
/** How far below the screen the end of the list starts drawing the next rows. */
const AHEAD = '0px 0px 1200px 0px';
/** Read as the list draws (not once at load), so a test page can bring its own. */
const noObserver = () => typeof IntersectionObserver === 'undefined';

/**
 * The list itself: rows by day, drawn a screenful at a time, and the one swipe handler. Memoised, so the
 * search box, the chips and the filter sheets never redraw it; only the rows it shows do.
 */
const ActivityList = memo(function ActivityList({ shown, filters, today, categories, people, pendingIds, commentCounts, readOnly }: {
  shown: readonly Item[];
  /** The filters `shown` was made with: a new search or filter starts again at the top. */
  filters: Filters;
  today: IsoDate;
  categories: readonly CategoryRow[];
  people: readonly Person[];
  pendingIds: ReadonlySet<string>;
  commentCounts: ReadonlyMap<string, number>;
  readOnly: boolean;
}) {
  const [limit, setLimit] = useState({ filters, rows: FIRST_ROWS });
  // A new search or filter: back to the first screenful of its results. New data (a save, the other phone)
  // keeps whatever is drawn, so nothing moves under a finger.
  if (limit.filters !== filters) setLimit({ filters, rows: FIRST_ROWS });
  // (Without an IntersectionObserver to say when the end nears, every row is drawn.)
  const rows = noObserver() ? Infinity : limit.filters === filters ? limit.rows : FIRST_ROWS;
  const more = shown.length > rows;
  const showMore = () => { startTransition(() => { setLimit((l) => ({ filters: l.filters, rows: l.rows + MORE_ROWS })); }); };

  const days = useMemo(() => {
    const groups: { date: IsoDate; items: Item[] }[] = [];
    for (const i of shown.slice(0, rows)) {
      const last = groups[groups.length - 1];
      if (last?.date === i.row.date) last.items.push(i);
      else groups.push({ date: i.row.date, items: [i] });
    }
    return groups;
  }, [shown, rows]);

  // The end of the list coming within a screen or two of view draws the next rows. Watching again after each
  // step catches a list that is still short of the screen.
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = end.current;
    if (!more || !el) return;
    const watch = new IntersectionObserver((seen) => { if (seen.some((e) => e.isIntersecting)) showMore(); }, { rootMargin: AHEAD });
    watch.observe(el);
    return () => { watch.disconnect(); };
  }, [more, rows]);

  const toast = useToast();
  const swipe = useSwipe({ shown, people, today, toast });

  return (
    <div
      className="flex flex-col"
      onPointerDown={swipe.down}
      onPointerMove={swipe.move}
      onPointerUp={swipe.up}
      onPointerCancel={swipe.cancel}
      onClickCapture={swipe.click}
      onDragStart={swipe.nativeDrag}
    >
      <HeadSymbols />
      {days.map((d) => (
        <div key={d.date} className="[content-visibility:auto] [contain-intrinsic-size:auto_12rem]">
          <h2 className="text-subtitle text-ink-2 mt-4 mb-0">{formatDay(d.date, today)}</h2>
          <ul className="m-0 list-none p-0">
            {d.items.map((i) => (
              <li key={i.row.id} className="border-line border-b last:border-b-0">
                {/* A read-only window, or a deleted entry (Restore is on its page), has nothing to swipe. */}
                {i.kind === 'expense' && (readOnly || i.row.deleted_at !== null) ? (
                  <EntryRowView row={i.row} categories={categories} people={people} pending={pendingIds.has(i.row.id)} comments={commentCounts.get(i.row.id) ?? 0} shared />
                ) : i.kind === 'expense' ? (
                  <SwipeRow id={i.row.id}>
                    <EntryRowView row={i.row} categories={categories} people={people} pending={pendingIds.has(i.row.id)} comments={commentCounts.get(i.row.id) ?? 0} shared />
                  </SwipeRow>
                ) : (
                  <SettlementRowView row={i.row} people={people} shared />
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
      {more ? (
        <div ref={end} className="flex justify-center pt-2">
          {/* Scrolling brings the rest by itself; the keyboard and screen readers have this (shown when focused). */}
          <button type="button" onClick={showMore} className="sr-only focus:not-sr-only text-forest press inline-flex min-h-11 items-center rounded-full px-4">
            {strings.activity.showMore}
          </button>
        </div>
      ) : null}
    </div>
  );
});

/** A row that can be swiped: the words under it, and the row that moves (driven by the list's one handler). */
function SwipeRow({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div className="relative overflow-hidden" data-swipe={id}>
      <div aria-hidden="true" data-swipe-word="right" className="text-moss pointer-events-none absolute inset-y-0 left-0 flex items-center pl-2 font-medium opacity-0">
        {strings.activity.swipeDuplicate}
      </div>
      <div aria-hidden="true" data-swipe-word="left" className="text-berry pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2 font-medium opacity-0">
        {strings.activity.swipeDelete}
      </div>
      <div data-swipe-row="" className="relative touch-pan-y">
        {children}
      </div>
    </div>
  );
}

/** How far the finger travels for a swipe to count, in px (the row moves half as far: it pulls against a spring). */
const SWIPE = 88;
/** How far a finger moves before the gesture is read as a swipe or a scroll. */
const SLOP = 8;
/** The row follows the finger at this fraction: it is held at rest by a spring. */
const ELASTIC = 0.5;

/**
 * Swipe a row left to delete (with Undo) or right to duplicate (DESIGN §4.4), with a spring back. One set of
 * pointer handlers on the list moves whichever row the finger is on, straight on the element (no re-render).
 * The same actions are buttons on the entry's page, for anyone who doesn't swipe; Undo is the toast's button.
 */
function useSwipe({ shown, people, today, toast }: { shown: readonly Item[]; people: readonly Person[]; today: IsoDate; toast: ToastApi }) {
  const drag = useRef<{ id: string; host: HTMLElement; row: HTMLElement; words: HTMLElement[]; pointer: number; x0: number; y0: number; axis: 'x' | 'y' | null; dx: number } | null>(null);
  const swiped = useRef(false);
  const latest = useRef({ shown, people, today, toast });
  useEffect(() => { latest.current = { shown, people, today, toast }; });

  const act = (id: string, dir: 'left' | 'right') => {
    const { shown: list, people: who, today: day, toast: t } = latest.current;
    const item = list.find((i) => i.row.id === id);
    if (item?.kind !== 'expense') return;
    const row = item.row;
    if (dir === 'left') {
      if (!deleteExpense(row.id)) return;
      t.show({
        message: strings.entry.deleted(row.description),
        action: { label: strings.entry.undo, onAction: () => { try { restoreExpense(row.id); } catch (err) { t.show({ message: plainError(err) }); } } },
        duration: 5000,
      });
    } else {
      const draft = duplicateDraft(row, who, day);
      if (!draft) return;
      // Q-F1: each swipe is its own action, with its own row id made here.
      let copy: string;
      try {
        copy = addExpense({ ...draft, id: newId() });
      } catch (err) {
        // MB-3 (S9a review): e.g. a copy of money back whose original was deleted.
        t.show({ message: plainError(err) });
        return;
      }
      tickSaved();
      // Q-U8: says what happened; a swipe is easy to make by mistake, so its toast offers Undo.
      t.show({
        message: strings.entry.copied,
        action: { label: strings.entry.undo, onAction: () => { if (deleteExpense(copy)) t.show({ message: strings.entry.removed(row.description) }); } },
        duration: 5000,
        about: copy,
      });
    }
  };

  const place = (d: NonNullable<typeof drag.current>, x: number) => {
    d.row.style.transform = x === 0 ? '' : `translateX(${String(x)}px)`;
    for (const w of d.words) {
      const side = w.dataset.swipeWord === 'right' ? x : -x;
      w.style.opacity = String(Math.max(0, Math.min(1, side / SWIPE)));
    }
  };

  /** Back to rest with a spring (stiffness 500, damping 40, as before), or at once under reduced motion. */
  const rest = (d: NonNullable<typeof drag.current>) => {
    const from = d.row.style.transform;
    const words = d.words.map((w) => w.style.opacity);
    place(d, 0);
    for (const w of d.words) w.style.opacity = '';
    if (from === '' || prefersReducedMotion() || typeof d.row.animate !== 'function') {
      d.row.style.backgroundColor = '';
      return;
    }
    const timing = { duration: SPRING_MS, easing: SPRING_EASING };
    d.row.animate([{ transform: from }, { transform: 'translateX(0)' }], timing).finished
      .then(() => { d.row.style.backgroundColor = ''; }, () => { d.row.style.backgroundColor = ''; });
    d.words.forEach((w, i) => { w.animate([{ opacity: words[i] ?? '0' }, { opacity: '0' }], timing); });
  };

  return {
    down: (e: ReactPointerEvent) => {
      if (e.button !== 0 || !e.isPrimary) return;
      const host = (e.target as Element).closest<HTMLElement>('[data-swipe]');
      const row = host?.querySelector<HTMLElement>(':scope > [data-swipe-row]');
      if (!host || !row) return;
      // A mouse drag on a link would start the browser's own link drag (and select text); a finger's wouldn't.
      if (e.pointerType === 'mouse') e.preventDefault();
      drag.current = {
        id: host.dataset.swipe ?? '', host, row, words: [...host.querySelectorAll<HTMLElement>(':scope > [data-swipe-word]')],
        pointer: e.pointerId, x0: e.clientX, y0: e.clientY, axis: null, dx: 0,
      };
    },
    move: (e: ReactPointerEvent) => {
      const d = drag.current;
      if (d?.pointer !== e.pointerId) return;
      const dx = e.clientX - d.x0;
      const dy = e.clientY - d.y0;
      if (d.axis === null) {
        if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return;
        // Mostly up or down is a scroll: the row stays put.
        d.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (d.axis === 'x') {
          try { d.host.setPointerCapture(e.pointerId); } catch { /* not every browser (or test page) has it */ }
          // The row covers the words only while it moves; at rest it is the page's own paper (with its grain).
          d.row.style.backgroundColor = 'var(--paper)';
        }
      }
      if (d.axis !== 'x') return;
      d.dx = dx;
      place(d, dx * ELASTIC);
    },
    up: (e: ReactPointerEvent) => {
      const d = drag.current;
      if (d?.pointer !== e.pointerId) return;
      drag.current = null;
      if (d.axis !== 'x') return;
      // A swipe is not a tap on the row.
      swiped.current = true;
      setTimeout(() => { swiped.current = false; }, 0);
      const dir = d.dx <= -SWIPE ? 'left' : d.dx >= SWIPE ? 'right' : null;
      rest(d);
      if (dir) act(d.id, dir);
    },
    cancel: (e: ReactPointerEvent) => {
      const d = drag.current;
      if (d?.pointer !== e.pointerId) return;
      drag.current = null;
      if (d.axis === 'x') rest(d);
    },
    click: (e: { preventDefault: () => void; stopPropagation: () => void }) => {
      if (!swiped.current) return;
      e.preventDefault();
      e.stopPropagation();
    },
    nativeDrag: (e: { preventDefault: () => void; target: EventTarget }) => {
      if ((e.target as Element).closest('[data-swipe]')) e.preventDefault();
    },
  };
}

/** The spring back (stiffness 500, damping 40, mass 1: the swipe's old spring), sampled as a CSS easing. */
const SPRING_MS = 320;
const SPRING_EASING = springEasing(500, 40, 1, SPRING_MS / 1000);

function springEasing(stiffness: number, damping: number, mass: number, seconds: number): string {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const wd = w0 * Math.sqrt(Math.max(0, 1 - zeta * zeta));
  const points: string[] = [];
  for (let i = 0; i <= 24; i += 1) {
    const t = (seconds * i) / 24;
    // Progress from 0 to 1 of an underdamped spring released from rest.
    const p = 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
    points.push(String(i === 24 ? 1 : Math.round(p * 10_000) / 10_000));
  }
  return `linear(${points.join(', ')})`;
}

/** The search's chips and their sheets. Which sheet is open lives here, so opening one never redraws the list. */
function FilterBar({ filters, onChange, onClear, people, nameOf, categories, chapters, countries, places, today }: {
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  onClear: () => void;
  people: readonly Person[];
  nameOf: (id: string) => string;
  categories: readonly CategoryRow[];
  chapters: readonly ChapterRow[];
  countries: readonly string[];
  places: readonly string[];
  today: IsoDate;
}) {
  const [picker, setPicker] = useState<'payer' | 'category' | 'chapter' | 'country' | 'place' | 'dates' | 'type' | null>(null);
  const { payer, category, chapter, country, place, dates, range, type } = filters;
  const live = categories.filter((c) => !c.archived);
  const chapterLabel = chapter === '' ? null : chapter === EVERYDAY ? strings.chapters.everyday : (chapters.find((c) => c.id === chapter)?.name ?? null);
  const payerLabel = payer ? nameOf(payer) : null;
  const categoryLabel = category ? (categories.find((c) => c.id === category)?.name ?? null) : null;
  const datesLabels: Record<DatesChoice, string> = {
    any: strings.activity.anyTime, last7: strings.activity.last7, thisMonth: strings.activity.thisMonth, lastMonth: strings.activity.lastMonth,
    last3: strings.activity.last3, thisYear: strings.activity.thisYear, custom: strings.activity.pickDates,
  };
  const rangeLabel = range
    ? (range.from === range.to ? formatDay(range.from, today) : strings.activity.range(formatDate(range.from, today), formatDate(range.to, today)))
    : null;
  const typeLabels: Record<TypeChoice, string> = {
    any: strings.activity.everything, expense: strings.activity.expenses, money_back: strings.activity.moneyBack,
    settlement: strings.activity.settleUps, deleted: strings.activity.deleted,
  };
  const close = () => { setPicker(null); };

  return (
    <>
      <div role="group" aria-label={strings.activity.filters} className="flex flex-wrap gap-2">
        <FilterButton label={strings.activity.whoPaid} value={payerLabel} onClick={() => { setPicker('payer'); }} />
        <FilterButton label={strings.activity.category} value={categoryLabel} onClick={() => { setPicker('category'); }} />
        {chapters.length > 0 ? (
          <FilterButton label={strings.chapters.chapter} value={chapterLabel} onClick={() => { setPicker('chapter'); }} />
        ) : null}
        {countries.length > 1 ? (
          <FilterButton label={strings.places.country} value={country === '' ? null : (countryName(country) ?? country)} onClick={() => { setPicker('country'); }} />
        ) : null}
        {places.length > 0 ? (
          <FilterButton label={strings.places.place} value={place === '' ? null : place} onClick={() => { setPicker('place'); }} />
        ) : null}
        <FilterButton label={strings.activity.dates} value={dates === 'any' ? null : (dates === 'custom' ? rangeLabel : datesLabels[dates])} onClick={() => { setPicker('dates'); }} />
        <FilterButton label={strings.activity.type} value={type === 'any' ? null : typeLabels[type]} onClick={() => { setPicker('type'); }} />
        {filtering(filters) ? (
          <button
            type="button"
            onClick={onClear}
            className="text-secondary text-forest press inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[12px] px-3 font-medium whitespace-nowrap"
          >
            <X size={16} strokeWidth={2.25} aria-hidden="true" className="-ml-0.5 shrink-0" />
            {strings.activity.clearAll}
          </button>
        ) : null}
      </div>

      <Picker
        open={picker === 'payer'}
        title={strings.activity.whoPaid}
        onClose={close}
        value={payer ?? ''}
        options={[{ value: '', label: strings.activity.anyone }, ...people.map((p) => ({ value: p.id, label: p.name }))]}
        onPick={(v) => { onChange({ payer: v === '' ? null : v }); }}
      />
      <Picker
        open={picker === 'category'}
        title={strings.activity.category}
        onClose={close}
        value={category ?? ''}
        options={[
          { value: '', label: strings.activity.anyCategory },
          ...live.map((c) => ({ value: c.id, label: c.name, icon: <CategoryMark emoji={c.emoji} colour={c.colour} /> })),
        ]}
        onPick={(v) => { onChange({ category: v === '' ? null : v }); }}
      />
      <Picker
        open={picker === 'chapter'}
        title={strings.chapters.chapter}
        onClose={close}
        value={chapter}
        options={[
          { value: '', label: strings.activity.anyChapter },
          { value: EVERYDAY, label: strings.chapters.everyday },
          ...chapters.map((c) => ({ value: c.id, label: c.name, icon: <span aria-hidden="true">{c.emoji}</span> })),
        ]}
        onPick={(v) => { onChange({ chapter: v }); }}
      />
      <Picker
        open={picker === 'country'}
        title={strings.places.country}
        onClose={close}
        value={country}
        options={[{ value: '', label: strings.places.anyCountry }, ...countries.map((c) => ({ value: c, label: countryName(c) ?? c }))]}
        onPick={(v) => { onChange({ country: v }); }}
      />
      <Picker
        open={picker === 'place'}
        title={strings.places.place}
        onClose={close}
        value={place}
        options={[{ value: '', label: strings.places.anyPlace }, ...places.map((p) => ({ value: p, label: p }))]}
        onPick={(v) => { onChange({ place: v }); }}
      />
      <DatesPicker
        open={picker === 'dates'}
        onClose={close}
        value={dates}
        range={range}
        today={today}
        labels={datesLabels}
        onPick={(choice, picked) => { onChange({ dates: choice, range: choice === 'custom' ? picked : null }); }}
      />
      <Picker
        open={picker === 'type'}
        title={strings.activity.type}
        onClose={close}
        value={type}
        options={(Object.keys(typeLabels) as TypeChoice[]).map((k) => ({ value: k, label: typeLabels[k] }))}
        onPick={(v) => { onChange({ type: v as TypeChoice }); }}
      />
    </>
  );
}

function FilterButton({ label, value, onClick }: { label: string; value: string | null; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      className={cx(
        'text-secondary press inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[12px] px-3 font-medium whitespace-nowrap',
        value ? 'bg-forest-tint text-forest' : 'bg-sunk text-ink',
      )}
    >
      {value ? <Check size={16} strokeWidth={2.25} aria-hidden="true" className="-ml-0.5 shrink-0" /> : null}
      {value ? strings.activity.chosen(label, value) : label}
    </button>
  );
}

/** A filter's options in a small sheet: picking one applies it and closes. */
function Picker({ open, title, onClose, value, options, onPick }: {
  open: boolean;
  title: string;
  onClose: () => void;
  value: string;
  options: readonly PickerOption[];
  onPick: (value: string) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }} title={title}>
      <Options label={title} value={value} options={options} onPick={(v) => { onPick(v); onClose(); }} />
    </Sheet>
  );
}

type PickerOption = { value: string; label: string; icon?: ReactNode };

function Options({ label, value, options, onPick }: { label: string; value: string; options: readonly PickerOption[]; onPick: (value: string) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-col">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => { onPick(o.value); }}
          className={cx(
            'border-line text-body press flex min-h-12 items-center gap-3 border-b px-1 text-left last:border-b-0',
            o.value === value ? 'text-forest' : 'text-ink',
          )}
        >
          {o.icon ? <span className="w-6 text-center">{o.icon}</span> : null}
          <span className="min-w-0 flex-1 truncate">{o.label}</span>
          {o.value === value ? <Check size={18} strokeWidth={2.25} aria-hidden="true" className="shrink-0" /> : null}
        </button>
      ))}
    </div>
  );
}

function Empty({ animal, mood, pose, text, children }: {
  animal: 'cat' | 'dog';
  mood: 'sleepy' | 'curious';
  pose: 'curled' | 'head';
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <span aria-hidden="true">
        <Animal kind={animal} mood={mood} pose={pose} size={96} motion={pose === 'curled'} />
      </span>
      <p className="text-note m-0 max-w-[30ch]">{text}</p>
      {children}
    </div>
  );
}

/**
 * The Dates filter (ACT-1, Q-U10): ranges from today ("Last 7 days" first), or "Pick dates", which turns the
 * same small sheet into a month grid: tap the first day, then the last, then "Show these days".
 */
function DatesPicker({ open, onClose, value, range, today, labels, onPick }: {
  open: boolean;
  onClose: () => void;
  value: DatesChoice;
  range: DayRange | null;
  today: IsoDate;
  labels: Record<DatesChoice, string>;
  onPick: (choice: DatesChoice, range: DayRange | null) => void;
}) {
  const [picking, setPicking] = useState(false);
  const [draft, setDraft] = useState<{ from: IsoDate; to: IsoDate | null } | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setPicking(false);
      setDraft(range);
    }
  }
  const from = draft?.from ?? null;
  const to = draft?.to ?? null;
  // One sheet: the ranges, then (for "Pick dates") the month grid in the same place.
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => { if (!next) onClose(); }}
      title={picking ? strings.activity.pickDates : strings.activity.dates}
      {...(picking ? { description: strings.activity.pickDatesLine } : {})}
      {...(picking ? {
        footer: (
          <Button
            block
            disabled={from === null}
            onClick={() => {
              if (from === null) return;
              onPick('custom', { from, to: to ?? from });
              onClose();
            }}
          >
            {strings.activity.showDates}
          </Button>
        ),
      } : {})}
    >
      {!picking ? (
        <Options
          label={strings.activity.dates}
          value={value}
          options={(Object.keys(labels) as DatesChoice[]).map((k) => ({ value: k, label: labels[k] }))}
          onPick={(v) => {
            if (v === 'custom') {
              setPicking(true);
              return;
            }
            onPick(v as DatesChoice, null);
            onClose();
          }}
        />
      ) : (
        <MonthGrid
          today={today}
          focus={to ?? from ?? today}
          autoFocus
          mark={(d) => {
            if (from === null) return null;
            const end = to ?? from;
            if (d === from && d === end) return 'chosen';
            if (d === from) return 'start';
            if (d === end) return 'end';
            return d > from && d < end ? 'inside' : null;
          }}
          onPick={(d) => {
            // The first tap is the first day; the second, the last (either way round); a third starts again.
            if (from === null || to !== null) setDraft({ from: d, to: null });
            else setDraft(d < from ? { from: d, to: from } : { from, to: d });
          }}
        />
      )}
    </Sheet>
  );
}

