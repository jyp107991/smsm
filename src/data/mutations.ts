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
import type { IsoDate } from '../core/dates';
import { isIsoDate } from '../core/dates';
import { occurrence } from '../core/recurring';
import type { Pence } from '../core/money';
import { RECURRING_WRITE_COLUMNS, type AuthUser, type CategoryRow, type ChapterColumn, type ChapterRow, type ChapterWrite, type CommentColumn, type CommentRow, type ExpenseRow, type InboxItemRow, type RecurringColumn, type RecurringRow, type SettlementRow } from './api';
import type { Json } from './database.types';
import { activeDataLayer } from './context';
import { keys } from './keys';
import type { DataLayer } from './queryClient';
import { OtherWindowError } from './windows';
import { locateWith, rateWith, setStoredCountry, setStoredUseLocation, storedCountry, storedUseLocation, type Located } from './places';
import {
  buildExpense, buildProvisionalExpense, buildSettlement, categoryWrite, chapterWrite, completeSplit, defaultRatioOf, EntryInvalidError, expenseLabel, inputFromRow,
  newId, overlay, recurringWrite, PartnerNotJoinedError, settlementLabel, touchesMoney, withDetails, type ExpenseDraft, type InvalidReason, type MoneyOp,
  type SettlementDraft,
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
export const JOINT_MONEY_EDIT = 'jointMoney' satisfies InvalidReason;
/** A split stored without its percentages, that no whole-number split reproduces: it is never guessed. */
export const SPLIT_AGAIN = 'splitAgain' satisfies InvalidReason;

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
    if (!ctx.memberIds.includes(input.payer)) throw new EntryInvalidError(['payerSplit']);
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

/**
 * True when this phone already has a row with this id: shown (deleted or not), waiting, or refused and kept.
 * A second submit of the same form or action (Q-F1) finds its own first one here.
 */
function knownRow(layer: DataLayer, table: 'expenses' | 'settlements', id: string): boolean {
  const rows: readonly { id: string }[] = table === 'expenses' ? layer.entries() : layer.settlements();
  return rows.some((r) => r.id === id) || kept(layer, table, id) !== undefined;
}

/**
 * ADD-*, MB-*: saves a new expense or money-back entry; returns the id made on the phone, at once.
 *
 * `id` (S2 polish Q-F1, ADD-6): the row id, made once per form or action instance by the screen. A second
 * submit with the same id (a double tap, Enter held) finds the row already on this phone and changes nothing,
 * so it is recorded once. Without it a new id is made.
 */
export function addExpense(input: ExpenseDraft & { id?: string }, layer = activeDataLayer()): string {
  const { id, ...given } = input;
  const ctx = context(layer);
  // CHP-2: while a chapter is current on this phone, a new entry goes into it unless the person chose otherwise.
  let draft: ExpenseDraft = given.chapterId === undefined ? { ...given, chapterId: currentOpenChapter(layer) } : given;
  // PLC-3: and this phone's current country (an entry can always be set to another).
  if (draft.country === undefined) draft = { ...draft, country: currentCountry(layer) };
  if (id !== undefined && knownRow(layer, 'expenses', id)) return id;
  refuseForDeletedOriginal(layer, draft.kind === 'money_back' ? draft.refundOf : null);
  const built = expenseRowFor(ctx, draft);
  const row = id === undefined ? built.row : { ...built.row, id };
  layer.enqueue({ opId: newId(), by: ctx.uid, table: 'expenses', op: 'upsert', isNew: true, ...built, row });
  return row.id;
}

/**
 * S7 (IMP-3): an entry kept from a bank statement: the person's entry as `addExpense` makes it (at once, offline
 * too), marked with where it came from and the bank's own id, so the same row can never be imported twice
 * (the expenses_external index). Its chapter and country are as given (an import is history, not "now").
 */
export function addImportedExpense(
  input: ExpenseDraft & { id?: string },
  from: { source: 'monzo' | 'csv'; externalId: string },
  layer = activeDataLayer(),
): string {
  const { id, ...draft } = input;
  const ctx = context(layer);
  if (id !== undefined && knownRow(layer, 'expenses', id)) return id;
  const built = expenseRowFor(ctx, { chapterId: null, ...draft });
  const row: ExpenseRow = { ...built.row, id: id ?? built.row.id, source: from.source, external_id: from.externalId };
  layer.enqueue({ opId: newId(), by: ctx.uid, table: 'expenses', op: 'upsert', isNew: true, ...built, row });
  return row.id;
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
    // The entry as the person entered it (still waiting, or kept to fix): rebuilt exactly from that. A new pounds
    // amount with no new original drops the old one (it no longer describes the entry, PLC-6).
    const stale = patch.amount !== undefined && patch.amount !== current.input.amount && patch.original === undefined;
    layer.enqueue({ ...base, ...expenseRowFor(ctx, { ...current.input, ...patch, ...(stale ? { original: null } : {}) }, current.row) });
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

/**
 * MB-3 (S9a review): money back is never saved for (or restored onto) an original that was deleted; the database
 * refuses it too (check_refund_limit). Restoring the original brings back what was deleted with it.
 */
function refuseForDeletedOriginal(layer: DataLayer, refundOf: string | null | undefined): void {
  if (refundOf == null) return;
  const original = layer.entries().find((e) => e.id === refundOf);
  if (original && original.deleted_at !== null) throw new EntryInvalidError(['originalDeleted']);
}

/** A refused new entry that never reached the server: deleting it (or Undo) just lets the problem go. */
function dropRefusedNew(layer: DataLayer, table: 'expenses' | 'settlements', id: string, onServer: boolean): boolean {
  if (onServer || latestUpsert(layer, table, id) || !kept(layer, table, id)) return false;
  dismissProblem(id, layer);
  return true;
}

/**
 * ACT-3: soft delete; the entry stays in the database and can be restored. Also Undo of a save (ADD-6).
 * True when something changed; false when it was already deleted (Q-F4: the screen then says nothing).
 */
export function deleteExpense(id: string, layer = activeDataLayer()): boolean {
  const ctx = context(layer);
  const { row, onServer } = currentExpense(layer, id);
  if (dropRefusedNew(layer, 'expenses', id, onServer)) return true;
  // Q-F4: already deleted (a second tap, or the other phone got there first): nothing to do, nothing logged.
  if (row.deleted_at !== null) return false;
  layer.enqueue({ opId: newId(), by: ctx.uid, table: 'expenses', op: 'patch', id, patch: { deleted_at: layer.now().toISOString() }, label: expenseLabel(row) });
  return true;
}

/**
 * S7 (IMP-3, Undo of Keep): an imported entry taken back: deleted (soft: it stays in history) with its bank id cleared,
 * so the same bank row can be offered and kept again. True when something changed.
 */
export function unkeepImportedExpense(id: string, layer = activeDataLayer()): boolean {
  const ctx = context(layer);
  const { row, onServer } = currentExpense(layer, id);
  if (dropRefusedNew(layer, 'expenses', id, onServer)) return true;
  if (row.deleted_at !== null && row.external_id === null) return false;
  const patch = { deleted_at: row.deleted_at ?? layer.now().toISOString(), external_id: null };
  layer.enqueue({ opId: newId(), by: ctx.uid, table: 'expenses', op: 'patch', id, patch, label: expenseLabel(row) });
  return true;
}

export function restoreExpense(id: string, layer = activeDataLayer()): boolean {
  const ctx = context(layer);
  const { row } = currentExpense(layer, id);
  // Q-F4: not deleted: nothing to restore.
  if (row.deleted_at === null) return false;
  refuseForDeletedOriginal(layer, row.kind === 'money_back' ? row.refund_of : null);
  layer.enqueue({ opId: newId(), by: ctx.uid, table: 'expenses', op: 'patch', id, patch: { deleted_at: null }, label: expenseLabel(row) });
  return true;
}

function settlementCtx(layer: DataLayer) {
  const ctx = context(layer);
  if (!ctx.pair) throw new PartnerNotJoinedError();
  return { ...ctx, pair: ctx.pair };
}

/**
 * SET-1, SET-2: records "Sam paid Jae £50.00"; returns the id made on the phone, at once. `id` as for
 * addExpense (Q-F1): a second submit of the same sheet or "Yes" records nothing more.
 */
export function addSettlement(input: SettlementDraft & { id?: string }, layer = activeDataLayer()): string {
  const { id, ...draft } = input;
  const ctx = settlementCtx(layer);
  if (id !== undefined && knownRow(layer, 'settlements', id)) return id;
  const built = buildSettlement({ householdId: ctx.hid, userId: ctx.uid, members: ctx.pair, now: layer.now() }, draft);
  const row = id === undefined ? built : { ...built, id };
  layer.enqueue({ opId: newId(), by: ctx.uid, table: 'settlements', op: 'upsert', isNew: true, row, input: draft });
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

export function deleteSettlement(id: string, layer = activeDataLayer()): boolean {
  const ctx = context(layer);
  const { row, onServer } = currentSettlement(layer, id);
  if (dropRefusedNew(layer, 'settlements', id, onServer)) return true;
  if (row.deleted_at !== null) return false; // Q-F4
  layer.enqueue({ opId: newId(), by: ctx.uid, table: 'settlements', op: 'patch', id, patch: { deleted_at: layer.now().toISOString() }, label: settlementLabel(row) });
  return true;
}

export function restoreSettlement(id: string, layer = activeDataLayer()): boolean {
  const ctx = context(layer);
  const { row } = currentSettlement(layer, id);
  if (row.deleted_at === null) return false; // Q-F4
  layer.enqueue({ opId: newId(), by: ctx.uid, table: 'settlements', op: 'patch', id, patch: { deleted_at: null }, label: settlementLabel(row) });
  return true;
}

// ───────── learning: what a person's choices teach the app (CAT-3, CAT-4) ─────────

function splitForMemory(split: SplitParams): { split_mode: string; split_params: JsonValue } | null {
  if (split.mode === 'treat' || split.mode === 'for_other') return { split_mode: split.mode, split_params: null };
  // A ratio is remembered as each person's percentage; exact amounts belong to one entry, not a description.
  if (split.mode === 'ratio' && Object.keys(split.ratio).length === 2) return { split_mode: 'ratio', split_params: { ...split.ratio } };
  return null;
}

/**
 * TXT-3, CAT-4 (S9a review): what the household taught the app for these words (a normalised key), keys learned before
 * apostrophes were folded ("sainsbury’s") read as today's ("sainsburys"); of two that now meet, the one taught last
 * (as memoryMap reads them).
 */
export function learned<M extends { key: string; updated_at: string }>(memory: readonly M[], key: string): M | undefined {
  let best: M | undefined;
  for (const m of memory) {
    if (normaliseKey(m.key) !== key) continue;
    if (best === undefined || m.updated_at >= best.updated_at) best = m;
  }
  return best;
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
  const before = learned(layer.memory(), key);
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
  if (trimmed.length === 0 || Array.from(trimmed).length > NAME_MAX) throw new EntryInvalidError(['name']);
  return trimmed;
}

/** PPL-3: name and animal, chosen once and then locked. */
export async function setIdentity(name: string, animal: 'cat' | 'dog', layer = activeDataLayer()): Promise<void> {
  const trimmed = checkName(name);
  await online(layer, () => layer.api.setIdentity(trimmed, animal));
  await layer.refresh();
}

/**
 * The monzo.me name in what was typed: a pasted link or an "@name" is accepted (S2 polish Q-U11). '' for
 * nothing; null when it can't be a monzo.me name.
 */
export function monzoNameOf(typed: string): string | null {
  const value = typed.trim().replace(/^(https?:\/\/)?monzo\.me\//i, '').replace(/\/+$/, '').replace(/^@/, '');
  return value === '' || /^[A-Za-z0-9_-]{1,40}$/.test(value) ? value : null;
}

/** SET-2: the monzo.me name for the settle-up handoff; null or empty clears it. A pasted link or "@name" is accepted. */
export async function setMonzoMe(username: string | null, layer = activeDataLayer()): Promise<void> {
  const value = monzoNameOf(username ?? '');
  if (value === null) throw new EntryInvalidError(['monzoName']);
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
      throw new EntryInvalidError(['ratio100']);
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

// ─────────────────────────────── S3: regular payments, the Inbox, categories ───────────────────────────────

/** A regular payment as the person enters it (REC-1): an entry's fields plus its schedule. */
export interface RecurringDraft {
  description: string; amount: Pence; categoryId: string | null; payer: UserId; split: SplitParams; notes?: string | null;
  frequency: 'weekly' | 'monthly' | 'yearly'; every: number; startDate: IsoDate; endDate: IsoDate | null;
  amountVaries: boolean; isSubscription: boolean;
}

/** The palette a category may use (DESIGN §3.1; the database checks the same list). */
export const CATEGORY_COLOURS = ['moss', 'amber', 'walnut', 'honey', 'slate', 'plum', 'oak', 'berry', 'lake', 'clay', 'fern', 'stone'] as const;
export type CategoryColour = (typeof CATEGORY_COLOURS)[number];
export interface CategoryDraft { name: string; emoji: string; colour: CategoryColour }

type S3Table = 'recurring' | 'inbox_items' | 'categories' | 'chapters';

/** The rows of a table as this phone shows them: the stored copy with every waiting change on top. */
function shown<R extends { id: string }>(layer: DataLayer, table: S3Table): R[] {
  const uid = layer.me() ?? '';
  const key = table === 'recurring' ? keys.recurring(uid) : table === 'inbox_items' ? keys.inbox(uid) : table === 'chapters' ? keys.chapters(uid) : keys.categories(uid);
  return overlay(layer.client.getQueryData<R[]>(key) ?? [], layer.waiting(), table);
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * REC-1, REC-6: adds a regular payment or (with an existing template's id) edits it; returns its id at once.
 * Its money is built by the core like an entry's; the phone never sends posted_count, so an edit changes
 * future occurrences only. A second submit of the same form changes nothing (Q-F1). Once stored, the phone
 * posts what is due (REC-2), so a payment due today is money at once. `active: false` adds a new one paused (S9:
 * "Start from <next> instead" keeping its day is a paused add, then `resumeRecurring`); an edit never sends `active`.
 */
export function saveRecurring(input: RecurringDraft & { id?: string; active?: boolean }, layer = activeDataLayer()): string {
  const { id, active, ...draft } = input;
  const ctx = context(layer);
  const existing = id === undefined ? undefined : shown<RecurringRow>(layer, 'recurring').find((r) => r.id === id);
  // An end before the start is refused when it is picked; one already stored (End tapped before the first day) is kept.
  const keptEnd = existing !== undefined && draft.endDate === existing.end_date && draft.startDate === existing.start_date;
  const reasons: InvalidReason[] = [];
  if (draft.description.trim() === '') reasons.push('description');
  if (!Number.isSafeInteger(draft.amount) || draft.amount <= 0) reasons.push('amount');
  if (!Number.isInteger(draft.every) || draft.every < 1 || draft.every > 52 || !isIsoDate(draft.startDate)
    || (draft.endDate !== null && (!isIsoDate(draft.endDate) || (draft.endDate < draft.startDate && !keptEnd)))) reasons.push('schedule');
  if (reasons.length > 0) throw new EntryInvalidError(reasons);
  if (!ctx.pair) throw new PartnerNotJoinedError();
  // The money, worked out as for an entry of that amount (check_money holds for templates too).
  const money = expenseRowFor(ctx, {
    description: draft.description, amount: draft.amount, date: layer.today(), categoryId: draft.categoryId, payer: draft.payer, split: draft.split,
  }).row;
  const stamp = layer.now().toISOString();
  const row: RecurringRow = {
    id: id ?? newId(), household_id: ctx.hid, description: draft.description.trim(), amount_pence: draft.amount, amount_varies: draft.amountVaries,
    category_id: draft.categoryId, paid: money.paid, paid_via: money.paid_via, split_mode: money.split_mode, split_params: money.split_params,
    shares: money.shares, is_subscription: draft.isSubscription, frequency: draft.frequency, every: draft.every, start_date: draft.startDate,
    end_date: draft.endDate, active: existing?.active ?? active ?? true, notes: draft.notes ?? existing?.notes ?? null,
    posted_count: existing?.posted_count ?? 0, created_by: existing?.created_by ?? ctx.uid, created_at: existing?.created_at ?? stamp, updated_at: stamp,
  };
  // Q-F1: the same form saved twice (a double tap) changes nothing.
  if (existing && sameJson(recurringWrite(existing), recurringWrite(row))) return row.id;
  // An edit writes what the form owns, never `active` (a partner's pause stays paused).
  layer.enqueue({
    opId: newId(), by: ctx.uid, table: 'recurring', op: 'upsert', isNew: existing === undefined, row, input: null,
    ...(existing ? { columns: EDIT_COLUMNS } : {}),
  });
  return row.id;
}

const EDIT_COLUMNS: readonly RecurringColumn[] = RECURRING_WRITE_COLUMNS.filter(
  (k): k is RecurringColumn => k !== 'id' && k !== 'household_id' && k !== 'active',
);

function changeRecurring(
  id: string, change: Partial<Pick<RecurringRow, 'active' | 'end_date'>>, layer: DataLayer,
  /** What the server will make of it, for the phone's waiting copy only (never sent). */
  expected: Partial<Pick<RecurringRow, 'posted_count'>> = {},
): boolean {
  const ctx = context(layer);
  const current = shown<RecurringRow>(layer, 'recurring').find((r) => r.id === id);
  if (!current) throw new EntryNotFoundError(id);
  const next: RecurringRow = { ...current, ...change, ...expected, updated_at: layer.now().toISOString() };
  if (sameJson(recurringWrite(current), recurringWrite(next))) return false;
  layer.enqueue({
    opId: newId(), by: ctx.uid, table: 'recurring', op: 'upsert', isNew: false, row: next, input: null,
    columns: Object.keys(change) as RecurringColumn[],
  });
  return true;
}

/** REC-1: pause (nothing posts while paused; nothing is deleted). True when something changed. */
export function pauseRecurring(id: string, layer = activeDataLayer()): boolean {
  return changeRecurring(id, { active: false }, layer);
}

/**
 * REC-1: resume. The server skips what fell due while it was paused (recurring_guard: every occurrence before the UK
 * today); the phone's waiting copy shows the same count, so nothing past looks due before the server answers. Only
 * `active` is sent (posted_count is the server's).
 */
export function resumeRecurring(id: string, layer = activeDataLayer()): boolean {
  const current = shown<RecurringRow>(layer, 'recurring').find((r) => r.id === id);
  if (!current || current.active) return changeRecurring(id, { active: true }, layer);
  const schedule = { frequency: current.frequency as 'weekly' | 'monthly' | 'yearly', every: current.every, startDate: current.start_date, endDate: null };
  const today = layer.today();
  let skipped = current.posted_count;
  for (let n = 0; n < 10000 && occurrence(schedule, skipped) < today; n += 1) skipped += 1;
  return changeRecurring(id, { active: true }, layer, { posted_count: skipped });
}

/** REC-1: end on a day (today unless told); the template and its history stay. */
export function endRecurring(id: string, endDate?: IsoDate, layer = activeDataLayer()): boolean {
  return changeRecurring(id, { end_date: endDate ?? layer.today() }, layer);
}

/**
 * INB-2 Keep: saves the bill as an entry (carrying its template and occurrence, at home, in no chapter, so the
 * database refuses a second keep of the same bill from the other phone), then marks the item kept with the
 * entry's id. Returns the entry's id. A second tap records nothing more.
 */
export function keepInboxItem(itemId: string, input: ExpenseDraft & { id?: string }, layer = activeDataLayer()): string {
  const { id, ...draft } = input;
  const ctx = context(layer);
  const item = shown<InboxItemRow>(layer, 'inbox_items').find((i) => i.id === itemId);
  if (!item) throw new EntryNotFoundError(itemId);
  if (item.status !== 'open') return item.expense_id ?? id ?? '';
  if (id !== undefined && knownRow(layer, 'expenses', id)) return id;
  // S9a review (INB-2): a bill kept and then taken back (Undo) left its entry deleted, still holding the bill's
  // occurrence (one entry per occurrence, deleted ones too): keeping it again brings that entry back, as now kept.
  const earlier = item.expense_id === null ? undefined : layer.entries().find((e) => e.id === item.expense_id && e.deleted_at !== null);
  const built = expenseRowFor(ctx, draft);
  const home = layer.household()?.home_country ?? 'GB';
  // A regular bill is at home and in no chapter (REC-4, PLC-5); a receipt sorted later (SCAN-4) keeps what was chosen.
  const bill = item.source !== 'scan';
  const row: ExpenseRow = {
    ...built.row, id: earlier?.id ?? id ?? built.row.id, source: item.recurring_id ? 'recurring' : item.source === 'scan' ? 'scan' : built.row.source,
    recurring_id: item.recurring_id, occurrence_date: item.occurrence_date,
    ...(bill ? { country: home, chapter_id: null } : {}),
  };
  layer.enqueue({ opId: newId(), by: ctx.uid, table: 'expenses', op: 'upsert', isNew: earlier === undefined, ...built, row });
  if (earlier) layer.enqueue({ opId: newId(), by: ctx.uid, table: 'expenses', op: 'patch', id: row.id, patch: { deleted_at: null }, label: expenseLabel(row) });
  layer.enqueue({ opId: newId(), by: ctx.uid, table: 'inbox_items', op: 'patch', id: item.id, patch: { status: 'kept', expense_id: row.id }, label: row.description });
  return row.id;
}

/**
 * INB-2, REC-3 (S9a review): Undo of a bill kept in one tap ("Usually £90.00"): its entry is deleted (soft, logged) and
 * the bill waits in the Inbox again, still knowing that entry (a second Keep brings it back). True when something changed.
 */
export function unkeepInboxItem(itemId: string, layer = activeDataLayer()): boolean {
  const ctx = context(layer);
  const item = shown<InboxItemRow>(layer, 'inbox_items').find((i) => i.id === itemId);
  if (!item) throw new EntryNotFoundError(itemId);
  if (item.status !== 'kept' || item.expense_id === null) return false;
  deleteExpense(item.expense_id, layer);
  const payload = item.payload as { description?: unknown } | null;
  const label = typeof payload?.description === 'string' ? payload.description : '';
  layer.enqueue({ opId: newId(), by: ctx.uid, table: 'inbox_items', op: 'patch', id: item.id, patch: { status: 'open', expense_id: item.expense_id }, label });
  return true;
}

/** INB-2 Not ours: dismissed, no entry. True when something changed. */
export function dismissInboxItem(itemId: string, layer = activeDataLayer()): boolean {
  const ctx = context(layer);
  const item = shown<InboxItemRow>(layer, 'inbox_items').find((i) => i.id === itemId);
  if (!item) throw new EntryNotFoundError(itemId);
  if (item.status !== 'open') return false;
  const payload = item.payload as { description?: unknown } | null;
  const label = typeof payload?.description === 'string' ? payload.description : '';
  layer.enqueue({ opId: newId(), by: ctx.uid, table: 'inbox_items', op: 'patch', id: item.id, patch: { status: 'dismissed', expense_id: null }, label });
  return true;
}

/** INB-2 (S9a): Undo of "Not ours": the item waits in the Inbox again. True when something changed. */
export function reopenInboxItem(itemId: string, layer = activeDataLayer()): boolean {
  const ctx = context(layer);
  const item = shown<InboxItemRow>(layer, 'inbox_items').find((i) => i.id === itemId);
  if (!item) throw new EntryNotFoundError(itemId);
  if (item.status !== 'dismissed') return false;
  const payload = item.payload as { description?: unknown } | null;
  const label = typeof payload?.description === 'string' ? payload.description : '';
  layer.enqueue({ opId: newId(), by: ctx.uid, table: 'inbox_items', op: 'patch', id: item.id, patch: { status: 'open', expense_id: null }, label });
  return true;
}

function enqueueCategory(layer: DataLayer, uid: string, current: CategoryRow | undefined, next: CategoryRow): boolean {
  if (current && sameJson(categoryWrite(current), categoryWrite(next))) return false;
  layer.enqueue({ opId: newId(), by: uid, table: 'categories', op: 'upsert', isNew: current === undefined, row: next, input: null });
  return true;
}

/** CAT-1: adds a category (last in the order) or, with an id, renames / re-emojis / recolours it. */
export function saveCategory(input: CategoryDraft & { id?: string }, layer = activeDataLayer()): string {
  const { id, ...draft } = input;
  const ctx = context(layer);
  const reasons: InvalidReason[] = [];
  if (draft.name.trim() === '') reasons.push('name');
  if (!(CATEGORY_COLOURS as readonly string[]).includes(draft.colour)) reasons.push('colour');
  if (reasons.length > 0) throw new EntryInvalidError(reasons);
  const all = shown<CategoryRow>(layer, 'categories');
  const current = id === undefined ? undefined : all.find((c) => c.id === id);
  const next: CategoryRow = {
    id: id ?? newId(), household_id: ctx.hid, name: draft.name.trim(), emoji: draft.emoji.trim(), colour: draft.colour,
    archived: current?.archived ?? false, sort: current?.sort ?? Math.max(0, ...all.map((c) => c.sort)) + 1,
    default_ratio: current?.default_ratio ?? null, updated_at: layer.now().toISOString(),
  };
  enqueueCategory(layer, ctx.uid, current, next);
  return next.id;
}

/** CAT-1: archive (its entries keep it) or bring back. True when something changed. */
export function archiveCategory(id: string, archived = true, layer = activeDataLayer()): boolean {
  const ctx = context(layer);
  const current = shown<CategoryRow>(layer, 'categories').find((c) => c.id === id);
  if (!current) throw new EntryNotFoundError(id);
  return enqueueCategory(layer, ctx.uid, current, { ...current, archived, updated_at: layer.now().toISOString() });
}

/** CAT-1: the categories in this order (only the ones that moved are written). */
export function reorderCategories(ids: readonly string[], layer = activeDataLayer()): void {
  const ctx = context(layer);
  const all = shown<CategoryRow>(layer, 'categories');
  ids.forEach((id, i) => {
    const current = all.find((c) => c.id === id);
    if (current && current.sort !== i + 1) enqueueCategory(layer, ctx.uid, current, { ...current, sort: i + 1, updated_at: layer.now().toISOString() });
  });
}

// ───────── S4a: chapters (CHP-1…CHP-3) ─────────

export interface ChapterDraft {
  name: string; emoji: string; kind: 'trip' | 'project'; country: string | null; startDate: IsoDate | null; endDate: IsoDate | null;
}

/** Queues a chapter write; for an existing chapter only the columns that changed are sent (a stale phone never undoes the partner's edit). */
function enqueueChapter(layer: DataLayer, uid: string, current: ChapterRow | undefined, next: ChapterRow): boolean {
  const before = current ? chapterWrite(current) : null;
  const after = chapterWrite(next);
  const columns = before
    ? (Object.keys(after) as (keyof ChapterWrite)[]).filter((k): k is ChapterColumn => k !== 'id' && k !== 'household_id' && !sameJson(before[k], after[k]))
    : [];
  if (before && columns.length === 0) return false;
  layer.enqueue({ opId: newId(), by: uid, table: 'chapters', op: 'upsert', isNew: current === undefined, row: next, input: null, ...(before ? { columns } : {}) });
  return true;
}

/** CHP-1: starts a chapter or (with an id) edits one; returns its id at once. Saved through the queue, offline too. */
export function saveChapter(input: ChapterDraft & { id?: string }, layer = activeDataLayer()): string {
  const { id, ...draft } = input;
  const ctx = context(layer);
  const reasons: InvalidReason[] = [];
  const name = draft.name.trim();
  if (name.length < 1 || name.length > 40) reasons.push('chapterName');
  if ((draft.startDate !== null && !isIsoDate(draft.startDate)) || (draft.endDate !== null && !isIsoDate(draft.endDate))
    || (draft.startDate !== null && draft.endDate !== null && draft.endDate < draft.startDate)) reasons.push('chapterDates');
  if (reasons.length > 0) throw new EntryInvalidError(reasons);
  const current = id === undefined ? undefined : shown<ChapterRow>(layer, 'chapters').find((c) => c.id === id);
  const stamp = layer.now().toISOString();
  const country = draft.kind === 'trip' && draft.country !== null && /^[A-Za-z]{2}$/.test(draft.country) ? draft.country.toUpperCase() : null;
  const next: ChapterRow = {
    id: id ?? newId(), household_id: ctx.hid, name, emoji: draft.emoji.trim() === '' ? (draft.kind === 'trip' ? '🧳' : '🌿') : draft.emoji.trim(),
    kind: draft.kind, country, start_date: draft.startDate, end_date: draft.endDate, closed: current?.closed ?? false,
    created_by: current?.created_by ?? ctx.uid, created_at: current?.created_at ?? stamp, updated_at: stamp,
  };
  enqueueChapter(layer, ctx.uid, current, next);
  return next.id;
}

/** CHP-3: close a chapter when it is done (or reopen it). Never deleted. True when something changed. */
export function closeChapter(id: string, closed = true, layer = activeDataLayer()): boolean {
  const ctx = context(layer);
  const current = shown<ChapterRow>(layer, 'chapters').find((c) => c.id === id);
  if (!current) throw new EntryNotFoundError(id);
  const changed = enqueueChapter(layer, ctx.uid, current, { ...current, closed, updated_at: layer.now().toISOString() });
  if (closed && currentChapterId() === id) setCurrentChapter(null);
  return changed;
}

// CHP-2: the chapter new entries go into, per phone (each person sets their own; it never changes the other phone).
const CURRENT_KEY = 'smsm-current-chapter';
const currentListeners = new Set<() => void>();

export function currentChapterId(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

export function setCurrentChapter(id: string | null): void {
  try {
    if (id === null) localStorage.removeItem(CURRENT_KEY);
    else localStorage.setItem(CURRENT_KEY, id);
  } catch {
    /* no storage: nothing is current */
  }
  for (const l of currentListeners) l();
}

export function subscribeCurrentChapter(cb: () => void): () => void {
  currentListeners.add(cb);
  const onStorage = (e: StorageEvent) => { if (e.key === CURRENT_KEY) cb(); };
  window.addEventListener('storage', onStorage);
  return () => { currentListeners.delete(cb); window.removeEventListener('storage', onStorage); };
}

/** The current chapter's id when it is still there and open, else null (a closed or gone chapter is never current). */
export function currentOpenChapter(layer = activeDataLayer()): string | null {
  const id = currentChapterId();
  if (id === null) return null;
  const c = shown<ChapterRow>(layer, 'chapters').find((x) => x.id === id);
  return c && !c.closed ? id : null;
}

// ───────── S4b: where this phone is, and the day's rate (PLC-2, PLC-3, PLC-6) ─────────

/** PLC-3: this phone's current country (the household's home country unless set). */
export function currentCountry(layer = activeDataLayer()): string {
  return storedCountry() ?? homeCountry(layer);
}

export function homeCountry(layer = activeDataLayer()): string {
  return layer.household()?.home_country ?? 'GB';
}

/** PLC-3: "We're in Japan" (null or the home country: home). Per phone; never sent to the server. */
export function setCurrentCountry(code: string | null, layer = activeDataLayer()): void {
  setStoredCountry(code === null || code.toUpperCase() === homeCountry(layer) ? null : code);
}

/** PLC-2: use the phone's location for new entries and trip suggestions (per phone; off until turned on). */
export function setUseLocation(on: boolean): void {
  setStoredUseLocation(on);
}

/** PLC-2: lets the browser ask for location (only from the Settings switch). True when it was allowed. */
export async function askLocation(layer = activeDataLayer()): Promise<boolean> {
  try {
    await layer.geo.position({ prompt: true, timeoutMs: 30000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * PLC-2: where the phone is now, rounded to about 100 m, with the country and town when online; null when location
 * is off, not allowed, or slower than 4 s. `prompt` lets the browser ask (only when the person turns it on).
 */
export async function locate(opts: { prompt?: boolean; timeoutMs?: number } | DataLayer = {}, given?: DataLayer): Promise<Located | null> {
  // `locate(layer)` as well as `locate(opts, layer)`.
  const layer = given ?? ('client' in opts ? opts : activeDataLayer());
  if ('client' in opts) opts = {};
  if (!storedUseLocation() && opts.prompt !== true) return null;
  return locateWith(layer.geo, { ...opts, online: layer.network.online });
}

/** PLC-6, OFF-4: the day's rate (pounds per unit) for a currency; offline, the last one known (`stale`). */
export async function rateFor(currency: string, date?: string, layer = activeDataLayer()) {
  return rateWith(layer.rates, currency.toUpperCase(), { online: layer.network.online, today: layer.today(), ...(date ? { date } : {}) });
}

// ───────── S5b: comments (ACT-4) and the settle day (SET-4) ─────────

function commentsShown(layer: DataLayer): CommentRow[] {
  const uid = layer.me() ?? '';
  return overlay(layer.client.getQueryData<CommentRow[]>(keys.comments(uid)) ?? [], layer.waiting(), 'comments');
}

const COMMENT_MAX = 500;

/** ACT-4: adds a comment to an entry; returns its id at once (saved through the queue, offline too). */
export function addComment(expenseId: string, body: string, layer = activeDataLayer()): string {
  const ctx = context(layer);
  const text = body.trim();
  if (text.length < 1 || text.length > COMMENT_MAX) throw new EntryInvalidError(['comment']);
  const row: CommentRow = {
    id: newId(), household_id: ctx.hid, expense_id: expenseId, author: ctx.uid, body: text, created_at: layer.now().toISOString(), deleted_at: null,
  };
  layer.enqueue({ opId: newId(), by: ctx.uid, table: 'comments', op: 'upsert', isNew: true, row, input: null });
  return row.id;
}

function changeComment(id: string, change: Partial<Pick<CommentRow, 'body' | 'deleted_at'>>, layer: DataLayer): boolean {
  const ctx = context(layer);
  const current = commentsShown(layer).find((c) => c.id === id);
  if (!current) throw new EntryNotFoundError(id);
  // Only the author changes a comment (the database refuses anyone else too).
  if (current.author !== ctx.uid) throw new EntryInvalidError(['notYours']);
  const next: CommentRow = { ...current, ...change };
  const columns = (Object.keys(change) as CommentColumn[]).filter((k) => next[k] !== current[k]);
  if (columns.length === 0) return false;
  layer.enqueue({ opId: newId(), by: ctx.uid, table: 'comments', op: 'upsert', isNew: false, row: next, input: null, columns });
  return true;
}

/** ACT-4: the author edits their comment. True when something changed. */
export function editComment(id: string, body: string, layer = activeDataLayer()): boolean {
  const text = body.trim();
  if (text.length < 1 || text.length > COMMENT_MAX) throw new EntryInvalidError(['comment']);
  return changeComment(id, { body: text }, layer);
}

/** ACT-4: the author deletes their comment (kept, marked deleted). True when something changed. */
export function deleteComment(id: string, layer = activeDataLayer()): boolean {
  return changeComment(id, { deleted_at: layer.now().toISOString() }, layer);
}

/** ACT-4: Undo after deleting: the author brings their comment back. True when something changed. */
export function restoreComment(id: string, layer = activeDataLayer()): boolean {
  return changeComment(id, { deleted_at: null }, layer);
}

/** SET-4: the household's settle day (1–28) or null for off. Needs a connection. */
export async function setSettleDay(day: number | null, layer = activeDataLayer()): Promise<void> {
  if (day !== null && (!Number.isInteger(day) || day < 1 || day > 28)) throw new EntryInvalidError(['settleDay']);
  await online(layer, () => layer.api.setSettleDay(day));
  await layer.refresh();
}
