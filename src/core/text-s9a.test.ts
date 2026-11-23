/**
 * S9a core (docs/slices/S9a.md fix 3; SPEC TXT-3 ACT-1 CAT-2 CAT-3): search, learned categories and suggestions treat
 * ’ ‘ ʼ ′ ' as one character and ignore apostrophes when matching, so "sainsbury's", "sainsburys" and "Sainsbury’s"
 * all find "Sainsbury’s". The fold lives in the core normaliser (src/core/text.ts normaliseKey), which matches,
 * applyFilter and categorise already go through. Written before the build (ENGINEERING §5, tests first by someone else).
 */
import { describe, expect, it } from 'vitest';
import { learn, suggest } from './categorise';
import { applyFilter, type FilterEntry } from './filters';
import { matches, normaliseKey } from './text';

const APOSTROPHES = ['’', '‘', 'ʼ', '′', "'"] as const;

describe('normaliseKey folds apostrophes (TXT-3)', () => {
  it('TXT-3: every apostrophe-like mark gives the same key, and so does leaving it out', () => {
    const keys = new Set([...APOSTROPHES.map((a) => normaliseKey(`Sainsbury${a}s`)), normaliseKey('sainsburys'), normaliseKey('SAINSBURYS')]);
    expect(keys.size).toBe(1);
  });

  it('TXT-3: the fold keeps what TXT-3 already promised (case, width, Unicode forms, spaces)', () => {
    expect(normaliseKey('  Ｍ＆Ｓ   Food ')).toBe(normaliseKey('m&s food'));
    expect(normaliseKey('이마트')).toBe(normaliseKey('이마트'.normalize('NFD')));
  });
});

describe('matches and Activity search (TXT-3, ACT-1)', () => {
  it.each([
    ["sainsbury's"], ['sainsburys'], ['Sainsbury’s'], ['SAINSBURY‘S'], ['sainsburyʼs'], ['sainsbury′s'], ['sains'],
  ])('TXT-3: %j finds "Sainsbury’s Local"', (needle) => {
    expect(matches('Sainsbury’s Local', needle)).toBe(true);
  });

  it('TXT-3: and the other way round: "sainsbury’s" finds "Sainsbury\'s" and "Sainsburys"', () => {
    expect(matches("Sainsbury's", 'sainsbury’s')).toBe(true);
    expect(matches('Sainsburys', 'sainsbury’s')).toBe(true);
  });

  it('TXT-3: no false friends: "sainsbury’s" does not find "Tesco"', () => {
    expect(matches('Tesco', "sainsbury's")).toBe(false);
  });

  it('ACT-1 TXT-3: Activity’s filter finds all 3 spellings of the shop with a straight apostrophe', () => {
    const row = (description: string): FilterEntry => ({
      kind: 'expense', description, notes: null, tags: [], place: null, payer: 'jae', categoryId: null, chapterId: null,
      country: 'GB', date: '2026-11-10', splitMode: 'ratio',
    });
    const rows = [row('Sainsbury’s'), row("Sainsbury's Local"), row('sainsburys'), row('Tesco')];
    expect(applyFilter(rows, { text: "sainsbury's" }).map((r) => r.description)).toEqual(['Sainsbury’s', "Sainsbury's Local", 'sainsburys']);
    expect(applyFilter(rows, { text: 'sainsburys' })).toHaveLength(3);
  });
});

describe('learned categories and the built-in list (TXT-3, CAT-2, CAT-3)', () => {
  const categories = [{ id: 'c-groceries', name: 'Groceries' }, { id: 'c-other', name: 'Other' }];

  it('CAT-3 TXT-3: a category learned for "Sainsbury’s" is applied to "sainsburys" and "sainsbury\'s"', () => {
    const memory = learn(new Map(), 'Sainsbury’s', { categoryId: 'c-groceries', split: null });
    for (const typed of ['sainsburys', "sainsbury's", 'SAINSBURYʼS']) {
      expect(suggest(typed, { memory, history: [], seed: {}, categories })).toMatchObject({ categoryId: 'c-groceries', source: 'memory' });
    }
  });

  it('CAT-2 TXT-3: history and the built-in list match whatever apostrophe was typed', () => {
    const fromHistory = suggest('sainsburys local', { memory: new Map(), history: [{ description: 'Sainsbury’s', categoryId: 'c-groceries' }], seed: {}, categories });
    expect(fromHistory.categoryId).toBe('c-groceries');
    const fromSeed = suggest('Sainsbury’s', { memory: new Map(), history: [], seed: { "Sainsbury's": 'Groceries' }, categories });
    expect(fromSeed).toMatchObject({ categoryId: 'c-groceries', source: 'seed' });
  });
});
