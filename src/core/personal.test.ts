/**
 * S10 core: personal regular payments (owner, 25 Nov; DECISIONS 25 Nov "Personal regular payments"; SPEC REC-9…REC-12,
 * INS-10). Written before the build. A personal entry (ownerId set: what one person's own regular payment posted) is
 * never in a shared figure: the balance (netPositions, and so the statement, the recap's "between you" and the
 * standing-order hint), shared spending and everything built on it (Insights, usual, pace, the comparison period,
 * notes, the recap, year in review), Ask's answers, the statement's lines and the filtered shared total. One person's
 * own figures are produced apart (ownView), by the same rules. Export names whose each row is.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { answer } from './ask';
import { isPersonal, netPositions, type LedgerEntry } from './balance';
import { exportCsv, EXPORT_COLUMNS } from './csv';
import { addDays, type IsoDate } from './dates';
import { applyFilter, filteredTotal, type FilterEntry } from './filters';
import {
  byCategory, comparisonPeriod, notes, ownView, pace, periodOf, sharedSpend, standingOrder, usual, whoPaid,
  type InsightEntry, type NoteTemplate,
} from './insights';
import { pence } from './money';
import { recapOf, yearOf } from './recap';
import { statement } from './statement';

const JAE = 'jae';
const SAM = 'sam';
const PEOPLE = [JAE, SAM] as const;
const TODAY: IsoDate = '2026-11-14';
const GYM = 'cat-gym';
const FOOD = 'cat-food';

let n = 0;
function e(over: Omit<Partial<InsightEntry>, 'amount'> & { amount: number }): InsightEntry {
  n += 1;
  const amount = pence(over.amount);
  return {
    id: `e${String(n)}`, kind: 'expense', description: 'Thing', paid: { [JAE]: amount }, shares: { [JAE]: pence(amount - Math.floor(amount / 2)), [SAM]: pence(Math.floor(amount / 2)) },
    splitMode: 'ratio', date: TODAY, categoryId: FOOD, chapterId: null, country: 'GB', recurringId: null, deleted: false, ...over, amount,
  };
}
/** One person's own entry: all theirs (a treat by them), as the database makes it. */
function own(owner: string, over: Omit<Partial<InsightEntry>, 'amount'> & { amount: number }): InsightEntry {
  const amount = pence(over.amount);
  return e({ ...over, splitMode: 'treat', paid: { [owner]: amount }, shares: { [owner]: amount }, ownerId: owner, categoryId: over.categoryId ?? GYM, recurringId: over.recurringId ?? 'r-own' });
}

const isoDay = fc.integer({ min: 0, max: 420 }).map((k) => addDays('2025-09-01', k));
const sharedArb = fc.record({
  amount: fc.integer({ min: 1, max: 200_000 }), date: isoDay, payer: fc.constantFrom(JAE, SAM), category: fc.constantFrom(FOOD, GYM, null),
  kind: fc.constantFrom<'expense' | 'money_back'>('expense', 'expense', 'expense', 'money_back'), mode: fc.constantFrom<'ratio' | 'treat' | 'for_other'>('ratio', 'treat', 'for_other'),
  deleted: fc.boolean(),
}).map((r) => {
  const amount = pence(r.amount);
  const other = r.payer === JAE ? SAM : JAE;
  const shares = r.mode === 'treat' ? { [r.payer]: amount } : r.mode === 'for_other' ? { [other]: amount } : { [r.payer]: pence(amount - Math.floor(amount / 2)), [other]: pence(Math.floor(amount / 2)) };
  return e({ amount: r.amount, date: r.date, kind: r.kind, splitMode: r.mode, paid: { [r.payer]: amount }, shares, categoryId: r.category, deleted: r.deleted && r.amount % 3 === 0 });
});
const ownArb = fc.record({ amount: fc.integer({ min: 1, max: 200_000 }), date: isoDay, owner: fc.constantFrom(JAE, SAM), category: fc.constantFrom(FOOD, GYM) })
  .map((r) => own(r.owner, { amount: r.amount, date: r.date, categoryId: r.category }));
/** Earlier than any shared one, so a comparison period or a usual counted from them would show. */
const earlyOwnArb = fc.integer({ min: 1, max: 50_000 }).map((amount) => own(JAE, { amount, date: '2024-01-15' }));

