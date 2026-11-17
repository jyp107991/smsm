/**
 * The add / edit / money-back form's state (ADD-4, ADD-5, SPL-1, MB-1, MB-2), kept as what the person typed
 * and turned into an ExpenseDraft only on Save. Pure, so the form's rules are tested without a screen.
 * Amounts are parsed by core/money; the split maths and the "must add up" check are the data layer's
 * (buildExpense), so the form refuses exactly what the database would.
 */
import { addDays, type IsoDate } from '../../core/dates';
import { formatPence, formatPlainPounds, parseAmount, pence, type Pence } from '../../core/money';
import { computeEntry, exactRemainder, type SplitParams, type UserId } from '../../core/split';
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

/** MB-2: "Refund this": a money-back entry linked to the original; MB-1 default: the same split, received by whoever paid. */
export function refundForm(original: ExpenseRow, people: readonly Person[]): FormState {
  const f = formFromRow(original, people);
  return { ...f, kind: 'money_back', amountText: '', refundOf: original.id, notes: '', date: f.date, categoryTouched: true };
}

/** ADD-7: "Duplicate" and "Same as last time": the same entry, dated today. */
export function copyForm(original: ExpenseRow, people: readonly Person[], today: IsoDate): FormState {
  return { ...formFromRow(original, people), date: today, refundOf: null, kind: 'expense' };
}

export function parsedAmount(s: FormState): Pence | null {
  return parseAmount(s.amountText);
}

/** ADD-5: "= £34.50" under the amount when it was typed as a sum. */
export function sumWords(s: FormState): string | null {
  if (!s.amountText.includes('+')) return null;
  const a = parsedAmount(s);
  return a === null ? null : strings.entry.sum(formatPence(a));
}

/** An exact share as typed; empty or a plain zero is £0.00 (parseAmount refuses zero for an entry's amount). */
function exactPence(text: string | undefined): Pence | null {
  const t = (text ?? '').trim();
  if (t === '' || /^£?\s*0+(\.0{1,2})?$/.test(t)) return pence(0);
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

/** Presets for the ratio (SPL-1), from the payer's side: 50/50, 60/40, 70/30 and their reverses. */
export const RATIO_PRESETS = [50, 60, 70, 40, 30] as const;

export function setPayerShare(s: FormState, payerPct: number, people: readonly Person[]): FormState {
  const other = people.find((p) => p.id !== s.payer);
  if (!other) return s;
  const pct = Math.max(0, Math.min(100, Math.round(payerPct)));
  return { ...s, splitMode: 'ratio', ratio: { [s.payer]: pct, [other.id]: 100 - pct }, splitTouched: true };
}

export function yesterdayOf(today: IsoDate): IsoDate {
  return addDays(today, -1);
}
