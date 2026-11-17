import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { IsoDate } from './dates';
import { occurrence, dueOccurrences, type Schedule } from './recurring';
import vectorsJson from '../../tests/vectors/recurring.json';

interface RawSchedule {
  frequency: string;
  every: number;
  startDate: string;
  endDate: string | null;
}
interface RecurringVectors {
  occurrence: { name: string; schedule: RawSchedule; k: number; expected: string }[];
  due: { name: string; schedule: RawSchedule; postedCount: number; today: string; expected: string[] }[];
}
const V = vectorsJson as unknown as RecurringVectors;

function toSchedule(s: RawSchedule): Schedule {
  if (s.frequency !== 'weekly' && s.frequency !== 'monthly' && s.frequency !== 'yearly') throw new Error(`bad frequency ${s.frequency}`);
  return { frequency: s.frequency, every: s.every, startDate: s.startDate, endDate: s.endDate };
}

// ── an independent reference, in UTC day numbers, of start + k·step ──
const DAY_MS = 86_400_000;
const dayNumber = (d: IsoDate): number => {
  const [y, m, dd] = d.split('-').map(Number);
  return Date.UTC(y ?? 0, (m ?? 1) - 1, dd ?? 1) / DAY_MS;
};
const fromDayNumber = (n: number): IsoDate => new Date(n * DAY_MS).toISOString().slice(0, 10);
function refOccurrence(s: Schedule, k: number): IsoDate {
  if (s.frequency === 'weekly') return fromDayNumber(dayNumber(s.startDate) + 7 * s.every * k);
  const months = (s.frequency === 'monthly' ? 1 : 12) * s.every * k;
  const [y, m, d] = s.startDate.split('-').map(Number);
  const total = (y ?? 0) * 12 + (m ?? 1) - 1 + months;
  const y2 = Math.floor(total / 12);
  const m2 = total - y2 * 12 + 1;
  const last = new Date(Date.UTC(y2, m2, 0)).getUTCDate();
  return `${String(y2).padStart(4, '0')}-${String(m2).padStart(2, '0')}-${String(Math.min(d ?? 1, last)).padStart(2, '0')}`;
}
function refDue(s: Schedule, posted: number, today: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let k = posted; ; k += 1) {
    const d = refOccurrence(s, k);
    if (d > today || (s.endDate !== null && d > s.endDate)) return out;
    out.push(d);
  }
}

const startArb = fc.integer({ min: dayNumber('1990-01-01'), max: dayNumber('2060-12-31') }).map(fromDayNumber);
// Interesting start days: month ends and leap days, as well as anything.
const trickyStartArb = fc.oneof(
  startArb,
  fc.constantFrom('2026-01-31', '2026-01-30', '2026-01-29', '2028-02-29', '2026-08-31', '2026-12-31', '2026-03-29', '2026-10-25', '2026-03-22'),
);
const scheduleArb: fc.Arbitrary<Schedule> = fc.record({
  frequency: fc.constantFrom<Schedule['frequency']>('weekly', 'monthly', 'yearly'),
  every: fc.oneof(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 52 })),
  startDate: trickyStartArb,
  endDate: fc.constant(null),
});
/** k small enough that the date stays well inside four-digit years. */
const kFor = (s: Schedule): fc.Arbitrary<number> => {
  const perStepMonths = s.frequency === 'weekly' ? s.every / 4 : s.frequency === 'monthly' ? s.every : 12 * s.every;
  return fc.integer({ min: 0, max: Math.max(1, Math.floor(1200 / perStepMonths)) });
};

