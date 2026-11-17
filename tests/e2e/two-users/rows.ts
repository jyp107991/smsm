/** Waiting for rows to reach the database, by description. */
import { expect } from '@playwright/test';
import type { ExpenseRow, SettlementRow } from '../../../src/data/rows';
import { expensesOf, settlementsOf } from './admin';

/** Polls until exactly `count` expense rows with this description exist (deleted ones included), and returns them. */
export async function rowsNamed(householdId: string, description: string, count = 1): Promise<ExpenseRow[]> {
  let found: ExpenseRow[] = [];
  await expect
    .poll(async () => {
      found = (await expensesOf(householdId)).filter((r) => r.description === description);
      return found.length;
    }, { timeout: 20_000, message: `${String(count)} row(s) named ${description}` })
    .toBe(count);
  return found;
}

export async function rowNamed(householdId: string, description: string): Promise<ExpenseRow> {
  const [row] = await rowsNamed(householdId, description, 1);
  if (!row) throw new Error('unreachable');
  return row;
}

/** Polls until the row with this id satisfies `check`, and returns it. */
export async function rowWhen(householdId: string, id: string, check: (r: ExpenseRow) => boolean, what: string): Promise<ExpenseRow> {
  let found: ExpenseRow | undefined;
  await expect
    .poll(async () => {
      found = (await expensesOf(householdId)).find((r) => r.id === id);
      return found !== undefined && check(found);
    }, { timeout: 20_000, message: what })
    .toBe(true);
  if (!found) throw new Error('unreachable');
  return found;
}

export async function settlementsWhen(householdId: string, check: (rows: SettlementRow[]) => boolean, what: string): Promise<SettlementRow[]> {
  let found: SettlementRow[] = [];
  await expect
    .poll(async () => {
      found = await settlementsOf(householdId);
      return check(found);
    }, { timeout: 20_000, message: what })
    .toBe(true);
  return found;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
