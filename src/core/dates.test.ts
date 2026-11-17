import { describe, it, expect, afterEach } from 'vitest';
import fc from 'fast-check';
import {
  isIsoDate,
  todayIn,
  addDays,
  addMonths,
  addYears,
  daysBetween,
  weekday,
  startOfWeek,
  daysInMonth,
  formatDay,
  type IsoDate,
} from './dates';

const LONDON = 'Europe/London';
const TOKYO = 'Asia/Tokyo';

// ── independent helpers for the properties (UTC arithmetic only) ──
const DAY_MS = 86_400_000;
function isoFromDayNumber(n: number): IsoDate {
  return new Date(n * DAY_MS).toISOString().slice(0, 10);
}
function dayNumber(d: IsoDate): number {
  const [y, m, dd] = d.split('-').map(Number);
  return Date.UTC(y ?? 0, (m ?? 1) - 1, dd ?? 1) / DAY_MS;
}
function ymd(d: IsoDate): [number, number, number] {
  const [y, m, dd] = d.split('-').map(Number);
  return [y ?? 0, m ?? 0, dd ?? 0];
}
function iso(y: number, m: number, d: number): IsoDate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
function refDaysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}
function refAddMonths(d: IsoDate, n: number): IsoDate {
  const [y, m, dd] = ymd(d);
  const total = y * 12 + (m - 1) + n;
  const y2 = Math.floor(total / 12);
  const m2 = total - y2 * 12 + 1;
  return iso(y2, m2, Math.min(dd, refDaysInMonth(y2, m2)));
}

// 1900-01-01 .. 2199-12-31
const MIN_DAY = dayNumber('1900-01-01');
const MAX_DAY = dayNumber('2199-12-31');
const dateArb = fc.integer({ min: MIN_DAY, max: MAX_DAY }).map(isoFromDayNumber);
const nearDateArb = fc.integer({ min: dayNumber('2020-01-01'), max: dayNumber('2040-12-31') }).map(isoFromDayNumber);

// Run date arithmetic under several process time zones: a calendar date must never move with the phone's zone.
const ORIGINAL_TZ = process.env.TZ;
afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});
function inProcessZone(tz: string): void {
  process.env.TZ = tz;
  // Guard: the change must have taken effect, or these tests would prove nothing.
  const offsets: Record<string, number> = { UTC: 0, 'Europe/London': -60, 'Asia/Tokyo': -540, 'America/Los_Angeles': 420, 'Pacific/Auckland': -720 };
  expect(new Date(Date.UTC(2026, 6, 1, 12)).getTimezoneOffset()).toBe(offsets[tz]);
}
const ZONES = ['UTC', 'Europe/London', 'Asia/Tokyo', 'America/Los_Angeles', 'Pacific/Auckland'];

describe('isIsoDate', () => {
  it.each(['2026-11-17', '2026-01-01', '2026-12-31', '2028-02-29', '2000-02-29', '2026-02-28', '2026-04-30', '1999-12-31'])(
    'DAT-3 accepts the real date %s',
    (d) => {
      expect(isIsoDate(d)).toBe(true);
    },
  );
  it.each([
    '2026-02-29',
    '2026-02-30',
    '2026-04-31',
    '2026-13-01',
    '2026-00-10',
    '2026-11-00',
    '2026-11-32',
    '1900-02-29',
    '2100-02-29',
    '2026-1-05',
    '2026-01-5',
    '26-01-05',
    '2026/11/17',
    '17/11/2026',
    '2026-11-17T00:00',
    '2026-11-17Z',
    ' 2026-11-17',
    '2026-11-17 ',
    '２０２６-１１-１７',
    '',
    'today',
  ])('DAT-3 rejects %j', (d) => {
    expect(isIsoDate(d)).toBe(false);
  });

  it('DAT-3 accepts every real calendar day', () => {
    fc.assert(fc.property(dateArb, (d) => isIsoDate(d)));
  });
});

