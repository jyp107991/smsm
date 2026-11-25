/**
 * A seeded, realistic 18-month household for demo mode, previews, snapshots and the gallery (ENGINEERING §7).
 * Deterministic: the same `today` always gives the same data. Rows have the database's shapes, and every
 * money row is built with the core's own split maths, so the demo can never show an impossible entry.
 */
import type { Database } from '../../src/data/database.types';
import { addDays, addMonths, daysBetween, type IsoDate } from '../../src/core/dates';
import { pence, type Pence } from '../../src/core/money';
import { computeEntry, type SplitParams, type UserId } from '../../src/core/split';
import { dueOccurrences } from '../../src/core/recurring';

type Tables = Database['public']['Tables'];
export type HouseholdRow = Tables['households']['Row'];
export type MemberRow = Tables['members']['Row'];
export type CategoryRow = Tables['categories']['Row'];
export type ChapterRow = Tables['chapters']['Row'];
export type RecurringRow = Tables['recurring']['Row'];
export type ExpenseRow = Tables['expenses']['Row'];
export type SettlementRow = Tables['settlements']['Row'];
export type InboxItemRow = Tables['inbox_items']['Row'];
export type CommentRow = Tables['comments']['Row'];

export interface DemoHousehold {
  household: HouseholdRow;
  members: [MemberRow, MemberRow];
  categories: CategoryRow[];
  chapters: ChapterRow[];
  recurring: RecurringRow[];
  /** S3: the open Inbox bill (the latest energy bill, asking for its amount). */
  inboxItems: InboxItemRow[];
  /** S5b: a short thread on last month's biggest shop. */
  comments: CommentRow[];
  expenses: ExpenseRow[];
  settlements: SettlementRow[];
}

export const DEMO_HOUSEHOLD_ID = '00000000-0000-4000-8000-0000000000aa';
export const JAE: UserId = '00000000-0000-4000-8000-00000000000a';
export const SAM: UserId = '00000000-0000-4000-8000-00000000000b';
const MEMBERS = [JAE, SAM] as const;

