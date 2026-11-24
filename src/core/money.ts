/**
 * Money is integer pence (DATA_MODEL §3). This is the only module where decimals appear: parsing what a
 * person typed and formatting for display. Everything else passes `Pence` around and adds integers.
 */
export type Pence = number & { readonly __brand: 'Pence' };

export function pence(n: number): Pence {
  if (!Number.isSafeInteger(n)) throw new RangeError(`not a whole number of pence: ${String(n)}`);
  return n as Pence;
}

/** The app's maximum amount, £1,000,000.00: anything larger is almost certainly a typo (S9a: one figure, named in words). */
export const MAX_PENCE: Pence = pence(100_000_000);

export function sumPence(xs: readonly Pence[]): Pence {
  let total = 0;
  for (const x of xs) total += x;
  return pence(total);
}

/**
 * One term: "42", "42.5", "42.50", "1,200", "£1,200.99", "42,50" (spaces allowed after £). Pence, or null.
 * A comma followed by exactly two digits is a decimal comma ("42,50" is £42.50, as many keyboards type it);
 * a comma followed by groups of three is thousands ("1,200" is twelve hundred). S2 polish Q-U3.
 */
function parseTerm(term: string): number | null {
  const comma = /^\s*£?\s*(\d+),(\d{2})\s*$/.exec(term);
  if (comma?.[1] && comma[2]) return Number(comma[1]) * 100 + Number(comma[2]);
  // Thousands separators only in proper groups of three.
  const m = /^\s*£?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*$/.exec(term);
  if (!m?.[1]) return null;
  const frac = m[2] === undefined ? 0 : Number(m[2].padEnd(2, '0'));
  return Number(m[1].replace(/,/g, '')) * 100 + frac;
}

/**
 * What a person typed as an amount, in pence: "42.5", "£42.50", "42,50", "1,200", sums like "12+8.50" (ADD-5).
 * NFKC turns full-width digits and signs (as typed on Japanese and Korean keyboards) into ordinary ones.
 * Zero, negatives, more than two decimals, junk and amounts above £1,000,000 give null.
 */
export function parseAmount(text: string): Pence | null {
  const total = termsTotal(text);
  return total !== null && total > 0 && total <= MAX_PENCE ? pence(total) : null;
}

/** Every term read and added (no limit), or null when one doesn't read. */
function termsTotal(text: string): number | null {
  let total = 0;
  for (const term of text.normalize('NFKC').split('+')) {
    const p = parseTerm(term);
    if (p === null) return null;
    total += p;
  }
  return total;
}

/**
 * PLC-6 (S9a review): an amount in another currency, read by the same grammar as parseAmount (a decimal comma, "+"
 * sums, thousands in groups of three, at most two decimals, full-width digits) but never with "£" and with no pounds
 * limit (the pounds it comes to are the caller's to hold to MAX_PENCE). The exact amount as plain text, as the sheet
 * stores it: "12,50" → "12.50", "1000+500" → "1500", "1,200" → "1200"; null when it doesn't read.
 */
export function parseForeignAmount(text: string): string | null {
  if (text.normalize('NFKC').includes('£')) return null;
  const total = termsTotal(text);
  if (total === null || total <= 0 || !Number.isSafeInteger(total)) return null;
  const whole = String(Math.floor(total / 100));
  const rest = total % 100;
  return rest === 0 ? whole : `${whole}.${String(rest).padStart(2, '0')}`;
}

/**
 * S9a (ADD-1, ADD-5): why an amount field's text is not an amount, the same for the sheet and quick add: null when
 * parseAmount reads it; 'empty' for blank; 'tooLarge' for a well-formed amount (or sum) above MAX_PENCE; else 'unreadable'.
 */
export function amountProblem(text: string): 'empty' | 'unreadable' | 'tooLarge' | null {
  if (text.trim() === '') return 'empty';
  if (parseAmount(text) !== null) return null;
  const total = termsTotal(text);
  return total !== null && total > MAX_PENCE ? 'tooLarge' : 'unreadable';
}

/** ISO 4217 currencies written with three decimals (a single mark before three digits is their decimal point). */
const THREE_DECIMALS: ReadonlySet<string> = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

