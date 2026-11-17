/**
 * The boundary between database rows and the money core (ENGINEERING §1: zod at every boundary). A row
 * whose money maps are malformed (not whole pence, negative, not summing to the amount) is refused here,
 * where it enters, instead of producing a wrong balance somewhere else.
 */
import { z } from 'zod';
import type { LedgerEntry, LedgerSettlement } from '../core/balance';
import { pence, type Pence } from '../core/money';
import type { PenceMap } from '../core/split';
import type { Database } from './database.types';

type Tables = Database['public']['Tables'];
export type ExpenseRow = Tables['expenses']['Row'];
export type SettlementRow = Tables['settlements']['Row'];

const penceMap = z.record(z.string(), z.number().int().nonnegative());

export class BadRowError extends Error {
  constructor(public readonly rowId: string, reason: string) {
    super(`row ${rowId}: ${reason}`);
    this.name = 'BadRowError';
  }
}

function toPenceMap(id: string, value: unknown, amount: number, what: string): PenceMap {
  const parsed = penceMap.safeParse(value);
  if (!parsed.success) throw new BadRowError(id, `${what} is not a map of whole pence`);
  const sum = Object.values(parsed.data).reduce((t, v) => t + v, 0);
  if (sum !== amount) throw new BadRowError(id, `${what} sums to ${String(sum)}, not ${String(amount)}`);
  const out: Record<string, Pence> = {};
  for (const [k, v] of Object.entries(parsed.data)) out[k] = pence(v);
  return out;
}

export function expenseToLedger(row: ExpenseRow): LedgerEntry {
  if (row.kind !== 'expense' && row.kind !== 'money_back') throw new BadRowError(row.id, `unknown kind ${row.kind}`);
  if (!Number.isSafeInteger(row.amount_pence) || row.amount_pence <= 0) throw new BadRowError(row.id, 'amount is not positive whole pence');
  return {
    kind: row.kind,
    paid: toPenceMap(row.id, row.paid, row.amount_pence, 'paid'),
    shares: toPenceMap(row.id, row.shares, row.amount_pence, 'shares'),
    deleted: row.deleted_at !== null,
  };
}

export function settlementToLedger(row: SettlementRow): LedgerSettlement {
  if (!Number.isSafeInteger(row.amount_pence) || row.amount_pence <= 0) throw new BadRowError(row.id, 'amount is not positive whole pence');
  return { from: row.from_user, to: row.to_user, amount: pence(row.amount_pence), deleted: row.deleted_at !== null };
}
