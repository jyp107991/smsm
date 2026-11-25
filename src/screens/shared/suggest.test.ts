/** Quick add's reading with what wasn't typed filled from what the household taught (ADD-2, ADD-3, CAT-2…CAT-4, SPL-2). */
import { describe, expect, it } from 'vitest';
import type { Memory } from '../../core/categorise';
import type { CategoryRow, ExpenseRow } from '../../data';
import merchants from '../../../content/merchants.json';
import { descriptionSuggestions, readingWords, readQuickAdd, tidy } from './suggest';
import type { Person } from './words';

const J: Person = { id: 'j', name: 'Jae', animal: 'cat' };
const S: Person = { id: 's', name: 'Sam', animal: 'dog' };
const TODAY = '2026-11-14';
const cat = (name: string, i: number): CategoryRow => ({
  id: `c${String(i)}`, household_id: 'h', name, emoji: '', colour: 'stone', default_ratio: null, archived: false, sort: i, seed_key: null, updated_at: '',
});
const categories = ['Groceries', 'Eating out', 'Household', 'Subscriptions', 'Other'].map(cat);
const id = (name: string) => categories.find((c) => c.name === name)?.id ?? '';
const row = (description: string, category: string): ExpenseRow => ({ description, category_id: id(category), deleted_at: null, kind: 'expense' }) as ExpenseRow;

function read(text: string, opts: { memory?: Map<string, Memory>; entries?: ExpenseRow[]; partner?: Person | null; householdRatio?: unknown } = {}) {
  const ctx = {
    today: TODAY, me: J, partner: opts.partner === undefined ? S : opts.partner, categories, memory: opts.memory ?? new Map(),
    entries: opts.entries ?? [], householdRatio: opts.householdRatio ?? null,
  };
  const r = readQuickAdd(text, ctx);
  return { r, words: r ? readingWords(r, { categories, people: [J, S], today: TODAY }) : null };
}

describe('the quick-add reading', () => {
  it('ADD-2 ADD-3 CAT-2: amount, description as typed, the built-in guess, me as payer, 50/50', () => {
    expect(read('42.50 Tesco').words).toBe('£42.50 · Tesco · Groceries · Jae paid · 50/50');
  });

  // S2 polish wave 2: the reading shows the description as it will be saved (Q-U6: "pret" → "Pret") and names a
  // ratio split, payer first (Q-U5: "60/40" → "Jae 60 · Sam 40"). Were '… · pret · … · 60/40 …' and '… · sundries · … · 70/30'.
  it('ADD-2 Q-U5 Q-U6: a date other than today and tags are said; a typed split from the payer\'s side, with names', () => {
    expect(read('12+8.50 pret 60/40 yesterday #lunch').words).toBe('£20.50 · Pret · Eating out · Jae paid · Jae 60 · Sam 40 · Yesterday · #lunch');
    expect(read('9 sundries sam paid 70/30').words).toBe('£9.00 · Sundries · Other · Sam paid · Sam 70 · Jae 30');
  });

  it('CAT-3 CAT-2: what the household chose beats the built-in list; then a close match in history', () => {
    // S9a (TXT-3): memory is keyed by the normalised description, which now leaves apostrophes out (was "sainsbury's").
    const memory = new Map<string, Memory>([['sainsburys', { categoryId: id('Household'), split: null, source: 'user' }]]);
    expect(read("5 Sainsbury's", { memory }).r?.categoryId).toBe(id('Household'));
    expect(read('5 tesco express', { entries: [row('Tesco', 'Household')] }).r?.categoryId).toBe(id('Household'));
  });

  it('CAT-4 SPL-2: the usual split for a description, and a remembered split with no category still gets one', () => {
    const memory = new Map<string, Memory>([['netflix', { categoryId: null, split: { mode: 'ratio', ratio: { j: 70, s: 30 } }, source: 'user' }]]);
    expect(read('11 netflix', { memory }).words).toBe('£11.00 · Netflix · Subscriptions · Jae paid · Jae 70 · Sam 30'); // Q-U5 Q-U6 (was '… netflix … 70/30')
  });

  it('SPL-2: the household default when nothing else is known', () => {
    expect(read('10 thing', { householdRatio: { j: 40, s: 60 } }).words).toBe('£10.00 · Thing · Other · Jae paid · Jae 40 · Sam 60'); // Q-U5 Q-U6 (was '… thing … 40/60')
  });

  it('BAL-6: before the partner joins, the holder paid and the split is the default', () => {
    const { r } = read('10 tesco sam 70/30', { partner: null });
    expect(r?.payer).toBe('j');
    expect(r?.typedSplit).toBe(false);
  });

  it('ADD-1: no amount, no reading; a category word alone becomes the description', () => {
    expect(read('tesco').r).toBeNull();
    expect(read('12 groceries').r?.saveAs).toBe('Groceries');
  });
});

describe('description suggestions (ADD-4)', () => {
  it('ADD-4 TXT-3: earlier descriptions that start like this one, most used first, any case or width', () => {
    const entries = [row('Tesco', 'Groceries'), row('Tesco Express', 'Groceries'), row('Tesco Express', 'Groceries'), row('Pret', 'Eating out')];
    expect(descriptionSuggestions('ＴＥ', entries)).toEqual(['Tesco Express', 'Tesco']);
    expect(descriptionSuggestions('tesco', entries)).toEqual(['Tesco Express']);
    expect(descriptionSuggestions('t', entries)).toEqual([]);
  });
});

describe('the merchant list\'s spellings (S2 polish Q-U6)', () => {
  it('Q-U6 CAT-2: every name is still found whatever its case, and no two names are the same once lowercased', () => {
    const keys = Object.keys(merchants);
    expect(new Set(keys.map((k) => k.toLowerCase())).size).toBe(keys.length);
    // A brand written in its own case is still a lookup like any other ("ikea" → Household).
    expect(read('80 ikea').r?.categoryId).toBe(id('Household'));
    expect(read('9 tk maxx').r?.categoryId).toBe(id('Household'));
    expect(read('12 pret a manger').r?.categoryId).toBe(id('Eating out'));
  });

  it('Q-U6 TXT-1: the reading says the list\'s spelling, else a capital first letter; other scripts as typed', () => {
    expect(tidy('ikea')).toBe('IKEA');
    expect(tidy('easyjet')).toBe('easyJet');
    expect(tidy('tk maxx towels')).toBe('TK Maxx towels');
    expect(tidy('tesco')).toBe('Tesco');
    expect(tidy('gin and lime')).toBe('Gin and lime');
    expect(tidy('이마트')).toBe('이마트');
    expect(read('80 ikea').words).toBe('£80.00 · IKEA · Household · Jae paid · 50/50');
  });
});

describe('From before (Q-L12 ADD-4)', () => {
  it('Q-L12 ADD-4: before anything is typed, the most recent different descriptions, newest first', () => {
    const at = (description: string, date: string, created: string) => ({ ...row(description, 'Groceries'), date, created_at: created });
    const list = [at('Lamp', '2026-11-12', 'a'), at('Tesco', '2026-11-14', 'b'), at('tesco', '2026-11-13', 'c'), at('Rent', '2026-11-14', 'a')];
    expect(descriptionSuggestions('', list)).toEqual(['Tesco', 'Rent', 'Lamp']);
  });
});
