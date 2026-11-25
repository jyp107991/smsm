/**
 * Insights (S5a; INS-1, INS-3…INS-6, CHP-5, PLC-7): every figure, exactly, in integer pence, by the definitions in
 * docs/DATA_MODEL.md §3 and §5 and docs/slices/S5.md (the interface is pinned by src/core/insights.test.ts). Pure.
 *
 * Shared spend: live expenses split ratio/exact/treat at their full amount, minus live money back (not for_other),
 * dated in the period (a chapter period: that chapter's entries, whatever their dates). Settle-ups never count.
 * Everyday: in no chapter. Usual, pace and notes use everyday only.
 */
import { isPersonal, netPositions, withoutOrphans } from './balance';
import { addMonths, daysInMonth, startOfMonth, type IsoDate } from './dates';
import { formatPence, pence, type Pence } from './money';
import { monthlyCost } from './recurring';
import type { PenceMap, SplitMode, UserId } from './split';

export type Month = string; // 'YYYY-MM'

export interface InsightEntry {
  id: string; kind: 'expense' | 'money_back'; description: string; amount: Pence; paid: PenceMap; shares: PenceMap;
  splitMode: SplitMode; date: IsoDate; categoryId: string | null; chapterId: string | null; country: string | null;
  recurringId: string | null; deleted: boolean;
  /** MB-3 (S9a): for money back, the entry it refunds; money back whose original is deleted never counts. */
  refundOf?: string | null;
  /** When it was added (S9a: the one order). */
  createdAt?: string;
  /** S10 (REC-12): whose it is: null or absent, shared; a person's id, their own (never in a shared figure). */
  ownerId?: UserId | null;
}
export interface InsightSettlement { from: UserId; to: UserId; amount: Pence; date: IsoDate; deleted: boolean }
export type PeriodChoice = 'month' | '3months' | '12months' | 'year' | 'chapter';
export interface Period { kind: PeriodChoice; from: IsoDate | null; to: IsoDate | null; chapterId: string | null }
export interface PeriodChapter { id: string; startDate: IsoDate | null; endDate: IsoDate | null }
export interface SpendOptions { everydayOnly?: boolean }
export interface Pace { soFar: Pence; usual: Pence | null; direction: 'under' | 'over' | 'on' | null; amount: Pence | null; ratio: number | null }
export interface NoteTemplate {
  id: string; description: string; amount: Pence; frequency: 'weekly' | 'monthly' | 'yearly'; every: number; startDate: IsoDate;
  isSubscription: boolean; active: boolean;
  /** S10: a personal one (its owner's id) is never a shared note. */
  ownerId?: UserId | null;
}
export interface Note { kind: 'category' | 'entry' | 'price' | 'new-regular'; text: string; weight: Pence }
export interface Fairness { percents: Record<UserId, number>; split: Record<UserId, number>; total: Pence }

const COUNTED = new Set<string>(['ratio', 'exact', 'treat']);
const month = (d: IsoDate): Month => d.slice(0, 7);
const firstOf = (m: Month): IsoDate => `${m}-01`;
const lastOf = (m: Month): IsoDate => `${m}-${String(daysInMonth(Number(m.slice(0, 4)), Number(m.slice(5, 7)))).padStart(2, '0')}`;
const shiftMonth = (m: Month, k: number): Month => addMonths(firstOf(m), k).slice(0, 7);

/** Shared spending at all (the period aside): counted expenses and money back that isn't for the other. */
function counts(e: InsightEntry): boolean {
  // S10 (REC-12): one person's own entry is never shared spending.
  if (e.deleted || isPersonal(e)) return false;
  return e.kind === 'expense' ? COUNTED.has(e.splitMode) : e.splitMode !== 'for_other';
}
const sign = (e: InsightEntry) => (e.kind === 'money_back' ? -1 : 1);

function inPeriod(e: InsightEntry, p: Period): boolean {
  if (p.kind === 'chapter') return e.chapterId === p.chapterId;
  return (p.from === null || e.date >= p.from) && (p.to === null || e.date <= p.to);
}

