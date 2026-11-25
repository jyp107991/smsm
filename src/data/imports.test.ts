/**
 * S7 data layer (docs/slices/S7.md "Decisions made here → Where rows wait, What is already decided, The card, Rules,
 * Payer, Queue, CSV export, Restore, Backup format 2", "Data → Data", "Tests → Data"; SPEC IMP-1, IMP-3, EXP-1, INB-1,
 * OFF-3): bank rows waiting on this phone, Keep / Not ours, rules, hashed ignores, the entries CSV, the JSON backup
 * (format 2) and restoring it, over the in-memory Api. Written before the build (ENGINEERING §5, tests first by someone
 * else); each test names its SPEC ids.
 *
 * Interface these tests expect, in src/data/imports.ts (also re-exported from src/data/index.ts):
 *   idHash(householdId, source: 'monzo' | 'csv', bankId): Promise<string>
 *     lower-case hex sha256 of `${householdId}:${source}:${bankId}` (UTF-8), with Web Crypto (works offline).
 *   startImport(rows: BankRow[], source, layer?) → Promise<{ offered: number; rules: { keep: number; skip: number }; already: number }>
 *     BankRow as src/core/csv.ts: { bankId, date, description, amount, categoryHint, note }. A row is dropped (counted in
 *     `already`) when its hash is in import_ignores, when an entry (deleted ones too) has this source and
 *     external_id = its bank id, or when it is already waiting on this phone. Rows matching a skip rule get their hash
 *     written (rules.skip); rows matching a keep rule become entries at once with the rule's category and split, payer
 *     the importer (rules.keep). The rest wait on this phone (IndexedDB "smsm-import", never the database) as cards
 *     (offered).
 *   importQueue(layer?) → Promise<ImportCard[]>: the rows waiting on this phone, in date order.
 *   keepImport(id, opts?, layer?) → Promise<string>: adds the entry (the card's values, the household default split,
 *     payer the importer, source and external_id set) and returns its id; opts may override the draft (Change first)
 *     and `always: true` makes a keep rule. A keep refused by the expenses_external unique index is dropped quietly.
 *   skipImport(id, { always }, layer?) → Promise<void>: writes the hash only (and a skip rule with `always`).
 *   undoSkip(id, layer?) → Promise<void>: takes the hash away again.
 *   stopReviewing(layer?) → Promise<void>: forgets this phone's waiting rows, recording nothing.
 *   importRules(layer?) → ImportRuleRow[] (or a Promise of them): the household's rules (import_rules rows).
 *   removeImportRule(id, layer?).
 *   exportEntriesCsv(range: { from, to }, layer?) → string: core exportCsv over the phone's copy (offline too).
 *   restorePlan(json: string, layer?) → RestorePlan | { error: string }.
 *   restoreBackup(plan, people: Record<backupUserId, memberUserId>, layer?) → Promise<counts>.
 *
 * Choices made here where the brief leaves a name or shape open (the builder matches these):
 *   - ImportCard: { id: string; source: 'monzo' | 'csv'; bankId; date; description; amount: Pence; note: string | null;
 *     categoryId: string | null } — id is whatever the data layer uses to name a waiting row (unique on this phone);
 *     categoryId is the card's category: a keep rule's, else learned memory (core suggest), else the bank's category
 *     hint when it equals a category's name ignoring case, else null.
 *   - keepImport's opts: Partial<ExpenseDraft> & { always?: boolean }.
 *   - previewImport(rows, source, layer?) → the same counts as startImport would give, writing nothing anywhere (the
 *     summary "Your rules will keep 4 and skip 2" before the "Import N rows" tap).
 *   - external_id on a kept entry is the bank's own id (Transaction ID, or the "gen:" id), not the hash.
 *   - A keep rule's match_text and a skip rule's match_text are normaliseKey(description) (src/core/text.ts).
 *   - The waiting rows live in idb-keyval createStore('smsm-import', <any store name>), so the fake idb-keyval holds them
 *     under a key starting "smsm-import/".
 *   - RestorePlan: { format: 1 | 2; people: { id: string; name: string }[]; counts: { entries; settleUps; chapters; … } }
 *     where counts are what the restore ADDS: rows whose id is already on this phone's copy are not counted.
 *   - BACKUP_FORMAT becomes 'smsm-backup-2'; backupJson gains chapters, recurring, comments and import_rules.
 *   - The in-memory Api (src/data/memoryApi.ts) gains what the database has: controls.tables.importIgnores
 *     ({ household_id, source, id_hash }) and controls.tables.importRules (import_rules rows); its upsertExpense refuses a
 *     second (household, source, external_id) with code 23505 'duplicate key value violates unique constraint
 *     "expenses_external"', as it already does for expenses_occurrence; and a `restoreBackup(people, rows)` method
 *     (recorded in controls.calls as 'restoreBackup' with arg { people, rows }) that does what restore_backup does.
 */
import { createHash } from 'node:crypto';
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  categoryId, couple, HID, JAE_ID, SAM_ID, storedChapter, storedComment, storedExpense, storedRecurring, storedSettlement,
} from '../../tests/fixtures/couple';
import { idbData } from '../../tests/fixtures/fake-idb-keyval';
import type { IsoDate } from '../core/dates';
import { pence, type Pence } from '../core/money';
import type { CategoryMemoryRow, ExpenseRow } from './api';
import { backupJson, BACKUP_FORMAT } from './backup';
import type { Database } from './database.types';
import type { MemoryTables } from './memoryApi';
import type { ExpenseDraft } from './writes';
import type { DataLayer } from './queryClient';

