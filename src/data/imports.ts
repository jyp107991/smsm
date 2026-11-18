/**
 * S7 (IMP-1, IMP-3, EXP-1, EXP-3, INB-1, OFF-3): bank statements in, entries out, backups back in.
 *
 * Import. The phone reads the file (src/core/csv.ts); the rows that are spending become cards that wait on THIS
 * phone only (IndexedDB "smsm-import"), never in the database, until each is decided in the Inbox:
 *   - Keep: an entry at once (the household's default split, paid by the person importing: it is their statement),
 *     marked with its source and the bank's id, so the expenses_external index stops it ever being imported twice;
 *   - Not ours: only sha256(household:source:bank id) is written to import_ignores; the row itself is forgotten.
 * A row is never offered when its hash is ignored, an entry (deleted ones too) already has its bank id, or it is
 * already waiting here. "Always do this for …" makes a rule (import_rules, by the normalised description) that
 * the next import applies by itself. Every write goes through the persisted queue, so all of it works offline.
 *
 * Export. The entries CSV is made from the phone's copy (offline too). The JSON backup is backup.ts; restoring it
 * goes to restore_backup in chunks of at most 500 rows, which only ever adds.
 */
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { createStore, del, get, set, type UseStore } from 'idb-keyval';
import { z } from 'zod';
import { exportCsv, type BankRow, type ExportEntry, type ExportSettlement, type ImportSource, type Named } from '../core/csv';
import type { IsoDate } from '../core/dates';
import { pence, type Pence } from '../core/money';
import type { SplitParams, UserId } from '../core/split';
import { normaliseKey } from '../core/text';
import type { CategoryRow, ChapterRow, CommentRow, ImportIgnoreRow, ImportRuleRow, RecurringRow, RestoreCounts, RestoreRows, RestoreTable } from './api';
import type { Json } from './database.types';
import { activeDataLayer } from './context';
import { useCategories, useCategoryMemory, useDataLayer, useHousehold, useImportRules, useSession } from './hooks';
import { toInsight, toSettle } from './insightRows';
import { keys } from './keys';
import {
  addImportedExpense, deleteExpense, EntryNotFoundError, NotInHouseholdError, NotReadyError, NotSignedInError, OfflineError,
} from './mutations';
import type { DataLayer } from './queryClient';
import { memoryMap, memorySplit } from './rows';
import { completeSplit, defaultRatioOf, newId, overlay, overlayIgnores, overlayRules, PartnerNotJoinedError, type ExpenseDraft } from './writes';
import type { Memory } from '../core/categorise';

export type { BankRow, ImportSource };

/** A bank row waiting on this phone to be decided (never sent anywhere as it is). */
export interface ImportCard {
  /** Names the waiting row on this phone. */
  id: string;
  source: ImportSource;
  bankId: string;
  date: IsoDate;
  description: string;
  amount: Pence;
  note: string | null;
  /** A keep rule's, else learned memory, else the bank's category when it is one of ours by name, else none. */
  categoryId: string | null;
}

/** What an import would do (previewImport) or did (startImport). */
export interface ImportCounts {
  /** Rows now waiting as Inbox cards. */
  offered: number;
  /** Rows a rule kept (entries made) or skipped (hash written). */
  rules: { keep: number; skip: number };
  /** Rows already decided or already waiting. */
  already: number;
}

// ───────────────────────────── where waiting rows live ─────────────────────────────

const waitingSchema = z.object({
  id: z.string(), source: z.enum(['monzo', 'csv']), bankId: z.string(), hash: z.string(), date: z.string(), description: z.string(),
  amount: z.number().int().positive(), note: z.string().nullable(), categoryHint: z.string().nullable(),
});
type Waiting = z.infer<typeof waitingSchema>;

let idbStore: UseStore | null | undefined;
/** Rows kept in memory when the browser has no IndexedDB (tests without it; a locked-down browser). */
const fallback = new Map<string, Waiting[]>();
function store(): UseStore | null {
  if (idbStore === undefined) {
    try {
      idbStore = createStore('smsm-import', 'rows');
    } catch {
      idbStore = null;
    }
  }
  return idbStore;
}

