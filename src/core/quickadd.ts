/**
 * Quick add (SPEC ADD-1, TXT-4): "42.50 tesco" and Enter saves. After the amount, in any order: a category
 * word or prefix, the payer, the split, the date, #tags; the remaining words, in their order and original
 * spelling and in any language, are the description. Command words are English and case-insensitive.
 * Anything not typed is left null for the caller to fill from what the household has taught the app (ADD-3).
 * Never throws.
 */
import type { CategoryRef } from './categorise';
import { addDays, daysInMonth, isIsoDate, weekday, type IsoDate } from './dates';
import { foreignToPence } from './fx';
import { amountProblem, MAX_PENCE, parseAmount, pence, type Pence } from './money';
import type { SplitParams, UserId } from './split';
import { normaliseKey } from './text';

export interface QuickAddContext {
  today: IsoDate;
  me: UserId;
  partner: UserId;
  names: Readonly<Record<UserId, string>>;
  animals: Readonly<Record<UserId, 'cat' | 'dog'>>;
  categories: readonly CategoryRef[];
  /** PLC-6 (S9a): the currency a bare amount is in (core/fx bareAmountCurrency); null or absent: pounds. */
  currency?: string | null;
  /** Pounds per unit of `currency`, as exact text: the day's, or the last one the phone has; null: none known. */
  rate?: string | null;
}

export interface QuickAddReading {
  /** The pounds (abroad: the foreign amount at the rate, exactly as the sheet works it out; 0 while no rate is known). */
  amount: Pence;
  /** PLC-6: the amount as typed in the country's currency (as the sheet stores it), with the rate; null at home. */
  original?: { amount: string; currency: string; rate: string | null } | null;
  description: string;
  categoryId: string | null;
  payer: UserId;
  split: SplitParams | null;
  date: IsoDate;
  tags: string[];
  confident: boolean;
}

const WEEKDAY_WORDS: Readonly<Record<string, 1 | 2 | 3 | 4 | 5 | 6 | 7>> = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7,
};

function parseDateWord(word: string, today: IsoDate): IsoDate | null {
  if (word === 'today') return today;
  if (word === 'yesterday') return addDays(today, -1);
  const wd = WEEKDAY_WORDS[word];
  if (wd !== undefined) {
    // The most recent such day before today ("mon" typed on a Monday means last Monday).
    const back = (weekday(today) - wd + 7) % 7 || 7;
    return addDays(today, -back);
  }
  const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(word);
  if (!m?.[1] || !m[2]) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const ty = Number(today.slice(0, 4));
  const pad = (n: number) => String(n).padStart(2, '0');
  if (m[3] !== undefined) {
    // A two-digit year is this century unless that would be in the future. A date after today is not a date.
    let y = m[3].length === 2 ? Math.floor(ty / 100) * 100 + Number(m[3]) : Number(m[3]);
    if (m[3].length === 2 && `${String(y)}-${pad(month)}-${pad(day)}` > today) y -= 100;
    const d = `${String(y)}-${pad(month)}-${pad(day)}`;
    return isIsoDate(d) && d <= today ? d : null;
  }
  const thisYear = `${String(ty)}-${pad(month)}-${pad(day)}`;
  const lastYear = `${String(ty - 1)}-${pad(month)}-${pad(day)}`;
  if (isIsoDate(thisYear) && thisYear <= today) return thisYear;
  return isIsoDate(lastYear) ? lastYear : null;
}

/**
 * S9a (fix 21): a word shaped like a day and month that no month has ("31/02", "31/04", "32/1"): the day and month,
 * else null. Only for a real month (1–12) and a day past its longest (February: 29).
 */
function impossibleDate(word: string): { day: number; month: number } | null {
  const m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(word);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return day > daysInMonth(2024, month) ? { day, month } : null;
}

/** PLC-6: a bare amount in another currency, as the sheet stores it ("1,200" → "1200"); at most two decimals. */
function foreignAmount(raw: string): string | null {
  const t = raw.normalize('NFKC');
  return /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/u.test(t) ? t.replace(/,/g, '') : null;
}