vi.mock('idb-keyval', async () => (await import('../../tests/fixtures/fake-idb-keyval')).fakeIdbKeyval);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ───────── the interface above, typed so this file compiles before it exists ─────────
type Source = 'monzo' | 'csv';
interface BankRow { bankId: string; date: IsoDate; description: string; amount: Pence; categoryHint: string | null; note: string | null }
interface ImportCard { id: string; source: Source; bankId: string; date: IsoDate; description: string; amount: Pence; note: string | null; categoryId: string | null }
interface Started { offered: number; rules: { keep: number; skip: number }; already: number }
type ImportRuleRow = Database['public']['Tables']['import_rules']['Row'];
type ImportIgnoreRow = Database['public']['Tables']['import_ignores']['Row'];
interface RestorePlan { format: 1 | 2; people: { id: string; name: string }[]; counts: { entries: number; settleUps: number; chapters: number } }
interface ImportsData {
  idHash(householdId: string, source: Source, bankId: string): Promise<string>;
  startImport(rows: readonly BankRow[], source: Source, layer?: DataLayer): Promise<Started>;
  previewImport(rows: readonly BankRow[], source: Source, layer?: DataLayer): Promise<Started>;
  importQueue(layer?: DataLayer): Promise<ImportCard[]>;
  keepImport(id: string, opts?: Partial<ExpenseDraft> & { always?: boolean }, layer?: DataLayer): Promise<string>;
  skipImport(id: string, opts: { always: boolean }, layer?: DataLayer): Promise<void>;
  undoSkip(id: string, layer?: DataLayer): Promise<void>;
  stopReviewing(layer?: DataLayer): Promise<void>;
  importRules(layer?: DataLayer): ImportRuleRow[] | Promise<ImportRuleRow[]>;
  removeImportRule(id: string, layer?: DataLayer): void | Promise<void>;
  exportEntriesCsv(range: { from: IsoDate; to: IsoDate }, layer?: DataLayer): string | Promise<string>;
  restorePlan(json: string, layer?: DataLayer): RestorePlan | { error: string };
  restoreBackup(plan: RestorePlan, people: Record<string, string>, layer?: DataLayer): Promise<unknown>;
}
const IMPORTS = './imports';
const INDEX = './index';
const loadedImports = (await import(/* @vite-ignore */ IMPORTS).catch(() => null)) as Partial<ImportsData> | null;
const loadedIndex = (await import(/* @vite-ignore */ INDEX).catch(() => null)) as Partial<ImportsData> | null;
const data = { ...(loadedIndex ?? {}), ...(loadedImports ?? {}) } as Partial<ImportsData>;
function fn<K extends keyof ImportsData>(name: K): ImportsData[K] {
  const f = data[name];
  if (typeof f !== 'function') throw new Error(`src/data/imports.ts does not export ${name} yet (S7)`);
  return f as ImportsData[K];
}

type S7Tables = MemoryTables & { importIgnores?: ImportIgnoreRow[]; importRules?: ImportRuleRow[] };
const tablesOf = (c: { controls: { tables: MemoryTables } }) => c.controls.tables as S7Tables;
const ignoresOf = (c: { controls: { tables: MemoryTables } }) => tablesOf(c).importIgnores ?? [];
const rulesOf = (c: { controls: { tables: MemoryTables } }) => tablesOf(c).importRules ?? [];
const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');
const said = (c: { controls: { calls: { arg: unknown }[] } }, s: string) => c.controls.calls.some((call) => JSON.stringify(call.arg ?? null).includes(s));

// ───────── helpers ─────────
const open: DataLayer[] = [];
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); idbData.clear(); });
afterEach(async () => {
  for (const l of open.splice(0)) await l.dispose();
});
async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}
/** A household on the in-memory Api, with import ignores and rules already on the "server". */
async function household(opts: Parameters<typeof couple>[0] & { ignores?: ImportIgnoreRow[]; rules?: ImportRuleRow[] } = {}) {
  const { ignores = [], rules = [], ...rest } = opts;
  const c = couple(rest);
  open.push(c.layer);
  const t = tablesOf(c);
  t.importIgnores ??= [];
  t.importIgnores.push(...ignores);
  t.importRules ??= [];
  t.importRules.push(...rules);
  await c.layer.ready;
  await settle(c.layer);
  return c;
}
function rule(over: Partial<ImportRuleRow> & Pick<ImportRuleRow, 'match_text' | 'decision'>): ImportRuleRow {
  return { id: crypto.randomUUID(), household_id: HID, category_id: null, split_mode: null, split_params: null, created_at: '2026-11-01T12:00:00.000Z', ...over };
}
function memory(key: string, category: string): CategoryMemoryRow {
  return { household_id: HID, key, category_id: categoryId(category), split_mode: null, split_params: null, uses: 3, source: 'user', updated_at: '2026-11-01T12:00:00.000Z' };
}
let n = 0;
function imported(bankId: string, over: Partial<ExpenseRow> = {}): ExpenseRow {
  n += 1;
  return storedExpense({ id: `00000000-0000-4000-8000-0000000f${n.toString(16).padStart(4, '0')}`, source: 'monzo', external_id: bankId, ...over });
}

/** tests/fixtures/monzo-sample.csv's spending rows, as core readRows reads them. */
const bank = (bankId: string, date: IsoDate, description: string, amount: number, categoryHint: string | null, note: string | null = null): BankRow =>
  ({ bankId, date, description, amount: pence(amount), categoryHint, note });
const LARDER = bank('tx_0000TESTSAMPLE0001', '2026-11-02', 'Larder & Leaf', 4250, 'Groceries');
const NOODLE = bank('tx_0000TESTSAMPLE0004', '2026-11-05', 'Noodle Bar, Soho', 1820, 'Eating out');
const CAFE = bank('tx_0000TESTSAMPLE0005', '2026-11-07', 'Café Lumière', 7842, 'Eating out', 'Paid €89.99');
const METRO = bank('tx_0000TESTSAMPLE0006', '2026-11-09', 'Metro Ticket Machine', 280, 'Transport');
const HARDWARE = bank('tx_0000TESTSAMPLE0007', '2026-11-10', 'HARDWARE CORNER, EXAMPLETOWN', 1200, 'Shopping');
/** In the file's order, shuffled a little so date order is the data layer's doing. */
const MONZO_ROWS: BankRow[] = [CAFE, LARDER, HARDWARE, NOODLE, METRO];

