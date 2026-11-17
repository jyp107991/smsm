/**
 * Insights (S5a; INS-1, INS-3…INS-6, CHP-5, PLC-7): every figure is worked out here, exactly, in integer pence,
 * by the definitions in docs/DATA_MODEL.md §3 and §5 and docs/slices/S5.md. Pure: no I/O, no clock.
 *
 * Shared spend: live expenses split ratio/exact/treat at their full amount, minus live money back, in the period.
 * for_other and settle-ups never count. "Everyday": in no chapter; usual, pace and notes use everyday only.
 */
import { addDays, addMonths, daysBetween, daysInMonth, startOfMonth, type IsoDate } from './dates';
import { pence, type Pence } from './money';
import type { UserId } from './split';

export interface InsightEntry {
  id: string;
  kind: 'expense' | 'money_back';
  splitMode: string;
  amount: Pence;
  date: IsoDate;
  categoryId: string | null;
  chapterId: string | null;
  country: string;
  description: string;
  paid: Readonly<Record<UserId, number>>;
  deleted: boolean;
}

export interface Period { from: IsoDate; to: IsoDate }
export interface SpendOptions { everydayOnly?: boolean }

const COUNTED = new Set(['ratio', 'exact', 'treat']);

/** +amount for a counted expense, −amount for money back, 0 for anything that isn't shared spending. */
export function signedAmount(e: InsightEntry, opts: SpendOptions = {}): number {
  if (e.deleted) return 0;
  if (opts.everydayOnly && e.chapterId !== null) return 0;
  if (e.kind === 'money_back') return e.splitMode === 'for_other' ? 0 : 0 - e.amount;
  return COUNTED.has(e.splitMode) ? e.amount : 0;
}

function within(e: InsightEntry, p: Period): boolean {
  return e.date >= p.from && e.date <= p.to;
}

export function sharedSpend(entries: readonly InsightEntry[], period: Period, opts: SpendOptions = {}): Pence {
  let t = 0;
  for (const e of entries) if (within(e, period)) t += signedAmount(e, opts);
  return pence(t);
}

function group<K>(entries: readonly InsightEntry[], period: Period, opts: SpendOptions, key: (e: InsightEntry) => K): Map<K, number> {
  const m = new Map<K, number>();
  for (const e of entries) {
    if (!within(e, period)) continue;
    const v = signedAmount(e, opts);
    if (v === 0) continue;
    m.set(key(e), (m.get(key(e)) ?? 0) + v);
  }
  return m;
}

const desc = <T extends { total: Pence }>(a: T, b: T) => b.total - a.total;

/** Where it went: per category, largest first (money back counts against its own category). */
export function byCategory(entries: readonly InsightEntry[], period: Period, opts: SpendOptions = {}): { categoryId: string | null; total: Pence }[] {
  return [...group(entries, period, opts, (e) => e.categoryId)].map(([categoryId, t]) => ({ categoryId, total: pence(t) }))
    .filter((c) => c.total !== 0).sort(desc);
}

/** PLC-7: per country, largest first. */
export function byCountry(entries: readonly InsightEntry[], period: Period, opts: SpendOptions = {}): { country: string; total: Pence }[] {
  return [...group(entries, period, opts, (e) => e.country)].map(([country, t]) => ({ country, total: pence(t) }))
    .filter((c) => c.total !== 0).sort(desc);
}

/** Who paid: Σ paid[person] over shared spending (money back: minus what each received). Both people always. */
export function whoPaid(entries: readonly InsightEntry[], period: Period, people: readonly UserId[], opts: SpendOptions = {}): Record<UserId, Pence> {
  const out = new Map<UserId, number>(people.map((p) => [p, 0]));
  for (const e of entries) {
    if (!within(e, period) || signedAmount(e, opts) === 0) continue;
    const sign = e.kind === 'money_back' ? -1 : 1;
    for (const [p, v] of Object.entries(e.paid)) out.set(p, (out.get(p) ?? 0) + sign * v);
  }
  return Object.fromEntries([...out].map(([p, v]) => [p, pence(v)]));
}

export function monthPeriod(month: IsoDate): Period {
  const from = startOfMonth(month);
  return { from, to: addDays(addMonths(from, 1), -1) };
}

/** The `count` calendar months ending with `month`, oldest first, each with its shared spend. */
export function monthlyTotals(entries: readonly InsightEntry[], month: IsoDate, count: number, opts: SpendOptions = {}): { month: IsoDate; total: Pence }[] {
  const out: { month: IsoDate; total: Pence }[] = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const m = startOfMonth(addMonths(startOfMonth(month), -i));
    out.push({ month: m, total: sharedSpend(entries, monthPeriod(m), opts) });
  }
  return out;
}

