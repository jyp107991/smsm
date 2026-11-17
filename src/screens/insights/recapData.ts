/** S5b: the household's rows as the recap core reads them (one place, so every recap screen agrees). */
import { useMemo } from 'react';
import type { RecapInput } from '../../core/recap';
import { useAllComments, useCategories, useEntries, useRecurring } from '../../data';
import { NO_CATEGORIES, NO_ENTRIES } from '../shared/empty';
import { usePeople } from '../shared/people';
import { toInsight, toTemplate } from './model';

export function useRecapInput(): RecapInput | null {
  const rows = useEntries().data ?? NO_ENTRIES;
  const templates = useRecurring().data;
  const categories = useCategories().data ?? NO_CATEGORIES;
  const comments = useAllComments().data;
  const people = usePeople();
  const [a, b] = people.list;
  return useMemo(() => {
    if (!a || !b) return null;
    const counts = new Map<string, number>();
    for (const c of comments ?? []) if (c.deleted_at === null) counts.set(c.expense_id, (counts.get(c.expense_id) ?? 0) + 1);
    return {
      entries: rows.map(toInsight), templates: (templates ?? []).map(toTemplate),
      categories: categories.map((c) => ({ id: c.id, name: c.name })), people: [a.id, b.id], comments: counts,
    };
  }, [rows, templates, categories, comments, a, b]);
}
