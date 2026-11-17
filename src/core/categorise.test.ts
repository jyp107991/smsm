import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { SplitParams } from './split';
import { normaliseKey } from './text';
import { suggest, learn, type CategoryRef, type Memory, type MemoryMap } from './categorise';

// The 12 default categories (supabase/migrations/20261116000000_baseline.sql, create_household()).
const CATEGORIES: readonly CategoryRef[] = [
  { id: 'c-groceries', name: 'Groceries' },
  { id: 'c-eating-out', name: 'Eating out' },
  { id: 'c-rent-bills', name: 'Rent & bills' },
  { id: 'c-utilities', name: 'Utilities' },
  { id: 'c-transport', name: 'Transport' },
  { id: 'c-subscriptions', name: 'Subscriptions' },
  { id: 'c-household', name: 'Household' },
  { id: 'c-going-out', name: 'Going out' },
  { id: 'c-travel', name: 'Travel' },
  { id: 'c-gifts', name: 'Gifts' },
  { id: 'c-health', name: 'Health' },
  { id: 'c-other', name: 'Other' },
];
const SEED: Readonly<Record<string, string>> = {
  tesco: 'Groceries',
  sainsburys: 'Groceries',
  pret: 'Eating out',
  tfl: 'Transport',
  netflix: 'Subscriptions',
  boots: 'Health',
  'british gas': 'Utilities',
  [normaliseKey('이마트')]: 'Groceries',
};
const JAE = 'u-jae';
const SAM = 'u-sam';
const R6040: SplitParams = { mode: 'ratio', ratio: { [JAE]: 60, [SAM]: 40 } };
const EMART = '이마트';
const EMART_NFD = EMART.normalize('NFD');

type History = { description: string; categoryId: string | null }[];
function ctx(over: { memory?: MemoryMap; history?: History; seed?: Readonly<Record<string, string>>; categories?: readonly CategoryRef[] } = {}) {
  return {
    memory: over.memory ?? new Map<string, Memory>(),
    history: over.history ?? [],
    seed: over.seed ?? SEED,
    categories: over.categories ?? CATEGORIES,
  };
}
const mem = (entries: [string, Memory][]): MemoryMap => new Map(entries.map(([k, v]) => [normaliseKey(k), v]));

