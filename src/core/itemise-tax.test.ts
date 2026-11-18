/**
 * S6b addition to the S6a receipt core (docs/slices/S6b.md "Found while choosing them", as changed on 18 Nov): many
 * receipts add tax on top of the lines (CORD's restaurant bills: subtotal + service + tax = total), so the scan reply
 * gains `tax_pence` and the core counts it like service. Written before the build (ENGINEERING §5, tests first by
 * someone else). The S6a contract (src/core/itemise.test.ts) is unchanged: every call without tax still works.
 *
 * Interface these tests expect, in src/core/itemise.ts and src/core/aiReplies.ts:
 *
 *   checkTotal(items, discount, service, total, tax?: Pence = 0) → { adds, lines }
 *     lines = Σ items − discount + service + tax; adds = (lines === total).
 *   itemise(items, ticked, discount, service, tax?: Pence = 0) → { amount, perLine }
 *     The tax is shared out over ALL the lines in proportion to their pence, by largest remainder (ties to the earlier
 *     line), exactly as the service charge is; a line's net = its pence − its part of the discount + its part of the
 *     service + its part of the tax. All ticked: amount = Σ items − discount + service + tax, exactly.
 *   scanGuards(raw, today, categories): tax_pence, when the reply has it, is kept if a non-negative whole number and
 *     becomes 0 otherwise. A reply without tax_pence comes back without it (S6a's exact keys) and is read as 0.
 *   scanSchema / checkReply('scan', …): tax_pence is optional (a whole number of hundredths, ≥ 0); the schema is still
 *     strict, so an unknown field (e.g. "vat_pence") is invalid. UK receipts, VAT inside the prices, read 0 or none.
 *
 * Loaded by a computed path, like src/core/itemise.test.ts, so this file type-checks before the build.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { IsoDate } from './dates';
import { pence, type Pence } from './money';

interface ReceiptLine { label: string; pence: Pence }
interface ScanReply {
  merchant: string | null; date: string | null; currency: string | null; total_pence: number | null;
  items: { label: string; pence: number }[]; discount_pence: number; service_pence: number; tax_pence?: number;
  category: string | null; confidence: 'high' | 'medium' | 'low';
}
interface ItemiseCore {
  itemise(items: readonly ReceiptLine[], ticked: readonly boolean[], discount: Pence, service: Pence, tax?: Pence): { amount: Pence; perLine: Pence[] };
  checkTotal(items: readonly ReceiptLine[], discount: Pence, service: Pence, total: Pence | null, tax?: Pence): { adds: boolean; lines: Pence };
  scanGuards(raw: ScanReply, today: IsoDate, categories: readonly string[]): ScanReply | null;
}
interface Replies { checkReply(task: 'scan', json: unknown): unknown }

const ITEMISE = './itemise';
const REPLIES = './aiReplies';
const loaded = (await import(/* @vite-ignore */ ITEMISE).catch(() => null)) as Partial<ItemiseCore> | null;
const replies = (await import(/* @vite-ignore */ REPLIES).catch(() => null)) as Partial<Replies> | null;
function core(): ItemiseCore {
  if (typeof loaded?.itemise !== 'function' || typeof loaded.checkTotal !== 'function' || typeof loaded.scanGuards !== 'function') {
    throw new Error('src/core/itemise.ts does not export itemise, checkTotal, scanGuards');
  }
  return loaded as ItemiseCore;
}
function checkReply(json: unknown): unknown {
  if (typeof replies?.checkReply !== 'function') throw new Error('src/core/aiReplies.ts does not export checkReply');
  return replies.checkReply('scan', json);
}

const p = pence;
const lines = (...ps: number[]): ReceiptLine[] => ps.map((x, i) => ({ label: `Line ${String(i + 1)}`, pence: p(x) }));
const all = (n: number) => Array.from({ length: n }, () => true);
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const TODAY = '2026-11-17';
const CATEGORIES = ['Groceries', 'Eating out', 'Other'];

/** A CORD-style restaurant bill (hundredths of rupiah): lines 238,000, service 17,850, tax 25,585, total 281,435. */
const CORD = [
  { label: 'NASI GORENG SPECIAL', pence: p(120000) }, { label: 'ES TEH MANIS', pence: p(40000) }, { label: 'AYAM BAKAR', pence: p(78000) },
];
const reply = (over: Partial<ScanReply> = {}): ScanReply => ({
  merchant: 'Warung Makan', date: '2026-11-12', currency: 'IDR', total_pence: 281435,
  items: CORD.map((l) => ({ label: l.label, pence: l.pence })), discount_pence: 0, service_pence: 17850, tax_pence: 25585,
  category: 'Eating out', confidence: 'high', ...over,
});

