/**
 * S7 (EXP-1): a month's statement. The balance at the start is everything dated before the month; the balance
 * at the end is everything up to its last day; both come from the one balance function (netPositions), so the
 * end figure is the app's own balance for that date. Deleted entries and settle-ups are left out, as they are
 * from the balance.
 */
import { netPositions, type LedgerEntry, type LedgerSettlement } from './balance';
import { daysInMonth, type IsoDate } from './dates';
import { pence, type Pence } from './money';
import type { UserId } from './split';

export interface StatementEntry extends LedgerEntry { id: string; date: IsoDate; description: string; amount: Pence }
export interface StatementSettlement extends LedgerSettlement { id: string; date: IsoDate; note: string | null }

export type StatementRow =
  | { type: 'entry'; entry: StatementEntry }
  | { type: 'settlement'; settlement: StatementSettlement };

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

/** `month` is "YYYY-MM". */
export function statement(
  entries: readonly StatementEntry[],
  settlements: readonly StatementSettlement[],
  members: readonly [UserId, UserId],
  month: string,
): Statement {
  const m = /^(\d{4})-(\d{2})$/u.exec(month);
  if (!m?.[1] || !m[2]) throw new RangeError(`not a month: ${month}`);
  const from = `${month}-01`;
  const to = `${month}-${String(daysInMonth(Number(m[1]), Number(m[2]))).padStart(2, '0')}`;
  const live = entries.filter((e) => !e.deleted);
  const liveS = settlements.filter((s) => !s.deleted);
  const opening = netPositions(members, live.filter((e) => e.date < from), liveS.filter((s) => s.date < from));
  const closing = netPositions(members, live.filter((e) => e.date <= to), liveS.filter((s) => s.date <= to));
  const monthEntries = live.filter((e) => e.date >= from && e.date <= to);
  const monthSettlements = liveS.filter((s) => s.date >= from && s.date <= to);
  const rows: StatementRow[] = [
    ...monthEntries.map((entry) => ({ type: 'entry' as const, entry })),
    ...monthSettlements.map((settlement) => ({ type: 'settlement' as const, settlement })),
  ].sort((x, y) => {
    const dx = x.type === 'entry' ? x.entry.date : x.settlement.date;
    const dy = y.type === 'entry' ? y.entry.date : y.settlement.date;
    return dx < dy ? -1 : dx > dy ? 1 : 0;
  });
  const paid: Record<UserId, number> = {};
  const shared: Record<UserId, number> = {};
  for (const e of monthEntries) {
    const sign = e.kind === 'money_back' ? -1 : 1;
    for (const p of members) {
      paid[p] = (paid[p] ?? 0) + sign * (e.paid[p] ?? 0);
      shared[p] = (shared[p] ?? 0) + sign * (e.shares[p] ?? 0);
    }
  }
  const asPence = (r: Record<UserId, number>) => ({ [members[0]]: pence((r[members[0]] ?? 0) + 0), [members[1]]: pence((r[members[1]] ?? 0) + 0) });
  return { month, from, to, opening, closing, rows, paidBy: asPence(paid), sharedBy: asPence(shared) };
}
