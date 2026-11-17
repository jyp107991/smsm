/** S5b fresh review: regressions for the recap's money-back edges (no negative slices, no negative "Everything else"). */
import { describe, expect, it } from 'vitest';
import type { InsightEntry } from './insights';
import { pence } from './money';
import { recapOf } from './recap';

const JAE = 'jae';
const SAM = 'sam';
const CATS = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id, name: id.toUpperCase() }));
let n = 0;
function entry(categoryId: string, amount: number, kind: 'expense' | 'money_back' = 'expense'): InsightEntry & { place: null } {
  n += 1;
  const half = Math.floor(amount / 2);
  return {
    id: `x${String(n)}`, kind, description: 'Thing', splitMode: 'ratio', date: '2026-10-10', categoryId, chapterId: null, country: 'GB',
    recurringId: null, deleted: false, place: null, amount: pence(amount),
    paid: { [JAE]: pence(amount) }, shares: { [JAE]: pence(amount - half), [SAM]: pence(half) },
  };
}
const opts = { today: '2026-11-14', names: { [JAE]: 'Jae', [SAM]: 'Sam' }, categories: CATS };

describe('recap money back (S5b review)', () => {
  it('a month with only money back has no bar', () => {
    const r = recapOf([entry('a', 1200, 'money_back')], [], [JAE, SAM], '2026-10', opts);
    expect(r.total).toBeLessThan(0);
    expect(r.bar).toEqual([]);
  });

  it('a category taken below nothing by money back never makes "Everything else" negative', () => {
    const rows = [entry('a', 10000), entry('b', 9000), entry('c', 8000), entry('d', 7000), entry('e', 500), entry('f', 3000, 'money_back')];
    const r = recapOf(rows, [], [JAE, SAM], '2026-10', opts);
    expect(r.bar.map((b) => b.name)).toEqual(['A', 'B', 'C', 'D', 'Everything else']);
    expect(r.bar.every((b) => b.total > 0)).toBe(true);
    expect(r.bar[4]?.total).toBe(500);
  });
});
