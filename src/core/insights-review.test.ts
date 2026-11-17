/** S5a fresh review: notes never compare with a usual of £0, and never name a blank category (INS-3). */
import { describe, expect, it } from 'vitest';
import { notes, type InsightEntry } from './insights';
import { pence } from './money';

const J = 'jae';
const S = 'sam';
let n = 0;
function spent(date: string, amount: number, categoryId: string | null, description = 'Thing'): InsightEntry {
  n += 1;
  return {
    id: `e${String(n)}`, kind: 'expense', description, amount: pence(amount), paid: { [J]: amount }, shares: { [J]: amount / 2, [S]: amount / 2 },
    splitMode: 'ratio', date, categoryId, chapterId: null, country: 'GB', recurringId: null, deleted: false,
  } as unknown as InsightEntry;
}
const history = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((m) => spent(`${m}-10`, 10000, 'groceries'));
const categories = [{ id: 'groceries', name: 'Groceries' }, { id: 'pets', name: 'Pets' }];

describe('notes (INS-3) after the fresh review', () => {
  it('a first-ever spend in a category is not "over its usual" of £0', () => {
    const list = notes({ entries: [...history, spent('2026-11-05', 6000, 'pets')], templates: [], categories }, '2026-11-14');
    expect(list.filter((x) => x.kind === 'category')).toEqual([]);
  });

  it('an uncategorised entry never gets a note with a blank category name', () => {
    const earlier = ['2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((m) => spent(`${m}-12`, 1000, null));
    const list = notes({ entries: [...history, ...earlier, spent('2026-11-06', 4000, null)], templates: [], categories }, '2026-11-14');
    expect(list.filter((x) => x.kind === 'entry')).toEqual([]);
  });

  it('the figures in a category note agree with each other', () => {
    const cats = [{ id: 'eat', name: 'Eating out' }];
    const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'].map((m) => spent(`${m}-08`, 12549, 'eat'));
    const list = notes({ entries: [...months, spent('2026-11-08', 21050, 'eat')], templates: [], categories: cats }, '2026-11-14');
    expect(list[0]?.text).toBe('Eating out is £86 over its usual (£211 so far, usually £125)');
  });
});