async function cardFor(bankId: string, layer: DataLayer): Promise<ImportCard> {
  const card = (await fn('importQueue')(layer)).find((x) => x.bankId === bankId);
  if (!card) throw new Error(`no card for ${bankId}`);
  return card;
}

/**
 * Review fix 2 (changes the tests below that seeded a skip rule in import_rules): a skip rule is made on the importing
 * phone, by "Always do this for …" on Not ours, and never stored in the shared database. Seeded here the way a person
 * makes one, from a row without a bank id (so its Not ours stays on the phone too, review fix 3).
 */
async function phoneSkipRule(c: { layer: DataLayer }, description: string) {
  await fn('startImport')([bank(`gen:seed-${description}`, '2026-10-01', description, 1, null)], 'csv', c.layer);
  const card = (await fn('importQueue')(c.layer)).find((x) => x.description === description);
  if (!card) throw new Error(`no seed card for ${description}`);
  await fn('skipImport')(card.id, { always: true }, c.layer);
  await settle(c.layer);
}

// ─────────────────────────────── idHash ───────────────────────────────

describe('idHash (IMP-3)', () => {
  it('IMP-3: sha256 of household:source:bank id, lower-case hex', async () => {
    expect(await fn('idHash')(HID, 'monzo', 'tx_0000TESTSAMPLE0001')).toBe(sha(`${HID}:monzo:tx_0000TESTSAMPLE0001`));
    expect(await fn('idHash')(HID, 'monzo', 'tx_0000TESTSAMPLE0001')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('IMP-3: the source and the household are part of it; text is hashed as UTF-8', async () => {
    const h = fn('idHash');
    expect(await h(HID, 'csv', 'R0001')).toBe(sha(`${HID}:csv:R0001`));
    expect(await h(HID, 'csv', 'R0001')).not.toBe(await h(HID, 'monzo', 'R0001'));
    expect(await h('00000000-0000-4000-8000-0000000000c2', 'csv', 'R0001')).not.toBe(await h(HID, 'csv', 'R0001'));
    expect(await h(HID, 'csv', 'gen:이마트·é')).toBe(sha(`${HID}:csv:gen:이마트·é`));
  });
});

// ─────────────────────────────── startImport ───────────────────────────────

describe('startImport: what is already decided is dropped (IMP-3, INB-1)', () => {
  it('IMP-3 INB-1: new rows wait on this phone as cards, in date order, and nothing reaches the database', async () => {
    const c = await household();
    const callsBefore = c.controls.calls.length;
    expect(await fn('startImport')(MONZO_ROWS, 'monzo', c.layer)).toEqual({ offered: 5, rules: { keep: 0, skip: 0 }, already: 0 });
    await settle(c.layer);
    const cards = await fn('importQueue')(c.layer);
    expect(cards.map((x) => x.bankId)).toEqual([LARDER, NOODLE, CAFE, METRO, HARDWARE].map((r) => r.bankId));
    expect(cards[0]).toMatchObject({ source: 'monzo', date: '2026-11-02', description: 'Larder & Leaf', amount: 4250, note: null });
    expect(cards[2]).toMatchObject({ description: 'Café Lumière', amount: 7842, note: 'Paid €89.99' });
    // Waiting rows are on this phone only.
    expect([...idbData.keys()].some((k) => k.startsWith('smsm-import/'))).toBe(true);
    const sent = c.controls.calls.slice(callsBefore);
    for (const s of ['Larder & Leaf', 'Noodle Bar', 'tx_0000TESTSAMPLE', 'Café Lumière']) expect(sent.some((call) => JSON.stringify(call.arg ?? null).includes(s)), s).toBe(false);
    expect(c.controls.tables.expenses).toEqual([]);
    expect(ignoresOf(c)).toEqual([]);
  });

  it('IMP-3: a row whose hash is in import_ignores is dropped', async () => {
    const c = await household({ ignores: [{ household_id: HID, source: 'monzo', id_hash: sha(`${HID}:monzo:${CAFE.bankId}`) }] });
    expect(await fn('startImport')(MONZO_ROWS, 'monzo', c.layer)).toEqual({ offered: 4, rules: { keep: 0, skip: 0 }, already: 1 });
    expect((await fn('importQueue')(c.layer)).map((x) => x.bankId)).not.toContain(CAFE.bankId);
  });

  it('IMP-3: a row already kept as an entry is dropped, even if that entry was deleted; only the same source counts', async () => {
    const c = await household({
      expenses: [
        imported(LARDER.bankId),
        imported(NOODLE.bankId, { deleted_at: '2026-11-06T10:00:00.000Z' }),
        imported(METRO.bankId, { source: 'csv' }),
      ],
    });
    expect(await fn('startImport')(MONZO_ROWS, 'monzo', c.layer)).toEqual({ offered: 3, rules: { keep: 0, skip: 0 }, already: 2 });
    expect((await fn('importQueue')(c.layer)).map((x) => x.bankId)).toEqual([CAFE, METRO, HARDWARE].map((r) => r.bankId));
  });

  it('IMP-3: a row already waiting on this phone is not offered twice', async () => {
    const c = await household();
    await fn('startImport')([LARDER, NOODLE], 'monzo', c.layer);
    expect(await fn('startImport')(MONZO_ROWS, 'monzo', c.layer)).toEqual({ offered: 3, rules: { keep: 0, skip: 0 }, already: 2 });
    expect(await fn('importQueue')(c.layer)).toHaveLength(5);
  });

  it('IMP-3: rules: a skip rule writes the hash, a keep rule keeps with its category and split, payer the importer', async () => {
    const c = await household({
      rules: [rule({ match_text: 'metro ticket machine', decision: 'keep', category_id: categoryId('Transport'), split_mode: 'treat' })],
    });
    await phoneSkipRule(c, 'Noodle Bar, Soho');
    expect(await fn('startImport')(MONZO_ROWS, 'monzo', c.layer)).toEqual({ offered: 3, rules: { keep: 1, skip: 1 }, already: 0 });
    await settle(c.layer);
    expect((await fn('importQueue')(c.layer)).map((x) => x.bankId)).toEqual([LARDER, CAFE, HARDWARE].map((r) => r.bankId));
    const kept = c.controls.tables.expenses;
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({
      description: 'Metro Ticket Machine', amount_pence: 280, date: '2026-11-09', category_id: categoryId('Transport'), split_mode: 'treat',
      paid: { [JAE_ID]: 280 }, shares: { [JAE_ID]: 280 }, source: 'monzo', external_id: METRO.bankId, deleted_at: null,
    });
    expect(ignoresOf(c)).toEqual([{ household_id: HID, source: 'monzo', id_hash: sha(`${HID}:monzo:${NOODLE.bankId}`) }]);
    // The skipped row itself is never stored.
    expect(said(c, 'Noodle Bar')).toBe(false);
    expect(said(c, NOODLE.bankId)).toBe(false);
  });

  it('IMP-3: a rule matches the normalised description (case, width and spaces ignored)', async () => {
    const c = await household();
    await phoneSkipRule(c, 'Larder & Leaf');
    const shouting = bank('tx_shout', '2026-11-11', '  LARDER   &  LEAF ', 999, null);
    expect(await fn('startImport')([shouting, METRO], 'monzo', c.layer)).toEqual({ offered: 1, rules: { keep: 0, skip: 1 }, already: 0 });
  });

  it('IMP-3: the summary before the tap (previewImport) gives the same counts and writes nothing', async () => {
    const c = await household({
      expenses: [imported(LARDER.bankId)],
      rules: [rule({ match_text: 'metro ticket machine', decision: 'keep', category_id: categoryId('Transport'), split_mode: 'treat' })],
    });
    await phoneSkipRule(c, 'Noodle Bar, Soho');
    const callsBefore = c.controls.calls.length;
    expect(await fn('previewImport')(MONZO_ROWS, 'monzo', c.layer)).toEqual({ offered: 2, rules: { keep: 1, skip: 1 }, already: 1 });
    await settle(c.layer);
    expect(await fn('importQueue')(c.layer)).toEqual([]);
    expect(c.controls.tables.expenses).toHaveLength(1);
    expect(ignoresOf(c)).toEqual([]);
    expect(c.controls.calls.slice(callsBefore).some((call) => /upsert|insert|ignore|rule/i.test(call.name))).toBe(false);
  });

  it('IMP-1 OFF-3: reading and queueing work offline', async () => {
    const c = await household();
    c.network.set(false);
    c.controls.online = false;
    expect(await fn('startImport')(MONZO_ROWS, 'monzo', c.layer)).toEqual({ offered: 5, rules: { keep: 0, skip: 0 }, already: 0 });
    expect(await fn('importQueue')(c.layer)).toHaveLength(5);
  });
});

// ─────────────────────────────── the card's category ───────────────────────────────

describe('the card’s category (IMP-3)', () => {
  it('IMP-3: the bank’s category when it is one of ours by name, ignoring case; none otherwise', async () => {
    const c = await household();
    await fn('startImport')([LARDER, bank('tx_lower', '2026-11-03', 'Somewhere new', 100, 'eating OUT'), HARDWARE], 'monzo', c.layer);
    const cards = await fn('importQueue')(c.layer);
    expect(cards.map((x) => x.categoryId)).toEqual([categoryId('Groceries'), categoryId('Eating out'), null]);
  });

  it('IMP-3: learned memory comes before the bank’s category', async () => {
    const c = await household({ categoryMemory: [memory('larder & leaf', 'Household')] });
    await fn('startImport')([LARDER], 'monzo', c.layer);
    expect((await cardFor(LARDER.bankId, c.layer)).categoryId).toBe(categoryId('Household'));
  });
});

// ─────────────────────────────── Keep ───────────────────────────────

describe('keepImport (IMP-3)', () => {
  it('IMP-3: Keep adds the entry at once with the card’s values, the household default split, payer the importer, source and bank id', async () => {
    const c = await household({ defaultRatio: { [JAE_ID]: 60, [SAM_ID]: 40 } });
    await fn('startImport')(MONZO_ROWS, 'monzo', c.layer);
    const card = await cardFor(LARDER.bankId, c.layer);
    const id = await fn('keepImport')(card.id, undefined, c.layer);
    // At once on the phone, before the server answers.
    expect(c.layer.entries().find((e) => e.id === id)).toMatchObject({ description: 'Larder & Leaf', amount_pence: 4250 });
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.id === id)).toMatchObject({
      household_id: HID, kind: 'expense', description: 'Larder & Leaf', amount_pence: 4250, date: '2026-11-02', category_id: categoryId('Groceries'),
      paid: { [JAE_ID]: 4250 }, split_mode: 'ratio', shares: { [JAE_ID]: 2550, [SAM_ID]: 1700 }, source: 'monzo', external_id: LARDER.bankId,
      deleted_at: null,
    });
    expect((await fn('importQueue')(c.layer)).map((x) => x.bankId)).not.toContain(LARDER.bankId);
    expect(c.layer.balance()).toEqual({ [JAE_ID]: 1700, [SAM_ID]: -1700 });
  });

  it('IMP-3: the payer is whoever imports (it is their statement)', async () => {
    const c = await household({ as: 'sam' });
    await fn('startImport')([NOODLE], 'monzo', c.layer);
    const id = await fn('keepImport')((await cardFor(NOODLE.bankId, c.layer)).id, undefined, c.layer);
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.id === id)).toMatchObject({ paid: { [SAM_ID]: 1820 }, shares: { [JAE_ID]: 910, [SAM_ID]: 910 }, source: 'monzo' });
  });

  it('IMP-3: Change first: what the person changed is kept (the other person paid, from a joint statement), still with source and bank id', async () => {
    const c = await household();
    await fn('startImport')([NOODLE], 'monzo', c.layer);
    const id = await fn('keepImport')((await cardFor(NOODLE.bankId, c.layer)).id, { payer: SAM_ID, description: 'Noodles', categoryId: categoryId('Going out') }, c.layer);
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.id === id)).toMatchObject({
      description: 'Noodles', paid: { [SAM_ID]: 1820 }, category_id: categoryId('Going out'), source: 'monzo', external_id: NOODLE.bankId,
    });
  });

  it('IMP-3: "Always do this for" on Keep makes a keep rule with the category and split used', async () => {
    const c = await household();
    await fn('startImport')([METRO], 'monzo', c.layer);
    await fn('keepImport')((await cardFor(METRO.bankId, c.layer)).id, { always: true }, c.layer);
    await settle(c.layer);
    expect(rulesOf(c)).toHaveLength(1);
    expect(rulesOf(c)[0]).toMatchObject({ household_id: HID, match_text: 'metro ticket machine', decision: 'keep', category_id: categoryId('Transport'), split_mode: 'ratio' });
    // Next time, the rule keeps it.
    expect(await fn('startImport')([{ ...METRO, bankId: 'tx_next_metro', date: '2026-11-12' }], 'monzo', c.layer)).toEqual({ offered: 0, rules: { keep: 1, skip: 0 }, already: 0 });
  });

  it('IMP-3: a kept row can’t be imported twice: the same file again offers it no more', async () => {
    const c = await household();
    await fn('startImport')(MONZO_ROWS, 'monzo', c.layer);
    await fn('keepImport')((await cardFor(LARDER.bankId, c.layer)).id, undefined, c.layer);
    await settle(c.layer);
    await fn('stopReviewing')(c.layer);
    expect(await fn('startImport')(MONZO_ROWS, 'monzo', c.layer)).toEqual({ offered: 4, rules: { keep: 0, skip: 0 }, already: 1 });
  });

  it('IMP-3: the partner’s phone kept the same row first: the unique index refuses ours and it is dropped quietly', async () => {
    const c = await household();
    await fn('startImport')([LARDER], 'monzo', c.layer);
    const card = await cardFor(LARDER.bankId, c.layer);
    // Meanwhile Sam imported the same statement row on the other phone (a joint account).
    c.controls.tables.expenses.push(imported(LARDER.bankId, { created_by: SAM_ID, paid: { [SAM_ID]: 4250 }, amount_pence: 4250, shares: { [JAE_ID]: 2125, [SAM_ID]: 2125 } }));
    await fn('keepImport')(card.id, undefined, c.layer);
    await settle(c.layer);
    await act(async () => { await c.layer.refresh(); });
    await settle(c.layer);
    expect(c.layer.problems.list()).toHaveLength(0);
    expect(c.controls.tables.expenses.filter((e) => e.external_id === LARDER.bankId)).toHaveLength(1);
    expect(c.layer.entries().filter((e) => e.external_id === LARDER.bankId && e.deleted_at === null)).toHaveLength(1);
    expect(c.layer.waiting()).toHaveLength(0);
    expect(await fn('importQueue')(c.layer)).toEqual([]);
  });

  it('IMP-3 OFF-3: Keep offline waits in the queue like any entry and is sent on reconnecting', async () => {
    const c = await household();
    await fn('startImport')([LARDER], 'monzo', c.layer);
    c.network.set(false);
    await fn('keepImport')((await cardFor(LARDER.bankId, c.layer)).id, undefined, c.layer);
    expect(c.layer.waiting().length).toBeGreaterThan(0);
    expect(c.controls.tables.expenses).toEqual([]);
    c.network.set(true);
    await settle(c.layer);
    expect(c.controls.tables.expenses).toHaveLength(1);
    expect(c.controls.tables.expenses[0]).toMatchObject({ source: 'monzo', external_id: LARDER.bankId });
  });
});

