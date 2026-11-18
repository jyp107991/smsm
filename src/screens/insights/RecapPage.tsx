/**
 * The recap (S5b; INS-2, DESIGN §4.7): one screen, five parts: the headline; one stacked bar of where it went;
 * up to three notes; between you (what each paid, today's balance, Settle up); one moment. Template wording; the
 * figures are the core's (core/recap). From settle day on, the current month's recap is "so far".
 */
import { ArrowLeft } from 'lucide-react';
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { formatShortDate } from '../../core/dates';
import { formatPence, pence } from '../../core/money';
import { recapOf } from '../../core/recap';
import { recapWording, useBalance, useCategories, useDataLayer, useHousehold } from '../../data';
import { Button, ICON } from '../../ui/primitives';
import { go } from '../../ui/router';
import { strings } from '../../ui/strings';
import { NO_CATEGORIES } from '../shared/empty';
import { usePeople } from '../shared/people';
import { balanceWords } from '../shared/words';
import { useSheets } from '../sheets';
import { useRecapInput } from './recapData';
import { markRecapSeen } from './seen';

export function RecapPage({ month }: { month: string }) {
  const layer = useDataLayer();
  const today = layer.today();
  const input = useRecapInput();
  const categories = useCategories().data ?? NO_CATEGORIES;
  const people = usePeople();
  const balance = useBalance();
  const sheets = useSheets();
  const settleDay = useHousehold().data?.settle_day ?? null;
  const thisMonth = today.slice(0, 7);
  // A month has its recap once it is over, or from settle day on for the month so far (brief); never a future or
  // malformed month.
  const valid = /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
    && (month < thisMonth || (month === thisMonth && settleDay !== null && Number(today.slice(8, 10)) >= settleDay));
  const recap = useMemo(() => (input && valid ? recapOf(input.entries, input.settlements, input.people, month, {
    today, names: input.names, categories: input.categories, templates: input.templates, commentCounts: input.commentCounts,
  }) : null), [input, valid, month, today]);
  const seen = recap === null ? null : recap.soFar;
  // INS-2: a finished month's wording by the AI when there is some (kept once for both of you, every figure checked);
  // the template sentence otherwise.
  const [wording, setWording] = useState<{ month: string; headline: string; aside: string | null } | null>(null);
  const finished = recap !== null && !recap.soFar;
  useEffect(() => {
    if (!finished) return;
    let live = true;
    void recapWording(month).then((w) => { if (live) setWording(w ? { month, ...w } : null); });
    return () => { live = false; };
  }, [finished, month, input]);
  useEffect(() => { if (seen !== null) markRecapSeen(month, seen); }, [seen, month]);
  const name = strings.recap.monthName(month);
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? strings.insights.uncategorised;

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
  if (!recap) {
    return (
      <div className="mx-auto flex max-w-lg flex-col gap-6 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-16">
        {header}
        {input && !valid ? <p className="text-body text-ink-2 m-0">{strings.recap.noRecap}</p> : null}
      </div>
    );
  }
  // A month with only money back (or more back than spent) is a month with nothing spent together (review).
  const spent = recap.total > 0;

  const owes = balance.status === 'ready' && balance.state.kind === 'owes';

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-8 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-16">
      {header}
      <article className="bg-surface flex flex-col gap-8 rounded-[20px] px-5 py-6">
        <Part title={strings.recap.headline} hidden>
          <p className="text-sentence nums-list m-0">{spent ? (wording?.month === month ? wording.headline : recap.headline) : strings.recap.nothing}</p>
          {spent && wording?.month === month && wording.aside ? <p className="text-body text-ink-2 m-0">{wording.aside}</p> : null}
        </Part>

        {recap.bar.length > 0 ? (
          <Part title={strings.recap.whereItWent}>
            <StackedBar items={recap.bar.map((b) => ({ key: b.categoryId ?? (b.name ? 'rest' : 'none'), colour: b.categoryId === null ? 'stone' : (categories.find((c) => c.id === b.categoryId)?.colour ?? 'stone'), total: b.total }))} />
            <ul aria-label={strings.recap.whereItWent} className="m-0 list-none p-0">
              {recap.bar.map((b) => (
                <li key={b.categoryId ?? (b.name ? 'rest' : 'none')} className="border-line flex min-h-11 items-baseline justify-between gap-4 border-b py-2 last:border-b-0">
                  <span className="text-body min-w-0 break-words">{b.name || catName(b.categoryId)}</span>{' '}
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
            {spent ? people.list.map((p) => <li key={p.id} className="text-body nums-list">{strings.recap.paidLine(p.name, formatPence(recap.paid[p.id] ?? pence(0)))}</li>) : null}
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
              {strings.recap.momentLine(recap.moment.description, formatPence(recap.moment.amount), formatShortDate(recap.moment.date, today))}
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