interface ImportState {
  key: string;
  rows: readonly Waiting[];
  ready: boolean;
  loaded: Promise<void>;
  /** "Not ours" this session, for Undo: the row (in memory only) and the rule it made. */
  skipped: Map<string, { row: Waiting; ruleId: string | null }>;
  /** Keep this session, for Undo: the rule it made. */
  kept: Map<string, { ruleId: string | null }>;
  listeners: Set<() => void>;
  saving: Promise<void>;
}

const states = new WeakMap<DataLayer, Map<string, ImportState>>();

function stateOf(layer: DataLayer, key: string): ImportState {
  let byKey = states.get(layer);
  if (!byKey) {
    byKey = new Map();
    states.set(layer, byKey);
  }
  const found = byKey.get(key);
  if (found) return found;
  const st: ImportState = {
    key, rows: [], ready: false, loaded: Promise.resolve(), skipped: new Map(), kept: new Map(), listeners: new Set(), saving: Promise.resolve(),
  };
  st.loaded = (async () => {
    let raw: unknown;
    try {
      const s = store();
      raw = s ? await get(key, s) : fallback.get(key);
    } catch {
      raw = fallback.get(key);
    }
    const parsed = z.array(waitingSchema).safeParse(raw ?? []);
    // Anything written meanwhile (a fast first import) comes after what was stored.
    st.rows = [...(parsed.success ? parsed.data : []), ...st.rows];
    st.ready = true;
    notify(st);
  })();
  byKey.set(key, st);
  return st;
}

function notify(st: ImportState): void {
  for (const l of st.listeners) l();
}

function save(st: ImportState): Promise<void> {
  const rows = [...st.rows];
  st.saving = st.saving.then(async () => {
    try {
      const s = store();
      if (!s) fallback.set(st.key, rows);
      else if (rows.length === 0) await del(st.key, s);
      else await set(st.key, rows, s);
    } catch {
      fallback.set(st.key, rows);
    }
  });
  return st.saving;
}

function change(st: ImportState, rows: readonly Waiting[]): Promise<void> {
  st.rows = rows;
  notify(st);
  return save(st);
}

interface Ctx { uid: string; hid: string; st: ImportState; layer: DataLayer }

function ctxOf(layer: DataLayer): Ctx {
  if (!layer.isReady()) throw new NotReadyError();
  const uid = layer.me();
  if (!uid) throw new NotSignedInError();
  const hid = layer.householdId();
  if (!hid) throw new NotInHouseholdError();
  return { uid, hid, st: stateOf(layer, `${hid}:${uid}`), layer };
}

async function loadedCtx(layer: DataLayer): Promise<Ctx> {
  await layer.ready;
  const ctx = ctxOf(layer);
  await ctx.st.loaded;
  return ctx;
}

// ───────────────────────────── what is already decided ─────────────────────────────

/** IMP-3: lower-case hex sha256 of "household:source:bank id" (UTF-8), with Web Crypto (works offline). */
export async function idHash(householdId: string, source: ImportSource, bankId: string): Promise<string> {
  const text = `${householdId}:${source}:${bankId}`;
  const known = hashes.get(text);
  if (known !== undefined) return known;
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
  hashes.set(text, hex);
  return hex;
}
/**
 * Hashes worked out already (the summary before "Import N rows" works out every row's), so the import itself, and
 * a second import of the same file, don't wait on Web Crypto again. Only ids this phone has read; not stored.
 */
const hashes = new Map<string, string>();

function cached<R>(layer: DataLayer, key: readonly unknown[]): R[] {
  return layer.client.getQueryData<R[]>(key) ?? [];
}

function rulesOf(layer: DataLayer, uid: string): ImportRuleRow[] {
  return overlayRules(cached<ImportRuleRow>(layer, keys.importRules(uid)), layer.waiting());
}

function usable(categories: readonly CategoryRow[], id: string | null): string | null {
  return id !== null && categories.some((c) => c.id === id && !c.archived) ? id : null;
}

