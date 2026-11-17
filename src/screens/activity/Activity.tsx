/**
 * Activity (DESIGN §4.4; ACT-1, ACT-3, OFF-3, TXT-3): entries and settle-ups, newest first, grouped by day
 * on ruled lines, with search (description, notes, tags; case, width and normalisation ignored) and
 * filters (who paid, category, dates, type). Works from the phone's copy, offline too. Swipe a row left to
 * delete (with Undo) or right to duplicate.
 */
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { Check, X } from 'lucide-react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { formatDate, formatDay, type IsoDate } from '../../core/dates';
import { applyFilter, type Filter, type FilterEntry } from '../../core/filters';
import {
  addExpense, deleteExpense, newId, restoreExpense, useCategories, useChapters, useDataLayer, useEntries, useSettlements, useSyncStatus,
  type ExpenseRow, type SettlementRow,
} from '../../data';
import { tickSaved } from '../../ui/haptics';
import { holdEnterWhileComposing } from '../../ui/keys';
import { Button, ICON, Sheet, useToast } from '../../ui/primitives';
import { cx } from '../../ui/primitives/util';
import { Animal } from '../../ui/rig/Animal';
import { strings } from '../../ui/strings';
import { duplicateDraft } from '../entry/form';
import { usePeople } from '../shared/people';
import { CategoryMark } from '../shared/CategoryMark';
import { MonthGrid } from '../shared/MonthGrid';
import { EntryRowView, SettlementRowView } from '../shared/rows';
import { payerOf, type Person } from '../shared/words';
import { datesRange, type DatesChoice, type DayRange } from './dates';

type Item =
  | { kind: 'expense'; row: ExpenseRow; entry: FilterEntry }
  | { kind: 'settlement'; row: SettlementRow; entry: FilterEntry };

type TypeChoice = 'any' | 'expense' | 'money_back' | 'settlement' | 'deleted';

import { countryName } from '../chapters/model';

const EVERYDAY = '__everyday';

