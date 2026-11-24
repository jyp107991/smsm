/**
 * The live eval's recap months (docs/AI.md §3.4, §5): a year of one household's shared spending, made up but shaped like
 * a real London couple's (rent, council tax, bills, shops, meals out, a trip, a sofa, refunds), from which the app's own
 * code works out each month's recap (core/recap recapOf) and what the `recap` task is sent (core/wording recapStats).
 * Twelve finished months, November 2025 to October 2026, each worded early the next month (the ledger as it stood
 * then, today the 3rd). Between them they cover a month less, more and about the same as usual, months with no
 * comparison (fewer than three full months before them), chapter months, money back, a subscription's price change and
 * a new regular payment. Deterministic: a seeded generator (mulberry32, seed 20261124), so every run sends the same
 * figures. Pure: no I/O, no clock. worker/ai-eval-cases.test.ts checks the coverage without the network.
 */
import { usual, type InsightEntry, type NoteTemplate } from '../../../src/core/insights';
import { pence } from '../../../src/core/money';
import { recapOf, type Recap } from '../../../src/core/recap';
import type { UserId } from '../../../src/core/split';
import { recapStats, type RecapStats } from '../../../src/core/wording';

export const PEOPLE: readonly [UserId, UserId] = ['user-a', 'user-b'];
export const NAMES = { A: 'Jae', B: 'Sam' } as const;
const [A, B] = PEOPLE;
const CATEGORY_NAMES = ['Groceries', 'Eating out', 'Going out', 'Rent & bills', 'Utilities', 'Transport', 'Subscriptions', 'Household', 'Travel', 'Gifts', 'Health', 'Other'];
export const CATEGORIES = CATEGORY_NAMES.map((name, i) => ({ id: `cat-${String(i + 1)}`, name }));
const cat = (name: string) => CATEGORIES.find((c) => c.name === name)?.id ?? null;