function ratioWord(word: string): [number, number] | null {
  const m = /^(\d{1,3})\/(\d{1,3})$/.exec(word);
  if (!m?.[1] || !m[2]) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  return a + b === 100 ? [a, b] : null;
}

/** The single category this word names or starts (3+ letters), if exactly one. */
function categoryFor(word: string, categories: readonly CategoryRef[]): string | null {
  if (word.length < 3 || !/\p{L}/u.test(word)) return null;
  const hits = categories.filter((c) => {
    const name = normaliseKey(c.name);
    return name === word || name.startsWith(word) || name.split(/[\s&]+/u).includes(word);
  });
  return hits.length === 1 ? (hits[0]?.id ?? null) : null;
}

export function parseQuickAdd(text: string, ctx: QuickAddContext): QuickAddReading | null {
  try {
    return parse(text, ctx).reading;
  } catch {
    return null;
  }
}

/** S9a (fix 21): why Enter can't save what was typed, for the line under the box. */
export type QuickAddProblem = { kind: 'amount' } | { kind: 'tooLarge'; max: Pence } | { kind: 'noSuchDate'; day: number; month: number };

/** No amount it can read, an amount over the maximum, or a day no month has; null when it reads. */
export function quickAddProblem(text: string, ctx: QuickAddContext): QuickAddProblem | null {
  try {
    return parse(text, ctx).problem;
  } catch {
    return { kind: 'amount' };
  }
}

