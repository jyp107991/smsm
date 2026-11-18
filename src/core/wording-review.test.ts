/** S6b fresh review: wording that sounded right but put a figure in the wrong role, or one the guard can't check. */
import { describe, expect, it } from 'vitest';
import { pence } from './money';
import type { Recap } from './recap';
import { recapStats, wordingGuard } from './wording';

const JAE = 'jae';
const SAM = 'sam';
const OCTOBER: Recap = {
  month: '2026-10', soFar: false, total: pence(136550), everyday: pence(136550), usual: pence(148500),
  comparison: { direction: 'less', amount: pence(12000) }, headline: '',
  bar: [{ categoryId: 'r', name: 'Rent & bills', total: pence(100000) }, { categoryId: 'g', name: 'Groceries', total: pence(24050) }, { categoryId: 'e', name: 'Eating out', total: pence(12500) }],
  notes: [{ kind: 'category', text: 'Eating out is £85 over its usual (£210 so far, usually £125)', weight: pence(8500) }],
  paid: { [JAE]: pence(100000), [SAM]: pence(36550) }, balance: null, moment: null,
};
const stats = recapStats(OCTOBER, [JAE, SAM]);
const guard = (headline: string) => wordingGuard(stats, { headline, aside: null }, { A: 'Jae', B: 'Sam' });

describe('wordingGuard: each figure in its own role (review 2)', () => {
  it('INS-2: who paid what can’t be swapped', () => {
    expect(guard('Person A paid £365.50 and Person B paid £1,000.00.')).toBeNull();
    expect(guard('Person A paid £1,000.00 and Person B paid £365.50.')).not.toBeNull();
    expect(guard('£365.50 was paid by Person A.')).toBeNull();
  });

  it('INS-2: a category’s total can’t be another’s', () => {
    expect(guard('Groceries came to £125.00 and Eating out to £240.50.')).toBeNull();
    expect(guard('Groceries came to £240.50.')).not.toBeNull();
    expect(guard('£1,000.00 on Groceries.')).toBeNull();
  });

  it('INS-2: a difference only as the month’s own, whatever the words', () => {
    expect(guard('October was £120 below usual.')).not.toBeNull();
    expect(guard('October was £120 above usual.')).toBeNull();
    expect(guard('Up by £120 on usual.')).toBeNull();
    expect(guard('Groceries were £85 over.')).toBeNull();
  });

  it('INS-2: numbers the guard can’t check are refused', () => {
    for (const s of ['Person A paid 3x more than Person B.', 'Twice as much as usual.', 'About twelve hundred pounds.', 'Around £1.3k.',
      'Down £-120.', 'October came to £١٬٣٦٥.', 'October came to £１３６５.５０.', 'Half went on rent.']) {
      expect(guard(s), s).toBeNull();
    }
  });
});

describe('wordingGuard: the article A (review 3)', () => {
  it('INS-2: "A quiet October" keeps its article; "Person A" is the name; a bare "A paid" is refused', () => {
    expect(guard('A quiet October: £1,365.50 together.')).toEqual({ headline: 'A quiet October: £1,365.50 together.', aside: null });
    expect(guard('Person A covered £1,000.00.')).toEqual({ headline: 'Jae covered £1,000.00.', aside: null });
    expect(guard('A paid £1,000.00.')).toBeNull();
  });
});
