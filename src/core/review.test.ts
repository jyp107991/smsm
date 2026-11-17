// Cases found by the fresh review of S0/S1 (ENGINEERING §5: a bug gets a failing test first, then the fix).
import { describe, expect, it } from 'vitest';
import { occurrence, dueOccurrences } from './recurring';
import { isIsoDate } from './dates';
import { parseQuickAdd } from './quickadd';

const cats = ['Groceries', 'Eating out', 'Rent & bills', 'Utilities', 'Transport', 'Subscriptions', 'Household', 'Going out', 'Travel', 'Gifts', 'Health', 'Other'].map((n) => ({ id: `c-${n}`, name: n }));
const ctx = { today: '2026-11-17', me: 'J', partner: 'S', names: { J: 'Jae', S: 'Sam' }, animals: { J: 'dog' as const, S: 'cat' as const }, categories: cats };

describe('ADD-1 quick add: words that look like commands but are part of the description', () => {
  it.each([
    ['12 cat food', 'cat food'],
    ['18 dog food', 'dog food'],
    ['30 dog walker', 'dog walker'],
    ['35 dinner with sam', 'dinner with sam'],
  ])('%s keeps "%s" as the description, payer me, and is unsure', (text, description) => {
    const r = parseQuickAdd(text, ctx);
    expect(r?.description).toBe(description);
    expect(r?.payer).toBe('J');
    expect(r?.confident).toBe(false);
  });
  it('"paid by sam" names the payer', () => {
    const r = parseQuickAdd('42 tesco paid by sam', ctx);
    expect(r?.payer).toBe('S');
    expect(r?.description).toBe('tesco');
  });
  it('a two-digit year is never in the future, and a later full date is not a date', () => {
    expect(parseQuickAdd('42 tesco 12/11/99', ctx)?.date).toBe('1999-11-12');
    expect(parseQuickAdd('42 tesco 12/11/26', ctx)?.date).toBe('2026-11-12');
    const later = parseQuickAdd('42 tesco 12/11/2027', ctx);
    expect(later?.date).toBe('2026-11-17');
    expect(later?.confident).toBe(false);
  });
});

describe('REC-2 recurring: impossible schedules are refused, not looped on', () => {
  it('every 0 or a fraction throws', () => {
    const s = { frequency: 'monthly' as const, every: 0, startDate: '2026-01-01', endDate: null };
    expect(() => occurrence(s, 1)).toThrow(RangeError);
    expect(() => dueOccurrences(s, 0, '2026-12-01')).toThrow(RangeError);
    expect(() => occurrence({ ...s, every: 1.5 }, 1)).toThrow(RangeError);
  });
});

describe('DAT-3 dates before the year 1000 are not valid entry dates', () => {
  it('0099-01-01 is refused', () => {
    expect(isIsoDate('0099-01-01')).toBe(false);
    expect(isIsoDate('1999-01-01')).toBe(true);
  });
});
