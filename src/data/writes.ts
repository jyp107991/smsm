/**
 * From what a person entered to the rows the database stores. Every money row is built with the core's own
 * split maths and checked with `validateEntry`, so the phone refuses what the database would (SPL-5), and
 * a write the server could still refuse is the rare exception (OFF-5), not the normal path.
 *
 * Writes travel as `MoneyOp`s: plain JSON, so they can be persisted with the offline queue and replayed
 * after a restart. Each carries its whole row, so a replay is an upsert by id and can't duplicate (OFF-7).
 */
import { isIsoDate, type IsoDate } from '../core/dates';
import { roundPosition } from '../core/fx';
import { formatPence, type Pence } from '../core/money';
import { computeEntry, validateEntry, type EntryIssue, type PenceMap, type SplitParams, type UserId } from '../core/split';
import {
  EXPENSE_WRITE_COLUMNS, RECURRING_WRITE_COLUMNS, SETTLEMENT_WRITE_COLUMNS,
  type CategoryMemoryRow, type CategoryMemoryWrite, type CategoryRow, type CategoryWrite, type ChapterColumn, type ChapterRow, type ChapterWrite, type CommentColumn, type CommentRow, type CommentWrite, type ExpenseRow, type ExpenseWrite, type HouseholdRow,
  type ImportIgnoreRow, type ImportRuleRow, type InboxItemRow, type InboxPatch, type NotificationPrefsPatch, type RecurringRow, type RecurringWrite, type SettlementRow, type SettlementWrite, type SoftDeletePatch, type ExpensePatch, type RecurringColumn } from './api';
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
  /** CHP-2: the chapter it belongs to (null: everyday); left out, an edit keeps the entry's own. */
  chapterId?: string | null;
  /** PLC-1, PLC-3: the country (ISO code); left out, a new entry takes this phone's current country. */
  country?: string;
  /** PLC-1: a place name ("Kyoto"), and a position rounded to 3 dp (null when typed). */
  place?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** PLC-6: paid in another currency: the amount and rate as typed (reference only; `amount` is the pounds). */
  original?: ForeignOriginal | null;
  /** S6a (SCAN-1): the receipt photo's path in the bucket. */
  receiptPath?: string | null;
  /** S6a (SCAN-2): the receipt's lines, each marked shared or one person's own; and the receipt's own total. */
  items?: readonly ReceiptItem[] | null;
  billTotal?: Pence | null;
  /** S6a (CAT-2 step 4): the category is an AI guess (set only by guessCategory; a person's choice clears it). */
  categoryGuess?: boolean;
}

export interface ReceiptItem { label: string; pence: Pence; shared: boolean }

/** S6a: the receipt columns of a draft over a base row, and the guess mark (any other category change clears it). */
function receiptColumns(draft: Partial<ExpenseDraft>, fresh: ExpenseRow) {
  const categoryChanged = draft.categoryId !== undefined && draft.categoryId !== fresh.category_id;
  return {
    receipt_path: draft.receiptPath === undefined ? fresh.receipt_path : draft.receiptPath,
    items: draft.items === undefined ? fresh.items
      : draft.items === null ? null : draft.items.map((l) => ({ label: l.label, pence: l.pence, shared: l.shared })),
    bill_total_pence: draft.billTotal === undefined ? fresh.bill_total_pence : draft.billTotal,
    category_guess: draft.categoryGuess ?? (categoryChanged ? false : fresh.category_guess),
  };
}

export interface ForeignOriginal { amount: string; currency: string; rate: string }

/** The place and currency columns of a draft over a base row (an edit of the pounds amount drops a stale original). */
function placeColumns(draft: ExpenseDraft, fresh: ExpenseRow, amountChanged: boolean) {
  const orig = draft.original !== undefined ? draft.original : amountChanged ? null : undefined;
  return {
    country: draft.country !== undefined && /^[A-Z]{2}$/.test(draft.country) ? draft.country : fresh.country,
    place: draft.place === undefined ? fresh.place : draft.place === null || draft.place.trim() === '' ? null : draft.place.trim().slice(0, 80),
    // PLC-1: never finer than about 100 m.
    lat: draft.lat === undefined ? fresh.lat : draft.lat === null ? null : roundPosition(draft.lat),
    lng: draft.lng === undefined ? fresh.lng : draft.lng === null ? null : roundPosition(draft.lng),
    original_amount: orig === undefined ? fresh.original_amount : orig ? Number(orig.amount.replace(/,/g, '')) : null,
    original_currency: orig === undefined ? fresh.original_currency : orig ? orig.currency : null,
    fx_rate: orig === undefined ? fresh.fx_rate : orig ? Number(orig.rate) : null,
  };
}