function selected(entries: readonly InsightEntry[], p: Period, opts: SpendOptions = {}): InsightEntry[] {
  // MB-3: money back whose original is deleted never counts.
  return withoutOrphans(entries).filter((e) => counts(e) && inPeriod(e, p) && (!opts.everydayOnly || p.kind === 'chapter' || e.chapterId === null));
}

function sum(entries: readonly InsightEntry[]): number {
  let t = 0;
  for (const e of entries) t += sign(e) * e.amount;
  return t;
}

/**
 * S10 (INS-10): one person's own entries, on their own: each as it was but read as shared spending (ownerId cleared), so
 * every rule of the shared figures (the period, the comparison period, usual and pace, by category) applies to them
 * unchanged, and nothing shared is among them. Their own entries are never in a shared figure.
 */
export function ownView(entries: readonly InsightEntry[], owner: UserId): InsightEntry[] {
  return entries.filter((e) => e.ownerId === owner).map((e) => ({ ...e, ownerId: null }));
}

export function periodOf(choice: PeriodChoice, today: IsoDate, chapter?: PeriodChapter): Period {
  const first = startOfMonth(today);
  switch (choice) {
    case 'month': return { kind: choice, from: first, to: today, chapterId: null };
    case '3months': return { kind: choice, from: addMonths(first, -2), to: today, chapterId: null };
    case '12months': return { kind: choice, from: addMonths(first, -11), to: today, chapterId: null };
    case 'year': return { kind: choice, from: `${today.slice(0, 4)}-01-01`, to: today, chapterId: null };
    case 'chapter': return { kind: choice, from: chapter?.startDate ?? null, to: chapter?.endDate ?? null, chapterId: chapter?.id ?? null };
  }
}

/** The same-length period just before: each end moved back 1, 3 or 12 months (clamped to the month's end). */
export function previousPeriod(p: Period): Period | null {
  if (p.kind === 'chapter' || p.from === null || p.to === null) return null;
  const k = p.kind === 'month' ? 1 : p.kind === '3months' ? 3 : 12;
  return { ...p, from: addMonths(p.from, -k), to: addMonths(p.to, -k) };
}

/** The first day with a live entry, or null with none (the household's history starts there). */
function firstDay(entries: readonly InsightEntry[]): IsoDate | null {
  let first: IsoDate | null = null;
  for (const e of entries) if (!e.deleted && !isPersonal(e) && (first === null || e.date < first)) first = e.date;
  return first;
}

/**
 * INS-4 (S9a): the period Insights compares with: the one just before (previousPeriod), unless it starts before the
 * household's first live entry (a comparison with months before it existed is no comparison); null for a chapter or
 * with no entries.
 */
export function comparisonPeriod(entries: readonly InsightEntry[], period: Period): Period | null {
  const before = previousPeriod(period);
  const first = firstDay(entries);
  if (before === null || first === null || before.from === null || before.from < first) return null;
  return before;
}

export function sharedSpend(entries: readonly InsightEntry[], period: Period, opts: SpendOptions = {}): Pence {
  return pence(sum(selected(entries, period, opts)));
}

function grouped<K>(entries: readonly InsightEntry[], key: (e: InsightEntry) => K): [K, number][] {
  const m = new Map<K, number>();
  for (const e of entries) m.set(key(e), (m.get(key(e)) ?? 0) + sign(e) * e.amount);
  return [...m].filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]);
}

export function byCategory(entries: readonly InsightEntry[], period: Period, opts: SpendOptions = {}): { categoryId: string | null; total: Pence }[] {
  return grouped(selected(entries, period, opts), (e) => e.categoryId).map(([categoryId, t]) => ({ categoryId, total: pence(t) }));
}

export function byCountry(entries: readonly InsightEntry[], period: Period, opts: SpendOptions = {}): { country: string | null; total: Pence }[] {
  return grouped(selected(entries, period, opts), (e) => e.country).map(([country, t]) => ({ country, total: pence(t) }));
}