// ─────────────────────────────── Not ours ───────────────────────────────

describe('skipImport, undoSkip (IMP-3)', () => {
  it('IMP-3: Not ours writes the hash and nothing else; the row is gone from this phone', async () => {
    const c = await household();
    await fn('startImport')(MONZO_ROWS, 'monzo', c.layer);
    const callsBefore = c.controls.calls.length;
    await fn('skipImport')((await cardFor(CAFE.bankId, c.layer)).id, { always: false }, c.layer);
    await settle(c.layer);
    expect(ignoresOf(c)).toEqual([{ household_id: HID, source: 'monzo', id_hash: sha(`${HID}:monzo:${CAFE.bankId}`) }]);
    expect(rulesOf(c)).toEqual([]);
    expect(c.controls.tables.expenses).toEqual([]);
    const sent = JSON.stringify(c.controls.calls.slice(callsBefore).map((call) => call.arg));
    for (const s of ['Café', 'Lumière', CAFE.bankId, '7842', '89.99']) expect(sent.includes(s), s).toBe(false);
    expect((await fn('importQueue')(c.layer)).map((x) => x.bankId)).not.toContain(CAFE.bankId);
    // Not offered again.
    await fn('stopReviewing')(c.layer);
    expect(await fn('startImport')([CAFE], 'monzo', c.layer)).toEqual({ offered: 0, rules: { keep: 0, skip: 0 }, already: 1 });
  });

  it('IMP-3: "Always do this for" on Not ours makes a skip rule for the description, on this phone only (review fix 2)', async () => {
    const c = await household();
    await fn('startImport')([HARDWARE], 'monzo', c.layer);
    await fn('skipImport')((await cardFor(HARDWARE.bankId, c.layer)).id, { always: true }, c.layer);
    await settle(c.layer);
    // The merchant one person left out is never in the shared database.
    expect(rulesOf(c)).toEqual([]);
    expect(said(c, 'hardware')).toBe(false);
    expect(said(c, 'HARDWARE')).toBe(false);
    expect(await fn('importRules')(c.layer)).toEqual([expect.objectContaining({ match_text: 'hardware corner, exampletown', decision: 'skip', onThisPhone: true })]);
    expect(ignoresOf(c)).toHaveLength(1);
    expect(await fn('startImport')([{ ...HARDWARE, bankId: 'tx_another', date: '2026-11-13' }], 'monzo', c.layer)).toEqual({ offered: 0, rules: { keep: 0, skip: 1 }, already: 0 });
  });

  it('IMP-3: Undo takes the hash away again and the card comes back', async () => {
    const c = await household();
    await fn('startImport')([CAFE, METRO], 'monzo', c.layer);
    const card = await cardFor(CAFE.bankId, c.layer);
    await fn('skipImport')(card.id, { always: false }, c.layer);
    await settle(c.layer);
    expect(ignoresOf(c)).toHaveLength(1);
    await fn('undoSkip')(card.id, c.layer);
    await settle(c.layer);
    expect(ignoresOf(c)).toEqual([]);
    expect((await fn('importQueue')(c.layer)).map((x) => x.bankId)).toEqual([CAFE.bankId, METRO.bankId]);
  });

  it('IMP-3 OFF-3: Not ours offline is queued and reaches the server on reconnecting', async () => {
    const c = await household();
    await fn('startImport')([CAFE], 'monzo', c.layer);
    c.network.set(false);
    await fn('skipImport')((await cardFor(CAFE.bankId, c.layer)).id, { always: true }, c.layer);
    expect(ignoresOf(c)).toEqual([]);
    expect(await fn('importQueue')(c.layer)).toEqual([]);
    c.network.set(true);
    await settle(c.layer);
    expect(ignoresOf(c)).toHaveLength(1);
    // Review fix 2: the skip rule stays on this phone.
    expect(rulesOf(c)).toEqual([]);
    expect((await fn('importRules')(c.layer)).map((r) => r.decision)).toEqual(['skip']);
  });
});

