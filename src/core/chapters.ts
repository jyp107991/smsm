/**
 * Chapters (S4a; CHP-3, CHP-4, CHP-5): what a trip or project cost, worked out from its entries. Pure and exact:
 * integer pence, one rounding (per day). Chapters separate totals, never debts: nothing here touches the balance.
 *
 * - total: expenses minus money back, deleted entries left out;
 * - days: start to end inclusive when both are set; otherwise from the start (or the first entry) to the end
 *   (or, for an open trip, today; else the last entry);
 * - per day: trips only, total ÷ days rounded once to the penny, halves up;
 * - by category and by person: the same sum split by category (largest first) and by who paid (money back
 *   counts against whoever received it), so each adds up to the total.
 */
import { daysBetween, type IsoDate } from './dates';
import { pence, type Pence } from './money';
import type { UserId } from './split';

export interface ChapterInfo {
  kind: 'trip' | 'project';
  startDate: IsoDate | null;
  endDate: IsoDate | null;
  closed: boolean;
}

export interface ChapterEntry {
  kind: 'expense' | 'money_back';
  amount: Pence;
  date: IsoDate;
  categoryId: string | null;
  /** Who paid what (pence); for money back, who received it. */
  paid: Readonly<Record<UserId, number>>;
  deleted: boolean;
}

export interface ChapterSummary {
  total: Pence;
  /** null when there is nothing to count from (no dates and no entries). */
  days: number | null;
  /** Trips only. */
  perDay: Pence | null;
  byCategory: { categoryId: string | null; amount: Pence }[];
  byPerson: { person: UserId; amount: Pence }[];
}

/** n ÷ d to the nearest penny, halves up (d > 0), exactly; negative n rounds symmetrically. */
function divideHalfUp(n: number, d: number): number {
  const sign = n < 0 ? -1 : 1;
  const a = Math.abs(n);
  return sign * Math.floor((2 * a + d) / (2 * d));
}

export function chapterDays(chapter: ChapterInfo, dates: readonly IsoDate[], today: IsoDate): number | null {
  const sorted = [...dates].sort();
  const first = chapter.startDate ?? sorted[0] ?? null;
  const last = chapter.endDate ?? (chapter.kind === 'trip' && !chapter.closed && chapter.startDate !== null ? today : sorted[sorted.length - 1] ?? null);
  if (first === null || last === null) return null;
  const end = last < first ? first : last;
  return daysBetween(first, end) + 1;
}

export function chapterSummary(chapter: ChapterInfo, entries: readonly ChapterEntry[], people: readonly UserId[], today: IsoDate): ChapterSummary {
  const live = entries.filter((e) => !e.deleted);
  const byCategory = new Map<string | null, number>();
  const byPerson = new Map<UserId, number>(people.map((p) => [p, 0]));
  let total = 0;
  for (const e of live) {
    const sign = e.kind === 'money_back' ? -1 : 1;
    total += sign * e.amount;
    byCategory.set(e.categoryId, (byCategory.get(e.categoryId) ?? 0) + sign * e.amount);
    for (const [p, v] of Object.entries(e.paid)) byPerson.set(p, (byPerson.get(p) ?? 0) + sign * v);
  }
  const days = chapterDays(chapter, live.map((e) => e.date), today);
  return {
    total: pence(total),
    days,
    perDay: chapter.kind === 'trip' && days !== null && days > 0 ? pence(divideHalfUp(total, days)) : null,
    byCategory: [...byCategory].map(([categoryId, amount]) => ({ categoryId, amount: pence(amount) }))
      .filter((c) => c.amount !== 0)
      .sort((a, b) => b.amount - a.amount || String(a.categoryId).localeCompare(String(b.categoryId))),
    byPerson: [...byPerson].map(([person, amount]) => ({ person, amount: pence(amount) })),
  };
}

/** CHP-5: everyday spending only (entries in no chapter), for "usual" figures and monthly comparisons (S5). */
export function everydayOnly<T extends { chapterId: string | null }>(entries: readonly T[]): T[] {
  return entries.filter((e) => e.chapterId === null);
}
