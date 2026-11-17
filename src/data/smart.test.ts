/**
 * S6a data layer (docs/slices/S6.md "Decisions made here", "Data", "Interfaces → Data", as changed on 17 Nov:
 * Cloudflare Workers AI through smsm's own Worker; the phone side is unchanged): the per-phone smart switch, reading a
 * receipt, receipt photos kept on the phone and uploaded before their entry, "Sort it later", loose wording and the AI
 * category guess, all through injected fakes (tests/fixtures/smart.ts). Written before the build (ENGINEERING §5,
 * tests first by someone else); each test names its SPEC ids and fails because the functions below don't exist yet.
 *
 * Interface these tests expect (exported from src/data/index.ts):
 *   useSmartFeatures(): boolean / setSmartFeatures(on: boolean): void
 *     Per phone (localStorage 'smsm-smart'), off by default, never sent to the server.
 *   readReceipt(photo: Blob, layer?): Promise<{ ok: true; data: ScanReply } | { ok: false; reason }>
 *     Smart off or offline → { ok: false, reason: 'off' } without asking. Otherwise downscale(photo), then
 *     ai.scan(small, { categories: the household's category names, today: layer.today(), country: this phone's
 *     current country }). The reply is validated again on the phone (wrong shape → 'invalid') and put through
 *     scanGuards (src/core/itemise.ts): low confidence → { ok: false, reason: 'invalid' }; a future date → date null.
 *     The service's own ok:false reasons pass through; a service that throws → 'error'.
 *   parseLoose(text: string, layer?): Promise<{ ok: true; data: LooseReading } | { ok: false; reason }>
 *     Smart off or offline → 'off' without asking. The two people's names in the text are replaced by "A" (me) and
 *     "B" (partner) as whole words, any case, before it is sent (AI.md §1.4); ctx = { categories: names, chapters:
 *     open chapter names, today }. The reply maps back to the app:
 *       LooseReading { amount: Pence | null; description: string | null; categoryId: string | null;
 *                      payer: UserId | null; date: IsoDate | null; tags: string[]; chapterId: string | null; ... }
 *     (A → me, B → partner; a category or chapter not the household's → null; a date after today → null; an amount
 *     that isn't a positive whole number of pence → null).
 *   guessCategory(expenseId: string, layer?): void | Promise<void>     fire and forget (CAT-2 step 4)
 *     Only with smart on and online, only for an entry whose category is unset or Other and for which CAT-2 steps 1–3
 *     (core/categorise suggest: memory, history, the built-in list) find nothing. ai.categorise(description, names);
 *     a name of the household's → the entry's category is set through the queue (an edit by this phone) with
 *     category_guess = true, and category_memory gets { key: normaliseKey(description), category_id, source: 'ai' }.
 *     If a person has set the category in the meantime, nothing changes. Any later category change by a person
 *     (editExpense with categoryId) sets category_guess = false.
 *   attachPhoto(photo: Blob, layer?): Promise<string>
 *     → receipt_path '<household_id>/<uuid>.jpg'; downscale(photo), kept with photos.put(path, small), and queued for
 *     upload (api.uploadReceipt(path, small)) in its own persisted queue; an entry or Inbox item naming that path is
 *     not sent until its photo is uploaded. A refused upload is reported with the other problems (OFF-5).
 *   photoUrl(path: string, layer?): Promise<string | null>   the local copy (an object URL) or api.receiptUrl(path)
 *   sortLater(photo: Blob, layer?): Promise<string>
 *     attachPhoto, then an Inbox item { source: 'scan', status: 'open', receipt_path } through the queue; its id.
 *   Data layer options gain `ai: AiService`, `photos: PhotoStore`, `downscale` (tests/fixtures/smart.ts has the shapes).
 *   ExpenseDraft gains receiptPath?: string | null (→ receipt_path), items?: { label, pence, shared }[] | null
 *     (→ items) and billTotal?: Pence | null (→ bill_total_pence). ExpenseRow gains category_guess.
 *   Api gains uploadReceipt(path: string, photo: Blob): Promise<void> and receiptUrl(path): Promise<string>, and a way
 *     to add an Inbox item (its call's name contains "inbox"). The in-memory Api records `uploadReceipt` calls in
 *     controls.calls, honours controls.refuse/delay for it, and keeps uploads in MemoryTables.receipts:
 *     { path: string; size: number; type: string }[].
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { categoryId, couple, HID, JAE_ID, SAM_ID, storedChapter, storedExpense, TODAY } from '../../tests/fixtures/couple';
import { deferred, fakeAi, fakeDownscale, memoryPhotos, receiptPhoto, recorded, type AiResult } from '../../tests/fixtures/smart';
import { pence, type Pence } from '../core/money';
import { normaliseKey } from '../core/text';
import { DataProvider } from './DataProvider';
import * as hooksModule from './hooks';
import * as dataIndex from './index';
import type { MemoryTables } from './memoryApi';
import * as mutations from './mutations';
import type { DataLayer } from './queryClient';
import { memoryStorage } from './storage';
import type { ExpenseDraft } from './writes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ───────── the interface above, typed so this file compiles before it exists ─────────
type Reason = 'off' | 'limit' | 'timeout' | 'invalid' | 'error';
type Result<T> = { ok: true; data: T } | { ok: false; reason: Reason };
interface ScanReply {
  merchant: string | null; date: string | null; currency: string | null; total_pence: number | null;
  items: { label: string; pence: number }[]; discount_pence: number; service_pence: number; category: string | null; confidence: string;
}
interface LooseReading {
  amount: Pence | null; description: string | null; categoryId: string | null; payer: string | null; date: string | null;
  tags: string[]; chapterId: string | null;
}
interface S6aData {
  useSmartFeatures(): boolean;
  setSmartFeatures(on: boolean): void;
  readReceipt(photo: Blob, layer?: DataLayer): Promise<Result<ScanReply>>;
  parseLoose(text: string, layer?: DataLayer): Promise<Result<LooseReading>>;
  guessCategory(expenseId: string, layer?: DataLayer): void | Promise<void>;
  attachPhoto(photo: Blob, layer?: DataLayer): Promise<string>;
  photoUrl(path: string, layer?: DataLayer): Promise<string | null>;
  sortLater(photo: Blob, layer?: DataLayer): Promise<string>;
}
type S6aDraft = ExpenseDraft & { receiptPath?: string | null; items?: { label: string; pence: Pence; shared: boolean }[] | null; billTotal?: Pence | null };
const data = { ...(hooksModule as object), ...(mutations as object), ...(dataIndex as object) } as unknown as S6aData & typeof hooksModule;
const m = mutations as unknown as typeof mutations & {
  addExpense(input: S6aDraft & { id?: string }, layer?: DataLayer): string;
  editExpense(id: string, patch: Partial<S6aDraft>, layer?: DataLayer): void;
};
type Receipt = { path: string; size: number; type: string };
type S6aTables = MemoryTables & { receipts?: Receipt[] };
const tablesOf = (c: { controls: { tables: MemoryTables } }) => c.controls.tables as S6aTables;
const receipts = (c: { controls: { tables: MemoryTables } }) => tablesOf(c).receipts ?? [];
const guessOf = (row: unknown) => (row as { category_guess?: boolean } | undefined)?.category_guess;

// ───────── helpers ─────────
const open: DataLayer[] = [];
beforeEach(() => { localStorage.clear(); });
afterEach(async () => {
  for (const l of open.splice(0)) await l.dispose();
});

function household(opts: Parameters<typeof couple>[0] = {}) {
  const c = couple({ photos: memoryPhotos(), downscale: fakeDownscale(), ...opts });
  open.push(c.layer);
  return c;
}
const wrapperFor = (layer: DataLayer) => ({ children }: { children: ReactNode }) => createElement(DataProvider, { layer, children });
async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}
function smartOn() {
  expect(typeof data.setSmartFeatures, 'setSmartFeatures').toBe('function');
  act(() => { data.setSmartFeatures(true); });
}
const even = { mode: 'ratio' as const, ratio: { [JAE_ID]: 50, [SAM_ID]: 50 } };
const draft = (over: Partial<S6aDraft> = {}): S6aDraft => ({
  description: 'Big shop', amount: pence(1399), date: TODAY, categoryId: categoryId('Groceries'), payer: JAE_ID, split: even, ...over,
});
const PATH = new RegExp(`^${HID}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.jpg$`);
const GOOD = recorded('scan-good');
const ok = (d: unknown): AiResult => ({ ok: true, data: d });
const fails = (reason: Reason): AiResult => ({ ok: false, reason });
const callIndex = (c: { controls: { calls: { name: string; arg: unknown }[] } }, test: (name: string, arg: unknown) => boolean) =>
  c.controls.calls.findIndex((call) => test(call.name, call.arg));
const mentions = (arg: unknown, s: string) => JSON.stringify(arg ?? null).includes(s);

// ─────────────────────────────── the switch, per phone ───────────────────────────────

describe('the smart switch (SCAN-5; S6 "One switch")', () => {
  it('SCAN-5: off until turned on', async () => {
    const c = household();
    await c.layer.ready;
    const view = renderHook(() => data.useSmartFeatures(), { wrapper: wrapperFor(c.layer) });
    expect(view.result.current).toBe(false);
    view.unmount();
  });

  it('SCAN-5: setSmartFeatures is kept on this phone (localStorage "smsm-smart"), the hook follows it, and it survives a restart', async () => {
    const c = household();
    await c.layer.ready;
    await settle(c.layer);
    const view = renderHook(() => data.useSmartFeatures(), { wrapper: wrapperFor(c.layer) });
    smartOn();
    await waitFor(() => { expect(view.result.current).toBe(true); });
    expect(localStorage.getItem('smsm-smart')).not.toBeNull();
    view.unmount();
    const again = household();
    await again.layer.ready;
    const view2 = renderHook(() => data.useSmartFeatures(), { wrapper: wrapperFor(again.layer) });
    expect(view2.result.current).toBe(true);
    act(() => { data.setSmartFeatures(false); });
    await waitFor(() => { expect(view2.result.current).toBe(false); });
    view2.unmount();
  });

  it('SCAN-5: it is this phone’s choice only: nothing about it reaches the server', async () => {
    const c = household();
    await c.layer.ready;
    await settle(c.layer);
    const before = c.controls.calls.length;
    smartOn();
    await settle(c.layer);
    // Only reads may happen meanwhile (a refetch); no write, and nothing mentions the setting.
    const after = c.controls.calls.slice(before);
    expect(after.filter((call) => /^(upsert|patch|set|request|decide|create|join)/.test(call.name))).toEqual([]);
    expect(after.some((call) => /smart/i.test(call.name) || /smart/i.test(JSON.stringify(call.arg ?? null)))).toBe(false);
  });
});

// ─────────────────────────────── SCAN-1, SCAN-5: reading a receipt ───────────────────────────────

describe('readReceipt (SCAN-1, SCAN-5, TXT-5; AI.md §4)', () => {
  it('SCAN-1: a good reply comes back as the receipt’s fields; the photo sent is the shrunk one, with only categories, today and the country', async () => {
    const ai = fakeAi({ scan: ok(GOOD) });
    const downscale = fakeDownscale();
    const c = household({ ai, downscale });
    await c.layer.ready;
    smartOn();
    const photo = receiptPhoto();
    const r = await data.readReceipt(photo, c.layer);
    expect(r).toEqual({ ok: true, data: GOOD });
    expect(downscale).toHaveBeenCalledWith(photo);
    expect(ai.scan).toHaveBeenCalledTimes(1);
    const [sent, ctx] = ai.scan.mock.calls[0] ?? [];
    expect(sent).toBe(downscale.made[0]);
    expect(ctx).toMatchObject({ today: TODAY, country: 'GB' });
    const names = (ctx as { categories: string[] }).categories;
    expect(names).toEqual(expect.arrayContaining(['Groceries', 'Eating out', 'Household']));
    // Least data (AI.md §1.4): no names, no ids, no balances.
    for (const s of ['Jae', 'Sam', HID, JAE_ID, SAM_ID, 'jaetest']) expect(mentions(ctx, s)).toBe(false);
  });

  it('SCAN-1: on a trip, the country sent is this phone’s current one', async () => {
    localStorage.setItem('smsm-current-country', 'JP');
    const ai = fakeAi({ scan: ok(recorded('scan-japanese')) });
    const c = household({ ai });
    await c.layer.ready;
    smartOn();
    const r = await data.readReceipt(receiptPhoto(), c.layer);
    expect(ai.scan.mock.calls[0]?.[1]).toMatchObject({ country: 'JP' });
    expect(r.ok && r.data.merchant).toBe('ローソン 京都四条店');
  });

  it('TXT-5: a Japanese receipt’s names come back as printed', async () => {
    const c = household({ ai: fakeAi({ scan: ok(recorded('scan-japanese')) }) });
    await c.layer.ready;
    smartOn();
    const r = await data.readReceipt(receiptPhoto(), c.layer);
    expect(r.ok && r.data.items.map((i) => i.label)).toEqual(['おにぎり 鮭', 'お茶 500ml', 'からあげクン']);
  });

  it('SCAN-5: with smart features off nothing is sent: "off"', async () => {
    const ai = fakeAi({ scan: ok(GOOD) });
    const c = household({ ai });
    await c.layer.ready;
    expect(await data.readReceipt(receiptPhoto(), c.layer)).toEqual({ ok: false, reason: 'off' });
    expect(ai.scan).not.toHaveBeenCalled();
  });

  it('SCAN-5: offline is the same as off: nothing is sent', async () => {
    const ai = fakeAi({ scan: ok(GOOD) });
    const c = household({ ai });
    await c.layer.ready;
    await settle(c.layer);
    smartOn();
    c.network.set(false);
    expect(await data.readReceipt(receiptPhoto(), c.layer)).toEqual({ ok: false, reason: 'off' });
    expect(ai.scan).not.toHaveBeenCalled();
  });

  for (const reason of ['off', 'limit', 'timeout', 'invalid', 'error'] as const) {
    it(`SCAN-5: the service answering "${reason}" is ok:false "${reason}"`, async () => {
      const c = household({ ai: fakeAi({ scan: fails(reason) }) });
      await c.layer.ready;
      smartOn();
      expect(await data.readReceipt(receiptPhoto(), c.layer)).toEqual({ ok: false, reason });
    });
  }

  it('SCAN-5: a low-confidence reading is treated as no reply ("invalid")', async () => {
    const c = household({ ai: fakeAi({ scan: ok(recorded('scan-low-confidence')) }) });
    await c.layer.ready;
    smartOn();
    expect(await data.readReceipt(receiptPhoto(), c.layer)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('SCAN-5: a reply of the wrong shape is checked again on the phone and discarded ("invalid")', async () => {
    const c = household({ ai: fakeAi({ scan: ok({ ...GOOD, total_pence: '13.99', extra: true }) }) });
    await c.layer.ready;
    smartOn();
    expect(await data.readReceipt(receiptPhoto(), c.layer)).toEqual({ ok: false, reason: 'invalid' });
  });

  it('SCAN-5: a service that throws (the connection drops) is "error"', async () => {
    const c = household({ ai: fakeAi({ scan: () => Promise.reject(new TypeError('Failed to fetch')) }) });
    await c.layer.ready;
    smartOn();
    expect(await data.readReceipt(receiptPhoto(), c.layer)).toEqual({ ok: false, reason: 'error' });
  });

  it('SCAN-1: a future date on the receipt is ignored; the rest comes back', async () => {
    const c = household({ ai: fakeAi({ scan: ok(recorded('scan-future-date')) }) });
    await c.layer.ready;
    smartOn();
    const r = await data.readReceipt(receiptPhoto(), c.layer);
    expect(r.ok && r.data.date).toBeNull();
    expect(r.ok && r.data.total_pence).toBe(1399);
  });

  it('SCAN-5: reading never writes anything (nothing is saved until Save)', async () => {
    const c = household({ ai: fakeAi({ scan: ok(GOOD) }) });
    await c.layer.ready;
    await settle(c.layer);
    smartOn();
    await data.readReceipt(receiptPhoto(), c.layer);
    await settle(c.layer);
    expect(c.controls.tables.expenses).toEqual([]);
    expect(c.controls.calls.some((call) => /^upsert|^patch|inbox/i.test(call.name) && call.name !== 'inboxItems')).toBe(false);
  });
});

// ─────────────────────────────── SCAN-1, SCAN-5: photos ───────────────────────────────

describe('attachPhoto and photoUrl (SCAN-1, SCAN-5, OFF-2, OFF-5)', () => {
  it('SCAN-1 OFF-2: offline, the photo is kept on the phone and its entry saves at once with its path; online, the photo goes up first, then the entry', async () => {
    const photos = memoryPhotos();
    const downscale = fakeDownscale();
    const c = household({ photos, downscale });
    await c.layer.ready;
    await settle(c.layer);
    c.network.set(false);
    const view = renderHook(() => ({ entries: data.useEntries(), sync: data.useSyncStatus() }), { wrapper: wrapperFor(c.layer) });

    const path = await data.attachPhoto(receiptPhoto(), c.layer);
    expect(path).toMatch(PATH);
    expect(photos.map.get(path)).toBe(downscale.made[0]);
    let id = '';
    act(() => { id = m.addExpense({ ...draft(), receiptPath: path }, c.layer); });
    await waitFor(() => { expect(view.result.current.entries.data?.find((e) => e.id === id)?.receipt_path).toBe(path); });
    expect(view.result.current.sync.waiting).toBeGreaterThanOrEqual(1);
    expect(receipts(c)).toEqual([]);
    expect(c.controls.tables.expenses).toEqual([]);
    // Until it is uploaded, the phone shows its own copy.
    expect(await data.photoUrl(path, c.layer)).toBeTruthy();

    // The entry's write waits for its photo, even when the upload is slow.
    let photoThereWhenEntrySent: boolean | null = null;
    c.controls.delay = (name) => (name === 'uploadReceipt' ? 120 : 0);
    c.controls.refuse = (name, arg) => {
      if (name === 'upsertExpense' && mentions(arg, path) && photoThereWhenEntrySent === null) photoThereWhenEntrySent = receipts(c).some((r) => r.path === path);
      return null;
    };
    c.network.set(true);
    await settle(c.layer);
    await waitFor(() => { expect(c.controls.tables.expenses.find((e) => e.id === id)?.receipt_path).toBe(path); });
    expect(receipts(c).map((r) => r.path)).toEqual([path]);
    expect(receipts(c)[0]?.size).toBe(downscale.made[0]?.size);
    const up = callIndex(c, (name) => name === 'uploadReceipt');
    const entry = callIndex(c, (name, arg) => name === 'upsertExpense' && mentions(arg, path));
    expect(up).toBeGreaterThanOrEqual(0);
    expect(entry).toBeGreaterThan(up);
    expect(photoThereWhenEntrySent).toBe(true);
    await waitFor(() => { expect(view.result.current.sync.waiting).toBe(0); });
    view.unmount();
  });

  it('SCAN-1: online, the photo is uploaded straight away and the entry follows', async () => {
    const c = household();
    await c.layer.ready;
    await settle(c.layer);
    const path = await data.attachPhoto(receiptPhoto(), c.layer);
    const id = m.addExpense({ ...draft(), receiptPath: path }, c.layer);
    await settle(c.layer);
    expect(receipts(c).map((r) => r.path)).toEqual([path]);
    expect(c.controls.tables.expenses.find((e) => e.id === id)?.receipt_path).toBe(path);
  });

  it('OFF-5: a photo and its entry made offline survive closing the app; both go up later, the photo first', async () => {
    const storage = memoryStorage();
    const photos = memoryPhotos();
    const first = household({ storage, photos });
    await first.layer.ready;
    await settle(first.layer);
    first.network.set(false);
    const path = await data.attachPhoto(receiptPhoto(), first.layer);
    const id = m.addExpense({ ...draft(), receiptPath: path }, first.layer);
    await settle(first.layer);
    await first.layer.dispose();
    open.splice(open.indexOf(first.layer), 1);

    const second = household({ storage, photos, online: true });
    await second.layer.ready;
    await settle(second.layer);
    await waitFor(() => { expect(second.controls.tables.expenses.find((e) => e.id === id)?.receipt_path).toBe(path); });
    expect(receipts(second).map((r) => r.path)).toEqual([path]);
    expect(callIndex(second, (name, arg) => name === 'upsertExpense' && mentions(arg, path))).toBeGreaterThan(callIndex(second, (name) => name === 'uploadReceipt'));
  });

  it('OFF-5: a photo the server refuses is reported with the other problems; the entry is not dropped', async () => {
    const c = household();
    await c.layer.ready;
    await settle(c.layer);
    c.controls.refuse = (name) => (name === 'uploadReceipt' ? 'new row violates row-level security policy for table "objects"' : null);
    const view = renderHook(() => ({ entries: data.useEntries(), sync: data.useSyncStatus() }), { wrapper: wrapperFor(c.layer) });
    const path = await data.attachPhoto(receiptPhoto(), c.layer);
    let id = '';
    act(() => { id = m.addExpense({ ...draft(), receiptPath: path }, c.layer); });
    await settle(c.layer);
    await waitFor(() => { expect(view.result.current.sync.problems.length).toBeGreaterThanOrEqual(1); });
    const kept = view.result.current.entries.data?.some((e) => e.id === id) || c.controls.tables.expenses.some((e) => e.id === id);
    expect(kept).toBe(true);
    view.unmount();
  });

  it('SCAN-1: a stored photo’s address comes from the server when this phone has no copy', async () => {
    const path = `${HID}/00000000-0000-4000-8000-0000000000f1.jpg`;
    const c = household({ expenses: [storedExpense({ receipt_path: path })] });
    await c.layer.ready;
    await settle(c.layer);
    const url = await data.photoUrl(path, c.layer);
    expect(url).toBeTruthy();
    expect(c.controls.calls.some((call) => call.name === 'receiptUrl')).toBe(true);
  });

  it('SCAN-2: an itemised entry keeps its lines, which were shared, and the receipt’s total', async () => {
    const c = household();
    await c.layer.ready;
    const items = [
      { label: 'Milk', pence: pence(120), shared: true }, { label: 'Sourdough', pence: pence(250), shared: true },
      { label: 'Bananas', pence: pence(95), shared: true }, { label: 'Washing-up liquid', pence: pence(135), shared: true },
      { label: 'Red wine', pence: pence(899), shared: false },
    ];
    const id = m.addExpense({ ...draft({ amount: pence(560) }), items, billTotal: pence(1399) }, c.layer);
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.id === id)).toMatchObject({ amount_pence: 560, bill_total_pence: 1399, items });
  });
});

// ─────────────────────────────── SCAN-4: Sort it later ───────────────────────────────

describe('sortLater (SCAN-4, INB-1, INB-3)', () => {
  it('SCAN-4 INB-1: the photo goes to the Inbox as a scan item, offline too; online, the photo goes up before the item', async () => {
    const c = household();
    await c.layer.ready;
    await settle(c.layer);
    c.network.set(false);
    const id = await data.sortLater(receiptPhoto(), c.layer);
    expect(typeof id).toBe('string');
    c.network.set(true);
    await settle(c.layer);
    await waitFor(() => { expect(c.controls.tables.inboxItems.find((i) => i.id === id)).toBeTruthy(); });
    const item = c.controls.tables.inboxItems.find((i) => i.id === id);
    expect(item).toMatchObject({ household_id: HID, source: 'scan', status: 'open', expense_id: null });
    expect(item?.receipt_path).toMatch(PATH);
    expect(receipts(c).map((r) => r.path)).toEqual([item?.receipt_path]);
    const up = callIndex(c, (name) => name === 'uploadReceipt');
    const inbox = callIndex(c, (name, arg) => /inbox/i.test(name) && name !== 'inboxItems' && mentions(arg, id));
    expect(inbox).toBeGreaterThan(up);
  });

  it('INB-3 SCAN-5: sorting it later saves no money', async () => {
    const c = household();
    await c.layer.ready;
    await data.sortLater(receiptPhoto(), c.layer);
    await settle(c.layer);
    expect(c.controls.tables.expenses).toEqual([]);
  });
});

// ─────────────────────────────── ADD-9: loose wording ───────────────────────────────

const DISHOOM = { amount_pence: 4200, description: 'Dishoom', category: 'Eating out', payer: 'B', split: null, date: '2026-11-13', tags: [], chapter: null };

describe('parseLoose (ADD-9; AI.md §3.2)', () => {
  it('ADD-9: the reply maps to the app: £42.00, Dishoom, Eating out, Sam paid (B), 13 Nov', async () => {
    const ai = fakeAi({ parse: ok(DISHOOM) });
    const c = household({ ai });
    await c.layer.ready;
    smartOn();
    const r = await data.parseLoose('dinner at dishoom, forty two quid, sam got it', c.layer);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ amount: 4200, description: 'Dishoom', categoryId: categoryId('Eating out'), payer: SAM_ID, date: '2026-11-13', chapterId: null });
  });

  it('ADD-9: people are sent as A and B, never by name; only the words, the category and chapter names and today go', async () => {
    const japan = storedChapter();
    const ai = fakeAi({ parse: ok({ ...DISHOOM, payer: 'A', chapter: 'Japan' }) });
    const c = household({ ai, chapters: [japan] });
    await c.layer.ready;
    smartOn();
    const r = await data.parseLoose('Sam and I had ramen, jae paid forty quid', c.layer);
    const [text, ctx] = ai.parse.mock.calls[0] ?? [];
    expect(String(text)).not.toMatch(/\bsam\b|\bjae\b/i);
    expect(String(text)).toMatch(/\bB\b/);
    expect(String(text)).toMatch(/\bA\b/);
    expect(String(text)).toMatch(/ramen/);
    expect(ctx).toMatchObject({ today: TODAY, chapters: ['Japan'] });
    expect((ctx as { categories: string[] }).categories).toEqual(expect.arrayContaining(['Eating out', 'Groceries']));
    for (const s of ['Jae', 'Sam', HID, JAE_ID, SAM_ID]) expect(mentions(ctx, s)).toBe(false);
    expect(r.ok && r.data.payer).toBe(JAE_ID);
    expect(r.ok && r.data.chapterId).toBe(japan.id);
  });

  it('ADD-9: a category or chapter that isn’t the household’s, a future date or a bad amount is left empty', async () => {
    const c = household({ ai: fakeAi({ parse: ok({ ...DISHOOM, amount_pence: -5, category: 'Pets', chapter: 'Mars', date: '2026-12-25' }) }) });
    await c.layer.ready;
    smartOn();
    const r = await data.parseLoose('something loose', c.layer);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).toMatchObject({ amount: null, categoryId: null, chapterId: null, date: null, description: 'Dishoom' });
  });

  it('ADD-9: smart off or offline: nothing is sent ("off")', async () => {
    const ai = fakeAi({ parse: ok(DISHOOM) });
    const c = household({ ai });
    await c.layer.ready;
    await settle(c.layer);
    expect(await data.parseLoose('dinner forty two', c.layer)).toEqual({ ok: false, reason: 'off' });
    smartOn();
    c.network.set(false);
    expect(await data.parseLoose('dinner forty two', c.layer)).toEqual({ ok: false, reason: 'off' });
    expect(ai.parse).not.toHaveBeenCalled();
  });

  for (const reason of ['limit', 'timeout', 'invalid', 'error'] as const) {
    it(`ADD-9 SCAN-5: the service answering "${reason}" is ok:false (the full form opens with the words, as before)`, async () => {
      const c = household({ ai: fakeAi({ parse: fails(reason) }) });
      await c.layer.ready;
      smartOn();
      expect(await data.parseLoose('dinner forty two', c.layer)).toEqual({ ok: false, reason });
    });
  }

  it('ADD-9: a reply naming a person instead of A or B is discarded on the phone ("invalid")', async () => {
    const c = household({ ai: fakeAi({ parse: ok({ ...DISHOOM, payer: 'Sam' }) }) });
    await c.layer.ready;
    smartOn();
    expect(await data.parseLoose('dinner forty two', c.layer)).toEqual({ ok: false, reason: 'invalid' });
  });
});

// ─────────────────────────────── CAT-2 step 4: the AI guess ───────────────────────────────

describe('guessCategory (CAT-2 step 4; AI.md §3.3)', () => {
  const ZZ = 'Zzyzx Emporium';
  const guessed = (category: string | null = 'Household') => fakeAi({ categorise: ok({ category }) });

  async function saved(c: ReturnType<typeof household>, over: Partial<S6aDraft> = {}) {
    await c.layer.ready;
    await settle(c.layer);
    const id = m.addExpense(draft({ description: ZZ, amount: pence(1800), categoryId: null, ...over }), c.layer);
    await settle(c.layer);
    return id;
  }

  it('CAT-2: nothing in memory, history or the built-in list: the guess is asked for, set as a guess by this phone, and remembered as the AI’s', async () => {
    const ai = guessed();
    const c = household({ ai });
    smartOn();
    const id = await saved(c);
    await data.guessCategory(id, c.layer);
    await settle(c.layer);
    expect(ai.categorise).toHaveBeenCalledTimes(1);
    const [description, names] = ai.categorise.mock.calls[0] ?? [];
    expect(description).toBe(ZZ);
    expect(names).toEqual(expect.arrayContaining(['Household', 'Groceries']));
    const row = c.controls.tables.expenses.find((e) => e.id === id);
    expect(row).toMatchObject({ category_id: categoryId('Household'), updated_by: JAE_ID });
    expect(guessOf(row)).toBe(true);
    expect(c.controls.tables.categoryMemory.find((r) => r.key === normaliseKey(ZZ))).toMatchObject({ household_id: HID, category_id: categoryId('Household'), source: 'ai' });
  });

  it('CAT-2: an entry saved as Other is guessed too', async () => {
    const ai = guessed();
    const c = household({ ai });
    smartOn();
    const id = await saved(c, { categoryId: categoryId('Other') });
    await data.guessCategory(id, c.layer);
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.id === id)?.category_id).toBe(categoryId('Household'));
  });

  it('CAT-2: the same description never costs a second call: the remembered guess answers', async () => {
    const ai = guessed();
    const c = household({ ai });
    smartOn();
    const first = await saved(c);
    await data.guessCategory(first, c.layer);
    await settle(c.layer);
    const second = m.addExpense(draft({ description: ZZ, amount: pence(900), categoryId: null }), c.layer);
    await settle(c.layer);
    await data.guessCategory(second, c.layer);
    await settle(c.layer);
    expect(ai.categorise).toHaveBeenCalledTimes(1);
  });

  it('CAT-2: steps 1–3 come first: a description the built-in list knows ("Tesco") is never sent', async () => {
    const ai = guessed('Gifts');
    const c = household({ ai });
    smartOn();
    const id = await saved(c, { description: 'Tesco' });
    await data.guessCategory(id, c.layer);
    await settle(c.layer);
    expect(ai.categorise).not.toHaveBeenCalled();
  });

  it('CAT-2: steps 1–3 come first: one the household’s history knows is never sent', async () => {
    const ai = guessed('Gifts');
    const c = household({ ai, expenses: [storedExpense({ id: '00000000-0000-4000-8000-00000000e0aa', description: ZZ, category_id: categoryId('Travel') })] });
    smartOn();
    const id = await saved(c);
    await data.guessCategory(id, c.layer);
    await settle(c.layer);
    expect(ai.categorise).not.toHaveBeenCalled();
  });

  it('CAT-2: a category a person chose is never guessed over', async () => {
    const ai = guessed('Gifts');
    const c = household({ ai });
    smartOn();
    const id = await saved(c, { categoryId: categoryId('Groceries') });
    await data.guessCategory(id, c.layer);
    await settle(c.layer);
    expect(ai.categorise).not.toHaveBeenCalled();
    expect(c.controls.tables.expenses.find((e) => e.id === id)?.category_id).toBe(categoryId('Groceries'));
  });

  it('CAT-2: a person setting the category while the guess is on its way wins; the late guess changes nothing', async () => {
    const answer = deferred<AiResult>();
    const ai = fakeAi({ categorise: () => answer.promise });
    const c = household({ ai });
    smartOn();
    const id = await saved(c);
    const pending = data.guessCategory(id, c.layer);
    m.editExpense(id, { categoryId: categoryId('Gifts') }, c.layer);
    await settle(c.layer);
    answer.resolve(ok({ category: 'Household' }));
    await pending;
    await settle(c.layer);
    const row = c.controls.tables.expenses.find((e) => e.id === id);
    expect(row?.category_id).toBe(categoryId('Gifts'));
    expect(guessOf(row)).toBe(false);
  });

  it('CAT-2: a person’s later choice clears the guess mark, and their choice overwrites the AI’s memory', async () => {
    const c = household({ ai: guessed() });
    smartOn();
    const id = await saved(c);
    await data.guessCategory(id, c.layer);
    await settle(c.layer);
    m.editExpense(id, { categoryId: categoryId('Gifts') }, c.layer);
    mutations.rememberChoice(ZZ, { categoryId: categoryId('Gifts') }, c.layer);
    await settle(c.layer);
    const row = c.controls.tables.expenses.find((e) => e.id === id);
    expect(row?.category_id).toBe(categoryId('Gifts'));
    expect(guessOf(row)).toBe(false);
    expect(c.controls.tables.categoryMemory.find((r) => r.key === normaliseKey(ZZ))).toMatchObject({ category_id: categoryId('Gifts'), source: 'user' });
  });

  it('CAT-2: a guess that isn’t one of the household’s categories, or no guess, changes nothing and remembers nothing', async () => {
    for (const category of ['Pets', null]) {
      const c = household({ ai: guessed(category) });
      smartOn();
      const id = await saved(c);
      await data.guessCategory(id, c.layer);
      await settle(c.layer);
      const row = c.controls.tables.expenses.find((e) => e.id === id);
      expect(row?.category_id).toBeNull();
      expect(guessOf(row)).toBe(false);
      expect(c.controls.tables.categoryMemory.some((r) => r.key === normaliseKey(ZZ))).toBe(false);
    }
  });

  it('CAT-2: smart off or offline: never asked; the entry stays as saved', async () => {
    const ai = guessed();
    const c = household({ ai });
    const id = await saved(c);
    await data.guessCategory(id, c.layer);
    smartOn();
    c.network.set(false);
    await data.guessCategory(id, c.layer);
    await settle(c.layer);
    expect(ai.categorise).not.toHaveBeenCalled();
  });

  it('CAT-2 SCAN-5: the service failing leaves the entry as saved', async () => {
    const c = household({ ai: fakeAi({ categorise: fails('timeout') }) });
    smartOn();
    const id = await saved(c);
    await data.guessCategory(id, c.layer);
    await settle(c.layer);
    expect(c.controls.tables.expenses.find((e) => e.id === id)?.category_id).toBeNull();
  });
});
