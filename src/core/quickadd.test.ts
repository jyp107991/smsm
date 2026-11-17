import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { parseAmount } from './money';
import { isIsoDate } from './dates';
import type { SplitParams } from './split';
import { parseQuickAdd, type QuickAddContext, type QuickAddReading } from './quickadd';
import vectorsJson from '../../tests/vectors/quickadd.json';

interface RawExpected {
  amount: number;
  description: string;
  categoryId: string | null;
  payer: string;
  split: SplitParams | null;
  date: string;
  tags: string[];
  confident?: boolean;
}
interface QuickAddVectors {
  context: QuickAddContext;
  vectors: { text: string; expected: RawExpected | null; context?: Partial<QuickAddContext>; note?: string }[];
}
const V = vectorsJson as unknown as QuickAddVectors;
const CTX: QuickAddContext = V.context;
const ME = CTX.me;
const PARTNER = CTX.partner;
const CATEGORY_IDS = CTX.categories.map((c) => c.id);

function shape(r: QuickAddReading): Omit<RawExpected, 'confident'> {
  return { amount: r.amount, description: r.description, categoryId: r.categoryId, payer: r.payer, split: r.split, date: r.date, tags: r.tags };
}

describe('ADD-1 ADD-3 TXT-4 DAT-3 golden phrases (tests/vectors/quickadd.json)', () => {
  it('has at least 80 phrases', () => {
    expect(V.vectors.length).toBeGreaterThanOrEqual(80);
  });

  it.each(V.vectors.map((v) => [v.text, v] as const))('ADD-1 reads %j', (_text, v) => {
    const ctx: QuickAddContext = { ...CTX, ...v.context };
    const reading = parseQuickAdd(v.text, ctx);
    if (v.expected === null) {
      expect(reading).toBeNull();
      return;
    }
    expect(reading).not.toBeNull();
    if (!reading) return;
    const { confident, ...want } = v.expected;
    expect(shape(reading)).toEqual(want);
    expect(typeof reading.confident).toBe('boolean');
    if (confident !== undefined) expect(reading.confident).toBe(confident);
  });
});

