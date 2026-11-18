/**
 * S6a core (docs/slices/S6.md "Decisions made here → Itemise", "Interfaces → Core"; SPEC SCAN-1, SCAN-2, SCAN-3,
 * TXT-5; docs/AI.md §3.1 guards): what a scanned receipt may fill, and the itemised amount, exact to the penny.
 * Written before the build (ENGINEERING §5, tests first by someone else).
 *
 * Interface these tests expect, in src/core/itemise.ts (pure; no I/O, no clock; every figure integer pence):
 *
 *   interface ReceiptLine { label: string; pence: Pence }
 *
 *   itemise(items: readonly ReceiptLine[], ticked: readonly boolean[], discount: Pence, service: Pence)
 *     → { amount: Pence; perLine: Pence[] }
 *     The shared amount when only the ticked lines are shared (SCAN-2). The discount and the service charge belong
 *     to the whole bill, so each is shared out over ALL the lines in proportion to their pence, by largest
 *     remainder (floor each part; the pennies left go to the largest fractions; a tie goes to the earlier line).
 *     A line's net = its pence − its part of the discount + its part of the service. perLine[i] is line i's net
 *     when ticked and 0 when not (same length and order as `items`); amount = Σ perLine. A discount larger than
 *     the lines is capped at their sum, so nothing is ever negative. No items: { amount: 0, perLine: [] }.
 *     Worked: lines 100, 200, 300 with 100 off → parts 17, 33, 50 (16.67 → 17 takes the spare penny) → nets 83,
 *     167, 250; ticking the first and last shares £3.33.
 *
 *   checkTotal(items: readonly ReceiptLine[], discount: Pence, service: Pence, total: Pence | null)
 *     → { adds: boolean; lines: Pence }
 *     SCAN-3: lines = Σ items − discount + service; adds = (lines === total). No total (null) never adds up.
 *
 *   scanGuards(raw: ScanReply, today: IsoDate, categories: readonly string[]): ScanReply | null
 *     docs/AI.md §3.1 guards, after validation, on the phone. ScanReply is AI.md's schema, keys exactly:
 *       { merchant: string | null, date: 'YYYY-MM-DD' | null, currency: string | null, total_pence: int | null,
 *         items: { label: string, pence: int }[], discount_pence: int, service_pence: int,
 *         category: string | null, confidence: 'high' | 'medium' | 'low' }
 *     Amounts are always hundredths of the receipt's own currency unit (¥1,200 → 120000; €12.50 → 1250).
 *     Returns the same shape, cleaned:
 *       - confidence 'low' → null (fills nothing but the photo);
 *       - total_pence not a non-negative whole number → null; discount/service not one → 0;
 *       - an item whose pence isn't a non-negative whole number is not kept (dropping that line or the whole
 *         list are both fine; a kept line is always valid); labels are kept exactly as printed (TXT-5);
 *       - merchant trimmed, blank → null;
 *       - date: not a real date, after today, or more than two years before today → null (exactly two years
 *         before today is kept);
 *       - category not one of `categories` → null.
 *
 * Until src/core/itemise.ts exists it is loaded by a computed path (so this file type-checks and each test fails on
 * the missing module); once it exists this can become `import * as itemiseCore from './itemise'`.
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import type { IsoDate } from './dates';
import { pence, type Pence } from './money';

interface ReceiptLine { label: string; pence: Pence }
interface ScanReply {
  merchant: string | null; date: string | null; currency: string | null; total_pence: number | null;
  items: { label: string; pence: number }[]; discount_pence: number; service_pence: number;
  category: string | null; confidence: 'high' | 'medium' | 'low';
}
interface ItemiseCore {
  itemise(items: readonly ReceiptLine[], ticked: readonly boolean[], discount: Pence, service: Pence): { amount: Pence; perLine: Pence[] };
  checkTotal(items: readonly ReceiptLine[], discount: Pence, service: Pence, total: Pence | null): { adds: boolean; lines: Pence };
  scanGuards(raw: ScanReply, today: IsoDate, categories: readonly string[]): ScanReply | null;
}

const NAMES = ['itemise', 'checkTotal', 'scanGuards'] as const;
const ITEMISE = './itemise';
const loaded = (await import(/* @vite-ignore */ ITEMISE).catch(() => null)) as Partial<ItemiseCore> | null;
function core(): ItemiseCore {
  const missing = NAMES.filter((n) => typeof loaded?.[n] !== 'function');
  if (!loaded || missing.length > 0) throw new Error(`src/core/itemise.ts does not export ${missing.join(', ')} yet (S6a)`);
  return loaded as ItemiseCore;
}