function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[mid] ?? 0) : Math.floor(((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2);
}

/**
 * Usual (DATA_MODEL §5): the median of the previous 3–6 full calendar months of everyday shared spend before
 * `month`. A full month is one after the month of the first entry. Fewer than 3: null.
 */
export function usual(entries: readonly InsightEntry[], month: IsoDate, value: (p: Period) => number = (p) => sharedSpend(entries, p, { everydayOnly: true })): Pence | null {
  const live = entries.filter((e) => !e.deleted);
  if (live.length === 0) return null;
  const first = startOfMonth(live.reduce((m, e) => (e.date < m ? e.date : m), live[0]?.date ?? month));
  const months: number[] = [];
  for (let i = 1; i <= 6; i += 1) {
    const m = addMonths(startOfMonth(month), -i);
    if (m <= first) break;
    months.push(value(monthPeriod(m)));
  }
  return months.length >= 3 ? pence(median(months)) : null;
}

/** £ rounded to the nearest £10, halves up, in pence. */
function nearestTen(p: number): number {
  return Math.floor((p + 500) / 1000) * 1000;
}

export interface Pace { soFar: Pence; usual: Pence | null; direction: 'under' | 'over' | 'on' | null; amount: Pence | null }

/** INS-1: this month's everyday spend so far against the usual pace. */
export function pace(entries: readonly InsightEntry[], today: IsoDate): Pace {
  const month = startOfMonth(today);
  const soFar = sharedSpend(entries, { from: month, to: today }, { everydayOnly: true });
  const u = usual(entries, today);
  if (u === null) return { soFar, usual: null, direction: null, amount: null };
  const [y, m] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  const elapsed = daysBetween(month, today) + 1;
  // Expected so far = usual × elapsed ÷ days in month, exactly (compared in scaled integers).
  const dim = daysInMonth(y, m);
  const diffScaled = soFar * dim - u * elapsed; // = (soFar − expected) × dim
  const amount = nearestTen(Math.abs(diffScaled) / dim);
  const direction = amount < 1000 ? 'on' : diffScaled < 0 ? 'under' : 'over';
  return { soFar, usual: u, direction, amount: pence(direction === 'on' ? 0 : amount) };
}

/** Whole percentages that add up to 100 (largest remainder, ties to the earlier person). */
export function percentages(values: readonly number[]): number[] {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return values.map(() => 0);
  const raw = values.map((v) => (v * 100) / total);
  const floors = raw.map((r) => Math.floor(r));
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const o of order) {
    if (left <= 0) break;
    floors[o.i] = (floors[o.i] ?? 0) + 1;
    left -= 1;
  }
  return floors;
}

/** INS-5: each person's share of what was paid in the period, as whole percentages summing to 100. */
export function fairness(entries: readonly InsightEntry[], people: readonly UserId[], period: Period): { paid: Record<UserId, Pence>; percent: Record<UserId, number> } {
  const paid = whoPaid(entries, period, people);
  const pct = percentages(people.map((p) => Math.max(0, paid[p] ?? 0)));
  return { paid, percent: Object.fromEntries(people.map((p, i) => [p, pct[i] ?? 0])) };
}

export type PeriodChoice = 'month' | '3months' | '12months' | 'year';

