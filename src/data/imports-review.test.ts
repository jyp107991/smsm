/**
 * S7 fresh-review fixes in the data layer (docs/slices/S7.md; SPEC IMP-3, EXP-1, INB-1, OFF-3):
 *   2. "Always do this for …" on Not ours (a skip rule) stays on the importing phone; backups carry keep rules only.
 *   3. Not ours on a row whose id was made from the row ("gen:") keeps its hash on the phone, not in import_ignores.
 *   4. Undo after Keep puts the card back: a keep not yet sent is withdrawn (nothing reaches the server); one sent is
 *      deleted with its bank id cleared, so the row can be kept again.
 *   5. A made-up id is the importer's ("gen:<user id>:…"), so two people's identical rows don't block each other.
 *   7. Removing a keep rule removes it by its words, even when the other phone gave it a new id.
 *   8. Signing out clears what the phone keeps for imports (waiting rows, phone-only rules and ignores).
 *   9. A part of a backup the database refuses is named (RestoreRefusedError with the table).
 */
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { categoryId, couple, HID, JAE_ID, SAM_ID, storedExpense } from '../../tests/fixtures/couple';
import { idbData } from '../../tests/fixtures/fake-idb-keyval';
import type { IsoDate } from '../core/dates';
import { pence } from '../core/money';
import type { ImportRuleRow } from './api';
import { backupJson } from './backup';
import type { MemoryTables } from './memoryApi';
import { signOut } from './mutations';
import type { DataLayer } from './queryClient';
import {
  importQueue, importRules, keepImport, removeImportRule, restoreBackup, RestoreRefusedError, restorePlan, skipImport, startImport, undoKeep,
  type BankRow,
} from './imports';

vi.mock('idb-keyval', async () => (await import('../../tests/fixtures/fake-idb-keyval')).fakeIdbKeyval);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Tables = MemoryTables & { importIgnores?: { household_id: string; source: string; id_hash: string }[]; importRules?: ImportRuleRow[] };
const open: DataLayer[] = [];
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); idbData.clear(); });
afterEach(async () => { for (const l of open.splice(0)) await l.dispose(); });

async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}
async function household(opts: Parameters<typeof couple>[0] & { rules?: ImportRuleRow[] } = {}) {
  const { rules = [], ...rest } = opts;
  const c = couple(rest);
  open.push(c.layer);
  const t = c.controls.tables as Tables;
  t.importRules ??= [];
  t.importRules.push(...rules);
  await c.layer.ready;
  await settle(c.layer);
  return { ...c, t };
}
const bank = (bankId: string, date: IsoDate, description: string, amount: number): BankRow =>
  ({ bankId, date, description, amount: pence(amount), categoryHint: null, note: null });
const LARDER = bank('tx_0000TESTSAMPLE0001', '2026-11-02', 'Larder & Leaf', 4250);
const BAKERY = bank('gen:0123456789abcdef:1', '2026-11-03', 'Corner Bakery', 420);
const said = (c: { controls: { calls: { arg: unknown }[] } }, s: string) => c.controls.calls.some((call) => JSON.stringify(call.arg ?? null).includes(s));
async function cardId(layer: DataLayer, description: string): Promise<string> {
  const card = (await importQueue(layer)).find((x) => x.description === description);
  if (!card) throw new Error(`no card for ${description}`);
  return card.id;
}
function keepRule(over: Partial<ImportRuleRow> = {}): ImportRuleRow {
  return {
    id: crypto.randomUUID(), household_id: HID, match_text: 'metro ticket machine', decision: 'keep', category_id: categoryId('Transport'), split_mode: 'treat',
    split_params: null, created_at: '2026-11-01T12:00:00.000Z', ...over,
  };
}

