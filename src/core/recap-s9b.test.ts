/**
 * S9b core (docs/slices/S9b.md fix 17; SPEC INS-2 INS-4): a past recap's card on Insights shows the recap's own total
 * (the same period and rows as recapOf, chapters and all) and the category most was spent on; nothing for a month with
 * nothing spent together. The month so far counts up to today.
 */
import { describe, expect, it } from 'vitest';
import type { IsoDate } from './dates';
import type { InsightEntry } from './insights';
import { pence } from './money';
import { monthCard, recapOf } from './recap';

const JAE = 'jae';
const SAM = 'sam';
let seq = 0;
function e(amount: number, date: IsoDate, over: Partial<InsightEntry> = {}): InsightEntry {
  seq += 1;
  const half = Math.floor(amount / 2);
  return {
    id: `c${String(seq)}`, kind: 'expense', description: 'Shop', amount: pence(amount), paid: { [JAE]: pence(amount) },
    shares: { [JAE]: pence(amount - half), [SAM]: pence(half) }, splitMode: 'ratio', date, categoryId: 'c-groceries', chapterId: null,
    country: 'GB', recurringId: null, deleted: false, ...over,
  };
}
const OPTS = { today: '2026-11-14', names: { [JAE]: 'Jae', [SAM]: 'Sam' }, categories: [{ id: 'c-groceries', name: 'Groceries' }, { id: 'c-rent', name: 'Rent' }] };

describe('S9b monthCard (INS-4)', () => {
  const rows = [
    e(100000, '2026-10-01', { categoryId: 'c-rent' }),
    e(24000, '2026-10-10'),
    e(30000, '2026-10-12', { chapterId: 'trip' }),
    e(5000, '2026-10-20', { deleted: true, categoryId: 'c-travel' }),
    e(9900, '2026-10-21', { splitMode: 'for_other' }),
    e(1200, '2026-11-02'),
    e(800, '2026-11-20'),
  ];

  it('INS-4: a finished month: the recap’s own total (chapters and all) and its biggest category', () => {
    const card = monthCard(rows, '2026-10', '2026-11-14');
    const recap = recapOf(rows, [], [JAE, SAM], '2026-10', OPTS);
    expect(card?.total).toBe(recap.total);
    expect(card?.total).toBe(154000);
    expect(card?.topCategoryId).toBe('c-rent');
  });

  it('INS-4: the month so far counts up to today only', () => {
    expect(monthCard(rows, '2026-11', '2026-11-14')?.total).toBe(1200);
  });

  it('INS-4: a month with nothing spent together has no figures', () => {
    expect(monthCard(rows, '2026-09', '2026-11-14')).toBeNull();
  });
});