/** The period for a choice, ending today. */
export function periodOf(choice: PeriodChoice, today: IsoDate): Period {
  const month = startOfMonth(today);
  switch (choice) {
    case 'month': return { from: month, to: today };
    case '3months': return { from: addMonths(month, -2), to: today };
    case '12months': return { from: addMonths(month, -11), to: today };
    case 'year': return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

/** The same-length period just before (by days). */
export function previousPeriod(p: Period): Period {
  const days = daysBetween(p.from, p.to) + 1;
  return { from: addDays(p.from, -days), to: addDays(p.from, -1) };
}

/** £ figures for the notes and sentences: pence → whole pounds, rounded to the nearest pound, halves up. */
function wholePounds(p: number): number {
  return Math.floor((Math.abs(p) + 50) / 100) * Math.sign(p);
}

export type Note =
  | { kind: 'category'; categoryId: string | null; soFar: Pence; usual: Pence; over: Pence }
  | { kind: 'entry'; id: string; description: string; categoryId: string | null; amount: Pence; times: number }
  | { kind: 'price'; description: string; before: Pence; after: Pence }
  | { kind: 'new-recurring'; description: string; perMonth: Pence };

export interface NoteInput {
  entries: readonly InsightEntry[];
  today: IsoDate;
  /** Subscription price changes made this month, from the templates' history. */
  priceChanges?: readonly { description: string; before: Pence; after: Pence; on: IsoDate }[];
  /** Regular payments that started this month, with their cost a month. */
  newRecurring?: readonly { description: string; perMonth: Pence; start: IsoDate }[];
}

/** INS-3: the notes for this month, each by its stated rule, largest money first. */
export function notes(input: NoteInput): Note[] {
  const { entries, today } = input;
  const month = startOfMonth(today);
  const thisMonth: Period = { from: month, to: today };
  const out: { money: number; note: Note }[] = [];
  // A category at least 30% and £20 above its usual (everyday).
  const now = byCategory(entries, thisMonth, { everydayOnly: true });
  for (const c of now) {
    const u = usual(entries, today, (p) => entries.reduce((t, e) => t + (e.categoryId === c.categoryId && within(e, p) ? signedAmount(e, { everydayOnly: true }) : 0), 0));
    if (u === null || u <= 0) continue;
    if (c.total * 10 >= u * 13 && c.total - u >= 2000) out.push({ money: c.total - u, note: { kind: 'category', categoryId: c.categoryId, soFar: c.total, usual: u, over: pence(c.total - u) } });
  }
  // An entry at least 3× its category's median over the previous 6 months, with at least 5 earlier entries.
  const sixAgo = addMonths(month, -6);
  for (const e of entries) {
    if (e.deleted || e.kind !== 'expense' || !COUNTED.has(e.splitMode) || e.chapterId !== null || !within(e, thisMonth)) continue;
    const earlier = entries.filter((x) => !x.deleted && x.kind === 'expense' && COUNTED.has(x.splitMode) && x.categoryId === e.categoryId
      && x.date >= sixAgo && x.date < month).map((x) => x.amount);
    if (earlier.length < 5) continue;
    const med = median(earlier);
    if (med > 0 && e.amount >= 3 * med) out.push({ money: e.amount - med, note: { kind: 'entry', id: e.id, description: e.description, categoryId: e.categoryId, amount: e.amount, times: Math.floor(e.amount / med) } });
  }
  for (const c of input.priceChanges ?? []) {
    if (c.on >= month && c.on <= today && c.before !== c.after) out.push({ money: Math.abs(c.after - c.before) * 12, note: { kind: 'price', description: c.description, before: c.before, after: c.after } });
  }
  for (const r of input.newRecurring ?? []) {
    if (r.start >= month && r.start <= today) out.push({ money: r.perMonth, note: { kind: 'new-recurring', description: r.description, perMonth: r.perMonth } });
  }
  return out.sort((a, b) => b.money - a.money).map((x) => x.note);
}

export interface Settle { from: UserId; to: UserId; amount: Pence; date: IsoDate; deleted: boolean }

/**
 * INS-6: if the same person owed at the end of each of the last 3 full months and the mean is ≥ £50, the
 * standing order (rounded down to £10) that would keep you about square.
 */
export function standingOrder(entries: readonly InsightEntry[], settlements: readonly Settle[], people: readonly [UserId, UserId], today: IsoDate, shares: (e: InsightEntry) => Readonly<Record<UserId, number>>): { debtor: UserId; creditor: UserId; amount: Pence; mean: Pence } | null {
  const [a, b] = people;
  const ends: number[] = [];
  for (let i = 1; i <= 3; i += 1) {
    const end = addDays(startOfMonth(addMonths(startOfMonth(today), -i + 1)), -1);
    let net = 0; // a's net position at that month end
    for (const e of entries) {
      if (e.deleted || e.date > end) continue;
      const sign = e.kind === 'money_back' ? -1 : 1;
      net += sign * ((e.paid[a] ?? 0) - (shares(e)[a] ?? 0));
    }
    for (const s of settlements) {
      if (s.deleted || s.date > end) continue;
      if (s.from === a) net += s.amount;
      if (s.to === a) net -= s.amount;
    }
    ends.push(net);
  }
  const allOwedToA = ends.every((n) => n > 0);
  const allOwedToB = ends.every((n) => n < 0);
  if (!allOwedToA && !allOwedToB) return null;
  const mean = Math.floor(ends.reduce((t, n) => t + Math.abs(n), 0) / 3);
  if (mean < 5000) return null;
  return { debtor: allOwedToA ? b : a, creditor: allOwedToA ? a : b, amount: pence(Math.floor(mean / 1000) * 1000), mean: pence(mean) };
}

export { wholePounds };
