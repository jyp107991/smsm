/**
 * What screens call to change things (S2 brief, "Interfaces → Data layer").
 *
 * Money writes (entries and settle-ups) are instant and work offline (ADD-6, OFF-2): each builds its row
 * with the core's split maths, refuses on the phone what the database would refuse, and queues an upsert
 * by an id made on the phone. They return at once, never waiting for the network: the id for an add.
 *
 * The other writes (setup, identity, approvals, monzo.me name) need the server's answer, so they need a
 * connection and say so in plain words when there is none (OFF-4).
 */
import type { SplitParams, UserId } from '../core/split';
import { normaliseKey } from '../core/text';
import type { AuthUser, ExpenseRow, SettlementRow } from './api';
import type { Json } from './database.types';
import { activeDataLayer } from './context';
import { keys } from './keys';
import type { DataLayer } from './queryClient';
import { OtherWindowError } from './windows';
import {
  buildExpense, buildProvisionalExpense, buildSettlement, completeSplit, defaultRatioOf, EntryInvalidError, expenseLabel, inputFromRow,
  newId, PartnerNotJoinedError, settlementLabel, touchesMoney, withDetails, type ExpenseDraft, type MoneyOp, type SettlementDraft,
} from './writes';
import type { Json as JsonValue } from './database.types';

export { EntryInvalidError, OtherWindowError, PartnerNotJoinedError };
export type { ExpenseDraft, SettlementDraft };

/** Needs a connection (OFF-4). */
export class OfflineError extends Error {
  constructor() {
    super('This needs a connection. Try again when you’re back online.');
    this.name = 'OfflineError';
  }
}

export class NotSignedInError extends Error {
  constructor() {
    super('Sign in first.');
    this.name = 'NotSignedInError';
  }
}

export class NotInHouseholdError extends Error {
  constructor() {
    super('Start or join a household first.');
    this.name = 'NotInHouseholdError';
  }
}

/** The phone's copy hasn't been read from storage yet (a few milliseconds after opening). */
export class NotReadyError extends Error {
  constructor() {
    super('Still opening. Try again in a moment.');
    this.name = 'NotReadyError';
  }
}

export class EntryNotFoundError extends Error {
  constructor(id: string) {
    super(`No entry with id ${id} on this phone.`);
    this.name = 'EntryNotFoundError';
  }
}

/** Signing out would lose changes that haven't reached the server yet, or refused ones kept to fix (OFF-5). */
export class ChangesWaitingError extends Error {
  constructor(public readonly count: number, public readonly refused = 0) {
    super(
      refused > 0
        ? `${String(count)} changes haven’t been saved yet (${String(refused)} need fixing).`
        : `${String(count)} changes are still waiting to sync.`,
    );
    this.name = 'ChangesWaitingError';
  }
}

/** ACT-5 (S2 review): the joint account isn't in the app yet (SPL-4), so its rows' money can't be rebuilt. */
export const JOINT_MONEY_EDIT = 'This entry was paid from the joint account. Its amount, payer and split can’t be changed in the app yet.';
/** A split stored without its percentages, that no whole-number split reproduces: it is never guessed. */
export const SPLIT_AGAIN = 'Choose the split again to change the amount or who paid.';

interface Ctx { uid: string; hid: string; memberIds: string[]; pair: readonly [UserId, UserId] | null; layer: DataLayer }

function context(layer: DataLayer): Ctx {
  if (!layer.isReady()) throw new NotReadyError();
  const uid = layer.me();
  if (!uid) throw new NotSignedInError();
  const hid = layer.householdId();
  if (!hid) throw new NotInHouseholdError();
  const memberIds = layer.members().map((m) => m.user_id);
  const [a, b] = memberIds;
  return { uid, hid, memberIds, pair: a && b ? [a, b] : null, layer };
}

type ExpenseBuilt = { row: ExpenseRow; input: ExpenseDraft; awaitingPartner: true } | { row: ExpenseRow; input: ExpenseDraft; awaitingPartner: false };

