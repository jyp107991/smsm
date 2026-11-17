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

export interface LedgerEntry { kind: 'expense' | 'money_back'; paid: PenceMap; shares: PenceMap; deleted: boolean }
export interface LedgerSettlement { from: UserId; to: UserId; amount: Pence; deleted: boolean }

export function netPositions(
  members: readonly [UserId, UserId],
  entries: readonly LedgerEntry[],
  settlements: readonly LedgerSettlement[],
): Record<UserId, Pence> {
  const net: Record<UserId, number> = { [members[0]]: 0, [members[1]]: 0 };
  for (const e of entries) {
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
  if (na === 0) return { kind: 'square' };
  return na > 0 ? { kind: 'owes', debtor: b, creditor: a, amount: pence(na) } : { kind: 'owes', debtor: a, creditor: b, amount: pence(-na) };
}

/** BAL-4: "Next one's on Sam" once the balance is £10 or more. */
export const NEXT_ONE_THRESHOLD = pence(1000);
export function nextOneOn(state: BalanceState): UserId | null {
  return state.kind === 'owes' && state.amount >= NEXT_ONE_THRESHOLD ? state.debtor : null;
}
