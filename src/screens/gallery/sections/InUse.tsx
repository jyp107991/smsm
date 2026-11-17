/**
 * Gallery: realistic pieces in use (DESIGN §7): entry rows grouped by day and a recap card, from the seeded
 * demo household. Figures come from the core; this page does no money maths of its own beyond summing rows
 * the way the recap will (S5 replaces this with the real recap code).
 */
import type { ReactNode } from 'react';
import { demoHousehold, JAE } from '../../../../tests/fixtures/household';
import { formatDay, todayIn } from '../../../core/dates';
import { formatPence, pence } from '../../../core/money';
import { PreviewLinks } from '../Previews';
import { AddSheetExample } from './AddSheet';
import { Section } from './Section';

type Slot = (who: string) => ReactNode;

export function InUseSection({ head }: { head?: Slot }) {
  const today = todayIn(new Date(), 'Europe/London');
  const h = demoHousehold(today);
  const name = (id: string) => h.members.find((m) => m.user_id === id)?.display_name ?? '';
  const cat = (id: string | null) => h.categories.find((c) => c.id === id);
  const payerOf = (paid: unknown) => Object.entries(paid as Record<string, number>).find(([, v]) => v > 0)?.[0] ?? JAE;

  const recent = h.expenses.slice(0, 9);
  const days = [...new Set(recent.map((e) => e.date))];

  // Last full month, for the recap card.
  const month = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
  month.setUTCMonth(month.getUTCMonth() - 1);
  const ym = month.toISOString().slice(0, 7);
  const monthName = month.toLocaleString('en-GB', { month: 'long', timeZone: 'UTC' });
  const inMonth = h.expenses.filter((e) => e.date.startsWith(ym) && e.chapter_id === null && e.split_mode !== 'for_other' && e.deleted_at === null);
  const byCat = new Map<string, number>();
  for (const e of inMonth) byCat.set(e.category_id ?? '', (byCat.get(e.category_id ?? '') ?? 0) + (e.kind === 'money_back' ? -1 : 1) * e.amount_pence);
  const total = [...byCat.values()].reduce((t, v) => t + v, 0);
  const top = [...byCat.entries()].sort((a, b) => b[1] - a[1]);
  const top4 = top.slice(0, 4);
  const rest = top.slice(4).reduce((t, [, v]) => t + v, 0);
  const bars = [...top4.map(([id, v]) => ({ label: cat(id)?.name ?? 'Other', colour: `var(--cat-${cat(id)?.colour ?? 'stone'}, var(--oak))`, v })), { label: 'The rest', colour: 'var(--sunk)', v: rest }];

  return (
    <Section id="g-inuse" title="On the page" ask="A week of Jae and Sam’s spending, the add sheet and last month’s recap.">
      <div className="flex flex-col gap-2">
        <h3 className="text-subtitle m-0">Other screens</h3>
        <PreviewLinks />
      </div>

      <div className="bg-paper rounded-[20px] px-4 py-2">
        {days.map((d) => (
          <div key={d}>
            <h3 className="text-subtitle text-ink-2 mt-4 mb-1">{formatDay(d, today)}</h3>
            <ul className="m-0 list-none p-0">
              {recent.filter((e) => e.date === d).map((e) => (
                <li key={e.id} className="border-line flex min-h-11 items-center gap-3 border-b py-2 last:border-b-0">
                  <span aria-hidden="true" className="w-6 text-center">{cat(e.category_id)?.emoji}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {e.description}
                    {e.split_mode === 'treat' && <span className="text-ink-2 ml-2 text-[0.8125rem]">treat</span>}
                    {e.split_mode === 'for_other' && <span className="text-ink-2 ml-2 text-[0.8125rem]">for {name(Object.entries(e.shares as Record<string, number>).find(([, v]) => v > 0)?.[0] ?? '')}</span>}
                    {e.kind === 'money_back' && <span className="text-ink-2 ml-2 text-[0.8125rem]">money back</span>}
                  </span>
                  {head ? head(payerOf(e.paid)) : <span className="text-ink-2 text-[0.8125rem]">{name(payerOf(e.paid))}</span>}
                  <span className="nums-list w-24 text-right">{formatPence(pence(e.amount_pence))}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <AddSheetExample />

      <article aria-label={`${monthName} recap`} className="bg-surface shadow-float flex flex-col gap-3 rounded-[20px] p-5">
        <h3 className="text-title rule-ledger m-0">{monthName}</h3>
        <p className="text-note m-0">Together, {monthName} came to {formatPence(pence(total))}.</p>
        <div className="flex h-4 w-full overflow-hidden rounded-full" role="img" aria-label={bars.map((b) => `${b.label} ${formatPence(pence(b.v))}`).join(', ')}>
          {bars.map((b) => <span key={b.label} style={{ width: `${String((100 * b.v) / Math.max(total, 1))}%`, background: b.colour }} />)}
        </div>
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[0.9375rem]">
          {bars.map((b) => (
            <li key={b.label} className="flex justify-between gap-3"><span>{b.label}</span><span className="nums-list">{formatPence(pence(b.v))}</span></li>
          ))}
        </ul>
      </article>
    </Section>
  );
}
