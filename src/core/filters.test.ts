import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { applyFilter, type Filter, type FilterEntry } from './filters';

const JAE = 'u-jae';
const SAM = 'u-sam';
const EMART = '이마트';

interface Row extends FilterEntry {
  id: string;
}
const base: Omit<Row, 'id'> = {
  kind: 'expense',
  description: '',
  notes: null,
  tags: [],
  place: null,
  payer: JAE,
  categoryId: 'c-groceries',
  chapterId: null,
  country: 'GB',
  date: '2026-11-17',
  splitMode: 'ratio',
};
const row = (id: string, over: Partial<Omit<Row, 'id'>>): Row => ({ ...base, ...over, id });

const ROWS: readonly Row[] = [
  row('r1', { description: 'Tesco Extra', date: '2026-11-17', tags: ['weekly'] }),
  row('r2', { description: 'Dishoom', notes: 'Big birthday dinner', payer: SAM, categoryId: 'c-eating-out', date: '2026-11-16' }),
  row('r3', { description: 'Ramen', place: 'Kyoto', country: 'JP', chapterId: 'ch-japan', categoryId: 'c-eating-out', date: '2026-10-25', tags: ['japan', '여행'] }),
  row('r4', { description: `${EMART} 강남점`, payer: SAM, country: 'KR', chapterId: 'ch-seoul', date: '2026-09-01' }),
  row('r5', { kind: 'money_back', description: 'Tesco refund', date: '2026-11-17', splitMode: 'ratio' }),
  row('r6', { kind: 'settlement', description: 'Settle up', payer: SAM, categoryId: null, date: '2026-11-15', splitMode: null }),
  row('r7', { description: 'Haircut', categoryId: 'c-health', date: '2025-12-31', splitMode: 'for_other', notes: 'ｶｯﾄ' }),
  row('r8', { description: 'セブンイレブン', place: 'Tokyo', country: 'JP', chapterId: 'ch-japan', categoryId: 'c-groceries', date: '2026-10-26', tags: ['Japan'] }),
];
const ids = (rows: readonly Row[]): string[] => rows.map((r) => r.id);