describe('review fix 2: skip rules stay on the phone (IMP-3)', () => {
  it('IMP-3: a backup carries the household’s keep rules, never this phone’s skip rules', async () => {
    const c = await household({ rules: [keepRule()] });
    await startImport([BAKERY], 'csv', c.layer);
    await skipImport(await cardId(c.layer, 'Corner Bakery'), { always: true }, c.layer);
    await settle(c.layer);
    const json = JSON.parse(backupJson({ appVersion: '0.1.0' }, c.layer)) as { import_rules: ImportRuleRow[] };
    expect(json.import_rules.map((r) => [r.match_text, r.decision])).toEqual([['metro ticket machine', 'keep']]);
    expect(JSON.stringify(json)).not.toContain('corner bakery');
  });

  it('IMP-3 EXP-1: a skip rule in an older backup is not restored (nor counted)', async () => {
    const from = await household({ rules: [keepRule()] });
    const v2 = JSON.parse(backupJson({ appVersion: '0.1.0' }, from.layer)) as Record<string, unknown>;
    const old = { ...v2, import_rules: [...(v2['import_rules'] as unknown[]), keepRule({ match_text: 'pret', decision: 'skip', category_id: null, split_mode: null })] };
    const into = await household();
    const plan = restorePlan(JSON.stringify(old), into.layer);
    if ('error' in plan) throw new Error(plan.error);
    expect(plan.counts.rules).toBe(1);
    expect(plan.rows.import_rules.map((r) => (r as { match_text: string }).match_text)).toEqual(['metro ticket machine']);
    await restoreBackup(plan, { [JAE_ID]: JAE_ID, [SAM_ID]: SAM_ID }, into.layer);
    await settle(into.layer);
    expect((into.t.importRules ?? []).map((r) => r.match_text)).toEqual(['metro ticket machine']);
  });

  it('IMP-3: a keep rule and a skip rule for the same words replace each other', async () => {
    const c = await household();
    const second = bank('gen:fedcba9876543210:1', '2026-11-04', 'Corner Bakery', 999);
    await startImport([BAKERY, second], 'csv', c.layer);
    const [first, next] = await importQueue(c.layer);
    if (!first || !next) throw new Error('two cards expected');
    await keepImport(first.id, { always: true }, c.layer);
    await settle(c.layer);
    expect((c.t.importRules ?? []).map((r) => r.match_text)).toEqual(['corner bakery']);
    // "Always" on Not ours for the same words: the shared keep rule goes; the skip rule is this phone's.
    await skipImport(next.id, { always: true }, c.layer);
    await settle(c.layer);
    expect(c.t.importRules).toEqual([]);
    expect(importRules(c.layer).map((r) => [r.match_text, r.decision, r.onThisPhone])).toEqual([['corner bakery', 'skip', true]]);
  });
});

describe('review fix 3: Not ours on a made-up id stays on the phone (IMP-3)', () => {
  it('IMP-3: no hash is shared for a "gen:" row; the same row is still never offered again', async () => {
    const c = await household();
    await startImport([BAKERY, LARDER], 'csv', c.layer);
    const callsBefore = c.controls.calls.length;
    await skipImport(await cardId(c.layer, 'Corner Bakery'), { always: false }, c.layer);
    await settle(c.layer);
    expect(c.t.importIgnores ?? []).toEqual([]);
    expect(c.controls.calls.slice(callsBefore).some((call) => /ignore/i.test(call.name))).toBe(false);
    expect(await startImport([BAKERY], 'csv', c.layer)).toEqual({ offered: 0, rules: { keep: 0, skip: 0 }, already: 1 });
  });

  it('IMP-3: a bank’s own id still goes to import_ignores (the partner’s phone needs it)', async () => {
    const c = await household();
    await startImport([LARDER], 'monzo', c.layer);
    await skipImport(await cardId(c.layer, 'Larder & Leaf'), { always: false }, c.layer);
    await settle(c.layer);
    expect(c.t.importIgnores).toHaveLength(1);
  });
});

describe('review fix 4: Undo after Keep (IMP-3)', () => {
  it('IMP-3 OFF-3: a keep not yet sent is withdrawn: nothing reaches the server, and the card is back', async () => {
    const c = await household();
    await startImport([LARDER], 'monzo', c.layer);
    c.network.set(false);
    const id = await keepImport(await cardId(c.layer, 'Larder & Leaf'), undefined, c.layer);
    expect(c.layer.waiting().some((o) => o.table === 'expenses')).toBe(true);
    expect(undoKeep(id, c.layer)).toBe(true);
    expect(c.layer.waiting().some((o) => o.table === 'expenses')).toBe(false);
    expect(c.layer.entries().find((e) => e.id === id)).toBeUndefined();
    expect((await importQueue(c.layer)).map((x) => x.description)).toEqual(['Larder & Leaf']);
    c.network.set(true);
    await settle(c.layer);
    expect(c.controls.tables.expenses).toEqual([]);
    expect(c.controls.calls.some((call) => call.name === 'upsertExpense')).toBe(false);
  });

  it('IMP-3: a keep already sent is deleted with its bank id cleared; the card is back and can be kept again', async () => {
    const c = await household();
    await startImport([LARDER], 'monzo', c.layer);
    const id = await keepImport(await cardId(c.layer, 'Larder & Leaf'), undefined, c.layer);
    await settle(c.layer);
    expect(undoKeep(id, c.layer)).toBe(true);
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.id === id)).toMatchObject({ external_id: null });
    expect(c.controls.tables.expenses.find((e) => e.id === id)?.deleted_at).not.toBeNull();
    expect((await importQueue(c.layer)).map((x) => x.description)).toEqual(['Larder & Leaf']);
    const again = await keepImport(await cardId(c.layer, 'Larder & Leaf'), undefined, c.layer);
    await settle(c.layer);
    expect(c.layer.problems.list()).toEqual([]);
    expect(c.controls.tables.expenses.find((e) => e.id === again)).toMatchObject({ external_id: LARDER.bankId, deleted_at: null, source: 'monzo' });
    expect(c.layer.balance()).toEqual({ [JAE_ID]: 2125, [SAM_ID]: -2125 });
  });

  it('IMP-3: Undo also takes away the keep rule that tap made', async () => {
    const c = await household();
    await startImport([LARDER], 'monzo', c.layer);
    const id = await keepImport(await cardId(c.layer, 'Larder & Leaf'), { always: true }, c.layer);
    await settle(c.layer);
    expect(c.t.importRules).toHaveLength(1);
    undoKeep(id, c.layer);
    await settle(c.layer);
    expect(c.t.importRules).toEqual([]);
  });
});