export function whoPaid(entries: readonly InsightEntry[], period: Period, people: readonly [UserId, UserId], opts: SpendOptions = {}): Record<UserId, Pence> {
  const out: Record<UserId, number> = { [people[0]]: 0, [people[1]]: 0 };
  for (const e of selected(entries, period, opts)) for (const p of people) out[p] = (out[p] ?? 0) + sign(e) * (e.paid[p] ?? 0);
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, pence(v)]));
}

const monthPeriod = (m: Month): Period => ({ kind: 'month', from: firstOf(m), to: lastOf(m), chapterId: null });

export function monthlyTotals(entries: readonly InsightEntry[], months: readonly Month[], opts: SpendOptions = {}): { month: Month; total: Pence }[] {
  return months.map((m) => ({ month: m, total: sharedSpend(entries, monthPeriod(m), opts) }));
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 1 ? (s[(n - 1) / 2] ?? 0) : Math.floor(((s[n / 2 - 1] ?? 0) + (s[n / 2] ?? 0)) / 2);
}

/** The full months before `m` (after the month of the first live entry), most recent first, at most 6. */
function fullMonths(entries: readonly InsightEntry[], m: Month): Month[] {
  let first: Month | null = null;
  for (const e of entries) if (!e.deleted && !isPersonal(e) && (first === null || month(e.date) < first)) first = month(e.date);
  if (first === null) return [];
  const out: Month[] = [];
  for (let k = 1; k <= 6; k += 1) {
    const x = shiftMonth(m, -k);
    if (x <= first) break;
    out.push(x);
  }
  return out;
}

/** Usual (everyday): the median of the previous 3–6 full months; fewer than 3 → null. With categoryId: that category's. */
export function usual(entries: readonly InsightEntry[], m: Month, opts: { categoryId?: string | null } = {}): Pence | null {
  const months = fullMonths(entries, m);
  if (months.length < 3) return null;
  const everyday = withoutOrphans(entries).filter((e) => e.chapterId === null && (opts.categoryId === undefined || e.categoryId === opts.categoryId));
  return pence(median(months.map((x) => sharedSpend(everyday, monthPeriod(x)))));
}

/**
 * INS-1 (S9a review): the day of a comparison month that matches `day` of this month (`length` days long). Up to the
 * 28th, the same day, unless it is the last. On this month's last day, and after the 28th, the same distance from its
 * end, so a bill on the last day lands on the last day of every month: on this month's last day every month counts
 * in full; on 30 October (one day before the end) a 30-day September counts to the 29th. Never before the 1st.
 */
export function sameDayIn(day: number, length: number, otherLength: number): number {
  if (day < 28 || (day === 28 && length > 28)) return day;
  return Math.max(1, otherLength - (length - day));
}

/**
 * INS-1 (S9a): what usually lands by this day of the month: over the usual's months (the previous 3–6 full months),
 * the mean of each month's everyday spending dated on or before this day of the month (sameDayIn: after the 28th,
 * counted from the month's end, so a bill on the 31st is on the 30th in a 30-day month). A bill that usually lands on the 25th isn't counted before the 25th, so it is never "money saved". As a
 * fraction `total / months` (exact); null with fewer than 3 months.
 */
export function usualByDay(entries: readonly InsightEntry[], today: IsoDate): { total: number; months: number } | null {
  const months = fullMonths(entries, month(today));
  if (months.length < 3) return null;
  const day = Number(today.slice(8, 10));
  const length = daysInMonth(Number(today.slice(0, 4)), Number(today.slice(5, 7)));
  let total = 0;
  for (const m of months) {
    const last = sameDayIn(day, length, daysInMonth(Number(m.slice(0, 4)), Number(m.slice(5, 7))));
    total += sharedSpend(entries, { kind: 'month', from: firstOf(m), to: `${m}-${String(last).padStart(2, '0')}`, chapterId: null }, { everydayOnly: true });
  }
  return { total, months: months.length };
}

/**
 * INS-1: everyday spending so far this month against what usually lands by today (usualByDay); within £10 is "on",
 * otherwise the difference to the nearest £10, halves up. `usual` is the month's usual (median), for reference.
 */
