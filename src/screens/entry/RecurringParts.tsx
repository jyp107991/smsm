/**
 * S3 pieces of the regular payment sheet: an on/off switch ("Amount varies", "Subscription") and the
 * template's history, where a price change reads "Rent £1,450.00 → £1,500.00 from December" (REC-6).
 */
import { useId, useMemo } from 'react';
import { formatPence, pence } from '../../core/money';
import { useDataLayer, useHistory, useOnline, type RecurringRow } from '../../data';
import { cx } from '../../ui/primitives/util';
import { strings } from '../../ui/strings';
import { usePeople } from '../shared/people';
import { historyLine } from '../shared/words';
import { fromMonth } from './schedule';

/** A switch (a checkbox in the switch role): the whole row is the 44 px target; the name is the label, the hint describes it. */
export function Toggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (on: boolean) => void }) {
  const id = useId();
  return (
    <label htmlFor={id} className="press flex min-h-14 w-full cursor-pointer items-center gap-4 py-2">
      <span className="flex min-w-0 flex-1 flex-col">
        <span id={`${id}-label`} className="text-body text-ink">{label}</span>
        {hint ? <span id={`${id}-hint`} className="text-secondary text-ink-2">{hint}</span> : null}
      </span>
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={on}
        aria-labelledby={`${id}-label`}
        {...(hint ? { 'aria-describedby': `${id}-hint` } : {})}
        onChange={(e) => { onChange(e.target.checked); }}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cx(
          'relative inline-flex h-7 w-12 shrink-0 rounded-full transition-colors motion-reduce:transition-none',
          'peer-focus-visible:outline-forest peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-solid',
          on ? 'bg-forest' : 'bg-sunk border-line border',
        )}
      >
        <span
          className={cx(
            'bg-surface absolute top-1/2 size-5 -translate-y-1/2 rounded-full shadow-sm transition-[left] motion-reduce:transition-none',
            on ? 'left-6' : 'left-1',
          )}
        />
      </span>
    </label>
  );
}

function amountChange(summary: unknown): { before: number; after: number } | null {
  if (!summary || typeof summary !== 'object') return null;
  const field = (summary as Record<string, unknown>).amount_pence;
  if (!field || typeof field !== 'object') return null;
  const { before, after } = field as { before?: unknown; after?: unknown };
  return typeof before === 'number' && typeof after === 'number' ? { before, after } : null;
}

export function RecurringHistory({ template }: { template: RecurringRow }) {
  const layer = useDataLayer();
  const people = usePeople();
  const online = useOnline();
  const history = useHistory(template.id);
  const today = layer.today();
  const id = useId();
  const lines = useMemo(() => {
    if (!history.data) return undefined;
    return [...history.data]
      .sort((a, b) => (a.at !== b.at ? (a.at < b.at ? -1 : 1) : a.id - b.id))
      .map((a) => {
        const change = a.action === 'created' ? null : amountChange(a.summary);
        if (change) {
          const month = fromMonth(template, a.at.slice(0, 10), today);
          if (month) {
            return { id: a.id, text: strings.recurring.priceChange(template.description, formatPence(pence(change.before)), formatPence(pence(change.after)), month) };
          }
        }
        return { id: a.id, text: historyLine(a, people.list, today) };
      });
  }, [history.data, people.list, template, today]);
  return (
    <section aria-labelledby={id} className="flex flex-col">
      <h2 id={id} className="text-subtitle rule-ledger m-0">{strings.entry.history}</h2>
      {lines === undefined ? (
        <p className="text-secondary text-ink-2 mt-3 mb-0">{online ? strings.entry.historyLoading : strings.entry.historyOffline}</p>
      ) : lines.length === 0 ? (
        <p className="text-secondary text-ink-2 mt-3 mb-0">{strings.entry.historyEmpty}</p>
      ) : (
        <ol className="m-0 flex list-none flex-col p-0">
          {lines.map((l) => (
            <li key={l.id} className="text-secondary border-line border-b py-2.5 last:border-b-0"><span className="break-words">{l.text}</span></li>
          ))}
        </ol>
      )}
    </section>
  );
}