/** The row for an entry as entered: a full one, or one held until the partner joins (BAL-6). */
function expenseRowFor(ctx: Ctx, input: ExpenseDraft, base?: ExpenseRow): ExpenseBuilt {
  const now = ctx.layer.now();
  if (!ctx.pair) {
    if (!ctx.memberIds.includes(input.payer)) throw new EntryInvalidError(['Check who paid and the split.']);
    return { row: buildProvisionalExpense({ householdId: ctx.hid, userId: ctx.uid, now }, input, base), input, awaitingPartner: true };
  }
  const full = { ...input, split: completeSplit(input.split, ctx.pair, defaultRatioOf(ctx.layer.household())) };
  return { row: buildExpense({ householdId: ctx.hid, userId: ctx.uid, members: ctx.pair, now }, full, base), input: full, awaitingPartner: false };
}

function serverRows<R>(layer: DataLayer, table: 'expenses' | 'settlements'): R[] {
  const uid = layer.me() ?? '';
  return layer.client.getQueryData<R[]>(table === 'expenses' ? keys.expenses(uid) : keys.settlements(uid)) ?? [];
}

/** The latest waiting upsert of this row (its input is the most faithful starting point for an edit). */
function latestUpsert(layer: DataLayer, table: 'expenses' | 'settlements', id: string): MoneyOp | undefined {
  return [...layer.waiting()].reverse().find((o) => o.table === table && o.op === 'upsert' && o.row.id === id);
}

/** A refused write kept on the phone (OFF-5): editing it by its id is how the person fixes it. */
function kept(layer: DataLayer, table: 'expenses' | 'settlements', id: string) {
  return [...layer.problems.list()].reverse().find((p) => p.table === table && p.rowId === id && p.row !== null);
}

/**
 * Where an edit starts: the latest waiting write of this entry; else a refused write kept to fix (what the
 * person entered, OFF-5); else the stored row. `input` is null when there is no entry as entered to start
 * from (the row came from the server, or only its details were changed).
 */
function currentExpense(layer: DataLayer, id: string): { row: ExpenseRow; onServer: boolean; input: ExpenseDraft | null } {
  const onServer = serverRows<ExpenseRow>(layer, 'expenses').some((r) => r.id === id);
  const op = latestUpsert(layer, 'expenses', id);
  const shown = layer.entries().find((r) => r.id === id);
  if (op?.table === 'expenses' && op.op === 'upsert') return { row: shown ?? op.row, onServer, input: op.input };
  const problem = kept(layer, 'expenses', id);
  if (problem?.row) return { row: problem.row as ExpenseRow, onServer, input: (problem.input as ExpenseDraft | null | undefined) ?? null };
  if (!shown) throw new EntryNotFoundError(id);
  return { row: shown, onServer, input: null };
}

function currentSettlement(layer: DataLayer, id: string): { row: SettlementRow; onServer: boolean } {
  const onServer = serverRows<SettlementRow>(layer, 'settlements').some((r) => r.id === id);
  const row = layer.settlements().find((r) => r.id === id) ?? (kept(layer, 'settlements', id)?.row as SettlementRow | undefined);
  if (!row) throw new EntryNotFoundError(id);
  return { row, onServer };
}

// ───────────── money: instant, offline, in order ─────────────

/** ADD-*, MB-*: saves a new expense or money-back entry; returns the id made on the phone, at once. */
export function addExpense(input: ExpenseDraft, layer = activeDataLayer()): string {
  const ctx = context(layer);
  const built = expenseRowFor(ctx, input);
  layer.enqueue({ opId: newId(), by: ctx.uid, table: 'expenses', op: 'upsert', isNew: true, ...built });
  return built.row.id;
}

/**
 * ACT-5: either person can edit any entry; only the fields given change. Also how a refused write is fixed
 * (OFF-5): edit the kept entry by its id and it is saved again; the problem clears once it is stored.
 */