const lines = (...ps: number[]): ReceiptLine[] => ps.map((p, i) => ({ label: `Line ${String(i + 1)}`, pence: pence(p) }));
const p = pence;
const all = (n: number) => Array.from({ length: n }, () => true);
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const isWhole = (n: number) => Number.isSafeInteger(n);

// The receipt the screens and the demo use (tests/ai/replies/scan-good.json): a Tesco Express shop with £1.00 off.
const TESCO = [
  { label: 'Milk', pence: p(120) }, { label: 'Sourdough', pence: p(250) }, { label: 'Bananas', pence: p(95) },
  { label: 'Washing-up liquid', pence: p(135) }, { label: 'Red wine', pence: p(899) },
];

// ─────────────────────────────── SCAN-2: itemise, by hand ───────────────────────────────

describe('itemise (SCAN-2): worked by hand', () => {
  it('SCAN-2: all lines ticked, no discount or service: the amount is the sum of the lines', () => {
    expect(core().itemise(lines(120, 250, 95), all(3), p(0), p(0))).toEqual({ amount: 465, perLine: [120, 250, 95] });
  });

  it('SCAN-2: an unticked line is one person’s own: it adds nothing and its perLine is 0', () => {
    expect(core().itemise(lines(120, 250, 95), [true, false, true], p(0), p(0))).toEqual({ amount: 215, perLine: [120, 0, 95] });
  });

  it('SCAN-2: nothing ticked shares nothing', () => {
    expect(core().itemise(lines(120, 250, 95), [false, false, false], p(50), p(0))).toEqual({ amount: 0, perLine: [0, 0, 0] });
  });

  it('SCAN-2: no lines at all: £0.00 and no parts', () => {
    expect(core().itemise([], [], p(0), p(0))).toEqual({ amount: 0, perLine: [] });
  });

  it('SCAN-2: a discount is shared out over all the lines in proportion (100 off 100/200/300 → 17/33/50), largest remainder', () => {
    // 16.67, 33.33, 50 → floors 16, 33, 50 (99); the spare penny goes to the largest fraction (the first line).
    expect(core().itemise(lines(100, 200, 300), [true, false, true], p(100), p(0))).toEqual({ amount: 333, perLine: [83, 0, 250] });
    expect(core().itemise(lines(100, 200, 300), [false, true, false], p(100), p(0))).toEqual({ amount: 167, perLine: [0, 167, 0] });
  });

  it('SCAN-2: a service charge is shared out the same way (£2.50 over £10/£20 → 83p/167p)', () => {
    expect(core().itemise(lines(1000, 2000), [true, false], p(0), p(250))).toEqual({ amount: 1083, perLine: [1083, 0] });
    expect(core().itemise(lines(1000, 2000), [false, true], p(0), p(250))).toEqual({ amount: 2167, perLine: [0, 2167] });
  });

  it('SCAN-2: a tie for the spare penny goes to the earlier line (100 off three £1.00 lines → 34, 33, 33)', () => {
    expect(core().itemise(lines(100, 100, 100), [true, false, false], p(100), p(0)).amount).toBe(66);
    expect(core().itemise(lines(100, 100, 100), [false, false, true], p(100), p(0)).amount).toBe(67);
  });

  it('SCAN-2: the Tesco shop with £1.00 off: all ticked £13.99; the wine unticked £5.60', () => {
    // Discount parts over £14.99: 8, 17, 6, 9, 60 (Red wine and Sourdough take the two spare pennies).
    expect(core().itemise(TESCO, all(5), p(100), p(0))).toEqual({ amount: 1399, perLine: [112, 233, 89, 126, 839] });
    expect(core().itemise(TESCO, [true, true, true, true, false], p(100), p(0))).toEqual({ amount: 560, perLine: [112, 233, 89, 126, 0] });
  });

  it('SCAN-2: Milk, Bread and someone’s own wine with 50p off: shared £2.54', () => {
    expect(core().itemise(lines(120, 145, 899), [true, true, false], p(50), p(0))).toEqual({ amount: 254, perLine: [115, 139, 0] });
  });

  it('SCAN-2: a restaurant bill with £3.00 off and £4.50 service; one drink was one person’s', () => {
    // Discount parts 133, 117, 50; service parts 200, 175, 75.
    expect(core().itemise(lines(1600, 1400, 600), [true, true, false], p(300), p(450))).toEqual({ amount: 3125, perLine: [1667, 1458, 0] });
    expect(core().itemise(lines(1600, 1400, 600), [true, true, false], p(0), p(450))).toEqual({ amount: 3375, perLine: [1800, 1575, 0] });
  });

  it('SCAN-2: a discount bigger than the lines is capped: never below zero', () => {
    const r = core().itemise(lines(100, 200), all(2), p(5000), p(0));
    expect(r.amount).toBe(0);
    expect(r.perLine).toEqual([0, 0]);
  });
});

