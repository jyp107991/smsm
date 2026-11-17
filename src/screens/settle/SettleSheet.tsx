/**
 * Settle up (SET-1, SET-2, SET-3): prefilled with the full balance and editable for a part payment; "Pay
 * with Monzo" when the person owed has saved a monzo.me name, then "Did it go through?" on return; or
 * "Record it". Editing a settle-up (from its page) uses the same sheet with "Save".
 */
import { useRef, useState, type KeyboardEvent, type SyntheticEvent } from 'react';
import { formatDay } from '../../core/dates';
import { formatPence, formatPlainPounds, parseAmount, pence } from '../../core/money';
import {
  addSettlement, deleteSettlement, editSettlement, newId, useBalance, useDataLayer, type SettlementDraft,
} from '../../data';
import { tickSettled } from '../../ui/haptics';
import { holdEnterWhileComposing } from '../../ui/keys';
import { Button, Chip, Disclosure, Field, Sheet, useToast } from '../../ui/primitives';
import { strings } from '../../ui/strings';
import { Head } from '../shared/Head';
import { usePeople } from '../shared/people';
import { plainError } from '../shared/plain';
import type { SettleRequest } from '../sheets';
import { yesterdayOf } from '../entry/form';
import { monzoLink, type PendingMonzo } from './monzo';
import { useMonzoQuestion } from './question';

export function SettleSheet({ request, onClose }: { request: SettleRequest | null; onClose: () => void }) {
  const [opened, setOpened] = useState<{ req: SettleRequest; n: number } | null>(null);
  if (request !== null && opened?.req !== request) setOpened({ req: request, n: (opened?.n ?? 0) + 1 });
  if (!opened) return null;
  return <SettleForm key={opened.n} request={opened.req} open={request !== null} onDone={onClose} />;
}

