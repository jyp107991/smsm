/**
 * Insights (S5a; INS-3, INS-4, INS-5, INS-6, CHP-5, PLC-7, DESIGN §4.6): a period, then one sentence and one chart
 * at a time: total and comparison; where it went; trend; who paid; fairness; by country (more than one); notes.
 * Every figure is the core's (core/insights) and has a "What's this?" definition. One balance: nothing here is a debt.
 */
import { memo, useId, useMemo, useState, type ReactNode } from 'react';
import { addMonths, startOfMonth, type IsoDate } from '../../core/dates';
import {
  byCategory, byCountry, comparisonPeriod, fairness, monthlyTotals, notes, periodOf, sharedSpend, standingOrder, whoPaid, type InsightEntry, type Period,
  type PeriodChoice,
} from '../../core/insights';
import { formatPence, pence, type Pence } from '../../core/money';
import {
  useCategories, useChapters, useDataLayer, useEntries, useHousehold, useRecurring, useSettlements, type CategoryRow, type RecurringRow,
  type SettlementRow,
} from '../../data';
import { Choices, Sheet } from '../../ui/primitives';
import { AskSmsm } from './AskSmsm';
import { strings } from '../../ui/strings';
import { countryName } from '../chapters/model';
import { Toggle } from '../entry/RecurringParts';
import { NO_CATEGORIES, NO_ENTRIES } from '../shared/empty';
import { usePeople } from '../shared/people';
import { ratioWords, type Person } from '../shared/words';
import { Bars, Columns } from './Charts';
import { RecapLists } from './RecapLinks';
import { toInsight, toSettle, toTemplate } from './model';

