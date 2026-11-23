/**
 * Home (DESIGN §4.1): "are we square?" and adding. The plank and the sentence (with the offline and
 * waiting-to-sync pill under the plank), quick add with its live reading and the Add expense button in its
 * box (the one way to add, Q-L4; a long press offers "Same as last time", ADD-7), the last few entries by day
 * (Q-U7), and only
 * the banners that are needed: an approval waiting, a change the server refused (OFF-5). Settings is the gear.
 */
import { useEffect, useId, useMemo, useRef } from 'react';
import { Settings as Gear } from 'lucide-react';
import { formatDay } from '../../core/dates';
import { newestFirst } from '../../core/filters';
import {
  dismissProblem, useCategories, useDataLayer, useEntries, useSettlements, useSyncStatus, type ExpenseDraft, type ExpenseRow, type SettlementRow, useCommentCounts,
} from '../../data';
import { Logo } from '../../ui/Logo';
import { rememberHome, useBootDone } from '../../ui/boot';
import { Button, ICON } from '../../ui/primitives';
import { go } from '../../ui/router';
import { strings } from '../../ui/strings';
import { NO_CATEGORIES } from '../shared/empty';
import { ApprovalBanners } from '../shared/Approvals';
import { MonzoBanner } from '../settle/question';
import { usePeople } from '../shared/people';
import { EntryRowView, SettlementRowView } from '../shared/rows';
import { useSheets } from '../sheets';
import { BalanceRegion } from './Balance';
import { InboxButton, SuggestRecurring } from './BillsBanners';
import { CurrentChips } from './CurrentChapter';
import { TripBanner } from '../places/TripBanner';
import { ThisMonth } from '../insights/ThisMonth';
import { RecapBanners } from '../insights/RecapLinks';
import { QuickAdd } from './QuickAdd';

export function Home() {
  // S9: Home is drawn, so the static first paint (index.html) goes in this frame; and its shape is kept for the next one.
  useBootDone();
  const column = useRef<HTMLDivElement>(null);
  useEffect(() => rememberHome(column.current?.querySelector('header') ?? null, column.current?.querySelector<HTMLElement>(`:scope > section[aria-label="${strings.home.balance}"]`) ?? null), []);
  return (
    <div ref={column} className="mx-auto flex max-w-lg flex-col gap-6 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-10">
      <header className="flex min-h-12 items-center gap-2.5">
        <Logo size={30} />
        <h1 className="text-wordmark m-0 flex-1 text-[1.75rem] leading-none">{strings.app.name}</h1>
        <button
          type="button"
          aria-label={strings.home.settings}
          onClick={() => { go({ name: 'settings' }); }}
          className="text-ink press -mr-2.5 inline-flex size-11 items-center justify-center rounded-full"
        >
          <Gear size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" />
        </button>
      </header>
      <ApprovalBanners />
      <MonzoBanner />
      <Problems />
      <InboxButton />
      <TripBanner />
      <RecapBanners />
      <BalanceRegion />
      <CurrentChips />
      <QuickAdd />
      <ThisMonth />
      <SuggestRecurring />
      <RecentRows />
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

/** Q-U7: how many of the latest entries and settle-ups Home shows ("the last few"; Activity has the rest). */
const RECENT = 5;

type Recent = { kind: 'expense'; row: ExpenseRow } | { kind: 'settlement'; row: SettlementRow };

/**
 * Q-U7: Home shows the ledger. "Recent" is the last few entries and settle-ups (newest first, by their date,
 * then when they were added, then by id: the one order), under day headings ("Today", "Yesterday", "Tue 10 Nov"); each day's rows are a
 * list named by its heading. Never a blank "nothing today" while there is history.
 */
function RecentRows() {
  const layer = useDataLayer();
  const entries = useEntries().data;
  const settlements = useSettlements().data;
  const categories = useCategories().data ?? NO_CATEGORIES;
  const people = usePeople();
  const { pendingIds } = useSyncStatus();
  const commentCounts = useCommentCounts();
  const today = layer.today();
  const id = useId();
  const days = useMemo(() => {
    const all: Recent[] = [
      ...(entries ?? []).filter((e) => e.deleted_at === null).map((row) => ({ kind: 'expense' as const, row })),
      ...(settlements ?? []).filter((s) => s.deleted_at === null).map((row) => ({ kind: 'settlement' as const, row })),
    ];
    // S9a (ACT-1): the one order, as Activity and the statement (core/filters newestFirst).
    all.sort((a, b) => newestFirst({ date: a.row.date, createdAt: a.row.created_at, id: a.row.id }, { date: b.row.date, createdAt: b.row.created_at, id: b.row.id }));
    const groups: { date: string; items: Recent[] }[] = [];
    for (const item of all.slice(0, RECENT)) {
      const last = groups[groups.length - 1];
      if (last?.date === item.row.date) last.items.push(item);
      else groups.push({ date: item.row.date, items: [item] });
    }
    return groups;
  }, [entries, settlements]);
  const loading = entries === undefined || settlements === undefined;
  return (
    <section aria-labelledby={`${id}-recent`} className="flex flex-col">
      <div className="rule-ledger flex items-baseline justify-between gap-3">
        <h2 id={`${id}-recent`} className="text-heading m-0">{strings.home.recent}</h2>
        <a
          href="/activity"
          onClick={(e) => { e.preventDefault(); go({ name: 'activity' }); }}
          className="text-forest text-secondary -mr-2 inline-flex min-h-11 items-center rounded-full px-2 underline-offset-4 hover:underline"
        >
          {strings.home.seeAll}
        </a>
      </div>
      {loading ? null : days.length === 0 ? (
        <p className="text-secondary text-ink-2 mt-3 mb-0">{strings.home.nothingYet}</p>
      ) : (
        days.map((d, i) => {
          const heading = `${id}-day-${String(i)}`;
          return (
            <div key={d.date} className="flex flex-col">
              <h3 id={heading} className="text-subtitle text-ink-2 mt-3 mb-0">{formatDay(d.date, today)}</h3>
              <ul aria-labelledby={heading} className="m-0 list-none p-0">
                {d.items.map((item) => (
                  <li key={item.row.id} className="border-line border-b last:border-b-0">
                    {item.kind === 'expense' ? (
                      <EntryRowView row={item.row} categories={categories} people={people.list} pending={pendingIds.has(item.row.id)} comments={commentCounts.get(item.row.id) ?? 0} />
                    ) : (
                      <SettlementRowView row={item.row} people={people.list} />
                    )}
                  </li>
                ))}
              </ul>
            </div>
          );
        })
      )}
    </section>
  );
}
