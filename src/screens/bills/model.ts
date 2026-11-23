/**
 * S3 (REC-7, REC-8): what the Bills page shows, worked out by the core from the templates and the entries
 * they posted. Pure, so the sums are tested apart from the screen; nothing here is estimated by anything else.
 */
import { addDays, startOfMonth, type IsoDate } from '../../core/dates';
import { pence, sumPence, type Pence } from '../../core/money';
import { monthlyCost, upcoming, yearlyCost, type Frequency, type UpcomingBill, type UpcomingTemplate } from '../../core/recurring';
import type { ExpenseRow, RecurringRow } from '../../data';

/** Running now: not paused, and not ended (one that ends today has had its last day). */
export function isRunning(t: RecurringRow, today: IsoDate): boolean {
  return t.active && (t.end_date === null || t.end_date > today);
}

function cadence(t: RecurringRow) {
  return { frequency: t.frequency as Frequency, every: t.every };
}

export function toUpcoming(t: RecurringRow, today: IsoDate): UpcomingTemplate {
  return {
    id: t.id, description: t.description, amount: pence(t.amount_pence), amountVaries: t.amount_varies, active: isRunning(t, today),
    postedCount: t.posted_count,
    schedule: { frequency: t.frequency as Frequency, every: t.every, startDate: t.start_date, endDate: t.end_date },
  };
}

/** REC-8: the running templates' cost a month, each rounded once, added up. */
export function homeCostPerMonth(templates: readonly RecurringRow[], today: IsoDate): Pence {
  return sumPence(templates.filter((t) => isRunning(t, today)).map((t) => monthlyCost(cadence(t), pence(t.amount_pence))));
}

export function endOfMonth(d: IsoDate): IsoDate {
  const first = startOfMonth(d);
  const [y, m] = [Number(first.slice(0, 4)), Number(first.slice(5, 7))];
  const next = m === 12 ? `${String(y + 1)}-01-01` : `${String(y)}-${String(m + 1).padStart(2, '0')}-01`;
  return addDays(next, -1);
}

/** S9b (REC-7): one bill on a day of the calendar: posted (an entry) or still due (at its usual amount if it varies). */
export interface DayBill {
  /** Its regular payment. */
  id: string; description: string; amount: Pence; posted: boolean; varies: boolean }

export interface MonthView {
  /** Per day of the month: the descriptions posted and due, and each bill with its amount (posted first). */
  days: Map<IsoDate, { posted: string[]; due: string[]; bills: DayBill[] }>;
  /** Posted this month plus what is still to come in it (a varying bill at its usual amount). */
  total: Pence;
}

/** REC-7: this month: what regular payments posted (entries from a template, not deleted) and what is still due. */
export function monthView(templates: readonly RecurringRow[], entries: readonly ExpenseRow[], today: IsoDate): MonthView {
  const from = startOfMonth(today);
  const to = endOfMonth(today);
  const days = new Map<IsoDate, { posted: string[]; due: string[]; bills: DayBill[] }>();
  const at = (d: IsoDate) => {
    let v = days.get(d);
    if (!v) {
      v = { posted: [], due: [], bills: [] };
      days.set(d, v);
    }
    return v;
  };
  const amounts: Pence[] = [];
  for (const e of entries) {
    if (e.recurring_id === null || e.deleted_at !== null || e.kind !== 'expense' || e.date < from || e.date > to) continue;
    const day = at(e.date);
    day.posted.push(e.description);
    day.bills.push({ id: e.recurring_id, description: e.description, amount: pence(e.amount_pence), posted: true, varies: false });
    amounts.push(pence(e.amount_pence));
  }
  for (const b of upcoming(templates.map((t) => toUpcoming(t, today)), { from, to })) {
    const day = at(b.date);
    day.due.push(b.description);
    day.bills.push({ id: b.id, description: b.description, amount: b.amount, posted: false, varies: b.amountVaries });
    amounts.push(b.amount);
  }
  return { days, total: sumPence(amounts) };
}

/** REC-7: the next 30 days, by date then description. */
export function next30(templates: readonly RecurringRow[], today: IsoDate): UpcomingBill[] {
  return upcoming(templates.map((t) => toUpcoming(t, today)), { from: today, to: addDays(today, 30) });
}

export interface SubscriptionLine { template: RecurringRow; perMonth: Pence; perYear: Pence }

/** REC-7: the running subscriptions, with their cost a month and a year, and the year's total. */
export function subscriptions(templates: readonly RecurringRow[], today: IsoDate): { lines: SubscriptionLine[]; perYear: Pence } {
  const lines = templates
    .filter((t) => t.is_subscription && isRunning(t, today))
    .map((t) => ({ template: t, perMonth: monthlyCost(cadence(t), pence(t.amount_pence)), perYear: yearlyCost(cadence(t), pence(t.amount_pence)) }))
    .sort((a, b) => b.perYear - a.perYear || a.template.description.localeCompare(b.template.description));
  return { lines, perYear: sumPence(lines.map((l) => l.perYear)) };
}
