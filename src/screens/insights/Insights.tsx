/**
 * Insights (S5a; INS-3, INS-4, INS-5, INS-6, CHP-5, PLC-7, DESIGN §4.6): a period, then one sentence and one chart
 * at a time: total and comparison; where it went; trend; who paid; fairness; by country (more than one); notes.
 * Every figure is the core's (core/insights) and has a "What's this?" definition. One balance: nothing here is a debt.
 */
import { useId, useMemo, useState, type ReactNode } from 'react';
import { addMonths, startOfMonth, type IsoDate } from '../../core/dates';
import {
  byCategory, byCountry, fairness, monthlyTotals, notes, periodOf, previousPeriod, sharedSpend, standingOrder, whoPaid, type Note, type Period,
  type PeriodChoice,
} from '../../core/insights';
import { formatPence, pence, type Pence } from '../../core/money';
import {
  useCategories, useChapters, useDataLayer, useEntries, useHousehold, useRecurring, useSettlements, type CategoryRow, type ChapterRow,
} from '../../data';
import { Choices, Sheet } from '../../ui/primitives';
import { strings } from '../../ui/strings';
import { countryName } from '../chapters/model';
import { Toggle } from '../entry/RecurringParts';
import { NO_CATEGORIES, NO_ENTRIES } from '../shared/empty';
import { usePeople } from '../shared/people';
import { ratioWords, type Person } from '../shared/words';
import { Bars, Columns } from './Charts';
import { recurringNotes, sharesOf, toInsight, toSettle } from './model';

