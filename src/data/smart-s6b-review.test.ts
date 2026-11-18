/** S6b fresh review: kept wording only for the same figures; an empty month never asked; one ask at a time; names masked. */
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { categoryId, couple, HID, JAE_ID, SAM_ID, storedChapter, storedExpense, type RecapRow } from '../../tests/fixtures/couple';
import { deferred, fakeAi, type AiResult } from '../../tests/fixtures/smart';
import type { ExpenseRow } from './api';
import type { DataLayer } from './queryClient';
import { askSmsm, recapWording, setSmartFeatures } from './smartActions';

const open: DataLayer[] = [];
beforeEach(() => { localStorage.clear(); setSmartFeatures(true); });
afterEach(async () => { for (const l of open.splice(0)) await l.dispose(); });
async function ready(layer: DataLayer) { await layer.ready; await act(async () => { await layer.idle(); }); }

let n = 0;
const spent = (description: string, amount: number, payer: string, date: string, over: Partial<ExpenseRow> = {}): ExpenseRow => {
  n += 1;
  return storedExpense({
    id: `00000000-0000-4000-8000-00000000f${n.toString(16).padStart(3, '0')}`, description, amount_pence: amount, date, category_id: categoryId('Groceries'),
    paid: { [payer]: amount }, shares: { [JAE_ID]: amount - Math.floor(amount / 2), [SAM_ID]: Math.floor(amount / 2) }, ...over,
  });
};
const WORDING = { headline: 'October came to £100.00 together.', aside: null };
const kept = (total: string): RecapRow => ({ household_id: HID, period: '2026-10', stats: { total }, prose: JSON.stringify(WORDING), created_at: '2026-11-01T08:00:00.000Z' });

describe('recap wording (review 1, 7, 10)', () => {
  it('INS-2: kept wording written for other figures (an entry changed since) is the template', async () => {
    const c = couple({ ai: fakeAi(), expenses: [spent('Shop', 25000, JAE_ID, '2026-10-05')], recaps: [kept('£100.00')] });
    open.push(c.layer);
    await ready(c.layer);
    expect(await recapWording('2026-10', c.layer)).toBeNull();
  });

  it('INS-2: a month with nothing spent together is never worded by the AI', async () => {
    const ai = fakeAi({ recap: { ok: true, data: WORDING } });
    const c = couple({ ai, expenses: [] });
    open.push(c.layer);
    await ready(c.layer);
    expect(await recapWording('2026-10', c.layer)).toBeNull();
    expect(ai.recap).not.toHaveBeenCalled();
  });

  it('INS-2: asked twice while the first is on its way, the AI is asked once', async () => {
    const answer = deferred<AiResult>();
    const ai = fakeAi({ recap: () => answer.promise });
    const c = couple({ ai, expenses: [spent('Shop', 10000, JAE_ID, '2026-10-05')] });
    open.push(c.layer);
    await ready(c.layer);
    const one = recapWording('2026-10', c.layer);
    const two = recapWording('2026-10', c.layer);
    answer.resolve({ ok: true, data: WORDING });
    expect(await one).toEqual(await two);
    expect(ai.recap).toHaveBeenCalledTimes(1);
  });

  it('INS-2: a note naming a person goes to the AI as Person A / Person B', async () => {
    const ai = fakeAi({ recap: { ok: false, reason: 'error' } });
    const many = Array.from({ length: 6 }, (_, i) => spent(`Shop ${String(i)}`, 1000, JAE_ID, `2026-0${String(4 + (i % 5))}-0${String(1 + i)}`));
    const c = couple({ ai, expenses: [...many, spent('Sam birthday cake', 9000, JAE_ID, '2026-10-05')] });
    open.push(c.layer);
    await ready(c.layer);
    await recapWording('2026-10', c.layer);
    const sent = JSON.stringify(ai.recap.mock.calls[0]?.[0] ?? null);
    expect(sent).not.toMatch(/\bSam\b|\bJae\b/);
  });
});

describe('Ask smsm (review 7)', () => {
  it('INS-9: a chapter named after a person goes masked, and comes back by its own name', async () => {
    const chapter = { ...storedChapter(), name: 'Sam birthday weekend' };
    const ai = fakeAi({ ask: (_q: unknown, ctx: unknown) => {
      const sent = (ctx as { chapters: string[] }).chapters;
      expect(sent.join(' ')).not.toMatch(/\bSam\b/);
      return Promise.resolve({ ok: true, data: { measure: 'total', filters: { chapters: [sent[0] ?? ''] } } });
    } });
    const c = couple({ ai, chapters: [chapter], expenses: [spent('Cake', 1000, JAE_ID, '2026-10-05')] });
    open.push(c.layer);
    await ready(c.layer);
    const r = await askSmsm('what did the birthday weekend cost?', c.layer);
    expect(r.ok && 'filters' in r.data ? r.data.filters.chapters : null).toEqual(['Sam birthday weekend']);
  });
});