// ─────────────────────────────── Stop reviewing ───────────────────────────────

describe('stopReviewing (IMP-3)', () => {
  it('IMP-3: forgets the waiting rows on this phone and records nothing; they are offered again next time', async () => {
    const c = await household();
    await fn('startImport')(MONZO_ROWS, 'monzo', c.layer);
    await settle(c.layer);
    const callsBefore = c.controls.calls.length;
    await fn('stopReviewing')(c.layer);
    await settle(c.layer);
    expect(await fn('importQueue')(c.layer)).toEqual([]);
    expect(ignoresOf(c)).toEqual([]);
    expect(rulesOf(c)).toEqual([]);
    expect(c.controls.tables.expenses).toEqual([]);
    expect(c.controls.calls.slice(callsBefore).some((call) => /upsert|insert|ignore|rule/i.test(call.name))).toBe(false);
    expect(await fn('startImport')(MONZO_ROWS, 'monzo', c.layer)).toEqual({ offered: 5, rules: { keep: 0, skip: 0 }, already: 0 });
  });
});

// ─────────────────────────────── Import rules ───────────────────────────────

describe('importRules, removeImportRule (IMP-3)', () => {
  it('IMP-3: lists the household’s rules and this phone’s; Remove takes one away (and the row is offered again)', async () => {
    const keep = rule({ match_text: 'metro ticket machine', decision: 'keep', category_id: categoryId('Transport'), split_mode: 'treat' });
    const c = await household({ rules: [keep] });
    await phoneSkipRule(c, 'Noodle Bar, Soho');
    expect((await fn('importRules')(c.layer)).map((r) => r.match_text).sort()).toEqual(['metro ticket machine', 'noodle bar, soho']);
    const skip = (await fn('importRules')(c.layer)).find((r) => r.decision === 'skip');
    if (!skip) throw new Error('no skip rule');
    await fn('removeImportRule')(skip.id, c.layer);
    await settle(c.layer);
    expect(rulesOf(c).map((r) => r.id)).toEqual([keep.id]);
    expect((await fn('importRules')(c.layer)).map((r) => r.id)).toEqual([keep.id]);
    expect(await fn('startImport')([NOODLE], 'monzo', c.layer)).toEqual({ offered: 1, rules: { keep: 0, skip: 0 }, already: 0 });
  });
});

