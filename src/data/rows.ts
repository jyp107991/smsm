/**
 * The boundary between database rows and the money core (ENGINEERING §1: zod at every boundary). A row
 * whose money maps are malformed (not whole pence, negative, not summing to the amount) is refused here,
 * where it enters, instead of producing a wrong balance somewhere else.
 */
import { z } from 'zod';
import type { LedgerEntry, LedgerSettlement } from '../core/balance';
import type { Memory } from '../core/categorise';
import { pence, type Pence } from '../core/money';
import type { PenceMap, SplitParams } from '../core/split';
import type { Database } from './database.types';

type Tables = Database['public']['Tables'];
export type ExpenseRow = Tables['expenses']['Row'];
export type SettlementRow = Tables['settlements']['Row'];
export type CategoryMemoryRow = Tables['category_memory']['Row'];

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

const ratioMap = z.record(z.string(), z.number().int().min(0).max(100));

/** A remembered split as the core reads it; null when the row holds none (or one this app can't read). */
export function memorySplit(row: Pick<CategoryMemoryRow, 'split_mode' | 'split_params'>): SplitParams | null {
  switch (row.split_mode) {
    case 'treat':
      return { mode: 'treat' };
    case 'for_other':
      return { mode: 'for_other' };
    case 'ratio': {
      const parsed = ratioMap.safeParse(row.split_params);
      if (!parsed.success || Object.keys(parsed.data).length !== 2) return null;
      return Object.values(parsed.data).reduce((t, v) => t + v, 0) === 100 ? { mode: 'ratio', ratio: parsed.data } : null;
    }
    default:
      return null;
  }
}

/** The household's memory (CAT-2 step 1) keyed by normalised description, for core/categorise. */
export function memoryMap(rows: readonly CategoryMemoryRow[]): Map<string, Memory> {
  const out = new Map<string, Memory>();
  for (const r of rows) {
    const source = r.source === 'ai' || r.source === 'seed' ? r.source : 'user';
    out.set(r.key, { categoryId: r.category_id, split: memorySplit(r), source });
  }
  return out;
}
