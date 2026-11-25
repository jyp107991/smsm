/**
 * S10 fresh review 4 (data layer). Written before the fix. The AI's recap of a month is asked with shared figures
 * only: wordMonth gives recapOf the shared entries and the shared regular payments, so nothing of one person's own
 * (a description, a price) is ever sent, even for a subscription that was someone's own and is now shared.
 */
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { categoryId, couple, JAE_ID, SAM_ID, storedExpense, storedRecurring } from '../../tests/fixtures/couple';
import { idbData } from '../../tests/fixtures/fake-idb-keyval';
import { fakeAi, type AiResult } from '../../tests/fixtures/smart';
import * as data from './index';
import type { DataLayer } from './queryClient';

vi.mock('idb-keyval', async () => (await import('../../tests/fixtures/fake-idb-keyval')).fakeIdbKeyval);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const open: DataLayer[] = [];
beforeEach(() => { localStorage.clear(); idbData.clear(); });
afterEach(async () => {
  for (const l of open.splice(0)) await l.dispose();
});

const DUO = '00000000-0000-4000-8000-00000000d0d1';
const CLIMB = '00000000-0000-4000-8000-00000000d0d2';
const ok = (d: unknown): AiResult => ({ ok: true, data: d });

describe('S10 review 4: the recap the AI is asked about is shared only', () => {
  it('REC-12 INS-2: own entries and own regular payments never reach the AI; a once-own subscription’s own price neither', async () => {
    data.setSmartFeatures(true);
    const ai = fakeAi({ recap: ok({ headline: 'October came to £1,009.99 together.', aside: null }) });
    const c = couple({
      ai,
      recurring: [
        // Duolingo: Jae's own until October, shared since (made shared; its September posting stays hers).
        storedRecurring({ id: DUO, description: 'Duolingo', amount_pence: 999, is_subscription: true, start_date: '2026-09-09', posted_count: 3, category_id: categoryId('Subscriptions') }),
        // Jae's own climbing wall, started in October.
        storedRecurring({ id: CLIMB, description: 'Climbing wall', amount_pence: 4200, start_date: '2026-10-05', posted_count: 2, paid: { [JAE_ID]: 4200 }, shares: { [JAE_ID]: 4200 }, split_mode: 'treat', split_params: null, owner_id: JAE_ID }),
      ],
      expenses: [
        storedExpense({ id: '00000000-0000-4000-8000-00000000e0d1', description: 'Rent', amount_pence: 100000, date: '2026-10-01', shares: { [JAE_ID]: 50000, [SAM_ID]: 50000 }, paid: { [JAE_ID]: 100000 } }),
        storedExpense({ id: '00000000-0000-4000-8000-00000000e0d2', description: 'Duolingo', amount_pence: 777, date: '2026-09-09', paid: { [JAE_ID]: 777 }, shares: { [JAE_ID]: 777 }, split_mode: 'treat', split_params: null, recurring_id: DUO, occurrence_date: '2026-09-09', source: 'recurring', owner_id: JAE_ID }),
        storedExpense({ id: '00000000-0000-4000-8000-00000000e0d3', description: 'Duolingo', amount_pence: 999, date: '2026-10-09', paid: { [JAE_ID]: 999 }, shares: { [JAE_ID]: 500, [SAM_ID]: 499 }, recurring_id: DUO, occurrence_date: '2026-10-09', source: 'recurring' }),
        storedExpense({ id: '00000000-0000-4000-8000-00000000e0d4', description: 'Climbing wall', amount_pence: 4200, date: '2026-10-05', paid: { [JAE_ID]: 4200 }, shares: { [JAE_ID]: 4200 }, split_mode: 'treat', split_params: null, recurring_id: CLIMB, occurrence_date: '2026-10-05', source: 'recurring', owner_id: JAE_ID }),
      ],
    });
    open.push(c.layer);
    await c.layer.ready;
    await act(async () => { await c.layer.idle(); });
    await data.recapWording('2026-10', c.layer);
    expect(ai.recap).toHaveBeenCalledTimes(1);
    const sent = JSON.stringify(ai.recap.mock.calls[0]?.[0] ?? null);
    for (const s of ['£7.77', 'Climbing', '£42.00']) expect(sent.includes(s), s).toBe(false);
    expect(sent).toContain('£1,009.99');
  });
});
