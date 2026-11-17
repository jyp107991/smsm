/**
 * INS-1 on Home: "£1,240.00 so far · about £80 under your usual pace", and at most one note (the largest by money).
 * Everyday spending only, as the usual is (CHP-5). Nothing shows until there is spending this month.
 */
import { useId, useMemo } from 'react';
import { notes, pace } from '../../core/insights';
import { formatPence } from '../../core/money';
import { useCategories, useDataLayer, useEntries, useRecurring } from '../../data';
import { strings } from '../../ui/strings';
import { NO_CATEGORIES, NO_ENTRIES } from '../shared/empty';
import { noteWords } from './Insights';
import { recurringNotes, toInsight } from './model';

export function ThisMonth() {
  const layer = useDataLayer();
  const today = layer.today();
  const rows = useEntries().data ?? NO_ENTRIES;
  const templates = useRecurring().data;
  const categories = useCategories().data ?? NO_CATEGORIES;
  const id = useId();
  const entries = useMemo(() => rows.map(toInsight), [rows]);
  const p = useMemo(() => pace(entries, today), [entries, today]);
  const note = useMemo(() => notes({ entries, today, ...recurringNotes(templates ?? [], rows, today) })[0] ?? null, [entries, today, templates, rows]);
  if (rows.length === 0) return null;
  const whole = (x: number) => `£${String(Math.floor(x / 100))}`;
  const tail = p.direction === 'under' && p.amount !== null ? strings.insights.under(whole(p.amount))
    : p.direction === 'over' && p.amount !== null ? strings.insights.over(whole(p.amount))
    : p.direction === 'on' ? strings.insights.onPace : '';
  return (
    <section aria-labelledby={id} className="flex flex-col gap-1">
      <h2 id={id} className="sr-only">{strings.insights.thisMonthRegion}</h2>
      <p className="text-body nums-list m-0">{`${strings.insights.soFar(formatPence(p.soFar))}${tail}`}</p>
      {note ? <p className="text-secondary text-ink-2 m-0">{noteWords(note, categories)}</p> : null}
    </section>
  );
}