describe('suggest', () => {
  it('CAT-2 step 1: what this household chose last time for that description, with its usual split', () => {
    const memory = mem([['tesco', { categoryId: 'c-household', split: R6040, source: 'user' }]]);
    expect(suggest('Tesco', ctx({ memory }))).toEqual({ categoryId: 'c-household', split: R6040, source: 'memory' });
  });

  it('CAT-2 TXT-3 step 1 ignores case, width and spacing', () => {
    const memory = mem([['tesco extra', { categoryId: 'c-household', split: null, source: 'user' }]]);
    for (const typed of ['Tesco Extra', 'TESCO  EXTRA', ' ｔｅｓｃｏ　ｅｘｔｒａ ']) {
      expect(suggest(typed, ctx({ memory }))).toEqual({ categoryId: 'c-household', split: null, source: 'memory' });
    }
  });

  it('CAT-2 step 1 beats history and the seed list', () => {
    const memory = mem([['tesco', { categoryId: 'c-gifts', split: null, source: 'user' }]]);
    const history: History = [{ description: 'Tesco', categoryId: 'c-household' }];
    expect(suggest('tesco', ctx({ memory, history }))).toEqual({ categoryId: 'c-gifts', split: null, source: 'memory' });
  });

  it('CAT-2 step 2: a history description that starts with the typed text', () => {
    const history: History = [{ description: 'Dishoom Kings Cross', categoryId: 'c-eating-out' }];
    expect(suggest('dishoom', ctx({ history }))).toEqual({ categoryId: 'c-eating-out', split: null, source: 'history' });
  });

  it('CAT-2 step 2: a history description contained in the typed text', () => {
    const history: History = [{ description: 'Dishoom', categoryId: 'c-eating-out' }];
    expect(suggest('Dishoom birthday dinner', ctx({ history }))).toEqual({ categoryId: 'c-eating-out', split: null, source: 'history' });
  });

  it('CAT-2 step 2: the longest matching history description wins', () => {
    const history: History = [
      { description: 'Ikea', categoryId: 'c-household' },
      { description: 'Ikea restaurant', categoryId: 'c-eating-out' },
    ];
    expect(suggest('ikea restaurant meatballs', ctx({ history })).categoryId).toBe('c-eating-out');
    const reversed = [...history].reverse();
    expect(suggest('ikea restaurant meatballs', ctx({ history: reversed })).categoryId).toBe('c-eating-out');
    expect(suggest('ikea sofa', ctx({ history })).categoryId).toBe('c-household');
  });

  it('CAT-2 TXT-3 step 2 matches across case, width and Hangul composition', () => {
    const history: History = [{ description: EMART_NFD, categoryId: 'c-household' }];
    expect(suggest(`${EMART} 강남점`, ctx({ history, seed: {} }))).toEqual({ categoryId: 'c-household', split: null, source: 'history' });
    const ascii: History = [{ description: 'ＢＵＳＡＢＡ', categoryId: 'c-eating-out' }];
    expect(suggest('busaba', ctx({ history: ascii })).source).toBe('history');
  });

  it('CAT-2 step 2 beats the seed list', () => {
    const history: History = [{ description: 'Boots', categoryId: 'c-household' }];
    expect(suggest('Boots', ctx({ history }))).toEqual({ categoryId: 'c-household', split: null, source: 'history' });
  });

  it('CAT-2 step 3: the built-in list, mapped to this household\'s category by name', () => {
    expect(suggest('Tesco', ctx())).toEqual({ categoryId: 'c-groceries', split: null, source: 'seed' });
    expect(suggest('NETFLIX', ctx())).toEqual({ categoryId: 'c-subscriptions', split: null, source: 'seed' });
    expect(suggest('British  Gas', ctx())).toEqual({ categoryId: 'c-utilities', split: null, source: 'seed' });
    expect(suggest('ＴＦＬ', ctx())).toEqual({ categoryId: 'c-transport', split: null, source: 'seed' });
    expect(suggest(EMART_NFD, ctx())).toEqual({ categoryId: 'c-groceries', split: null, source: 'seed' });
  });

  it('CAT-2 step 3 uses the household\'s own ids', () => {
    const other: CategoryRef[] = CATEGORIES.map((c) => ({ ...c, id: `other-${c.id}` }));
    expect(suggest('Tesco', ctx({ categories: other }))).toEqual({ categoryId: 'other-c-groceries', split: null, source: 'seed' });
  });

  it('CAT-2 step 3 skips a seed category this household no longer has (renamed)', () => {
    const renamed: CategoryRef[] = CATEGORIES.map((c) => (c.name === 'Groceries' ? { ...c, name: 'Food shop' } : c));
    expect(suggest('Tesco', ctx({ categories: renamed }))).toEqual({ categoryId: null, split: null, source: 'none' });
  });

  it('CAT-2 with no match: none, never "Other" (the caller decides)', () => {
    for (const typed of ['Wobbly Goose Ltd', '알 수 없는 가게', 'zzz']) {
      const s = suggest(typed, ctx({ history: [{ description: 'Dishoom', categoryId: 'c-eating-out' }] }));
      expect(s).toEqual({ categoryId: null, split: null, source: 'none' });
    }
    expect(suggest('Tesco', ctx({ seed: {} }))).toEqual({ categoryId: null, split: null, source: 'none' });
  });

  it('CAT-2 never throws and never answers "Other" unless it was taught or listed', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (typed) => {
        const s = suggest(typed, ctx({ history: [{ description: 'Dishoom', categoryId: 'c-eating-out' }] }));
        expect(s.categoryId).not.toBe('c-other');
        expect(['history', 'seed', 'none']).toContain(s.source);
      }),
    );
  });
});

