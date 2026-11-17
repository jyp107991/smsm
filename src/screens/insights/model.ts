/** S5a: the phone's rows as the Insights core reads them, and the notes' inputs from the regular payments. */
import { monthlyCost, type Frequency } from '../../core/recurring';
import { startOfMonth, type IsoDate } from '../../core/dates';
import { pence } from '../../core/money';
import type { InsightEntry, NoteInput, Settle } from '../../core/insights';
import type { ExpenseRow, RecurringRow, SettlementRow } from '../../data';

const map = (j: unknown): Record<string, number> => (j && typeof j === 'object' && !Array.isArray(j) ? j as Record<string, number> : {});

export function toInsight(e: ExpenseRow): InsightEntry {
  return {
    id: e.id, kind: e.kind === 'money_back' ? 'money_back' : 'expense', splitMode: e.split_mode, amount: pence(e.amount_pence), date: e.date,
    categoryId: e.category_id, chapterId: e.chapter_id, country: e.country, description: e.description, paid: map(e.paid), deleted: e.deleted_at !== null,
  };
}

export function sharesOf(rows: readonly ExpenseRow[]): (e: InsightEntry) => Record<string, number> {
  const byId = new Map(rows.map((r) => [r.id, map(r.shares)]));
  return (e) => byId.get(e.id) ?? {};
}

export function toSettle(s: SettlementRow): Settle {
  return { from: s.from_user, to: s.to_user, amount: pence(s.amount_pence), date: s.date, deleted: s.deleted_at !== null };
}

/** INS-3: a subscription whose latest posting this month differs from the one before; regular payments started this month. */
export function recurringNotes(templates: readonly RecurringRow[], rows: readonly ExpenseRow[], today: IsoDate): Pick<NoteInput, 'priceChanges' | 'newRecurring'> {
  const month = startOfMonth(today);
  const priceChanges: NonNullable<NoteInput['priceChanges']>[number][] = [];
  const newRecurring: NonNullable<NoteInput['newRecurring']>[number][] = [];
  for (const t of templates) {
    if (t.is_subscription) {
      const posted = rows.filter((r) => r.recurring_id === t.id && r.deleted_at === null).sort((a, b) => (a.date < b.date ? -1 : 1));
      const last = posted[posted.length - 1];
      const before = posted[posted.length - 2];
      if (last && before && last.date >= month && last.amount_pence !== before.amount_pence) {
        priceChanges.push({ description: t.description, before: pence(before.amount_pence), after: pence(last.amount_pence), on: last.date });
      }
    }
    if (t.start_date >= month && t.start_date <= today && t.active) {
      newRecurring.push({ description: t.description, perMonth: monthlyCost({ frequency: t.frequency as Frequency, every: t.every }, pence(t.amount_pence)), start: t.start_date });
    }
  }
  return { priceChanges, newRecurring };
}
