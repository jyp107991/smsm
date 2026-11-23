/** S5a: the phone's rows as the Insights core reads them (here so the data layer's recap wording reads them too). */
import { pence } from '../core/money';
import type { InsightEntry, InsightSettlement, NoteTemplate } from '../core/insights';
import type { SplitMode } from '../core/split';
import type { ExpenseRow, RecurringRow, SettlementRow } from './api';

const map = (j: unknown): Record<string, number> => (j && typeof j === 'object' && !Array.isArray(j) ? j as Record<string, number> : {});

export function toInsight(e: ExpenseRow): InsightEntry {
  return {
    id: e.id, kind: e.kind === 'money_back' ? 'money_back' : 'expense', description: e.description, amount: pence(e.amount_pence),
    paid: map(e.paid) as InsightEntry['paid'], shares: map(e.shares) as InsightEntry['shares'], splitMode: e.split_mode as SplitMode, date: e.date,
    categoryId: e.category_id, chapterId: e.chapter_id, country: e.country, recurringId: e.recurring_id, deleted: e.deleted_at !== null,
    refundOf: e.refund_of, createdAt: e.created_at,
  };
}

export function toSettle(s: SettlementRow): InsightSettlement {
  return { from: s.from_user, to: s.to_user, amount: pence(s.amount_pence), date: s.date, deleted: s.deleted_at !== null };
}

export function toTemplate(t: RecurringRow): NoteTemplate {
  return {
    id: t.id, description: t.description, amount: pence(t.amount_pence), frequency: t.frequency as NoteTemplate['frequency'], every: t.every,
    startDate: t.start_date, isSubscription: t.is_subscription, active: t.active,
  };
}