// ─────────────────────────────── SCAN-2: itemise, properties ───────────────────────────────

const lineArb = fc.array(fc.integer({ min: 0, max: 100_000 }), { minLength: 1, maxLength: 12 });
const caseArb = lineArb.chain((ps) => fc.record({
  ps: fc.constant(ps),
  ticked: fc.array(fc.boolean(), { minLength: ps.length, maxLength: ps.length }),
  discount: fc.integer({ min: 0, max: sum(ps) }),
  service: fc.integer({ min: 0, max: 50_000 }),
}));

describe('itemise (SCAN-2): properties', () => {
  it('SCAN-2: the parts always sum to the amount, are whole pence, never negative, and unticked lines are 0', () => {
    fc.assert(fc.property(caseArb, ({ ps, ticked, discount, service }) => {
      const r = core().itemise(lines(...ps), ticked, p(discount), p(service));
      expect(r.perLine).toHaveLength(ps.length);
      expect(sum(r.perLine)).toBe(r.amount);
      expect(isWhole(r.amount) && r.amount >= 0).toBe(true);
      r.perLine.forEach((x, i) => {
        expect(isWhole(x) && x >= 0).toBe(true);
        if (!ticked[i]) expect(x).toBe(0);
      });
    }), { numRuns: 400 });
  });

  it('SCAN-2: all ticked with no discount or service is exactly the sum of the lines', () => {
    fc.assert(fc.property(lineArb, (ps) => {
      expect(core().itemise(lines(...ps), all(ps.length), p(0), p(0))).toEqual({ amount: sum(ps), perLine: ps });
    }));
  });

  it('SCAN-2: all ticked is exactly lines − discount + service (no penny lost or made)', () => {
    fc.assert(fc.property(caseArb, ({ ps, discount, service }) => {
      expect(core().itemise(lines(...ps), all(ps.length), p(discount), p(service)).amount).toBe(sum(ps) - discount + service);
    }), { numRuns: 400 });
  });

  it('SCAN-2: the shared part and the rest always add back to the whole bill (exact by largest remainder)', () => {
    fc.assert(fc.property(caseArb, ({ ps, ticked, discount, service }) => {
      const shared = core().itemise(lines(...ps), ticked, p(discount), p(service)).amount;
      const rest = core().itemise(lines(...ps), ticked.map((t) => !t), p(discount), p(service)).amount;
      expect(shared + rest).toBe(sum(ps) - discount + service);
    }), { numRuns: 400 });
  });

  it('SCAN-2: each line’s part of a discount is within a penny of its exact proportion', () => {
    fc.assert(fc.property(caseArb, ({ ps, discount }) => {
      const total = sum(ps);
      const r = core().itemise(lines(...ps), all(ps.length), p(discount), p(0));
      r.perLine.forEach((net, i) => {
        const part = (ps[i] ?? 0) - net;                       // what line i gave up
        expect(Math.abs(part * total - discount * (ps[i] ?? 0))).toBeLessThan(Math.max(total, 1));
      });
    }), { numRuns: 400 });
  });

  it('SCAN-2: ticking one more line never lowers the amount', () => {
    fc.assert(fc.property(caseArb, fc.nat(), ({ ps, ticked, discount, service }, k) => {
      const i = k % ps.length;
      const less = ticked.map((t, j) => (j === i ? false : t));
      const more = ticked.map((t, j) => (j === i ? true : t));
      const a = core().itemise(lines(...ps), less, p(discount), p(service)).amount;
      const b = core().itemise(lines(...ps), more, p(discount), p(service)).amount;
      expect(b).toBeGreaterThanOrEqual(a);
    }), { numRuns: 300 });
  });

  it('SCAN-2: never negative even with a discount larger than the bill', () => {
    fc.assert(fc.property(lineArb, fc.array(fc.boolean(), { minLength: 12, maxLength: 12 }), fc.integer({ min: 0, max: 5_000_000 }), fc.integer({ min: 0, max: 50_000 }), (ps, t, discount, service) => {
      const r = core().itemise(lines(...ps), t.slice(0, ps.length), p(discount), p(service));
      expect(r.amount).toBeGreaterThanOrEqual(0);
      for (const x of r.perLine) expect(isWhole(x) && x >= 0).toBe(true);
      expect(sum(r.perLine)).toBe(r.amount);
    }), { numRuns: 300 });
  });
});

