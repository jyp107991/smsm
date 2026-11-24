/**
 * The free Workers AI allocation used up, on the phone (AI.md §4 "Daily limit reached"; SCAN-5, CAT-2, INS-2, INS-9).
 * On 24 Nov the account's 10,000 Neurons ran out (tests/ai/replies/daily-limit-429.json); the Worker answers
 * {ok:false, reason:'limit'} (worker/ai-daily-limit.test.ts). The phone takes that as the quiet fallback, asks once and
 * never again in a loop: no retry inside the request, no repeated guess or wording for the same thing. The line a
 * person sees for a receipt ("That’s enough reading for today. Fill it in by hand.") is pinned in
 * src/screens/smart.test.tsx.
 */
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { categoryId, couple, JAE_ID, SAM_ID, storedExpense } from '../../tests/fixtures/couple';
import { idbData } from '../../tests/fixtures/fake-idb-keyval';
import { fakeAi, fakeDownscale, memoryPhotos, receiptPhoto, type AiResult } from '../../tests/fixtures/smart';
import { pence } from '../core/money';
import type { ExpenseRow } from './api';
import * as mutations from './mutations';
import type { DataLayer } from './queryClient';
import { workerAi } from './smart';
import { askSmsm, guessCategory, readReceipt, recapWording, setSmartFeatures } from './smartActions';

vi.mock('idb-keyval', async () => (await import('../../tests/fixtures/fake-idb-keyval')).fakeIdbKeyval);
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const LIMIT: AiResult = { ok: false, reason: 'limit' };
const open: DataLayer[] = [];
beforeEach(() => { localStorage.clear(); idbData.clear(); });
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const l of open.splice(0)) await l.dispose();
});
function spent(id: string, description: string, amount: number, category: string, date: string): ExpenseRow {
  const half = Math.floor(amount / 2);
  return storedExpense({
    id, description, amount_pence: amount, date, category_id: categoryId(category),
    paid: { [JAE_ID]: amount }, shares: { [JAE_ID]: amount - half, [SAM_ID]: half },
  });
}
function household(ai: ReturnType<typeof fakeAi>, expenses: ExpenseRow[] = []) {
  setSmartFeatures(true);
  const c = couple({ ai, photos: memoryPhotos(), downscale: fakeDownscale(), expenses });
  open.push(c.layer);
  return c;
}
async function ready(layer: DataLayer) {
  await layer.ready;
  await act(async () => { await layer.idle(); });
}

describe('the Worker saying "limit" (SCAN-5; AI.md §4)', () => {
  it('SCAN-5: workerAi asks the Worker once per call and passes "limit" on; nothing is retried', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({ ok: false, reason: 'limit' }), { status: 200, headers: { 'content-type': 'application/json' } })));
    vi.stubGlobal('fetch', fetchMock);
    const ai = workerAi(() => Promise.resolve('token'));
    const cats = ['Groceries'];
    expect(await ai.categorise('Zzyzx Emporium', cats)).toEqual(LIMIT);
    expect(await ai.parse('dinner 42', { categories: cats, chapters: [], today: '2026-11-24' })).toEqual(LIMIT);
    expect(await ai.ask('how much on groceries?', { categories: cats, chapters: [], countries: ['GB'], today: '2026-11-24' })).toEqual(LIMIT);
    expect(await ai.scan(receiptPhoto(), { categories: cats, today: '2026-11-24', country: 'GB' })).toEqual(LIMIT);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});

describe('each smart feature, out of allocation (SCAN-5, CAT-2, INS-2, INS-9)', () => {
  it('SCAN-5: a receipt reading is "limit", asked once; nothing is filled or saved', async () => {
    const ai = fakeAi({ scan: LIMIT });
    const c = household(ai);
    await ready(c.layer);
    expect(await readReceipt(receiptPhoto(), c.layer)).toEqual(LIMIT);
    expect(ai.scan).toHaveBeenCalledTimes(1);
    expect(c.controls.tables.expenses).toEqual([]);
  });

  it('CAT-2: a category guess is asked once; the entry stays as saved and nothing is remembered', async () => {
    const ai = fakeAi({ categorise: LIMIT });
    const c = household(ai);
    await ready(c.layer);
    const id = mutations.addExpense({
      description: 'Zzyzx Emporium', amount: pence(1800), date: '2026-11-14', categoryId: null, payer: JAE_ID,
      split: { mode: 'ratio', ratio: { [JAE_ID]: 50, [SAM_ID]: 50 } },
    }, c.layer);
    await ready(c.layer);
    await guessCategory(id, c.layer);
    await ready(c.layer);
    expect(ai.categorise).toHaveBeenCalledTimes(1);
    expect(c.controls.tables.expenses.find((e) => e.id === id)?.category_id).toBeNull();
    expect(c.controls.tables.categoryMemory).toEqual([]);
  });

  it('INS-2: the recap keeps its template, and the month is not asked again while the app is open', async () => {
    const ai = fakeAi({ recap: LIMIT });
    const c = household(ai, [
      spent('00000000-0000-4000-8000-00000000d001', 'Rent', 100000, 'Rent & bills', '2026-10-01'),
      spent('00000000-0000-4000-8000-00000000d002', 'Weekly shop', 24050, 'Groceries', '2026-10-10'),
    ]);
    await ready(c.layer);
    expect(await recapWording('2026-10', c.layer)).toBeNull();
    expect(await recapWording('2026-10', c.layer)).toBeNull();
    expect(await recapWording('2026-10', c.layer)).toBeNull();
    expect(ai.recap).toHaveBeenCalledTimes(1);
    expect(c.controls.calls.filter((call) => call.name === 'saveRecapProse')).toEqual([]);
  });

  it('INS-9: a question is "limit", asked once', async () => {
    const ai = fakeAi({ ask: LIMIT });
    const c = household(ai);
    await ready(c.layer);
    expect(await askSmsm('how much on groceries?', c.layer)).toEqual(LIMIT);
    expect(ai.ask).toHaveBeenCalledTimes(1);
  });
});
