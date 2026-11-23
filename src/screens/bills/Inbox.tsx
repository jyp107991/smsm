/**
 * The Inbox (S3; INB-1, INB-2, INB-3, REC-3): a bill whose amount varies waits here on its day, one card at a
 * time with a counter. Keep opens the Add sheet prefilled from its regular payment (the amount at its usual
 * figure, to change); saving it makes the entry and clears the card. "Usually £90.00" (S9a, DESIGN §4.9) keeps it
 * at that amount in one tap. Not ours clears it without money, with Undo. Until then it is not money: the balance
 * and Activity leave it out.
 *
 * S7 (IMP-3, INB-1): after the database's own items, under the same counter, the bank rows being reviewed on this
 * phone, one card at a time in date order: Keep (an entry at once, with Undo), Change first (the Add sheet,
 * prefilled), Not ours (only a hash is kept, with Undo), "Always do this for …", and Stop reviewing.
 */
import { ArrowLeft } from 'lucide-react';
import { useId, useState } from 'react';
import { formatDate, isIsoDate, type IsoDate } from '../../core/dates';
import { formatPence, formatPlainPounds, pence } from '../../core/money';
import {
  dismissInboxItem, keepImportNow, keepInboxItem, reopenInboxItem, skipImportNow, stopReviewing, undoKeep, undoSkip, unkeepInboxItem, useCategories, useDataLayer, useHousehold,
  useImportQueue, useInbox, useRecurring, type ImportCard, type InboxItemRow, type RecurringRow,
} from '../../data';
import { Button, ICON, useToast } from '../../ui/primitives';
import { go } from '../../ui/router';
import { strings } from '../../ui/strings';
import { draftOf, type FormState } from '../entry/form';
import { formFromTemplate } from '../entry/schedule';
import { usePeople } from '../shared/people';
import { plainError } from '../shared/plain';
import { useSheets } from '../sheets';

interface Bill { description: string; estimate: number; date: IsoDate; categoryId: string | null }

/** What an Inbox bill says about itself (its payload), read defensively. */
export function billOf(item: InboxItemRow): Bill {
  const p = (item.payload && typeof item.payload === 'object' && !Array.isArray(item.payload) ? item.payload : {}) as Record<string, unknown>;
  const date = typeof p.date === 'string' && isIsoDate(p.date) ? p.date : (item.occurrence_date ?? item.created_at.slice(0, 10));
  return {
    description: typeof p.description === 'string' ? p.description : '',
    estimate: typeof p.estimate_pence === 'number' && Number.isSafeInteger(p.estimate_pence) && p.estimate_pence >= 0 ? p.estimate_pence : 0,
    date,
    categoryId: typeof p.category_id === 'string' ? p.category_id : null,
  };
}

