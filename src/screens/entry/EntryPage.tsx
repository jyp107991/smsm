/**
 * An entry's page (DESIGN §4.3; ACT-2, ACT-3, ACT-5, ADD-7, MB-2, SET-3): the description as the heading,
 * who paid and the split in words, category and date; Edit, Duplicate, Refund this, Delete; History from
 * the database's log. A deleted entry says so and offers Restore. Settle-ups open here too.
 */
import { ArrowLeft } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { formatDay } from '../../core/dates';
import { formatPence, pence } from '../../core/money';
import {
  addExpense, deleteExpense, deleteSettlement, restoreExpense, restoreSettlement, useCategories, useDataLayer, useEntries, useHistory,
  useOnline, useSettlements, useSyncStatus, type ExpenseRow, type SettlementRow,
} from '../../data';
import { tickSaved } from '../../ui/haptics';
import { goBackOrTo } from '../../ui/history';
import { go, pathOf } from '../../ui/router';
import { Button, ICON, useToast } from '../../ui/primitives';
import { strings } from '../../ui/strings';
import { CategoryMark } from '../shared/CategoryMark';
import { Head } from '../shared/Head';
import { useTapAction } from '../shared/once';
import { usePeople } from '../shared/people';
import { entrySentence, historyLine, owesForThis, payerOf } from '../shared/words';
import { useSheets } from '../sheets';
import { duplicateDraft } from './form';

export function EntryPage({ id }: { id: string }) {
  const entries = useEntries();
  const settlements = useSettlements();
  const expense = entries.data?.find((e) => e.id === id);
  const settlement = settlements.data?.find((s) => s.id === id);
  const loading = entries.data === undefined || settlements.data === undefined;
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-16">
      <header className="flex min-h-12 items-center">
        <button
          type="button"
          onClick={() => { goBackOrTo('/activity'); }}
          className="text-ink press -ml-2.5 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2.5"
        >
          <ArrowLeft size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" />
          {strings.entry.back}
        </button>
      </header>
      {expense ? <ExpenseView row={expense} /> : settlement ? <SettlementView row={settlement} /> : loading ? null : (
        <p className="text-note m-0">{strings.entry.notFound}</p>
      )}
      {expense || settlement ? <History id={id} /> : null}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="border-line flex min-h-11 items-baseline justify-between gap-4 border-b py-2">
      <dt className="text-secondary text-ink-2">{label}</dt>
      <dd className="m-0 min-w-0 text-right break-words">{children}</dd>
    </div>
  );
}

function ExpenseView({ row }: { row: ExpenseRow }) {
  const layer = useDataLayer();
  const toast = useToast();
  const sheets = useSheets();
  const people = usePeople();
  const categories = useCategories().data ?? [];
  const entries = useEntries().data ?? [];
  const { pendingIds, otherWindow: readOnly } = useSyncStatus();
  const today = layer.today();
  const category = categories.find((c) => c.id === row.category_id);
  const payer = people.list.find((p) => p.id === payerOf(row.paid, people.list));
  const original = row.refund_of ? entries.find((e) => e.id === row.refund_of) : undefined;
  // Q-U9: money that came back for this entry, each linking to its own page.
  const cameBack = row.kind === 'money_back' ? [] : entries.filter((e) => e.kind === 'money_back' && e.refund_of === row.id && e.deleted_at === null);
  const owes = owesForThis(row, people.list);
  const deleted = row.deleted_at !== null;
  const back = row.kind === 'money_back';
  const label = row.description;
  const tap = useTapAction();

  // Q-F1 ADD-7: one copy per tap-action (a double tap makes one); a later tap makes another on purpose.
  const duplicate = () => {
    tap((rowId) => {
      const draft = duplicateDraft(row, people.list, today);
      if (!draft) return;
      const copyId = addExpense({ ...draft, id: rowId });
      tickSaved();
      // Q-U8: the copy is made for today. Undo removes it in one tap (owner, 17 Nov: a copy made by mistake
      // changes the balance, so taking it back should be one tap, as for a swipe in Activity).
      toast.show({
        message: strings.entry.copied,
        ...(payer ? { icon: <Head animal={payer.animal} size={24} nod /> } : {}),
        action: { label: strings.entry.undo, onAction: () => { if (deleteExpense(copyId)) toast.show({ message: strings.entry.removed(label) }); } },
        duration: 5000,
      });
    });
  };

  return (
    <article className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h1 className="text-title m-0 break-words">{row.description}</h1>
        <p className="text-amount nums-list m-0">{formatPence(pence(row.amount_pence))}</p>
        {back && original ? <p className="text-secondary text-ink-2 m-0">{strings.entry.moneyBackFor(original.description)}</p> : null}
        <p className="text-note m-0 flex items-center gap-2">
          {payer ? <Head animal={payer.animal} size={28} /> : null}
          <span>{entrySentence(row, people.list)}</span>
        </p>
        {owes ? <p className="text-secondary text-ink-2 m-0">{owes}</p> : null}
        {cameBack.map((m) => (
          <a
            key={m.id}
            href={pathOf({ name: 'entry', id: m.id })}
            onClick={(e) => {
              if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
              e.preventDefault();
              go({ name: 'entry', id: m.id });
            }}
            className="text-forest text-secondary -mx-1 inline-flex min-h-11 items-center self-start rounded-[8px] px-1 underline underline-offset-4"
          >
            {strings.entry.cameBack(formatPence(pence(m.amount_pence)), formatDay(m.date, today))}
          </a>
        ))}
        {pendingIds.has(row.id) ? <p className="text-caption text-ink-2 m-0">{strings.entry.notSynced}</p> : null}
        {deleted ? <p className="text-secondary text-berry m-0">{strings.entry.wasDeleted}</p> : null}
      </div>
      <dl className="m-0">
        <Detail label={strings.entry.category}>
          {category ? (
            <>
              <CategoryMark emoji={category.emoji} colour={category.colour} className="mr-1.5" />
              {category.name}
            </>
          ) : strings.entry.categoryNone}
        </Detail>
        <Detail label={strings.entry.date}>{formatDay(row.date, today)}</Detail>
        {row.notes ? <Detail label={strings.entry.note}>{row.notes}</Detail> : null}
      </dl>
      <fieldset disabled={readOnly} className="m-0 flex min-w-0 flex-wrap gap-3 border-0 p-0">
        {deleted ? (
          <Button
            onClick={() => {
              // Q-F4: a second tap restores nothing, and says nothing.
              if (restoreExpense(row.id)) toast.show({ message: strings.entry.restored(label) });
            }}
          >
            {strings.entry.restore}
          </Button>
        ) : (
          <>
            <Button variant="plain" onClick={() => { sheets.openEntry({ mode: 'edit', id: row.id }); }}>{strings.entry.editButton}</Button>
            <Button variant="plain" onClick={duplicate}>{strings.entry.duplicate}</Button>
            {!back ? <Button variant="plain" onClick={() => { sheets.openEntry({ mode: 'refund', of: row }); }}>{strings.entry.refund}</Button> : null}
            {/* Delete on its own line, a text button on the margin, apart from the everyday actions (Q-L11). */}
            <div className="basis-full">
            <Button
              variant="destructive"
              leading
              onClick={() => {
                if (!deleteExpense(row.id)) return;
                toast.show({
                  message: strings.entry.deleted(label),
                  action: { label: strings.entry.undo, onAction: () => { restoreExpense(row.id); } },
                  duration: 5000,
                });
              }}
            >
              {strings.entry.delete}
            </Button>
            </div>
          </>
        )}
      </fieldset>
    </article>
  );
}