type Choice = Exclude<PeriodChoice, 'chapter'> | `chapter:${string}`;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The 12 calendar months ending with today's, oldest first ('YYYY-MM'). */
function lastTwelve(today: IsoDate): string[] {
  const first = startOfMonth(today);
  return Array.from({ length: 12 }, (_, i) => addMonths(first, i - 11).slice(0, 7));
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
  const [a, b] = people.list;
  const pair = a && b ? ([a.id, b.id] as const) : null;

  const chapter = choice.startsWith('chapter:') ? chapters.find((c) => `chapter:${c.id}` === choice) ?? null : null;
  const period: Period = chapter
    ? periodOf('chapter', today, { id: chapter.id, startDate: chapter.start_date, endDate: chapter.end_date })
    : periodOf(choice as Exclude<PeriodChoice, 'chapter'>, today);
  // S9 (performance audit P4): the totals are worked out once per period and data, not on every render.
  const periodKey = `${period.kind}:${String(period.from)}:${String(period.to)}:${String(period.chapterId)}`;
  const pairKey = pair ? `${pair[0]}:${pair[1]}` : '';
  const { total, everydayNow, before, cats, countries, paid, trend } = useMemo(() => {
    const opts = { everydayOnly: !withChapters };
    // CHP-5: a comparison is always of everyday spending, so a trip or a wedding never makes a month look alarming.
    // S9a (INS-4): and only with days the household was keeping its spending (never months before its first entry).
    const prev = comparisonPeriod(entries, period);
    const two = pairKey === '' ? null : (pairKey.split(':') as [string, string]);
    return {
      total: sharedSpend(entries, period, opts),
      everydayNow: sharedSpend(entries, period, { everydayOnly: true }),
      before: prev ? sharedSpend(entries, prev, { everydayOnly: true }) : null,
      cats: byCategory(entries, period, opts),
      countries: byCountry(entries, period, opts),
      paid: two ? whoPaid(entries, period, two, opts) : {},
      trend: monthlyTotals(entries, lastTwelve(today), opts),
    };
    // `period` is rebuilt each render; its days (periodKey) are what it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, periodKey, pairKey, withChapters, today]);

  const fairnessEntries = useMemo(() => (withChapters ? entries : entries.filter((e) => e.chapterId === null)), [entries, withChapters]);

  const beforeWords = choice === 'month' ? strings.insights.beforeMonth : choice === '3months' ? strings.insights.before3
    : choice === '12months' ? strings.insights.before12 : strings.insights.beforeYear;
  const compared = before === null ? null
    : before === everydayNow ? strings.insights.same(formatPence(everydayNow), beforeWords)
    : strings.insights.comparison(formatPence(everydayNow), formatPence(pence(Math.abs(everydayNow - before))), everydayNow > before, beforeWords);
  const sentence = compared === null ? strings.insights.totalIn(formatPence(total))
    : total === everydayNow ? compared
    : strings.insights.withChapters(formatPence(total), compared);
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? strings.insights.uncategorised;
  const catColour = (id: string | null) => categories.find((c) => c.id === id)?.colour;

  const options: { value: Choice; label: string }[] = [
    { value: 'month', label: strings.insights.month },
    { value: '3months', label: strings.insights.months3 },
    { value: '12months', label: strings.insights.months12 },
    { value: 'year', label: strings.insights.year },
  ];

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-8 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-16">
      <h1 className="text-title m-0 flex min-h-12 items-center">{strings.insights.title}</h1>
      {/* S6b (INS-9): only with smart features on and a connection. */}
      <AskSmsm />
      <div className="flex flex-col gap-3">
        <Choices label={strings.insights.period} options={options} value={chapter ? ('' as Choice) : choice} onValueChange={setChoice} />
        {chapters.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="insights-chapter" className="text-secondary text-ink-2 font-medium">{strings.insights.chapter}</label>
            <select
              id="insights-chapter"
              value={chapter ? `chapter:${chapter.id}` : ''}
              onChange={(e) => { setChoice(e.target.value === '' ? 'month' : (e.target.value as Choice)); }}
              className="bg-sunk text-ink text-body min-h-12 w-full rounded-[12px] px-4 outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              <option value="">{strings.insights.noChapter}</option>
              {chapters.map((c) => <option key={c.id} value={`chapter:${c.id}`}>{c.name}</option>)}
            </select>
          </div>
        ) : null}
        <Toggle label={strings.insights.includeChapters} hint={strings.insights.includeChaptersHint} on={withChapters} onChange={setWithChapters} />
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
            return { key: t.month, name: `${MONTHS[m - 1] ?? ''} ${t.month.slice(0, 4)}`, short: (MONTHS[m - 1] ?? '').slice(0, 1), amount: t.total, current: t.month === today.slice(0, 7) };
          })}
        />
      </Figure>

      <Figure title={strings.insights.whoPaid} define={strings.insights.define.whoPaid}>
        <Lines label={strings.insights.whoPaid} items={people.list.map((p) => ({ key: p.id, name: p.name, amount: paid[p.id] ?? pence(0) }))} />
      </Figure>

      <Fairness entries={fairnessEntries} people={people.list} today={today} split={household?.default_ratio ?? null} />

      {countries.length > 1 ? (
        <Figure title={strings.insights.byCountry} define={strings.insights.define.byCountry}>
          <Lines label={strings.insights.byCountry} items={countries.map((c) => ({ key: c.country ?? '', name: countryName(c.country) ?? strings.insights.uncategorised, amount: c.total }))} />
        </Figure>
      ) : null}

      <RecapLists />

      <NotesSection entries={entries} settlements={settlements} templates={templates} categories={categories} people={people.list} today={today} settleDay={household?.settle_day ?? null} />
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
export function Figure({ title, define, hideTitle = false, compact = false, children }: {
  title: string; define: string; hideTitle?: boolean; compact?: boolean; children: ReactNode;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  return (
    <section aria-labelledby={id} className={compact ? 'relative flex flex-col gap-1 pr-24' : 'flex flex-col gap-3'}>
      <div className={compact ? 'absolute top-0 right-0' : hideTitle ? 'flex items-center justify-end' : 'rule-ledger flex items-baseline justify-between gap-3'}>
        <h2 id={id} className={hideTitle || compact ? 'sr-only' : 'text-heading m-0'}>{title}</h2>
        <button
          type="button"
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

/** Memoised (S9): its two lines read every entry; they change only with the entries, the people or the split. */
const Fairness = memo(function Fairness({ entries, people, today, split }: { entries: readonly InsightEntry[]; people: readonly Person[]; today: IsoDate; split: unknown }) {
  const [a, b] = people;
  if (!a || !b) return null;
  const ratio = split && typeof split === 'object' ? split as Record<string, number> : { [a.id]: 50, [b.id]: 50 };
  const splitWords = split && typeof split === 'object' ? ratioWords(ratio, people) : strings.reading.even;
  const line = (choice: '3months' | '12months') => {
    const f = fairness(entries, [a.id, b.id], periodOf(choice, today), ratio);
    return f ? strings.insights.fairnessLine(a.name, f.percents[a.id] ?? 0, b.name, f.percents[b.id] ?? 0, splitWords) : strings.insights.nothing;
  };
  return (
    <Figure title={strings.insights.fairness} define={strings.insights.define.fairness}>
      <dl className="m-0 flex flex-col gap-2">
        <div><dt className="text-secondary text-ink-2">{strings.insights.fairness3}</dt><dd className="text-body m-0">{line('3months')}</dd></div>
        <div><dt className="text-secondary text-ink-2">{strings.insights.fairness12}</dt><dd className="text-body m-0">{line('12months')}</dd></div>
      </dl>
    </Figure>
  );
});

function NotesSection({ entries, settlements, templates, categories, people, today, settleDay }: {
  entries: readonly InsightEntry[]; settlements: readonly SettlementRow[] | undefined;
  templates: readonly RecurringRow[] | undefined; categories: readonly CategoryRow[]; people: readonly Person[]; today: IsoDate;
  settleDay: number | null;
}) {
  const list = useMemo(
    () => notes({ entries, templates: (templates ?? []).map(toTemplate), categories: categories.map((c) => ({ id: c.id, name: c.name })) }, today),
    [entries, templates, categories, today],
  );
  const [a, b] = people;
  const hint = useMemo(
    // S9a (fix 23): none when the settle rhythm already covers it (a settle day, or a settle-up each month).
    () => (a && b && settlements ? standingOrder(entries, settlements.map(toSettle), [a.id, b.id], today, { settleDay }) : null),
    [a, b, settlements, entries, today, settleDay],
  );
  const name = (id: string) => people.find((p) => p.id === id)?.name ?? '';
  return (
    <Figure title={strings.insights.notes} define={strings.insights.define.notes}>
      {list.length === 0 && !hint ? <p className="text-secondary text-ink-2 m-0">{strings.insights.noNotes}</p> : (
        <ul aria-label={strings.insights.notes} className="m-0 flex list-none flex-col gap-2 p-0">
          {list.map((n, i) => <li key={i} className="text-body border-line border-b py-2 last:border-b-0">{n.text}</li>)}
          {hint ? (
            <li className="text-body border-line border-b py-2 last:border-b-0">
              {strings.insights.standingOrder(name(hint.debtor), name(hint.creditor), `£${String(Math.floor(hint.amount / 100))}`)}
            </li>
          ) : null}
        </ul>
      )}
    </Figure>
  );
}
