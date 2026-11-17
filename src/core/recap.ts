/**
 * The monthly recap, year in review and "on this day" (S5b; INS-2, INS-7, INS-8): views of the same figures as
 * Insights (core/insights) and the one balance (core/balance), worked out on the phone, never stored. The shapes are
 * pinned by src/core/recap.test.ts. Pure: no I/O, no clock.
 */
import { netPositions } from './balance';
import { addMonths, daysInMonth, type IsoDate } from './dates';
import {
  byCategory, notes, sharedSpend, usual, whoPaid, type InsightEntry, type InsightSettlement, type Month, type Note, type NoteTemplate,
  type Period,
} from './insights';
import { formatPence, pence, type Pence } from './money';
import type { UserId } from './split';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const lastOf = (m: Month): IsoDate => `${m}-${String(daysInMonth(Number(m.slice(0, 4)), Number(m.slice(5, 7)))).padStart(2, '0')}`;
const COUNTED = new Set<string>(['ratio', 'exact', 'treat']);
const isShared = (e: InsightEntry) => !e.deleted && e.kind === 'expense' && COUNTED.has(e.splitMode);

export interface RecapOptions {
  today: IsoDate;
  names: Record<UserId, string>;
  categories: readonly { id: string; name: string }[];
  templates?: readonly NoteTemplate[];
  commentCounts?: Readonly<Record<string, number>>;
}

export interface Recap {
  month: Month;
  soFar: boolean;
  total: Pence;
  everyday: Pence;
  usual: Pence | null;
  comparison: { direction: 'less' | 'more' | 'same'; amount: Pence } | null;
  headline: string;
  bar: { categoryId: string | null; name: string; total: Pence }[];
  notes: Note[];
  paid: Record<UserId, Pence>;
  balance: { debtor: UserId; creditor: UserId; amount: Pence } | null;
  moment: { id: string; description: string; amount: Pence; date: IsoDate; comments: number } | null;
}

/** INS-2: a month's recap; on or before its last day (settle day) it is "so far": the 1st to today, no comparison. */
export function recapOf(entries: readonly InsightEntry[], settlements: readonly InsightSettlement[], people: readonly [UserId, UserId], month: Month, opts: RecapOptions): Recap {
  const last = lastOf(month);
  const soFar = opts.today <= last;
  const to = soFar ? opts.today : last;
  const period: Period = { kind: 'month', from: `${month}-01`, to, chapterId: null };
  const total = sharedSpend(entries, period);
  const everyday = sharedSpend(entries, period, { everydayOnly: true });
  const u = soFar ? null : usual(entries, month);
  let comparison: Recap['comparison'] = null;
  if (u !== null) {
    const d = everyday - u;
    const abs = Math.abs(d);
    comparison = abs <= 1000 ? { direction: 'same', amount: pence(0) }
      : { direction: d < 0 ? 'less' : 'more', amount: pence(Math.floor((abs + 500) / 1000) * 1000) };
  }
  const name = MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? '';
  const pounds = (p: number) => `£${(p / 100).toLocaleString('en-GB')}`;
  const headline = `${name}${soFar ? ' so far' : ''} cost ${formatPence(total)} together`
    + (comparison === null ? '.' : comparison.direction === 'same' ? ', about the same as usual.'
      : `, about ${pounds(comparison.amount)} ${comparison.direction} than usual.`);

  // The bar shows spending: a category that money back took to nothing or below has no slice (review: no negative bar).
  const cats = byCategory(entries, period).filter((c) => c.total > 0);
  const catName = (id: string | null) => opts.categories.find((c) => c.id === id)?.name ?? '';
  const bar: Recap['bar'] = cats.length > 4
    ? [...cats.slice(0, 4).map((c) => ({ categoryId: c.categoryId, name: catName(c.categoryId), total: c.total })),
      { categoryId: null, name: 'Everything else', total: pence(cats.slice(4).reduce((t, c) => t + c.total, 0)) }]
    : cats.map((c) => ({ categoryId: c.categoryId, name: catName(c.categoryId), total: c.total }));

  const nets = netPositions(
    people,
    entries.map((e) => ({ kind: e.kind, paid: e.paid, shares: e.shares, deleted: e.deleted })),
    settlements.map((s) => ({ from: s.from, to: s.to, amount: s.amount, deleted: s.deleted })),
  );
  const [a, b] = people;
  const na = nets[a] ?? 0;
  const balance = na === 0 ? null : na > 0 ? { debtor: b, creditor: a, amount: pence(na) } : { debtor: a, creditor: b, amount: pence(0 - na) };

  const counts = opts.commentCounts ?? {};
  const candidates = entries.filter((e) => isShared(e) && e.date >= `${month}-01` && e.date <= to);
  const order = (x: InsightEntry, y: InsightEntry) => y.amount - x.amount || (x.date < y.date ? -1 : x.date > y.date ? 1 : 0);
  const commented = candidates.filter((e) => (counts[e.id] ?? 0) > 0).sort((x, y) => (counts[y.id] ?? 0) - (counts[x.id] ?? 0) || order(x, y));
  const pick = commented[0] ?? [...candidates].sort(order)[0];

  return {
    month, soFar, total, everyday, usual: u, comparison, headline, bar,
    notes: notes({ entries, templates: opts.templates ?? [], categories: opts.categories }, to, { finished: !soFar }).slice(0, 3),
    paid: whoPaid(entries, period, people),
    balance,
    moment: pick ? { id: pick.id, description: pick.description, amount: pick.amount, date: pick.date, comments: counts[pick.id] ?? 0 } : null,
  };
}