export function pace(entries: readonly InsightEntry[], today: IsoDate): Pace {
  const soFar = sharedSpend(entries, periodOf('month', today), { everydayOnly: true });
  const u = usual(entries, month(today));
  const by = usualByDay(entries, today);
  if (u === null || by === null) return { soFar, usual: null, direction: null, amount: null, ratio: null };
  const n = by.months;
  const scaled = soFar * n - by.total; // (soFar − expected) × months, exact
  const abs = Math.abs(scaled);
  const direction = abs <= 1000 * n ? 'on' : scaled < 0 ? 'under' : 'over';
  const amount = Math.floor((abs + 500 * n) / (1000 * n)) * 1000;
  return { soFar, usual: u, direction, amount: pence(amount), ratio: by.total > 0 ? (soFar * n) / by.total - 1 : null };
}

const wholePounds = (p: number): string => `£${Math.round(p / 100).toLocaleString('en-GB')}`;

/** INS-3: this month's notes (everyday only), each by its stated rule, by weight, largest first. */
export function notes(
  input: { entries: readonly InsightEntry[]; templates: readonly NoteTemplate[]; categories: readonly { id: string; name: string }[] },
  today: IsoDate,
  /** A finished month (the recap): its figures are "£460", not "£460 so far". */
  opts: { finished?: boolean } = {},
): Note[] {
  const { entries, templates, categories } = input;
  const m = month(today);
  const thisMonth = periodOf('month', today);
  const everyday = withoutOrphans(entries).filter((e) => e.chapterId === null);
  const nameOf = (id: string | null) => categories.find((c) => c.id === id)?.name ?? '';
  const out: Note[] = [];
  // A category at least 30% and £20 above its usual (both inclusive, exact).
  for (const c of categories) {
    const u = usual(entries, m, { categoryId: c.id });
    // A category with no usual (quiet in most months) has nothing to be "over".
    if (u === null || u <= 0) continue;
    const now = sum(selected(everyday.filter((e) => e.categoryId === c.id), thisMonth));
    if (now * 10 >= u * 13 && now - u >= 2000) {
      // The shown figures agree with each other: the excess is the difference of the rounded pounds.
      const nowP = Math.round(now / 100);
      const usualP = Math.round(u / 100);
      out.push({ kind: 'category', text: `${c.name} is £${(nowP - usualP).toLocaleString('en-GB')} over its usual (${wholePounds(now)}${opts.finished ? '' : ' so far'}, usually ${wholePounds(u)})`, weight: pence(now - u) });
    }
  }
  // An entry at least 3× its category's median over the 6 full months before this one, with at least 5 of those.
  const six: Period = { kind: 'month', from: firstOf(shiftMonth(m, -6)), to: lastOf(shiftMonth(m, -1)), chapterId: null };
  // Each category's earlier expenses, gathered once (not once per entry: Home works this out on every change).
  const earlierBy = new Map<string, number[]>();
  for (const x of selected(everyday, six)) {
    if (x.kind !== 'expense' || x.categoryId === null) continue;
    const list = earlierBy.get(x.categoryId);
    if (list) list.push(x.amount); else earlierBy.set(x.categoryId, [x.amount]);
  }
  const medians = new Map<string, number>();
  for (const [k, list] of earlierBy) if (list.length >= 5) medians.set(k, median(list));
  for (const e of selected(everyday, thisMonth)) {
    // An uncategorised entry has no "usual entry" to compare with.
    if (e.kind !== 'expense' || e.categoryId === null) continue;
    const med = medians.get(e.categoryId);
    if (med !== undefined && med > 0 && e.amount >= 3 * med) {
      out.push({ kind: 'entry', text: `${e.description} ${wholePounds(e.amount)} is about ${String(Math.round(e.amount / med))}× a usual ${nameOf(e.categoryId)} entry`, weight: e.amount });
    }
  }
  for (const t of templates) {
    // S10: one person's own regular payment is never a shared note.
    if (isPersonal(t)) continue;
    // A subscription whose entry posted this month differs from the one before.
    if (t.isSubscription) {
      const posted = entries.filter((e) => !e.deleted && e.recurringId === t.id).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
      const last = posted[posted.length - 1];
      const before = posted[posted.length - 2];
      if (last && before && month(last.date) === m && last.date <= today && last.amount !== before.amount) {
        out.push({ kind: 'price', text: `${t.description} went from ${formatPence(before.amount)} to ${formatPence(last.amount)}`, weight: pence(Math.abs(last.amount - before.amount)) });
      }
    }
    // A regular payment started this month (S10: not an older one whose start was moved into it: it posted before the 1st).
    const postedBefore = entries.some((e) => !e.deleted && e.recurringId === t.id && e.date < firstOf(m));
    if (t.active && t.startDate >= firstOf(m) && t.startDate <= today && !postedBefore) {
      const perMonth = monthlyCost({ frequency: t.frequency, every: t.every }, t.amount);
      out.push({ kind: 'new-regular', text: `New regular payment: ${t.description} ${formatPence(perMonth)} a month`, weight: t.amount });
    }
  }
  return out.sort((a, b) => b.weight - a.weight);
}