function parse(text: string, ctx: QuickAddContext): { reading: QuickAddReading | null; problem: QuickAddProblem | null } {
  const tokens = text.normalize('NFC').split(/\s+/u).filter((t) => t !== '');
  const people = [ctx.me, ctx.partner] as const;
  const personFor = (word: string): UserId | null => {
    if (word === 'me' || word === 'i') return ctx.me;
    for (const p of people) {
      // Only names (and me/I) say who paid. "cat" and "dog" are ordinary words (owner, 17 Nov): the people are
      // Jae and Sam, not their animals, and "hot dog stand" or "cat food" must never change the payer.
      if (normaliseKey(ctx.names[p] ?? '') === word) return p;
    }
    return null;
  };

  let amount: Pence | null = null;
  let original: QuickAddReading['original'] = null;
  let tooLarge = false;
  let noDate: { day: number; month: number } | null = null;
  const currency = ctx.currency ?? null;
  let categoryId: string | null = null;
  let payer: UserId | null = null;
  let ratio: [number, number] | null = null;
  let mode: 'ratio' | 'treat' | 'for_other' | null = null;
  let beneficiary: UserId | null = null;
  let forThem = false;
  let date: IsoDate | null = null;
  const tags: string[] = [];
  const words: string[] = [];
  let unsure = false;

  for (let i = 0; i < tokens.length; i += 1) {
    const raw = tokens[i] ?? '';
    const word = normaliseKey(raw);
    const next = normaliseKey(tokens[i + 1] ?? '');

    if (amount === null) {
      // PLC-6: abroad, a bare amount is in the country's currency; one written with "£" is pounds, as at home.
      const foreign = currency !== null && !raw.normalize('NFKC').trimStart().startsWith('£') ? foreignAmount(raw) : null;
      if (foreign !== null && currency !== null) {
        const rate = ctx.rate ?? null;
        const p = rate === null ? pence(0) : foreignToPence(foreign, rate);
        if (p !== null && p <= MAX_PENCE) {
          amount = p;
          original = { amount: foreign, currency, rate };
          // No rate known: never saved as if the number were pounds (Enter opens the sheet).
          if (rate === null) unsure = true;
          continue;
        }
        tooLarge ||= p !== null;
      } else {
        const a = parseAmount(raw);
        if (a !== null) { amount = a; continue; }
        tooLarge ||= amountProblem(raw) === 'tooLarge';
      }
    }
    if (raw.startsWith('#') && raw.length > 1) { tags.push(raw.slice(1)); continue; }
    if (date === null) {
      const d = parseDateWord(word, ctx.today);
      if (d !== null) { date = d; continue; }
      // "31/02": no such day; never a word of the description (the line under the box says so).
      const bad = impossibleDate(word);
      if (bad !== null) { noDate ??= bad; unsure = true; continue; }
    }
    if (mode !== null && (word === 'treat' || ratioWord(word) !== null)) {
      // A second split word ("for sam treat"): kept as words, and the form opens for the person to choose.
      unsure = true;
      words.push(raw);
      continue;
    }
    if (mode !== null && word === 'for' && (next === 'them' || personFor(next) !== null)) {
      // Q-F3: "70/30 for sam", "treat for sam": a second split word. Sam is not the payer; the words stay in
      // the description and the reading is unsure, so Enter opens the form for the person to choose.
      unsure = true;
      words.push(raw, tokens[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (mode === null) {
      const r = ratioWord(word);
      if (r) { mode = 'ratio'; ratio = r; continue; }
      if (word === 'treat') { mode = 'treat'; continue; }
      if (word === 'for') {
        // "for them" means for whoever didn't pay, decided once the payer is known.
        if (next === 'them') { mode = 'for_other'; beneficiary = null; forThem = true; i += 1; continue; }
        const b = personFor(next);
        if (b !== null) { mode = 'for_other'; beneficiary = b; i += 1; continue; }
      }
    }
    if (word === 'paid' && next === 'by') {
      const p = personFor(normaliseKey(tokens[i + 2] ?? ''));
      if (p !== null) {
        if (payer === null) payer = p;
        else if (payer !== p) unsure = true;
        i += 2;
        continue;
      }
    }
    {
      const p = personFor(word);
      const prev = normaliseKey(tokens[i - 1] ?? '');
      // "dinner with Sam": a person word that is part of the words stays in the description, and the reading
      // is marked unsure (the person can fix it; S6 may read it better).
      const partOfWords = p !== null && (prev === 'with' || prev === 'and');
      if (p !== null && !partOfWords) {
        // Person words are commands: the first names the payer; a repeat of the same person is dropped; a
        // different second person is something the grammar can't read.
        if (payer === null) payer = p;
        else if (payer !== p) unsure = true;
        if (next === 'paid') i += 1;
        continue;
      }
      if (partOfWords) unsure = true;
    }
    if (categoryId === null) {
      const c = categoryFor(word, ctx.categories);
      if (c !== null) { categoryId = c; continue; }
    }
    words.push(raw);
  }

  if (amount === null) return { reading: null, problem: tooLarge ? { kind: 'tooLarge', max: MAX_PENCE } : { kind: 'amount' } };

  if (mode === 'for_other' && forThem) {
    beneficiary = (payer ?? ctx.me) === ctx.me ? ctx.partner : ctx.me;
  }
  if (mode === 'for_other' && beneficiary !== null) {
    if (payer === null) payer = beneficiary === ctx.me ? ctx.partner : ctx.me;
    else if (payer === beneficiary) { unsure = true; mode = null; }
  }
  const who = payer ?? ctx.me;
  const other = who === ctx.me ? ctx.partner : ctx.me;
  let split: SplitParams | null = null;
  if (mode === 'ratio' && ratio) split = { mode: 'ratio', ratio: { [who]: ratio[0], [other]: ratio[1] } };
  else if (mode === 'treat') split = { mode: 'treat' };
  else if (mode === 'for_other') split = { mode: 'for_other' };

  // Not typed stays empty: the form shows the category name in its place (ADD-3 leaves filling to the caller).
  const description = words.join(' ');
  if (description === '' && categoryId === null) unsure = true;
  // Leftover numbers or slashes look like something the grammar didn't understand.
  if (words.some((w) => /^[\d.,+/£]+$/u.test(w))) unsure = true;

  const reading: QuickAddReading = { amount, original, description, categoryId, payer: who, split, date: date ?? ctx.today, tags, confident: !unsure };
  return { reading, problem: noDate === null ? null : { kind: 'noSuchDate', ...noDate } };
}