function ruleFor(rules: readonly ImportRuleRow[], description: string): ImportRuleRow | undefined {
  const key = normaliseKey(description);
  return rules.find((r) => r.match_text === key);
}

/** The card's category (IMP-3): a keep rule's, else learned memory, else the bank's category by name, else none. */
function categoryFor(
  w: Pick<Waiting, 'description' | 'categoryHint'>,
  ctx: { rules: readonly ImportRuleRow[]; memory: ReadonlyMap<string, Memory>; categories: readonly CategoryRow[] },
): string | null {
  const rule = ruleFor(ctx.rules, w.description);
  const byRule = rule?.decision === 'keep' ? usable(ctx.categories, rule.category_id) : null;
  if (byRule) return byRule;
  const remembered = usable(ctx.categories, ctx.memory.get(normaliseKey(w.description))?.categoryId ?? null);
  if (remembered) return remembered;
  if (w.categoryHint === null) return null;
  const hint = normaliseKey(w.categoryHint);
  return ctx.categories.find((c) => !c.archived && normaliseKey(c.name) === hint)?.id ?? null;
}

function cardOf(w: Waiting, ctx: Parameters<typeof categoryFor>[1]): ImportCard {
  return {
    id: w.id, source: w.source, bankId: w.bankId, date: w.date, description: w.description, amount: pence(w.amount), note: w.note,
    categoryId: categoryFor(w, ctx),
  };
}

function byDate(rows: readonly Waiting[]): Waiting[] {
  return rows.map((r, i) => ({ r, i })).sort((x, y) => (x.r.date < y.r.date ? -1 : x.r.date > y.r.date ? 1 : x.i - y.i)).map((x) => x.r);
}

function categoryContext(layer: DataLayer, uid: string) {
  return {
    rules: rulesOf(layer, uid),
    memory: memoryMap(layer.memory()),
    categories: overlay(cached<CategoryRow>(layer, keys.categories(uid)), layer.waiting(), 'categories'),
  };
}

interface Sorted {
  offer: Waiting[];
  keep: { row: Waiting; rule: ImportRuleRow }[];
  skip: Waiting[];
  already: number;
}

async function sortRows(ctx: Ctx, rows: readonly BankRow[], source: ImportSource): Promise<Sorted> {
  const { layer, uid, hid, st } = ctx;
  const ignored = overlayIgnores(cached<ImportIgnoreRow>(layer, keys.importIgnores(uid)), layer.waiting());
  const rules = rulesOf(layer, uid);
  const imported = new Set(layer.entries().filter((e) => e.source === source && e.external_id !== null).map((e) => e.external_id));
  const seen = new Set(st.rows.filter((r) => r.source === source).map((r) => r.bankId));
  const out: Sorted = { offer: [], keep: [], skip: [], already: 0 };
  for (const row of rows) {
    if (seen.has(row.bankId) || imported.has(row.bankId)) {
      out.already += 1;
      continue;
    }
    seen.add(row.bankId);
    const hash = await idHash(hid, source, row.bankId);
    if (ignored.has(`${source}:${hash}`)) {
      out.already += 1;
      continue;
    }
    const w: Waiting = {
      id: `${source}:${row.bankId}`, source, bankId: row.bankId, hash, date: row.date, description: row.description, amount: row.amount,
      note: row.note, categoryHint: row.categoryHint,
    };
    const rule = ruleFor(rules, row.description);
    if (rule?.decision === 'skip') out.skip.push(w);
    else if (rule?.decision === 'keep') out.keep.push({ row: w, rule });
    else out.offer.push(w);
  }
  return out;
}

const counts = (s: Sorted): ImportCounts => ({ offered: s.offer.length, rules: { keep: s.keep.length, skip: s.skip.length }, already: s.already });

/** IMP-3: what `startImport` would do with these rows, from the phone's copy, writing nothing anywhere. */
export async function previewImport(rows: readonly BankRow[], source: ImportSource, layer = activeDataLayer()): Promise<ImportCounts> {
  return counts(await sortRows(await loadedCtx(layer), rows, source));
}

