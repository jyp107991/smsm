/**
 * S9a core (docs/slices/S9a.md fixes 10 and 24; SPEC PLC-7 CHP-6 ACT-1 EXP-1). Written before the build (ENGINEERING §5,
 * tests first by someone else).
 *
 * Interface these tests expect, in src/core/filters.ts (pure):
 *
 *   filteredTotal(rows: readonly (FilterEntry & { amount: Pence; deleted?: boolean })[]): { count: number; total: Pence }
 *     Fix 10: the line above a filtered Activity ("12 entries · £340.20"), from the whole filtered set: expenses add,
 *     money back subtracts, settle-ups are left out of both the count and the total, deleted rows are left out.
 *
 *   interface Ordered { date: IsoDate; createdAt: string; id: string }
 *   newestFirst(a: Ordered, b: Ordered): number
 *     Fix 24: the one order for Home's Recent, Activity and the statement: by date, newest first; then by when it was
 *     added (createdAt, an ISO timestamp), newest first; then by id, so the order never depends on the input order.
 *
 *   src/core/statement.ts: statement(...).rows in that order. Its entries and settle-ups carry `createdAt`
 *   (InsightEntry and StatementSettlement gain createdAt?: string).
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { IsoDate } from './dates';
import { applyFilter, filteredTotal, newestFirst, type FilterEntry } from './filters';
import type { InsightEntry } from './insights';
import { pence, type Pence } from './money';
import { statement, type StatementSettlement } from './statement';

type Row = FilterEntry & { amount: Pence; deleted?: boolean };
function row(kind: FilterEntry['kind'], description: string, amount: number, over: Partial<Row> = {}): Row {
  return {
    kind, description, notes: null, tags: [], place: null, payer: 'jae', categoryId: 'c-groceries', chapterId: null, country: 'GB',
    date: '2026-11-10', splitMode: kind === 'settlement' ? null : 'ratio', amount: pence(amount), ...over,
  };
}

describe('filteredTotal: the line above filtered Activity (fix 10, PLC-7, CHP-6)', () => {
  it('PLC-7: two Tesco shops and a Tesco refund: 3 entries, £30.00 (money back subtracts)', () => {
    expect(filteredTotal([row('expense', 'Tesco', 2000), row('expense', 'Tesco', 1500), row('money_back', 'Tesco refund', 500)])).toEqual({ count: 3, total: 3500 - 500 });
  });

  it('PLC-7: settle-ups are left out of the count and the total', () => {
    const rows = [row('expense', 'Tesco', 2000), row('settlement', '', 9999, { notes: 'tesco' })];
    expect(filteredTotal(rows)).toEqual({ count: 1, total: 2000 });
  });

  it('PLC-7: deleted rows never count', () => {
    expect(filteredTotal([row('expense', 'Tesco', 2000), row('expense', 'Tesco', 7000, { deleted: true })])).toEqual({ count: 1, total: 2000 });
  });

  it('CHP-6 PLC-7: a country filter totals every match, not only the rows drawn (60 entries in Japan)', () => {
    const rows = [
      ...Array.from({ length: 60 }, (_, i) => row('expense', `Ramen ${String(i)}`, 1001, { country: 'JP' })),
      row('expense', 'Tesco', 2000),
    ];
    expect(filteredTotal(applyFilter(rows, { countries: ['JP'] }))).toEqual({ count: 60, total: 60060 });
  });

  it('PLC-7: nothing matches: 0 entries, £0.00', () => {
    expect(filteredTotal([])).toEqual({ count: 0, total: 0 });
  });
});

describe('newestFirst: one order everywhere (fix 24, ACT-1)', () => {
  const o = (id: string, date: IsoDate, createdAt: string) => ({ id, date, createdAt });
  const rows = [
    o('b', '2026-11-10', '2026-11-10T09:00:00.000Z'),
    o('a', '2026-11-12', '2026-11-12T08:00:00.000Z'),
    o('c', '2026-11-10', '2026-11-13T09:00:00.000Z'),
    o('e', '2026-11-10', '2026-11-10T09:00:00.000Z'),
    o('d', '2026-11-11', '2026-11-09T09:00:00.000Z'),
  ];

  it('ACT-1: by date newest first, then the one added last first', () => {
    const ids = [...rows].sort(newestFirst).map((r) => r.id);
    expect(ids.slice(0, 3)).toEqual(['a', 'd', 'c']);
    expect(new Set(ids.slice(3))).toEqual(new Set(['b', 'e']));
  });

  it('ACT-1: same day and same moment: settled by id, whatever order they arrive in (property)', () => {
    const want = [...rows].sort(newestFirst).map((r) => r.id);
    fc.assert(fc.property(fc.shuffledSubarray(rows, { minLength: rows.length, maxLength: rows.length }), (shuffled) => {
      expect([...shuffled].sort(newestFirst).map((r) => r.id)).toEqual(want);
    }));
  });

  it('ACT-1: a proper order: antisymmetric, and 0 only for the same row', () => {
    for (const x of rows) {
      expect(newestFirst(x, x)).toBe(0);
      for (const y of rows) if (x !== y) expect(Math.sign(newestFirst(x, y))).toBe(-Math.sign(newestFirst(y, x)));
    }
    // "a" (12 Nov) comes before "b" (10 Nov).
    expect(newestFirst(o('a', '2026-11-12', '2026-11-12T08:00:00.000Z'), o('b', '2026-11-10', '2026-11-10T09:00:00.000Z'))).toBeLessThan(0);
  });

  it('EXP-1: the statement lists the month in the same order', () => {
    const map = (m: Record<string, number>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, pence(v)]));
    const entry = (id: string, date: IsoDate, createdAt: string): InsightEntry & { createdAt: string } => ({
      id, kind: 'expense', description: id, amount: pence(1000), paid: map({ jae: 1000 }), shares: map({ jae: 500, sam: 500 }),
      splitMode: 'ratio', date, categoryId: null, chapterId: null, country: 'GB', recurringId: null, deleted: false, createdAt,
    });
    const entries = [
      entry('early', '2026-10-02', '2026-10-02T10:00:00.000Z'),
      entry('first-added', '2026-10-15', '2026-10-15T08:00:00.000Z'),
      entry('last-added', '2026-10-15', '2026-10-16T08:00:00.000Z'),
      entry('late', '2026-10-28', '2026-10-28T10:00:00.000Z'),
    ];
    const settlements: (StatementSettlement & { createdAt: string })[] = [
      { id: 'settled', from: 'sam', to: 'jae', amount: pence(500), date: '2026-10-15', deleted: false, createdAt: '2026-10-15T12:00:00.000Z' },
    ];
    const s = statement(entries, settlements, ['jae', 'sam'], '2026-10');
    expect(s.rows.map((r) => r.id)).toEqual(['late', 'last-added', 'settled', 'first-added', 'early']);
  });
});
