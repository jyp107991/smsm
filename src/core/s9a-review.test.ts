/**
 * S9a fresh review, the core (docs/DECISIONS.md, 23 Nov, "S9a review"):
 *   1. Quick add abroad: an amount without "£" is in the country's currency, read by the same grammar as pounds (a
 *      decimal comma, "+" sums) into an exact foreign amount; one it can't read that way is never confident (Enter
 *      opens the sheet) and never pounds. "£12" is still pounds.
 *   4. What has come back on an original so far (cameBack): its amount may not be edited below it.
 *   5. Pace at month ends: after the 28th a comparison month is counted from its end, so a bill on the last day of
 *      each month lands on the last day of every month; on the month's last day every month counts in full.
 */
import { describe, expect, it } from 'vitest';
import { cameBack, unrefunded } from './balance';
import { addDays, daysInMonth, type IsoDate } from './dates';
import { foreignToPence } from './fx';
import { pace, sameDayIn, usualByDay, type InsightEntry } from './insights';
import { parseAmount, parseForeignAmount, pence } from './money';
import { parseQuickAdd, quickAddProblem, type QuickAddContext } from './quickadd';

const CTX: QuickAddContext = {
  today: '2026-11-17', me: 'u-jae', partner: 'u-sam', names: { 'u-jae': 'Jae', 'u-sam': 'Sam' }, animals: { 'u-jae': 'cat', 'u-sam': 'dog' },
  categories: [{ id: 'c-groceries', name: 'Groceries' }, { id: 'c-eating-out', name: 'Eating out' }, { id: 'c-other', name: 'Other' }],
};
const FRANCE: QuickAddContext = { ...CTX, currency: 'EUR', rate: '0.85' };
const JAPAN: QuickAddContext = { ...CTX, currency: 'JPY', rate: '0.005265' };

describe('parseForeignAmount: the pounds grammar, for another currency (PLC-6)', () => {
  it('PLC-6: a decimal comma, sums and thousands read exactly, as the sheet stores them', () => {
    expect(parseForeignAmount('12,50')).toBe('12.50');
    expect(parseForeignAmount('1000+500')).toBe('1500');
    expect(parseForeignAmount('1,200')).toBe('1200');
    expect(parseForeignAmount('12.5')).toBe('12.50');
    expect(parseForeignAmount('12.05')).toBe('12.05');
    expect(parseForeignAmount('2000')).toBe('2000');
    expect(parseForeignAmount('１２,５０')).toBe('12.50');
    expect(parseForeignAmount('8,50+3')).toBe('11.50');
  });

  it('PLC-6: no pounds limit (a big yen amount is not pounds), but never "£", zero, junk or three decimals', () => {
    expect(parseForeignAmount('2000000')).toBe('2000000');
    expect(parseAmount('2000000')).toBeNull();
    expect(parseForeignAmount('£12')).toBeNull();
    expect(parseForeignAmount('￡12')).toBeNull();
    expect(parseForeignAmount('0')).toBeNull();
    expect(parseForeignAmount('1.200,50')).toBeNull();
    expect(parseForeignAmount('12.505')).toBeNull();
    expect(parseForeignAmount('abc')).toBeNull();
    expect(parseForeignAmount('')).toBeNull();
    expect(parseForeignAmount('99999999999999999999')).toBeNull();
  });
});