/** mulberry32: a small, fast, seeded generator; good enough for realistic-looking sample data. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CATEGORY_DEFS: readonly [string, string, string, string][] = [
  ['Groceries', '🛒', 'moss', 'groceries'], ['Eating out', '🍜', 'amber', 'eating_out'], ['Rent & bills', '🏠', 'walnut', 'rent_bills'],
  ['Utilities', '💡', 'honey', 'utilities'], ['Transport', '🚆', 'slate', 'transport'], ['Subscriptions', '📺', 'plum', 'subscriptions'],
  ['Household', '🧺', 'oak', 'household'], ['Going out', '🍸', 'berry', 'going_out'], ['Travel', '✈️', 'lake', 'travel'],
  ['Gifts', '🎁', 'clay', 'gifts'], ['Health', '💊', 'fern', 'health'], ['Other', '📦', 'stone', 'other'],
];

function id(n: number): string {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
}

export function demoHousehold(today: IsoDate): DemoHousehold {
  const rand = rng(20261116);
  let next = 0x1000;
  const newId = () => id((next += 1));
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T;
  const between = (lo: number, hi: number) => Math.round(lo + rand() * (hi - lo));
  const start = addMonths(today, -18);
  const stamp = (d: IsoDate) => `${d}T12:00:00.000Z`;

  const household: HouseholdRow = {
    id: DEMO_HOUSEHOLD_ID, join_code: 'DEMO42', home_country: 'GB', default_ratio: null,
    joint_enabled: false, joint_ratio: null, settle_day: null, created_at: stamp(start),
  };
  const members: [MemberRow, MemberRow] = [
    { household_id: DEMO_HOUSEHOLD_ID, user_id: JAE, display_name: 'Jae', animal: 'dog', locked_at: stamp(start), monzo_me: 'jae-demo', joined_at: stamp(start) },
    { household_id: DEMO_HOUSEHOLD_ID, user_id: SAM, display_name: 'Sam', animal: 'cat', locked_at: stamp(start), monzo_me: null, joined_at: stamp(start) },
  ];
  const categories: CategoryRow[] = CATEGORY_DEFS.map(([name, emoji, colour, key], i) => ({
    id: id(0x100 + i), household_id: DEMO_HOUSEHOLD_ID, name, emoji, colour, default_ratio: null,
    archived: false, sort: i + 1, seed_key: key, updated_at: stamp(start),
  }));
  const cat = (name: string): string => categories.find((c) => c.name === name)?.id ?? '';
  const catName = (id: string | null): string => categories.find((c) => c.id === id)?.name ?? 'Other';
  // REC-7 (owner, 25 Nov): a regular payment is a subscription exactly when it is in the Subscriptions category; the
  // column says what the database's trigger would.
  const inSubscriptions = (category: string): boolean => categories.some((c) => c.name === category && c.seed_key === 'subscriptions');

  // A nine-day trip to Japan about five months ago, kept apart as a chapter.
  const tripStart = addDays(addMonths(today, -5), -3);
  const tripEnd = addDays(tripStart, 8);
  const japan: ChapterRow = {
    id: id(0x200), household_id: DEMO_HOUSEHOLD_ID, name: 'Japan', emoji: '🗾', kind: 'trip', country: 'JP',
    start_date: tripStart, end_date: tripEnd, closed: true, created_by: JAE, created_at: stamp(tripStart), updated_at: stamp(tripEnd),
  };

  const expenses: ExpenseRow[] = [];
  const settlements: SettlementRow[] = [];

  function add(o: {
    date: IsoDate; description: string; amount: number; category: string; payer: UserId; split?: SplitParams;
    kind?: 'expense' | 'money_back'; chapter?: string | null; country?: string; place?: string | null;
    notes?: string | null; tags?: string[]; source?: 'manual' | 'recurring'; recurringId?: string | null;
    original?: { amount: number; currency: string; rate: number }; refundOf?: string | null;
    /** S10: whose it is (a personal regular payment's entry); null: shared. */
    owner?: UserId | null;
  }): ExpenseRow {
    const amount: Pence = pence(o.amount);
    const split: SplitParams = o.split ?? { mode: 'ratio', ratio: { [JAE]: 50, [SAM]: 50 } };
    const { paid, shares } = computeEntry({ amount, payer: o.payer, members: MEMBERS, split });
    const row: ExpenseRow = {
      id: newId(), household_id: DEMO_HOUSEHOLD_ID, kind: o.kind ?? 'expense', description: o.description,
      amount_pence: amount, date: o.date, category_id: cat(o.category), chapter_id: o.chapter ?? null,
      paid: { ...paid }, paid_via: 'person', split_mode: split.mode,
      split_params: split.mode === 'ratio' ? { ...split.ratio } : split.mode === 'exact' ? { ...split.amounts } : null,
      shares: { ...shares }, items: null, bill_total_pence: null, country: o.country ?? 'GB', place: o.place ?? null,
      lat: null, lng: null, original_amount: o.original?.amount ?? null, original_currency: o.original?.currency ?? null,
      fx_rate: o.original?.rate ?? null, notes: o.notes ?? null, tags: o.tags ?? [], receipt_path: null, category_guess: false,
      source: o.source ?? 'manual', external_id: null, merchant: null, external_category: null, account_id: null,
      recurring_id: o.recurringId ?? null, occurrence_date: o.recurringId ? o.date : null, refund_of: o.refundOf ?? null,
      created_by: o.payer, created_at: stamp(o.date), updated_by: o.payer, updated_at: stamp(o.date), deleted_at: null,
      owner_id: o.owner ?? null,
    };
    expenses.push(row);
    return row;
  }

  // Recurring templates: rent (Jae), energy that varies (Sam), two subscriptions and broadband.
  const tmpl = (description: string, amount: number, category: string, payer: UserId, extra: Partial<RecurringRow> = {}): RecurringRow => {
    const { paid, shares } = computeEntry({ amount: pence(amount), payer, members: MEMBERS, split: { mode: 'ratio', ratio: { [JAE]: 50, [SAM]: 50 } } });
    return {
      id: newId(), household_id: DEMO_HOUSEHOLD_ID, description, amount_pence: amount, amount_varies: false,
      category_id: cat(category), paid: { ...paid }, paid_via: 'person', split_mode: 'ratio',
      split_params: { [JAE]: 50, [SAM]: 50 }, shares: { ...shares }, is_subscription: inSubscriptions(category), frequency: 'monthly',
      every: 1, start_date: addDays(start, 2), end_date: null, posted_count: 0, active: true, notes: null,
      created_by: payer, created_at: stamp(start), updated_at: stamp(start), deleted_at: null, ever_posted: false, owner_id: null, ...extra,
    };
  };
  const recurring: RecurringRow[] = [
    tmpl('Rent', 145000, 'Rent & bills', JAE),
    tmpl('Octopus Energy', 9000, 'Utilities', SAM, { amount_varies: true }),
    tmpl('Netflix', 1899, 'Subscriptions', SAM, { start_date: addDays(start, 9) }),
    tmpl('Spotify Duo', 1699, 'Subscriptions', JAE, { start_date: addDays(start, 14) }),
    tmpl('Community Fibre', 2500, 'Utilities', JAE, { start_date: addDays(start, 20) }),
  ];

  const inboxItems: InboxItemRow[] = [];
  const groceries = ['Tesco', 'Sainsbury’s', 'Lidl', 'Waitrose', 'Tesco Express', '이마트', 'Big shop', 'Ocado'];
  const eatingOut = ['Dishoom', 'Pret', 'Wagamama', 'Franco Manca', 'Ramen', 'Pho', 'Honest Burgers', 'Deliveroo'];
  const goingOut = ['Cinema', 'The Royal Oak', 'Barbican', 'Gig tickets', 'Cocktails'];
  const household_ = ['IKEA', 'Argos', 'Robert Dyas', 'Plants', 'Cleaning stuff', 'Dunelm'];

  // Recurring posts on their dates, exactly as post_due_recurring would (energy is answered in the Inbox;
  // the demo shows the answer).
  for (const r of recurring) {
    const payer = Object.entries(r.paid as Record<string, number>).find(([, v]) => v > 0)?.[0] ?? JAE;
    const category = catName(r.category_id);
    const due = dueOccurrences({ frequency: 'monthly', every: 1, startDate: r.start_date, endDate: null }, 0, today);
    due.forEach((date, i) => {
      r.posted_count += 1;
      r.ever_posted = true;
      // Drawn either way, so the rest of the demo's figures stay as they were.
      const amount = r.amount_varies ? between(6200, 13800) : r.amount_pence;
      // S3 (REC-3): the latest bill whose amount varies waits in the Inbox for its amount, as the database leaves it.
      if (r.amount_varies && i === due.length - 1) {
        inboxItems.push({
          id: newId(), household_id: DEMO_HOUSEHOLD_ID, source: 'bill', status: 'open', receipt_path: null,
          payload: { description: r.description, estimate_pence: r.amount_pence, date, category_id: r.category_id },
          recurring_id: r.id, occurrence_date: date, external_id: null, expense_id: null, created_by: null,
          created_at: `${date}T00:05:00.000Z`, updated_at: `${date}T00:05:00.000Z`,
        });
        return;
      }
      add({ date, description: r.description, amount, category, payer, source: 'recurring', recurringId: r.id });
    });
  }

  const JAPAN_CATEGORY: Record<string, string> = {
    'ラーメン': 'Eating out', Izakaya: 'Eating out', Sushi: 'Eating out', Coffee: 'Eating out', Lawson: 'Groceries', Shinkansen: 'Transport',
    'Temple entry': 'Travel',
  };
  const totalDays = daysBetween(start, today);
  for (let i = 0; i <= totalDays; i += 1) {
    const date = addDays(start, i);
    const inTrip = date >= tripStart && date <= tripEnd;
    if (inTrip) {
      const places = ['Tokyo', 'Kyoto', 'Osaka'];
      const place = places[Math.min(2, Math.floor(daysBetween(tripStart, date) / 3))] ?? 'Tokyo';
      const n = between(2, 4);
      for (let j = 0; j < n; j += 1) {
        const yen = between(1200, 9800);
        const rate = 0.0052;
        const description = pick(['ラーメン', 'Lawson', 'Shinkansen', 'Izakaya', 'Temple entry', 'Sushi', 'Coffee']);
        // S9b (demo finding): each thing in its one sensible category. The draw that used to pick a category at
        // random is still made, so every later row of the seed stays as it was.
        pick(['Eating out', 'Eating out', 'Travel', 'Transport']);
        add({ date, description, amount: Math.round(yen * rate * 100), category: JAPAN_CATEGORY[description] ?? 'Travel', payer: pick(MEMBERS), chapter: japan.id, country: 'JP', place, original: { amount: yen, currency: 'JPY', rate } });
      }
      continue;
    }
    if (rand() < 0.3) add({ date, description: pick(groceries), amount: between(1200, 9800), category: 'Groceries', payer: pick(MEMBERS) });
    if (rand() < 0.16) add({ date, description: pick(eatingOut), amount: between(1400, 9200), category: 'Eating out', payer: pick(MEMBERS), split: rand() < 0.12 ? { mode: 'treat' } : undefined });
    if (rand() < 0.1) add({ date, description: pick(['TfL', 'Trainline', 'Uber', 'Parking']), amount: between(300, 6500), category: 'Transport', payer: pick(MEMBERS) });
    if (rand() < 0.05) add({ date, description: pick(goingOut), amount: between(1500, 7800), category: 'Going out', payer: pick(MEMBERS), split: rand() < 0.3 ? { mode: 'ratio', ratio: { [JAE]: 60, [SAM]: 40 } } : undefined });
    if (rand() < 0.04) add({ date, description: pick(household_), amount: between(800, 14900), category: 'Household', payer: pick(MEMBERS) });
    if (rand() < 0.012) add({ date, description: pick(['Haircut', 'New trainers', 'Phone case']), amount: between(1800, 6500), category: 'Other', payer: JAE, split: { mode: 'for_other' }, notes: 'Paid for Sam' });
    if (rand() < 0.01) add({ date, description: pick(['Boots', 'Dentist', 'Specsavers']), amount: between(600, 8500), category: 'Health', payer: pick(MEMBERS) });
    if (rand() < 0.008) add({ date, description: pick(['Birthday present for Mum', 'Wedding gift', 'Flowers']), amount: between(2500, 12000), category: 'Gifts', payer: pick(MEMBERS) });
  }

  // One refund: the IKEA lamp went back.
  const lamp = add({ date: addMonths(today, -2), description: 'IKEA lamp', amount: 4500, category: 'Household', payer: SAM });
  add({ date: addDays(lamp.date, 6), description: 'IKEA lamp refund', amount: 4500, category: 'Household', payer: SAM, kind: 'money_back', refundOf: lamp.id });

  // Settle up roughly monthly, leaving the current month's running balance open.
  let net = 0; // Jae's net position
  expenses.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  let monthEnd = addMonths(start, 1);
  for (const e of expenses) {
    while (e.date >= monthEnd && monthEnd <= addMonths(today, -1)) {
      if (net !== 0) {
        const amount = Math.abs(net);
        const from = net > 0 ? SAM : JAE;
        const to = net > 0 ? JAE : SAM;
        settlements.push({ id: newId(), household_id: DEMO_HOUSEHOLD_ID, from_user: from, to_user: to, amount_pence: amount, date: monthEnd, note: null, method: from === SAM ? 'monzo' : 'other', created_by: from, created_at: stamp(monthEnd), updated_at: stamp(monthEnd), deleted_at: null });
        net = 0;
      }
      monthEnd = addMonths(monthEnd, 1);
    }
    const sign = e.kind === 'money_back' ? -1 : 1;
    const paid = e.paid as Record<string, number>;
    const shares = e.shares as Record<string, number>;
    net += sign * ((paid[JAE] ?? 0) - (shares[JAE] ?? 0));
  }
  expenses.sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));

  // S4a: an open project; the household's furniture spending of the last six weeks belongs to it.
  const sofaStart = addDays(today, -42);
  const sofa: ChapterRow = {
    id: id(9001), household_id: DEMO_HOUSEHOLD_ID, name: 'New sofa', emoji: '🛋️', kind: 'project', country: null,
    start_date: sofaStart, end_date: null, closed: false, created_by: JAE, created_at: stamp(addDays(today, -42)), updated_at: stamp(addDays(today, -42)),
  };
  for (const e of expenses) {
    if (e.chapter_id === null && e.category_id === cat('Household') && e.date >= sofaStart && e.kind === 'expense' && e.source !== 'recurring') e.chapter_id = sofa.id;
  }
  // S5b: a comment thread on last month's biggest grocery shop (the recap's "one moment").
  const lastMonth = addMonths(today, -1).slice(0, 7);
  const shop = expenses.filter((e) => e.date.startsWith(lastMonth) && e.category_id === cat('Groceries') && e.kind === 'expense')
    .sort((a, b) => b.amount_pence - a.amount_pence)[0];
  const comments: CommentRow[] = shop ? [
    { id: id(9101), household_id: DEMO_HOUSEHOLD_ID, expense_id: shop.id, author: SAM, body: 'Was this the big shop for the party?', created_at: stamp(shop.date), deleted_at: null },
    { id: id(9102), household_id: DEMO_HOUSEHOLD_ID, expense_id: shop.id, author: JAE, body: 'Yes, and the wine.', created_at: stamp(shop.date), deleted_at: null },
  ] : [];
  // S10 (REC-9): each person's own regular payments (kept out of every shared figure), posted as the database posts them.
  // Added last, from fixed amounts, so nothing drawn above moves.
  const ownTmpl = (n: number, description: string, amount: number, category: string, owner: UserId, startDay: IsoDate): RecurringRow => ({
    id: id(n), household_id: DEMO_HOUSEHOLD_ID, description, amount_pence: amount, amount_varies: false, category_id: cat(category),
    paid: { [owner]: amount }, paid_via: 'person', split_mode: 'treat', split_params: null, shares: { [owner]: amount },
    is_subscription: inSubscriptions(category), frequency: 'monthly', every: 1, start_date: startDay, end_date: null, posted_count: 0, active: true,
    notes: null, created_by: owner, created_at: stamp(startDay), updated_at: stamp(startDay), deleted_at: null, ever_posted: false, owner_id: owner,
  });
  const own: RecurringRow[] = [
    ownTmpl(9201, 'Climbing wall', 3500, 'Health', JAE, addDays(addMonths(today, -7), -4)),
    ownTmpl(9202, 'Duolingo', 799, 'Subscriptions', JAE, addDays(addMonths(today, -5), -9)),
    ownTmpl(9203, 'Phone contract', 1800, 'Utilities', SAM, addDays(addMonths(today, -8), -12)),
    ownTmpl(9204, 'Audible', 899, 'Subscriptions', SAM, addDays(addMonths(today, -4), -2)),
  ];
  for (const r of own) {
    const owner = r.owner_id ?? JAE;
    for (const date of dueOccurrences({ frequency: 'monthly', every: 1, startDate: r.start_date, endDate: null }, 0, today)) {
      r.posted_count += 1;
      r.ever_posted = true;
      add({ date, description: r.description, amount: r.amount_pence, category: catName(r.category_id),
        payer: owner, split: { mode: 'treat' }, source: 'recurring', recurringId: r.id, owner });
    }
    recurring.push(r);
  }
  expenses.sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));
  return { household, members, categories, chapters: [japan, sofa], recurring, inboxItems, comments, expenses, settlements };
}
