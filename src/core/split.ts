/**
 * Splits and payers (SPEC 3.3, DATA_MODEL §3). Every entry has two maps that each sum to the amount:
 * `paid` (who handed the money over) and `shares` (whose cost it is). `paid` is a map so a joint account
 * could pay later without a redesign (P4).
 */
import { pence, type Pence } from './money';

export type UserId = string;
export type PenceMap = Readonly<Record<UserId, Pence>>;
export type SplitMode = 'ratio' | 'exact' | 'for_other' | 'treat';
export type SplitParams =
  | { mode: 'ratio'; ratio: Readonly<Record<UserId, number>> }
  | { mode: 'exact'; amounts: PenceMap }
  | { mode: 'for_other' }
  | { mode: 'treat' };

/**
 * Shares from whole percentages by largest remainder (DATA_MODEL §3): floor each share, then hand out the
 * remaining pennies by largest fraction, ties to the payer first (SPL-3), then by id for a stable result.
 * £42.51 at 50/50 paid by A → A 2126, B 2125.
 */
export function ratioShares(amount: Pence, ratio: Readonly<Record<UserId, number>>, payer: UserId): PenceMap {
  const ids = Object.keys(ratio).sort();
  const totalPct = ids.reduce((t, id) => t + (ratio[id] ?? 0), 0);
  if (ids.length === 0 || totalPct <= 0) throw new RangeError('ratio must have a positive total');
  if (ids.some((id) => (ratio[id] ?? 0) < 0)) throw new RangeError('ratio parts must not be negative');
  const rows = ids.map((id) => {
    // Integer arithmetic for the floor and the remainder, so no floating-point error decides a penny.
    const num = amount * (ratio[id] ?? 0);
    return { id, floor: Math.floor(num / totalPct), rem: num % totalPct };
  });
  const left = amount - rows.reduce((t, r) => t + r.floor, 0);
  const order = [...rows].sort((a, b) => {
    if (b.rem !== a.rem) return b.rem - a.rem;
    if (a.id === payer) return -1;
    if (b.id === payer) return 1;
    return a.id < b.id ? -1 : 1;
  });
  // At most one penny per person is left over (each remainder is below one penny).
  const extra = new Set(order.slice(0, left).map((r) => r.id));
  const out: Record<UserId, Pence> = {};
  for (const r of rows) out[r.id] = pence(r.floor + (extra.has(r.id) ? 1 : 0));
  return out;
}

export function computeEntry(input: {
  amount: Pence;
  payer: UserId;
  members: readonly [UserId, UserId];
  split: SplitParams;
}): { paid: PenceMap; shares: PenceMap } {
  const { amount, payer, members, split } = input;
  if (!members.includes(payer)) throw new RangeError('the payer must be one of the two people');
  const [a, b] = members;
  const other = payer === a ? b : a;
  const paid: PenceMap = { [payer]: amount, [other]: pence(0) };
  let shares: PenceMap;
  switch (split.mode) {
    case 'ratio': {
      const ratio: Record<UserId, number> = { [a]: split.ratio[a] ?? 0, [b]: split.ratio[b] ?? 0 };
      shares = ratioShares(amount, ratio, payer);
      break;
    }
    case 'exact':
      shares = { [a]: split.amounts[a] ?? pence(0), [b]: split.amounts[b] ?? pence(0) };
      break;
    case 'for_other':
      shares = { [payer]: pence(0), [other]: amount };
      break;
    case 'treat':
      shares = { ...paid };
      break;
  }
  return { paid, shares };
}

function sumMap(m: PenceMap): number {
  return Object.values(m).reduce((t, v) => t + v, 0);
}

/** [] when valid. Mirrors the database's check_money trigger (SPL-5): the phone refuses what the database would. */
export function validateEntry(e: {
  amount: Pence;
  paid: PenceMap;
  shares: PenceMap;
  mode: SplitMode;
  members: readonly [UserId, UserId];
}): string[] {
  const errors: string[] = [];
  if (!Number.isSafeInteger(e.amount) || e.amount <= 0) errors.push('The amount must be more than £0.00.');
  const all = [...Object.entries(e.paid), ...Object.entries(e.shares)];
  if (all.some(([, v]) => !Number.isSafeInteger(v))) errors.push('Amounts must be whole pence.');
  if (sumMap(e.shares) !== e.amount) errors.push('The shares must add up to the amount.');
  if (sumMap(e.paid) !== e.amount) errors.push('What was paid must add up to the amount.');
  if (all.some(([, v]) => v < 0)) errors.push('Amounts can’t be negative.');
  if (all.some(([k]) => !e.members.includes(k))) errors.push('Only the two of you can pay or owe.');
  const payers = Object.entries(e.paid).filter(([, v]) => v > 0);
  if (e.mode === 'for_other') {
    const payer = payers[0]?.[0];
    if (payers.length !== 1 || payer === undefined || (e.shares[payer] ?? 0) !== 0) {
      errors.push('Paid for the other: one person pays and owes nothing.');
    }
  }
  if (e.mode === 'treat' && e.members.some((m) => (e.shares[m] ?? 0) !== (e.paid[m] ?? 0))) {
    errors.push('A treat is covered by whoever pays.');
  }
  return errors;
}

/** SPL-2: this description's usual split → the category's default → the household default → 50/50. */
export function resolveDefaultSplit(c: {
  remembered?: SplitParams | null;
  categoryDefault?: Readonly<Record<UserId, number>> | null;
  householdDefault?: Readonly<Record<UserId, number>> | null;
  members: readonly [UserId, UserId];
}): SplitParams {
  if (c.remembered) return c.remembered;
  if (c.categoryDefault) return { mode: 'ratio', ratio: c.categoryDefault };
  if (c.householdDefault) return { mode: 'ratio', ratio: c.householdDefault };
  const [a, b] = c.members;
  return { mode: 'ratio', ratio: { [a]: 50, [b]: 50 } };
}

/**
 * SPL-1 Exact amounts: what is still to be shared out (positive) or shared out too much (negative), shown
 * live under the two fields. Zero means the parts add up to the amount.
 */
export function exactRemainder(amount: Pence, parts: readonly Pence[]): number {
  return parts.reduce((left: number, p) => left - p, amount);
}
