/**
 * Paid in another currency (S4b; PLC-6, DATA_MODEL "Other currency"): one currency of account, GBP. A foreign
 * amount and the day's rate (pounds per unit) give the pounds stored, worked out once and exactly:
 * amount_pence = round(original × rate × 100), halves up, on decimal strings (never floats). The original and the
 * rate are kept for reference only. Also the country → currency table and rounding a position to about 100 m.
 */
import { pence, type Pence } from './money';

/** ISO 3166-1 alpha-2 → ISO 4217, for the currencies a trip is likely to use (others: null, the helper is not offered). */
const CURRENCY: Readonly<Record<string, string>> = {
  GB: 'GBP', IM: 'GBP', JE: 'GBP', GG: 'GBP', GI: 'GIP',
  // the euro area and countries using the euro
  AT: 'EUR', BE: 'EUR', HR: 'EUR', CY: 'EUR', EE: 'EUR', FI: 'EUR', FR: 'EUR', DE: 'EUR', GR: 'EUR', IE: 'EUR', IT: 'EUR', LV: 'EUR',
  LT: 'EUR', LU: 'EUR', MT: 'EUR', NL: 'EUR', PT: 'EUR', SK: 'EUR', SI: 'EUR', ES: 'EUR', AD: 'EUR', MC: 'EUR', SM: 'EUR', VA: 'EUR',
  ME: 'EUR', XK: 'EUR', BG: 'EUR',
  US: 'USD', PR: 'USD', EC: 'USD', SV: 'USD', PA: 'USD',
  JP: 'JPY', KR: 'KRW', CN: 'CNY', HK: 'HKD', MO: 'MOP', TW: 'TWD', SG: 'SGD', MY: 'MYR', TH: 'THB', VN: 'VND', ID: 'IDR', PH: 'PHP',
  IN: 'INR', LK: 'LKR', NP: 'NPR', AE: 'AED', QA: 'QAR', SA: 'SAR', IL: 'ILS', TR: 'TRY', EG: 'EGP', MA: 'MAD', ZA: 'ZAR', KE: 'KES',
  AU: 'AUD', NZ: 'NZD', CA: 'CAD', MX: 'MXN', BR: 'BRL', AR: 'ARS', CL: 'CLP', CO: 'COP', PE: 'PEN',
  CH: 'CHF', LI: 'CHF', NO: 'NOK', SE: 'SEK', DK: 'DKK', IS: 'ISK', PL: 'PLN', CZ: 'CZK', HU: 'HUF', RO: 'RON', RS: 'RSD',
  AL: 'ALL', BA: 'BAM', MK: 'MKD', GE: 'GEL', AM: 'AMD', UA: 'UAH', MD: 'MDL',
};

export function currencyOf(country: string | null | undefined): string | null {
  if (!country) return null;
  return CURRENCY[country.toUpperCase()] ?? null;
}

/** "1,200.50" → { digits: 120050n, scale: 2 }; null for anything that isn't a positive decimal. */
function decimal(text: string): { digits: bigint; scale: number } | null {
  const t = text.trim().replace(/,/g, '');
  const m = /^(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m) return null;
  const whole = m[1] ?? '0';
  const frac = m[2] ?? '';
  if (frac.length > 12 || whole.length > 15) return null;
  const digits = BigInt(whole + frac);
  return digits > 0n ? { digits, scale: frac.length } : null;
}

/** PLC-6: the pounds (in pence) for a foreign amount at a rate (pounds per unit), halves up; null if either won't read. */
export function foreignToPence(originalText: string, rateText: string): Pence | null {
  const a = decimal(originalText);
  const r = decimal(rateText);
  if (!a || !r) return null;
  // a × r × 100 = (a.digits × r.digits × 100) / 10^(a.scale + r.scale)
  const num = a.digits * r.digits * 100n;
  const den = 10n ** BigInt(a.scale + r.scale);
  const p = (2n * num + den) / (2n * den);
  if (p <= 0n || p > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return pence(Number(p));
}

/** "¥1,200", "€12.50", "$3.99" (en-GB). */
export function formatForeign(amount: number | string, currency: string): string {
  const n = typeof amount === 'number' ? amount : Number(amount.replace(/,/g, ''));
  try {
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).format(n);
  } catch {
    return `${currency} ${typeof amount === "string" ? amount : String(amount)}`;
  }
}

/** PLC-1: a position rounded to 3 decimal places (about 100 m), so no exact location is ever kept. */
export function roundPosition(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** "¥", "€", "$" (en-GB narrow symbol), for the amount field while paying in that currency. */
export function currencySymbol(currency: string): string {
  try {
    const part = new Intl.NumberFormat('en-GB', { style: 'currency', currency, currencyDisplay: 'narrowSymbol' }).formatToParts(0).find((p) => p.type === 'currency');
    return part?.value ?? currency;
  } catch {
    return currency;
  }
}