export function editExpense(id: string, patch: Partial<ExpenseDraft>, layer = activeDataLayer()): void {
  const ctx = context(layer);
  const current = currentExpense(layer, id);
  const base = { opId: newId(), by: ctx.uid, table: 'expenses', op: 'upsert', isNew: !current.onServer } as const;
  if (current.input) {
    // The entry as the person entered it (still waiting, or kept to fix): rebuilt exactly from that.
    layer.enqueue({ ...base, ...expenseRowFor(ctx, { ...current.input, ...patch }, current.row) });
    return;
  }
  if (!touchesMoney(patch)) {
    // A new description, date, category, note or tag never rebuilds the money: kept exactly as stored.
    layer.enqueue({ ...base, row: withDetails(current.row, patch, { userId: ctx.uid, now: layer.now() }), input: null });
    return;
  }
  if (current.row.paid_via === 'joint') throw new EntryInvalidError([JOINT_MONEY_EDIT]);
  const read = inputFromRow(current.row, ctx.memberIds);
  const split = patch.split ?? read.split;
  if (!split) throw new EntryInvalidError([SPLIT_AGAIN]);
  layer.enqueue({ ...base, ...expenseRowFor(ctx, { ...read.draft, split, ...patch }, current.row) });
}

/** A refused new entry that never reached the server: deleting it (or Undo) just lets the problem go. */
function dropRefusedNew(layer: DataLayer, table: 'expenses' | 'settlements', id: string, onServer: boolean): boolean {
  if (onServer || latestUpsert(layer, table, id) || !kept(layer, table, id)) return false;
  dismissProblem(id, layer);
  return true;
}

/** ACT-3: soft delete; the entry stays in the database and can be restored. Also Undo of a save (ADD-6). */
export function deleteExpense(id: string, layer = activeDataLayer()): void {
  const ctx = context(layer);
  const { row, onServer } = currentExpense(layer, id);
  if (dropRefusedNew(layer, 'expenses', id, onServer)) return;
  layer.enqueue({ opId: newId(), by: ctx.uid, table: 'expenses', op: 'patch', id, patch: { deleted_at: layer.now().toISOString() }, label: expenseLabel(row) });
}

export function restoreExpense(id: string, layer = activeDataLayer()): void {
  const ctx = context(layer);
  const { row } = currentExpense(layer, id);
  layer.enqueue({ opId: newId(), by: ctx.uid, table: 'expenses', op: 'patch', id, patch: { deleted_at: null }, label: expenseLabel(row) });
}

function settlementCtx(layer: DataLayer) {
  const ctx = context(layer);
  if (!ctx.pair) throw new PartnerNotJoinedError();
  return { ...ctx, pair: ctx.pair };
}

/** SET-1, SET-2: records "Sam paid Jae £50.00"; returns the id made on the phone, at once. */
export function addSettlement(input: SettlementDraft, layer = activeDataLayer()): string {
  const ctx = settlementCtx(layer);
  const row = buildSettlement({ householdId: ctx.hid, userId: ctx.uid, members: ctx.pair, now: layer.now() }, input);
  layer.enqueue({ opId: newId(), by: ctx.uid, table: 'settlements', op: 'upsert', isNew: true, row, input });
  return row.id;
}

/** SET-3: settle-ups are editable and soft-deletable. Only the fields given change. */
export function editSettlement(id: string, patch: Partial<SettlementDraft>, layer = activeDataLayer()): void {
  const ctx = settlementCtx(layer);
  const { row: base, onServer } = currentSettlement(layer, id);
  const input: SettlementDraft = {
    from: base.from_user, to: base.to_user, amount: base.amount_pence as SettlementDraft['amount'], date: base.date, note: base.note,
    method: base.method === 'monzo' ? 'monzo' : 'other', ...patch,
  };
  const row = buildSettlement({ householdId: ctx.hid, userId: ctx.uid, members: ctx.pair, now: layer.now() }, input, base);
  layer.enqueue({ opId: newId(), by: ctx.uid, table: 'settlements', op: 'upsert', isNew: !onServer, row, input });
}