type Choice = PeriodChoice | `chapter:${string}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function chapterPeriod(c: ChapterRow, today: IsoDate, dates: readonly IsoDate[]): Period {
  const sorted = [...dates].sort();
  return { from: c.start_date ?? sorted[0] ?? today, to: c.end_date ?? sorted[sorted.length - 1] ?? today };
}

export function Insights() {
  const layer = useDataLayer();
  const today = layer.today();
  const rows = useEntries().data ?? NO_ENTRIES;
  const settlements = useSettlements().data;
  const categories = useCategories().data ?? NO_CATEGORIES;
  const chapters = useChapters().data ?? [];
  const templates = useRecurring().data;
  const household = useHousehold().data ?? null;
  const people = usePeople();
  const [choice, setChoice] = useState<Choice>('month');
  const [withChapters, setWithChapters] = useState(true);
  const entries = useMemo(() => rows.map(toInsight), [rows]);
  const ids = useMemo(() => people.list.map((p) => p.id), [people.list]);

  const chapter = choice.startsWith('chapter:') ? chapters.find((c) => `chapter:${c.id}` === choice) ?? null : null;
  // A chapter's own spending, whichever switch; otherwise the period, with or without chapters.
  const scoped = useMemo(() => (chapter ? entries.filter((e) => e.chapterId === chapter.id) : entries), [entries, chapter]);
  const period: Period = chapter
    ? chapterPeriod(chapter, today, scoped.map((e) => e.date))
    : periodOf(choice as PeriodChoice, today);
  const opts = { everydayOnly: !chapter && !withChapters };
  const total = sharedSpend(scoped, period, opts);
  const before = chapter ? null : sharedSpend(entries, previousPeriod(period), opts);
  const cats = byCategory(scoped, period, opts);
  const countries = byCountry(scoped, period, opts);
  const paid = whoPaid(scoped, period, ids, opts);
  const trend = monthlyTotals(entries, today, 12, { everydayOnly: !withChapters });

  const beforeWords = choice === 'month' ? strings.insights.beforeMonth : choice === '3months' ? strings.insights.before3
    : choice === '12months' ? strings.insights.before12 : strings.insights.beforeYear;
  const sentence = before === null
    ? strings.insights.totalIn(formatPence(total))
    : before === total ? strings.insights.same(formatPence(total), beforeWords)
    : strings.insights.comparison(formatPence(total), formatPence(pence(Math.abs(total - before))), total > before, beforeWords);
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? strings.insights.uncategorised;
  const catColour = (id: string | null) => categories.find((c) => c.id === id)?.colour;

  const options: { value: Choice; label: string }[] = [
    { value: 'month', label: strings.insights.month },
    { value: '3months', label: strings.insights.months3 },
    { value: '12months', label: strings.insights.months12 },
    { value: 'year', label: strings.insights.year },
    ...chapters.map((c) => ({ value: `chapter:${c.id}` as const, label: c.name })),
  ];

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-8 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-16">
      <h1 className="text-title m-0 flex min-h-12 items-center">{strings.insights.title}</h1>
      <div className="flex flex-col gap-3">
        <Choices label={strings.insights.period} options={options} value={choice} onValueChange={setChoice} />
        {!chapter ? (
          <Toggle label={strings.insights.includeChapters} hint={strings.insights.includeChaptersHint} on={withChapters} onChange={setWithChapters} />
        ) : null}
      </div>

      <Figure title={strings.insights.total} define={strings.insights.define.total} hideTitle>
        <p className="text-sentence nums-list m-0">{sentence}</p>
      </Figure>

      <Figure title={strings.insights.whereItWent} define={strings.insights.define.whereItWent}>
        {cats.length === 0 ? <Empty /> : (
          <Bars
            label={strings.insights.whereItWent}
            items={cats.map((c) => ({ key: c.categoryId ?? 'none', name: catName(c.categoryId), amount: c.total, ...(catColour(c.categoryId) ? { colour: catColour(c.categoryId) } : {}) }))}
          />
        )}
      </Figure>

      <Figure title={strings.insights.trend} define={strings.insights.define.trend}>
        <Columns
          label={strings.insights.trend}
          items={trend.map((t) => {
            const m = Number(t.month.slice(5, 7));
            return { key: t.month, name: `${MONTHS[m - 1] ?? ''} ${t.month.slice(0, 4)}`, short: (MONTHS[m - 1] ?? '').slice(0, 1), amount: t.total, current: t.month === startOfMonth(today) };
          })}
        />
      </Figure>

      <Figure title={strings.insights.whoPaid} define={strings.insights.define.whoPaid}>
        <Lines label={strings.insights.whoPaid} items={people.list.map((p) => ({ key: p.id, name: p.name, amount: paid[p.id] ?? pence(0) }))} />
      </Figure>

      <Fairness entries={entries} people={people.list} today={today} split={household?.default_ratio ?? null} />

      {countries.length > 1 ? (
        <Figure title={strings.insights.byCountry} define={strings.insights.define.byCountry}>
          <Lines label={strings.insights.byCountry} items={countries.map((c) => ({ key: c.country, name: countryName(c.country) ?? c.country, amount: c.total }))} />
        </Figure>
      ) : null}

      <NotesSection rows={rows} entries={entries} settlements={settlements} templates={templates} categories={categories} people={people.list} today={today} />
    </div>
  );
}

function Empty() {
  return <p className="text-secondary text-ink-2 m-0">{strings.insights.nothing}</p>;
}

function Lines({ label, items }: { label: string; items: readonly { key: string; name: string; amount: Pence }[] }) {
  return (
    <ul aria-label={label} className="m-0 list-none p-0">
      {items.map((i) => (
        <li key={i.key} className="border-line flex min-h-11 items-baseline justify-between gap-4 border-b py-2 last:border-b-0">
          <span className="text-body min-w-0 break-words">{i.name}</span>{' '}
          <span className="text-body nums-list shrink-0">{formatPence(i.amount)}</span>
        </li>
      ))}
    </ul>
  );
}

/** A figure: a region named by its title, with "What's this?" opening its one-line definition. */
export function Figure({ title, define, hideTitle = false, children }: { title: string; define: string; hideTitle?: boolean; children: ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <div className={hideTitle ? 'flex items-center justify-end' : 'rule-ledger flex items-baseline justify-between gap-3'}>
        <h2 id={id} className={hideTitle ? 'sr-only' : 'text-heading m-0'}>{title}</h2>
        <button
          type="button"
          aria-label={strings.insights.whatsThisAbout(title)}
          onClick={() => { setOpen(true); }}
          className="text-forest text-secondary -mr-2 inline-flex min-h-11 items-center rounded-full px-2 underline-offset-4 hover:underline"
        >
          {strings.insights.whatsThis}
        </button>
      </div>
      {children}
      <Sheet open={open} onOpenChange={setOpen} title={title}>
        <p className="m-0 pb-4">{define}</p>
      </Sheet>
    </section>
  );
}

function Fairness({ entries, people, today, split }: { entries: Parameters<typeof fairness>[0]; people: readonly Person[]; today: IsoDate; split: unknown }) {
  const [a, b] = people;
  if (!a || !b) return null;
  const splitWords = split && typeof split === 'object' ? ratioWords(split, people) : strings.reading.even;
  const line = (from: IsoDate) => {
    const f = fairness(entries, [a.id, b.id], { from, to: today });
    return strings.insights.fairnessLine(a.name, f.percent[a.id] ?? 0, b.name, f.percent[b.id] ?? 0, splitWords);
  };
  const month = startOfMonth(today);
  return (
    <Figure title={strings.insights.fairness} define={strings.insights.define.fairness}>
      <dl className="m-0 flex flex-col gap-2">
        <div><dt className="text-secondary text-ink-2">{strings.insights.fairness3}</dt><dd className="text-body m-0">{line(addMonths(month, -2))}</dd></div>
        <div><dt className="text-secondary text-ink-2">{strings.insights.fairness12}</dt><dd className="text-body m-0">{line(addMonths(month, -11))}</dd></div>
      </dl>
    </Figure>
  );
}

export function noteWords(n: Note, categories: readonly CategoryRow[]): string {
  const cat = (id: string | null) => categories.find((c) => c.id === id)?.name ?? strings.insights.uncategorised;
  const whole = (p: number) => `£${String(Math.floor((p + 50) / 100))}`;
  switch (n.kind) {
    case 'category': return strings.insights.noteCategory(cat(n.categoryId), whole(n.over), whole(n.soFar), whole(n.usual));
    case 'entry': return strings.insights.noteEntry(n.description, formatPence(n.amount), n.times, cat(n.categoryId));
    case 'price': return strings.insights.notePrice(n.description, formatPence(n.before), formatPence(n.after));
    case 'new-recurring': return strings.insights.noteNew(n.description, formatPence(n.perMonth));
  }
}

function NotesSection({ rows, entries, settlements, templates, categories, people, today }: {
  rows: Parameters<typeof sharesOf>[0]; entries: Parameters<typeof notes>[0]['entries']; settlements: Parameters<typeof toSettle>[0][] | undefined;
  templates: Parameters<typeof recurringNotes>[0] | undefined; categories: readonly CategoryRow[]; people: readonly Person[]; today: IsoDate;
}) {
  const list = useMemo(() => notes({ entries, today, ...recurringNotes(templates ?? [], rows, today) }), [entries, today, templates, rows]);
  const [a, b] = people;
  const hint = useMemo(
    () => (a && b && settlements ? standingOrder(entries, settlements.map(toSettle), [a.id, b.id], today, sharesOf(rows)) : null),
    [a, b, settlements, entries, today, rows],
  );
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? '';
  const whole = (p: number) => `£${String(Math.floor(p / 100))}`;
  return (
    <Figure title={strings.insights.notes} define={strings.insights.define.notes}>
      {list.length === 0 && !hint ? <p className="text-secondary text-ink-2 m-0">{strings.insights.noNotes}</p> : (
        <ul aria-label={strings.insights.notes} className="m-0 flex list-none flex-col gap-2 p-0">
          {list.map((n, i) => <li key={i} className="text-body border-line border-b py-2 last:border-b-0">{noteWords(n, categories)}</li>)}
          {hint ? (
            <li className="text-body border-line border-b py-2 last:border-b-0">
              {strings.insights.standingOrder(name(hint.debtor), name(hint.creditor), whole(hint.mean), whole(hint.amount))}
            </li>
          ) : null}
        </ul>
      )}
    </Figure>
  );
}
