/**
 * S9a core (docs/slices/S9a.md fixes 2 and 21; SPEC PLC-6 ADD-1 ADD-2 ADD-5): quick add abroad, and quick add saying
 * why it can't read something. Written before the build (ENGINEERING §5, tests first by someone else).
 *
 * Interface these tests expect:
 *
 *   src/core/money.ts
 *     MAX_PENCE: Pence                      exported (100_000_000, £1,000,000.00: the app's maximum, unchanged)
 *     amountProblem(text: string): 'empty' | 'unreadable' | 'tooLarge' | null
 *       Why an amount field's text is not an amount, for the sheet and quick add alike: null when parseAmount reads it;
 *       'tooLarge' when it reads as a well-formed amount (or sum) above MAX_PENCE; 'empty' for blank; else 'unreadable'.
 *
 *   src/core/fx.ts
 *     bareAmountCurrency(country: string | null | undefined): string | null
 *       PLC-6: the currency a bare quick-add amount is in: the country's currency when it has one and it isn't GBP;
 *       otherwise null (pounds).
 *
 *   src/core/quickadd.ts
 *     QuickAddContext gains   currency?: string | null   (the bare amount's currency; null/undefined: pounds)
 *                             rate?: string | null       (pounds per unit, exact text: the day's, or the last one the
 *                                                         phone has; null: none known)
 *     QuickAddReading gains   original?: { amount: string; currency: string; rate: string | null } | null
 *       With `currency` set, a bare amount ("2000", "1,200") is in that currency: `original.amount` is it as the sheet
 *       stores it (commas dropped), `amount` the pounds, foreignToPence(original.amount, rate), exactly as the sheet
 *       does for the same input. An amount written with "£" is pounds, as at home (card payments in pounds).
 *       With no rate, the reading is never confident (Enter opens the sheet) and keeps the original (rate null): it
 *       must never save the number as pounds. At home (`currency` null/undefined): `original` null or absent.
 *
 *     type QuickAddProblem = { kind: 'amount' } | { kind: 'tooLarge'; max: Pence } | { kind: 'noSuchDate'; day: number; month: number }
 *     quickAddProblem(text: string, ctx: QuickAddContext): QuickAddProblem | null
 *       Fix 21: why Enter can't save what was typed. No amount it can read ("abc", "30.555 x") → 'amount'; an amount
 *       above MAX_PENCE → 'tooLarge' with the maximum; an impossible day/month ("31/02") → 'noSuchDate'; null when
 *       parseQuickAdd reads it. parseQuickAdd never turns "31/02" into words of the description.
 */
import { describe, expect, it } from 'vitest';
import { bareAmountCurrency, foreignToPence } from './fx';
import { amountProblem, formatPlainPounds, MAX_PENCE, parseAmount, pence } from './money';
import { parseQuickAdd, quickAddProblem, type QuickAddContext } from './quickadd';

const CTX: QuickAddContext = {
  today: '2026-11-17', me: 'u-jae', partner: 'u-sam', names: { 'u-jae': 'Jae', 'u-sam': 'Sam' }, animals: { 'u-jae': 'cat', 'u-sam': 'dog' },
  categories: [{ id: 'c-groceries', name: 'Groceries' }, { id: 'c-eating-out', name: 'Eating out' }, { id: 'c-other', name: 'Other' }],
};
const RATE = '0.005265';
const JAPAN: QuickAddContext = { ...CTX, currency: 'JPY', rate: RATE };

describe('the maximum (fix 21)', () => {
  it('ADD-1: MAX_PENCE is exported and is £1,000,000.00; parseAmount takes it and refuses a penny more', () => {
    expect(MAX_PENCE).toBe(100_000_000);
    expect(parseAmount(formatPlainPounds(MAX_PENCE))).toBe(MAX_PENCE);
    expect(parseAmount(formatPlainPounds(pence(MAX_PENCE + 1)))).toBeNull();
  });

  it('ADD-5: amountProblem says why an amount isn’t one: too large, unreadable or empty', () => {
    expect(amountProblem('12.50')).toBeNull();
    expect(amountProblem('1,000,000')).toBeNull();
    expect(amountProblem('1000000.01')).toBe('tooLarge');
    expect(amountProblem('99999999')).toBe('tooLarge');
    expect(amountProblem('£2,000,000')).toBe('tooLarge');
    expect(amountProblem('999999+2')).toBe('tooLarge');
    expect(amountProblem('abc')).toBe('unreadable');
    expect(amountProblem('30.555')).toBe('unreadable');
    expect(amountProblem('   ')).toBe('empty');
  });
});

