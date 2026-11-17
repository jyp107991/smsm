/** S5b: the household's rows as the recap core reads them (one place, so every recap screen agrees). */
import { useMemo } from 'react';
import type { InsightEntry, InsightSettlement, NoteTemplate } from '../../core/insights';
import type { UserId } from '../../core/split';
import { useAllComments, useCategories, useEntries, useRecurring, useSettlements } from '../../data';
import { NO_CATEGORIES, NO_ENTRIES } from '../shared/empty';
import { usePeople } from '../shared/people';
import { toInsight, toSettle, toTemplate } from './model';

export interface RecapInput {
  entries: (InsightEntry & { place: string | null })[];
  settlements: InsightSettlement[];
  people: [UserId, UserId];
  names: Record<UserId, string>;
  categories: { id: string; name: string }[];
  templates: NoteTemplate[];
  commentCounts: Record<string, number>;
}

export function useRecapInput(): RecapInput | null {
  const rows = useEntries().data ?? NO_ENTRIES;
  const settlements = useSettlements().data;
  const templates = useRecurring().data;
  const categories = useCategories().data ?? NO_CATEGORIES;
  const comments = useAllComments().data;
  const people = usePeople();
  const [a, b] = people.list;
  return useMemo(() => {
    if (!a || !b) return null;
    const counts: Record<string, number> = {};
    for (const c of comments ?? []) if (c.deleted_at === null) counts[c.expense_id] = (counts[c.expense_id] ?? 0) + 1;
    return {
      entries: rows.map((r) => ({ ...toInsight(r), place: r.place })),
      settlements: (settlements ?? []).map(toSettle),
      people: [a.id, b.id],
      names: { [a.id]: a.name, [b.id]: b.name },
      categories: categories.map((c) => ({ id: c.id, name: c.name })),
      templates: (templates ?? []).map(toTemplate),
      commentCounts: counts,
    };
  }, [rows, settlements, templates, categories, comments, a, b]);
}