/**
 * IMP-1, IMP-3, INB-1: the rows go to this phone's Inbox as cards, after what is already decided is dropped and
 * the household's rules are applied (a skip rule writes the hash; a keep rule keeps the row at once).
 */
export async function startImport(rows: readonly BankRow[], source: ImportSource, layer = activeDataLayer()): Promise<ImportCounts> {
  const ctx = await loadedCtx(layer);
  if (layer.network.online) {
    // The latest decisions (the other phone may have imported the same statement): the phone's copy otherwise.
    await Promise.all([
      layer.client.refetchQueries({ queryKey: keys.importIgnores(ctx.uid), exact: true }),
      layer.client.refetchQueries({ queryKey: keys.importRules(ctx.uid), exact: true }),
    ]).catch(() => undefined);
  }
  const sorted = await sortRows(ctx, rows, source);
  const cats = categoryContext(layer, ctx.uid);
  for (const w of sorted.skip) ignore(ctx, w);
  for (const { row, rule } of sorted.keep) {
    keepRow(ctx, row, { categoryId: usable(cats.categories, rule.category_id) ?? categoryFor(row, cats), split: memorySplit(rule) ?? undefined });
  }
  if (sorted.offer.length > 0) await change(ctx.st, [...ctx.st.rows, ...sorted.offer]);
  return counts(sorted);
}

/** INB-1: the rows waiting on this phone, in date order. */
export async function importQueue(layer = activeDataLayer()): Promise<ImportCard[]> {
  const ctx = await loadedCtx(layer);
  const cats = categoryContext(layer, ctx.uid);
  return byDate(ctx.st.rows).map((w) => cardOf(w, cats));
}

// ───────────────────────────── deciding a card ─────────────────────────────

function ignore(ctx: Ctx, w: Waiting): void {
  const row: ImportIgnoreRow = { household_id: ctx.hid, source: w.source, id_hash: w.hash };
  ctx.layer.enqueue({ opId: newId(), by: ctx.uid, table: 'import_ignores', op: 'insert', id: w.hash, row, label: w.source });
}

function splitRule(split: SplitParams): Pick<ImportRuleRow, 'split_mode' | 'split_params'> {
  if (split.mode === 'treat' || split.mode === 'for_other') return { split_mode: split.mode, split_params: null };
  // A ratio is kept as each person's percentage; exact amounts belong to one entry, so the default is used next time.
  if (split.mode === 'ratio' && Object.keys(split.ratio).length === 2) return { split_mode: 'ratio', split_params: { ...split.ratio } };
  return { split_mode: null, split_params: null };
}

function makeRule(ctx: Ctx, description: string, decision: 'keep' | 'skip', categoryId: string | null, split: SplitParams | null): string | null {
  const match = normaliseKey(description);
  if (match === '') return null;
  const existing = rulesOf(ctx.layer, ctx.uid).find((r) => r.match_text === match);
  const row: ImportRuleRow = {
    id: existing?.id ?? newId(), household_id: ctx.hid, match_text: match, decision, category_id: decision === 'keep' ? categoryId : null,
    ...(decision === 'keep' && split ? splitRule(split) : { split_mode: null, split_params: null }),
    created_at: existing?.created_at ?? ctx.layer.now().toISOString(),
  };
  ctx.layer.enqueue({ opId: newId(), by: ctx.uid, table: 'import_rules', op: 'upsert', isNew: existing === undefined, row, input: null });
  return row.id;
}

