/**
 * The add / edit / money-back form's state (ADD-4, ADD-5, SPL-1, MB-1, MB-2), kept as what the person typed
 * and turned into an ExpenseDraft only on Save. Pure, so the form's rules are tested without a screen.
 * Amounts are parsed by core/money; the split maths and the "must add up" check are the data layer's
 * (buildExpense), so the form refuses exactly what the database would.
 */
import { addDays, type IsoDate } from '../../core/dates';
import { foreignToPence } from '../../core/fx';
import { formatPence, formatPlainPounds, parseAmount, pence, type Pence } from '../../core/money';
import { computeEntry, exactRemainder, ratioShares, type SplitParams, type UserId } from '../../core/split';
import type { ExpenseDraft, ExpenseRow } from '../../data';
import { strings } from '../../ui/strings';
import { penceOf, payerOf, shareWords, type Person } from '../shared/words';

export type SplitChoice = 'ratio' | 'exact' | 'for_other' | 'treat';

export interface FormState {
  kind: 'expense' | 'money_back';
  amountText: string;
  description: string;
  categoryId: string | null;
  /** The person picked the category themselves (it then stops following the description, and is learned). */
  categoryTouched: boolean;
  payer: UserId;
  splitMode: SplitChoice;
  /** Each person's percentage (whole numbers summing to 100). */
  ratio: Record<UserId, number>;
  /** Exact amounts as typed. */
  exactText: Record<UserId, string>;
  splitTouched: boolean;
  date: IsoDate;
  notes: string;
  tags: readonly string[];
  refundOf: string | null;
  /**
   * S2 polish Q-F5 (MB-1): money back on an exact-split entry starts as the same proportion. These are the
   * original's shares in pence: while set, the exact amounts follow the amount typed (largest remainder, a
   * tie to whoever got it back, as SPL-3). Typing an exact amount yourself stops it.
   */
  exactFollows?: Record<UserId, number>;
  /** CHP-2: the chapter (null: everyday). Left undefined, a new entry goes into this phone's current chapter. */
  chapterId?: string | null;
  /** PLC-1: country, place and rounded position (undefined: left as they are / this phone's current country). */
  country?: string;
  place?: string | null;
  lat?: number | null;
  lng?: number | null;
  /** PLC-6: paid in another currency: while set, `amountText` is the foreign amount and this holds the rate. */
  foreign?: { currency: string; rateText: string } | null;
  /** S6a: the receipt photo's path; its lines (shared or one person's) and the receipt's own total, when scanned. */
  receiptPath?: string | null;
  items?: readonly { label: string; pence: Pence; shared: boolean }[] | null;
  billTotal?: Pence | null;
}

export function blankForm(opts: { me: UserId; people: readonly Person[]; today: IsoDate; split: SplitParams }): FormState {
  return withSplit(
    {
      kind: 'expense', amountText: '', description: '', categoryId: null, categoryTouched: false, payer: opts.me,
      splitMode: 'ratio', ratio: evenRatio(opts.people), exactText: {}, splitTouched: false, date: opts.today, notes: '', tags: [], refundOf: null,
    },
    opts.split,
    opts.people,
  );
}

function evenRatio(people: readonly Person[]): Record<UserId, number> {
  const [a, b] = people;
  if (!a) return {};
  return b ? { [a.id]: 50, [b.id]: 50 } : { [a.id]: 100 };
}

/** The form showing a split (a remembered one, the default, or the entry's own). */
export function withSplit(s: FormState, split: SplitParams, people: readonly Person[]): FormState {
  switch (split.mode) {
    case 'ratio': {
      const [a, b] = people;
      if (!a || !b) return { ...s, splitMode: 'ratio', ratio: evenRatio(people) };
      const ap = split.ratio[a.id] ?? (split.ratio[b.id] !== undefined ? 100 - (split.ratio[b.id] ?? 50) : 50);
      return { ...s, splitMode: 'ratio', ratio: { [a.id]: ap, [b.id]: 100 - ap } };
    }
    case 'exact': {
      const exactText: Record<UserId, string> = {};
      for (const p of people) exactText[p.id] = formatPlainPounds(split.amounts[p.id] ?? pence(0));
      return { ...s, splitMode: 'exact', exactText };
    }
    case 'for_other':
    case 'treat':
      return { ...s, splitMode: split.mode };
  }
}

