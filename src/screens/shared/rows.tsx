/**
 * List rows (DESIGN §4.4): ruled lines on paper. An entry row has its category emoji, the description, small
 * tags ("for Sam", "treat", "money back"), the payer's head and the amount right-aligned in tabular figures.
 * A settle-up is a distinct row: both heads and "Sam paid Jae £50.00". Each row is a link to its page.
 *
 * S2 polish Q-L15: the row is a grid (24 px mark, the description taking the room, the payer's head, the
 * amount only as wide as its figures), and its name says who paid ("Big shop, £79.08, Jae paid"). Q-L16: the
 * emoji sits on a small sunk disc. Rows carry `data-row` with their id, so the toast that reports one keeps
 * clear of it (Q-U8).
 */
import { MessageCircle } from 'lucide-react';
import { memo, type MouseEvent, type ReactNode } from 'react';
import { formatPence, pence } from '../../core/money';
import type { CategoryRow, ExpenseRow, SettlementRow } from '../../data';
import { cx } from '../../ui/primitives/util';
import { currentPath } from '../../ui/history';
import { go, parseRoute, pathOf } from '../../ui/router';
import { SharedHead } from '../../ui/rig/Animal';
import { strings } from '../../ui/strings';
import { CategoryMark, isPlaceholderEmoji } from './CategoryMark';
import { Head } from './Head';
import { payerOf, penceOf, type Person } from './words';

function open(e: MouseEvent<HTMLAnchorElement>, id: string) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  // S9b review: beside an open entry (Activity's two panes), another pick takes its place in history rather than
  // stacking up, so Back closes the pane instead of walking back through every entry looked at.
  const replace = e.currentTarget.closest('[data-panes-list]') !== null && parseRoute(currentPath()).name === 'entry';
  go({ name: 'entry', id }, { replace });
}

/** The grid every row shares (Q-L15): mark, description, head, amount. */
const ROW = 'press grid min-h-14 min-w-0 grid-cols-[24px_minmax(0,1fr)_auto_auto] items-center gap-x-2.5 py-2 no-underline';

function Tag({ children }: { children: ReactNode }) {
  return <span className="text-caption text-ink-2 bg-sunk shrink-0 rounded-[8px] px-1.5 py-px">{children}</span>;
}

/** S9: the payer's head as the rig (`Head`), or as a `<use>` of the page's shared head symbols (a long list). */
function PayerHead({ animal, size, shared }: { animal: 'cat' | 'dog'; size: number; shared: boolean }) {
  return shared ? <span aria-hidden="true" className="inline-flex shrink-0"><SharedHead kind={animal} size={size} /></span> : <Head animal={animal} size={size} />;
}

export const EntryRowView = memo(function EntryRowView({ row, categories, people, pending = false, comments = 0, shared = false }: {
  row: ExpenseRow;
  /** S9: draw the head from the shared symbols (`HeadSymbols` is on the page). */
  shared?: boolean;
  /** S5b (ACT-4): live comments on it, from the list's `useCommentCounts()`. */
  comments?: number;
  categories: readonly CategoryRow[];
  people: readonly Person[];
  pending?: boolean;
}) {
  const category = categories.find((c) => c.id === row.category_id);
  const payer = people.find((p) => p.id === payerOf(row.paid, people));
  const beneficiary = people.find((p) => p.id !== payer?.id && penceOf(row.shares, p.id) > 0);
  const back = row.kind === 'money_back';
  const amount = formatPence(pence(back ? -row.amount_pence : row.amount_pence));
  const tag = back ? strings.entry.moneyBackTag
    : row.split_mode === 'for_other' && beneficiary ? strings.entry.forTag(beneficiary.name)
    : row.split_mode === 'treat' ? strings.entry.treatTag : null;
  const who = payer ? (back ? strings.reading.gotBack(payer.name) : strings.reading.paid(payer.name)) : null;
  const name = strings.activity.row([
    row.description, amount, ...(tag ? [tag] : []), ...(who ? [who] : []), ...(comments > 0 ? [strings.comments.count(comments)] : []),
  ]);
  return (
    <a
      href={pathOf({ name: 'entry', id: row.id })}
      onClick={(e) => { open(e, row.id); }}
      aria-label={name}
      data-row={row.id}
      className={cx(ROW, 'text-ink', row.deleted_at !== null && 'opacity-60')}
    >
      {category ? <RowMark emoji={category.emoji} colour={category.colour} /> : <span aria-hidden="true" />}
      <span className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 truncate">{row.description}</span>
        {back ? <Tag>{strings.entry.moneyBackTag}</Tag> : null}
        {!back && row.split_mode === 'for_other' && beneficiary ? <Tag>{strings.entry.forTag(beneficiary.name)}</Tag> : null}
        {!back && row.split_mode === 'treat' ? <Tag>{strings.entry.treatTag}</Tag> : null}
        {comments > 0 ? <span aria-hidden="true" className="text-caption text-ink-2 nums-list inline-flex shrink-0 items-center gap-0.5"><MessageCircle size={13} strokeWidth={2} />{comments}</span> : null}
        {pending ? <span aria-hidden="true" className="bg-oak size-1.5 shrink-0 rounded-full" /> : null}
      </span>
      {payer ? <PayerHead animal={payer.animal} size={22} shared={shared} /> : <span aria-hidden="true" />}
      <span className="nums-list text-right whitespace-nowrap">{amount}</span>
    </a>
  );
});

/** Q-L16: a category's emoji on a small sunk disc, so it sits quietly beside the words; "Other" keeps its dot. */
function RowMark({ emoji, colour }: { emoji: string | null; colour: string }) {
  if (isPlaceholderEmoji(emoji)) return <CategoryMark emoji={emoji} colour={colour} className="flex size-6 items-center justify-center" />;
  return (
    <span aria-hidden="true" className="bg-sunk flex size-6 items-center justify-center rounded-full text-[0.8125rem] leading-none">
      {emoji}
    </span>
  );
}

export const SettlementRowView = memo(function SettlementRowView({ row, people, shared = false }: { row: SettlementRow; people: readonly Person[]; shared?: boolean }) {
  const from = people.find((p) => p.id === row.from_user);
  const to = people.find((p) => p.id === row.to_user);
  return (
    <a
      href={pathOf({ name: 'entry', id: row.id })}
      onClick={(e) => { open(e, row.id); }}
      data-row={row.id}
      className={cx(ROW, 'text-ink', row.deleted_at !== null && 'opacity-60')}
    >
      <span className="flex justify-center -space-x-1.5" aria-hidden="true">
        {from ? <PayerHead animal={from.animal} size={15} shared={shared} /> : null}
        {to ? <PayerHead animal={to.animal} size={15} shared={shared} /> : null}
      </span>
      <span className="text-moss col-span-3 min-w-0 truncate">
        {strings.activity.settled(from?.name ?? '', to?.name ?? '', formatPence(pence(row.amount_pence)))}
      </span>
    </a>
  );
});