describe('todayIn', () => {
  const moments: [string, string, string, IsoDate][] = [
    // 31 December 23:59 in London (GMT) is already New Year in Tokyo
    ['DAT-4 31 Dec 23:59 London', '2026-12-31T23:59:00Z', LONDON, '2026-12-31'],
    ['DAT-4 31 Dec 23:59:59.999 London', '2026-12-31T23:59:59.999Z', LONDON, '2026-12-31'],
    ['DAT-4 one minute later London', '2027-01-01T00:00:00Z', LONDON, '2027-01-01'],
    ['DAT-4 31 Dec 23:59 London, phone in Tokyo', '2026-12-31T23:59:00Z', TOKYO, '2027-01-01'],
    // 29 February
    ['DAT-4 29 Feb starts in London', '2028-02-29T00:00:00Z', LONDON, '2028-02-29'],
    ['DAT-4 just before 29 Feb in London', '2028-02-28T23:59:59Z', LONDON, '2028-02-28'],
    ['DAT-4 29 Feb starts earlier in Tokyo', '2028-02-28T15:00:00Z', TOKYO, '2028-02-29'],
    ['DAT-4 29 Feb 23:59 London', '2028-02-29T23:59:00Z', LONDON, '2028-02-29'],
    ['DAT-4 29 Feb 23:59 London is 1 Mar in Tokyo', '2028-02-29T23:59:00Z', TOKYO, '2028-03-01'],
    // Clocks go forward: 29 March 2026, 01:00 GMT → 02:00 BST
    ['DAT-4 spring Sunday 00:59 GMT', '2026-03-29T00:59:59Z', LONDON, '2026-03-29'],
    ['DAT-4 spring Sunday 02:00 BST', '2026-03-29T01:00:00Z', LONDON, '2026-03-29'],
    ['DAT-4 spring Sunday 23:59 BST', '2026-03-29T22:59:59Z', LONDON, '2026-03-29'],
    ['DAT-4 spring Monday 00:00 BST', '2026-03-29T23:00:00Z', LONDON, '2026-03-30'],
    ['DAT-4 Saturday before spring change', '2026-03-28T23:59:59Z', LONDON, '2026-03-28'],
    // Clocks go back: 25 October 2026, 02:00 BST → 01:00 GMT
    ['DAT-4 autumn Saturday 23:59 BST', '2026-10-24T22:59:59Z', LONDON, '2026-10-24'],
    ['DAT-4 autumn Sunday 00:00 BST', '2026-10-24T23:00:00Z', LONDON, '2026-10-25'],
    ['DAT-4 autumn Sunday 01:30 BST (first time)', '2026-10-25T00:30:00Z', LONDON, '2026-10-25'],
    ['DAT-4 autumn Sunday 01:30 GMT (second time)', '2026-10-25T01:30:00Z', LONDON, '2026-10-25'],
    ['DAT-4 autumn Sunday 23:59 GMT', '2026-10-25T23:59:59Z', LONDON, '2026-10-25'],
    ['DAT-4 autumn Monday 00:00 GMT', '2026-10-26T00:00:00Z', LONDON, '2026-10-26'],
    // A phone in Tokyo whose date differs from London's
    ['DAT-4 Tokyo is already on the 17th', '2026-11-16T15:30:00Z', TOKYO, '2026-11-17'],
    ['DAT-4 London is still on the 16th', '2026-11-16T15:30:00Z', LONDON, '2026-11-16'],
    ['DAT-4 summer: London in BST after 23:00 UTC', '2026-06-30T23:30:00Z', LONDON, '2026-07-01'],
    ['DAT-4 Tokyo noon', '2026-07-01T03:00:00Z', TOKYO, '2026-07-01'],
  ];
  it.each(moments)('%s', (_name, instant, zone, expected) => {
    expect(todayIn(new Date(instant), zone)).toBe(expected);
  });

  it('DAT-4 DAT-1 the answer depends only on the instant and the zone given, never on the process zone', () => {
    for (const tz of ZONES) {
      inProcessZone(tz);
      expect(todayIn(new Date('2026-12-31T23:59:00Z'), LONDON)).toBe('2026-12-31');
      expect(todayIn(new Date('2026-12-31T23:59:00Z'), TOKYO)).toBe('2027-01-01');
      expect(todayIn(new Date('2026-10-24T23:00:00Z'), LONDON)).toBe('2026-10-25');
      expect(todayIn(new Date('2026-03-29T23:00:00Z'), LONDON)).toBe('2026-03-30');
    }
  });

  it('DAT-3 DAT-4 hour by hour through 2026 in London: no day missing or doubled, 23 and 25 hours on the clock-change Sundays', () => {
    const counts = new Map<IsoDate, number>();
    let prev: IsoDate | null = null;
    const start = Date.UTC(2026, 0, 1, 0, 30);
    const end = Date.UTC(2027, 0, 1, 0, 0);
    for (let t = start; t < end; t += 3_600_000) {
      const d = todayIn(new Date(t), LONDON);
      if (prev !== null && d !== prev) expect(d).toBe(isoFromDayNumber(dayNumber(prev) + 1));
      counts.set(d, (counts.get(d) ?? 0) + 1);
      prev = d;
    }
    expect(counts.size).toBe(365);
    expect(counts.get('2026-03-29')).toBe(23);
    expect(counts.get('2026-10-25')).toBe(25);
    const others = [...counts.entries()].filter(([d]) => d !== '2026-03-29' && d !== '2026-10-25');
    expect(others.every(([, n]) => n === 24)).toBe(true);
  });
});