describe('REC-12: one person’s own entries are never in the balance', () => {
  it('REC-12 BAL-1: netPositions leaves out a personal entry, even one whose maps would move the balance', () => {
    const shared: LedgerEntry = { kind: 'expense', paid: { [JAE]: pence(4400) }, shares: { [JAE]: pence(2200), [SAM]: pence(2200) }, deleted: false };
    const stray: LedgerEntry = { kind: 'expense', paid: { [JAE]: pence(9900) }, shares: { [SAM]: pence(9900) }, deleted: false, ownerId: JAE };
    expect(netPositions(PEOPLE, [shared, stray], [])).toEqual({ [JAE]: 2200, [SAM]: -2200 });
    expect(netPositions(PEOPLE, [stray], [])).toEqual({ [JAE]: 0, [SAM]: 0 });
    // A shared row of the same shape counts (the rule is whose it is, not its shape).
    expect(netPositions(PEOPLE, [{ ...stray, ownerId: null }], [])).toEqual({ [JAE]: 9900, [SAM]: -9900 });
  });

  it('REC-12: isPersonal is "has an owner"', () => {
    expect(isPersonal({})).toBe(false);
    expect(isPersonal({ ownerId: null })).toBe(false);
    expect(isPersonal({ ownerId: SAM })).toBe(true);
  });

  it('REC-12 BAL-1: adding any personal entries never changes either net (property)', () => {
    fc.assert(fc.property(fc.array(sharedArb, { maxLength: 25 }), fc.array(ownArb, { maxLength: 10 }), (shared, mine) => {
      const toLedger = (x: InsightEntry): LedgerEntry => ({ kind: x.kind, paid: x.paid, shares: { ...x.shares, ...(x.ownerId ? { [x.ownerId === JAE ? SAM : JAE]: pence(1) } : {}) }, deleted: x.deleted, ownerId: x.ownerId ?? null });
      expect(netPositions(PEOPLE, [...shared, ...mine].map(toLedger), [])).toEqual(netPositions(PEOPLE, shared.map(toLedger), []));
    }));
  });

  it('REC-12: the statement, its balance and its lines leave them out', () => {
    const shared = [e({ amount: 4400, date: '2026-11-03' })];
    const mine = [own(JAE, { amount: 3500, date: '2026-11-02' }), own(SAM, { amount: 999, date: '2026-10-02' })];
    const with_ = statement([...shared, ...mine], [], PEOPLE, '2026-11');
    const without = statement(shared, [], PEOPLE, '2026-11');
    expect(with_).toEqual(without);
    expect(with_.rows.map((r) => r.id)).toEqual(shared.map((x) => x.id));
  });

  it('REC-12: the standing-order hint is the shared balance’s alone', () => {
    const shared = ['2026-08-10', '2026-09-10', '2026-10-10'].map((date) => e({ amount: 20000, date }));
    const mine = ['2026-08-11', '2026-09-11', '2026-10-11'].map((date) => ({ ...own(JAE, { amount: 50000, date }), shares: { [SAM]: pence(50000) } }));
    expect(standingOrder([...shared, ...mine], [], PEOPLE, TODAY)).toEqual(standingOrder(shared, [], PEOPLE, TODAY));
    expect(standingOrder(shared, [], PEOPLE, TODAY)).toEqual({ debtor: SAM, creditor: JAE, amount: 20000 });
  });
});