// ─────────────────────────────── Entries as CSV ───────────────────────────────

describe('exportEntriesCsv (EXP-1, OFF-3)', () => {
  it('EXP-1 OFF-3: the range’s entries and settle-ups from the phone’s copy, named by the two people, offline too', async () => {
    const c = await household({
      expenses: [
        storedExpense({ id: '00000000-0000-4000-8000-00000000e101', description: 'Lamp', amount_pence: 4000, date: '2026-11-10' }),
        storedExpense({ id: '00000000-0000-4000-8000-00000000e102', description: 'Old rug', amount_pence: 2000, date: '2026-10-10' }),
      ],
      settlements: [storedSettlement({ date: '2026-11-12' })],
    });
    c.network.set(false);
    const text = await fn('exportEntriesCsv')({ from: '2026-11-01', to: '2026-11-30' }, c.layer);
    expect(text.startsWith('\uFEFF')).toBe(true);
    const lines = text.replace(/^\uFEFF/, '').split('\r\n').filter((l) => l !== '');
    expect(lines[0]).toBe('Date,Type,Description,Category,Chapter,Country,Amount,Paid by,Jae\'s share,Sam\'s share,Notes,Deleted,Whose'); // S10 (REC-9): Whose added
    expect(lines).toHaveLength(3);
    expect(text).toContain('Lamp');
    expect(text).toContain('Household');
    expect(text).toContain('40.00');
    expect(text).toContain('Settle-up');
    expect(text).not.toContain('Old rug');
  });
});