describe('parseQuickAdd', () => {
  it('ADD-1 the spec example: "42.50 tesco" is £42.50, Tesco', () => {
    const r = parseQuickAdd('42.50 tesco', CTX);
    expect(r?.amount).toBe(4250);
    expect(r?.description).toBe('tesco');
  });

  it('ADD-3 fills what was not typed: payer me, date today, no split (the caller applies the usual one), no category', () => {
    const r = parseQuickAdd('9.99 something', CTX);
    expect(r).toMatchObject({ payer: ME, date: CTX.today, split: null, categoryId: null, tags: [] });
    const elsewhere = parseQuickAdd('9.99 something', { ...CTX, today: '2027-01-01', me: PARTNER, partner: ME });
    expect(elsewhere).toMatchObject({ payer: PARTNER, date: '2027-01-01', split: null });
  });

  it('ADD-3 "me" means whoever is typing', () => {
    expect(parseQuickAdd('5 me coffee', CTX)?.payer).toBe(ME);
    expect(parseQuickAdd('5 me coffee', { ...CTX, me: PARTNER, partner: ME })?.payer).toBe(PARTNER);
    expect(parseQuickAdd('5 for them coffee', { ...CTX, me: PARTNER, partner: ME })).toMatchObject({ payer: PARTNER, split: { mode: 'for_other' } });
  });

  it('ADD-1 60/40 is payer/other, whoever pays', () => {
    expect(parseQuickAdd('10 x 60/40', CTX)?.split).toEqual({ mode: 'ratio', ratio: { [ME]: 60, [PARTNER]: 40 } });
    expect(parseQuickAdd('10 x 60/40 sam', CTX)?.split).toEqual({ mode: 'ratio', ratio: { [PARTNER]: 60, [ME]: 40 } });
  });

  it('ADD-1 a category prefix must match exactly one category', () => {
    expect(parseQuickAdd('10 tra', CTX)?.categoryId).toBeNull();
    expect(parseQuickAdd('10 trav', CTX)?.categoryId).toBe('c-travel');
    expect(parseQuickAdd('10 tran', CTX)?.categoryId).toBe('c-transport');
    const custom = { ...CTX, categories: [...CTX.categories, { id: 'c-groceries-2', name: 'Groceries abroad' }] };
    expect(parseQuickAdd('10 groc', custom)?.categoryId).toBeNull();
  });

  // ── properties ──
  const hangulOrKanaWord = fc.string({
    unit: fc.constantFrom('이', '마', '트', '장', '보', '기', '김', '밥', 'ラ', 'ー', 'メ', 'ン', '京', '都', '旅', '館', '昨', '日'),
    minLength: 1,
    maxLength: 5,
  });
  const amountText = fc.integer({ min: 1, max: 100_000_000 }).map((p) => `${Math.floor(p / 100)}.${String(p % 100).padStart(2, '0')}`);

  it('TXT-4 every word in another language passes through as the description, in order', () => {
    fc.assert(
      fc.property(fc.array(hangulOrKanaWord, { minLength: 1, maxLength: 6 }), amountText, fc.nat(), (words, amount, at) => {
        const i = at % (words.length + 1);
        const text = [...words.slice(0, i), amount, ...words.slice(i)].join(' ');
        const r = parseQuickAdd(text, CTX);
        expect(r?.amount).toBe(parseAmount(amount));
        expect(r?.description).toBe(words.join(' '));
      }),
    );
  });

  it('TXT-4 full-width digits read the same as ordinary ones', () => {
    const toFullWidth = (s: string): string => s.replace(/[0-9.+]/g, (c) => String.fromCodePoint((c.codePointAt(0) ?? 0) + 0xfee0));
    fc.assert(
      fc.property(amountText, (amount) => {
        expect(parseQuickAdd(`${toFullWidth(amount)} 이마트`, CTX)?.amount).toBe(parseQuickAdd(`${amount} 이마트`, CTX)?.amount);
      }),
    );
  });

  it('TXT-4 command words are case-insensitive', () => {
    const words = ['yesterday', 'treat', 'sam', 'groc', 'mon', 'today', 'for', 'them', 'paid', 'cat', 'dog', 'me'];
    const phrases = ['42.50 tesco yesterday treat', '42.50 tesco sam paid groc', '42.50 mon for them', '42.50 today cat paid', '9 dog paid me'];
    fc.assert(
      fc.property(fc.constantFrom(...phrases), fc.array(fc.boolean(), { minLength: 40, maxLength: 40 }), (phrase, flips) => {
        let n = 0;
        const shouted = phrase
          .split(' ')
          .map((w) => (words.includes(w) ? Array.from(w, (c) => ((flips[n++ % flips.length] ?? false) ? c.toUpperCase() : c)).join('') : w))
          .join(' ');
        expect(parseQuickAdd(shouted, CTX)).toEqual(parseQuickAdd(phrase, CTX));
      }),
    );
  });

  it('ADD-1 the first token that reads as an amount wins; later ones stay in the description', () => {
    fc.assert(
      fc.property(fc.array(hangulOrKanaWord, { maxLength: 3 }), amountText, amountText, (words, first, second) => {
        const r = parseQuickAdd([...words, first, second].join(' '), CTX);
        expect(r?.amount).toBe(parseAmount(first));
        expect(r?.description).toBe([...words, second].join(' '));
      }),
    );
  });

  const grammarToken = fc.oneof(
    amountText,
    fc.constantFrom('£4.20', '12+8.50', '1,200', '０', '0', '-5', '1.234', '1000001'),
    fc.constantFrom('me', 'Jae', 'Sam', 'cat', 'dog', 'paid', 'for', 'them', 'treat', '60/40', '70/30', '50/50', '30/70', '101/1'),
    fc.constantFrom('today', 'yesterday', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun', 'monday', 'Sunday', '12/11', '31/12', '29/2', '1/1', '31/4', '00/00'),
    fc.constantFrom('groc', 'gr', 'tra', 'trav', 'eat', 'Groceries', 'other', 'sub'),
    fc.constantFrom('#weekly', '#', '##', '#여행', 'tesco', '이마트', 'ラーメン', '☕', ''),
    fc.string({ unit: 'grapheme', maxLength: 6 }),
  );

  it('ADD-1 any reading it returns is well formed', () => {
    fc.assert(
      fc.property(fc.array(grammarToken, { maxLength: 10 }), (tokens) => {
        const r = parseQuickAdd(tokens.join(' '), CTX);
        if (r === null) return;
        expect(Number.isSafeInteger(r.amount)).toBe(true);
        expect(r.amount).toBeGreaterThan(0);
        expect(r.amount).toBeLessThanOrEqual(100_000_000);
        expect(isIsoDate(r.date)).toBe(true);
        expect(r.date <= CTX.today).toBe(true); // no d/m/yy tokens here, so nothing can be in the future
        expect([ME, PARTNER]).toContain(r.payer);
        if (r.categoryId !== null) expect(CATEGORY_IDS).toContain(r.categoryId);
        for (const t of r.tags) {
          expect(typeof t).toBe('string');
          expect(t.length).toBeGreaterThan(0);
        }
        if (r.split?.mode === 'ratio') {
          expect(Object.keys(r.split.ratio).sort()).toEqual([ME, PARTNER].sort());
          expect(Object.values(r.split.ratio).reduce((a, b) => a + b, 0)).toBe(100);
        }
        expect(r.description).toBe(r.description.trim());
        expect(typeof r.confident).toBe('boolean');
      }),
    );
  });

  it('ADD-1 TXT-4 never throws, whatever is typed', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ unit: 'binary' }), fc.string({ unit: 'grapheme' }), fc.array(grammarToken).map((t) => t.join(' '))), (text) => {
        expect(() => parseQuickAdd(text, CTX)).not.toThrow();
      }),
      { numRuns: 2000 },
    );
  });

  it('ADD-1 null when there is no amount', () => {
    fc.assert(
      fc.property(fc.array(hangulOrKanaWord, { maxLength: 5 }), (words) => {
        expect(parseQuickAdd(words.join(' '), CTX)).toBeNull();
      }),
    );
  });
});