/** The entry a bank row becomes: its values, the household's default split, paid by the person importing. */
function keepRow(ctx: Ctx, w: Waiting, opts: Partial<ExpenseDraft> & { id?: string }): { id: string; draft: ExpenseDraft } {
  const { layer, uid } = ctx;
  const { id: rowId, ...given } = opts;
  const home = layer.household()?.home_country ?? 'GB';
  const draft: ExpenseDraft = {
    kind: 'expense', description: w.description, amount: pence(w.amount), date: w.date, categoryId: null, payer: uid,
    // A ratio naming nobody is the household's default once both people are known (completeSplit).
    split: { mode: 'ratio', ratio: {} }, notes: w.note, chapterId: null, country: home,
    ...Object.fromEntries(Object.entries(given as Record<string, unknown>).filter(([, v]) => v !== undefined)),
  };
  const id = addImportedExpense({ ...draft, ...(rowId === undefined ? {} : { id: rowId }) }, { source: w.source, externalId: w.bankId }, layer);
  // The split as it was used (the household's default filled in), for a rule made from this keep.
  const [a, b] = layer.members();
  const split = a && b ? completeSplit(draft.split, [a.user_id, b.user_id], defaultRatioOf(layer.household())) : draft.split;
  return { id, draft: { ...draft, split } };
}

function take(st: ImportState, id: string): Waiting {
  const w = st.rows.find((r) => r.id === id);
  if (!w) throw new EntryNotFoundError(id);
  return w;
}

/**
 * IMP-3 Keep, at once (the Inbox card and Change first): the entry is made with the card's values over `opts`;
 * `always` makes a keep rule with the category and split used. Throws NotReadyError until the rows are read.
 */
export function keepImportNow(id: string, opts: Partial<ExpenseDraft> & { always?: boolean; id?: string } = {}, layer = activeDataLayer()): string {
  const ctx = ctxOf(layer);
  if (!ctx.st.ready) throw new NotReadyError();
  const { always = false, ...given } = opts;
  const w = take(ctx.st, id);
  const cats = categoryContext(layer, ctx.uid);
  const { id: entryId, draft } = keepRow(ctx, w, { categoryId: categoryFor(w, cats), ...given });
  const ruleId = always ? makeRule(ctx, w.description, 'keep', draft.categoryId, draft.split) : null;
  ctx.st.kept.set(entryId, { ruleId });
  void change(ctx.st, ctx.st.rows.filter((r) => r.id !== id));
  return entryId;
}

/** IMP-3 Keep: adds the entry (see keepImportNow) and returns its id. */
export async function keepImport(id: string, opts: Partial<ExpenseDraft> & { always?: boolean; id?: string } = {}, layer = activeDataLayer()): Promise<string> {
  const ctx = await loadedCtx(layer);
  const entryId = keepImportNow(id, opts, layer);
  await ctx.st.saving;
  return entryId;
}

/** Undo of Keep: the entry is deleted (soft: it stays in history, so the row is not offered again) and its rule goes. */
export function undoKeep(entryId: string, layer = activeDataLayer()): boolean {
  const ctx = ctxOf(layer);
  const made = ctx.st.kept.get(entryId);
  ctx.st.kept.delete(entryId);
  if (made?.ruleId) removeImportRule(made.ruleId, layer);
  return deleteExpense(entryId, layer);
}

/** IMP-3 Not ours, at once: only the hash is written (and a skip rule with `always`); the row is forgotten. */
export function skipImportNow(id: string, opts: { always: boolean }, layer = activeDataLayer()): void {
  const ctx = ctxOf(layer);
  if (!ctx.st.ready) throw new NotReadyError();
  const w = take(ctx.st, id);
  ignore(ctx, w);
  const ruleId = opts.always ? makeRule(ctx, w.description, 'skip', null, null) : null;
  ctx.st.skipped.set(id, { row: w, ruleId });
  void change(ctx.st, ctx.st.rows.filter((r) => r.id !== id));
}

export async function skipImport(id: string, opts: { always: boolean }, layer = activeDataLayer()): Promise<void> {
  const ctx = await loadedCtx(layer);
  skipImportNow(id, opts, layer);
  await ctx.st.saving;
}

