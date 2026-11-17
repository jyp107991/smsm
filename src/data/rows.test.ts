import { describe, expect, it } from 'vitest';
import { demoHousehold, JAE, SAM } from '../../tests/fixtures/household';
import { netPositions } from '../core/balance';
import { BadRowError, expenseToLedger, settlementToLedger } from './rows';

const h = demoHousehold('2026-11-17');
const row = h.expenses[0]!;

describe('BAL-1 database rows become ledger entries only when their money is whole and adds up', () => {
  it('every demo row converts, and the balance of the two nets is zero', () => {
    const n = netPositions([JAE, SAM], h.expenses.map(expenseToLedger), h.settlements.map(settlementToLedger));
    expect(n[JAE]! + n[SAM]!).toBe(0);
  });
  it.each([
    ['shares not whole pence', { shares: { [JAE]: 1.5 } }],
    ['paid not adding up', { paid: { [JAE]: 1 } }],
    ['a negative share', { shares: { [JAE]: row.amount_pence + 1, [SAM]: -1 } }],
    ['an unknown kind', { kind: 'gift' }],
    ['a zero amount', { amount_pence: 0, paid: {}, shares: {} }],
  ])('refuses %s', (_label, patch) => {
    expect(() => expenseToLedger({ ...row, ...patch })).toThrow(BadRowError);
  });
  it('a soft-deleted row is marked deleted', () => {
    expect(expenseToLedger({ ...row, deleted_at: '2026-11-17T10:00:00Z' }).deleted).toBe(true);
  });
  it('a settlement of zero is refused', () => {
    expect(() => settlementToLedger({ ...h.settlements[0]!, amount_pence: 0 })).toThrow(BadRowError);
  });
});
