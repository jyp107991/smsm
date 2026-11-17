/**
 * From what a person entered to the rows the database stores. Every money row is built with the core's own
 * split maths and checked with `validateEntry`, so the phone refuses what the database would (SPL-5), and
 * a write the server could still refuse is the rare exception (OFF-5), not the normal path.
 *
 * Writes travel as `MoneyOp`s: plain JSON, so they can be persisted with the offline queue and replayed
 * after a restart. Each carries its whole row, so a replay is an upsert by id and can't duplicate (OFF-7).
 */
import { isIsoDate, type IsoDate } from '../core/dates';
import { formatPence, type Pence } from '../core/money';
import { computeEntry, validateEntry, type PenceMap, type SplitParams, type UserId } from '../core/split';
import {
  EXPENSE_WRITE_COLUMNS, SETTLEMENT_WRITE_COLUMNS,
  type ExpenseRow, type ExpenseWrite, type SettlementRow, type SettlementWrite, type SoftDeletePatch,
} from './api';
import type { Json } from './database.types';

export interface ExpenseDraft {
  /** 'money_back' for a refund (MB-1): `payer` is who received it, the split is whose it is. */
  kind?: 'expense' | 'money_back';
  description: string;
  amount: Pence;
  date: IsoDate;
  categoryId: string | null;
  payer: UserId;
  split: SplitParams;
  notes?: string | null;
  tags?: readonly string[];
  /** MB-2: the expense this money back refunds. */
  refundOf?: string | null;
}

export interface SettlementDraft {
  from: UserId;
  to: UserId;
  amount: Pence;
  date: IsoDate;
  note?: string | null;
  method?: 'monzo' | 'other';
}

/** The phone refused the entry before it was queued; `reasons` are plain sentences for the form. */
export class EntryInvalidError extends Error {
  constructor(public readonly reasons: readonly string[]) {
    super(reasons.join(' '));
    this.name = 'EntryInvalidError';
  }
}

/** Money needs both people: shares name the partner, and the database refuses a non-member (check_money). */
export class PartnerNotJoinedError extends Error {
  constructor() {
    super('Your partner has to join before shared entries can be saved.');
    this.name = 'PartnerNotJoinedError';
  }
}

export interface WriteContext {
  householdId: string;
  userId: UserId;
  members: readonly [UserId, UserId];
  now: Date;
}

/** `opId` names this one write; `by` is the person who made it (a write is only ever sent as them). */
interface OpBase { opId: string; by: string }
export type MoneyOp = OpBase & (
  /**
   * `input` is what the person entered (kept so a refused write can be fixed, OFF-5). `awaitingPartner`: made
   * before the partner joined (BAL-6); the shares are worked out when it is sent, once both people exist.
   */
  | { table: 'expenses'; op: 'upsert'; isNew: boolean; row: ExpenseRow; input: ExpenseDraft; awaitingPartner?: boolean }
  | { table: 'expenses'; op: 'patch'; id: string; patch: SoftDeletePatch; label: string }
  | { table: 'settlements'; op: 'upsert'; isNew: boolean; row: SettlementRow; input: SettlementDraft }
  | { table: 'settlements'; op: 'patch'; id: string; patch: SoftDeletePatch; label: string }
);

export function newId(): string {
  return crypto.randomUUID();
}

function splitParamsJson(split: SplitParams): Json | null {
  if (split.mode === 'ratio') return { ...split.ratio };
  if (split.mode === 'exact') return { ...split.amounts };
  return null;
}

function mapJson(m: PenceMap): { [key: string]: Json } {
  return { ...m };
}

function checkCommon(description: string, date: IsoDate, reasons: string[]): void {
  if (description.trim().length === 0) reasons.push('Add a description.');
  if (!isIsoDate(date)) reasons.push('Pick a date.');
}

function blankExpense(householdId: string, userId: UserId, date: IsoDate, stamp: string): ExpenseRow {
  return {
    id: newId(), household_id: householdId, kind: 'expense', description: '', amount_pence: 0, date,
    category_id: null, chapter_id: null, paid: {}, paid_via: 'person', split_mode: 'ratio', split_params: null, shares: {},
    items: null, bill_total_pence: null, country: 'GB', place: null, lat: null, lng: null, original_amount: null,
    original_currency: null, fx_rate: null, notes: null, tags: [], receipt_path: null, source: 'manual', external_id: null,
    merchant: null, external_category: null, account_id: null, recurring_id: null, occurrence_date: null, refund_of: null,
    created_by: userId, created_at: stamp, updated_by: userId, updated_at: stamp, deleted_at: null,
  };
}

/**
 * BAL-6: before the partner joins there is no one to share with yet, so the entry is held on the phone as
 * the payer's alone (it moves no money) and its shares are worked out when it is sent, once both people are
 * in the household. Its text is checked now like any other entry.
 */
