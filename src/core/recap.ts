/**
 * The monthly recap, year in review and "on this day" (S5b; INS-2, INS-7, INS-8): views of the same figures as
 * Insights (core/insights), worked out on the phone, never stored. Pure: no I/O, no clock.
 */
import { addMonths, daysInMonth, type IsoDate } from './dates';
import {
  byCategory, notes, sharedSpend, usual, whoPaid, type InsightEntry, type Note, type NoteTemplate, type Period,
} from './insights';
import { pence, type Pence } from './money';
import type { UserId } from './split';

export type Month = string; // 'YYYY-MM'

const lastOf = (m: Month): IsoDate => `${m}-${String(daysInMonth(Number(m.slice(0, 4)), Number(m.slice(5, 7)))).padStart(2, '0')}`;
const monthPeriod = (m: Month, to?: IsoDate): Period => ({ kind: 'month', from: `${m}-01`, to: to ?? lastOf(m), chapterId: null });

export interface Recap {
  month: Month;
  total: Pence;
  /** Everyday usual for the month (null without 3 months of history). */
  usual: Pence | null;
  /** Everyday spend − usual, to the nearest £10 (halves up), signed; null without a usual. */
  againstUsual: Pence | null;
  /** The top four categories and the rest (`rest: true`), summing to the total. */
  bar: { categoryId: string | null; rest: boolean; total: Pence }[];
  notes: Note[];
  paid: Record<UserId, Pence>;
  /** The month's most-commented entry, else its biggest expense. */
  moment: { id: string; description: string; amount: Pence; date: IsoDate } | null;
}

export interface RecapInput {
  entries: readonly InsightEntry[];
  templates: readonly NoteTemplate[];
  categories: readonly { id: string; name: string }[];
  people: readonly [UserId, UserId];
  /** Comment counts per entry id. */
  comments: ReadonlyMap<string, number>;
}

function nearestTen(p: number): number {
  const s = p < 0 ? -1 : 1;
  return s * Math.floor((Math.abs(p) + 500) / 1000) * 1000;
}

/** INS-2: the recap of a month, as of `to` (its last day, or today on settle day for "the month so far"). */
export function recapOf(input: RecapInput, month: Month, to?: IsoDate): Recap {
  const period = monthPeriod(month, to);
  const total = sharedSpend(input.entries, period);
  const everyday = sharedSpend(input.entries, period, { everydayOnly: true });
  const u = usual(input.entries, month);
  const cats = byCategory(input.entries, period);
  const top = cats.slice(0, 4);
  const rest = cats.slice(4).reduce((t, c) => t + c.total, 0);
  const bar: Recap['bar'] = [...top.map((c) => ({ ...c, rest: false })), ...(rest !== 0 ? [{ categoryId: null, rest: true, total: pence(rest) }] : [])];
  const last = to ?? lastOf(month);
  const live = input.entries.filter((e) => !e.deleted && e.kind === 'expense' && e.date >= `${month}-01` && e.date <= last);
  let moment: Recap['moment'] = null;
  const commented = [...live].filter((e) => (input.comments.get(e.id) ?? 0) > 0)
    .sort((a, b) => (input.comments.get(b.id) ?? 0) - (input.comments.get(a.id) ?? 0) || b.amount - a.amount);
  const pick = commented[0] ?? [...live].sort((a, b) => b.amount - a.amount || (a.date < b.date ? -1 : 1))[0];
  if (pick) moment = { id: pick.id, description: pick.description, amount: pick.amount, date: pick.date };
  return {
    month, total, usual: u, againstUsual: u === null ? null : pence(nearestTen(everyday - u)), bar,
    notes: notes({ entries: input.entries, templates: input.templates, categories: input.categories }, last, { finished: to === undefined }).slice(0, 3),
    paid: whoPaid(input.entries, period, input.people),
    moment,
  };
}

export interface YearInReview {
  year: number;
  total: Pence;
  topCategories: { categoryId: string | null; total: Pence }[];
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
    .map((m) => ({ month: m, total: sharedSpend(entries, monthPeriod(m)) }));
  const inYear = entries.filter((e) => !e.deleted && e.kind === 'expense' && e.date.startsWith(y));
  const big = [...inYear].sort((a, b) => b.amount - a.amount || (a.date < b.date ? -1 : 1))[0];
  return {
    year, total: sharedSpend(entries, period), topCategories: byCategory(entries, period).slice(0, 3), months,
    biggest: big ? { id: big.id, description: big.description, amount: big.amount, date: big.date } : null,
    chapters: chapters
      .map((c) => ({ id: c.id, name: c.name, total: sharedSpend(entries.filter((e) => e.date.startsWith(y)), { kind: 'chapter', from: null, to: null, chapterId: c.id }) }))
      .filter((c) => c.total !== 0),
    paid: whoPaid(entries, period, people),
  };
}

/** INS-8: a live entry dated exactly a year ago that has a comment or a chapter (the biggest, if several). */
export function onThisDay(entries: readonly InsightEntry[], comments: ReadonlyMap<string, number>, today: IsoDate): InsightEntry | null {
  const [y, m, d] = [Number(today.slice(0, 4)), today.slice(5, 7), today.slice(8, 10)];
  const target = `${String(y - 1)}-${m}-${d}`;
  const found = entries.filter((e) => !e.deleted && e.date === target && ((comments.get(e.id) ?? 0) > 0 || e.chapterId !== null));
  return found.sort((a, b) => b.amount - a.amount)[0] ?? null;
}
