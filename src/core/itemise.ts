/**
 * Itemise a scanned receipt (S6a; SCAN-2, SCAN-3) and the guards on what the AI read (AI.md §3.1). Pure, exact,
 * integer pence. The discount and the service charge are shared out over every line in proportion to its price
 * (largest remainder, ties to the earlier line), so a line's own figure doesn't depend on which others are ticked;
 * the shared amount is the sum of the ticked lines' figures. All lines ticked: the sum of the lines − discount +
 * service, exactly.
 */
import type { IsoDate } from './dates';
import { pence, type Pence } from './money';

export interface ReceiptLine { label: string; pence: Pence }

/** `total` split over `weights` in proportion, largest remainder (ties to the earlier one), exact. */
function shareOut(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((t, w) => t + w, 0);
  if (total === 0 || sum <= 0) return weights.map(() => 0);
  const big = BigInt(total);
  const bigSum = BigInt(sum);
  const parts = weights.map((w) => (big * BigInt(w)) / bigSum);
  const rems = weights.map((w, i) => ({ i, r: (big * BigInt(w)) % bigSum }));
  let left = total - parts.reduce((t, p) => t + Number(p), 0);
  rems.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  const out = parts.map(Number);
  for (const { i } of rems) {
    if (left <= 0) break;
    out[i] = (out[i] ?? 0) + 1;
    left -= 1;
  }
  return out;
}

/** SCAN-2: each line's figure after discount and service, and the shared amount (the ticked lines). */
export function itemise(items: readonly ReceiptLine[], ticked: readonly boolean[], discount: Pence, service: Pence): { amount: Pence; perLine: Pence[] } {
  const weights = items.map((l) => Math.max(0, l.pence));
  const off = shareOut(Math.max(0, discount), weights);
  const on = shareOut(Math.max(0, service), weights);
  const perLine = items.map((l, i) => pence(Math.max(0, l.pence - (off[i] ?? 0) + (on[i] ?? 0))));
  const amount = pence(perLine.reduce((t, p, i) => t + (ticked[i] === true ? p : 0), 0));
  return { amount, perLine };
}

/** SCAN-3: do the lines (− discount + service) make the receipt's total? */
export function checkTotal(items: readonly ReceiptLine[], discount: Pence, service: Pence, total: Pence): { adds: boolean; lines: Pence } {
  const lines = pence(items.reduce((t, l) => t + l.pence, 0) - discount + service);
  return { adds: lines === total, lines };
}

export interface ScanRaw {
  merchant: string | null;
  date: string | null;
  currency: string | null;
  total_pence: number | null;
  items: readonly { label: string; pence: number }[];
  discount_pence: number;
  service_pence: number;
  category: string | null;
  confidence: 'high' | 'medium' | 'low';
}

export interface ScanResult {
  merchant: string | null;
  date: IsoDate | null;
  currency: string | null;
  total: Pence | null;
  items: ReceiptLine[];
  discount: Pence;
  service: Pence;
  category: string | null;
}

const isPence = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function twoYearsBefore(d: IsoDate): IsoDate {
  return `${String(Number(d.slice(0, 4)) - 2)}${d.slice(4)}`;
}

/**
 * AI.md §3.1 guards: amounts are non-negative whole pence; the date is a real day, not after today and not more
 * than two years before it; the category is one of the household's; low confidence fills nothing (null).
 */
export function scanGuards(raw: ScanRaw, today: IsoDate, categoryNames: readonly string[]): ScanResult | null {
  if (raw.confidence === 'low') return null;
  const realDay = (s: string) => ISO.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
  const date = raw.date !== null && realDay(raw.date) && raw.date <= today && raw.date >= twoYearsBefore(today) ? raw.date : null;
  const items = raw.items.filter((l) => typeof l.label === 'string' && l.label.trim() !== '' && isPence(l.pence))
    .map((l) => ({ label: l.label.trim(), pence: pence(l.pence) }));
  const currency = raw.currency !== null && /^[A-Z]{3}$/.test(raw.currency) ? raw.currency : null;
  const merchant = raw.merchant !== null && raw.merchant.trim() !== '' ? raw.merchant.trim().slice(0, 120) : null;
  return {
    merchant,
    date,
    currency,
    total: isPence(raw.total_pence) ? pence(raw.total_pence) : null,
    items,
    discount: pence(isPence(raw.discount_pence) ? raw.discount_pence : 0),
    service: pence(isPence(raw.service_pence) ? raw.service_pence : 0),
    category: raw.category !== null && categoryNames.includes(raw.category) ? raw.category : null,
  };
}
