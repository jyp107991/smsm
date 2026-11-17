/**
 * Activity (DESIGN §4.4; ACT-1, ACT-3, OFF-3, TXT-3): entries and settle-ups, newest first, grouped by day
 * on ruled lines, with search (description, notes, tags; case, width and normalisation ignored) and
 * filters (who paid, category, dates, type). Works from the phone's copy, offline too. Swipe a row left to
 * delete (with Undo) or right to duplicate.
 */
import { animate, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { formatDay, type IsoDate } from '../../core/dates';
import { applyFilter, type Filter, type FilterEntry } from '../../core/filters';
import {
  addExpense, deleteExpense, restoreExpense, useCategories, useDataLayer, useEntries, useSettlements, useSyncStatus,
  type ExpenseRow, type SettlementRow,
} from '../../data';
import { tickSaved } from '../../ui/haptics';
import { holdEnterWhileComposing } from '../../ui/keys';
import { Sheet, useToast } from '../../ui/primitives';
import { cx } from '../../ui/primitives/util';
import { Animal } from '../../ui/rig/Animal';
import { strings } from '../../ui/strings';
import { copyForm, draftOf } from '../entry/form';
import { usePeople } from '../shared/people';
import { EntryRowView, SettlementRowView } from '../shared/rows';
import { payerOf, type Person } from '../shared/words';
import { datesRange, type DatesChoice } from './dates';

type Item =
  | { kind: 'expense'; row: ExpenseRow; entry: FilterEntry }
  | { kind: 'settlement'; row: SettlementRow; entry: FilterEntry };

type TypeChoice = 'any' | 'expense' | 'money_back' | 'settlement' | 'deleted';

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
  const [dates, setDates] = useState<DatesChoice>('any');
  const [type, setType] = useState<TypeChoice>('any');
  const [picker, setPicker] = useState<'payer' | 'category' | 'dates' | 'type' | null>(null);

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
    ...datesRange(dates, today),
    ...(type === 'expense' || type === 'money_back' || type === 'settlement' ? { kinds: [type] } : {}),
  };
  const shown = useMemo(() => {
    const kept = new Set(applyFilter(items.map((i) => i.entry), filter));
    return items
      .filter((i) => kept.has(i.entry))
      .sort((a, b) => (a.row.date !== b.row.date ? (a.row.date < b.row.date ? 1 : -1) : a.row.created_at < b.row.created_at ? 1 : -1));
    // `filter` is rebuilt each render from these values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, text, payer, category, dates, type, today]);

  const days = useMemo(() => {
    const groups: { date: IsoDate; items: Item[] }[] = [];
    for (const i of shown) {
      const last = groups[groups.length - 1];
      if (last?.date === i.row.date) last.items.push(i);
      else groups.push({ date: i.row.date, items: [i] });
    }
    return groups;
  }, [shown]);

  const filtered = text.trim() !== '' || payer !== null || category !== null || dates !== 'any' || type !== 'any';
  const loading = entries === undefined || settlements === undefined;
  const live = categories.filter((c) => !c.archived);

  const payerLabel = payer ? people.name(payer) : null;
  const categoryLabel = category ? (categories.find((c) => c.id === category)?.name ?? null) : null;
  const datesLabels: Record<DatesChoice, string> = {
    any: strings.activity.anyTime, thisMonth: strings.activity.thisMonth, lastMonth: strings.activity.lastMonth,
    last3: strings.activity.last3, thisYear: strings.activity.thisYear,
  };
  const typeLabels: Record<TypeChoice, string> = {
    any: strings.activity.everything, expense: strings.activity.expenses, money_back: strings.activity.moneyBack,
    settlement: strings.activity.settleUps, deleted: strings.activity.deleted,
  };

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-16">
      <h1 className="text-title m-0 flex min-h-12 items-center">{strings.activity.title}</h1>
      <div className="bg-sunk focus-within:outline-forest flex min-h-12 items-center rounded-[12px] px-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-solid">
        <input
          type="search"
          aria-label={strings.activity.search}
          placeholder={strings.activity.searchPlaceholder}
          value={text}
          onChange={(e) => { setText(e.target.value); }}
          onKeyDown={holdEnterWhileComposing}
          enterKeyHint="search"
          autoComplete="off"
          className="text-body text-ink placeholder:text-ink-2 w-full min-w-0 bg-transparent py-2.5 outline-none"
        />
      </div>
      <div role="group" aria-label={strings.activity.filters} className="flex flex-wrap gap-2">
        <FilterButton label={strings.activity.whoPaid} value={payerLabel} onClick={() => { setPicker('payer'); }} />
        <FilterButton label={strings.activity.category} value={categoryLabel} onClick={() => { setPicker('category'); }} />
        <FilterButton label={strings.activity.dates} value={dates === 'any' ? null : datesLabels[dates]} onClick={() => { setPicker('dates'); }} />
        <FilterButton label={strings.activity.type} value={type === 'any' ? null : typeLabels[type]} onClick={() => { setPicker('type'); }} />
      </div>

      {loading ? null : days.length === 0 ? (
        filtered ? (
          <Empty animal="dog" mood="curious" pose="head" text={strings.activity.noMatch} />
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
                    {i.kind === 'expense' && otherWindow ? (
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
          ...live.map((c) => ({ value: c.id, label: c.name, icon: <span aria-hidden="true">{c.emoji}</span> })),
        ]}
        onPick={(v) => { setCategory(v === '' ? null : v); }}
      />
      <Picker
        open={picker === 'dates'}
        title={strings.activity.dates}
        onClose={() => { setPicker(null); }}
        value={dates}
        options={(Object.keys(datesLabels) as DatesChoice[]).map((k) => ({ value: k, label: datesLabels[k] }))}
        onPick={(v) => { setDates(v as DatesChoice); }}
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
        'text-secondary inline-flex h-11 shrink-0 items-center rounded-[12px] border-2 px-3 font-medium whitespace-nowrap',
        value ? 'border-forest bg-surface text-forest' : 'bg-sunk text-ink border-transparent',
      )}
    >
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
  options: readonly { value: string; label: string; icon?: ReactNode }[];
  onPick: (value: string) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }} title={title}>
      <div role="radiogroup" aria-label={title} className="flex flex-col">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            onClick={() => {
              onPick(o.value);
              onClose();
            }}
            className={cx(
              'border-line text-body flex min-h-12 items-center gap-3 border-b px-1 text-left last:border-b-0',
              o.value === value ? 'text-forest' : 'text-ink',
            )}
          >
            {o.icon ? <span className="w-6 text-center">{o.icon}</span> : null}
            <span className="min-w-0 flex-1 truncate">{o.label}</span>
            {o.value === value ? <span aria-hidden="true" className="bg-forest size-2 rounded-full" /> : null}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function Empty({ animal, mood, pose, text }: { animal: 'cat' | 'dog'; mood: 'sleepy' | 'curious'; pose: 'curled' | 'head'; text: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      <span aria-hidden="true">
        <Animal kind={animal} mood={mood} pose={pose} size={96} motion={pose === 'curled'} />
      </span>
      <p className="text-note m-0 max-w-[30ch]">{text}</p>
    </div>
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

  const act = (dir: 'left' | 'right') => {
    if (dir === 'left') {
      deleteExpense(row.id);
      toast.show({
        message: strings.entry.deleted(row.description),
        action: { label: strings.entry.undo, onAction: () => { restoreExpense(row.id); } },
        duration: 5000,
      });
    } else {
      const r = draftOf(copyForm(row, people, today), people);
      if (!('draft' in r)) return;
      const id = addExpense(r.draft);
      tickSaved();
      toast.show({ message: strings.entry.saved, action: { label: strings.entry.undo, onAction: () => { deleteExpense(id); } }, duration: 5000 });
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
        style={{ x, touchAction: 'pan-y' }}
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
        className="bg-paper relative"
      >
        {children}
      </motion.div>
    </div>
  );
}