/** Digits with the marks printed inside an amount: "." "," "'" "’" and spaces (NFKC makes no-break spaces plain). */
const PRINTED_RUN = /\d[\d.,'’ ]*\d|\d/gu;

/**
 * Live eval, 24 Nov (docs/AI.md §3.1): an amount as a receipt prints it, in whole hundredths of the receipt's currency
 * (the unit of the scan reply: £12.34 is 1234, ¥648 is 64800, Rp 60.000 is 6000000). The text must hold one number;
 * symbols, codes, signs and brackets round it are ignored (the caller knows a discount from a total). Which mark is
 * the decimal point:
 * - both "." and "," appear: the last one; the other groups thousands;
 * - one mark, used once, before exactly three digits: it groups thousands ("60.000", "377,859"), except in a
 *   three-decimal currency (KWD "1.250") or where no group can start ("0.500"), where it is the decimal point;
 * - one mark before one or two digits: the decimal point ("12.5", "12,50"); used more than once: thousands;
 * - spaces and apostrophes only group ("1 234,56", "1'234.50").
 * Groups after the first are exactly three digits; digits past hundredths must be zeros. Anything else is null.
 */
export function parsePrinted(text: string, currency: string | null): number | null {
  const t = text.normalize('NFKC');
  const runs = [...t.matchAll(PRINTED_RUN)];
  const [run, ...more] = runs;
  if (!run || more.length > 0) return null;
  // ".50" or "-,5": a decimal part with no whole number before it.
  if (/(^|[\s+\-−(])[.,]$/u.test(t.slice(0, run.index))) return null;
  const r = run[0];
  const three = currency !== null && THREE_DECIMALS.has(currency.trim().toUpperCase());
  const dot = r.lastIndexOf('.');
  const comma = r.lastIndexOf(',');
  const last = Math.max(dot, comma);
  /** Where the decimal point is, or null when every mark groups thousands. */
  const decimalAt = (): number | null => {
    if (last < 0) return null;
    if (dot >= 0 && comma >= 0) return last; // both marks: the last one
    if (r.indexOf(r.charAt(last)) !== last) return null; // the same mark more than once groups thousands
    if (r.length - last - 1 !== 3 || three) return last;
    return /^0[.,]/u.test(r) ? last : null; // "0.500": no group starts with a lone 0
  };
  const at = decimalAt();
  const whole = at === null ? r : r.slice(0, at);
  const frac = at === null ? '' : r.slice(at + 1);
  // At most three decimals, and a third only when it is 0 (no fraction of a hundredth).
  if (!/^\d{0,3}$/u.test(frac) || (frac.length === 3 && !frac.endsWith('0'))) return null;
  // The whole part: one group, or groups of three after a first of one to three digits (not a lone 0). A second kind of
  // mark ends up inside a group, which then isn't three digits.
  const mark = /\D/u.exec(whole)?.[0];
  const groups = mark === undefined ? [whole] : whole.split(mark);
  const [first, ...rest] = groups;
  if (rest.length > 0 && (!/^\d{1,3}$/u.test(first ?? '') || first === '0' || rest.some((g) => !/^\d{3}$/u.test(g)))) return null;
  const units = Number(groups.join(''));
  const hundredths = units * 100 + Number(frac.slice(0, 2).padEnd(2, '0'));
  return Number.isSafeInteger(hundredths) ? hundredths : null;
}

const grouped = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 0, useGrouping: true });

/** 4250 → "£42.50"; 120000 → "£1,200.00"; −500 → "−£5.00" (a true minus sign). Pence are always shown. */
export function formatPence(p: Pence): string {
  const abs = Math.abs(p);
  const pounds = Math.floor(abs / 100);
  const rest = abs % 100;
  const body = `£${grouped.format(pounds)}.${String(rest).padStart(2, '0')}`;
  return p < 0 ? `−${body}` : body;
}

/**
 * 4250 → "42.50", 1000 → "10.00": pounds and pence with no sign or grouping, for an amount field to start
 * from and for a monzo.me link (SET-2). Only for zero or more.
 */
export function formatPlainPounds(p: Pence): string {
  if (!Number.isSafeInteger(p) || p < 0) throw new RangeError(`not a plain amount of pence: ${String(p)}`);
  return `${String(Math.floor(p / 100))}.${String(p % 100).padStart(2, '0')}`;
}

/**
 * S7 (IMP-1): an amount as a bank statement writes it, signed, in pence: "-12.50", "−12.5", "£1,234.56",
 * "(12.50)" (brackets mean negative), "+3", "12" — at most two decimals, at most £1,000,000 either way.
 * Zero is allowed (the caller decides what it means); junk gives null.
 */
export function parseStatementAmount(text: string): number | null {
  // Every "£" and space goes, wherever it is ("£ 1 234.00", "-£5").
  let s = text.normalize('NFKC').replace(/[£\s]/gu, '');
  let sign = 1;
  const bracket = /^\((.*)\)$/u.exec(s);
  if (bracket) { sign = -1; s = bracket[1] ?? ''; }
  if (/^[-−]/u.test(s)) { sign = -sign; s = s.slice(1); } else if (s.startsWith('+')) s = s.slice(1);
  const m = /^(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/u.exec(s) ?? /^()\.(\d{1,2})$/u.exec(s);
  if (!m) return null;
  const whole = m[1] ? Number(m[1].replace(/,/g, '')) : 0;
  const frac = m[2] === undefined ? 0 : Number(m[2].padEnd(2, '0'));
  const total = whole * 100 + frac;
  if (!Number.isSafeInteger(total) || total > MAX_PENCE) return null;
  return total === 0 ? 0 : sign * total;
}