// ─────────────────────────────── SCAN-3: do the lines add up? ───────────────────────────────

describe('checkTotal (SCAN-3)', () => {
  it('SCAN-3: the Tesco lines (£14.99) less £1.00 make the printed £13.99: they add up', () => {
    expect(core().checkTotal(TESCO, p(100), p(0), p(1399))).toEqual({ adds: true, lines: 1399 });
  });

  it('SCAN-3: lines of £41.20 against a total of £42.50 do not add up: both figures are given', () => {
    expect(core().checkTotal(lines(1450, 1395, 1275), p(0), p(0), p(4250))).toEqual({ adds: false, lines: 4120 });
  });

  it('SCAN-3: the service charge counts towards the lines', () => {
    expect(core().checkTotal(lines(1600, 1400, 600), p(300), p(450), p(3750))).toEqual({ adds: true, lines: 3750 });
    expect(core().checkTotal(lines(1600, 1400, 600), p(300), p(0), p(3750))).toEqual({ adds: false, lines: 3300 });
  });

  it('SCAN-3: no printed total never adds up (the person sets the amount)', () => {
    expect(core().checkTotal(lines(100, 200), p(0), p(0), null).adds).toBe(false);
  });

  it('SCAN-3: a penny out is out', () => {
    expect(core().checkTotal(lines(1000), p(0), p(0), p(1001)).adds).toBe(false);
  });

  it('SCAN-3: whenever the lines add up, ticking all of them shares exactly the total', () => {
    fc.assert(fc.property(caseArb, ({ ps, discount, service }) => {
      const total = p(sum(ps) - discount + service);
      const check = core().checkTotal(lines(...ps), p(discount), p(service), total);
      expect(check).toEqual({ adds: true, lines: total });
      expect(core().itemise(lines(...ps), all(ps.length), p(discount), p(service)).amount).toBe(total);
    }));
  });
});

// ─────────────────────────────── SCAN-1, TXT-5: what a reply may fill ───────────────────────────────