function SettlementView({ row }: { row: SettlementRow }) {
  const layer = useDataLayer();
  const toast = useToast();
  const sheets = useSheets();
  const people = usePeople();
  const { pendingIds, otherWindow: readOnly } = useSyncStatus();
  const from = people.list.find((p) => p.id === row.from_user);
  const to = people.list.find((p) => p.id === row.to_user);
  const heading = strings.activity.settled(from?.name ?? '', to?.name ?? '', formatPence(pence(row.amount_pence)));
  const deleted = row.deleted_at !== null;
  return (
    <article className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <p aria-hidden="true" className="m-0 flex gap-1">
          {from ? <Head animal={from.animal} size={32} /> : null}
          {to ? <Head animal={to.animal} size={32} /> : null}
        </p>
        <h1 className="text-title m-0 break-words">{heading}</h1>
        {pendingIds.has(row.id) ? <p className="text-caption text-ink-2 m-0">{strings.entry.notSynced}</p> : null}
        {deleted ? <p className="text-secondary text-berry m-0">{strings.entry.wasDeleted}</p> : null}
      </div>
      <dl className="m-0">
        <Detail label={strings.entry.date}>{formatDay(row.date, layer.today())}</Detail>
        {row.method === 'monzo' ? <Detail label={strings.settle.title}>{strings.entry.viaMonzo}</Detail> : null}
        {row.note ? <Detail label={strings.entry.note}>{row.note}</Detail> : null}
      </dl>
      <fieldset disabled={readOnly} className="m-0 flex min-w-0 flex-wrap gap-3 border-0 p-0">
        {deleted ? (
          <Button onClick={() => { if (restoreSettlement(row.id)) toast.show({ message: strings.entry.restored(heading) }); }}>
            {strings.entry.restore}
          </Button>
        ) : (
          <>
            <Button variant="plain" onClick={() => { sheets.openSettle({ mode: 'edit', row }); }}>{strings.entry.editButton}</Button>
            <div className="basis-full">
            <Button
              variant="destructive"
              leading
              onClick={() => {
                if (!deleteSettlement(row.id)) return;
                toast.show({
                  message: strings.entry.deleted(heading),
                  action: { label: strings.entry.undo, onAction: () => { restoreSettlement(row.id); } },
                  duration: 5000,
                });
              }}
            >
              {strings.entry.delete}
            </Button>
            </div>
          </>
        )}
      </fieldset>
    </article>
  );
}

function History({ id }: { id: string }) {
  const layer = useDataLayer();
  const people = usePeople();
  const online = useOnline();
  const history = useHistory(id);
  const today = layer.today();
  // Q-U9: oldest first, so the story starts with who added it.
  const rows = useMemo(
    () => (history.data ? [...history.data].sort((a, b) => (a.at !== b.at ? (a.at < b.at ? -1 : 1) : a.id - b.id)) : undefined),
    [history.data],
  );
  return (
    <section aria-labelledby="entry-history" className="flex flex-col">
      <h2 id="entry-history" className="text-subtitle rule-ledger m-0">{strings.entry.history}</h2>
      {rows === undefined ? (
        <p className="text-secondary text-ink-2 mt-3 mb-0">{online ? strings.entry.historyLoading : strings.entry.historyOffline}</p>
      ) : rows.length === 0 ? (
        <p className="text-secondary text-ink-2 mt-3 mb-0">{strings.entry.historyEmpty}</p>
      ) : (
        <ol className="m-0 flex list-none flex-col p-0">
          {rows.map((a) => (
            <li key={a.id} className="text-secondary border-line border-b py-2.5 last:border-b-0">
              <span className="break-words">{historyLine(a, people.list, today)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
