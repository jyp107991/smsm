/**
 * Quick add (SPEC ADD-1, TXT-4): "42.50 tesco" and Enter saves. After the amount, in any order: a category
 * word or prefix, the payer, the split, the date, #tags; the remaining words, in their order and original
 * spelling and in any language, are the description. Command words are English and case-insensitive.
 * Anything not typed is left null for the caller to fill from what the household has taught the app (ADD-3).
 * Never throws.
 */
import type { CategoryRef } from './categorise';
import { addDays, isIsoDate, weekday, type IsoDate } from './dates';
import { parseAmount, type Pence } from './money';
import type { SplitParams, UserId } from './split';
import { normaliseKey } from './text';

export interface QuickAddContext {
  today: IsoDate;
  me: UserId;
  partner: UserId;
  names: Readonly<Record<UserId, string>>;
  animals: Readonly<Record<UserId, 'cat' | 'dog'>>;
  categories: readonly CategoryRef[];
}

export interface QuickAddReading {
  amount: Pence;
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
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = `${String(y)}-${pad(month)}-${pad(day)}`;
    return isIsoDate(d) ? d : null;
  }
  const thisYear = `${String(ty)}-${pad(month)}-${pad(day)}`;
  const lastYear = `${String(ty - 1)}-${pad(month)}-${pad(day)}`;
  if (isIsoDate(thisYear) && thisYear <= today) return thisYear;
  return isIsoDate(lastYear) ? lastYear : null;
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
    return parse(text, ctx);
  } catch {
    return null;
  }
}

function parse(text: string, ctx: QuickAddContext): QuickAddReading | null {
  const tokens = text.normalize('NFC').split(/\s+/u).filter((t) => t !== '');
  const people = [ctx.me, ctx.partner] as const;
  const personFor = (word: string): UserId | null => {
    if (word === 'me' || word === 'i') return ctx.me;
    for (const p of people) {
      if (normaliseKey(ctx.names[p] ?? '') === word) return p;
      if (ctx.animals[p] === word) return p;
    }
    return null;
  };

  let amount: Pence | null = null;
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
      const a = parseAmount(raw);
      if (a !== null) { amount = a; continue; }
    }
    if (raw.startsWith('#') && raw.length > 1) { tags.push(raw.slice(1)); continue; }
    if (date === null) {
      const d = parseDateWord(word, ctx.today);
      if (d !== null) { date = d; continue; }
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
    {
      // Person words are commands: the first names the payer; a repeat of the same person is dropped; a
      // different second person is something the grammar can't read.
      const p = personFor(word);
      if (p !== null) {
        if (payer === null) payer = p;
        else if (payer !== p) unsure = true;
        if (next === 'paid') i += 1;
        continue;
      }
    }
    if (categoryId === null) {
      const c = categoryFor(word, ctx.categories);
      if (c !== null) { categoryId = c; continue; }
    }
    words.push(raw);
  }

  if (amount === null) return null;

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

  return { amount, description, categoryId, payer: who, split, date: date ?? ctx.today, tags, confident: !unsure };
}