export function Activity() {
  const layer = useDataLayer();
  const entries = useEntries().data;
  const settlements = useSettlements().data;
  const categories = useCategories().data ?? [];
  const people = usePeople();
  const { pendingIds, otherWindow } = useSyncStatus();
  const today = layer.today();
  // Filters live with the screen: opening Activity again starts afresh.
  const [text, setText] = useState('');
  const [payer, setPayer] = useState<string | null>(null);
  const [category, setCategory] = useState<string | null>(null);
  // CHP-2: '' any chapter, EVERYDAY entries in no chapter, or a chapter's id.
  const [chapter, setChapter] = useState<string>('');
  // PLC-7, CHP-6: a country ('' any) and a place ('' any).
  const [country, setCountry] = useState<string>('');
  const [place, setPlace] = useState<string>('');
  const chapters = useChapters().data ?? [];
  const [dates, setDates] = useState<DatesChoice>('any');
  // Q-U10: the days picked under "Pick dates".
  const [range, setRange] = useState<DayRange | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [type, setType] = useState<TypeChoice>('any');
  const [picker, setPicker] = useState<'payer' | 'category' | 'chapter' | 'country' | 'place' | 'dates' | 'type' | null>(null);

  const items = useMemo((): Item[] => {
    const showDeleted = type === 'deleted';
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
  }, [entries, settlements, people.list, type]);

  const filter: Filter = {
    ...(text.trim() !== '' ? { text } : {}),
    ...(payer ? { payer } : {}),
    ...(category ? { categories: [category] } : {}),
    ...(chapter !== '' ? { chapters: [chapter === EVERYDAY ? null : chapter] } : {}),
    ...(country !== '' ? { countries: [country] } : {}),
    ...(place !== '' ? { places: [place] } : {}),
    ...datesRange(dates, today, range),
    ...(type === 'expense' || type === 'money_back' || type === 'settlement' ? { kinds: [type] } : {}),
  };
  const shown = useMemo(() => {
    const kept = new Set(applyFilter(items.map((i) => i.entry), filter));
    return items
      .filter((i) => kept.has(i.entry))
      .sort((a, b) => (a.row.date !== b.row.date ? (a.row.date < b.row.date ? 1 : -1) : a.row.created_at < b.row.created_at ? 1 : -1));
    // `filter` is rebuilt each render from these values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, text, payer, category, chapter, country, place, dates, range, type, today]);

  const days = useMemo(() => {
    const groups: { date: IsoDate; items: Item[] }[] = [];
    for (const i of shown) {
      const last = groups[groups.length - 1];
      if (last?.date === i.row.date) last.items.push(i);
      else groups.push({ date: i.row.date, items: [i] });
    }
    return groups;
  }, [shown]);

  // Q-U10: a filter is on (search has its own clear button); "Clear all" and "Clear filters" undo everything.
  const filtering = payer !== null || category !== null || chapter !== '' || country !== '' || place !== '' || dates !== 'any' || type !== 'any';
  const filtered = text.trim() !== '' || filtering;
  const clearAll = () => {
    setText('');
    setPayer(null);
    setCategory(null);
    setChapter('');
    setCountry('');
    setPlace('');
    setDates('any');
    setRange(null);
    setType('any');
  };
  const loading = entries === undefined || settlements === undefined;
  const live = categories.filter((c) => !c.archived);
  // The countries and places that occur in the household's entries (PLC-7), by name.
  const countries = useMemo(() => [...new Set((entries ?? []).filter((e) => e.deleted_at === null).map((e) => e.country))]
    .sort((a, b) => (countryName(a) ?? a).localeCompare(countryName(b) ?? b)), [entries]);
  const places = useMemo(() => [...new Set((entries ?? []).filter((e) => e.deleted_at === null && e.place).map((e) => e.place ?? ''))]
    .sort((a, b) => a.localeCompare(b)), [entries]);
  const chapterLabel = chapter === '' ? null : chapter === EVERYDAY ? strings.chapters.everyday : (chapters.find((c) => c.id === chapter)?.name ?? null);

  const payerLabel = payer ? people.name(payer) : null;
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
          value={text}
          onChange={(e) => { setText(e.target.value); }}
          onKeyDown={holdEnterWhileComposing}
          enterKeyHint="search"
          autoComplete="off"
          className="text-body text-ink placeholder:text-ink-2 w-full min-w-0 bg-transparent py-2.5 outline-none"
        />
        {/* Q-L13: the app's own clear button (the browser's is hidden), a 44 px target; focus stays in the search. */}
        {text !== '' ? (
          <button
            type="button"
            aria-label={strings.activity.clearSearch}
            onClick={() => {
              setText('');
              searchRef.current?.focus();
            }}
            className="text-ink-2 press hover:text-ink inline-flex size-11 shrink-0 items-center justify-center rounded-full"
          >
            <X size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" />
          </button>
        ) : null}
      </div>
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
        {filtering ? (
          <button
            type="button"
            onClick={clearAll}
            className="text-secondary text-forest press inline-flex h-11 shrink-0 items-center gap-1.5 rounded-[12px] px-3 font-medium whitespace-nowrap"
          >
            <X size={16} strokeWidth={2.25} aria-hidden="true" className="-ml-0.5 shrink-0" />
            {strings.activity.clearAll}
          </button>
        ) : null}
      </div>

      {loading ? null : days.length === 0 ? (
        filtered ? (
          <Empty animal="dog" mood="curious" pose="head" text={strings.activity.noMatch}>
            <Button variant="plain" onClick={clearAll}>{strings.activity.clearFilters}</Button>
          </Empty>
        ) : (
          <Empty animal="cat" mood="sleepy" pose="curled" text={strings.activity.empty} />
        )
      ) : (
        <div className="flex flex-col">
          {days.map((d) => (
            <div key={d.date} className="[content-visibility:auto] [contain-intrinsic-size:auto_12rem]">
              <h2 className="text-subtitle text-ink-2 mt-4 mb-0">{formatDay(d.date, today)}</h2>
              <ul className="m-0 list-none p-0">
                {d.items.map((i) => (
                  <li key={i.row.id} className="border-line border-b last:border-b-0">
                    {/* A read-only window, or a deleted entry (Restore is on its page), has nothing to swipe. */}
                    {i.kind === 'expense' && (otherWindow || i.row.deleted_at !== null) ? (
                      <EntryRowView row={i.row} categories={categories} people={people.list} pending={pendingIds.has(i.row.id)} />
                    ) : i.kind === 'expense' ? (
                      <Swipeable row={i.row} people={people.list} today={today}>
                        <EntryRowView row={i.row} categories={categories} people={people.list} pending={pendingIds.has(i.row.id)} />
                      </Swipeable>
                    ) : (
                      <SettlementRowView row={i.row} people={people.list} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <Picker
        open={picker === 'payer'}
        title={strings.activity.whoPaid}
        onClose={() => { setPicker(null); }}
        value={payer ?? ''}
        options={[{ value: '', label: strings.activity.anyone }, ...people.list.map((p) => ({ value: p.id, label: p.name }))]}
        onPick={(v) => { setPayer(v === '' ? null : v); }}
      />
      <Picker
        open={picker === 'category'}
        title={strings.activity.category}
        onClose={() => { setPicker(null); }}
        value={category ?? ''}
        options={[
          { value: '', label: strings.activity.anyCategory },
          ...live.map((c) => ({ value: c.id, label: c.name, icon: <CategoryMark emoji={c.emoji} colour={c.colour} /> })),
        ]}
        onPick={(v) => { setCategory(v === '' ? null : v); }}
      />
      <Picker
        open={picker === 'chapter'}
        title={strings.chapters.chapter}
        onClose={() => { setPicker(null); }}
        value={chapter}
        options={[
          { value: '', label: strings.activity.anyChapter },
          { value: EVERYDAY, label: strings.chapters.everyday },
          ...chapters.map((c) => ({ value: c.id, label: c.name, icon: <span aria-hidden="true">{c.emoji}</span> })),
        ]}
        onPick={setChapter}
      />
      <Picker
        open={picker === 'country'}
        title={strings.places.country}
        onClose={() => { setPicker(null); }}
        value={country}
        options={[{ value: '', label: strings.places.anyCountry }, ...countries.map((c) => ({ value: c, label: countryName(c) ?? c }))]}
        onPick={setCountry}
      />
      <Picker
        open={picker === 'place'}
        title={strings.places.place}
        onClose={() => { setPicker(null); }}
        value={place}
        options={[{ value: '', label: strings.places.anyPlace }, ...places.map((p) => ({ value: p, label: p }))]}
        onPick={setPlace}
      />
      <DatesPicker
        open={picker === 'dates'}
        onClose={() => { setPicker(null); }}
        value={dates}
        range={range}
        today={today}
        labels={datesLabels}
        onPick={(choice, picked) => {
          setDates(choice);
          setRange(choice === 'custom' ? picked : null);
        }}
      />
      <Picker
        open={picker === 'type'}
        title={strings.activity.type}
        onClose={() => { setPicker(null); }}
        value={type}
        options={(Object.keys(typeLabels) as TypeChoice[]).map((k) => ({ value: k, label: typeLabels[k] }))}
        onPick={(v) => { setType(v as TypeChoice); }}
      />
    </div>
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

const SWIPE = 88;

/**
 * Swipe a row left to delete (with Undo) or right to duplicate (DESIGN §4.4), with a spring back. The
 * same actions are buttons on the entry's page, for anyone who doesn't swipe.
 */
function Swipeable({ row, people, today, children }: { row: ExpenseRow; people: readonly Person[]; today: IsoDate; children: ReactNode }) {
  const toast = useToast();
  const reduce = useReducedMotion() ?? false;
  const x = useMotionValue(0);
  const dragged = useRef(false);
  const leftOpacity = useTransform(x, [0, SWIPE], [0, 1]);
  const rightOpacity = useTransform(x, [-SWIPE, 0], [1, 0]);
  // The row covers the action words only while it moves; at rest it is the page's own paper (with its grain).
  const cover = useTransform(x, (v) => (v === 0 ? 'transparent' : 'var(--paper)'));

  const act = (dir: 'left' | 'right') => {
    if (dir === 'left') {
      if (!deleteExpense(row.id)) return;
      toast.show({
        message: strings.entry.deleted(row.description),
        action: { label: strings.entry.undo, onAction: () => { restoreExpense(row.id); } },
        duration: 5000,
      });
    } else {
      const draft = duplicateDraft(row, people, today);
      if (!draft) return;
      // Q-F1: each swipe is its own action, with its own row id made here.
      const id = addExpense({ ...draft, id: newId() });
      tickSaved();
      // Q-U8: says what happened; a swipe is easy to make by mistake, so its toast offers Undo.
      toast.show({
        message: strings.entry.copied,
        action: { label: strings.entry.undo, onAction: () => { if (deleteExpense(id)) toast.show({ message: strings.entry.removed(row.description) }); } },
        duration: 5000,
        about: id,
      });
    }
  };

  return (
    <div className="relative overflow-hidden">
      <motion.div aria-hidden="true" style={{ opacity: leftOpacity }} className="text-moss absolute inset-y-0 left-0 flex items-center pl-2 font-medium">
        {strings.activity.swipeDuplicate}
      </motion.div>
      <motion.div aria-hidden="true" style={{ opacity: rightOpacity }} className="text-berry absolute inset-y-0 right-0 flex items-center pr-2 font-medium">
        {strings.activity.swipeDelete}
      </motion.div>
      <motion.div
        drag="x"
        dragDirectionLock
        dragConstraints={{ left: 0, right: 0 }}
        dragElastic={0.5}
        style={{ x, touchAction: 'pan-y', backgroundColor: cover }}
        onDragStart={() => { dragged.current = true; }}
        onDragEnd={(_, info) => {
          const dir = info.offset.x <= -SWIPE ? 'left' : info.offset.x >= SWIPE ? 'right' : null;
          if (dir) act(dir);
          void animate(x, 0, reduce ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 40 });
          setTimeout(() => { dragged.current = false; }, 0);
        }}
        onClickCapture={(e) => {
          // A swipe is not a tap on the row.
          if (dragged.current) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        className="relative"
      >
        {children}
      </motion.div>
    </div>
  );
}
