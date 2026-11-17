/**
 * Calendar dates as plain "YYYY-MM-DD" strings (DATA_MODEL §4, SPEC DAT-1). An entry's date is a day, not a
 * moment, so it reads the same on both phones wherever they are. All arithmetic is done on day numbers in
 * UTC, which has no clock changes, so no day is ever missing or doubled (DAT-3). "Now" is always passed in.
 */
export type IsoDate = string;

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(d: IsoDate): [number, number, number] {
  const m = ISO.exec(d);
  if (!m?.[1] || !m[2] || !m[3]) throw new RangeError(`not a date: ${d}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function fromParts(y: number, m: number, day: number): IsoDate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function isIsoDate(s: string): boolean {
  const m = ISO.exec(s);
  if (!m?.[1] || !m[2] || !m[3]) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  return y >= 1000 && mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

function dayNumber(d: IsoDate): number {
  const [y, m, day] = parts(d);
  return Math.round(Date.UTC(y, m - 1, day) / 86_400_000);
}

function fromDayNumber(n: number): IsoDate {
  const t = new Date(n * 86_400_000);
  return fromParts(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** The calendar date at that instant in that time zone (DAT-2: in Japan, Japan's date). */
export function todayIn(now: Date, timeZone: string): IsoDate {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const get = (type: string) => f.formatToParts(now).find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function addDays(d: IsoDate, n: number): IsoDate {
  return fromDayNumber(dayNumber(d) + n);
}

/** Clamps to the month's end: 2026-01-31 + 1 month → 2026-02-28 (PostgreSQL's date + interval does the same). */
export function addMonths(d: IsoDate, n: number): IsoDate {
  const [y, m, day] = parts(d);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12 + 12) % 12 + 1;
  return fromParts(ny, nm, Math.min(day, daysInMonth(ny, nm)));
}

/** 2028-02-29 + 1 year → 2029-02-28. */
export function addYears(d: IsoDate, n: number): IsoDate {
  return addMonths(d, 12 * n);
}

/** b − a in whole days. */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return dayNumber(b) - dayNumber(a);
}

/** Monday = 1 … Sunday = 7 (weeks start on Monday, DAT-3). */
export function weekday(d: IsoDate): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  // Day 0 (1970-01-01) was a Thursday.
  return ((((dayNumber(d) + 3) % 7) + 7) % 7 + 1) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

export function startOfWeek(d: IsoDate): IsoDate {
  return addDays(d, 1 - weekday(d));
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "Today", "Yesterday", "Mon 10 Nov", or "10 Nov 2025" for another year (DESIGN §5). */
export function formatDay(d: IsoDate, today: IsoDate): string {
  const diff = daysBetween(d, today);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  const [y, m, day] = parts(d);
  const [ty] = parts(today);
  const month = MONTHS[m - 1] ?? '';
  if (y !== ty) return `${String(day)} ${month} ${String(y)}`;
  return `${WEEKDAYS[weekday(d) - 1] ?? ''} ${String(day)} ${month}`;
}