/** Undo of Not ours: the hash (and the rule it made) are taken away and the card comes back. */
export async function undoSkip(id: string, layer = activeDataLayer()): Promise<void> {
  const ctx = await loadedCtx(layer);
  const made = ctx.st.skipped.get(id);
  if (!made) return;
  ctx.st.skipped.delete(id);
  const { row } = made;
  ctx.layer.enqueue({
    opId: newId(), by: ctx.uid, table: 'import_ignores', op: 'delete', id: row.hash,
    row: { household_id: ctx.hid, source: row.source, id_hash: row.hash }, label: row.source,
  });
  if (made.ruleId) removeImportRule(made.ruleId, layer);
  if (!ctx.st.rows.some((r) => r.id === row.id)) await change(ctx.st, [...ctx.st.rows, row]);
}

/** IMP-3: forgets this phone's waiting rows, recording nothing (they are offered again next time). */
export async function stopReviewing(layer = activeDataLayer()): Promise<void> {
  const ctx = await loadedCtx(layer);
  ctx.st.skipped.clear();
  await change(ctx.st, []);
}

/** IMP-3: the household's rules, with waiting changes applied. */
export function importRules(layer = activeDataLayer()): ImportRuleRow[] {
  const uid = layer.me();
  return uid ? rulesOf(layer, uid) : [];
}

/** IMP-3: Settings → Import rules → Remove. */
export function removeImportRule(id: string, layer = activeDataLayer()): void {
  const uid = layer.me();
  if (!uid) throw new NotSignedInError();
  const rule = rulesOf(layer, uid).find((r) => r.id === id);
  layer.enqueue({ opId: newId(), by: uid, table: 'import_rules', op: 'delete', id, label: rule?.match_text ?? '' });
}

/** INB-1: the cards waiting on this phone, in date order (undefined until read); follows every change. */
export function useImportQueue(): ImportCard[] | undefined {
  const layer = useDataLayer();
  const session = useSession();
  const hid = useHousehold().data?.id ?? null;
  const uid = session.status === 'signed-in' ? session.userId : null;
  const st = uid && hid ? stateOf(layer, `${hid}:${uid}`) : null;
  const subscribe = useCallback((cb: () => void) => {
    if (!st) return () => undefined;
    st.listeners.add(cb);
    return () => { st.listeners.delete(cb); };
  }, [st]);
  const get = useCallback(() => (st?.ready ? st.rows : undefined), [st]);
  const rows = useSyncExternalStore(subscribe, get, get);
  const categories = useCategories().data;
  const memory = useCategoryMemory();
  const rules = useImportRules().data;
  return useMemo(
    () => rows && byDate(rows).map((w) => cardOf(w, { rules: rules ?? [], memory, categories: categories ?? [] })),
    [rows, rules, memory, categories],
  );
}

// ───────────────────────────── the entries CSV ─────────────────────────────

/** EXP-1, OFF-3: the entries and settle-ups dated in the range (both ends included), from the phone's copy. */
export function exportEntriesCsv(range: { from: IsoDate; to: IsoDate }, layer = activeDataLayer()): string {
  const uid = layer.me() ?? '';
  const members = layer.members();
  const [a, b] = members;
  if (!a || !b) throw new PartnerNotJoinedError();
  const people: readonly [Named, Named] = [{ id: a.user_id, name: a.display_name ?? '' }, { id: b.user_id, name: b.display_name ?? '' }];
  const named = (rows: readonly { id: string; name: string }[]): Named[] => rows.map((r) => ({ id: r.id, name: r.name }));
  const categories = named(overlay(cached<CategoryRow>(layer, keys.categories(uid)), layer.waiting(), 'categories'));
  const chapters = named(overlay(cached<ChapterRow>(layer, keys.chapters(uid)), layer.waiting(), 'chapters'));
  const entries: ExportEntry[] = layer.entries().map((e) => ({ ...toInsight(e), notes: e.notes }));
  const settlements: ExportSettlement[] = layer.settlements().map((s) => ({ ...toSettle(s), id: s.id, note: s.note }));
  return exportCsv(entries, settlements, people, categories, chapters, range);
}

// ───────────────────────────── restoring a backup ─────────────────────────────

export const RESTORE_CHUNK = 500;
const RESTORE_ORDER: readonly RestoreTable[] = ['categories', 'chapters', 'recurring', 'expenses', 'settlements', 'comments', 'category_memory', 'import_rules'];