describe('addDays', () => {
  const cases: [IsoDate, number, IsoDate][] = [
    ['2026-11-17', 0, '2026-11-17'],
    ['2026-11-17', 1, '2026-11-18'],
    ['2026-12-31', 1, '2027-01-01'],
    ['2027-01-01', -1, '2026-12-31'],
    ['2026-02-28', 1, '2026-03-01'],
    ['2028-02-28', 1, '2028-02-29'],
    ['2028-02-29', 1, '2028-03-01'],
    ['2028-03-01', -1, '2028-02-29'],
    ['2026-03-28', 1, '2026-03-29'],
    ['2026-03-28', 2, '2026-03-30'],
    ['2026-03-29', 1, '2026-03-30'],
    ['2026-10-24', 1, '2026-10-25'],
    ['2026-10-25', 1, '2026-10-26'],
    ['2026-10-26', -1, '2026-10-25'],
    ['2026-10-26', -2, '2026-10-24'],
    ['2026-01-01', 365, '2027-01-01'],
    ['2028-01-01', 366, '2029-01-01'],
    ['2026-11-17', -7, '2026-11-10'],
    ['2026-11-17', 3650, '2036-11-14'],
  ];
  it.each(cases)('DAT-3 %s + %i days = %s', (d, n, expected) => {
    expect(addDays(d, n)).toBe(expected);
  });

  it('DAT-3 agrees with UTC day arithmetic for any date and offset', () => {
    fc.assert(
      fc.property(dateArb, fc.integer({ min: -20_000, max: 20_000 }), (d, n) => {
        const want = dayNumber(d) + n;
        fc.pre(want >= MIN_DAY && want <= MAX_DAY);
        expect(addDays(d, n)).toBe(isoFromDayNumber(want));
      }),
    );
  });

  it('DAT-1 DAT-3 gives the same answers whatever the phone\'s zone, across both clock changes', () => {
    for (const tz of ZONES) {
      inProcessZone(tz);
      let d: IsoDate = '2026-01-01';
      for (let i = 0; i < 365; i += 1) {
        const next = addDays(d, 1);
        expect(daysBetween(d, next)).toBe(1);
        d = next;
      }
      expect(d).toBe('2027-01-01');
      expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
      expect(addDays('2026-03-29', -1)).toBe('2026-03-28');
    }
  });
});

describe('daysBetween', () => {
  const cases: [IsoDate, IsoDate, number][] = [
    ['2026-11-17', '2026-11-17', 0],
    ['2026-11-16', '2026-11-17', 1],
    ['2026-11-17', '2026-11-16', -1],
    ['2026-03-28', '2026-03-30', 2],
    ['2026-03-29', '2026-03-30', 1],
    ['2026-10-24', '2026-10-26', 2],
    ['2026-10-25', '2026-10-26', 1],
    ['2026-01-01', '2027-01-01', 365],
    ['2028-01-01', '2029-01-01', 366],
    ['2028-02-28', '2028-03-01', 2],
    ['2026-02-28', '2026-03-01', 1],
    ['2026-12-31', '2027-01-01', 1],
    ['2000-01-01', '2100-01-01', 36_525],
  ];
  it.each(cases)('DAT-3 from %s to %s is %i days', (a, b, n) => {
    expect(daysBetween(a, b)).toBe(n);
  });

  it('DAT-3 is exact and antisymmetric for any two dates, under any process zone', () => {
    for (const tz of ['UTC', 'Europe/London', 'America/Los_Angeles']) {
      inProcessZone(tz);
      fc.assert(
        fc.property(dateArb, dateArb, (a, b) => {
          const n = daysBetween(a, b);
          expect(n).toBe(dayNumber(b) - dayNumber(a));
          expect(daysBetween(b, a)).toBe(-n || 0);
          expect(addDays(a, n)).toBe(b);
        }),
        { numRuns: 200 },
      );
    }
  });
});