export function buildProvisionalExpense(ctx: { householdId: string; userId: UserId; now: Date }, draft: ExpenseDraft, base?: ExpenseRow): ExpenseRow {
  const reasons: string[] = [];
  checkCommon(draft.description, draft.date, reasons);
  if (!Number.isSafeInteger(draft.amount) || draft.amount <= 0) reasons.push('The amount must be more than £0.00.');
  if (reasons.length > 0) throw new EntryInvalidError(reasons);
  const stamp = ctx.now.toISOString();
  const fresh = base ?? blankExpense(ctx.householdId, ctx.userId, draft.date, stamp);
  return {
    ...fresh,
    kind: draft.kind ?? fresh.kind,
    description: draft.description.trim(),
    amount_pence: draft.amount,
    date: draft.date,
    category_id: draft.categoryId,
    paid: { [draft.payer]: draft.amount },
    shares: { [draft.payer]: draft.amount },
    split_mode: draft.split.mode,
    split_params: splitParamsJson(draft.split),
    notes: draft.notes === undefined ? fresh.notes : draft.notes,
    tags: draft.tags === undefined ? fresh.tags : [...draft.tags],
    refund_of: draft.refundOf === undefined ? fresh.refund_of : draft.refundOf,
    updated_by: ctx.userId,
    updated_at: stamp,
  };
}

/**
 * The split to use once both people exist (BAL-6): a ratio naming only one person becomes the household's
 * default (50/50 unless both approved another); anything else is used as entered.
 */
export function completeSplit(split: SplitParams, members: readonly [UserId, UserId], householdDefault: Readonly<Record<UserId, number>> | null): SplitParams {
  if (split.mode !== 'ratio') return split;
  const [a, b] = members;
  if (split.ratio[a] !== undefined && split.ratio[b] !== undefined) return split;
  const ratio = householdDefault && householdDefault[a] !== undefined && householdDefault[b] !== undefined ? householdDefault : { [a]: 50, [b]: 50 };
  return { mode: 'ratio', ratio };
}

function numberMap(j: Json | null): Record<string, number> | null {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(j)) {
    if (typeof v !== 'number') return null;
    out[k] = v;
  }
  return out;
}

/** What the person would have entered to get this row: the starting point for an edit of only some fields. */
export function inputFromRow(row: ExpenseRow, members: readonly UserId[]): ExpenseDraft {
  const paid = numberMap(row.paid) ?? {};
  const shares = numberMap(row.shares) ?? {};
  const payer = Object.entries(paid).sort((x, y) => y[1] - x[1])[0]?.[0] ?? row.created_by ?? members[0] ?? '';
  const amount = row.amount_pence;
  let split: SplitParams;
  const params = numberMap(row.split_params);
  switch (row.split_mode) {
    case 'for_other':
      split = { mode: 'for_other' };
      break;
    case 'treat':
      split = { mode: 'treat' };
      break;
    case 'exact': {
      const m = params ?? shares;
      const amounts: Record<UserId, Pence> = {};
      for (const [k, v] of Object.entries(m)) amounts[k] = v as Pence;
      split = { mode: 'exact', amounts };
      break;
    }
    default: {
      let ratio = params;
      if (!ratio) {
        // Rows written elsewhere may carry no parameters: read the percentages back from the shares.
        const derived: Record<string, number> = {};
        for (const m of members) derived[m] = amount > 0 ? Math.round(((shares[m] ?? 0) * 100) / amount) : 50;
        ratio = Object.values(derived).reduce((t, v) => t + v, 0) === 100 ? derived : Object.fromEntries(members.map((m) => [m, 50]));
      }
      split = { mode: 'ratio', ratio };
    }
  }
  return {
    kind: row.kind === 'money_back' ? 'money_back' : 'expense',
    description: row.description,
    amount: amount as Pence,
    date: row.date,
    categoryId: row.category_id,
    payer,
    split,
    notes: row.notes,
    tags: row.tags,
    refundOf: row.refund_of,
  };
}

/**
 * The full expense row for a new entry, or for an edit of `base`. Throws EntryInvalidError when the phone
 * would refuse it, with the same reasons the database would give.
 */