describe('REC-12: never in shared spending, Insights, the recap or Ask', () => {
  it('REC-12: every shared figure is the same with or without personal entries (property)', () => {
    fc.assert(fc.property(fc.array(sharedArb, { maxLength: 30 }), fc.array(fc.oneof(ownArb, earlyOwnArb), { maxLength: 12 }), (shared, mine) => {
      const all = [...shared, ...mine];
      for (const choice of ['month', '3months', '12months', 'year'] as const) {
        const p = periodOf(choice, TODAY);
        expect(sharedSpend(all, p)).toBe(sharedSpend(shared, p));
        expect(sharedSpend(all, p, { everydayOnly: true })).toBe(sharedSpend(shared, p, { everydayOnly: true }));
        expect(byCategory(all, p)).toEqual(byCategory(shared, p));
        expect(whoPaid(all, p, PEOPLE)).toEqual(whoPaid(shared, p, PEOPLE));
        expect(comparisonPeriod(all, p)).toEqual(comparisonPeriod(shared, p));
      }
      expect(usual(all, '2026-11')).toBe(usual(shared, '2026-11'));
      expect(pace(all, TODAY)).toEqual(pace(shared, TODAY));
    }), { numRuns: 60 });
  });

  it('REC-12: an earlier personal entry never starts the household’s history (comparison period, usual)', () => {
    const shared = [e({ amount: 1000, date: '2026-09-25' }), e({ amount: 1200, date: '2026-11-05' })];
    const early = own(JAE, { amount: 3500, date: '2025-01-03' });
    const month = periodOf('month', TODAY);
    expect(comparisonPeriod(shared, month)).toEqual({ kind: 'month', from: '2026-10-01', to: '2026-10-14', chapterId: null });
    expect(comparisonPeriod([...shared, early], periodOf('12months', TODAY))).toBeNull();
    expect(usual([...shared, early], '2026-11')).toBeNull();
  });

  it('REC-12: notes never mention one person’s own regular payment or entries', () => {
    const tmpl: NoteTemplate = { id: 'r-own', description: 'Own gym', amount: pence(3500), frequency: 'monthly', every: 1, startDate: '2026-11-02', isSubscription: true, active: true, ownerId: JAE };
    const posted = [own(JAE, { amount: 3000, date: '2026-10-02' }), own(JAE, { amount: 3500, date: '2026-11-02' })];
    const big = own(SAM, { amount: 900_00, date: '2026-11-05', categoryId: FOOD });
    const earlier = ['2026-05-03', '2026-06-03', '2026-07-03', '2026-08-03', '2026-09-03', '2026-10-03'].map((date) => e({ amount: 1000, date }));
    const out = notes({ entries: [...earlier, ...posted, big], templates: [tmpl], categories: [{ id: FOOD, name: 'Food' }, { id: GYM, name: 'Gym' }] }, TODAY);
    expect(out).toEqual(notes({ entries: earlier, templates: [], categories: [{ id: FOOD, name: 'Food' }, { id: GYM, name: 'Gym' }] }, TODAY));
  });

  it('REC-12: the recap and the year in review are the shared ones', () => {
    const shared = [e({ amount: 4400, date: '2026-10-03' }), e({ amount: 800, date: '2026-10-09', categoryId: GYM })];
    const mine = [own(JAE, { amount: 999_00, date: '2026-10-04' })];
    const opts = { today: TODAY, names: { [JAE]: 'Jae', [SAM]: 'Sam' }, categories: [{ id: FOOD, name: 'Food' }, { id: GYM, name: 'Gym' }] };
    expect(recapOf([...shared, ...mine], [], PEOPLE, '2026-10', opts)).toEqual(recapOf(shared, [], PEOPLE, '2026-10', opts));
    expect(yearOf([...shared, ...mine], [], PEOPLE, 2026)).toEqual(yearOf(shared, [], PEOPLE, 2026));
  });

  it('REC-12 INS-9: Ask’s answers never count one person’s own entries', () => {
    const lookups = { categories: [{ id: GYM, name: 'Gym' }], chapters: [], countries: [], people: [{ id: JAE, name: 'Jae' }, { id: SAM, name: 'Sam' }] as const, today: TODAY };
    const rows = [e({ amount: 2000, categoryId: GYM }), own(JAE, { amount: 3500 })].map((x) => ({
      ...x, notes: null, tags: [], place: null, payer: Object.keys(x.paid)[0] ?? null, country: 'GB',
    }));
    expect(answer(rows, { categories: [GYM] }, 'total', null, TODAY, lookups).figure).toBe(2000);
    expect(answer(rows, { categories: [GYM] }, 'count', null, TODAY, lookups).figure).toBe(1);
    expect(answer(rows, { payer: JAE }, 'total', null, TODAY, lookups).figure).toBe(2000);
  });
});

