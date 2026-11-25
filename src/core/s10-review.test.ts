/**
 * S10 fresh review (core). Written before the fix.
 *   Finding 2: Activity's line over a search with Whose on its default ("Shared and own"): the shared count and total,
 *     and each person's own count and total apart, from the whole filtered set (filteredTotals).
 *   Finding 4: notes (and so the recap) never read an own entry's price: a subscription that was someone's own and is
 *     now shared never says "went from <own price> to <shared price>".
 */
import { describe, expect, it } from 'vitest';
import { filteredTotal, filteredTotals, type FilterEntry } from './filters';
import { notes, type InsightEntry, type NoteTemplate } from './insights';
import { pence, type Pence } from './money';
import { recapOf } from './recap';

const JAE = 'jae';
const SAM = 'sam';

type Row = FilterEntry & { amount: Pence; deleted?: boolean };
const row = (over: Omit<Partial<Row>, 'amount'> & { amount: number }): Row => ({
  kind: 'expense', description: 'Thing', notes: null, tags: [], place: null, payer: JAE, categoryId: null, chapterId: null, country: 'GB',
  date: '2026-11-10', splitMode: 'ratio', ownerId: null, ...over, amount: pence(over.amount),
});

describe('S10 review 2: the filtered line counts shared and each person’s own apart', () => {
  it('REC-12: shared rows make the shared count and total; own rows are each person’s own, never in the shared one', () => {
    const rows = [
      row({ amount: 1000 }), row({ amount: 2000 }), row({ kind: 'money_back', amount: 500 }),
      row({ amount: 1500, ownerId: JAE, splitMode: 'treat' }), row({ amount: 1500, ownerId: JAE, splitMode: 'treat' }), row({ amount: 1500, ownerId: JAE, splitMode: 'treat' }),
      row({ amount: 899, ownerId: SAM, splitMode: 'treat' }),
      row({ kind: 'settlement', amount: 700, splitMode: null }), row({ amount: 9999, deleted: true }), row({ amount: 9999, ownerId: JAE, deleted: true }),
    ];
    const t = filteredTotals(rows);
    expect(t.shared).toEqual({ count: 3, total: 2500 });
    expect(t.own).toEqual([{ owner: JAE, count: 3, total: 4500 }, { owner: SAM, count: 1, total: 899 }]);
    // The shared figure is the one the line always had.
    expect(t.shared).toEqual(filteredTotal(rows));
  });

  it('REC-12: only own rows on screen: no shared rows (0), and the own counts; none at all: no own parts', () => {
    expect(filteredTotals([row({ amount: 1500, ownerId: JAE }), row({ amount: 1500, ownerId: JAE })])).toEqual({
      shared: { count: 0, total: 0 }, own: [{ owner: JAE, count: 2, total: 3000 }],
    });
    expect(filteredTotals([row({ amount: 1000 })]).own).toEqual([]);
  });
});

describe('S10 review 4: notes never read an own entry’s price', () => {
  const entry = (over: Omit<Partial<InsightEntry>, 'amount'> & { amount: number }): InsightEntry => ({
    id: `x${String(Math.random())}`, kind: 'expense', description: 'Duolingo', paid: { [JAE]: pence(over.amount) }, shares: { [JAE]: pence(over.amount) },
    splitMode: 'treat', date: '2026-10-09', categoryId: 'subs', chapterId: null, country: 'GB', recurringId: 'duo', deleted: false, ...over, amount: pence(over.amount),
  });
  // Duolingo was Jae's own (£7.99, September); made shared, it posted £9.99 in October, split.
  const entries = [
    entry({ amount: 799, date: '2026-09-09', ownerId: JAE }),
    entry({ amount: 999, date: '2026-10-09', paid: { [JAE]: pence(999) }, shares: { [JAE]: pence(500), [SAM]: pence(499) }, splitMode: 'ratio' }),
  ];
  const duo: NoteTemplate = { id: 'duo', description: 'Duolingo', amount: pence(999), frequency: 'monthly', every: 1, startDate: '2026-09-09', isSubscription: true, active: true, ownerId: null };

  it('REC-12: a shared subscription that was someone’s own says nothing of its own price', () => {
    const out = notes({ entries, templates: [duo], categories: [{ id: 'subs', name: 'Subscriptions' }] }, '2026-10-31', { finished: true });
    expect(out.map((x) => x.text).join(' | ')).not.toContain('£7.99');
    expect(out.filter((x) => x.kind === 'price')).toEqual([]);
  });

  it('REC-12: the recap of that month has no note with the own price either', () => {
    const recap = recapOf(entries, [], [JAE, SAM], '2026-10', {
      today: '2026-11-14', names: { [JAE]: 'Jae', [SAM]: 'Sam' }, categories: [{ id: 'subs', name: 'Subscriptions' }], templates: [duo],
    });
    expect(JSON.stringify(recap)).not.toContain('7.99');
  });

  it('REC-12 control: two shared postings at different prices still make the note', () => {
    const shared = [entries[1] as InsightEntry, entry({ amount: 899, date: '2026-09-09', paid: { [JAE]: pence(899) }, shares: { [JAE]: pence(450), [SAM]: pence(449) }, splitMode: 'ratio' })];
    const out = notes({ entries: shared, templates: [duo], categories: [] }, '2026-10-31', { finished: true });
    expect(out.find((x) => x.kind === 'price')?.text).toBe('Duolingo went from £8.99 to £9.99');
  });
});