describe('quick add abroad never reads pounds (PLC-6, review finding 1)', () => {
  it('PLC-6 ADD-5: in France "12,50 café" is €12.50 = £10.63 (was saved as £12.50)', () => {
    const r = parseQuickAdd('12,50 café', FRANCE);
    expect(r?.original).toEqual({ amount: '12.50', currency: 'EUR', rate: '0.85' });
    expect(r?.amount).toBe(foreignToPence('12.50', '0.85'));
    expect(r?.amount).toBe(1063);
    expect(r?.description).toBe('café');
    expect(r?.confident).toBe(true);
  });

  it('PLC-6 ADD-5: in Japan "1000+500 ramen" is ¥1,500 = £7.90 (was saved as £1,500.00)', () => {
    const r = parseQuickAdd('1000+500 ramen', JAPAN);
    expect(r?.original).toEqual({ amount: '1500', currency: 'JPY', rate: '0.005265' });
    expect(r?.amount).toBe(foreignToPence('1500', '0.005265'));
    expect(r?.amount).toBe(790);
    expect(r?.confident).toBe(true);
  });

  it('PLC-6: "£12 coffee" abroad is still pounds', () => {
    const r = parseQuickAdd('£12 coffee', FRANCE);
    expect(r?.amount).toBe(1200);
    expect(r?.original ?? null).toBeNull();
    expect(r?.confident).toBe(true);
  });

  it('PLC-6: an amount it can’t read in euros ("1.200,50") is not confident (Enter opens the sheet) and never pounds', () => {
    const r = parseQuickAdd('1.200,50 hotel', FRANCE);
    expect(r).not.toBeNull();
    expect(r?.confident).toBe(false);
    expect(r?.original).toMatchObject({ amount: '1.200,50', currency: 'EUR' });
    expect(r?.amount).toBe(0);
    expect(r?.description).toBe('hotel');
    expect(quickAddProblem('1.200,50 hotel', FRANCE)).toBeNull();
    // At home the same words have no amount it can read, as before.
    expect(quickAddProblem('1.200,50 hotel', CTX)).toEqual({ kind: 'amount' });
  });

  it('PLC-6: abroad, words with no amount still have none; more than the maximum in pounds is still too large', () => {
    expect(quickAddProblem('café', FRANCE)).toEqual({ kind: 'amount' });
    expect(quickAddProblem('2000000 villa', FRANCE)).toMatchObject({ kind: 'tooLarge' });
    expect(parseQuickAdd('2000000 villa', FRANCE)?.amount ?? null).not.toBe(200000000);
  });
});

describe('cameBack: what has come back on an original (MB-2, review finding 4)', () => {
  const rows = [
    { id: 'o', kind: 'expense' as const, amount: pence(10000), refundOf: null, deleted: false },
    { id: 'r1', kind: 'money_back' as const, amount: pence(3000), refundOf: 'o', deleted: false },
    { id: 'r2', kind: 'money_back' as const, amount: pence(2000), refundOf: 'o', deleted: false },
    { id: 'r3', kind: 'money_back' as const, amount: pence(4000), refundOf: 'o', deleted: true },
    { id: 'r4', kind: 'money_back' as const, amount: pence(500), refundOf: 'other', deleted: false },
    { id: 'x', kind: 'expense' as const, amount: pence(700), refundOf: 'o', deleted: false },
  ];
  it('MB-2: live linked money back only (deleted, other originals and expenses left out); one may be left out', () => {
    expect(cameBack('o', rows)).toBe(5000);
    expect(cameBack('o', rows, 'r1')).toBe(2000);
    expect(cameBack('nothing', rows)).toBe(0);
    expect(unrefunded({ id: 'o', amount: pence(10000) }, rows)).toBe(5000);
    expect(unrefunded({ id: 'o', amount: pence(4000) }, rows)).toBe(0);
  });
});

// ───────── finding 5: pace at month ends ─────────

