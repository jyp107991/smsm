/**
 * The recap's AI wording (S6b; INS-2, docs/AI.md §3.4): what the `recap` task is sent, and the guard every reply
 * passes before it is shown. Code computes, the AI only phrases: every number in its sentences must be one of the
 * month's own figures, it gives no advice and judges no one, and the people are only "A" and "B" until the phone puts
 * the names back. Pure: no I/O, no clock.
 */
import { formatPence, type Pence } from './money';
import type { Recap } from './recap';
import type { UserId } from './split';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export interface RecapStats {
  period: string;
  month: string;
  total: string;
  everyday: string;
  usual: string | null;
  comparison: { direction: 'less' | 'more' | 'same'; amount: string | null } | null;
  bar: { name: string; total: string }[];
  notes: string[];
  paid: { A: string; B: string };
}

export interface Wording { headline: string; aside: string | null }

const wholePounds = (p: Pence) => `£${(p / 100).toLocaleString('en-GB', { maximumFractionDigits: 0 })}`;

/** AI.md rule 4: the month's aggregate figures only, as the app shows them; people as "A" (people[0]) and "B". */
export function recapStats(recap: Recap, people: readonly [UserId, UserId]): RecapStats {
  const [a, b] = people;
  return {
    period: recap.month,
    month: MONTHS[Number(recap.month.slice(5, 7)) - 1] ?? '',
    total: formatPence(recap.total),
    everyday: formatPence(recap.everyday),
    usual: recap.usual === null ? null : formatPence(recap.usual),
    comparison: recap.comparison === null ? null
      : { direction: recap.comparison.direction, amount: recap.comparison.direction === 'same' ? null : wholePounds(recap.comparison.amount) },
    bar: recap.bar.map((x) => ({ name: x.name, total: formatPence(x.total) })),
    notes: recap.notes.map((n) => n.text),
    paid: { A: formatPence(recap.paid[a] ?? (0 as Pence)), B: formatPence(recap.paid[b] ?? (0 as Pence)) },
  };
}

/** A number as written: "£1,365.50", "1365", "30%". */
interface NumberToken { money: boolean; percent: boolean; whole: number; pence: number | null }

const NUMBER = /(£)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?(\s?%)?/g;

function tokens(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  for (const m of text.matchAll(NUMBER)) {
    const whole = Number((m[2] ?? '').replace(/,/g, ''));
    const dec = m[3];
    out.push({
      money: m[1] !== undefined,
      percent: m[4] !== undefined,
      whole,
      pence: dec === undefined ? null : whole * 100 + Number(dec.padEnd(2, '0')),
    });
  }
  return out;
}

/** Pence of a money string as the app writes it ("£1,365.50", "£120"). */
function penceOf(s: string): number | null {
  const t = tokens(s)[0];
  if (!t) return null;
  return t.pence ?? t.whole * 100;
}

const ADVICE = /\b(should|too much|overspent|blame)\b/i;
const MAX = 140;

/**
 * INS-2 guard: the two sentences as written, with the names put back, or null (the template is used) when either is
 * too long, the headline is blank, a number isn't one of the month's figures, or it advises or judges.
 */
export function wordingGuard(stats: RecapStats, reply: Wording, names: { A: string; B: string }): Wording | null {
  const headline = reply.headline.trim();
  const aside = reply.aside === null ? null : reply.aside.trim();
  if (headline === '' || reply.headline.length > MAX || (reply.aside !== null && reply.aside.length > MAX)) return null;
  const texts = aside === null || aside === '' ? [headline] : [headline, aside];
  if (texts.some((t) => ADVICE.test(t))) return null;

  // Every money figure the month has, in pence (the notes' amounts included).
  const money = new Set<number>();
  const add = (s: string | null) => { const v = s === null ? null : penceOf(s); if (v !== null) money.add(v); };
  add(stats.total);
  add(stats.everyday);
  add(stats.usual);
  add(stats.comparison?.amount ?? null);
  for (const x of stats.bar) add(x.total);
  add(stats.paid.A);
  add(stats.paid.B);
  const notePercents = new Set<number>();
  const noteNumbers = new Set<number>();
  for (const note of stats.notes) {
    for (const t of tokens(note)) {
      if (t.money) money.add(t.pence ?? t.whole * 100);
      else if (t.percent) notePercents.add(t.whole);
      else noteNumbers.add(t.whole);
    }
  }
  const year = Number(stats.period.slice(0, 4));

  for (const text of texts) {
    for (const t of tokens(text)) {
      if (t.percent) {
        if (t.pence !== null || !notePercents.has(t.whole)) return null;
        continue;
      }
      if (t.pence !== null) {
        if (!money.has(t.pence)) return null;
        continue;
      }
      // A whole number: pounds of a figure with no pence; bare, also a number from a note or the year.
      const asPounds = money.has(t.whole * 100);
      if (t.money ? !asPounds : !(asPounds || noteNumbers.has(t.whole) || t.whole === year)) return null;
    }
  }

  // A figure used as the difference from usual must be the month's own difference, in its own direction (£125 is a
  // real figure, but not "£125 less than usual" when the month was £120 less).
  for (const text of texts) {
    for (const m of text.matchAll(/(£?[\d,]+(?:\.\d{1,2})?)\s+(less|more)\s+than\s+(?:its\s+)?usual/gi)) {
      const said = penceOf(m[1] ?? '');
      const c = stats.comparison;
      const own = c?.amount == null ? null : penceOf(c.amount);
      if (!c || c.direction !== m[2]?.toLowerCase() || said === null || said !== own) return null;
    }
  }

  const named = (s: string) => s
    .replace(/(?<![\p{L}\p{N}&])A(?![\p{L}\p{N}&])/gu, names.A)
    .replace(/(?<![\p{L}\p{N}&])B(?![\p{L}\p{N}&])/gu, names.B);
  return { headline: named(headline), aside: aside === null || aside === '' ? null : named(aside) };
}
