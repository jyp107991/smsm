/**
 * List rows (DESIGN §4.4): ruled lines on paper. An entry row has its category emoji, the description, small
 * tags ("for Sam", "treat", "money back"), the payer's head and the amount right-aligned in tabular figures.
 * A settle-up is a distinct row: both heads and "Sam paid Jae £50.00". Each row is a link to its page.
 */
import type { MouseEvent, ReactNode } from 'react';
import { formatPence, pence } from '../../core/money';
import type { CategoryRow, ExpenseRow, SettlementRow } from '../../data';
import { cx } from '../../ui/primitives/util';
import { go, pathOf } from '../../ui/router';
import { strings } from '../../ui/strings';
import { Head } from './Head';
import { payerOf, penceOf, type Person } from './words';

function open(e: MouseEvent<HTMLAnchorElement>, id: string) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  go({ name: 'entry', id });
}

function Tag({ children }: { children: ReactNode }) {
  return <span className="text-caption text-ink-2 bg-sunk shrink-0 rounded-[8px] px-1.5 py-px">{children}</span>;
}

export function EntryRowView({ row, categories, people, pending = false }: {
  row: ExpenseRow;
  categories: readonly CategoryRow[];
  people: readonly Person[];
  pending?: boolean;
}) {
  const category = categories.find((c) => c.id === row.category_id);
  const payer = people.find((p) => p.id === payerOf(row.paid, people));
  const beneficiary = people.find((p) => p.id !== payer?.id && penceOf(row.shares, p.id) > 0);
  const back = row.kind === 'money_back';
  return (
    <a
      href={pathOf({ name: 'entry', id: row.id })}
      onClick={(e) => { open(e, row.id); }}
      className={cx('flex min-h-14 min-w-0 items-center gap-3 py-2 no-underline text-ink', row.deleted_at !== null && 'opacity-60')}
    >
      <span aria-hidden="true" className="w-7 shrink-0 text-center text-[1.125rem]">{category?.emoji ?? ''}</span>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="min-w-0 truncate">{row.description}</span>
        {back ? <Tag>{strings.entry.moneyBackTag}</Tag> : null}
        {!back && row.split_mode === 'for_other' && beneficiary ? <Tag>{strings.entry.forTag(beneficiary.name)}</Tag> : null}
        {!back && row.split_mode === 'treat' ? <Tag>{strings.entry.treatTag}</Tag> : null}
        {pending ? <span aria-hidden="true" className="bg-oak size-1.5 shrink-0 rounded-full" /> : null}
      </span>
      {payer ? <Head animal={payer.animal} size={22} /> : null}
      <span className="nums-list w-[5.75rem] shrink-0 text-right">{formatPence(pence(back ? -row.amount_pence : row.amount_pence))}</span>
    </a>
  );
}

export function SettlementRowView({ row, people }: { row: SettlementRow; people: readonly Person[] }) {
  const from = people.find((p) => p.id === row.from_user);
  const to = people.find((p) => p.id === row.to_user);
  return (
    <a
      href={pathOf({ name: 'entry', id: row.id })}
      onClick={(e) => { open(e, row.id); }}
      className={cx('text-ink flex min-h-14 min-w-0 items-center gap-3 py-2 no-underline', row.deleted_at !== null && 'opacity-60')}
    >
      <span className="flex w-7 shrink-0 justify-center -space-x-2" aria-hidden="true">
        {from ? <Head animal={from.animal} size={18} /> : null}
        {to ? <Head animal={to.animal} size={18} /> : null}
      </span>
      <span className="text-moss min-w-0 flex-1 truncate">
        {strings.activity.settled(from?.name ?? '', to?.name ?? '', formatPence(pence(row.amount_pence)))}
      </span>
    </a>
  );
}
