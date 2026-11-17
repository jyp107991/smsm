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
  id: string;
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
  chapterId: string | null;
  /** Who paid what (pence); for money back, who received it. */
  paid: Readonly<Record<UserId, number>>;
  deleted: boolean;
}

export interface ChapterSummary {
  total: Pence;
  /** 0 when there is nothing to count from (no dates and no entries). */
  days: number;
  /** Trips only (null for a project, or with no days). */
  perDay: Pence | null;
  byCategory: { categoryId: string | null; total: Pence }[];
  /** Both people, always. */
  byPerson: Record<UserId, Pence>;
}

/** n ÷ d to the nearest penny, halves up (d > 0), exactly; a negative n rounds symmetrically. */
function divideHalfUp(n: number, d: number): number {
  const sign = n < 0 ? -1 : 1;
  return sign * Math.floor((2 * Math.abs(n) + d) / (2 * d));
}

export function chapterDays(chapter: ChapterInfo, dates: readonly IsoDate[], today: IsoDate): number {
  const sorted = [...dates].sort();
  const first = chapter.startDate ?? sorted[0] ?? null;
  const last = chapter.endDate ?? (chapter.kind === 'trip' && !chapter.closed && chapter.startDate !== null ? today : sorted[sorted.length - 1] ?? null);
  if (first === null || last === null) return 0;
  return daysBetween(first, last < first ? first : last) + 1;
}

/** CHP-3: what the chapter cost (only its own live entries count; the caller may pass every entry). */
export function chapterSummary(chapter: ChapterInfo, entries: readonly ChapterEntry[], people: readonly UserId[], today: IsoDate): ChapterSummary {
  const live = entries.filter((e) => !e.deleted && e.chapterId === chapter.id);
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
    perDay: chapter.kind === 'trip' && days > 0 ? pence(divideHalfUp(total, days)) : null,
    byCategory: [...byCategory].map(([categoryId, t]) => ({ categoryId, total: pence(t) }))
      .filter((c) => c.total !== 0)
      .sort((a, b) => b.total - a.total || String(a.categoryId).localeCompare(String(b.categoryId))),
    byPerson: Object.fromEntries([...byPerson].map(([p, v]) => [p, pence(v)])),
  };
}

/** CHP-5: everyday spending only (entries in no chapter), for "usual" figures and monthly comparisons (S5). */
export function everydayOnly<T extends { chapterId: string | null }>(entries: readonly T[]): T[] {
  return entries.filter((e) => e.chapterId === null);
}