describe('tax on top of the lines: checkTotal (SCAN-3)', () => {
  it('SCAN-3: a CORD-style bill adds up: 238,000 + service 17,850 + tax 25,585 = 281,435', () => {
    expect(sum(CORD.map((l) => l.pence))).toBe(238000);
    expect(core().checkTotal(CORD, p(0), p(17850), p(281435), p(25585))).toEqual({ adds: true, lines: 281435 });
  });

  it('SCAN-3: without its tax the same bill doesn’t add up (S6a’s four arguments: tax is 0)', () => {
    expect(core().checkTotal(CORD, p(0), p(17850), p(281435))).toEqual({ adds: false, lines: 255850 });
    expect(core().checkTotal(CORD, p(0), p(17850), p(281435), p(0))).toEqual({ adds: false, lines: 255850 });
  });

  it('SCAN-3: lines − discount + service + tax, whatever the figures (property)', () => {
    fc.assert(fc.property(
      fc.array(fc.integer({ min: 0, max: 100_000 }), { maxLength: 8 }), fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 5000 }),
      (ps, discount, service, tax) => {
        const want = sum(ps) - discount + service + tax;
        expect(core().checkTotal(lines(...ps), p(discount), p(service), p(want), p(tax))).toEqual({ adds: true, lines: want });
      },
    ), { numRuns: 200 });
  });
});

describe('tax on top of the lines: itemise (SCAN-2)', () => {
  it('SCAN-2: all ticked, the CORD bill shares its whole total', () => {
    const r = core().itemise(CORD, all(3), p(0), p(17850), p(25585));
    expect(r.amount).toBe(281435);
    expect(sum(r.perLine)).toBe(281435);
  });

  it('SCAN-2: tax is shared over the lines in proportion, largest remainder: 100, 200, 300 with 100 tax → 117, 233, 350', () => {
    // Parts 16.67, 33.33, 50 → 16, 33, 50 with one penny left, which goes to the largest fraction (the first line).
    expect(core().itemise(lines(100, 200, 300), all(3), p(0), p(0), p(100))).toEqual({ amount: 700, perLine: [117, 233, 350] });
    expect(core().itemise(lines(100, 200, 300), [true, false, true], p(0), p(0), p(100))).toEqual({ amount: 467, perLine: [117, 0, 350] });
  });

  it('SCAN-2: a line’s figure doesn’t depend on which others are ticked; unticked lines share nothing', () => {
    const ticked = core().itemise(CORD, [false, true, false], p(0), p(17850), p(25585));
    const allTicked = core().itemise(CORD, all(3), p(0), p(17850), p(25585));
    expect(ticked.perLine).toEqual([0, allTicked.perLine[1], 0]);
    expect(ticked.amount).toBe(allTicked.perLine[1]);
  });

  it('SCAN-2: with no tax given it is S6a’s itemise exactly', () => {
    expect(core().itemise(lines(100, 200, 300), all(3), p(100), p(0))).toEqual(core().itemise(lines(100, 200, 300), all(3), p(100), p(0), p(0)));
  });

  it('SCAN-2: exact with discount, service and tax together; never negative (property)', () => {
    fc.assert(fc.property(
      fc.array(fc.integer({ min: 0, max: 50_000 }), { minLength: 1, maxLength: 8 }), fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 5000 }),
      (ps, discount, service, tax) => {
        const items = lines(...ps);
        const r = core().itemise(items, all(ps.length), p(discount), p(service), p(tax));
        expect(r.amount).toBe(sum(ps) - Math.min(discount, sum(ps)) + service + tax);
        expect(sum(r.perLine)).toBe(r.amount);
        for (const x of r.perLine) expect(Number.isSafeInteger(x) && x >= 0).toBe(true);
      },
    ), { numRuns: 200 });
  });
});

describe('tax in the scan reply: guards and schema (SCAN-1, SCAN-3, SCAN-5)', () => {
  it('SCAN-1: scanGuards keeps a whole, non-negative tax', () => {
    expect(core().scanGuards(reply(), TODAY, CATEGORIES)?.tax_pence).toBe(25585);
    expect(core().scanGuards(reply({ tax_pence: 0 }), TODAY, CATEGORIES)?.tax_pence).toBe(0);
  });

  it('SCAN-1: a negative or fractional tax becomes 0', () => {
    expect(core().scanGuards(reply({ tax_pence: -500 }), TODAY, CATEGORIES)?.tax_pence).toBe(0);
    expect(core().scanGuards(reply({ tax_pence: 12.5 }), TODAY, CATEGORIES)?.tax_pence).toBe(0);
  });

  it('SCAN-1: a reply without tax comes back without it (read as 0), as in S6a', () => {
    const noTax = reply();
    delete noTax.tax_pence;
    const r = core().scanGuards(noTax, TODAY, CATEGORIES);
    expect(r).not.toBeNull();
    expect(r?.tax_pence ?? 0).toBe(0);
  });

  it('SCAN-3: the guarded CORD reply adds up once its tax is counted', () => {
    const r = core().scanGuards(reply(), TODAY, CATEGORIES);
    const items = (r?.items ?? []).map((l) => ({ label: l.label, pence: p(l.pence) }));
    expect(core().checkTotal(items, p(r?.discount_pence ?? 0), p(r?.service_pence ?? 0), r?.total_pence == null ? null : p(r.total_pence), p(r?.tax_pence ?? 0)).adds).toBe(true);
  });

  it('SCAN-5: the scan schema accepts tax_pence and still has no room for anything else', () => {
    expect(checkReply(reply())).not.toBeNull();
    const noTax = reply();
    delete noTax.tax_pence;
    expect(checkReply(noTax)).not.toBeNull();
    expect(checkReply({ ...reply(), tax_pence: 12.5 })).toBeNull();
    expect(checkReply({ ...reply(), tax_pence: '255.85' })).toBeNull();
    expect(checkReply({ ...reply(), vat_pence: 25585 })).toBeNull();
  });
});
