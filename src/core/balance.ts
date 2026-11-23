/**
 * The balance (SPEC BAL-1, DATA_MODEL §3). One pure function used by the UI and exports; the database's
 * member_net view computes the same figure, and tests assert they agree.
 *
 *   net(P) = Σ expenses (paid[P] − shares[P]) − Σ money_back (paid[P] − shares[P])
 *          + Σ settle-ups P paid − Σ settle-ups P received
 * Positive = this person is owed. The two nets always sum to zero.
 */
import { pence, type Pence } from './money';
import type { PenceMap, UserId } from './split';

export interface LedgerEntry {
  kind: 'expense' | 'money_back'; paid: PenceMap; shares: PenceMap; deleted: boolean;
  /** S9a (MB-3): the row's id, and for money back the entry it refunds (null: none). */
  id?: string; refundOf?: string | null;
}
export interface LedgerSettlement { from: UserId; to: UserId; amount: Pence; deleted: boolean }

/**
 * MB-3 (S9a): money back whose original (an entry among `entries`) is deleted never counts. Such rows come back
 * marked deleted, everything else as it was, so a caller that then takes rows up to a date (a statement, a recap,
 * the standing-order hint) still knows about an original outside those dates.
 */
export function withoutOrphans<T extends { kind: string; deleted: boolean; id?: string; refundOf?: string | null }>(entries: readonly T[]): T[] {
  const gone = new Set<string>();
  for (const e of entries) if (e.deleted && e.id !== undefined) gone.add(e.id);
  return entries.map((e) => (!e.deleted && e.kind === 'money_back' && e.refundOf != null && gone.has(e.refundOf) ? { ...e, deleted: true } : e));
}

export function netPositions(
  members: readonly [UserId, UserId],
  entries: readonly LedgerEntry[],
  settlements: readonly LedgerSettlement[],
): Record<UserId, Pence> {
  const net: Record<UserId, number> = {};
  for (const e of withoutOrphans(entries)) {
    if (e.deleted) continue;
    const sign = e.kind === 'money_back' ? -1 : 1;
    for (const m of members) net[m] = (net[m] ?? 0) + sign * ((e.paid[m] ?? 0) - (e.shares[m] ?? 0));
  }
  for (const s of settlements) {
    if (s.deleted) continue;
    net[s.from] = (net[s.from] ?? 0) + s.amount;
    net[s.to] = (net[s.to] ?? 0) - s.amount;
  }
  // `+ 0` turns −0 into 0.
  return { [members[0]]: pence((net[members[0]] ?? 0) + 0), [members[1]]: pence((net[members[1]] ?? 0) + 0) };
}

export type BalanceState = { kind: 'square' } | { kind: 'owes'; debtor: UserId; creditor: UserId; amount: Pence };

export function balanceState(nets: Record<UserId, Pence>, members: readonly [UserId, UserId]): BalanceState {
  const [a, b] = members;
  const na: number = nets[a] ?? 0;
  if (na > 0) return { kind: 'owes', debtor: b, creditor: a, amount: pence(na) };
  if (na < 0) return { kind: 'owes', debtor: a, creditor: b, amount: pence(-na) };
  return { kind: 'square' };
}

/** BAL-4: "Next one's on Sam" once the balance is £10 or more. */
export const NEXT_ONE_THRESHOLD = pence(1000);
export function nextOneOn(state: BalanceState): UserId | null {
  return state.kind === 'owes' && state.amount >= NEXT_ONE_THRESHOLD ? state.debtor : null;
}

/** S9a (MB-2): a row as the unrefunded amount reads it. */
export interface RefundRow { id: string; kind: 'expense' | 'money_back'; amount: Pence; refundOf: string | null; deleted: boolean }

/**
 * MB-2: what an original still has to come back: its amount less its live linked money back, never below zero.
 * `exceptId` leaves one money back out (editing that refund: its own amount isn't "already back").
 */
export function unrefunded(original: { id: string; amount: Pence }, entries: readonly RefundRow[], exceptId?: string): Pence {
  return pence(Math.max(0, original.amount - cameBack(original.id, entries, exceptId)));
}

/**
 * MB-2 (S9a review): what has come back on an original so far: its live linked money back (`exceptId` left out). An
 * original's amount may not be edited below it.
 */
export function cameBack(originalId: string, entries: readonly RefundRow[], exceptId?: string): Pence {
  let back = 0;
  for (const e of entries) {
    if (e.kind === 'money_back' && !e.deleted && e.refundOf === originalId && e.id !== exceptId) back += e.amount;
  }
  return pence(back);
}

/** S9a (fix 8): whether an entry moves the balance at all ("Sam paid for Sam" doesn't). */
export function affectsBalance(entry: { paid: PenceMap; shares: PenceMap }): boolean {
  const people = new Set([...Object.keys(entry.paid), ...Object.keys(entry.shares)]);
  for (const p of people) if ((entry.paid[p] ?? 0) !== (entry.shares[p] ?? 0)) return true;
  return false;
}

/**
 * SET-1 (S9a): a settle-up from `from` of more than `from` owes is refused, naming what is owed (nothing, when
 * `from` owes nothing); up to it is fine.
 */
export function settleProblem(amount: Pence, state: BalanceState, from: UserId): { kind: 'moreThanOwed'; owed: Pence } | null {
  const owed = state.kind === 'owes' && state.debtor === from ? state.amount : pence(0);
  return amount > owed ? { kind: 'moreThanOwed', owed } : null;
}