/** The form for an existing entry (edit, ACT-5), as the person would have entered it. */
export function formFromRow(row: ExpenseRow, people: readonly Person[], input?: ExpenseDraft): FormState {
  const payer = input?.payer ?? payerOf(row.paid, people) ?? row.created_by ?? people[0]?.id ?? '';
  const base: FormState = {
    kind: row.kind === 'money_back' ? 'money_back' : 'expense',
    amountText: formatPlainPounds(pence(input?.amount ?? row.amount_pence)),
    description: input?.description ?? row.description,
    categoryId: input?.categoryId ?? row.category_id,
    categoryTouched: true,
    payer,
    splitMode: 'ratio',
    ratio: evenRatio(people),
    exactText: {},
    splitTouched: false,
    date: input?.date ?? row.date,
    notes: input?.notes ?? row.notes ?? '',
    tags: input?.tags ?? row.tags,
    refundOf: input?.refundOf ?? row.refund_of,
    chapterId: input?.chapterId !== undefined ? input.chapterId : row.chapter_id,
    country: row.country,
    place: row.place,
    lat: row.lat,
    lng: row.lng,
  };
  if (input) return withSplit(base, input.split, people);
  const mode = row.split_mode;
  if (mode === 'treat' || mode === 'for_other') return { ...base, splitMode: mode };
  if (mode === 'exact') {
    const exactText: Record<UserId, string> = {};
    for (const p of people) exactText[p.id] = formatPlainPounds(penceOf(row.shares, p.id));
    return { ...base, splitMode: 'exact', exactText };
  }
  const params = row.split_params;
  if (params && typeof params === 'object' && !Array.isArray(params)) {
    const ratio: Record<UserId, number> = {};
    for (const [k, v] of Object.entries(params)) if (typeof v === 'number') ratio[k] = v;
    return withSplit(base, { mode: 'ratio', ratio }, people);
  }
  // No parameters stored: read the percentages back from the shares.
  const [a, b] = people;
  if (a && b && row.amount_pence > 0) {
    const ap = Math.round((penceOf(row.shares, a.id) * 100) / row.amount_pence);
    return { ...base, ratio: { [a.id]: ap, [b.id]: 100 - ap } };
  }
  return base;
}

/**
 * MB-2: "Refund this": a money-back entry linked to the original, dated today (the money comes back now,
 * not on the day of the purchase); MB-1 default: the same split, received by whoever paid.
 */
export function refundForm(original: ExpenseRow, people: readonly Person[], today: IsoDate): FormState {
  const f = formFromRow(original, people);
  const back: FormState = { ...f, kind: 'money_back', amountText: '', refundOf: original.id, notes: '', date: today, categoryTouched: true };
  if (back.splitMode !== 'exact' || people.length !== 2) return back;
  // Q-F5: an exact split comes back in the same proportion, worked out as the amount is typed.
  const follows: Record<UserId, number> = {};
  for (const p of people) follows[p.id] = penceOf(original.shares, p.id);
  return followExact({ ...back, exactText: {}, exactFollows: follows });
}

/**
 * Q-F5: while the exact amounts follow a proportion, they are worked out again from the amount typed and
 * who got it back (core/split's largest remainder, ties to that person). Otherwise the form as it is.
 */
export function followExact(s: FormState): FormState {
  const follows = s.exactFollows;
  if (!follows || s.splitMode !== 'exact') return s;
  const amount = parsedAmount(s);
  if (amount === null) return { ...s, exactText: {} };
  let shares;
  try {
    shares = ratioShares(amount, follows, s.payer);
  } catch {
    return s;
  }
  const exactText: Record<UserId, string> = {};
  for (const [id, p] of Object.entries(shares)) exactText[id] = formatPlainPounds(p);
  return { ...s, exactText };
}

