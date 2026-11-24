/**
 * Live eval 24 Nov (run 45367987613): 17 of 20 Indonesian receipts came back wrong by a power of ten, because the
 * model turned "60.000" (sixty thousand rupiah, a dot for thousands) into hundredths itself. Now the model copies each
 * amount as printed and code reads it (docs/AI.md §3.1): parsePrinted(text, currency) gives whole hundredths of the
 * receipt's currency, the unit the scan reply and the form already use (¥648 is 64800; Rp 60.000 is 6000000).
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parsePrinted } from './money';

describe('parsePrinted: an amount as a receipt prints it (SCAN-1; AI.md §3.1)', () => {
  it('SCAN-1: a dot or a comma before exactly three digits groups thousands (Indonesian, Vietnamese, Korean receipts)', () => {
    expect(parsePrinted('60.000', 'IDR')).toBe(6_000_000);
    expect(parsePrinted('28,000', 'IDR')).toBe(2_800_000);
    expect(parsePrinted('377,859', 'IDR')).toBe(37_785_900);
    expect(parsePrinted('909', 'IDR')).toBe(90_900);
    expect(parsePrinted('176000', 'IDR')).toBe(17_600_000);
    expect(parsePrinted('1.250.000', 'VND')).toBe(125_000_000);
    expect(parsePrinted('12,500', 'KRW')).toBe(1_250_000);
    expect(parsePrinted('1,200', 'GBP')).toBe(120_000);
  });

  it('SCAN-1: a dot or comma before one or two digits is the decimal point, in any currency', () => {
    expect(parsePrinted('12.34', 'GBP')).toBe(1234);
    expect(parsePrinted('12.5', 'GBP')).toBe(1250);
    expect(parsePrinted('12,50', 'EUR')).toBe(1250);
    expect(parsePrinted('0.99', 'USD')).toBe(99);
    expect(parsePrinted('648', 'JPY')).toBe(64_800);
  });

  it('SCAN-1: with both marks, the last one is the decimal point and the other groups thousands', () => {
    expect(parsePrinted('1,234.56', 'GBP')).toBe(123_456);
    expect(parsePrinted('1.234,56', 'EUR')).toBe(123_456);
    expect(parsePrinted('12.345,6', 'EUR')).toBe(1_234_560);
    expect(parsePrinted('60.000,00', 'IDR')).toBe(6_000_000);
    expect(parsePrinted('1,234,567.89', 'USD')).toBe(123_456_789);
  });

  it('SCAN-1: spaces and apostrophes group thousands too (French, Swiss receipts)', () => {
    expect(parsePrinted('1 234,56', 'EUR')).toBe(123_456);
    expect(parsePrinted('1 234,56', 'EUR')).toBe(123_456);
    expect(parsePrinted('1 234,56', 'EUR')).toBe(123_456);
    expect(parsePrinted("1'234.50", 'CHF')).toBe(123_450);
    expect(parsePrinted('1’234.50', 'CHF')).toBe(123_450);
  });

  it('SCAN-1: symbols, codes, signs and brackets round the number are ignored (the caller knows a discount from a total)', () => {
    expect(parsePrinted('Rp 60.000', 'IDR')).toBe(6_000_000);
    expect(parsePrinted('Rp38.000', 'IDR')).toBe(3_800_000);
    expect(parsePrinted('Rp. 111,000', 'IDR')).toBe(11_100_000);
    expect(parsePrinted('60.000,-', 'IDR')).toBe(6_000_000);
    expect(parsePrinted('£12.34', 'GBP')).toBe(1234);
    expect(parsePrinted('€ 5', 'EUR')).toBe(500);
    expect(parsePrinted('¥648', 'JPY')).toBe(64_800);
    expect(parsePrinted('-19,400', 'IDR')).toBe(1_940_000);
    expect(parsePrinted('(5.000)', 'IDR')).toBe(500_000);
    expect(parsePrinted('IDR 17,000', 'IDR')).toBe(1_700_000);
    expect(parsePrinted('１２.３４', 'GBP')).toBe(1234);
  });

  it('SCAN-1: three-decimal currencies keep a three-digit decimal part (to whole hundredths only)', () => {
    expect(parsePrinted('1.250', 'KWD')).toBe(125);
    expect(parsePrinted('12.500', 'BHD')).toBe(1250);
    expect(parsePrinted('1.255', 'KWD')).toBeNull();
    expect(parsePrinted('1,234.500', 'OMR')).toBe(123_450);
  });

  it('SCAN-1: every three-decimal currency, in any case; others group the same text', () => {
    for (const cur of ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND', 'kwd']) expect(parsePrinted('1.250', cur), cur).toBe(125);
    for (const cur of ['EUR', 'GBP', 'IDR', 'USD']) expect(parsePrinted('1.250', cur), cur).toBe(125_000);
    // With both marks the last is the decimal point, whatever the currency (zeros past hundredths only).
    expect(parsePrinted('1.234,500', 'EUR')).toBe(123_450);
  });

  it('SCAN-1: groups: the first has one to three digits and isn’t a lone 0; every later one has exactly three', () => {
    for (const bad of ['1234,567', '1234.567.890', '0 500', '0.500.000', '1.2345.678', '1 23 456', '12 3456']) {
      expect(parsePrinted(bad, 'IDR'), bad).toBeNull();
    }
    expect(parsePrinted('123.456.789', 'IDR')).toBe(12_345_678_900);
  });

  it('SCAN-1: words or dot leaders before the number don’t change it ("Rp.38.000", "TOTAL ..... 12.50")', () => {
    expect(parsePrinted('Rp.38.000', 'IDR')).toBe(3_800_000);
    expect(parsePrinted('TOTAL ..... 12.50', 'GBP')).toBe(1250);
    expect(parsePrinted('Rp,5.000', 'IDR')).toBe(500_000);
  });

  it('SCAN-1: "0.500" can only be a decimal (no group starts with a lone 0); digits past hundredths must be zeros', () => {
    expect(parsePrinted('0.500', 'GBP')).toBe(50);
    expect(parsePrinted('0.505', 'GBP')).toBeNull();
  });

  it('SCAN-5: anything that is not one readable amount is null (the form then asks the person)', () => {
    for (const bad of ['', '   ', 'abc', 'Rp', '2 x 38', '1 60.000', '12.34 1', '1.2.3', '1,2345', '12,34,567', '1,23,456', '1.234.56', '1.234,567.89', '.50', ',', '1,,000']) {
      expect(parsePrinted(bad, 'GBP'), bad).toBeNull();
    }
    expect(parsePrinted('1.2345', null)).toBeNull();
    // A mark after the number ("12." at the end of a line, "60.000,-") is not part of it.
    expect(parsePrinted('12.', 'GBP')).toBe(1200);
  });

  it('SCAN-1: a currency the app doesn’t know, or none, reads by the same marks', () => {
    expect(parsePrinted('60.000', null)).toBe(6_000_000);
    expect(parsePrinted('12.34', null)).toBe(1234);
    expect(parsePrinted('60.000', 'XYZ')).toBe(6_000_000);
  });

  it('SCAN-1: a well-grouped printed amount always reads back to the same number (property)', () => {
    const fmt = (n: number, group: string, decimal: string) => {
      const units = Math.floor(n / 100);
      const cents = n % 100;
      const grouped = String(units).replace(/\B(?=(\d{3})+(?!\d))/g, group);
      return `${grouped}${decimal}${String(cents).padStart(2, '0')}`;
    };
    fc.assert(fc.property(fc.integer({ min: 0, max: 99_999_999_999 }), fc.constantFrom(['.', ','] as const, [',', '.'] as const, [' ', ','] as const, ["'", '.'] as const), (n, [g, d]) => {
      expect(parsePrinted(fmt(n, g, d), 'EUR')).toBe(n);
    }));
    fc.assert(fc.property(fc.integer({ min: 0, max: 99_999_999 }), fc.constantFrom('.', ',', ' '), (units, g) => {
      const grouped = String(units).replace(/\B(?=(\d{3})+(?!\d))/g, g);
      expect(parsePrinted(grouped, 'IDR')).toBe(units * 100);
    }));
  });

  it('SCAN-5: never throws, whatever the text', () => {
    fc.assert(fc.property(fc.string(), fc.option(fc.string({ maxLength: 3 }), { nil: null }), (s, cur) => {
      const r = parsePrinted(s, cur);
      expect(r === null || (Number.isSafeInteger(r) && r >= 0)).toBe(true);
    }));
  });
});