export function deleteSettlement(id: string, layer = activeDataLayer()): void {
  const ctx = context(layer);
  const { row, onServer } = currentSettlement(layer, id);
  if (dropRefusedNew(layer, 'settlements', id, onServer)) return;
  layer.enqueue({ opId: newId(), by: ctx.uid, table: 'settlements', op: 'patch', id, patch: { deleted_at: layer.now().toISOString() }, label: settlementLabel(row) });
}

export function restoreSettlement(id: string, layer = activeDataLayer()): void {
  const ctx = context(layer);
  const { row } = currentSettlement(layer, id);
  layer.enqueue({ opId: newId(), by: ctx.uid, table: 'settlements', op: 'patch', id, patch: { deleted_at: null }, label: settlementLabel(row) });
}

// ───────── learning: what a person's choices teach the app (CAT-3, CAT-4) ─────────

function splitForMemory(split: SplitParams): { split_mode: string; split_params: JsonValue } | null {
  if (split.mode === 'treat' || split.mode === 'for_other') return { split_mode: split.mode, split_params: null };
  // A ratio is remembered as each person's percentage; exact amounts belong to one entry, not a description.
  if (split.mode === 'ratio' && Object.keys(split.ratio).length === 2) return { split_mode: 'ratio', split_params: { ...split.ratio } };
  return null;
}

/**
 * CAT-3, CAT-4: the person picked a category or a split for this description, so next time the app
 * offers their choice. Only what was chosen is changed; a person's choice always overwrites a guess.
 * Queued like a money write (works offline), so it never delays a save.
 */
export function rememberChoice(description: string, choice: { categoryId?: string | null; split?: SplitParams }, layer = activeDataLayer()): void {
  const key = normaliseKey(description);
  if (key === '' || (choice.categoryId === undefined && choice.split === undefined)) return;
  const ctx = context(layer);
  const before = layer.memory().find((m) => m.key === key);
  const split = choice.split && ctx.pair ? splitForMemory(choice.split) : null;
  const row = {
    household_id: ctx.hid,
    key,
    category_id: choice.categoryId !== undefined ? choice.categoryId : (before?.category_id ?? null),
    split_mode: split ? split.split_mode : (before?.split_mode ?? null),
    split_params: split ? split.split_params : (before?.split_params ?? null),
    uses: (before?.uses ?? 0) + 1,
    source: 'user',
  };
  if (row.category_id === null && row.split_mode === null) return;
  layer.remember({ opId: newId(), by: ctx.uid, row });
}

/** The person has seen a refused write and doesn't want to fix it. `id` is the entry's id. */
export function dismissProblem(id: string, layer = activeDataLayer()): void {
  // Kept-back writes are saved by the window that owns the queue.
  if (layer.role() === 'follower') throw new OtherWindowError();
  for (const p of layer.problems.list()) if (p.rowId === id || p.id === id) layer.problems.dismiss(p.id);
}

/** The refused writes kept to fix for the person signed in (OFF-5). */
export function refusedFor(layer: DataLayer) {
  const me = layer.me();
  return layer.problems.list().filter((p) => p.by === undefined || me === null || p.by === me);
}

// ───────────── setup, identity, approvals: need a connection ─────────────

async function online<T>(layer: DataLayer, fn: () => Promise<T>): Promise<T> {
  await layer.ready;
  if (!layer.network.online) throw new OfflineError();
  return fn();
}

/** PPL-1: emails a 6-digit code. */
export function sendCode(email: string, layer = activeDataLayer()): Promise<void> {
  return online(layer, () => layer.api.auth.sendCode(email.trim()));
}