/** An exact amount typed by the person: the amounts stop following a proportion (Q-F5). */
export function withExactText(s: FormState, id: UserId, text: string): FormState {
  const next: FormState = { ...s, exactText: { ...s.exactText, [id]: text } };
  delete next.exactFollows;
  return next;
}

/**
 * ADD-7: "Duplicate" and "Same as last time": the same entry, dated today. A copy of money back is money
 * back, refunding the same original (MB-1, MB-3): it moves the balance the way the one copied did.
 */
export function copyForm(original: ExpenseRow, people: readonly Person[], today: IsoDate): FormState {
  // CHP-2: a copy is a new entry: it goes into this phone's current chapter (never a closed one it came from).
  return { ...formFromRow(original, people), date: today, chapterId: undefined };
}

/** What Duplicate saves (the entry page's button and Activity's swipe), or null when it can't be read back. */
export function duplicateDraft(original: ExpenseRow, people: readonly Person[], today: IsoDate): ExpenseDraft | null {
  const r = draftOf(copyForm(original, people, today), people);
  return 'draft' in r ? r.draft : null;
}

/** The amount in pounds: as typed, or (paid in another currency, PLC-6) the foreign amount at the rate, exactly. */
export function parsedAmount(s: FormState): Pence | null {
  if (s.foreign) return foreignToPence(s.amountText, s.foreign.rateText);
  return parseAmount(s.amountText);
}

/** ADD-5: "= £34.50" under the amount when it was typed as a sum. */
export function sumWords(s: FormState): string | null {
  if (!s.amountText.includes('+')) return null;
  const a = parsedAmount(s);
  return a === null ? null : strings.entry.sum(formatPence(a));
}

/** An exact share as typed; empty or a plain zero ("0", "0.00", "0,00") is £0.00 (parseAmount refuses zero for an entry's amount). */
function exactPence(text: string | undefined): Pence | null {
  const t = (text ?? '').trim();
  if (t === '' || /^£?\s*0+([.,]0{1,2})?$/.test(t)) return pence(0);
  return parseAmount(t);
}

/** SPL-1 Exact: the live remainder under the two fields: "£5.00 left to share", "Adds up". */
export function remainderWords(s: FormState, people: readonly Person[]): string | null {
  if (s.splitMode !== 'exact') return null;
  const amount = parsedAmount(s);
  if (amount === null) return null;
  const parts = people.map((p) => exactPence(s.exactText[p.id]));
  if (parts.some((p) => p === null)) return null;
  const left = exactRemainder(amount, parts as Pence[]);
  if (left === 0) return strings.entry.addsUp;
  return left > 0 ? strings.entry.left(formatPence(pence(left))) : strings.entry.over(formatPence(pence(-left)));
}

function splitOf(s: FormState, people: readonly Person[]): SplitParams | null {
  switch (s.splitMode) {
    case 'ratio':
      return { mode: 'ratio', ratio: { ...s.ratio } };
    case 'exact': {
      const amounts: Record<UserId, Pence> = {};
      for (const p of people) {
        const v = exactPence(s.exactText[p.id]);
        if (v === null) return null;
        amounts[p.id] = v;
      }
      return { mode: 'exact', amounts };
    }
    default:
      return { mode: s.splitMode };
  }
}