export interface RestorePlan {
  format: 1 | 2;
  /** The backup's two people, as it names them. */
  people: { id: string; name: string }[];
  /** What restoring adds: rows already on this phone (by id; categories and rules by name) are not counted. */
  counts: { entries: number; settleUps: number; chapters: number; regular: number; comments: number; categories: number; rules: number };
  rows: Required<RestoreRows>;
}
export type RestoreRefusal = 'notBackup' | 'notTwo';

const objectRow = z.looseObject({ id: z.string() });
const backupSchema = z.looseObject({
  format: z.enum(['smsm-backup-1', 'smsm-backup-2']),
  members: z.array(z.looseObject({ user_id: z.string(), display_name: z.string().nullable().optional() })),
  expenses: z.array(objectRow),
  settlements: z.array(objectRow).optional(),
  categories: z.array(objectRow).optional(),
  chapters: z.array(objectRow).optional(),
  recurring: z.array(objectRow).optional(),
  comments: z.array(objectRow).optional(),
  category_memory: z.array(z.looseObject({ key: z.string() })).optional(),
  import_rules: z.array(z.looseObject({ match_text: z.string() })).optional(),
});

/** EXP-1: reads an smsm backup (format 1 or 2) and says what restoring it would add; anything else is refused. */
export function restorePlan(json: string, layer = activeDataLayer()): RestorePlan | { error: RestoreRefusal } {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return { error: 'notBackup' };
  }
  const parsed = backupSchema.safeParse(raw);
  if (!parsed.success) return { error: 'notBackup' };
  const b = parsed.data;
  if (b.members.length !== 2) return { error: 'notTwo' };
  const uid = layer.me() ?? '';
  const rows: Required<RestoreRows> = {
    categories: (b.categories ?? []) as Json[], chapters: (b.chapters ?? []) as Json[], recurring: (b.recurring ?? []) as Json[],
    expenses: b.expenses as Json[], settlements: (b.settlements ?? []) as Json[], comments: (b.comments ?? []) as Json[],
    category_memory: (b.category_memory ?? []) as Json[], import_rules: (b.import_rules ?? []) as Json[],
  };
  const newIds = (list: readonly { id: string }[], here: readonly { id: string }[]) => {
    const have = new Set(here.map((r) => r.id));
    return list.filter((r) => !have.has(r.id)).length;
  };
  const cats = cached<CategoryRow>(layer, keys.categories(uid));
  const catNames = new Set(cats.map((c) => normaliseKey(c.name)));
  const catIds = new Set(cats.map((c) => c.id));
  const ruleWords = new Set(rulesOf(layer, uid).map((r) => r.match_text));
  return {
    format: b.format === 'smsm-backup-1' ? 1 : 2,
    people: b.members.map((m) => ({ id: m.user_id, name: m.display_name ?? '' })),
    counts: {
      entries: newIds(b.expenses, layer.entries()),
      settleUps: newIds(b.settlements ?? [], layer.settlements()),
      chapters: newIds(b.chapters ?? [], cached<ChapterRow>(layer, keys.chapters(uid))),
      regular: newIds(b.recurring ?? [], cached<RecurringRow>(layer, keys.recurring(uid))),
      comments: newIds(b.comments ?? [], cached<CommentRow>(layer, keys.comments(uid))),
      categories: (b.categories ?? []).filter((c) => !catIds.has(c.id) && !catNames.has(normaliseKey(typeof c['name'] === 'string' ? c['name'] : ''))).length,
      rules: (b.import_rules ?? []).filter((r) => !ruleWords.has(r.match_text)).length,
    },
    rows,
  };
}

