/**
 * S6b data layer (docs/slices/S6b.md "Decisions made here", "Data", "Interfaces → Data"; docs/AI.md §1, §3.4, §3.5,
 * §4; SPEC INS-2, INS-9, ADD-8): the recap's AI wording (asked once per household per finished month, kept with the
 * save_recap_prose RPC, read by the partner), Ask smsm's question, and what the service worker kept from Android's
 * share sheet, all through injected fakes (tests/fixtures/smart.ts) and the in-memory Api. Written before the build
 * (ENGINEERING §5, tests first by someone else); each test names its SPEC ids.
 *
 * Interface these tests expect (exported from src/data/index.ts):
 *   AiService gains recap(stats: RecapStats) and ask(question, ctx: { categories; chapters; countries; today }),
 *   each → Promise<{ ok: true; data } | { ok: false; reason }> (tests/fixtures/smart.ts fakeAi has both).
 *
 *   recapWording(month: 'YYYY-MM', layer?): Promise<{ headline: string; aside: string | null } | null>
 *     null at once, asking nothing, when smart features are off on this phone (even if wording is stored: this phone
 *     shows the template), when the month isn't finished (the so-far recap is never worded by the AI), or when
 *     offline with nothing stored. Otherwise:
 *     1. The household's stored wording for the month (recaps.prose) first. recaps.prose is the JSON text of the reply
 *        as the AI wrote it ({ headline, aside }, people as A and B), so each phone puts in the names itself.
 *     2. Else, once: ai.recap(recapStats(recapOf(the month…), [the member who joined first, the other])). A valid
 *        reply (aiReplies recap schema) that passes wordingGuard is kept with the RPC (Api saveRecapProse(period,
 *        stats, prose); the in-memory Api records the call as 'saveRecapProse') and the wording returned is the one
 *        the RPC answers (the partner's, if theirs got there first). A failed save still shows the wording.
 *     Either way it goes through wordingGuard(today's stats, prose, { A: first-joined's name, B: the other's }); a
 *     failure of any kind (a reason, a throw, a bad shape, the guard) → null, nothing kept, and not asked again for
 *     that month while the app runs. A = the first to join (not "me"), so both phones read the same sentence.
 *
 *   askSmsm(question: string, layer?): Promise<{ ok: true; data: AskReply } | { ok: false; reason }>
 *     Smart off or offline → { ok: false, reason: 'off' } without asking. The two people's names in the question are
 *     replaced by "A" (me) and "B" (partner) as whole words, any case, before it is sent (AI.md §1.4). ctx: the
 *     household's category names, chapter names, the countries present in its live entries (ISO2), today. The reply
 *     is validated again on the phone (askSchema; wrong shape → 'invalid'); the service's own reasons pass through;
 *     a service that throws → 'error'. { unsupported: true } is ok: true.
 *
 *   takeShared(layer?): Promise<{ photo?: Blob; text?: string } | null>
 *     What the service worker kept from POST /share (manifest share_target), read and cleared:
 *       - IndexedDB database 'smsm-shared', object store 'shared' (idb-keyval createStore('smsm-shared', 'shared')),
 *         key 'latest': { photo: string | null; text: string | null } — photo is a key in the photo store, text the
 *         shared text (the worker joins title, text and url as it sees fit);
 *       - the photo itself in the phone's photo store (IndexedDB 'smsm-photos', the layer's `photos`) under
 *         'shared/<uuid>'.
 *     Returns what's there ({ photo } and/or { text }; blank text left out), then deletes the record and the shared
 *     photo (photos.remove), so a second call is null. Nothing kept → null. Nothing is sent anywhere.
 */
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { categoryId, couple, HID, JAE_ID, SAM_ID, storedChapter, storedExpense, TODAY, type RecapRow } from '../../tests/fixtures/couple';
import { idbData } from '../../tests/fixtures/fake-idb-keyval';
import { fakeAi, fakeDownscale, memoryPhotos, receiptPhoto, type AiResult } from '../../tests/fixtures/smart';
import type { ExpenseRow } from './api';
import * as dataIndex from './index';
import type { MemoryTables } from './memoryApi';
import * as mutations from './mutations';
import type { DataLayer } from './queryClient';

