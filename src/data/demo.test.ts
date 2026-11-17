/** Demo mode serves the seeded household through the same hooks, and writes change the in-memory copy. */
import { renderHook, waitFor, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { netPositions } from '../core/balance';
import { pence } from '../core/money';
import { demoHousehold, JAE, SAM } from '../../tests/fixtures/household';
import { createDemoLayer } from './demo';
import { DataProvider } from './DataProvider';
import { useBalance, useEntries, useMembers } from './hooks';
import { addExpense } from './mutations';
import type { DataLayer } from './queryClient';
import { expenseToLedger, settlementToLedger } from './rows';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let layer: DataLayer | null = null;
afterEach(async () => { await layer?.dispose(); layer = null; });

describe('demo mode', () => {
  it('serves the seeded household through the hooks; the balance is the core figure over it', async () => {
    const now = new Date('2026-11-17T12:00:00Z');
    layer = createDemoLayer(now);
    const wrapper = ({ children }: { children: ReactNode }) => createElement(DataProvider, { layer: layer as DataLayer, children });
    const { result } = renderHook(() => ({ balance: useBalance(), members: useMembers(), entries: useEntries() }), { wrapper });
    await waitFor(() => { expect(result.current.balance.status).toBe('ready'); });
    const seed = demoHousehold('2026-11-17');
    expect(result.current.members.data?.map((m) => m.display_name)).toEqual(['Jae', 'Sam']);
    expect(result.current.entries.data).toHaveLength(seed.expenses.length);
    const expected = netPositions([JAE, SAM], seed.expenses.map(expenseToLedger), seed.settlements.map(settlementToLedger));
    expect(result.current.balance).toMatchObject({ status: 'ready', nets: expected });

    act(() => {
      addExpense({ description: 'Demo shop', amount: pence(1000), date: '2026-11-17', categoryId: null, payer: JAE, split: { mode: 'treat' } });
    });
    await waitFor(() => { expect(result.current.entries.data).toHaveLength(seed.expenses.length + 1); });
  });
});