/** The rows in the order restore_backup needs (an entry before its money back and its comments), ≤ 500 a call. */
function chunks(rows: Required<RestoreRows>): RestoreRows[] {
  const out: RestoreRows[] = [];
  let current: RestoreRows = {};
  let n = 0;
  const ordered = (t: RestoreTable): Json[] => {
    if (t !== 'expenses') return rows[t];
    const kind = (r: Json) => (r && typeof r === 'object' && !Array.isArray(r) ? r['kind'] : null);
    const made = (r: Json): string => {
      const v = r && typeof r === 'object' && !Array.isArray(r) ? r['created_at'] : null;
      return typeof v === 'string' ? v : '';
    };
    return [...rows.expenses].sort((x, y) => Number(kind(x) === 'money_back') - Number(kind(y) === 'money_back') || made(x).localeCompare(made(y)));
  };
  for (const t of RESTORE_ORDER) {
    for (const r of ordered(t)) {
      (current[t] ??= []).push(r);
      n += 1;
      if (n === RESTORE_CHUNK) {
        out.push(current);
        current = {};
        n = 0;
      }
    }
  }
  if (n > 0) out.push(current);
  return out;
}

/**
 * EXP-1: restores the backup. It only adds: rows already here are left alone, nothing changes or is deleted;
 * regular payments come back paused. Needs a connection and both people; safe to repeat. `people` maps each of the
 * backup's people (by id) to one of this household's.
 */
export async function restoreBackup(plan: RestorePlan, people: Record<string, string>, layer = activeDataLayer()): Promise<RestoreCounts> {
  await layer.ready;
  if (!layer.network.online) throw new OfflineError();
  if (layer.members().length < 2) throw new PartnerNotJoinedError();
  const total: RestoreCounts = { added: {}, skipped: {} };
  for (const rows of chunks(plan.rows)) {
    const got = await layer.api.restoreBackup(people, rows);
    for (const side of ['added', 'skipped'] as const) {
      for (const [t, v] of Object.entries(got[side]) as [RestoreTable, number][]) total[side][t] = (total[side][t] ?? 0) + v;
    }
  }
  await layer.refresh();
  return total;
}

// ───────────────────────────── storage used ─────────────────────────────

/** EXP-3: the free plan's limits (Supabase pricing, read 18 Nov 2026; docs/DECISIONS.md). */
export const FREE_DATABASE_BYTES = 500 * 1024 * 1024;
export const FREE_PHOTO_BYTES = 1024 * 1024 * 1024;
export const NEARLY_FULL = 0.8;

export interface StorageFigure { databaseBytes: number; photoBytes: number; at: string }
const STORAGE_KEY = 'smsm-storage-used';

/** The last figure this phone saw, with when (shown offline). */
export function lastStorageUsed(): StorageFigure | null {
  try {
    const parsed = z.object({ databaseBytes: z.number(), photoBytes: z.number(), at: z.string() }).safeParse(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null'));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** EXP-3: storage used now (storage_used), or the last figure when it can't be asked. */
export async function storageUsed(layer = activeDataLayer()): Promise<{ figure: StorageFigure | null; fresh: boolean }> {
  try {
    const got = await layer.api.storageUsed();
    const figure = { databaseBytes: got.database_bytes, photoBytes: got.photo_bytes, at: layer.now().toISOString() };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(figure));
    } catch {
      /* no storage: it is simply asked again next time */
    }
    return { figure, fresh: true };
  } catch {
    return { figure: lastStorageUsed(), fresh: false };
  }
}

/** Who a backup's person is in this household: the same id, else the same name, else the other one left. */
export function defaultPeopleMap(plan: RestorePlan, members: readonly { id: UserId; name: string }[]): Record<string, string> {
  const [p, q] = plan.people;
  const [a, b] = members;
  if (!p || !q || !a || !b) return {};
  const same = (x: { id: string; name: string }, m: { id: string; name: string }) => x.id === m.id;
  const named = (x: { id: string; name: string }, m: { id: string; name: string }) => normaliseKey(x.name) !== '' && normaliseKey(x.name) === normaliseKey(m.name);
  const swapped = same(p, b) || same(q, a) || (!same(p, a) && !same(q, b) && (named(p, b) || named(q, a)));
  return swapped ? { [p.id]: b.id, [q.id]: a.id } : { [p.id]: a.id, [q.id]: b.id };
}
