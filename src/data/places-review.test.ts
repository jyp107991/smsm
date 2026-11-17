/** S4b fresh review: correcting the pounds of a foreign entry before it syncs drops the old original (PLC-6). */
import { act } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { couple, JAE_ID, SAM_ID } from '../../tests/fixtures/couple';
import { pence } from '../core/money';
import { addExpense, editExpense } from './mutations';
import type { DataLayer } from './queryClient';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const open: DataLayer[] = [];
afterEach(async () => { for (const l of open.splice(0)) await l.dispose(); });

describe('a foreign entry edited before it syncs (PLC-6, OFF-2)', () => {
  it('a new pounds amount clears the original amount and rate; a new description keeps them', async () => {
    const c = couple({});
    open.push(c.layer);
    await c.layer.ready;
    act(() => { c.network.set(false); });
    const id = addExpense({
      description: 'Ramen', amount: pence(570), date: '2026-11-14', categoryId: null, payer: JAE_ID,
      split: { mode: 'ratio', ratio: { [JAE_ID]: 50, [SAM_ID]: 50 } }, country: 'JP', original: { amount: '1200', currency: 'JPY', rate: '0.0047475' },
    }, c.layer);
    editExpense(id, { description: 'Ramen bar' }, c.layer);
    editExpense(id, { amount: pence(600) }, c.layer);
    act(() => { c.network.set(true); });
    await act(async () => { await c.layer.idle(); });
    expect(c.controls.tables.expenses.find((e) => e.id === id)).toMatchObject({
      description: 'Ramen bar', amount_pence: 600, original_amount: null, original_currency: null, fx_rate: null, country: 'JP',
    });
  });
});