/** PPL-1: signs in with the emailed code. A wrong or expired code rejects with ApiError('refused'). */
export function verifyCode(email: string, code: string, layer = activeDataLayer()): Promise<AuthUser> {
  return online(layer, () => layer.api.auth.verifyCode(email.trim(), code.replace(/\s+/g, '')));
}

/**
 * Signs out and clears this phone's copy. Refuses while changes are waiting, or refused ones are kept to fix
 * (OFF-5: nothing is dropped silently), unless told to discard them.
 */
export async function signOut(opts: { discardWaiting?: boolean } = {}, layer = activeDataLayer()): Promise<void> {
  const refused = refusedFor(layer).length;
  const count = layer.waiting().length + refused;
  if (count > 0 && !opts.discardWaiting) throw new ChangesWaitingError(count, refused);
  await online(layer, () => layer.signOut());
}

/** PPL-2: start a household; returns its id. */
export async function createHousehold(layer = activeDataLayer()): Promise<string> {
  const id = await online(layer, () => layer.api.createHousehold());
  await layer.refresh();
  return id;
}

/** PPL-2: join with the partner's code. Null means "No household has that code". */
export async function joinHousehold(code: string, layer = activeDataLayer()): Promise<string | null> {
  const id = await online(layer, () => layer.api.joinHousehold(code.trim().toUpperCase()));
  if (id !== null) await layer.refresh();
  return id;
}

export const NAME_MAX = 24;

function checkName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0 || Array.from(trimmed).length > NAME_MAX) throw new EntryInvalidError([`A name is 1 to ${String(NAME_MAX)} characters.`]);
  return trimmed;
}

/** PPL-3: name and animal, chosen once and then locked. */
export async function setIdentity(name: string, animal: 'cat' | 'dog', layer = activeDataLayer()): Promise<void> {
  const trimmed = checkName(name);
  await online(layer, () => layer.api.setIdentity(trimmed, animal));
  await layer.refresh();
}

/** SET-2: the monzo.me name for the settle-up handoff; null or empty clears it. A pasted link is accepted. */
export async function setMonzoMe(username: string | null, layer = activeDataLayer()): Promise<void> {
  const value = username === null ? '' : username.trim().replace(/^(https?:\/\/)?monzo\.me\//i, '').replace(/\/+$/, '');
  if (value !== '' && !/^[A-Za-z0-9_-]{1,40}$/.test(value)) throw new EntryInvalidError(['That doesn’t look like a monzo.me name.']);
  await online(layer, () => layer.api.setMonzoMe(value === '' ? null : value));
  await layer.refresh();
}

export type ChangeRequest =
  | { kind: 'identity'; displayName: string; animal: 'cat' | 'dog' }
  | { kind: 'default_ratio'; ratio: Readonly<Record<UserId, number>> };

/** PPL-4, PPL-5: ask the partner to approve a new name and animal, or a new default split. */
export async function requestChange(change: ChangeRequest, layer = activeDataLayer()): Promise<string> {
  const uid = layer.me();
  if (!uid) throw new NotSignedInError();
  let payload: Json;
  if (change.kind === 'identity') {
    payload = { user_id: uid, display_name: checkName(change.displayName), animal: change.animal };
  } else {
    const parts = Object.values(change.ratio);
    if (parts.length !== 2 || parts.some((p) => !Number.isInteger(p) || p < 0) || parts.reduce((t, p) => t + p, 0) !== 100) {
      throw new EntryInvalidError(['The split must add up to 100%.']);
    }
    payload = { ratio: { ...change.ratio } };
  }
  const id = await online(layer, () => layer.api.requestChange(change.kind, payload));
  await layer.refresh();
  return id;
}

/** PPL-5: the partner approves or declines; the requester may only cancel (approve = false). */
export async function decideChange(id: string, approve: boolean, layer = activeDataLayer()): Promise<void> {
  await online(layer, () => layer.api.decideChange(id, approve));
  await layer.refresh();
}