/** What each recapped month is meant to show (checked against what the app's code works out). */
export type Scenario = 'no comparison' | 'less' | 'more' | 'same';
export interface RecapMonth {
  month: string;
  scenario: Scenario;
  chapter: boolean;
  moneyBack: boolean;
  recap: Recap;
  stats: RecapStats;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PLAN: readonly { month: string; scenario: Scenario; chapter?: string; moneyBack?: boolean }[] = [
  { month: '2025-11', scenario: 'no comparison' },
  { month: '2025-12', scenario: 'no comparison' },
  { month: '2026-01', scenario: 'less' },
  { month: '2026-02', scenario: 'same' },
  { month: '2026-03', scenario: 'more' },
  { month: '2026-04', scenario: 'same', chapter: 'Japan trip' },
  { month: '2026-05', scenario: 'less', moneyBack: true },
  { month: '2026-06', scenario: 'more' },
  { month: '2026-07', scenario: 'same' },
  { month: '2026-08', scenario: 'less', chapter: 'Cornwall weekend' },
  { month: '2026-09', scenario: 'more', moneyBack: true },
  { month: '2026-10', scenario: 'more', chapter: 'New sofa' },
];

const nextMonth = (m: string) => {
  const y = Number(m.slice(0, 4));
  const n = Number(m.slice(5, 7));
  return n === 12 ? `${String(y + 1)}-01` : `${String(y)}-${String(n + 1).padStart(2, '0')}`;
};
const lastDay = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate();

/** The year's entries and regular payments, and the twelve months as the app would word them. */
export function recapMonths(): RecapMonth[] {
  const rand = mulberry32(20261124);
  const between = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));
  const entries: InsightEntry[] = [];
  let n = 0;
  const add = (o: {
    month: string; day: number; description: string; category: string; amount: number; payer?: UserId;
    kind?: 'expense' | 'money_back'; chapterId?: string | null; recurringId?: string | null; refundOf?: string | null;
  }) => {
    n += 1;
    const payer = o.payer ?? (rand() < 0.5 ? A : B);
    const half = Math.floor(o.amount / 2);
    const e: InsightEntry = {
      id: `e${String(n)}`, kind: o.kind ?? 'expense', description: o.description, amount: pence(o.amount),
      paid: { [payer]: pence(o.amount) }, shares: { [A]: pence(o.amount - half), [B]: pence(half) },
      splitMode: 'ratio', date: `${o.month}-${String(Math.min(o.day, lastDay(o.month))).padStart(2, '0')}`,
      categoryId: cat(o.category), chapterId: o.chapterId ?? null, country: 'GB', recurringId: o.recurringId ?? null,
      deleted: false, refundOf: o.refundOf ?? null,
    };
    entries.push(e);
    return e;
  };

  const templates: NoteTemplate[] = [
    { id: 'rec-rent', description: 'Rent', amount: pence(165000), frequency: 'monthly', every: 1, startDate: '2025-09-01', isSubscription: false, active: true },
    { id: 'rec-council', description: 'Council tax', amount: pence(16800), frequency: 'monthly', every: 1, startDate: '2025-09-01', isSubscription: false, active: true },
    { id: 'rec-netflix', description: 'Netflix', amount: pence(1299), frequency: 'monthly', every: 1, startDate: '2025-09-12', isSubscription: true, active: true },
    { id: 'rec-spotify', description: 'Spotify Duo', amount: pence(1699), frequency: 'monthly', every: 1, startDate: '2025-09-20', isSubscription: true, active: true },
    { id: 'rec-disney', description: 'Disney+', amount: pence(899), frequency: 'monthly', every: 1, startDate: '2026-09-05', isSubscription: true, active: true },
  ];

  /** One ordinary month's everyday spending, without the big shop that sets where it lands. */
  const ordinary = (month: string) => {
    const mo = Number(month.slice(5, 7));
    add({ month, day: 1, description: 'Rent', category: 'Rent & bills', amount: 165000, payer: B, recurringId: 'rec-rent' });
    add({ month, day: 1, description: 'Council tax', category: 'Rent & bills', amount: 16800, payer: A, recurringId: 'rec-council' });
    // Energy costs more in winter.
    const winter = mo >= 11 || mo <= 3;
    add({ month, day: 4, description: 'Octopus Energy', category: 'Utilities', amount: winter ? between(11800, 14500) : between(6200, 7900), payer: A });
    add({ month, day: 8, description: 'Thames Water', category: 'Utilities', amount: 3850, payer: A });
    add({ month, day: 15, description: 'Community Fibre', category: 'Utilities', amount: 2500, payer: B });
    add({ month, day: 12, description: 'Netflix', category: 'Subscriptions', amount: month >= '2026-07' ? 1299 : 1099, payer: A, recurringId: 'rec-netflix' });
    add({ month, day: 20, description: 'Spotify Duo', category: 'Subscriptions', amount: 1699, payer: B, recurringId: 'rec-spotify' });
    if (month >= '2026-09') add({ month, day: 5, description: 'Disney+', category: 'Subscriptions', amount: 899, payer: B, recurringId: 'rec-disney' });
    const shops = ['Tesco Express', 'Sainsbury’s', 'Lidl', 'Ocado', 'M&S food', 'Co-op'];
    for (let i = 0; i < between(3, 5); i += 1) add({ month, day: between(2, 27), description: shops[between(0, shops.length - 1)] ?? 'Tesco', category: 'Groceries', amount: between(1800, 6500) });
    const meals = ['Dishoom', 'Franco Manca', 'Pho', 'Wagamama', 'Pret', 'Honest Burgers', 'Brunch at Gail’s'];
    for (let i = 0; i < between(3, 5); i += 1) add({ month, day: between(2, 27), description: meals[between(0, meals.length - 1)] ?? 'Dinner', category: 'Eating out', amount: between(1400, 6800) });
    for (let i = 0; i < between(2, 4); i += 1) add({ month, day: between(2, 27), description: i % 2 === 0 ? 'Uber' : 'Train to Brighton', category: 'Transport', amount: between(900, 4200) });
    add({ month, day: between(5, 25), description: rand() < 0.5 ? 'Cinema' : 'Drinks at the Crown', category: 'Going out', amount: between(2200, 5200) });
    if (rand() < 0.5) add({ month, day: between(3, 26), description: 'Boots', category: 'Health', amount: between(600, 2400) });
    if (rand() < 0.4) add({ month, day: between(3, 26), description: 'Robert Dyas', category: 'Household', amount: between(800, 3500) });
  };

  const everydayOf = (month: string) => entries
    .filter((e) => !e.deleted && e.chapterId === null && e.date.startsWith(month))
    .reduce((t, e) => t + (e.kind === 'money_back' ? 0 - e.amount : e.amount), 0);

  // September 2025: the household's first, part month.
  ordinary('2025-09');
  add({ month: '2025-09', day: 21, description: 'Big shop', category: 'Groceries', amount: 7400 });
  // October 2025: an ordinary month before the year that is recapped.
  ordinary('2025-10');
  for (const day of [5, 12, 19, 26]) add({ month: '2025-10', day, description: 'Big shop', category: 'Groceries', amount: between(5200, 7800) });

  const out: RecapMonth[] = [];
  for (const p of PLAN) {
    const m = p.month;
    ordinary(m);
    // What each month adds to the ordinary, as a couple's year goes.
    if (m === '2025-12') {
      add({ month: m, day: 6, description: 'Christmas presents for the family', category: 'Gifts', amount: 18600 });
      add({ month: m, day: 14, description: 'Christmas tree', category: 'Household', amount: 6500 });
      add({ month: m, day: 19, description: 'Work Christmas drinks', category: 'Going out', amount: 4800 });
    }
    if (m === '2026-03') add({ month: m, day: 9, description: 'New mattress from Simba', category: 'Household', amount: 42900 });
    if (m === '2026-04') {
      for (const [day, description, category, amount] of [
        [2, 'Flights to Tokyo', 'Travel', 124000], [3, 'Hotel in Kyoto', 'Travel', 68000], [5, 'Ramen in Shinjuku', 'Eating out', 3150],
        [6, 'Shinkansen to Kyoto', 'Transport', 26400], [8, 'Izakaya dinner', 'Eating out', 7200],
      ] as const) add({ month: m, day, description, category, amount, chapterId: 'ch-japan' });
    }
    if (m === '2026-05') {
      const lamp = add({ month: m, day: 4, description: 'John Lewis lamp', category: 'Household', amount: 8500, payer: A });
      add({ month: m, day: 18, description: 'Refund: John Lewis lamp', category: 'Household', amount: 8500, payer: A, kind: 'money_back', refundOf: lamp.id });
    }
    if (m === '2026-06') {
      add({ month: m, day: 13, description: 'Wedding present for Hana and Tom', category: 'Gifts', amount: 15000 });
      add({ month: m, day: 21, description: 'Gig tickets', category: 'Going out', amount: 13800 });
    }
    if (m === '2026-08') {
      for (const [day, description, category, amount] of [
        [14, 'Cottage in St Ives', 'Travel', 52000], [15, 'Fish and chips', 'Eating out', 2860], [16, 'Petrol', 'Transport', 6240],
      ] as const) add({ month: m, day, description, category, amount, chapterId: 'ch-cornwall' });
    }
    if (m === '2026-09') {
      const shop = add({ month: m, day: 7, description: 'Ocado', category: 'Groceries', amount: 11240, payer: B });
      add({ month: m, day: 9, description: 'Ocado refund for missing items', category: 'Groceries', amount: 1875, payer: B, kind: 'money_back', refundOf: shop.id });
      add({ month: m, day: 19, description: 'Dentist check-ups', category: 'Health', amount: 15400 });
    }
    if (m === '2026-10') {
      add({ month: m, day: 11, description: 'Sofa from Loaf', category: 'Household', amount: 129900, payer: A, chapterId: 'ch-sofa' });
      add({ month: m, day: 11, description: 'Sofa delivery', category: 'Household', amount: 4500, payer: A, chapterId: 'ch-sofa' });
      add({ month: m, day: 24, description: 'Birthday dinner at Dishoom', category: 'Eating out', amount: 11800 });
    }
    // The big shop sets where the month lands against its usual: less, more or about the same.
    const u = usual(entries, m);
    const now = everydayOf(m);
    const target = p.scenario === 'no comparison' || u === null ? now + between(20000, 30000)
      : p.scenario === 'same' ? u + between(-600, 600)
        : p.scenario === 'less' ? u - between(9000, 16000)
          : Math.max(u + between(15000, 30000), now + 4000);
    // The weekly big shops that take it there, none more than £80 (so no one shop stands out as a note).
    const shopping = Math.max(4000, target - now);
    const weeks = Math.ceil(shopping / 8000);
    for (let w = 0; w < weeks; w += 1) {
      const amount = Math.floor(shopping / weeks) + (w === 0 ? shopping % weeks : 0);
      add({ month: m, day: 3 + Math.floor((24 * w) / weeks), description: w % 2 === 0 ? 'Big shop' : 'Ocado', category: 'Groceries', amount });
    }

    // Worded on the 3rd of the next month: the ledger as it stood then.
    const today = `${nextMonth(m)}-03`;
    const known = entries.filter((e) => e.date <= today);
    const recap = recapOf(known, [], PEOPLE, m, {
      today, names: { [A]: NAMES.A, [B]: NAMES.B }, categories: CATEGORIES, templates: templates.filter((t) => t.startDate <= today),
    });
    out.push({ month: m, scenario: p.scenario, chapter: p.chapter !== undefined, moneyBack: p.moneyBack === true, recap, stats: recapStats(recap, PEOPLE) });
  }
  return out;
}

/**
 * Every number written in the month's own figures (a belt-and-braces check on wordingGuard, not the guard itself): the
 * stats' amounts and the numbers in its notes, as values ("£1,450.00" and "£1,450" are both 1450), and its year.
 */
export function ownNumbers(stats: RecapStats): Set<number> {
  const { period, ...rest } = stats;
  const own = new Set(numbersIn(JSON.stringify(rest)));
  own.add(Number(period.slice(0, 4)));
  return own;
}

/** The numbers written in a text, as values: "£1,365.50" is 1365.5, "3×" is 3. */
export function numbersIn(text: string): number[] {
  return [...text.matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => Number(m[0].replace(/,/g, '')));
}
