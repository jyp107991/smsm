/**
 * The recap (S5b; INS-2, DESIGN §4.7): one screen, five parts: the headline; one stacked bar of where it went;
 * up to three notes; between you (what each paid, today's balance, Settle up); one moment. Template wording; the
 * figures are the core's (core/recap). From settle day on, the current month's recap is "so far".
 */
import { ArrowLeft } from 'lucide-react';
import { useId, useMemo, type ReactNode } from 'react';
import { formatDate } from '../../core/dates';
import { formatPence, pence } from '../../core/money';
import { recapOf } from '../../core/recap';
import { useBalance, useCategories, useDataLayer } from '../../data';
import { Button, ICON } from '../../ui/primitives';
import { go } from '../../ui/router';
import { strings } from '../../ui/strings';
import { NO_CATEGORIES } from '../shared/empty';
import { usePeople } from '../shared/people';
import { balanceWords } from '../shared/words';
import { useSheets } from '../sheets';
import { useRecapInput } from './recapData';

function seenKey(): string { return 'smsm-recap-seen'; }

export function markRecapSeen(month: string): void {
  try { localStorage.setItem(seenKey(), month); } catch { /* the banner shows again next time */ }
}

export function RecapPage({ month }: { month: string }) {
  const layer = useDataLayer();
  const today = layer.today();
  const input = useRecapInput();
  const categories = useCategories().data ?? NO_CATEGORIES;
  const people = usePeople();
  const balance = useBalance();
  const sheets = useSheets();
  const current = month === today.slice(0, 7);
  const recap = useMemo(() => (input ? recapOf(input, month, current ? today : undefined) : null), [input, month, current, today]);
  if (recap) markRecapSeen(month);
  const name = strings.recap.monthName(month);
  const short = strings.recap.shortName(month);
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? strings.insights.uncategorised;
  const pounds = (p: number) => `£${Math.round(Math.abs(p) / 100).toLocaleString('en-GB')}`;

  const header = (
    <header className="flex flex-col gap-2">
      <div className="flex min-h-12 items-center">
        <button
          type="button"
          onClick={() => { go({ name: 'insights' }); }}
          className="text-ink press -ml-2.5 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2.5"
        >
          <ArrowLeft size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" />
          {strings.recap.back}
        </button>
      </div>
      <h1 className="text-title m-0">{name}</h1>
    </header>
  );
  if (!recap) return <div className="mx-auto flex max-w-lg flex-col gap-6 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-16">{header}</div>;

  const against = recap.againstUsual;
  const headline = strings.recap.cost(`${short}${current ? strings.recap.soFarSuffix : ''}`, formatPence(recap.total))
    + (against === null ? strings.recap.noUsual : against === 0 ? strings.recap.aboutUsual
      : against < 0 ? strings.recap.lessThanUsual(pounds(against)) : strings.recap.moreThanUsual(pounds(against)));
  const owes = balance.status === 'ready' && balance.state.kind === 'owes';

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-8 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-16">
      {header}
      <article className="bg-surface flex flex-col gap-8 rounded-[20px] px-5 py-6">
        <Part title={strings.recap.headline} hidden>
          <p className="text-sentence nums-list m-0">{recap.total === 0 ? strings.recap.nothing : headline}</p>
        </Part>

        {recap.bar.length > 0 ? (
          <Part title={strings.recap.whereItWent}>
            <StackedBar items={recap.bar.map((b) => ({ key: b.rest ? 'rest' : (b.categoryId ?? 'none'), colour: b.rest ? 'stone' : (categories.find((c) => c.id === b.categoryId)?.colour ?? 'stone'), total: b.total }))} />
            <ul aria-label={strings.recap.whereItWent} className="m-0 list-none p-0">
              {recap.bar.map((b) => (
                <li key={b.rest ? 'rest' : (b.categoryId ?? 'none')} className="border-line flex min-h-11 items-baseline justify-between gap-4 border-b py-2 last:border-b-0">
                  <span className="text-body min-w-0 break-words">{b.rest ? strings.recap.everythingElse : catName(b.categoryId)}</span>{' '}
                  <span className="text-body nums-list shrink-0">{formatPence(b.total)}</span>
                </li>
              ))}
            </ul>
          </Part>
        ) : null}

        <Part title={strings.recap.notes}>
          {recap.notes.length === 0 ? <p className="text-secondary text-ink-2 m-0">{strings.recap.noNotes}</p> : (
            <ul aria-label={strings.recap.notes} className="m-0 flex list-none flex-col gap-2 p-0">
              {recap.notes.map((n, i) => <li key={i} className="text-body">{n.text}</li>)}
            </ul>
          )}
        </Part>

        <Part title={strings.recap.betweenYou}>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {people.list.map((p) => <li key={p.id} className="text-body nums-list">{strings.recap.paidLine(p.name, formatPence(recap.paid[p.id] ?? pence(0)))}</li>)}
          </ul>
          {balance.status === 'ready' ? (
            <p className="text-body m-0">{(() => { const w = balanceWords(balance.state, people.name); return `${w.words}${w.amount ?? ''}`; })()}</p>
          ) : null}
          {owes ? <div><Button variant="plain" onClick={() => { sheets.openSettle({ mode: 'new' }); }}>{strings.home.settleUp}</Button></div> : null}
        </Part>

        {recap.moment ? (
          <Part title={strings.recap.moment}>
            <a
              href={`/entry/${recap.moment.id}`}
              onClick={(e) => { e.preventDefault(); if (recap.moment) go({ name: 'entry', id: recap.moment.id }); }}
              className="text-forest text-body inline-flex min-h-11 items-center underline underline-offset-4"
            >
              {strings.recap.momentLine(recap.moment.description, formatPence(recap.moment.amount), formatDate(recap.moment.date, today))}
            </a>
          </Part>
        ) : null}
      </article>
    </div>
  );
}

function Part({ title, hidden = false, children }: { title: string; hidden?: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id} className={hidden ? 'sr-only' : 'text-subtitle text-ink-2 m-0'}>{title}</h2>
      {children}
    </section>
  );
}

/** One bar, the categories side by side by size (decoration: the list below says the same in words). */
function StackedBar({ items }: { items: readonly { key: string; colour: string; total: number }[] }) {
  const sum = items.reduce((t, i) => t + Math.max(0, i.total), 0) || 1;
  return (
    <div aria-hidden="true" className="flex h-4 w-full overflow-hidden rounded-full">
      {items.map((i) => (
        <span key={i.key} style={{ width: `${String((Math.max(0, i.total) / sum) * 100)}%`, background: `var(--cat-${i.colour})` }} />
      ))}
    </div>
  );
}
