/**
 * Home (DESIGN §4.1): "are we square?" and adding. The plank and the sentence (with the offline and
 * waiting-to-sync pill under the plank), quick add with its live reading and the Add expense button in its
 * box (the one way to add, Q-L4; a long press offers "Same as last time", ADD-7), today's entries, and only
 * the banners that are needed: an approval waiting, a change the server refused (OFF-5). Settings is the gear.
 */
import { useMemo } from 'react';
import { Settings as Gear } from 'lucide-react';
import { dismissProblem, useCategories, useDataLayer, useEntries, useSyncStatus, type ExpenseDraft, type ExpenseRow } from '../../data';
import { Logo } from '../../ui/Logo';
import { Button, ICON } from '../../ui/primitives';
import { go } from '../../ui/router';
import { strings } from '../../ui/strings';
import { NO_CATEGORIES } from '../shared/empty';
import { ApprovalBanners } from '../shared/Approvals';
import { usePeople } from '../shared/people';
import { EntryRowView } from '../shared/rows';
import { useSheets } from '../sheets';
import { BalanceRegion } from './Balance';
import { QuickAdd } from './QuickAdd';

export function Home() {
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-10">
      <header className="flex min-h-12 items-center gap-2.5">
        <Logo size={30} />
        <h1 className="text-wordmark m-0 flex-1 text-[1.75rem] leading-none">{strings.app.name}</h1>
        <button
          type="button"
          aria-label={strings.home.settings}
          onClick={() => { go({ name: 'settings' }); }}
          className="text-ink press -mr-2.5 inline-flex size-11 items-center justify-center rounded-full"
        >
          <Gear size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" />
        </button>
      </header>
      <ApprovalBanners />
      <Problems />
      <BalanceRegion />
      <QuickAdd />
      <Today />
    </div>
  );
}

/** OFF-5: a change the server refused after reconnecting is reported in plain words and kept to fix. */
function Problems() {
  const { problems } = useSyncStatus();
  const sheets = useSheets();
  if (problems.length === 0) return null;
  return (
    <div role="alert" className="bg-surface border-berry flex flex-col gap-3 rounded-[16px] border-2 px-4 py-3">
      {problems.map((p) => (
        <div key={p.id} className="flex flex-col gap-2">
          <p className="m-0 break-words">{strings.sync.problem(p.label, (strings.sync.reasons as Partial<Record<string, string>>)[p.reason] ?? strings.sync.reasons.other)}</p>
          <div className="flex flex-wrap gap-3">
            {p.table === 'expenses' && p.row ? (
              <Button
                variant="plain"
                onClick={() => {
                  sheets.openEntry({ mode: 'edit', id: p.rowId, row: p.row as ExpenseRow, ...(p.input ? { input: p.input as ExpenseDraft } : {}) });
                }}
              >
                {strings.sync.fix}
              </Button>
            ) : null}
            <Button variant="plain" onClick={() => { dismissProblem(p.id); }}>{strings.sync.dismiss}</Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Today() {
  const layer = useDataLayer();
  const entries = useEntries().data;
  const categories = useCategories().data ?? NO_CATEGORIES;
  const people = usePeople();
  const { pendingIds } = useSyncStatus();
  const today = layer.today();
  const rows = useMemo(
    () => (entries ?? []).filter((e) => e.date === today && e.deleted_at === null).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)),
    [entries, today],
  );
  return (
    <section aria-labelledby="home-today" className="flex flex-col">
      <div className="rule-ledger flex items-baseline justify-between gap-3">
        <h2 id="home-today" className="text-heading m-0">{strings.home.today}</h2>
        <a
          href="/activity"
          onClick={(e) => { e.preventDefault(); go({ name: 'activity' }); }}
          className="text-forest text-secondary -mr-2 inline-flex min-h-11 items-center rounded-full px-2 underline-offset-4 hover:underline"
        >
          {strings.home.seeAll}
        </a>
      </div>
      {rows.length === 0 ? (
        <p className="text-secondary text-ink-2 mt-3 mb-0">{strings.home.nothingToday}</p>
      ) : (
        <ul aria-label={strings.home.today} className="m-0 list-none p-0">
          {rows.map((r) => (
            <li key={r.id} className="border-line border-b last:border-b-0">
              <EntryRowView row={r} categories={categories} people={people.list} pending={pendingIds.has(r.id)} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