/** £1,000.00 of rent on the last day of every month from January 2025 up to `upTo` (and nothing else). */
function rentOnLastDays(upTo: IsoDate): InsightEntry[] {
  const out: InsightEntry[] = [];
  for (let y = 2025; y <= 2028; y += 1) {
    for (let m = 1; m <= 12; m += 1) {
      const date = `${String(y)}-${String(m).padStart(2, '0')}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
      if (date > upTo) return out;
      out.push({
        id: `rent-${date}`, kind: 'expense', description: 'Rent', amount: pence(100000), paid: { a: pence(100000) }, shares: { a: pence(50000), b: pence(50000) },
        splitMode: 'ratio', date, categoryId: 'rent', chapterId: null, country: 'GB', recurringId: 'r', deleted: false,
      });
    }
  }
  return out;
}

describe('pace at month ends (INS-1, review finding 5)', () => {
  it('INS-1: the day of a comparison month that matches today: the same up to the 28th, then counted from the end', () => {
    expect(sameDayIn(14, 30, 31)).toBe(14);
    expect(sameDayIn(28, 29, 28)).toBe(28);
    expect(sameDayIn(28, 28, 31)).toBe(31);
    expect(sameDayIn(30, 30, 31)).toBe(31);
    expect(sameDayIn(30, 31, 30)).toBe(29);
    expect(sameDayIn(30, 31, 31)).toBe(30);
    expect(sameDayIn(29, 31, 28)).toBe(26);
    expect(sameDayIn(31, 31, 28)).toBe(28);
    expect(sameDayIn(29, 29, 31)).toBe(31);
    expect(sameDayIn(29, 31, 1)).toBe(1);
  });

  it('INS-1: 30 November with the rent posted: on pace (was "£670 over"), every earlier month counted in full', () => {
    const entries = rentOnLastDays('2026-11-30');
    expect(usualByDay(entries, '2026-11-30')).toEqual({ total: 600000, months: 6 });
    expect(pace(entries, '2026-11-30')).toMatchObject({ soFar: 100000, direction: 'on' });
  });

  it('INS-1: 30 October with the rent due tomorrow: on pace (was "£400 under"): no month’s last day is counted yet', () => {
    const entries = rentOnLastDays('2026-10-29');
    expect(usualByDay(entries, '2026-10-30')).toEqual({ total: 0, months: 6 });
    expect(pace(entries, '2026-10-30')).toMatchObject({ soFar: 0, direction: 'on' });
  });

  it('INS-1: 28 February (not a leap year) is the month’s last day: every month counts in full', () => {
    const entries = rentOnLastDays('2027-02-28');
    expect(usualByDay(entries, '2027-02-28')).toEqual({ total: 600000, months: 6 });
    expect(pace(entries, '2027-02-28')).toMatchObject({ soFar: 100000, direction: 'on' });
  });

  it('INS-1: 28 February in a leap year, the rent due on the 29th: nothing usually lands by then', () => {
    const entries = rentOnLastDays('2028-02-27');
    expect(usualByDay(entries, '2028-02-28')).toEqual({ total: 0, months: 6 });
    expect(pace(entries, '2028-02-28')).toMatchObject({ soFar: 0, direction: 'on' });
    // And on the 29th, with it posted, every month counts in full.
    const posted = rentOnLastDays('2028-02-29');
    expect(usualByDay(posted, '2028-02-29')).toEqual({ total: 600000, months: 6 });
    expect(pace(posted, '2028-02-29')).toMatchObject({ soFar: 100000, direction: 'on' });
  });

  it('INS-1: 31 March, the rent posted: on pace; the day before, with it due: on pace too', () => {
    const entries = rentOnLastDays('2027-03-31');
    expect(usualByDay(entries, '2027-03-31')).toEqual({ total: 600000, months: 6 });
    expect(pace(entries, '2027-03-31')).toMatchObject({ soFar: 100000, direction: 'on' });
    const before = rentOnLastDays(addDays('2027-03-31', -1));
    expect(usualByDay(before, '2027-03-30')).toEqual({ total: 0, months: 6 });
    expect(pace(before, '2027-03-30')).toMatchObject({ soFar: 0, direction: 'on' });
  });

  it('INS-1: mid-month is unchanged: a bill on the 14th counts from the 14th', () => {
    const entries: InsightEntry[] = rentOnLastDays('2026-10-31').map((e) => ({ ...e, date: `${e.date.slice(0, 8)}14` }));
    expect(usualByDay(entries, '2026-11-13')).toEqual({ total: 0, months: 6 });
    expect(usualByDay(entries, '2026-11-14')).toEqual({ total: 600000, months: 6 });
  });
});
