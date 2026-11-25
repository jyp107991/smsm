/** S5a: the phone's rows as the Insights core reads them (here so the data layer's recap wording reads them too). */
import { pence } from '../core/money';
import type { InsightEntry, InsightSettlement, NoteTemplate } from '../core/insights';
import type { SplitMode } from '../core/split';
import { isSubscription, type KeyedCategory } from '../core/subscription';
import type { ExpenseRow, RecurringRow, SettlementRow } from './api';
import { isDeleted } from './writes';

const map = (j: unknown): Record<string, number> => (j && typeof j === 'object' && !Array.isArray(j) ? j as Record<string, number> : {});

export function toInsight(e: ExpenseRow): InsightEntry {
  return {
    id: e.id, kind: e.kind === 'money_back' ? 'money_back' : 'expense', description: e.description, amount: pence(e.amount_pence),
    paid: map(e.paid) as InsightEntry['paid'], shares: map(e.shares) as InsightEntry['shares'], splitMode: e.split_mode as SplitMode, date: e.date,
    categoryId: e.category_id, chapterId: e.chapter_id, country: e.country, recurringId: e.recurring_id, deleted: e.deleted_at !== null,
    refundOf: e.refund_of, createdAt: e.created_at,
    // S10 (REC-12, INS-10): whose it is; a personal entry is never in a shared figure.
    ownerId: e.owner_id ?? null,
  };
}

export function toSettle(s: SettlementRow): InsightSettlement {
  return { from: s.from_user, to: s.to_user, amount: pence(s.amount_pence), date: s.date, deleted: s.deleted_at !== null };
}

/** REC-7 (owner, 25 Nov): a subscription is one in the Subscriptions category (the category alone decides). */
export function toTemplate(t: RecurringRow, categories: readonly KeyedCategory[]): NoteTemplate {
  return {
    id: t.id, description: t.description, amount: pence(t.amount_pence), frequency: t.frequency as NoteTemplate['frequency'], every: t.every,
    // S10: a deleted one is never "new" (what it posted still counts as entries).
    startDate: t.start_date, isSubscription: isSubscription(t, categories), active: t.active && !isDeleted(t),
    ownerId: t.owner_id ?? null,
  };
}