vi.mock('idb-keyval', async () => (await import('../../tests/fixtures/fake-idb-keyval')).fakeIdbKeyval);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ───────── the interface above, typed so this file compiles before it exists ─────────
type Reason = 'off' | 'limit' | 'timeout' | 'invalid' | 'error';
type Result<T> = { ok: true; data: T } | { ok: false; reason: Reason };
type Wording = { headline: string; aside: string | null };
interface S6bData {
  setSmartFeatures(on: boolean): void;
  recapWording(month: string, layer?: DataLayer): Promise<Wording | null>;
  askSmsm(question: string, layer?: DataLayer): Promise<Result<unknown>>;
  takeShared(layer?: DataLayer): Promise<{ photo?: Blob; text?: string } | null>;
}
const data = { ...(mutations as object), ...(dataIndex as object) } as unknown as S6bData;
function fn<K extends keyof S6bData>(name: K): S6bData[K] {
  expect(typeof data[name], `${name} is exported from src/data/index.ts`).toBe('function');
  return data[name];
}
type S6bTables = MemoryTables & { recaps?: RecapRow[] };
const recapsOf = (c: { controls: { tables: MemoryTables } }) => (c.controls.tables as S6bTables).recaps ?? [];
const saves = (c: { controls: { calls: { name: string; arg: unknown }[] } }) => c.controls.calls.filter((call) => call.name === 'saveRecapProse');

// ───────── helpers ─────────
const open: DataLayer[] = [];
beforeEach(() => { localStorage.clear(); idbData.clear(); });
afterEach(async () => {
  for (const l of open.splice(0)) await l.dispose();
});
function household(opts: Parameters<typeof couple>[0] & { smart?: boolean } = {}) {
  const { smart = true, ...rest } = opts;
  localStorage.clear();
  if (smart) fn('setSmartFeatures')(true);
  const c = couple({ photos: memoryPhotos(), downscale: fakeDownscale(), expenses: october(), chapters: [storedChapter()], ...rest });
  open.push(c.layer);
  return c;
}
async function settle(layer: DataLayer) {
  await act(async () => { await layer.idle(); });
}
async function ready(c: { layer: DataLayer }) {
  await c.layer.ready;
  await settle(c.layer);
}
const ok = (d: unknown): AiResult => ({ ok: true, data: d });
const fails = (reason: Reason): AiResult => ({ ok: false, reason });
const mentions = (arg: unknown, s: string) => JSON.stringify(arg ?? null).includes(s);

// ───────── October 2026 (finished on TODAY, 14 Nov): £1,365.50 together, no usual yet ─────────
let n = 0;
function spent(description: string, amount: number, category: string, payer: string, date: string, over: Partial<ExpenseRow> = {}): ExpenseRow {
  n += 1;
  const half = Math.floor(amount / 2);
  return storedExpense({
    id: `00000000-0000-4000-8000-00000000e${n.toString(16).padStart(3, '0')}`, description, amount_pence: amount, date, category_id: categoryId(category),
    paid: { [payer]: amount }, shares: { [JAE_ID]: amount - half, [SAM_ID]: half }, ...over,
  });
}
function october(): ExpenseRow[] {
  return [
    spent('Rent', 100000, 'Rent & bills', JAE_ID, '2026-10-01'),
    spent('Weekly shop', 24050, 'Groceries', SAM_ID, '2026-10-10'),
    spent('Dinner', 12500, 'Eating out', SAM_ID, '2026-10-12'),
    spent('Ramen', 2440, 'Eating out', SAM_ID, '2026-11-04', { chapter_id: storedChapter().id, country: 'JP' }),
  ];
}
const OCTOBER_STATS = {
  period: '2026-10', month: 'October', total: '£1,365.50', everyday: '£1,365.50', usual: null, comparison: null,
  bar: [{ name: 'Rent & bills', total: '£1,000.00' }, { name: 'Groceries', total: '£240.50' }, { name: 'Eating out', total: '£125.00' }],
  paid: { A: '£1,000.00', B: '£365.50' },
};
const WORDING = { headline: 'October came to £1,365.50 together.', aside: 'Person A paid £1,000.00 of it.' };
const NAMED = { headline: 'October came to £1,365.50 together.', aside: 'Jae paid £1,000.00 of it.' };
const stored = (prose: unknown, period = '2026-10'): RecapRow => ({
  household_id: HID, period, stats: OCTOBER_STATS, prose: typeof prose === 'string' ? prose : JSON.stringify(prose), created_at: '2026-11-01T08:00:00.000Z',
});