describe('occurrence', () => {
  it.each(V.occurrence.map((v) => [v.name, v] as const))('REC-2 DAT-3 %s', (_name, v) => {
    expect(occurrence(toSchedule(v.schedule), v.k)).toBe(v.expected);
  });

  it('REC-2 monthly dates anchor to the start: 31 Jan → 28 Feb → 31 Mar, and 29 Feb in a leap year', () => {
    const s: Schedule = { frequency: 'monthly', every: 1, startDate: '2026-01-31', endDate: null };
    expect([0, 1, 2].map((k) => occurrence(s, k))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    const leap: Schedule = { ...s, startDate: '2028-01-31' };
    expect([0, 1, 2].map((k) => occurrence(leap, k))).toEqual(['2028-01-31', '2028-02-29', '2028-03-31']);
  });

  it('REC-2 occurrence 0 is the start date', () => {
    fc.assert(fc.property(scheduleArb, (s) => occurrence(s, 0) === s.startDate));
  });

  it('REC-2 DAT-3 equals start + k·step for any schedule (no month-end drift)', () => {
    fc.assert(
      fc.property(scheduleArb.chain((s) => fc.tuple(fc.constant(s), kFor(s))), ([s, k]) => {
        expect(occurrence(s, k)).toBe(refOccurrence(s, k));
      }),
      { numRuns: 500 },
    );
  });

  it('REC-2 occurrences strictly increase, so none can be doubled', () => {
    fc.assert(
      fc.property(scheduleArb, (s) => {
        let prev = occurrence(s, 0);
        for (let k = 1; k <= 30; k += 1) {
          const d = occurrence(s, k);
          expect(d > prev).toBe(true);
          prev = d;
        }
      }),
    );
  });

  it('REC-2 weekly occurrences are exactly 7·every days apart, across clock changes', () => {
    fc.assert(
      fc.property(startArb, fc.integer({ min: 1, max: 52 }), fc.integer({ min: 0, max: 200 }), (startDate, every, k) => {
        const s: Schedule = { frequency: 'weekly', every, startDate, endDate: null };
        expect(dayNumber(occurrence(s, k + 1)) - dayNumber(occurrence(s, k))).toBe(7 * every);
      }),
    );
  });
});

describe('dueOccurrences', () => {
  it.each(V.due.map((v) => [v.name, v] as const))('REC-2 DAT-3 %s', (_name, v) => {
    expect(dueOccurrences(toSchedule(v.schedule), v.postedCount, v.today)).toEqual(v.expected);
  });

  const withEndArb = scheduleArb.chain((s) =>
    fc.record({
      s: fc.oneof(
        fc.constant(s),
        fc.integer({ min: -40, max: 2000 }).map((n): Schedule => ({ ...s, endDate: fromDayNumber(dayNumber(s.startDate) + n) })),
      ),
      posted: fc.integer({ min: 0, max: 40 }),
      todayOffset: fc.integer({ min: -60, max: 1500 }),
    }),
  );

  it('REC-2 is every occurrence from postedCount on, up to today and the end date', () => {
    fc.assert(
      fc.property(withEndArb, ({ s, posted, todayOffset }) => {
        const today = fromDayNumber(dayNumber(s.startDate) + todayOffset);
        expect(dueOccurrences(s, posted, today)).toEqual(refDue(s, posted, today));
      }),
    );
  });

  it('REC-2 a second phone opening the same day posts nothing more', () => {
    fc.assert(
      fc.property(withEndArb, ({ s, posted, todayOffset }) => {
        const today = fromDayNumber(dayNumber(s.startDate) + todayOffset);
        const first = dueOccurrences(s, posted, today);
        expect(dueOccurrences(s, posted + first.length, today)).toEqual([]);
      }),
    );
  });

  it('DAT-4 REC-2 several years of a household opening the app on random days: no bill missed or doubled', () => {
    fc.assert(
      fc.property(
        fc.array(scheduleArb, { minLength: 1, maxLength: 4 }),
        fc.integer({ min: dayNumber('2026-01-01'), max: dayNumber('2027-12-31') }),
        fc.array(fc.integer({ min: 1, max: 45 }), { minLength: 20, maxLength: 80 }),
        (schedules, firstOpen, gaps) => {
          const bills = schedules.map((s) => ({ ...s, startDate: fromDayNumber(firstOpen - 30 + (dayNumber(s.startDate) % 90)) }));
          const posted = bills.map(() => 0);
          const seen = bills.map((): IsoDate[] => []);
          let day = firstOpen;
          for (const gap of gaps) {
            const today = fromDayNumber(day);
            bills.forEach((s, i) => {
              const due = dueOccurrences(s, posted[i] ?? 0, today);
              for (const d of due) expect(d <= today).toBe(true);
              seen[i]?.push(...due);
              posted[i] = (posted[i] ?? 0) + due.length;
            });
            day += gap;
          }
          const lastOpen = fromDayNumber(day - (gaps.at(-1) ?? 0));
          bills.forEach((s, i) => {
            const all = seen[i] ?? [];
            expect(new Set(all).size).toBe(all.length);
            expect(all).toEqual(refDue(s, 0, lastOpen));
          });
        },
      ),
      { numRuns: 50 },
    );
  });

  it('DAT-4 REC-2 opening every single day for three years gives the same bills as opening once at the end', () => {
    const s: Schedule = { frequency: 'monthly', every: 1, startDate: '2026-01-31', endDate: null };
    const weekly: Schedule = { frequency: 'weekly', every: 1, startDate: '2026-03-22', endDate: '2027-10-31' };
    for (const sched of [s, weekly]) {
      const seen: IsoDate[] = [];
      for (let n = dayNumber('2026-01-01'); n <= dayNumber('2028-12-31'); n += 1) {
        seen.push(...dueOccurrences(sched, seen.length, fromDayNumber(n)));
      }
      expect(seen).toEqual(dueOccurrences(sched, 0, '2028-12-31'));
      expect(new Set(seen).size).toBe(seen.length);
    }
    expect(dueOccurrences(s, 0, '2028-12-31')).toHaveLength(36);
    expect(dueOccurrences(s, 0, '2028-12-31')).toContain('2028-02-29');
  });
});
