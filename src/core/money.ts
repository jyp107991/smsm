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

/** One term: "42", "42.5", "42.50", "1,200", "£1,200.99" (spaces allowed after £). Pence, or null. */
function parseTerm(term: string): number | null {
  // Thousands separators only in proper groups of three.
  const m = /^\s*£?\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*$/.exec(term);
  if (!m?.[1]) return null;
  const frac = m[2] === undefined ? 0 : Number(m[2].padEnd(2, '0'));
  return Number(m[1].replace(/,/g, '')) * 100 + frac;
}

/**
 * What a person typed as an amount, in pence: "42.5", "£42.50", "1,200", sums like "12+8.50" (ADD-5).
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