/** Whole percentages summing to 100: largest remainder, a tie to the first. */
function percentages(values: readonly number[]): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  const floors = values.map((v) => Math.floor((v * 100) / total));
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = values.map((v, i) => ({ i, rem: (v * 100) % total })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    floors[o.i] = (floors[o.i] ?? 0) + 1;
    left -= 1;
  }
  return floors;
}

/** INS-5: each person's share of what was paid, beside the agreed split; null when nothing was paid. */
export function fairness(entries: readonly InsightEntry[], people: readonly [UserId, UserId], period: Period, split: Record<UserId, number>): Fairness | null {
  const paid = whoPaid(entries, period, people);
  const values: number[] = people.map((p) => paid[p] ?? 0);
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const pct = percentages(values.map((v) => Math.max(0, v)));
  return { percents: { [people[0]]: pct[0] ?? 0, [people[1]]: pct[1] ?? 0 }, split, total: pence(total) };
}

/**
 * INS-6: the net balance at the end of each of the 3 full months before today's month; the same person owing at all
 * three with a mean of at least £50 → the standing order (the mean rounded down to £10). S9a (fix 23): none when the
 * couple's settle rhythm already covers it: they have a settle day (SET-4), or they settled in each of those months.
 */
export function standingOrder(
  entries: readonly InsightEntry[], settlements: readonly InsightSettlement[], people: readonly [UserId, UserId], today: IsoDate,
  opts: { settleDay?: number | null } = {},
): { debtor: UserId; creditor: UserId; amount: Pence } | null {
  if (opts.settleDay != null) return null;
  const [a, b] = people;
  const ledger = withoutOrphans(entries);
  const ends: number[] = [];
  let settledEach = true;
  for (let k = 1; k <= 3; k += 1) {
    const m = shiftMonth(month(today), -k);
    const end = lastOf(m);
    if (!settlements.some((s) => !s.deleted && month(s.date) === m)) settledEach = false;
    // The one balance function (balance.ts), over the rows up to that month's end; positive = a is owed.
    const nets = netPositions(
      people,
      ledger.filter((e) => e.date <= end).map((e) => ({ kind: e.kind, paid: e.paid, shares: e.shares, deleted: e.deleted, ownerId: e.ownerId ?? null })),
      settlements.filter((s) => s.date <= end).map((s) => ({ from: s.from, to: s.to, amount: s.amount, deleted: s.deleted })),
    );
    ends.push(nets[a] ?? 0);
  }
  if (settledEach) return null;
  const owedToA = ends.every((n) => n > 0);
  const owedToB = ends.every((n) => n < 0);
  if (!owedToA && !owedToB) return null;
  const mean = Math.floor(ends.reduce((t, n) => t + Math.abs(n), 0) / 3);
  if (mean < 5000) return null;
  return owedToA ? { debtor: b, creditor: a, amount: pence(Math.floor(mean / 1000) * 1000) } : { debtor: a, creditor: b, amount: pence(Math.floor(mean / 1000) * 1000) };
}
