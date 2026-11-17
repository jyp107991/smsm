/** The add / edit / money-back form's rules (ADD-4, ADD-5, ADD-7, SPL-1, MB-1, MB-2). */
import { describe, expect, it } from 'vitest';
import { pence } from '../../core/money';
import type { ExpenseRow } from '../../data';
import type { Person } from '../shared/words';
import {
  blankForm, copyForm, draftOf, formFromRow, refundForm, remainderWords, setPayerShare, sumWords, summaryWords, withSplit,
} from './form';

const J: Person = { id: 'j', name: 'Jae', animal: 'cat' };
const S: Person = { id: 's', name: 'Sam', animal: 'dog' };
const people = [J, S];
const TODAY = '2026-11-14';
const blank = () => blankForm({ me: 'j', people, today: TODAY, split: { mode: 'ratio', ratio: { j: 50, s: 50 } } });

const row = (over: Partial<ExpenseRow> = {}): ExpenseRow => ({
  id: 'e1', kind: 'expense', description: 'Tesco', amount_pence: 4250, date: '2026-11-10', category_id: 'c1', paid: { j: 4250, s: 0 },
  shares: { j: 2125, s: 2125 }, split_mode: 'ratio', split_params: { j: 50, s: 50 }, notes: 'big shop', tags: ['weekly'], refund_of: null,
  created_by: 'j',
  ...over,
}) as ExpenseRow;

describe('the form', () => {
  it('ADD-5: sums are shown with their result', () => {
    expect(sumWords({ ...blank(), amountText: '18.50+4+12' })).toBe('= £34.50');
    expect(sumWords({ ...blank(), amountText: '18.50' })).toBeNull();
  });

  it('SPL-1 SPL-5: Exact shows the remainder live and refuses nothing itself (the data layer does)', () => {
    const f = { ...withSplit({ ...blank(), amountText: '30' }, { mode: 'exact', amounts: { j: pence(0), s: pence(0) } }, people) };
    expect(remainderWords({ ...f, exactText: { j: '10', s: '15' } }, people)).toBe('£5.00 left to share');
    expect(remainderWords({ ...f, exactText: { j: '10', s: '25' } }, people)).toBe('£5.00 more than the amount');
    expect(remainderWords({ ...f, exactText: { j: '10', s: '20' } }, people)).toBe('Adds up');
    expect(remainderWords({ ...f, exactText: { j: '30', s: '' } }, people)).toBe('Adds up');
    const d = draftOf({ ...f, description: 'Lamp', exactText: { j: '10', s: '20' } }, people);
    expect(d).toMatchObject({ draft: { amount: 3000, split: { mode: 'exact', amounts: { j: 1000, s: 2000 } } } });
  });

  it('ADD-4: no amount, no save, in plain words', () => {
    expect(draftOf({ ...blank(), description: 'x' }, people)).toEqual({ errors: ['Write an amount, like 12.50.'] });
  });

  it('SPL-1: presets and the slider set each person\'s percentage from the payer\'s side', () => {
    const f = setPayerShare({ ...blank(), payer: 's' }, 70, people);
    expect(f.ratio).toEqual({ s: 70, j: 30 });
    expect(summaryWords({ ...f, amountText: '10' }, people)).toBe('Sam paid £10.00 · Jae £3.00, Sam £7.00');
  });

  it('ACT-5: an edit starts from the entry as it was entered', () => {
    const f = formFromRow(row(), people);
    expect(f).toMatchObject({ amountText: '42.50', description: 'Tesco', payer: 'j', splitMode: 'ratio', ratio: { j: 50, s: 50 }, date: '2026-11-10', notes: 'big shop' });
    expect(formFromRow(row({ split_mode: 'exact', split_params: null, shares: { j: 1000, s: 3250 } }), people).exactText).toEqual({ j: '10.00', s: '32.50' });
    // No parameters stored: read back from the shares.
    expect(formFromRow(row({ split_params: null, shares: { j: 2975, s: 1275 } }), people).ratio).toEqual({ j: 70, s: 30 });
  });

  it('MB-1 MB-2: Refund this is money back for the original, same split, received by whoever paid', () => {
    const f = refundForm(row(), people);
    expect(f).toMatchObject({ kind: 'money_back', refundOf: 'e1', amountText: '', payer: 'j', splitMode: 'ratio', ratio: { j: 50, s: 50 } });
    expect(summaryWords({ ...f, amountText: '10' }, people)).toBe('Jae got £10.00 back · Jae £5.00, Sam £5.00');
  });

  it('ADD-7: a copy is dated today', () => {
    expect(copyForm(row(), people, TODAY)).toMatchObject({ date: TODAY, amountText: '42.50', kind: 'expense', refundOf: null });
  });
});