function SettleForm({ request, open, onDone }: { request: SettleRequest; open: boolean; onDone: () => void }) {
  const layer = useDataLayer();
  const toast = useToast();
  const people = usePeople();
  const balance = useBalance();
  const question = useMonzoQuestion();
  const today = layer.today();
  const [a, b] = people.list;
  // Q-F1: one row id for this sheet, and nothing after the first save (a double tap, Enter held).
  const [rowId] = useState(newId);
  const done = useRef(false);

  // Who pays whom: the one who owes pays the one owed (SET-1); an edit keeps what was recorded.
  const [start] = useState(() => {
    if (request.mode === 'edit') {
      const r = request.row;
      return { from: r.from_user, to: r.to_user, amount: formatPlainPounds(pence(r.amount_pence)), date: r.date, note: r.note ?? '' };
    }
    if (request.mode === 'asking') {
      const p = request.pending;
      return { from: p.from, to: p.to, amount: formatPlainPounds(pence(p.amount)), date: p.date, note: p.note ?? '' };
    }
    if (balance.status === 'ready' && balance.state.kind === 'owes') {
      return { from: balance.state.debtor, to: balance.state.creditor, amount: formatPlainPounds(balance.state.amount), date: today, note: '' };
    }
    return { from: people.me?.id ?? a?.id ?? '', to: people.partner?.id ?? b?.id ?? '', amount: '', date: today, note: '' };
  });
  const [amountText, setAmountText] = useState(start.amount);
  const [date, setDate] = useState(start.date);
  const [note, setNote] = useState(start.note);
  const [more, setMore] = useState(request.mode === 'edit' && (start.note !== '' || start.date !== today));
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState<PendingMonzo | null>(request.mode === 'asking' ? request.pending : null);

  const from = people.list.find((p) => p.id === start.from);
  const to = people.list.find((p) => p.id === start.to);
  const editing = request.mode === 'edit';
  // SET-2: Monzo is how the person who owes pays, so only they are offered it (from their own phone).
  const payer = people.me?.id === start.from;
  // Q-U11: opened by the person owed (or to correct one already made), it records what the other has paid.
  const recordsTheirs = editing || people.me?.id === start.to;
  const monzoName = payer ? (people.rows.find((m) => m.user_id === start.to)?.monzo_me ?? null) : null;
  // SET-1: a part payment is fine; more than is owed gets a quiet line (it would turn the debt round).
  const owed = balance.status === 'ready' && balance.state.kind === 'owes' && balance.state.debtor === start.from ? balance.state.amount : null;
  const typed = parseAmount(amountText);
  const overLine = editing || typed === null || (owed !== null && typed <= owed) ? null
    : owed !== null ? strings.settle.moreThanOwed(from?.name ?? '', to?.name ?? '', formatPence(owed))
    : strings.settle.nothingOwed(from?.name ?? '', to?.name ?? '');

  const draft = (method: 'monzo' | 'other'): SettlementDraft | null => {
    const amount = parseAmount(amountText);
    if (amount === null) {
      setError(strings.entry.amountNeeded);
      return null;
    }
    return { from: start.from, to: start.to, amount, date, note: note.trim() === '' ? null : note.trim(), method };
  };

  /** `id`: the row this records; the Monzo question carries its own, so it is recorded once wherever it is answered. */
  const record = (d: SettlementDraft, rowIdToUse = rowId): boolean => {
    let id: string;
    try {
      id = addSettlement({ ...d, id: rowIdToUse });
    } catch (err) {
      setError(plainError(err));
      return false;
    }
    done.current = true;
    tickSettled();
    toast.show({
      message: strings.settle.settled,
      action: { label: strings.entry.undo, onAction: () => { deleteSettlement(id); } },
      duration: 5000,
    });
    onDone();
    return true;
  };

  const submit = (e: SyntheticEvent) => {
    e.preventDefault();
    if (done.current) return;
    if (editing) {
      const d = draft(request.row.method === 'monzo' ? 'monzo' : 'other');
      if (!d) return;
      const before = request.row;
      try {
        editSettlement(before.id, d);
      } catch (err) {
        setError(plainError(err));
        return;
      }
      done.current = true;
      toast.show({
        message: strings.entry.saved,
        action: {
          label: strings.entry.undo,
          onAction: () => { editSettlement(before.id, { amount: pence(before.amount_pence), date: before.date, note: before.note }); },
        },
        duration: 5000,
      });
      onDone();
      return;
    }
    const d = draft('other');
    if (d) record(d);
  };

  const payWithMonzo = () => {
    const d = draft('monzo');
    if (!d || !monzoName) return;
    // The question carries this sheet's row id and who asked, so it records one row wherever it is answered.
    const pending: PendingMonzo = { id: rowId, by: people.me?.id ?? '', from: d.from, to: d.to, amount: d.amount, date: d.date, note: d.note ?? null };
    // The question waits for the person's return (SET-2); it is kept on the phone, so it survives the app
    // being closed on the way (Q-U2).
    question.ask(pending);
    setAsking(pending);
    window.open(monzoLink(monzoName, d.amount), '_blank', 'noopener,noreferrer');
  };

  /** "Not yet" (or the sheet put away): the question stays, as a quiet banner on Home (Q-U2). */
  const notYet = () => {
    if (asking && !done.current) question.later(asking);
    onDone();
  };

  /** Q-U1: Enter in the amount saves nothing (Record it does), composing or not. */
  const amountKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') e.preventDefault();
  };

  if (asking) {
    const amount = formatPence(pence(asking.amount));
    return (
      <Sheet
        open={open}
        onOpenChange={(next) => { if (!next) notYet(); }}
        title={strings.settle.asked}
        footer={
          <div className="flex gap-3">
            <Button variant="plain" className="flex-1" onClick={notYet}>{strings.settle.notYet}</Button>
            <Button
              className="flex-1"
              onClick={() => {
                if (done.current) return;
                const answer = { from: asking.from, to: asking.to, amount: pence(asking.amount), date: asking.date, note: asking.note, method: 'monzo' as const };
                if (record(answer, asking.id ?? rowId)) {
                  question.forget();
                }
              }}
            >
              {strings.settle.yes}
            </Button>
          </div>
        }
      >
        <p className="text-note m-0">{strings.settle.askedLine(from?.name ?? '', to?.name ?? '', amount)}</p>
        {error ? <p role="alert" className="text-secondary text-berry mt-3 mb-0">{error}</p> : null}
      </Sheet>
    );
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => { if (!next) onDone(); }}
      title={editing ? strings.settle.editTitle : strings.settle.title}
      footer={
        <div className="flex flex-col gap-2">
          {error ? <p role="alert" className="text-secondary text-berry m-0">{error}</p> : null}
          {editing ? (
            <Button type="submit" form="settle-form" block>{strings.settle.save}</Button>
          ) : monzoName ? (
            <div className="flex flex-wrap gap-3">
              <Button variant="plain" type="submit" form="settle-form" className="flex-auto">{strings.settle.recordIt}</Button>
              <Button className="flex-auto" onClick={payWithMonzo}>{strings.settle.payWithMonzo}</Button>
            </div>
          ) : (
            <Button type="submit" form="settle-form" block>
              {recordsTheirs ? strings.settle.recordTheirs(from?.name ?? '') : strings.settle.recordIt}
            </Button>
          )}
        </div>
      }
    >
      <form id="settle-form" onSubmit={submit} noValidate className="flex flex-col gap-5">
        <p className="text-note m-0 flex items-center gap-2">
          {from ? <Head animal={from.animal} size={32} mood="sheepish" /> : null}
          <span className="min-w-0 break-words">{(recordsTheirs ? strings.settle.paid : strings.settle.who)(from?.name ?? '', to?.name ?? '')}</span>
          {to ? <Head animal={to.animal} size={32} mood="pleased" /> : null}
        </p>
        <Field
          label={strings.settle.amount}
          variant="amount"
          value={amountText}
          onChange={(e) => { setAmountText(e.target.value); setError(null); }}
          onKeyDown={amountKey}
          enterKeyHint="done"
        />
        {/* A fixed place for the line, so it never moves what is under it. */}
        {!editing ? <p className="text-secondary text-ink-2 m-0 -mt-3 min-h-[1.4rem]" aria-live="polite">{overLine}</p> : null}
        {!editing && payer && !monzoName && to ? <p className="text-secondary text-ink-2 m-0">{strings.settle.noMonzo(to.name)}</p> : null}
        <Disclosure label={strings.entry.moreDetails} open={more} onOpenChange={setMore}>
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2" role="group" aria-label={strings.entry.date}>
              <Chip selected={date === today} onSelectedChange={() => { setDate(today); }}>{strings.entry.today}</Chip>
              <Chip selected={date === yesterdayOf(today)} onSelectedChange={() => { setDate(yesterdayOf(today)); }}>{strings.entry.yesterday}</Chip>
              {date !== today && date !== yesterdayOf(today) ? <Chip selected>{formatDay(date, today)}</Chip> : null}
            </div>
            <Field label={strings.settle.note} value={note} onChange={(e) => { setNote(e.target.value); }} onKeyDown={holdEnterWhileComposing} enterKeyHint="done" />
          </div>
        </Disclosure>
      </form>
    </Sheet>
  );
}