describe('learn', () => {
  it('CAT-3 changing a category teaches the app: next time that description gets the choice', () => {
    const before = ctx();
    expect(suggest('Tesco', before).categoryId).toBe('c-groceries');
    const memory = learn(before.memory, 'Tesco', { categoryId: 'c-household', split: null });
    expect(suggest('Tesco', ctx({ memory }))).toEqual({ categoryId: 'c-household', split: null, source: 'memory' });
  });

  it('CAT-3 records a person\'s choice under the normalised description', () => {
    const memory = learn(new Map(), '  Tesco   EXTRA ', { categoryId: 'c-household', split: null });
    expect(memory.get('tesco extra')).toEqual({ categoryId: 'c-household', split: null, source: 'user' });
    expect(memory.size).toBe(1);
  });

  it('CAT-3 a person\'s choice replaces an AI guess', () => {
    const guessed = mem([['pret', { categoryId: 'c-going-out', split: null, source: 'ai' }]]);
    const memory = learn(guessed, 'Pret', { categoryId: 'c-eating-out', split: null });
    expect(memory.get('pret')).toEqual({ categoryId: 'c-eating-out', split: null, source: 'user' });
    expect(suggest('pret', ctx({ memory }))).toEqual({ categoryId: 'c-eating-out', split: null, source: 'memory' });
  });

  it('CAT-3 the latest choice wins', () => {
    const once = learn(new Map(), 'Tesco', { categoryId: 'c-household', split: null });
    const twice = learn(once, 'TESCO', { categoryId: 'c-gifts', split: null });
    expect(suggest('tesco', ctx({ memory: twice })).categoryId).toBe('c-gifts');
    expect(twice.size).toBe(1);
  });

  it('CAT-3 does not change the map it was given, or other descriptions', () => {
    const original = mem([['pret', { categoryId: 'c-eating-out', split: null, source: 'user' }]]);
    const next = learn(original, 'Tesco', { categoryId: 'c-household', split: R6040 });
    expect(original.size).toBe(1);
    expect(original.has('tesco')).toBe(false);
    expect(next.get('pret')).toEqual({ categoryId: 'c-eating-out', split: null, source: 'user' });
    expect(next.size).toBe(2);
  });

  it('CAT-4 the usual split for a description is learned the same way', () => {
    const treat: SplitParams = { mode: 'treat' };
    let memory: MemoryMap = learn(new Map(), 'Dishoom', { categoryId: 'c-eating-out', split: R6040 });
    expect(suggest('dishoom', ctx({ memory }))).toEqual({ categoryId: 'c-eating-out', split: R6040, source: 'memory' });
    memory = learn(memory, 'Dishoom', { categoryId: 'c-eating-out', split: treat });
    expect(suggest('DISHOOM', ctx({ memory })).split).toEqual(treat);
  });

  it('CAT-3 TXT-3 a category learned for 이마트 is applied however it is typed next time', () => {
    const memory = learn(new Map(), EMART_NFD, { categoryId: 'c-household', split: null });
    expect(suggest(EMART, ctx({ memory }))).toEqual({ categoryId: 'c-household', split: null, source: 'memory' });
    expect(suggest(`  ${EMART}  `, ctx({ memory })).source).toBe('memory');
  });

  it('CAT-3 CAT-4 TXT-3 for any description: what was taught comes back, whatever the case or spacing', () => {
    const splitArb: fc.Arbitrary<SplitParams | null> = fc.oneof(
      fc.constant(null),
      fc.integer({ min: 0, max: 100 }).map((p): SplitParams => ({ mode: 'ratio', ratio: { [JAE]: p, [SAM]: 100 - p } })),
      fc.constant<SplitParams>({ mode: 'treat' }),
      fc.constant<SplitParams>({ mode: 'for_other' }),
    );
    fc.assert(
      fc.property(
        fc.string({ unit: 'grapheme', minLength: 1 }),
        fc.constantFrom(...CATEGORIES.map((c) => c.id)),
        splitArb,
        (description, categoryId, split) => {
          fc.pre(normaliseKey(description) !== '');
          const memory = learn(new Map(), description, { categoryId, split });
          const retyped = `  ${description.toUpperCase() === description.toLowerCase() ? description : description.toLowerCase()}  `;
          fc.pre(normaliseKey(retyped) === normaliseKey(description));
          expect(suggest(retyped, ctx({ memory }))).toEqual({ categoryId, split, source: 'memory' });
        },
      ),
    );
  });
});
