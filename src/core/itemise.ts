/**
 * Itemise a scanned receipt (S6a; SCAN-2, SCAN-3) and the guards on what the AI read (AI.md §3.1). Pure, exact,
 * integer pence. The discount and the service charge are shared out over every line in proportion to its price
 * (largest remainder, ties to the earlier line), so a line's own figure doesn't depend on which others are ticked;
 * the shared amount is the sum of the ticked lines' figures. All lines ticked: the sum of the lines − discount +
 * service, exactly.
 */
import type { IsoDate } from './dates';
import { parsePrinted, pence, type Pence } from './money';

export interface ReceiptLine { label: string; pence: Pence }

/** `total` split over `weights` in proportion, largest remainder (ties to the earlier one), exact. */
function shareOut(total: number, weights: readonly number[]): number[] {
  if (total === 0 || weights.length === 0) return weights.map(() => 0);
  // Nothing to weigh by (every line £0): shared equally.
  if (weights.every((w) => w <= 0)) return shareOut(total, weights.map(() => 1));
  const sum = weights.reduce((t, w) => t + w, 0);
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

/** SCAN-2: each ticked line's figure after its part of the discount and service (0 when unticked), and their sum. */
export function itemise(items: readonly ReceiptLine[], ticked: readonly boolean[], discount: Pence, service: Pence, tax: Pence = pence(0)): { amount: Pence; perLine: Pence[] } {
  const weights = items.map((l) => Math.max(0, l.pence));
  // A discount can't take off more than the lines come to (each line's part then never exceeds the line).
  const off = shareOut(Math.min(Math.max(0, discount), weights.reduce((t, w) => t + w, 0)), weights);
  const on = shareOut(Math.max(0, service), weights);
  // S6b: tax added on top of the lines (a bill abroad) is shared out the same way as service.
  const taxed = shareOut(Math.max(0, tax), weights);
  // An unticked line is one person's own: it shares nothing (0).
  const perLine = items.map((_l, i) => pence(ticked[i] === true ? Math.max(0, (weights[i] ?? 0) - (off[i] ?? 0) + (on[i] ?? 0) + (taxed[i] ?? 0)) : 0));
  return { amount: pence(perLine.reduce((t, p) => t + p, 0)), perLine };
}

/** SCAN-3: do the lines (− discount + service) make the receipt's total? */
export function checkTotal(items: readonly ReceiptLine[], discount: Pence, service: Pence, total: Pence | null, tax: Pence = pence(0)): { adds: boolean; lines: Pence } {
  const lines = pence(items.reduce((t, l) => t + l.pence, 0) - discount + service + tax);
  return { adds: total !== null && lines === total, lines };
}

export interface ScanRaw {
  merchant: string | null;
  date: string | null;
  currency: string | null;
  total_pence: number | null;
  items: readonly { label: string; pence: number }[];
  discount_pence: number;
  service_pence: number;
  /** S6b: tax added on top of the lines (0 or absent when it is inside the prices, as with UK VAT). */
  tax_pence?: number;
  category: string | null;
  confidence: 'high' | 'medium' | 'low';
}

const isPence = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;

/**
 * The most a scanned amount may be, in whole hundredths of the receipt's own currency (£12.34 is 1234; Rp 1.250.000
 * is 125000000): 10 billion units, so a bill in rupiah, dong or won reads too (the pounds it comes to are held to the
 * app's maximum by the form).
 */
export const MAX_RECEIPT_HUNDREDTHS = 1_000_000_000_000;

/** A scan as a model answers it (core/aiReplies scanModelSchema): amounts as printed text, or as whole hundredths. */
export interface ScanPrinted {
  merchant: string | null;
  date: string | null;
  currency: string | null;
  total_pence?: number | null | undefined;
  total_text?: string | null | undefined;
  items: readonly { label: string; pence?: number | undefined; price_text?: string | null | undefined }[];
  discount_pence?: number | undefined;
  discount_text?: string | null | undefined;
  service_pence?: number | undefined;
  service_text?: string | null | undefined;
  tax_pence?: number | undefined;
  tax_text?: string | null | undefined;
  category: string | null;
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Live eval, 24 Nov (docs/AI.md §3.1): a scan's amounts worked out by code. Each amount the model copied as printed
 * is read with the receipt's currency (money parsePrinted: "60.000" rupiah is 6000000 hundredths, not 6000) and wins
 * over any integer the model gave; printed text that isn't one amount gives no figure (a total of null, a line
 * dropped, no discount), never the model's integer instead. With no printed text, the model's integer is kept (an
 * older prompt). The result has exactly the scan reply's keys (tax only when the model gave it).
 */
export function printedScan(raw: ScanPrinted): ScanRaw {
  const read = (text: string | null | undefined, whole: number | null | undefined): number | null => {
    const p = typeof text === 'string' && text.trim() !== '' ? parsePrinted(text, raw.currency) : whole;
    return isPence(p) && p <= MAX_RECEIPT_HUNDREDTHS ? p : null;
  };
  const items: { label: string; pence: number }[] = [];
  for (const l of raw.items) {
    const p = read(l.price_text, l.pence);
    if (p !== null) items.push({ label: l.label, pence: p });
  }
  const taxed = raw.tax_pence !== undefined || raw.tax_text !== undefined;
  return {
    merchant: raw.merchant,
    date: raw.date,
    currency: raw.currency,
    total_pence: read(raw.total_text, raw.total_pence),
    items,
    discount_pence: read(raw.discount_text, raw.discount_pence) ?? 0,
    service_pence: read(raw.service_text, raw.service_pence) ?? 0,
    ...(taxed ? { tax_pence: read(raw.tax_text, raw.tax_pence) ?? 0 } : {}),
    category: raw.category,
    confidence: raw.confidence,
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function twoYearsBefore(d: IsoDate): IsoDate {
  return `${String(Number(d.slice(0, 4)) - 2)}${d.slice(4)}`;
}

function realDay(s: string): boolean {
  if (!ISO.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/**
 * AI.md §3.1 guards, on the phone, after validation: the same shape, cleaned. Amounts are whole, non-negative
 * hundredths of the receipt's own currency; the date is a real day, not after today and not more than two years
 * before it; the category is one of the household's; labels and the merchant are kept as printed (trimmed); low
 * confidence fills nothing (null).
 */
export function scanGuards(raw: ScanRaw, today: IsoDate, categoryNames: readonly string[]): ScanRaw | null {
  if (raw.confidence === 'low') return null;
  const merchant = typeof raw.merchant === 'string' && raw.merchant.trim() !== '' ? raw.merchant.trim() : null;
  const date = typeof raw.date === 'string' && realDay(raw.date) && raw.date <= today && raw.date >= twoYearsBefore(today) ? raw.date : null;
  return {
    merchant,
    date,
    currency: typeof raw.currency === 'string' && raw.currency.trim() !== '' ? raw.currency.trim() : null,
    total_pence: isPence(raw.total_pence) ? raw.total_pence : null,
    items: raw.items.filter((l) => typeof l.label === 'string' && isPence(l.pence)).map((l) => ({ label: l.label, pence: l.pence })),
    discount_pence: isPence(raw.discount_pence) ? raw.discount_pence : 0,
    service_pence: isPence(raw.service_pence) ? raw.service_pence : 0,
    ...(raw.tax_pence === undefined ? {} : { tax_pence: isPence(raw.tax_pence) ? raw.tax_pence : 0 }),
    category: typeof raw.category === 'string' && categoryNames.includes(raw.category) ? raw.category : null,
    confidence: raw.confidence,
  };
}