describe('addMonths', () => {
  const cases: [IsoDate, number, IsoDate][] = [
    ['2026-01-31', 1, '2026-02-28'],
    ['2028-01-31', 1, '2028-02-29'],
    ['2026-01-31', 2, '2026-03-31'],
    ['2026-01-31', 3, '2026-04-30'],
    ['2026-03-31', -1, '2026-02-28'],
    ['2028-03-31', -1, '2028-02-29'],
    ['2026-05-31', 1, '2026-06-30'],
    ['2026-02-28', 1, '2026-03-28'],
    ['2026-01-30', 1, '2026-02-28'],
    ['2026-01-29', 1, '2026-02-28'],
    ['2028-01-29', 1, '2028-02-29'],
    ['2026-12-15', 1, '2027-01-15'],
    ['2027-01-15', -1, '2026-12-15'],
    ['2026-11-30', 3, '2027-02-28'],
    ['2026-01-15', -13, '2024-12-15'],
    ['2026-11-17', 12, '2027-11-17'],
    ['2026-11-17', 0, '2026-11-17'],
    ['2026-08-31', 1, '2026-09-30'],
    ['2026-10-31', 1, '2026-11-30'],
  ];
  it.each(cases)('DAT-3 %s + %i months = %s (clamped to the month end)', (d, n, expected) => {
    expect(addMonths(d, n)).toBe(expected);
  });

  it('DAT-3 keeps the day when it exists and clamps to the last day when it does not', () => {
    fc.assert(
      fc.property(nearDateArb, fc.integer({ min: -600, max: 600 }), (d, n) => {
        expect(addMonths(d, n)).toBe(refAddMonths(d, n));
      }),
    );
  });
});

describe('addYears', () => {
  const cases: [IsoDate, number, IsoDate][] = [
    ['2028-02-29', 1, '2029-02-28'],
    ['2028-02-29', 4, '2032-02-29'],
    ['2028-02-29', -1, '2027-02-28'],
    ['2028-02-29', -4, '2024-02-29'],
    ['2028-02-29', 72, '2100-02-28'],
    ['2026-12-31', 1, '2027-12-31'],
    ['2026-11-17', 0, '2026-11-17'],
    ['2026-03-01', 2, '2028-03-01'],
  ];
  it.each(cases)('DAT-3 %s + %i years = %s', (d, n, expected) => {
    expect(addYears(d, n)).toBe(expected);
  });

  it('DAT-3 is the same as adding twelve months per year', () => {
    fc.assert(
      fc.property(nearDateArb, fc.integer({ min: -50, max: 50 }), (d, n) => {
        expect(addYears(d, n)).toBe(refAddMonths(d, 12 * n));
      }),
    );
  });
});

describe('weekday and startOfWeek', () => {
  const days: [IsoDate, number][] = [
    ['2026-11-16', 1],
    ['2026-11-17', 2],
    ['2026-11-18', 3],
    ['2026-11-19', 4],
    ['2026-11-20', 5],
    ['2026-11-21', 6],
    ['2026-11-22', 7],
    ['2026-03-29', 7],
    ['2026-10-25', 7],
    ['2027-01-01', 5],
    ['2028-02-29', 2],
  ];
  it.each(days)('DAT-3 %s is weekday %i (Monday = 1)', (d, n) => {
    expect(weekday(d)).toBe(n);
  });

  const weeks: [IsoDate, IsoDate][] = [
    ['2026-11-16', '2026-11-16'],
    ['2026-11-17', '2026-11-16'],
    ['2026-11-22', '2026-11-16'],
    ['2026-11-23', '2026-11-23'],
    ['2026-03-29', '2026-03-23'],
    ['2026-10-25', '2026-10-19'],
    ['2027-01-01', '2026-12-28'],
    ['2028-03-05', '2028-02-28'],
  ];
  it.each(weeks)('DAT-3 the week of %s starts on Monday %s', (d, expected) => {
    expect(startOfWeek(d)).toBe(expected);
  });

  it('DAT-3 weeks start on Monday for any date', () => {
    fc.assert(
      fc.property(dateArb, (d) => {
        fc.pre(dayNumber(d) >= MIN_DAY + 7);
        const s = startOfWeek(d);
        expect(weekday(s)).toBe(1);
        const gap = dayNumber(d) - dayNumber(s);
        expect(gap).toBeGreaterThanOrEqual(0);
        expect(gap).toBeLessThanOrEqual(6);
        expect(weekday(d)).toBe(gap + 1);
      }),
    );
  });

  it('DAT-3 the next day is the next weekday', () => {
    fc.assert(
      fc.property(dateArb, (d) => {
        fc.pre(d !== '2199-12-31');
        expect(weekday(addDays(d, 1))).toBe((weekday(d) % 7) + 1);
      }),
    );
  });
});

