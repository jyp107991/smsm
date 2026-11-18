/**
 * Money is integer pence (DATA_MODEL §3). This is the only module where decimals appear: parsing what a
 * person typed and formatting for display. Everything else passes `Pence` around and adds integers.
 */
export type Pence = number & { readonly __brand: 'Pence' };

const MAX_PENCE = 100_000_000; // £1,000,000: anything larger is almost certainly a typo

export function pence(n: number): Pence {
  if (!Number.isSafeInteger(n)) throw new RangeError(`not a whole number of pence: ${String(n)}`);
  return n as Pence;
}

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
  let total = 0;
  for (const term of text.normalize('NFKC').split('+')) {
    const p = parseTerm(term);
    if (p === null) return null;
    total += p;
  }
  return total > 0 && total <= MAX_PENCE ? pence(total) : null;
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