const TODAY = '2026-11-17';
const CATEGORIES = ['Groceries', 'Eating out', 'Rent & bills', 'Utilities', 'Transport', 'Subscriptions', 'Household', 'Going out', 'Travel', 'Gifts', 'Health', 'Other'];
const reply = (over: Partial<ScanReply> = {}): ScanReply => ({
  merchant: 'Tesco Express', date: '2026-11-12', currency: 'GBP', total_pence: 1399,
  items: TESCO.map((l) => ({ label: l.label, pence: l.pence })), discount_pence: 100, service_pence: 0,
  category: 'Groceries', confidence: 'high', ...over,
});

describe('scanGuards (SCAN-1, TXT-5; AI.md §3.1)', () => {
  it('SCAN-1: a good, confident reply comes through unchanged, with exactly the schema’s keys', () => {
    const r = core().scanGuards(reply(), TODAY, CATEGORIES);
    expect(r).toEqual(reply());
    expect(Object.keys(r ?? {}).sort()).toEqual(['category', 'confidence', 'currency', 'date', 'discount_pence', 'items', 'merchant', 'service_pence', 'total_pence']);
  });

  it('SCAN-1: medium confidence still fills', () => {
    expect(core().scanGuards(reply({ confidence: 'medium' }), TODAY, CATEGORIES)?.total_pence).toBe(1399);
  });

  it('SCAN-1 SCAN-5: low confidence fills nothing', () => {
    expect(core().scanGuards(reply({ confidence: 'low' }), TODAY, CATEGORIES)).toBeNull();
  });

  it('SCAN-1: a date after today is ignored', () => {
    expect(core().scanGuards(reply({ date: '2026-11-18' }), TODAY, CATEGORIES)?.date).toBeNull();
    expect(core().scanGuards(reply({ date: '2027-01-02' }), TODAY, CATEGORIES)?.date).toBeNull();
  });

  it('SCAN-1: today is fine; exactly two years ago is fine; a day more is ignored', () => {
    expect(core().scanGuards(reply({ date: TODAY }), TODAY, CATEGORIES)?.date).toBe(TODAY);
    expect(core().scanGuards(reply({ date: '2024-11-17' }), TODAY, CATEGORIES)?.date).toBe('2024-11-17');
    expect(core().scanGuards(reply({ date: '2024-11-16' }), TODAY, CATEGORIES)?.date).toBeNull();
    expect(core().scanGuards(reply({ date: '1999-03-04' }), TODAY, CATEGORIES)?.date).toBeNull();
  });

  it('SCAN-1: a date that isn’t a real day is ignored', () => {
    expect(core().scanGuards(reply({ date: '2026-02-30' }), TODAY, CATEGORIES)?.date).toBeNull();
    expect(core().scanGuards(reply({ date: '12/11/2026' }), TODAY, CATEGORIES)?.date).toBeNull();
  });

  it('SCAN-1: a negative or fractional total is ignored; the rest still fills', () => {
    const neg = core().scanGuards(reply({ total_pence: -1399 }), TODAY, CATEGORIES);
    expect(neg?.total_pence).toBeNull();
    expect(neg?.merchant).toBe('Tesco Express');
    expect(core().scanGuards(reply({ total_pence: 13.99 }), TODAY, CATEGORIES)?.total_pence).toBeNull();
  });

  it('SCAN-1: a negative or fractional discount or service becomes 0', () => {
    const r = core().scanGuards(reply({ discount_pence: -100, service_pence: 2.5 }), TODAY, CATEGORIES);
    expect(r?.discount_pence).toBe(0);
    expect(r?.service_pence).toBe(0);
  });

  it('SCAN-2: a line with a negative or fractional amount is never kept; every kept line is whole, non-negative pence', () => {
    const r = core().scanGuards(reply({ items: [{ label: 'Milk', pence: 120 }, { label: 'Refund?', pence: -50 }, { label: 'Half', pence: 12.5 }] }), TODAY, CATEGORIES);
    expect(r).not.toBeNull();
    for (const l of r?.items ?? []) expect(isWhole(l.pence) && l.pence >= 0).toBe(true);
    expect(r?.items.map((l) => l.label)).not.toContain('Refund?');
    expect(r?.items.map((l) => l.label)).not.toContain('Half');
  });

  it('SCAN-1: a category that isn’t one of the household’s is dropped; one that is stays', () => {
    expect(core().scanGuards(reply({ category: 'Pets' }), TODAY, CATEGORIES)?.category).toBeNull();
    expect(core().scanGuards(reply({ category: 'Health' }), TODAY, CATEGORIES)?.category).toBe('Health');
    expect(core().scanGuards(reply({ category: 'Groceries' }), TODAY, ['Eating out'])?.category).toBeNull();
  });

  it('SCAN-1: the merchant is trimmed; blank is nothing', () => {
    expect(core().scanGuards(reply({ merchant: '  Tesco Express  ' }), TODAY, CATEGORIES)?.merchant).toBe('Tesco Express');
    expect(core().scanGuards(reply({ merchant: '   ' }), TODAY, CATEGORIES)?.merchant).toBeNull();
  });

  it('TXT-5: a Japanese receipt keeps its place and item names as printed, and its currency', () => {
    const jp = reply({
      merchant: 'ローソン 京都四条店', currency: 'JPY', total_pence: 64800, discount_pence: 0, category: 'Groceries',
      items: [{ label: 'おにぎり 鮭', pence: 18000 }, { label: 'お茶 500ml', pence: 16000 }, { label: 'からあげクン', pence: 30800 }],
    });
    const r = core().scanGuards(jp, TODAY, CATEGORIES);
    expect(r?.merchant).toBe('ローソン 京都四条店');
    expect(r?.items.map((l) => l.label)).toEqual(['おにぎり 鮭', 'お茶 500ml', 'からあげクン']);
    expect(r?.currency).toBe('JPY');
    expect(r?.total_pence).toBe(64800);
  });

  it('SCAN-1: never throws, and never invents a field, on any reply shape the schema allows', () => {
    const arb = fc.record({
      merchant: fc.option(fc.string({ maxLength: 40 })), date: fc.option(fc.string({ maxLength: 12 })),
      currency: fc.option(fc.constantFrom('GBP', 'JPY', 'EUR', 'usd', '')),
      total_pence: fc.option(fc.oneof(fc.integer({ min: -100_000, max: 1_000_000 }), fc.double({ noNaN: true, min: -1e6, max: 1e6 }))),
      items: fc.array(fc.record({ label: fc.string({ maxLength: 20 }), pence: fc.oneof(fc.integer({ min: -1000, max: 100_000 }), fc.double({ noNaN: true, min: -1e4, max: 1e5 })) }), { maxLength: 8 }),
      discount_pence: fc.oneof(fc.integer({ min: -1000, max: 10_000 }), fc.double({ noNaN: true, min: -1e3, max: 1e4 })),
      service_pence: fc.oneof(fc.integer({ min: -1000, max: 10_000 }), fc.double({ noNaN: true, min: -1e3, max: 1e4 })),
      category: fc.option(fc.constantFrom(...CATEGORIES, 'Pets', '')), confidence: fc.constantFrom('high' as const, 'medium' as const, 'low' as const),
    });
    fc.assert(fc.property(arb, (raw) => {
      const r = core().scanGuards(raw, TODAY, CATEGORIES);
      if (raw.confidence === 'low') { expect(r).toBeNull(); return; }
      expect(r).not.toBeNull();
      if (!r) return;
      expect(Object.keys(r).sort()).toEqual(['category', 'confidence', 'currency', 'date', 'discount_pence', 'items', 'merchant', 'service_pence', 'total_pence']);
      if (r.total_pence !== null) expect(isWhole(r.total_pence) && r.total_pence >= 0).toBe(true);
      expect(isWhole(r.discount_pence) && r.discount_pence >= 0).toBe(true);
      expect(isWhole(r.service_pence) && r.service_pence >= 0).toBe(true);
      for (const l of r.items) expect(isWhole(l.pence) && l.pence >= 0).toBe(true);
      if (r.date !== null) expect(r.date <= TODAY && r.date >= '2024-11-17').toBe(true);
      if (r.category !== null) expect(CATEGORIES).toContain(r.category);
    }), { numRuns: 300 });
  });
});