describe('review fix 5: a made-up id is the importer’s (IMP-3)', () => {
  it('IMP-3: kept, its bank id names the person who imported it', async () => {
    const c = await household();
    await startImport([BAKERY], 'csv', c.layer);
    const id = await keepImport(await cardId(c.layer, 'Corner Bakery'), undefined, c.layer);
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.id === id)?.external_id).toBe(`gen:${JAE_ID}:0123456789abcdef:1`);
  });

  it('IMP-3: the same row on the partner’s own statement is still offered to them; to the importer it is not', async () => {
    const theirs = storedExpense({ id: '00000000-0000-4000-8000-0000000fb001', description: 'Corner Bakery', source: 'csv', external_id: `gen:${JAE_ID}:0123456789abcdef:1` });
    const sam = await household({ as: 'sam', expenses: [theirs] });
    expect(await startImport([BAKERY], 'csv', sam.layer)).toEqual({ offered: 1, rules: { keep: 0, skip: 0 }, already: 0 });
    const jae = await household({ expenses: [theirs] });
    expect(await startImport([BAKERY], 'csv', jae.layer)).toEqual({ offered: 0, rules: { keep: 0, skip: 0 }, already: 1 });
  });
});

describe('review fix 7: removing a keep rule by its words (IMP-3)', () => {
  it('IMP-3: the rule goes even when the other phone’s upsert gave it a new id', async () => {
    const rule = keepRule();
    const c = await household({ rules: [{ ...rule }] });
    // The partner's phone saved the same words again: same rule, a new id, not yet read here.
    const stored = c.t.importRules?.[0];
    if (stored) stored.id = crypto.randomUUID();
    removeImportRule(rule.id, c.layer);
    await settle(c.layer);
    expect(c.t.importRules).toEqual([]);
    expect(importRules(c.layer)).toEqual([]);
  });
});

describe('review fix 8: signing out forgets this phone’s import data (IMP-3)', () => {
  it('IMP-3: waiting rows, phone-only rules and ignores are cleared from storage and memory', async () => {
    const c = await household();
    await startImport([BAKERY, LARDER], 'csv', c.layer);
    await skipImport(await cardId(c.layer, 'Corner Bakery'), { always: true }, c.layer);
    await settle(c.layer);
    const stored = () => [...(idbData.get('smsm-import/rows')?.keys() ?? [])];
    expect(stored().length).toBeGreaterThan(0);
    await signOut({ discardWaiting: true }, c.layer);
    expect(stored()).toEqual([]);
    expect(importRules(c.layer)).toEqual([]);
  });
});

describe('review fix 9: a refused part of a backup is named (EXP-1)', () => {
  it('EXP-1: the database’s "restore expenses: …" becomes RestoreRefusedError for the entries', async () => {
    const from = await household({ expenses: [storedExpense()] });
    const json = backupJson({ appVersion: '0.1.0' }, from.layer);
    const into = await household();
    const plan = restorePlan(json, into.layer);
    if ('error' in plan) throw new Error(plan.error);
    into.controls.refuse = (name) => (name === 'restoreBackup' ? 'restore expenses: shares must sum to amount' : null);
    const err = await restoreBackup(plan, { [JAE_ID]: JAE_ID, [SAM_ID]: SAM_ID }, into.layer).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RestoreRefusedError);
    expect((err as RestoreRefusedError).table).toBe('expenses');
    expect(said(into, 'Lamp')).toBe(true);
  });

  it('EXP-1: a backup from before S6a (no category_guess) restores, its author mapped (memory Api, as the database)', async () => {
    const from = await household({ expenses: [storedExpense({ created_by: SAM_ID, updated_by: SAM_ID })] });
    const v2 = JSON.parse(backupJson({ appVersion: '0.1.0' }, from.layer)) as { expenses: Record<string, unknown>[] };
    const old = { ...v2, format: 'smsm-backup-1', expenses: v2.expenses.map((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== 'category_guess'))) };
    const into = await household();
    const plan = restorePlan(JSON.stringify(old), into.layer);
    if ('error' in plan) throw new Error(plan.error);
    await restoreBackup(plan, { [JAE_ID]: SAM_ID, [SAM_ID]: JAE_ID }, into.layer);
    await settle(into.layer);
    expect(into.controls.tables.expenses[0]).toMatchObject({ category_guess: false, created_by: JAE_ID, paid: { [SAM_ID]: 4000 } });
  });
});