describe('daysInMonth', () => {
  const cases: [number, number, number][] = [
    [2026, 1, 31],
    [2026, 2, 28],
    [2028, 2, 29],
    [2000, 2, 29],
    [2100, 2, 28],
    [1900, 2, 28],
    [2026, 4, 30],
    [2026, 6, 30],
    [2026, 9, 30],
    [2026, 11, 30],
    [2026, 12, 31],
    [2026, 7, 31],
  ];
  it.each(cases)('DAT-3 %i-%i has %i days (months numbered from 1)', (y, m, n) => {
    expect(daysInMonth(y, m)).toBe(n);
  });
});

describe('formatDay', () => {
  const cases: [IsoDate, IsoDate, string][] = [
    ['2026-11-17', '2026-11-17', 'Today'],
    ['2026-11-16', '2026-11-17', 'Yesterday'],
    ['2026-11-10', '2026-11-17', 'Tue 10 Nov'],
    ['2026-11-05', '2026-11-17', 'Thu 5 Nov'],
    ['2026-11-25', '2026-11-17', 'Wed 25 Nov'],
    ['2026-01-01', '2026-11-17', 'Thu 1 Jan'],
    ['2026-02-14', '2026-11-17', 'Sat 14 Feb'],
    ['2026-03-29', '2026-11-17', 'Sun 29 Mar'],
    ['2026-04-01', '2026-11-17', 'Wed 1 Apr'],
    ['2026-05-20', '2026-11-17', 'Wed 20 May'],
    ['2026-06-15', '2026-11-17', 'Mon 15 Jun'],
    ['2026-07-04', '2026-11-17', 'Sat 4 Jul'],
    ['2026-08-08', '2026-11-17', 'Sat 8 Aug'],
    ['2026-10-31', '2026-11-17', 'Sat 31 Oct'],
    ['2026-12-25', '2026-11-17', 'Fri 25 Dec'],
    ['2025-11-10', '2026-11-17', '10 Nov 2025'],
    ['2025-11-10', '2025-11-17', 'Mon 10 Nov'],
    // the turn of the year
    ['2026-12-31', '2027-01-01', 'Yesterday'],
    ['2026-12-30', '2027-01-01', '30 Dec 2026'],
    ['2027-01-01', '2027-01-01', 'Today'],
    ['2027-01-05', '2026-12-31', '5 Jan 2027'],
    // leap day and the clock changes
    ['2028-02-29', '2028-03-01', 'Yesterday'],
    ['2028-02-28', '2028-03-01', 'Mon 28 Feb'],
    ['2026-03-29', '2026-03-30', 'Yesterday'],
    ['2026-10-25', '2026-10-26', 'Yesterday'],
    ['2026-10-25', '2026-10-25', 'Today'],
  ];
  it.each(cases)('DAT-1 DAT-3 %s seen on %s reads %j', (d, today, expected) => {
    expect(formatDay(d, today)).toBe(expected);
  });

  it('DAT-1 an entry dated 14 November shows as 14 November on both phones, wherever each phone is', () => {
    const shown = ZONES.map((tz) => {
      inProcessZone(tz);
      return [formatDay('2026-11-14', '2026-11-20'), formatDay('2026-11-14', '2026-11-15'), formatDay('2026-11-14', '2027-02-01')];
    });
    for (const s of shown) expect(s).toEqual(['Sat 14 Nov', 'Yesterday', '14 Nov 2026']);
  });
});
