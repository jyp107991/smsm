/**
 * Year in review (S5b; INS-7): a short set of cards for a calendar year: the total; the top three categories;
 * month by month; the biggest expense; the year's chapters; who paid. Figures from core/recap.
 */
import { ArrowLeft } from 'lucide-react';
import { useId, useMemo, type ReactNode } from 'react';
import { formatDate } from '../../core/dates';
import { formatPence, pence } from '../../core/money';
import { yearOf } from '../../core/recap';
import { useCategories, useChapters, useDataLayer } from '../../data';
import { ICON } from '../../ui/primitives';
import { go } from '../../ui/router';
import { strings } from '../../ui/strings';
import { NO_CATEGORIES } from '../shared/empty';
import { usePeople } from '../shared/people';
import { Columns } from './Charts';
import { useRecapInput } from './recapData';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function markYearSeen(year: number): void {
  try { localStorage.setItem('smsm-year-seen', String(year)); } catch { /* offered again next time */ }
}

export function YearPage({ year }: { year: number }) {
  const layer = useDataLayer();
  const today = layer.today();
  const input = useRecapInput();
  const chapterRows = useChapters().data;
  const categories = useCategories().data ?? NO_CATEGORIES;
  const people = usePeople();
  const review = useMemo(() => (input ? yearOf(input.entries, (chapterRows ?? []).map((c) => ({ id: c.id, name: c.name })), input.people, year) : null), [input, chapterRows, year]);
  if (review) markYearSeen(year);
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? strings.insights.uncategorised;
  const y = String(year);
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-16">
      <header className="flex flex-col gap-2">
        <div className="flex min-h-12 items-center">
          <button type="button" onClick={() => { go({ name: 'insights' }); }} className="text-ink press -ml-2.5 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2.5">
            <ArrowLeft size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" />
            {strings.recap.back}
          </button>
        </div>
        <h1 className="text-title m-0">{strings.recap.yearTitle(y)}</h1>
      </header>
      {review ? (
        <>
          <Card title={strings.insights.total} hidden><p className="text-sentence nums-list m-0">{strings.recap.yearTotal(y, formatPence(review.total))}</p></Card>
          {review.topCategories.length > 0 ? (
            <Card title={strings.recap.topCategories}>
              <Lines items={review.topCategories.map((c) => ({ key: c.categoryId ?? 'none', name: catName(c.categoryId), amount: c.total }))} label={strings.recap.topCategories} />
            </Card>
          ) : null}
          <Card title={strings.recap.month}>
            <Columns label={strings.recap.month} items={review.months.map((m) => {
              const i = Number(m.month.slice(5, 7)) - 1;
              return { key: m.month, name: `${MONTHS[i] ?? ''} ${y}`, short: (MONTHS[i] ?? '').slice(0, 1), amount: m.total };
            })} />
          </Card>
          {review.biggest ? (
            <Card title={strings.recap.biggest}>
              <a
                href={`/entry/${review.biggest.id}`}
                onClick={(e) => { e.preventDefault(); if (review.biggest) go({ name: 'entry', id: review.biggest.id }); }}
                className="text-forest text-body inline-flex min-h-11 items-center underline underline-offset-4"
              >
                {strings.recap.momentLine(review.biggest.description, formatPence(review.biggest.amount), formatDate(review.biggest.date, today))}
              </a>
            </Card>
          ) : null}
          {review.chapters.length > 0 ? (
            <Card title={strings.recap.chapters}>
              <Lines items={review.chapters.map((c) => ({ key: c.id, name: c.name, amount: c.total }))} label={strings.recap.chapters} />
            </Card>
          ) : null}
          <Card title={strings.recap.whoPaid}>
            <Lines items={people.list.map((p) => ({ key: p.id, name: p.name, amount: review.paid[p.id] ?? pence(0) }))} label={strings.recap.whoPaid} />
          </Card>
        </>
      ) : null}
    </div>
  );
}

function Card({ title, hidden = false, children }: { title: string; hidden?: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="bg-surface flex flex-col gap-3 rounded-[20px] px-5 py-5">
      <h2 id={id} className={hidden ? 'sr-only' : 'text-subtitle text-ink-2 m-0'}>{title}</h2>
      {children}
    </section>
  );
}

function Lines({ label, items }: { label: string; items: readonly { key: string; name: string; amount: number }[] }) {
  return (
    <ul aria-label={label} className="m-0 list-none p-0">
      {items.map((i) => (
        <li key={i.key} className="border-line flex min-h-11 items-baseline justify-between gap-4 border-b py-2 last:border-b-0">
          <span className="text-body min-w-0 break-words">{i.name}</span>{' '}
          <span className="text-body nums-list shrink-0">{formatPence(pence(i.amount))}</span>
        </li>
      ))}
    </ul>
  );
}
