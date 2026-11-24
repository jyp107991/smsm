/**
 * S3 on Home: the Inbox with its count when a bill (or, S7, an imported bank row) waits (INB-1, INB-2), and "Netflix looks monthly. Make it a
 * regular payment?" when the last three of a description came at a steady interval (REC-5). Yes opens the
 * regular payment sheet starting at the next one, so nothing already entered posts again; No is remembered on
 * this phone for that description, across restarts.
 */
import { Inbox as InboxIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { formatPlainPounds, pence } from '../../core/money';
import { suggestRecurring, type RecurringSuggestion } from '../../core/recurring';
import { isDeleted, useDataLayer, useEntries, useImportQueue, useInbox, useRecurring } from '../../data';
import { Button, ICON } from '../../ui/primitives';
import { go } from '../../ui/router';
import { strings } from '../../ui/strings';
import { NO_ENTRIES } from '../shared/empty';
import { useSheets } from '../sheets';

export function InboxButton() {
  // INB-1: the bank rows being reviewed on this phone count too (S7).
  const n = (useInbox().data?.length ?? 0) + (useImportQueue()?.length ?? 0);
  if (n === 0) return null;
  return (
    <button
      type="button"
      onClick={() => { go({ name: 'inbox' }); }}
      className="bg-surface border-line text-ink press flex min-h-12 items-center gap-3 rounded-[12px] border px-4 py-2 text-left"
    >
      <InboxIcon size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" className="text-forest shrink-0" />
      <span className="text-body flex-1">{strings.inbox.button(n)}</span>
    </button>
  );
}

const NO_KEY = 'smsm-suggest-no';

function saidNo(): string[] {
  try {
    const raw = localStorage.getItem(NO_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function rememberNo(key: string): void {
  try {
    localStorage.setItem(NO_KEY, JSON.stringify([...new Set([...saidNo(), key])]));
  } catch {
    /* no storage: it is only not asked again until the app closes */
  }
}

function often(s: RecurringSuggestion): string {
  if (s.frequency === 'weekly') return s.every === 2 ? strings.suggest.fortnightly : strings.suggest.weekly;
  if (s.frequency === 'monthly') return s.every === 3 ? strings.suggest.quarterly : strings.suggest.monthly;
  return strings.suggest.yearly;
}

export function SuggestRecurring() {
  const layer = useDataLayer();
  const today = layer.today();
  const entries = useEntries().data ?? NO_ENTRIES;
  const templates = useRecurring().data;
  const sheets = useSheets();
  const [no, setNo] = useState(saidNo);
  const suggestion = useMemo(() => {
    if (templates === undefined) return undefined;
    const history = entries
      .filter((e) => e.deleted_at === null && e.kind === 'expense' && e.recurring_id === null)
      .map((e) => ({ description: e.description, amount: pence(e.amount_pence), date: e.date }));
    // S10: a deleted regular payment no longer counts as one (entered by hand again, it may be suggested again).
    const exclude = new Set([...no, ...templates.filter((t) => !isDeleted(t)).map((t) => t.description)]);
    return suggestRecurring(history, today, exclude)[0];
  }, [entries, templates, today, no]);
  if (!suggestion) return null;
  const last = entries.find((e) => e.deleted_at === null && e.description === suggestion.description && e.date === suggestion.lastDate);
  return (
    <div role="note" className="bg-surface border-line flex flex-col gap-3 rounded-[16px] border px-4 py-3">
      <p className="m-0 break-words">{strings.suggest.line(suggestion.description, often(suggestion))}</p>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="plain"
          onClick={() => {
            sheets.openEntry({
              mode: 'recurring',
              prefill: {
                amountText: formatPlainPounds(suggestion.amount),
                description: suggestion.description,
                ...(last ? { categoryId: last.category_id, categoryTouched: true } : {}),
              },
              schedule: { frequency: suggestion.frequency, everyText: String(suggestion.every), startDate: suggestion.nextDate },
            });
          }}
        >
          {strings.suggest.yes}
        </Button>
        <Button
          variant="plain"
          onClick={() => {
            rememberNo(suggestion.key);
            setNo((xs) => [...xs, suggestion.key]);
          }}
        >
          {strings.suggest.no}
        </Button>
      </div>
    </div>
  );
}