describe('quickAddProblem: Enter says why (fix 21)', () => {
  it('ADD-1: "abc" and "30.555 x" have no amount it can read', () => {
    expect(quickAddProblem('abc', CTX)).toEqual({ kind: 'amount' });
    expect(quickAddProblem('30.555 x', CTX)).toEqual({ kind: 'amount' });
  });

  it('ADD-1: more than the maximum names the maximum', () => {
    expect(quickAddProblem('2000000 car', CTX)).toEqual({ kind: 'tooLarge', max: MAX_PENCE });
    expect(quickAddProblem('1000000.01 house', CTX)).toEqual({ kind: 'tooLarge', max: MAX_PENCE });
  });

  it('ADD-1 DAT-3: "31/02" is no date ("There’s no 31 February"), and never becomes the description', () => {
    expect(quickAddProblem('12 tesco 31/02', CTX)).toEqual({ kind: 'noSuchDate', day: 31, month: 2 });
    expect(quickAddProblem('12 tesco 31/04', CTX)).toEqual({ kind: 'noSuchDate', day: 31, month: 4 });
    const r = parseQuickAdd('12 tesco 31/02', CTX);
    expect(r === null || !r.description.includes('31/02')).toBe(true);
  });

  it('ADD-1: what it can read has no problem', () => {
    expect(quickAddProblem('42.50 tesco', CTX)).toBeNull();
    expect(quickAddProblem('12 tesco 28/02', CTX)).toBeNull();
    expect(quickAddProblem('1000000 deposit', CTX)).toBeNull();
  });
});

describe('quick add abroad (PLC-6, fix 2)', () => {
  it('PLC-6: a bare amount is in the country’s currency unless that is pounds', () => {
    expect(bareAmountCurrency('JP')).toBe('JPY');
    expect(bareAmountCurrency('FR')).toBe('EUR');
    expect(bareAmountCurrency('GB')).toBeNull();
    expect(bareAmountCurrency('IM')).toBeNull();
    expect(bareAmountCurrency('ZZ')).toBeNull();
    expect(bareAmountCurrency(null)).toBeNull();
  });

  it('PLC-6 ADD-2: in Japan "2000 ramen" is ¥2,000 = £10.53, keeping the yen and the rate', () => {
    const r = parseQuickAdd('2000 ramen', JAPAN);
    expect(r).not.toBeNull();
    expect(r?.amount).toBe(1053);
    expect(r?.amount).toBe(foreignToPence('2000', RATE));
    expect(r?.original).toEqual({ amount: '2000', currency: 'JPY', rate: RATE });
    expect(r?.description).toBe('ramen');
    expect(r?.confident).toBe(true);
  });

  it('PLC-6: "1,200 ramen" keeps the yen as the sheet stores it (no commas), and the pounds exactly as the sheet works them out', () => {
    const r = parseQuickAdd('1,200 ramen', JAPAN);
    expect(r?.original).toEqual({ amount: '1200', currency: 'JPY', rate: RATE });
    expect(r?.amount).toBe(foreignToPence('1200', RATE));
    expect(r?.amount).toBe(632);
  });

  it('PLC-6: a big yen amount is not held to the pounds maximum as if it were pounds', () => {
    // ¥2,000,000 (a long stay) is about £10,530, well under £1,000,000.
    const r = parseQuickAdd('2000000 hotel', JAPAN);
    expect(r?.amount).toBe(foreignToPence('2000000', RATE));
  });

  it('PLC-6: "£12 coffee" abroad is pounds (paid by card in pounds)', () => {
    const r = parseQuickAdd('£12 coffee', JAPAN);
    expect(r?.amount).toBe(1200);
    expect(r?.original ?? null).toBeNull();
  });

  it('PLC-6: with no rate known it never reads the number as pounds: unsure (Enter opens the sheet), the yen kept', () => {
    const r = parseQuickAdd('2000 ramen', { ...JAPAN, rate: null });
    expect(r).not.toBeNull();
    expect(r?.confident).toBe(false);
    expect(r?.original).toEqual({ amount: '2000', currency: 'JPY', rate: null });
    expect(r?.amount).not.toBe(200000);
  });

  it('PLC-6: at home a bare amount is pounds, as before', () => {
    const home = parseQuickAdd('2000 ramen', CTX);
    expect(home?.amount).toBe(200000);
    expect(home?.original ?? null).toBeNull();
    const gbp = parseQuickAdd('2000 ramen', { ...CTX, currency: null, rate: null });
    expect(gbp?.amount).toBe(200000);
    expect(gbp?.original ?? null).toBeNull();
  });
});