// ─────────────────────────────── Backup format 2 and restoring it ───────────────────────────────

const LAMP = storedExpense();
const GONE = storedExpense({ id: '00000000-0000-4000-8000-00000000e0de', description: 'Gum', amount_pence: 100, paid: { [JAE_ID]: 100 }, shares: { [JAE_ID]: 50, [SAM_ID]: 50 }, deleted_at: '2026-11-11T10:00:00.000Z' });
const RAMEN = storedExpense({ id: '00000000-0000-4000-8000-00000000e0a1', description: 'Ramen', amount_pence: 2440, date: '2026-11-04', paid: { [SAM_ID]: 2440 }, shares: { [JAE_ID]: 1220, [SAM_ID]: 1220 }, chapter_id: storedChapter().id, country: 'JP' });
const RICH = { expenses: [LAMP, GONE, RAMEN], settlements: [storedSettlement()], chapters: [storedChapter()], recurring: [storedRecurring()], comments: [storedComment()] };
// Review fix 2: only keep rules are shared, so only they are in a backup.
const RULE = rule({ id: '00000000-0000-4000-8000-0000000071e1', match_text: 'noodle bar, soho', decision: 'keep', category_id: categoryId('Eating out') });
const SAME_PEOPLE = { [JAE_ID]: JAE_ID, [SAM_ID]: SAM_ID };
const rowsSent = (arg: unknown): number => {
  const a = (arg ?? {}) as Record<string, unknown>;
  const rows = (a['rows'] ?? a['p_rows'] ?? a) as Record<string, unknown>;
  return Object.values(rows).filter(Array.isArray).reduce((t, list) => t + list.length, 0);
};
const restoreCalls = (c: { controls: { calls: { name: string; arg: unknown }[] } }) => c.controls.calls.filter((call) => call.name === 'restoreBackup');