describe('applyFilter', () => {
  it('an empty filter keeps everything, in order', () => {
    expect(ids(applyFilter(ROWS, {}))).toEqual(ids(ROWS));
  });

  it('returns the same row objects, not copies', () => {
    const out = applyFilter(ROWS, { text: 'tesco' });
    expect(out[0]).toBe(ROWS[0]);
  });

  it('TXT-3 text searches description, notes, tags and place', () => {
    expect(ids(applyFilter(ROWS, { text: 'tesco' }))).toEqual(['r1', 'r5']);
    expect(ids(applyFilter(ROWS, { text: 'birthday' }))).toEqual(['r2']);
    expect(ids(applyFilter(ROWS, { text: 'weekly' }))).toEqual(['r1']);
    expect(ids(applyFilter(ROWS, { text: 'kyoto' }))).toEqual(['r3']);
    expect(ids(applyFilter(ROWS, { text: 'japan' }))).toEqual(['r3', 'r8']);
  });

  it('TXT-3 text ignores case, width and how Hangul was composed', () => {
    expect(ids(applyFilter(ROWS, { text: 'TESCO' }))).toEqual(['r1', 'r5']);
    expect(ids(applyFilter(ROWS, { text: 'ｔｅｓｃｏ ｅｘｔｒａ' }))).toEqual(['r1']);
    expect(ids(applyFilter(ROWS, { text: EMART.normalize('NFD') }))).toEqual(['r4']);
    expect(ids(applyFilter(ROWS, { text: '여행' }))).toEqual(['r3']);
    expect(ids(applyFilter(ROWS, { text: 'カット' }))).toEqual(['r7']);
    expect(ids(applyFilter(ROWS, { text: 'ｾﾌﾞﾝ' }))).toEqual(['r8']);
  });

  it('TXT-3 blank text filters nothing; text found nowhere filters everything', () => {
    expect(ids(applyFilter(ROWS, { text: '' }))).toEqual(ids(ROWS));
    expect(ids(applyFilter(ROWS, { text: '   ' }))).toEqual(ids(ROWS));
    expect(applyFilter(ROWS, { text: 'nowhere at all' })).toEqual([]);
  });

  it('by who paid', () => {
    expect(ids(applyFilter(ROWS, { payer: SAM }))).toEqual(['r2', 'r4', 'r6']);
    expect(ids(applyFilter(ROWS, { payer: JAE }))).toEqual(['r1', 'r3', 'r5', 'r7', 'r8']);
  });

  it('by category (any of those chosen)', () => {
    expect(ids(applyFilter(ROWS, { categories: ['c-eating-out'] }))).toEqual(['r2', 'r3']);
    expect(ids(applyFilter(ROWS, { categories: ['c-eating-out', 'c-health'] }))).toEqual(['r2', 'r3', 'r7']);
  });

  it('by chapter, where null means everyday', () => {
    expect(ids(applyFilter(ROWS, { chapters: ['ch-japan'] }))).toEqual(['r3', 'r8']);
    expect(ids(applyFilter(ROWS, { chapters: [null] }))).toEqual(['r1', 'r2', 'r5', 'r6', 'r7']);
    expect(ids(applyFilter(ROWS, { chapters: [null, 'ch-seoul'] }))).toEqual(['r1', 'r2', 'r4', 'r5', 'r6', 'r7']);
  });

  it('by country', () => {
    expect(ids(applyFilter(ROWS, { countries: ['JP'] }))).toEqual(['r3', 'r8']);
    expect(ids(applyFilter(ROWS, { countries: ['JP', 'KR'] }))).toEqual(['r3', 'r4', 'r8']);
  });

  it('DAT-1 DAT-3 by calendar dates, both ends included, across the clock change and the year end', () => {
    expect(ids(applyFilter(ROWS, { from: '2026-11-16' }))).toEqual(['r1', 'r2', 'r5']);
    expect(ids(applyFilter(ROWS, { to: '2026-10-25' }))).toEqual(['r3', 'r4', 'r7']);
    expect(ids(applyFilter(ROWS, { from: '2026-10-25', to: '2026-10-26' }))).toEqual(['r3', 'r8']);
    expect(ids(applyFilter(ROWS, { from: '2026-01-01', to: '2026-12-31' }))).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r8']);
    expect(ids(applyFilter(ROWS, { to: '2025-12-31' }))).toEqual(['r7']);
    expect(applyFilter(ROWS, { from: '2026-11-18', to: '2026-11-17' })).toEqual([]);
  });

  it('by tag (any of those chosen)', () => {
    expect(ids(applyFilter(ROWS, { tags: ['weekly'] }))).toEqual(['r1']);
    expect(ids(applyFilter(ROWS, { tags: ['weekly', '여행'] }))).toEqual(['r1', 'r3']);
  });

  it('by type', () => {
    expect(ids(applyFilter(ROWS, { kinds: ['settlement'] }))).toEqual(['r6']);
    expect(ids(applyFilter(ROWS, { kinds: ['expense', 'money_back'] }))).toEqual(['r1', 'r2', 'r3', 'r4', 'r5', 'r7', 'r8']);
  });

  it('TXT-3 filters combine: every one given must hold', () => {
    expect(ids(applyFilter(ROWS, { text: 'tesco', kinds: ['expense'] }))).toEqual(['r1']);
    expect(ids(applyFilter(ROWS, { countries: ['JP'], categories: ['c-groceries'], payer: JAE }))).toEqual(['r8']);
    expect(ids(applyFilter(ROWS, { chapters: ['ch-japan'], from: '2026-10-26' }))).toEqual(['r8']);
  });

  it('keeps order, never invents rows, and combines conditions with and, for any filter', () => {
    const filterArb: fc.Arbitrary<Filter> = fc.record(
      {
        text: fc.constantFrom('tesco', 'JAPAN', 'ｶｯﾄ', '', 'zzz', EMART),
        categories: fc.subarray(['c-groceries', 'c-eating-out', 'c-health'], { minLength: 1 }),
        chapters: fc.subarray([null, 'ch-japan', 'ch-seoul'], { minLength: 1 }),
        countries: fc.subarray(['GB', 'JP', 'KR'], { minLength: 1 }),
        from: fc.constantFrom('2025-12-31', '2026-10-25', '2026-11-16'),
        to: fc.constantFrom('2026-10-26', '2026-11-17'),
        kinds: fc.subarray<FilterEntry['kind']>(['expense', 'money_back', 'settlement'], { minLength: 1 }),
      },
      { requiredKeys: [] },
    );
    fc.assert(
      fc.property(fc.shuffledSubarray([...ROWS]), filterArb, (rows, f) => {
        const out = applyFilter(rows, f);
        let last = -1;
        for (const r of out) {
          const i = rows.indexOf(r);
          expect(i).toBeGreaterThan(last);
          last = i;
        }
        // Conditions combine with "and": adding one narrows the result to exactly the rows that also meet it.
        expect(applyFilter(rows, { ...f, payer: SAM })).toEqual(out.filter((r) => r.payer === SAM));
      }),
    );
  });
});