describe('INS-10: one person’s own figures, produced apart by the same rules', () => {
  it('INS-10: ownView is that person’s own entries alone, read as spending', () => {
    const shared = [e({ amount: 4400 })];
    const jae = [own(JAE, { amount: 3500, date: '2026-11-02' }), own(JAE, { amount: 1200, date: '2026-11-09', categoryId: FOOD })];
    const sam = [own(SAM, { amount: 799 })];
    const view = ownView([...shared, ...jae, ...sam], JAE);
    expect(view.map((x) => x.id)).toEqual(jae.map((x) => x.id));
    expect(view.every((x) => x.ownerId === null)).toBe(true);
    const month = periodOf('month', TODAY);
    expect(sharedSpend(view, month)).toBe(4700);
    expect(byCategory(view, month)).toEqual([{ categoryId: GYM, total: 3500 }, { categoryId: FOOD, total: 1200 }]);
    expect(sharedSpend(ownView([...shared, ...jae, ...sam], SAM), month)).toBe(799);
    // Never the shared ones, and the shared figures never theirs.
    expect(sharedSpend([...shared, ...jae, ...sam], month)).toBe(4400);
  });

  it('INS-10: the same comparison period and pace rules as shared (property)', () => {
    fc.assert(fc.property(fc.array(sharedArb, { maxLength: 15 }), fc.array(ownArb, { maxLength: 20 }), (shared, mine) => {
      const view = ownView([...shared, ...mine], JAE);
      // As if those entries were the household's only (shared) spending.
      const alone = mine.filter((x) => x.ownerId === JAE).map((x) => ({ ...x, ownerId: null }));
      expect(pace(view, TODAY)).toEqual(pace(alone, TODAY));
      for (const choice of ['month', '3months', '12months'] as const) {
        const p = periodOf(choice, TODAY);
        expect(comparisonPeriod(view, p)).toEqual(comparisonPeriod(alone, p));
      }
    }), { numRuns: 60 });
  });

  it('INS-10: pace over someone’s own months reads like the shared one', () => {
    const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
    const mine = [...months.map((m) => own(JAE, { amount: 3500, date: `${m}-02` })), own(JAE, { amount: 3500, date: '2026-11-02' }), own(JAE, { amount: 5000, date: '2026-11-10' })];
    expect(pace(ownView(mine, JAE), TODAY)).toMatchObject({ soFar: 8500, usual: 3500, direction: 'over', amount: 5000 });
    expect(pace(ownView(mine, SAM), TODAY)).toMatchObject({ soFar: 0, usual: null, direction: null });
  });
});

describe('REC-9: Activity’s whose filter and the shared total', () => {
  const row = (over: Partial<FilterEntry> & { amount: number }) => ({
    kind: 'expense' as const, description: 'x', notes: null, tags: [], place: null, payer: JAE, categoryId: null, chapterId: null, country: 'GB',
    date: TODAY, splitMode: 'ratio' as const, ...over, amount: pence(over.amount),
  });
  const rows = [row({ amount: 1000 }), row({ amount: 3500, ownerId: JAE, splitMode: 'treat' }), row({ amount: 700, ownerId: SAM, splitMode: 'treat' }),
    row({ amount: 200, kind: 'money_back' }), row({ amount: 5000, kind: 'settlement', splitMode: null })];

  it('REC-9: Shared keeps what you share (settle-ups too); a person’s own keeps only theirs', () => {
    expect(applyFilter(rows, { owner: 'shared' }).map((r) => r.amount)).toEqual([1000, 200, 5000]);
    expect(applyFilter(rows, { owner: JAE }).map((r) => r.amount)).toEqual([3500]);
    expect(applyFilter(rows, { owner: SAM }).map((r) => r.amount)).toEqual([700]);
    expect(applyFilter(rows, {})).toHaveLength(5);
  });

  it('REC-12: the filtered shared total never counts someone’s own; with an owner, only theirs', () => {
    expect(filteredTotal(rows)).toEqual({ count: 2, total: 800 });
    expect(filteredTotal(rows, JAE)).toEqual({ count: 1, total: 3500 });
    expect(filteredTotal(rows, SAM)).toEqual({ count: 1, total: 700 });
  });
});

describe('REC-9: export names whose each row is', () => {
  it('REC-9 EXP-1: a "Whose" column: Shared, or the person’s own; blank for a settle-up', () => {
    const people = [{ id: JAE, name: 'Jae' }, { id: SAM, name: 'Sam' }] as const;
    const csv = exportCsv(
      [{ ...e({ amount: 4400, date: '2026-11-03', description: 'Tesco' }), notes: null }, { ...own(SAM, { amount: 1299, date: '2026-11-04', description: 'Own phone' }), notes: null }],
      [{ id: 's1', from: SAM, to: JAE, amount: pence(2200), date: '2026-11-05', deleted: false, note: null }],
      people, [], [], { from: '2026-11-01', to: '2026-11-30' },
    );
    const lines = csv.replace(/^\uFEFF/u, '').trim().split('\r\n');
    expect(EXPORT_COLUMNS('Jae', 'Sam').at(-1)).toBe('Whose');
    expect(lines[0]?.split(',').at(-1)).toBe('Whose');
    expect(lines[1]?.split(',').at(-1)).toBe('Shared');
    expect(lines[2]).toContain('Own phone');
    expect(lines[2]?.split(',').at(-1)).toBe('Sam\'s own');
    expect(lines[3]?.split(',').at(-1)).toBe('');
  });
});