export interface SettlementDraft {
  from: UserId;
  to: UserId;
  amount: Pence;
  date: IsoDate;
  note?: string | null;
  method?: 'monzo' | 'other';
}

/**
 * Why the phone refused something before saving it, as codes; the screens word them (strings.invalid,
 * TXT-7). The money checks are the core's (validateEntry); the rest are the data layer's own.
 */
export type InvalidReason =
  | EntryIssue
  | 'description' | 'date' | 'payerSplit' | 'settleBetween' | 'jointMoney' | 'splitAgain' | 'name' | 'monzoName' | 'ratio100'
  | 'schedule' | 'colour' | 'chapterName' | 'chapterDates' | 'comment' | 'notYours' | 'settleDay' | 'originalDeleted';

/** The phone refused the entry before it was queued; `reasons` are codes for the screens to word. */
export class EntryInvalidError extends Error {
  constructor(public readonly reasons: readonly InvalidReason[]) {
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
export type ExpenseUpsert = OpBase & (
  | { table: 'expenses'; op: 'upsert'; isNew: boolean; row: ExpenseRow; input: ExpenseDraft; awaitingPartner: true }
  | { table: 'expenses'; op: 'upsert'; isNew: boolean; row: ExpenseRow; input: ExpenseDraft | null; awaitingPartner?: false }
);
export type MoneyOp = OpBase & (
  /**
   * `input` is what the person entered (kept so a refused write can be fixed, OFF-5); null when only details
   * were changed and the money is kept exactly as stored (`row` is then the whole truth). `awaitingPartner`:
   * made before the partner joined (BAL-6); the shares are worked out once both people exist.
   */
  | ExpenseUpsert
  | { table: 'expenses'; op: 'patch'; id: string; patch: ExpensePatch; label: string }
  | { table: 'settlements'; op: 'upsert'; isNew: boolean; row: SettlementRow; input: SettlementDraft }
  | { table: 'settlements'; op: 'patch'; id: string; patch: SoftDeletePatch; label: string }
  /** S3: a regular payment (added, edited, paused, resumed, ended: always the whole template, never deleted). */
  /** `columns`: only these are written to an existing template (pause, resume, end, an edit), never the rest. */
  | { table: 'recurring'; op: 'upsert'; isNew: boolean; row: RecurringRow; input: null; columns?: readonly RecurringColumn[] }
  /** S3: an Inbox decision (INB-2). */
  | { table: 'inbox_items'; op: 'patch'; id: string; patch: InboxPatch; label: string }
  /** S6a (SCAN-4): a receipt to sort later, added to the Inbox. */
  | { table: 'inbox_items'; op: 'upsert'; isNew: true; row: InboxItemRow; input: null }
  /**
   * S6a: a receipt photo going up to the private bucket (`id` is its path). It sits in the same ordered queue, ahead
   * of the entry or Inbox item that names it, so the photo is always there first; the bytes stay in the phone's
   * photo store, not in the queue.
   */
  | { table: 'receipts'; op: 'upload'; id: string; label: string }
  /** S3: a category added, edited, archived or moved (CAT-1). */
  | { table: 'categories'; op: 'upsert'; isNew: boolean; row: CategoryRow; input: null }
  /** S4a: a chapter started, edited, closed or reopened (CHP-1, CHP-3); never deleted. */
  /** `columns`: only these are written to an existing chapter (close, reopen, an edit), never the rest. */
  | { table: 'chapters'; op: 'upsert'; isNew: boolean; row: ChapterRow; input: null; columns?: readonly ChapterColumn[] }
  /** S5b (ACT-4): a comment added, edited or deleted (soft); an edit sends only its columns. */
  | { table: 'comments'; op: 'upsert'; isNew: boolean; row: CommentRow; input: null; columns?: readonly CommentColumn[] }
  /**
   * S7 (IMP-3): "Not ours" keeps only the hash of the bank's id (`id` is the hash); Undo takes it away. The bank row
   * itself never leaves the phone, so the label names no description.
   */
  | { table: 'import_ignores'; op: 'insert' | 'delete'; id: string; row: ImportIgnoreRow; label: string }
  /** S7 (IMP-3): an "always do this for …" rule made, or removed (rules aren't money: they are deleted outright). */
  | { table: 'import_rules'; op: 'upsert'; isNew: boolean; row: ImportRuleRow; input: null }
  | { table: 'import_rules'; op: 'delete'; id: string; row: Pick<ImportRuleRow, 'household_id' | 'match_text'>; label: string }
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

function checkCommon(description: string, date: IsoDate, reasons: InvalidReason[]): void {
  if (description.trim().length === 0) reasons.push('description');
  if (!isIsoDate(date)) reasons.push('date');
}

function blankExpense(householdId: string, userId: UserId, date: IsoDate, stamp: string): ExpenseRow {
  return {
    id: newId(), household_id: householdId, kind: 'expense', description: '', amount_pence: 0, date,
    category_id: null, chapter_id: null, paid: {}, paid_via: 'person', split_mode: 'ratio', split_params: null, shares: {},
    items: null, bill_total_pence: null, country: 'GB', place: null, lat: null, lng: null, original_amount: null,
    original_currency: null, fx_rate: null, notes: null, tags: [], receipt_path: null, category_guess: false, source: 'manual', external_id: null,
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
  const reasons: InvalidReason[] = [];
  checkCommon(draft.description, draft.date, reasons);
  if (!Number.isSafeInteger(draft.amount) || draft.amount <= 0) reasons.push('amount');
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
    chapter_id: draft.chapterId === undefined ? fresh.chapter_id : draft.chapterId,
    ...placeColumns(draft, fresh, base !== undefined && base.amount_pence !== draft.amount),
    ...receiptColumns(draft, fresh),
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

/** The household's default split (approved by both, PPL-5), or null for 50/50. */
export function defaultRatioOf(household: Pick<HouseholdRow, 'default_ratio'> | null | undefined): Readonly<Record<UserId, number>> | null {
  return numberMap(household?.default_ratio ?? null);
}

/**
 * BAL-6: the shared entry an entry made before the partner joined becomes, once both people are known. The
 * same completion is used for what is shown and for what is sent, so the balance never disagrees with it.
 */
export function completedRow(
  op: ExpenseUpsert & { awaitingPartner: true },
  members: readonly [UserId, UserId],
  householdDefault: Readonly<Record<UserId, number>> | null,
  now: Date,
): ExpenseRow {
  const input = { ...op.input, split: completeSplit(op.input.split, members, householdDefault) };
  return buildExpense({ householdId: op.row.household_id, userId: op.by, members, now }, input, op.row);
}

/** For `overlay`: shows each entry made before the partner joined as its completed shared entry. */
export function partnerCompleter(
  members: readonly { user_id: string }[],
  household: Pick<HouseholdRow, 'default_ratio'> | null | undefined,
): ((op: MoneyOp) => ExpenseRow | null) | undefined {
  const [a, b] = members;
  if (!a || !b) return undefined;
  const pair = [a.user_id, b.user_id] as const;
  const ratio = defaultRatioOf(household);
  return (op) => {
    if (op.table !== 'expenses' || op.op !== 'upsert' || op.awaitingPartner !== true) return null;
    try {
      return completedRow(op, pair, ratio, new Date(op.row.updated_at));
    } catch {
      return null; // shown as held; the send says why it can't be saved
    }
  };
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

function sameMap(x: Readonly<Record<string, number>>, y: Readonly<Record<string, number>>): boolean {
  const kx = Object.keys(x).filter((k) => x[k] !== 0);
  const ky = Object.keys(y).filter((k) => y[k] !== 0);
  return kx.length === ky.length && kx.every((k) => x[k] === y[k]);
}

/** The fields of an entry that move money: an edit that touches none of them keeps the money as stored. */
export const MONEY_FIELDS = ['amount', 'payer', 'split', 'kind'] as const satisfies readonly (keyof ExpenseDraft)[];

export function touchesMoney(patch: Partial<ExpenseDraft>): boolean {
  return MONEY_FIELDS.some((k) => patch[k] !== undefined);
}

/**
 * What the person would have entered to get this row: the starting point for an edit of some fields.
 * `split` is null when it can't be read back exactly: a ratio row stored without its percentages whose
 * shares no whole-number percentage reproduces (percentages are never guessed from rounded pence).
 */
export function inputFromRow(row: ExpenseRow, members: readonly UserId[]): { draft: Omit<ExpenseDraft, 'split'>; split: SplitParams | null } {
  const paid = numberMap(row.paid) ?? {};
  const shares = numberMap(row.shares) ?? {};
  const payer = Object.entries(paid).sort((x, y) => y[1] - x[1])[0]?.[0] ?? row.created_by ?? members[0] ?? '';
  const amount = row.amount_pence as Pence;
  const params = numberMap(row.split_params);
  let split: SplitParams | null;
  switch (row.split_mode) {
    case 'for_other':
      split = { mode: 'for_other' };
      break;
    case 'treat':
      split = { mode: 'treat' };
      break;
    case 'exact': {
      const amounts: Record<UserId, Pence> = {};
      for (const [k, v] of Object.entries(params ?? shares)) amounts[k] = v as Pence;
      split = { mode: 'exact', amounts };
      break;
    }
    default: {
      split = params ? { mode: 'ratio', ratio: params } : null;
      const [a, b] = members;
      if (!params && a !== undefined && b !== undefined && amount > 0) {
        // Rows written elsewhere may carry no percentages: a whole-number reading is accepted only if it
        // gives back exactly the stored shares.
        const pa = Math.round(((shares[a] ?? 0) * 100) / amount);
        const guess: SplitParams = { mode: 'ratio', ratio: { [a]: pa, [b]: 100 - pa } };
        try {
          if (sameMap(computeEntry({ amount, payer, members: [a, b], split: guess }).shares, shares)) split = guess;
        } catch {
          /* not readable */
        }
      }
    }
  }
  return {
    draft: {
      kind: row.kind === 'money_back' ? 'money_back' : 'expense',
      description: row.description,
      amount,
      date: row.date,
      categoryId: row.category_id,
      payer,
      notes: row.notes,
      tags: row.tags,
      refundOf: row.refund_of,
      chapterId: row.chapter_id,
    },
    split,
  };
}

/** An edit of details only (description, date, category, notes, tags, refund link): the money stays as stored. */
export function withDetails(row: ExpenseRow, patch: Partial<ExpenseDraft>, ctx: { userId: UserId; now: Date }): ExpenseRow {
  const description = patch.description ?? row.description;
  const date = patch.date ?? row.date;
  const reasons: InvalidReason[] = [];
  checkCommon(description, date, reasons);
  if (reasons.length > 0) throw new EntryInvalidError(reasons);
  return {
    ...row,
    description: description.trim(),
    date,
    category_id: patch.categoryId === undefined ? row.category_id : patch.categoryId,
    notes: patch.notes === undefined ? row.notes : patch.notes,
    tags: patch.tags === undefined ? row.tags : [...patch.tags],
    refund_of: patch.refundOf === undefined ? row.refund_of : patch.refundOf,
    chapter_id: patch.chapterId === undefined ? row.chapter_id : patch.chapterId,
    ...placeColumns(patch as ExpenseDraft, row, false),
    ...receiptColumns(patch, row),
    updated_by: ctx.userId,
    updated_at: ctx.now.toISOString(),
  };
}

/**
 * The full expense row for a new entry, or for an edit of `base`. Throws EntryInvalidError when the phone
 * would refuse it, with the same reasons the database would give.
 */
export function buildExpense(ctx: WriteContext, draft: ExpenseDraft, base?: ExpenseRow): ExpenseRow {
  const reasons: InvalidReason[] = [];
  checkCommon(draft.description, draft.date, reasons);
  let money: { paid: PenceMap; shares: PenceMap } | null = null;
  try {
    money = computeEntry({ amount: draft.amount, payer: draft.payer, members: ctx.members, split: draft.split });
  } catch (e) {
    reasons.push(e instanceof RangeError ? 'payerSplit' : 'wholePence');
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
    chapter_id: draft.chapterId === undefined ? fresh.chapter_id : draft.chapterId,
    ...placeColumns(draft, fresh, base !== undefined && base.amount_pence !== draft.amount),
    ...receiptColumns(draft, fresh),
    updated_by: ctx.userId,
    updated_at: stamp,
  };
}

export function buildSettlement(ctx: WriteContext, draft: SettlementDraft, base?: SettlementRow): SettlementRow {
  const reasons: InvalidReason[] = [];
  if (!Number.isSafeInteger(draft.amount) || draft.amount <= 0) reasons.push('amount');
  if (draft.from === draft.to || !ctx.members.includes(draft.from) || !ctx.members.includes(draft.to)) {
    reasons.push('settleBetween');
  }
  if (!isIsoDate(draft.date)) reasons.push('date');
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

/**
 * What an upsert sends: the phone's own columns. Never who made the row: the database records the person
 * signed in (migration 5, ACT-2), so a phone can't write a row as the other person.
 */
export function expenseWrite(row: ExpenseRow): ExpenseWrite {
  return pick(row, EXPENSE_WRITE_COLUMNS);
}

export function settlementWrite(row: SettlementRow): SettlementWrite {
  return pick(row, SETTLEMENT_WRITE_COLUMNS);
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
  if (op.op === 'patch' || op.op === 'upload' || op.op === 'insert' || op.op === 'delete') return op.label;
  if (op.table === 'import_ignores') return op.label;
  if (op.table === 'import_rules') return op.row.match_text;
  if (op.table === 'inbox_items') return 'Receipt to sort';
  if (op.table === 'expenses') return expenseLabel(op.row);
  if (op.table === 'settlements') return settlementLabel(op.row);
  if (op.table === 'recurring') return op.row.description;
  if (op.table === 'comments') return op.row.body.slice(0, 40);
  return op.row.name;
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
  /** BAL-6: the completed row for an entry made before the partner joined (see `partnerCompleter`). */
  complete?: (op: MoneyOp) => ExpenseRow | null,
): R[] {
  const relevant = ops.filter((o) => o.table === table);
  if (relevant.length === 0) return [...rows];
  const byId = new Map<string, R>(rows.map((r) => [r.id, r]));
  for (const op of relevant) {
    if (op.op === 'upsert') {
      byId.set(op.row.id, (complete?.(op) ?? op.row) as unknown as R);
    } else if (op.op === 'patch') {
      const base = byId.get(op.id);
      if (base) byId.set(op.id, { ...base, ...op.patch });
    }
  }
  return [...byId.values()];
}

/**
 * CAT-3, CAT-4: a person's choice of category or split for a description, queued like money (it works
 * offline and survives a restart) but not counted as a waiting change, and dropped quietly if refused:
 * it is the app's memory, not the person's entry.
 */
export interface MemoryOp { opId: string; by: string; row: CategoryMemoryWrite }

/** S8 (NOT-1): a change to the person's notification switches, sent to set_notification_prefs (only these keys). */
export interface PrefsOp { opId: string; by: string; patch: NotificationPrefsPatch }

/** The household's memory with the waiting choices applied on top, in the order they were made. */
export function overlayMemory(rows: readonly CategoryMemoryRow[], ops: readonly MemoryOp[]): CategoryMemoryRow[] {
  if (ops.length === 0) return [...rows];
  const byKey = new Map<string, CategoryMemoryRow>(rows.map((r) => [r.key, r]));
  for (const op of ops) byKey.set(op.row.key, { ...op.row, updated_at: byKey.get(op.row.key)?.updated_at ?? '' });
  return [...byKey.values()];
}

/** The columns of a regular payment the phone sends (never posted_count: the server keeps counting, REC-6). */
export function recurringWrite(row: RecurringRow): RecurringWrite {
  return Object.fromEntries(RECURRING_WRITE_COLUMNS.map((k) => [k, row[k]])) as RecurringWrite;
}

/** The columns of a comment the phone sends. */
export function commentWrite(row: CommentRow): CommentWrite {
  const { id, household_id, expense_id, author, body, deleted_at } = row;
  return { id, household_id, expense_id, author, body, deleted_at };
}

/** The columns of a chapter the phone sends. */
export function chapterWrite(row: ChapterRow): ChapterWrite {
  const { id, household_id, name, emoji, kind, country, start_date, end_date, closed } = row;
  return { id, household_id, name, emoji, kind, country, start_date, end_date, closed };
}

/** The columns of a category the phone sends. */
export function categoryWrite(row: CategoryRow): CategoryWrite {
  const { id, household_id, name, emoji, colour, archived, sort, default_ratio } = row;
  return { id, household_id, name, emoji, colour, archived, sort, default_ratio };
}

/** Whatever a queued write gets back from the server. */
export type QueuedRow = ExpenseRow | SettlementRow | RecurringRow | InboxItemRow | CategoryRow | ChapterRow | CommentRow | ImportRuleRow;

/** S7 (IMP-3): the hashes decided "Not ours", with the waiting inserts and removals applied in order. */
export function overlayIgnores(rows: readonly ImportIgnoreRow[], ops: readonly MoneyOp[]): Set<string> {
  const key = (r: ImportIgnoreRow) => `${r.source}:${r.id_hash}`;
  const out = new Set(rows.map(key));
  for (const op of ops) {
    if (op.table !== 'import_ignores') continue;
    if (op.op === 'insert') out.add(key(op.row));
    else out.delete(key(op.row));
  }
  return out;
}

/** S7 (IMP-3): the household's rules with the waiting ones applied (a rule replaces one for the same words). */
export function overlayRules(rows: readonly ImportRuleRow[], ops: readonly MoneyOp[]): ImportRuleRow[] {
  let out = [...rows];
  for (const op of ops) {
    if (op.table !== 'import_rules') continue;
    if (op.op === 'upsert') out = [...out.filter((r) => r.id !== op.row.id && r.match_text !== op.row.match_text), op.row];
    else out = out.filter((r) => r.id !== op.id && r.match_text !== op.row.match_text);
  }
  return out;
}