export function buildExpense(ctx: WriteContext, draft: ExpenseDraft, base?: ExpenseRow): ExpenseRow {
  const reasons: string[] = [];
  checkCommon(draft.description, draft.date, reasons);
  let money: { paid: PenceMap; shares: PenceMap } | null = null;
  try {
    money = computeEntry({ amount: draft.amount, payer: draft.payer, members: ctx.members, split: draft.split });
  } catch (e) {
    reasons.push(e instanceof RangeError ? 'Check who paid and the split.' : 'The amount must be whole pence.');
  }
  if (money) {
    reasons.push(...validateEntry({ amount: draft.amount, paid: money.paid, shares: money.shares, mode: draft.split.mode, members: ctx.members }));
  }
  if (reasons.length > 0 || !money) throw new EntryInvalidError(reasons);
  const stamp = ctx.now.toISOString();
  const fresh: ExpenseRow = base ?? blankExpense(ctx.householdId, ctx.userId, draft.date, stamp);
  return {
    ...fresh,
    kind: draft.kind ?? base?.kind ?? 'expense',
    description: draft.description.trim(),
    amount_pence: draft.amount,
    date: draft.date,
    category_id: draft.categoryId,
    paid: mapJson(money.paid),
    paid_via: 'person',
    split_mode: draft.split.mode,
    split_params: splitParamsJson(draft.split),
    shares: mapJson(money.shares),
    notes: draft.notes === undefined ? fresh.notes : draft.notes,
    tags: draft.tags === undefined ? fresh.tags : [...draft.tags],
    refund_of: draft.refundOf === undefined ? fresh.refund_of : draft.refundOf,
    updated_by: ctx.userId,
    updated_at: stamp,
  };
}

export function buildSettlement(ctx: WriteContext, draft: SettlementDraft, base?: SettlementRow): SettlementRow {
  const reasons: string[] = [];
  if (!Number.isSafeInteger(draft.amount) || draft.amount <= 0) reasons.push('The amount must be more than £0.00.');
  if (draft.from === draft.to || !ctx.members.includes(draft.from) || !ctx.members.includes(draft.to)) {
    reasons.push('A settle-up is from one of you to the other.');
  }
  if (!isIsoDate(draft.date)) reasons.push('Pick a date.');
  if (reasons.length > 0) throw new EntryInvalidError(reasons);
  const stamp = ctx.now.toISOString();
  const fresh: SettlementRow = base ?? {
    id: newId(), household_id: ctx.householdId, from_user: draft.from, to_user: draft.to, amount_pence: draft.amount,
    date: draft.date, note: null, method: 'other', created_by: ctx.userId, created_at: stamp, updated_at: stamp, deleted_at: null,
  };
  return {
    ...fresh,
    from_user: draft.from,
    to_user: draft.to,
    amount_pence: draft.amount,
    date: draft.date,
    note: draft.note === undefined ? fresh.note : draft.note,
    method: draft.method ?? fresh.method,
    updated_at: stamp,
  };
}

function pick<T extends object, K extends keyof T>(row: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = row[k];
  return out;
}

/** What an upsert sends: the phone's own columns; `created_by` only when the row is new. */
export function expenseWrite(row: ExpenseRow, isNew: boolean): ExpenseWrite {
  const w: ExpenseWrite = pick(row, EXPENSE_WRITE_COLUMNS);
  if (isNew && row.created_by) w.created_by = row.created_by;
  return w;
}

export function settlementWrite(row: SettlementRow, isNew: boolean): SettlementWrite {
  const w: SettlementWrite = pick(row, SETTLEMENT_WRITE_COLUMNS);
  if (isNew && row.created_by) w.created_by = row.created_by;
  return w;
}

/** "Tesco £42.50": how a kept-back write is named to the person. */
export function expenseLabel(row: Pick<ExpenseRow, 'description' | 'amount_pence'>): string {
  return `${row.description} ${formatPence(row.amount_pence as Pence)}`;
}

export function settlementLabel(row: Pick<SettlementRow, 'amount_pence'>): string {
  return formatPence(row.amount_pence as Pence);
}

export function opRowId(op: MoneyOp): string {
  return op.op === 'upsert' ? op.row.id : op.id;
}

export function opLabel(op: MoneyOp): string {
  if (op.op === 'patch') return op.label;
  return op.table === 'expenses' ? expenseLabel(op.row) : settlementLabel(op.row);
}

/**
 * The rows as the person should see them: the server's copy with every write still waiting applied on
 * top, in the order they were made. A refused write drops out of the waiting list, so it disappears from
 * the overlay by itself: that is the rollback. A refetch can never hide a change that is still waiting.
 */
export function overlay<R extends { id: string }>(
  rows: readonly R[],
  ops: readonly MoneyOp[],
  table: MoneyOp['table'],
): R[] {
  const relevant = ops.filter((o) => o.table === table);
  if (relevant.length === 0) return [...rows];
  const byId = new Map<string, R>(rows.map((r) => [r.id, r]));
  for (const op of relevant) {
    if (op.op === 'upsert') {
      byId.set(op.row.id, op.row as unknown as R);
    } else {
      const base = byId.get(op.id);
      if (base) byId.set(op.id, { ...base, ...op.patch });
    }
  }
  return [...byId.values()];
}