export function Inbox() {
  const layer = useDataLayer();
  const today = layer.today();
  // A bill decided here leaves on the same render as the tap (the queue tells the list a moment later), so a quick
  // second tap never lands on the card that was under it.
  const [decided, setDecided] = useState<ReadonlySet<string>>(() => new Set());
  const all = useInbox().data;
  const items = all?.filter((i) => !decided.has(i.id));
  const cards = useImportQueue();
  const total = (items?.length ?? 0) + (cards?.length ?? 0);
  const templates = useRecurring().data;
  const people = usePeople();
  const sheets = useSheets();
  const toast = useToast();
  const item = items?.[0];

  /** The bill as its regular payment would enter it (payer, split, category), at its day and the usual amount. */
  const billForm = (it: InboxItemRow, bill: Bill): Partial<FormState> => {
    const template: RecurringRow | undefined = templates?.find((t) => t.id === it.recurring_id);
    const base: Partial<FormState> = template ? formFromTemplate(template, people.list, bill.date) : {};
    return {
      ...base,
      amountText: bill.estimate > 0 ? formatPlainPounds(pence(bill.estimate)) : '',
      description: bill.description,
      categoryId: bill.categoryId ?? base.categoryId ?? null,
      categoryTouched: true,
      splitTouched: true,
      date: bill.date,
    };
  };
  /** REC-3 (S9a, DESIGN §4.9): "Usually £90.00": the person's tap keeps the bill at its usual amount, at once. */
  const keepUsual = (it: InboxItemRow, bill: Bill) => {
    const form = billForm(it, bill);
    const built = 'payer' in form ? draftOf(form as FormState, people.list) : null;
    if (!built || !('draft' in built)) {
      keep(it, bill);
      return;
    }
    try {
      keepInboxItem(it.id, built.draft);
      setDecided((d) => new Set([...d, it.id]));
      // INB-2 (S9a review): Undo takes the entry away (deleted, logged) and puts the bill back in the Inbox.
      const undo = () => {
        try {
          unkeepInboxItem(it.id);
        } catch (err) {
          toast.show({ message: plainError(err) });
          return;
        }
        setDecided((d) => new Set([...d].filter((x) => x !== it.id)));
      };
      toast.show({
        message: strings.entry.savedWhat(built.draft.description, formatPence(built.draft.amount)),
        action: { label: strings.entry.undo, onAction: undo },
        duration: 5000,
      });
    } catch (err) {
      toast.show({ message: plainError(err) });
    }
  };
  const keep = (it: InboxItemRow, bill: Bill) => {
    // SCAN-4: a receipt sorted later opens the Add sheet with its photo (read then, if smart features are on).
    if (it.source === 'scan' && it.receipt_path) {
      sheets.openEntry({ mode: 'add', inboxItem: it.id, receiptPath: it.receipt_path });
      return;
    }
    sheets.openEntry({ mode: 'add', inboxItem: it.id, prefill: billForm(it, bill) });
  };
  const dismiss = (it: InboxItemRow, bill: Bill) => {
    try {
      dismissInboxItem(it.id);
      setDecided((d) => new Set([...d, it.id]));
      // INB-2 (S9a): Undo puts it back in the Inbox.
      const undo = () => {
        try {
          reopenInboxItem(it.id);
        } catch (err) {
          toast.show({ message: plainError(err) });
          return;
        }
        setDecided((d) => new Set([...d].filter((x) => x !== it.id)));
      };
      toast.show({
        message: strings.inbox.dismissed(it.source === 'scan' ? strings.smart.receiptToSort : bill.description),
        action: { label: strings.entry.undo, onAction: undo },
        duration: 5000,
      });
    } catch (err) {
      toast.show({ message: plainError(err) });
    }
  };

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-16">
      <header className="flex flex-col gap-2">
        <div className="flex min-h-12 items-center">
          <button
            type="button"
            onClick={() => { go({ name: 'home' }); }}
            className="text-ink press -ml-2.5 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2.5"
          >
            <ArrowLeft size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" />
            {strings.settings.back}
          </button>
        </div>
        <h1 className="text-title m-0">{strings.inbox.title}</h1>
      </header>
      {items === undefined ? null : item !== undefined ? (
        <InboxCard
          key={item.id}
          item={item}
          count={total}
          today={today}
          onKeep={keep}
          onUsual={templates?.some((t) => t.id === item.recurring_id) ? keepUsual : null}
          onDismiss={dismiss}
        />
      ) : cards?.[0] ? (
        <ImportCardView key={cards[0].id} card={cards[0]} count={total} today={today} />
      ) : cards === undefined ? null : (
        <p className="text-note text-ink-2 m-0">{strings.inbox.nothing}</p>
      )}
    </div>
  );
}

function InboxCard({ item, count, today, onKeep, onUsual, onDismiss }: {
  item: InboxItemRow;
  count: number;
  today: IsoDate;
  onKeep: (it: InboxItemRow, bill: Bill) => void;
  /** REC-3: the one-tap answer, for a bill with its regular payment and a usual amount. */
  onUsual: ((it: InboxItemRow, bill: Bill) => void) | null;
  onDismiss: (it: InboxItemRow, bill: Bill) => void;
}) {
  const bill = billOf(item);
  const receipt = item.source === 'scan';
  return (
    <article className="bg-surface border-line flex flex-col gap-4 rounded-[16px] border px-5 py-5">
      <p className="text-caption text-ink-2 nums-list m-0">{strings.inbox.counter(1, count)}</p>
      {receipt ? (
        <>
          <p className="text-subtitle m-0 break-words">{strings.smart.receiptToSort}</p>
          <p className="text-secondary text-ink-2 m-0">{formatDate(item.created_at.slice(0, 10), today)}</p>
        </>
      ) : (
        <>
          <p className="text-subtitle m-0 break-words">{strings.inbox.due(bill.description)}</p>
          {onUsual && bill.estimate > 0 ? (
            <>
              <p className="text-secondary text-ink-2 nums-list m-0">{formatDate(bill.date, today)}</p>
              <div>
                <Button variant="plain" onClick={() => { onUsual(item, bill); }}>{strings.inbox.usually(formatPence(pence(bill.estimate)))}</Button>
              </div>
            </>
          ) : (
            <p className="text-secondary text-ink-2 nums-list m-0">{strings.inbox.usual(formatPence(pence(bill.estimate)), formatDate(bill.date, today))}</p>
          )}
        </>
      )}
      <div className="flex flex-wrap gap-3">
        <Button onClick={() => { onKeep(item, bill); }}>{strings.inbox.keep}</Button>
        <Button variant="plain" onClick={() => { onDismiss(item, bill); }}>{strings.inbox.notOurs}</Button>
      </div>
    </article>
  );
}

