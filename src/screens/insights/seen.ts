/**
 * What this phone has opened (S5b review): the latest finished month's recap, the latest year in review, and the
 * month whose settle-day recap was opened. Each only moves forward, so opening an older recap never brings a newer
 * banner back, and opening the month so far never hides that month's finished recap later.
 */
const RECAP = 'smsm-recap-seen';
const SETTLE = 'smsm-settle-seen';
const YEAR = 'smsm-year-seen';

export function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function write(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* offered again next time */ }
}
function forward(key: string, value: string): void {
  const was = read(key);
  if (was === null || was < value) write(key, value);
}

export function markRecapSeen(month: string, soFar: boolean): void {
  if (soFar) write(SETTLE, month);
  else forward(RECAP, month);
}
export function recapSeen(month: string): boolean { const s = read(RECAP); return s !== null && s >= month; }
export function settleSeen(month: string): boolean { return read(SETTLE) === month; }
export function markYearSeen(year: number | string): void { forward(YEAR, String(year)); }
export function yearSeen(year: string): boolean { const s = read(YEAR); return s !== null && s >= year; }