export interface YearInReview {
  year: number;
  total: Pence;
  categories: { categoryId: string | null; total: Pence }[];
  months: { month: Month; total: Pence }[];
  biggest: { id: string; description: string; amount: Pence; date: IsoDate } | null;
  chapters: { id: string; name: string; total: Pence }[];
  paid: Record<UserId, Pence>;
}

/** INS-7: a calendar year in a few cards. */
export function yearOf(entries: readonly InsightEntry[], chapters: readonly { id: string; name: string }[], people: readonly [UserId, UserId], year: number): YearInReview {
  const y = String(year);
  const period: Period = { kind: 'year', from: `${y}-01-01`, to: `${y}-12-31`, chapterId: null };
  const months = Array.from({ length: 12 }, (_, i) => addMonths(`${y}-01-01`, i).slice(0, 7))
    .map((m) => ({ month: m, total: sharedSpend(entries, { kind: 'month', from: `${m}-01`, to: lastOf(m), chapterId: null }) }));
  const inYear = entries.filter((e) => isShared(e) && e.date.startsWith(y));
  const big = [...inYear].sort((a, b) => b.amount - a.amount || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))[0];
  const touched = new Set(entries.filter((e) => !e.deleted && e.chapterId !== null && e.date.startsWith(y)).map((e) => e.chapterId));
  return {
    year, total: sharedSpend(entries, period), categories: byCategory(entries, period).slice(0, 3), months,
    biggest: big ? { id: big.id, description: big.description, amount: big.amount, date: big.date } : null,
    chapters: chapters.filter((c) => touched.has(c.id))
      .map((c) => ({ id: c.id, name: c.name, total: sharedSpend(entries, { kind: 'chapter', from: null, to: null, chapterId: c.id }) }))
      .sort((p, q) => q.total - p.total),
    paid: whoPaid(entries, period, people),
  };
}

/** INS-8: a live expense dated exactly a year ago with a comment or a chapter; the biggest if several. */
export function onThisDay<T extends InsightEntry & { place: string | null }>(entries: readonly T[], commentCounts: Readonly<Record<string, number>>, today: IsoDate): T | null {
  if (today.slice(5) === '02-29') return null;
  const target = `${String(Number(today.slice(0, 4)) - 1)}${today.slice(4)}`;
  let best: T | null = null;
  for (const e of entries) {
    if (e.deleted || e.kind !== 'expense' || e.date !== target) continue;
    if ((commentCounts[e.id] ?? 0) === 0 && e.chapterId === null) continue;
    if (!best || e.amount > best.amount) best = e;
  }
  return best;
}