describe('backup format 2 (EXP-1)', () => {
  it('EXP-1: the backup gains chapters, regular payments, comments and import rules', async () => {
    const c = await household({ ...RICH, rules: [RULE] });
    expect(BACKUP_FORMAT).toBe('smsm-backup-2');
    const json = JSON.parse(backupJson({ appVersion: '0.1.0' }, c.layer)) as Record<string, unknown>;
    expect(json['format']).toBe('smsm-backup-2');
    expect((json['chapters'] as { id: string }[]).map((r) => r.id)).toEqual([storedChapter().id]);
    expect((json['recurring'] as { id: string }[]).map((r) => r.id)).toEqual([storedRecurring().id]);
    expect((json['comments'] as { id: string }[]).map((r) => r.id)).toEqual([storedComment().id]);
    expect((json['import_rules'] as { id: string }[]).map((r) => r.id)).toEqual([RULE.id]);
    expect((json['expenses'] as { id: string }[]).map((r) => r.id).sort()).toEqual([LAMP.id, GONE.id, RAMEN.id].sort());
  });

  it('EXP-1: round trip: a backup restored into an empty household gives back every row and the same balance', async () => {
    const from = await household({ ...RICH, rules: [RULE] });
    const json = backupJson({ appVersion: '0.1.0' }, from.layer);
    const balance = from.layer.balance();
    const into = await household();
    const plan = fn('restorePlan')(json, into.layer);
    if ('error' in plan) throw new Error(`refused: ${plan.error}`);
    expect(plan.format).toBe(2);
    expect(plan.people.map((p) => p.name).sort()).toEqual(['Jae', 'Sam']);
    expect(plan.counts).toMatchObject({ entries: 3, settleUps: 1, chapters: 1 });
    await fn('restoreBackup')(plan, SAME_PEOPLE, into.layer);
    await settle(into.layer);
    await act(async () => { await into.layer.refresh(); });
    await settle(into.layer);
    const t = tablesOf(into);
    expect(t.expenses.map((e) => e.id).sort()).toEqual([LAMP.id, GONE.id, RAMEN.id].sort());
    expect(t.expenses.find((e) => e.id === GONE.id)?.deleted_at).not.toBeNull();
    expect(t.settlements.map((s) => s.id)).toEqual([storedSettlement().id]);
    expect(t.chapters.map((x) => x.id)).toEqual([storedChapter().id]);
    expect(t.comments.map((x) => x.id)).toEqual([storedComment().id]);
    expect(rulesOf(into).map((r) => r.match_text)).toEqual(['noodle bar, soho']);
    // Regular payments come back paused, so nothing posts on its own.
    expect(t.recurring.map((r) => [r.id, r.active])).toEqual([[storedRecurring().id, false]]);
    expect(into.layer.balance()).toEqual(balance);
  });

  it('EXP-1: restoring maps the backup’s people onto this household’s (swapped here)', async () => {
    const from = await household({ expenses: [LAMP] });
    const json = backupJson({ appVersion: '0.1.0' }, from.layer);
    const into = await household();
    const plan = fn('restorePlan')(json, into.layer);
    if ('error' in plan) throw new Error(`refused: ${plan.error}`);
    await fn('restoreBackup')(plan, { [JAE_ID]: SAM_ID, [SAM_ID]: JAE_ID }, into.layer);
    await settle(into.layer);
    expect(into.controls.tables.expenses.find((e) => e.id === LAMP.id)).toMatchObject({ paid: { [SAM_ID]: 4000 } });
    const sent = restoreCalls(into)[0]?.arg as { people?: Record<string, string> } | undefined;
    expect(sent?.people).toEqual({ [JAE_ID]: SAM_ID, [SAM_ID]: JAE_ID });
  });

  it('EXP-1: it only adds: what is already here is left alone and not counted; repeating it adds nothing', async () => {
    const c = await household({ ...RICH });
    const json = backupJson({ appVersion: '0.1.0' }, c.layer);
    // Changed since the backup: the Lamp is now £45.00.
    const lamp = c.controls.tables.expenses.find((e) => e.id === LAMP.id);
    if (lamp) Object.assign(lamp, { amount_pence: 4500, paid: { [JAE_ID]: 4500 }, shares: { [JAE_ID]: 2250, [SAM_ID]: 2250 } });
    await act(async () => { await c.layer.refresh(); });
    await settle(c.layer);
    const plan = fn('restorePlan')(json, c.layer);
    if ('error' in plan) throw new Error(`refused: ${plan.error}`);
    expect(plan.counts).toMatchObject({ entries: 0, settleUps: 0, chapters: 0 });
    await fn('restoreBackup')(plan, SAME_PEOPLE, c.layer);
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.id === LAMP.id)?.amount_pence).toBe(4500);
    expect(c.controls.tables.expenses).toHaveLength(3);
  });

  it('EXP-1: sent in chunks of at most 500 rows; repeating the restore is safe', async () => {
    const many = Array.from({ length: 1201 }, (_, i) => storedExpense({
      id: `00000000-0000-4000-8000-${(0x100000 + i).toString(16).padStart(12, '0')}`, description: `Shop ${String(i)}`, amount_pence: 200,
      paid: { [JAE_ID]: 200 }, shares: { [JAE_ID]: 100, [SAM_ID]: 100 }, date: '2026-10-01',
    }));
    const from = await household({ expenses: many });
    const json = backupJson({ appVersion: '0.1.0' }, from.layer);
    const into = await household();
    const plan = fn('restorePlan')(json, into.layer);
    if ('error' in plan) throw new Error(`refused: ${plan.error}`);
    expect(plan.counts.entries).toBe(1201);
    await fn('restoreBackup')(plan, SAME_PEOPLE, into.layer);
    await settle(into.layer);
    const calls = restoreCalls(into);
    expect(calls.length).toBeGreaterThanOrEqual(3);
    for (const call of calls) expect(rowsSent(call.arg)).toBeLessThanOrEqual(500);
    expect(into.controls.tables.expenses).toHaveLength(1201);
    await fn('restoreBackup')(plan, SAME_PEOPLE, into.layer);
    await settle(into.layer);
    expect(into.controls.tables.expenses).toHaveLength(1201);
    expect(into.layer.balance()).toEqual({ [JAE_ID]: 120100, [SAM_ID]: -120100 });
  });

  it('EXP-1: a format 1 backup (before chapters and the rest were added) is read too', async () => {
    const from = await household({ expenses: [LAMP], settlements: [storedSettlement()] });
    const v2 = JSON.parse(backupJson({ appVersion: '0.1.0' }, from.layer)) as Record<string, unknown>;
    const added = ['chapters', 'recurring', 'comments', 'import_rules'];
    const v1 = Object.fromEntries(Object.entries({ ...v2, format: 'smsm-backup-1' }).filter(([k]) => !added.includes(k)));
    const into = await household();
    const plan = fn('restorePlan')(JSON.stringify(v1), into.layer);
    if ('error' in plan) throw new Error(`refused: ${plan.error}`);
    expect(plan.format).toBe(1);
    expect(plan.counts).toMatchObject({ entries: 1, settleUps: 1, chapters: 0 });
  });

  it('EXP-1: anything that isn’t an smsm backup is refused', async () => {
    const c = await household();
    const csv = 'Transaction ID,Date,Name,Amount\ntx_1,02/11/2026,Shop,-1.00\n';
    for (const text of ['', 'hello', csv, '[]', '{}', JSON.stringify({ format: 'smsm-backup-9', members: [], expenses: [] }), JSON.stringify({ format: 'other-app', expenses: [] })]) {
      const plan = fn('restorePlan')(text, c.layer) as Partial<RestorePlan> & { error?: string };
      expect(typeof plan.error, JSON.stringify(text.slice(0, 30))).toBe('string');
      expect(plan.counts).toBeUndefined();
    }
  });

  it('EXP-1: restoring needs a connection: offline it is refused and nothing is sent', async () => {
    const from = await household({ expenses: [LAMP] });
    const json = backupJson({ appVersion: '0.1.0' }, from.layer);
    const into = await household();
    const plan = fn('restorePlan')(json, into.layer);
    if ('error' in plan) throw new Error(`refused: ${plan.error}`);
    into.network.set(false);
    into.controls.online = false;
    await expect(fn('restoreBackup')(plan, SAME_PEOPLE, into.layer)).rejects.toBeTruthy();
    into.controls.online = true;
    expect(restoreCalls(into)).toEqual([]);
    expect(into.controls.tables.expenses).toEqual([]);
  });

  it('EXP-1: both people must have joined', async () => {
    const from = await household({ expenses: [LAMP] });
    const json = backupJson({ appVersion: '0.1.0' }, from.layer);
    const into = await household({ partnerJoined: false });
    const plan = fn('restorePlan')(json, into.layer);
    if (!('error' in plan)) await expect(fn('restoreBackup')(plan, SAME_PEOPLE, into.layer)).rejects.toBeTruthy();
    expect(restoreCalls(into)).toEqual([]);
    expect(into.controls.tables.expenses).toEqual([]);
  });
});