/** What Save sends to the data layer, or the reasons it can't (in plain words, for the form's alert). */
export function draftOf(s: FormState, people: readonly Person[]): { draft: ExpenseDraft } | { errors: string[] } {
  const amount = parsedAmount(s);
  const errors: string[] = [];
  if (amount === null) errors.push(strings.entry.amountNeeded);
  const split = splitOf(s, people);
  if (split === null) errors.push(strings.entry.amountNeeded);
  if (amount === null || split === null) return { errors };
  return {
    draft: {
      kind: s.kind,
      description: s.description,
      amount,
      date: s.date,
      categoryId: s.categoryId,
      payer: s.payer,
      split,
      notes: s.notes.trim() === '' ? null : s.notes.trim(),
      tags: s.tags,
      refundOf: s.refundOf,
      ...(s.chapterId !== undefined ? { chapterId: s.chapterId } : {}),
      ...(s.country !== undefined ? { country: s.country } : {}),
      ...(s.place !== undefined ? { place: s.place } : {}),
      ...(s.lat !== undefined ? { lat: s.lat } : {}),
      ...(s.lng !== undefined ? { lng: s.lng } : {}),
      ...(s.foreign ? { original: { amount: s.amountText.trim().replace(/,/g, ''), currency: s.foreign.currency, rate: s.foreign.rateText.trim() } } : {}),
      ...(s.receiptPath !== undefined ? { receiptPath: s.receiptPath } : {}),
      ...(s.items !== undefined ? { items: s.items } : {}),
      ...(s.billTotal !== undefined ? { billTotal: s.billTotal } : {}),
    },
  };
}

/** The live line above Save: who paid and each person's part, in words, computed by the core's split. */
export function summaryWords(s: FormState, people: readonly Person[]): string | null {
  const amount = parsedAmount(s);
  const [a, b] = people;
  const split = splitOf(s, people);
  if (amount === null || !a || !b || split === null) return null;
  const payer = people.find((p) => p.id === s.payer);
  const other = people.find((p) => p.id !== s.payer);
  if (!payer || !other) return null;
  let shares;
  try {
    shares = computeEntry({ amount, payer: payer.id, members: [a.id, b.id], split }).shares;
  } catch {
    return null;
  }
  const money = formatPence(amount);
  if (s.kind === 'money_back') return strings.entry.summaryBack(payer.name, money, shareWords(shares, people));
  if (split.mode === 'treat') return strings.entry.summaryTreat(payer.name, money);
  if (split.mode === 'for_other') return strings.entry.summaryFor(payer.name, money, other.name);
  return strings.entry.summaryShares(payer.name, money, shareWords(shares, people));
}

/** Presets for the ratio (SPL-1), as the first person's share: 50/50, 60/40, 70/30 and their reverses. */
export const RATIO_PRESETS = [50, 60, 40, 70, 30] as const;

/**
 * The split choices the Add sheet offers as named chips (S2 polish Q-U5), as the first person's share:
 * "50/50", "Jae 60 · Sam 40", "Jae 40 · Sam 60", "Jae 70 · Sam 30", "Jae 30 · Sam 70" (SPL-1). Anything else is
 * "Other" (the 5 % stepper).
 */
export const SHEET_PRESETS = [50, 60, 40, 70, 30] as const;

/** One step of "Other" (Q-U5): 5 % of the whole, to the next multiple of 5 up or down. */
export const STEP = 5;

/** Q-U5: a person's own share set directly; the other gets the rest. Who paid never changes what it means. */
export function setShareOf(s: FormState, id: UserId, pct: number, people: readonly Person[]): FormState {
  const other = people.find((p) => p.id !== id);
  if (!other) return s;
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  return { ...s, splitMode: 'ratio', ratio: { [id]: p, [other.id]: 100 - p }, splitTouched: true };
}

/** The next "Other" step for a share, more or less (to a multiple of 5, within 0–100). */
export function stepShare(pct: number, direction: 1 | -1): number {
  const next = direction > 0 ? Math.floor(pct / STEP) * STEP + STEP : Math.ceil(pct / STEP) * STEP - STEP;
  return Math.max(0, Math.min(100, next));
}

export function setPayerShare(s: FormState, payerPct: number, people: readonly Person[]): FormState {
  const other = people.find((p) => p.id !== s.payer);
  if (!other) return s;
  const pct = Math.max(0, Math.min(100, Math.round(payerPct)));
  return { ...s, splitMode: 'ratio', ratio: { [s.payer]: pct, [other.id]: 100 - pct }, splitTouched: true };
}

export function yesterdayOf(today: IsoDate): IsoDate {
  return addDays(today, -1);
}
