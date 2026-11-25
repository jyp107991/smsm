/**
 * S7 (EXP-1): a month's statement. The balance at the start is everything dated before the month; the balance
 * at the end is everything up to its last day; both come from the one balance function (netPositions), so the
 * end figure is the app's own balance for that date. Deleted entries and settle-ups are left out, as they are
 * from the balance.
 */
import { isPersonal, netPositions, withoutOrphans } from './balance';
import { daysInMonth, type IsoDate } from './dates';
import { newestFirst } from './filters';
import type { InsightEntry, InsightSettlement } from './insights';
import { pence, type Pence } from './money';
import type { PenceMap, UserId } from './split';

export type StatementSettlement = InsightSettlement & { id: string; createdAt?: string };

/**
 * One line of the statement. For a settle-up, `paid` is what the payer handed over and `shares` what the other
 * received, so the line reads like the others ("Sam paid £100.00 to Jae").
 */
export interface StatementRow {
  id: string;
  kind: 'expense' | 'money_back' | 'settlement';
  date: IsoDate;
  description: string;
  amount: Pence;
  paid: PenceMap;
  shares: PenceMap;
  /** Settle-ups only: who paid whom. */
  from?: UserId;
  to?: UserId;
  /** When it was added (S9a: the one order, newest first). */
  createdAt?: string;
}

export interface Statement {
  month: string;
  from: IsoDate;
  to: IsoDate;
  opening: Record<UserId, Pence>;
  closing: Record<UserId, Pence>;
  rows: StatementRow[];
  /** What each person paid towards the month's expenses (money back subtracts), and what was theirs. */
  paidBy: Record<UserId, Pence>;
  sharedBy: Record<UserId, Pence>;
}

/** The first and last day of "YYYY-MM". */
export function monthRange(month: string): { from: IsoDate; to: IsoDate } {
  const m = /^(\d{4})-(\d{2})$/u.exec(month);
  const mm = Number(m?.[2]);
  if (!m?.[1] || mm < 1 || mm > 12) throw new RangeError(`not a month: ${month}`);
  return { from: `${month}-01`, to: `${month}-${String(daysInMonth(Number(m[1]), mm)).padStart(2, '0')}` };
}

/** `month` is "YYYY-MM". */
export function statement(
  entries: readonly InsightEntry[],
  settlements: readonly StatementSettlement[],
  members: readonly [UserId, UserId],
  month: string,
): Statement {
  const { from, to } = monthRange(month);
  // MB-3: money back whose original is deleted is as good as deleted (wherever the original is dated).
  // S10 (REC-12): the statement is between the two of you: one person's own entries are never on it.
  const live = withoutOrphans(entries).filter((e) => !e.deleted && !isPersonal(e));
  const liveS = settlements.filter((s) => !s.deleted);
  const opening = netPositions(members, live.filter((e) => e.date < from), liveS.filter((s) => s.date < from));
  const closing = netPositions(members, live.filter((e) => e.date <= to), liveS.filter((s) => s.date <= to));
  const monthEntries = live.filter((e) => e.date >= from && e.date <= to);
  const monthSettlements = liveS.filter((s) => s.date >= from && s.date <= to);
  const rows: StatementRow[] = [
    ...monthEntries.map((e): StatementRow => ({
      id: e.id, kind: e.kind, date: e.date, description: e.description, amount: e.amount, paid: e.paid, shares: e.shares,
      ...(e.createdAt !== undefined ? { createdAt: e.createdAt } : {}),
    })),
    ...monthSettlements.map((s): StatementRow => ({
      id: s.id, kind: 'settlement', date: s.date, description: '', amount: s.amount,
      paid: { [s.from]: s.amount }, shares: { [s.to]: s.amount }, from: s.from, to: s.to,
      ...(s.createdAt !== undefined ? { createdAt: s.createdAt } : {}),
    })),
    // S9a (ACT-1): the one order, as Home and Activity: newest first, then the one added last, then by id.
  ].sort((x, y) => newestFirst({ date: x.date, createdAt: x.createdAt ?? '', id: x.id }, { date: y.date, createdAt: y.createdAt ?? '', id: y.id }));
  const paid: Record<UserId, number> = {};
  const shared: Record<UserId, number> = {};
  for (const p of members) { paid[p] = 0; shared[p] = 0; }
  for (const e of monthEntries) {
    const sign = e.kind === 'money_back' ? -1 : 1;
    for (const p of members) {
      paid[p] = (paid[p] ?? 0) + sign * (e.paid[p] ?? 0);
      shared[p] = (shared[p] ?? 0) + sign * (e.shares[p] ?? 0);
    }
  }
  // `+ 0` turns a −0 into 0, so an empty month compares equal to zero.
  const asPence = (r: Record<UserId, number>) => ({ [members[0]]: pence((r[members[0]] ?? 0) + 0), [members[1]]: pence((r[members[1]] ?? 0) + 0) });
  return { month, from, to, opening, closing, rows, paidBy: asPence(paid), sharedBy: asPence(shared) };
}