/** IMP-3: one bank row being reviewed on this phone. */
function ImportCardView({ card, count, today }: { card: ImportCard; count: number; today: IsoDate }) {
  const people = usePeople();
  const categories = useCategories().data;
  const home = useHousehold().data?.home_country ?? 'GB';
  const sheets = useSheets();
  const toast = useToast();
  const [always, setAlways] = useState(false);
  const alwaysId = useId();
  const category = categories?.find((c) => c.id === card.categoryId)?.name ?? null;
  const me = people.me?.name ?? '';
  const keep = () => {
    try {
      const id = keepImportNow(card.id, { always });
      toast.show({
        message: strings.imports.kept(card.description),
        action: { label: strings.imports.undo, onAction: () => { undoKeep(id); } },
        duration: 5000,
      });
    } catch (err) {
      toast.show({ message: plainError(err) });
    }
  };
  const skip = () => {
    try {
      skipImportNow(card.id, { always });
      toast.show({
        message: strings.imports.skipped(card.description),
        action: { label: strings.imports.undo, onAction: () => { void undoSkip(card.id); } },
        duration: 5000,
      });
    } catch (err) {
      toast.show({ message: plainError(err) });
    }
  };
  const change = () => {
    sheets.openEntry({
      mode: 'add',
      importCard: card.id,
      importAlways: always,
      prefill: {
        amountText: formatPlainPounds(card.amount),
        description: card.description,
        categoryId: card.categoryId,
        categoryTouched: true,
        date: card.date,
        notes: card.note ?? '',
        chapterId: null,
        country: home,
      },
    });
  };
  return (
    <>
      <article className="bg-surface border-line flex min-w-0 flex-col gap-4 rounded-[16px] border px-5 py-5">
        <p className="text-caption text-ink-2 nums-list m-0">{strings.inbox.counter(1, count)}</p>
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-subtitle m-0 [overflow-wrap:anywhere]">{card.description}</p>
          <p className="text-amount nums-list m-0">{formatPence(card.amount)}</p>
          <p className="text-secondary text-ink-2 m-0 break-words">
            {[formatDate(card.date, today), strings.imports.paidBy(me), category].filter((x) => x !== null && x !== '').join(' · ')}
          </p>
          {card.note ? <p className="text-secondary text-ink-2 m-0 break-words">{card.note}</p> : null}
        </div>
        <label htmlFor={alwaysId} className="press flex min-h-11 cursor-pointer items-center gap-3">
          <input
            id={alwaysId}
            type="checkbox"
            checked={always}
            onChange={(e) => { setAlways(e.target.checked); }}
            className="accent-forest size-5 shrink-0"
          />
          <span className="text-body min-w-0 [overflow-wrap:anywhere]">{strings.imports.always(card.description)}</span>
        </label>
        <div className="flex flex-wrap gap-3">
          <Button onClick={keep}>{strings.imports.keep}</Button>
          <Button variant="plain" onClick={change}>{strings.imports.changeFirst}</Button>
          <Button variant="plain" onClick={skip}>{strings.imports.notOurs}</Button>
        </div>
      </article>
      <div className="flex flex-col items-start gap-1">
        <Button variant="quiet" leading onClick={() => { void stopReviewing(); }}>{strings.imports.stop}</Button>
        <p className="text-secondary text-ink-2 m-0">{strings.imports.stopLine}</p>
      </div>
    </>
  );
}