// ─────────────────────────────── INS-2: the recap's wording ───────────────────────────────

describe('recapWording (INS-2; AI.md §3.4)', () => {
  it('INS-2: wording already kept for the month is used, with the names put in on this phone; nothing is asked', async () => {
    const ai = fakeAi({ recap: ok(WORDING) });
    const c = household({ ai, recaps: [stored(WORDING)] });
    await ready(c);
    expect(await fn('recapWording')('2026-10', c.layer)).toEqual(NAMED);
    expect(ai.recap).not.toHaveBeenCalled();
    expect(saves(c)).toEqual([]);
  });

  it('INS-2: A is whoever joined first, so the partner’s phone reads the same sentence', async () => {
    const c = household({ as: 'sam', ai: fakeAi(), recaps: [stored(WORDING)] });
    await ready(c);
    expect(await fn('recapWording')('2026-10', c.layer)).toEqual(NAMED);
  });

  it('INS-2: nothing kept yet: asks once with the month’s figures (A and B, no names), keeps the reply, shows it', async () => {
    const ai = fakeAi({ recap: ok(WORDING) });
    const c = household({ ai });
    await ready(c);
    expect(await fn('recapWording')('2026-10', c.layer)).toEqual(NAMED);
    expect(ai.recap).toHaveBeenCalledTimes(1);
    const sent = ai.recap.mock.calls[0]?.[0];
    expect(sent).toMatchObject(OCTOBER_STATS);
    for (const s of ['Jae', 'Sam', HID, JAE_ID, SAM_ID, 'jaetest', 'balance', 'owes', 'Ramen']) expect(mentions(sent, s), s).toBe(false);
    await settle(c.layer);
    expect(saves(c)).toHaveLength(1);
    expect(mentions(saves(c)[0]?.arg, '2026-10')).toBe(true);
    const row = recapsOf(c).find((r) => r.period === '2026-10');
    expect(row?.household_id).toBe(HID);
    // Kept as the AI wrote it (A and B), so each phone names the people itself.
    expect(JSON.parse(row?.prose ?? 'null')).toEqual(WORDING);
  });

  it('INS-2: opened again, it isn’t asked again', async () => {
    const ai = fakeAi({ recap: ok(WORDING) });
    const c = household({ ai });
    await ready(c);
    await fn('recapWording')('2026-10', c.layer);
    await settle(c.layer);
    expect(await fn('recapWording')('2026-10', c.layer)).toEqual(NAMED);
    expect(ai.recap).toHaveBeenCalledTimes(1);
  });

  it('INS-2: if the partner’s phone kept its wording first, theirs is what both see', async () => {
    const theirs = { headline: 'October came to £1,365.50 together, Rent & bills the most.', aside: null };
    let c: ReturnType<typeof household> | null = null;
    const ai = fakeAi({
      recap: () => {
        // The partner's save lands while this phone waits for its own reply.
        (c?.controls.tables as S6bTables).recaps?.push(stored(theirs));
        return Promise.resolve(ok(WORDING));
      },
    });
    c = household({ ai });
    await ready(c);
    expect(await fn('recapWording')('2026-10', c.layer)).toEqual(theirs);
    expect(recapsOf(c).filter((r) => r.period === '2026-10')).toHaveLength(1);
    expect(JSON.parse(recapsOf(c)[0]?.prose ?? 'null')).toEqual(theirs);
  });

  it('INS-2: a reply with a number that isn’t the month’s is no wording: null, nothing kept, not asked again', async () => {
    const ai = fakeAi({ recap: ok({ headline: 'October came to £1,400 together.', aside: null }) });
    const c = household({ ai });
    await ready(c);
    expect(await fn('recapWording')('2026-10', c.layer)).toBeNull();
    await settle(c.layer);
    expect(saves(c)).toEqual([]);
    expect(recapsOf(c)).toEqual([]);
    expect(await fn('recapWording')('2026-10', c.layer)).toBeNull();
    expect(ai.recap).toHaveBeenCalledTimes(1);
  });

  it('INS-2: a reply of the wrong shape is checked again on the phone and discarded', async () => {
    const c = household({ ai: fakeAi({ recap: ok({ headline: 136550, aside: null }) }) });
    await ready(c);
    expect(await fn('recapWording')('2026-10', c.layer)).toBeNull();
    expect(saves(c)).toEqual([]);
  });

  for (const reason of ['off', 'limit', 'timeout', 'invalid', 'error'] as const) {
    it(`INS-2: the service answering "${reason}" is the template (null), nothing kept`, async () => {
      const c = household({ ai: fakeAi({ recap: fails(reason) }) });
      await ready(c);
      expect(await fn('recapWording')('2026-10', c.layer)).toBeNull();
      expect(saves(c)).toEqual([]);
    });
  }

  it('INS-2: a service that throws is the template too', async () => {
    const c = household({ ai: fakeAi({ recap: () => Promise.reject(new TypeError('Failed to fetch')) }) });
    await ready(c);
    expect(await fn('recapWording')('2026-10', c.layer)).toBeNull();
  });

  it('INS-2: kept wording whose figures no longer match the month (an entry changed since) is the template; not asked again', async () => {
    const ai = fakeAi({ recap: ok(WORDING) });
    const c = household({ ai, recaps: [stored({ headline: 'October came to £1,300.00 together.', aside: null })] });
    await ready(c);
    expect(await fn('recapWording')('2026-10', c.layer)).toBeNull();
    expect(ai.recap).not.toHaveBeenCalled();
  });

  it('INS-2: a save the server refuses still shows the wording this time', async () => {
    const c = household({ ai: fakeAi({ recap: ok(WORDING) }) });
    await ready(c);
    c.controls.refuse = (name) => (name === 'saveRecapProse' ? 'permission denied' : null);
    expect(await fn('recapWording')('2026-10', c.layer)).toEqual(NAMED);
  });

  it('INS-2: smart features off: the template, nothing asked, even when wording is kept', async () => {
    const ai = fakeAi({ recap: ok(WORDING) });
    const c = household({ smart: false, ai, recaps: [stored(WORDING)] });
    await ready(c);
    expect(await fn('recapWording')('2026-10', c.layer)).toBeNull();
    expect(ai.recap).not.toHaveBeenCalled();
  });

  it('INS-2: offline with nothing kept: the template, nothing asked', async () => {
    const ai = fakeAi({ recap: ok(WORDING) });
    const c = household({ ai });
    await ready(c);
    c.network.set(false);
    expect(await fn('recapWording')('2026-10', c.layer)).toBeNull();
    expect(ai.recap).not.toHaveBeenCalled();
  });

  it('INS-2: the month so far (settle day) is never worded by the AI', async () => {
    const ai = fakeAi({ recap: ok({ headline: 'November so far came to £24.40 together.', aside: null }) });
    const c = household({ ai });
    await ready(c);
    expect(await fn('recapWording')('2026-11', c.layer)).toBeNull();
    expect(ai.recap).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────── INS-9: Ask smsm ───────────────────────────────

const GOOD_ASK = { measure: 'total', filters: { categories: ['Eating out'], countries: ['JP'] } };

describe('askSmsm (INS-9; AI.md §3.5, §4)', () => {
  it('INS-9: the question goes with the category and chapter names, the countries present and today; the reply comes back', async () => {
    const ai = fakeAi({ ask: ok(GOOD_ASK) });
    const c = household({ ai });
    await ready(c);
    expect(await fn('askSmsm')('how much on eating out in japan?', c.layer)).toEqual({ ok: true, data: GOOD_ASK });
    expect(ai.ask).toHaveBeenCalledTimes(1);
    const [question, ctx] = ai.ask.mock.calls[0] ?? [];
    expect(question).toBe('how much on eating out in japan?');
    const sent = ctx as { categories: string[]; chapters: string[]; countries: string[]; today: string };
    expect(sent.today).toBe(TODAY);
    expect(sent.categories).toEqual(expect.arrayContaining(['Groceries', 'Eating out', 'Rent & bills']));
    expect(sent.chapters).toEqual(['Japan']);
    expect([...sent.countries].sort()).toEqual(['GB', 'JP']);
    for (const s of [HID, JAE_ID, SAM_ID, 'Jae', 'Sam', 'jaetest']) expect(mentions(ctx, s), s).toBe(false);
  });

  it('INS-9: names never leave the phone: the people become A (me) and B (partner), any case', async () => {
    const ai = fakeAi({ ask: ok(GOOD_ASK) });
    const c = household({ ai });
    await ready(c);
    await fn('askSmsm')('What did SAM spend on dinners with jae?', c.layer);
    expect(ai.ask.mock.calls[0]?.[0]).toBe('What did B spend on dinners with A?');
  });

  it('INS-9: on the partner’s phone, A is the partner', async () => {
    const ai = fakeAi({ ask: ok(GOOD_ASK) });
    const c = household({ as: 'sam', ai });
    await ready(c);
    await fn('askSmsm')('what did Jae pay for?', c.layer);
    expect(ai.ask.mock.calls[0]?.[0]).toBe('what did B pay for?');
  });

  it('INS-9: { unsupported: true } is an answer', async () => {
    const c = household({ ai: fakeAi({ ask: ok({ unsupported: true }) }) });
    await ready(c);
    expect(await fn('askSmsm')('are we saving enough?', c.layer)).toEqual({ ok: true, data: { unsupported: true } });
  });

  it('INS-9: smart features off: "off", nothing sent', async () => {
    const ai = fakeAi({ ask: ok(GOOD_ASK) });
    const c = household({ smart: false, ai });
    await ready(c);
    expect(await fn('askSmsm')('how much on eating out?', c.layer)).toEqual({ ok: false, reason: 'off' });
    expect(ai.ask).not.toHaveBeenCalled();
  });

  it('INS-9: offline is the same as off', async () => {
    const ai = fakeAi({ ask: ok(GOOD_ASK) });
    const c = household({ ai });
    await ready(c);
    c.network.set(false);
    expect(await fn('askSmsm')('how much on eating out?', c.layer)).toEqual({ ok: false, reason: 'off' });
    expect(ai.ask).not.toHaveBeenCalled();
  });

  for (const reason of ['off', 'limit', 'timeout', 'invalid', 'error'] as const) {
    it(`INS-9: the service answering "${reason}" is ok:false "${reason}"`, async () => {
      const c = household({ ai: fakeAi({ ask: fails(reason) }) });
      await ready(c);
      expect(await fn('askSmsm')('how much on eating out?', c.layer)).toEqual({ ok: false, reason });
    });
  }

  it('INS-9: a reply of the wrong shape (or carrying its own figure) is checked on the phone: "invalid"', async () => {
    for (const bad of [{ measure: 'sum', filters: {} }, { ...GOOD_ASK, answer_pence: 61240 }, { measure: 'total', filters: { payer: 'Sam' } }]) {
      const c = household({ ai: fakeAi({ ask: ok(bad) }) });
      await ready(c);
      expect(await fn('askSmsm')('how much on eating out?', c.layer), JSON.stringify(bad)).toEqual({ ok: false, reason: 'invalid' });
    }
  });

  it('INS-9: a service that throws is "error"', async () => {
    const c = household({ ai: fakeAi({ ask: () => Promise.reject(new TypeError('Failed to fetch')) }) });
    await ready(c);
    expect(await fn('askSmsm')('how much on eating out?', c.layer)).toEqual({ ok: false, reason: 'error' });
  });

  it('INS-9: asking never writes anything', async () => {
    const c = household({ ai: fakeAi({ ask: ok(GOOD_ASK) }) });
    await ready(c);
    const before = c.controls.calls.length;
    await fn('askSmsm')('how much on eating out?', c.layer);
    await settle(c.layer);
    expect(c.controls.calls.slice(before).filter((call) => /^(upsert|patch|set|save|request|decide|create)/.test(call.name))).toEqual([]);
  });
});

// ─────────────────────────────── ADD-8: what was shared into the app ───────────────────────────────

const SHARED_STORE = 'smsm-shared/shared';
const SHARED_PHOTO = 'shared/0f8c2d3e-5a6b-4c7d-8e9f-0a1b2c3d4e5f';
function keepShared(record: { photo: string | null; text: string | null }) {
  idbData.set(SHARED_STORE, new Map<IDBValidKey, unknown>([['latest', record]]));
}

describe('takeShared (ADD-8; SPEC 5.3)', () => {
  it('ADD-8: a shared photo is handed over once, then cleared from the phone', async () => {
    const photos = memoryPhotos();
    const photo = receiptPhoto('screenshot.png');
    photos.map.set(SHARED_PHOTO, photo);
    keepShared({ photo: SHARED_PHOTO, text: null });
    const c = household({ photos });
    await ready(c);
    const got = await fn('takeShared')(c.layer);
    expect(got?.photo).toBe(photo);
    expect(got?.text).toBeUndefined();
    expect(idbData.get(SHARED_STORE)?.get('latest')).toBeUndefined();
    expect(photos.map.has(SHARED_PHOTO)).toBe(false);
    expect(await fn('takeShared')(c.layer)).toBeNull();
  });

  it('ADD-8: shared text is handed over once', async () => {
    keepShared({ photo: null, text: 'Order confirmed: Le Creuset casserole' });
    const c = household();
    await ready(c);
    expect(await fn('takeShared')(c.layer)).toEqual({ text: 'Order confirmed: Le Creuset casserole' });
    expect(await fn('takeShared')(c.layer)).toBeNull();
  });

  it('ADD-8: a photo with words comes with both', async () => {
    const photos = memoryPhotos();
    const photo = receiptPhoto();
    photos.map.set(SHARED_PHOTO, photo);
    keepShared({ photo: SHARED_PHOTO, text: 'Dinner receipt' });
    const c = household({ photos });
    await ready(c);
    const got = await fn('takeShared')(c.layer);
    expect(got?.photo).toBe(photo);
    expect(got?.text).toBe('Dinner receipt');
  });

  it('ADD-8: nothing shared is null; blank text is nothing', async () => {
    const c = household();
    await ready(c);
    expect(await fn('takeShared')(c.layer)).toBeNull();
    keepShared({ photo: null, text: '   ' });
    expect(await fn('takeShared')(c.layer)).toBeNull();
  });

  it('ADD-8: taking what was shared sends nothing anywhere', async () => {
    keepShared({ photo: null, text: 'Dinner receipt' });
    const ai = fakeAi();
    const c = household({ ai });
    await ready(c);
    const before = c.controls.calls.length;
    await fn('takeShared')(c.layer);
    await settle(c.layer);
    // Only reads may happen meanwhile (a refetch); nothing is written or uploaded.
    expect(c.controls.calls.slice(before).filter((call) => /^(upsert|patch|set|save|upload|request|decide|create)|inbox/i.test(call.name) && call.name !== 'inboxItems')).toEqual([]);
    for (const f of [ai.scan, ai.parse, ai.categorise, ai.recap, ai.ask]) expect(f).not.toHaveBeenCalled();
  });
});
