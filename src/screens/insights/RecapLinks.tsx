/**
 * Where recaps are offered (S5b; INS-2, SET-4, INS-7, INS-8): on Insights, the last 12 finished months and every
 * year with entries; on Home, "The recap for October is ready" (until opened on this phone), on settle day the
 * month so far, through January the year in review, and now and then "A year ago: …".
 */
import { useId, useMemo, useState } from 'react';
import { addMonths, startOfMonth } from '../../core/dates';
import { formatPence, pence } from '../../core/money';
import { monthCard, onThisDay } from '../../core/recap';
import { useCategories, useChapters, useDataLayer, useEntries, useHousehold } from '../../data';
import { go } from '../../ui/router';
import { strings } from '../../ui/strings';
import { NO_CATEGORIES, NO_ENTRIES } from '../shared/empty';
import { toInsight } from './model';
import { useRecapInput } from './recapData';

import { read, recapSeen, settleSeen, write, yearSeen } from './seen';

function Linked({ to, children }: { to: Parameters<typeof go>[0]; children: string }) {
  const href = to.name === 'recap' ? `/recap/${to.month}` : to.name === 'year' ? `/year/${to.year}` : '/';
  return (
    <a href={href} onClick={(e) => { e.preventDefault(); go(to); }} className="text-forest text-body inline-flex min-h-11 items-center underline-offset-4 hover:underline">
      {children}
    </a>
  );
}

/** Insights: "Recaps" (the last 12 finished months, newest first; the month so far from settle day on) and "Years". */
export function RecapLists() {
  const layer = useDataLayer();
  const today = layer.today();
  const rows = useEntries().data ?? NO_ENTRIES;
  const recapsId = useId();
  const yearsId = useId();
  const settleDay = useHousehold().data?.settle_day ?? null;
  const categories = useCategories().data ?? NO_CATEGORIES;
  const { months, years } = useMemo(() => {
    const live = rows.filter((e) => e.deleted_at === null);
    const had = new Set(live.map((e) => e.date.slice(0, 7)));
    const thisMonth = startOfMonth(today);
    // The last 12 finished months once the household has any spending: a quiet month has a recap too (the brief and
    // its tests; DECISIONS 17 Nov).
    const ms: { month: string; soFar: boolean }[] = live.length === 0 ? []
      : Array.from({ length: 12 }, (_, i) => ({ month: addMonths(thisMonth, -(i + 1)).slice(0, 7), soFar: false }));
    // From settle day on, the month so far has its recap too (SET-4), first.
    if (settleDay !== null && Number(today.slice(8, 10)) >= settleDay) ms.unshift({ month: today.slice(0, 7), soFar: true });
    const ys = [...new Set([...had].map((m) => m.slice(0, 4)))].sort().reverse();
    // S9b (INS-4): each month as a card with its total and one line, the core's figures (as its recap's headline).
    const entries = ms.length === 0 ? [] : live.map(toInsight);
    const cards = ms.map((m) => {
      const card = monthCard(entries, m.month, today);
      return { ...m, total: card?.total ?? pence(0), top: card?.topCategoryId ?? null, anything: card !== null };
    });
    return { months: cards, years: ys };
  }, [rows, today, settleDay]);
  const nameOf = (id: string | null) => categories.find((c) => c.id === id)?.name ?? strings.insights.uncategorised;
  if (months.length === 0 && years.length === 0) return null;
  return (
    <>
      {months.length > 0 ? (
        <section aria-labelledby={recapsId} className="flex flex-col gap-2">
          <h2 id={recapsId} className="text-heading rule-ledger m-0">{strings.recap.recaps}</h2>
          {/* DESIGN §4.6: month cards (month, total, one line), newest first, as many to a row as fit (two on a phone). */}
          <ul aria-labelledby={recapsId} className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-3 p-0 pt-1">
            {months.map((m) => (
              <li key={m.month} className="flex min-w-0">
                {/* Named by its month; its total and line are read after it, as its description. */}
                <a
                  href={`/recap/${m.month}`}
                  onClick={(e) => { e.preventDefault(); go({ name: 'recap', month: m.month }); }}
                  aria-label={m.soFar ? strings.recap.soFarName(m.month) : strings.recap.monthName(m.month)}
                  aria-describedby={`${recapsId}-${m.month}-total ${recapsId}-${m.month}-line`}
                  className="bg-surface border-line press flex w-full min-w-0 flex-col gap-1 rounded-[16px] border px-4 py-3 no-underline"
                >
                  <span className="text-secondary text-ink-2">{m.soFar ? strings.recap.soFarName(m.month) : strings.recap.monthName(m.month)}</span>
                  <span id={`${recapsId}-${m.month}-total`} className="text-body text-ink nums-list">{formatPence(m.total)}</span>
                  <span id={`${recapsId}-${m.month}-line`} className="text-caption text-ink-2 line-clamp-2">{m.anything ? strings.recap.cardMostly(nameOf(m.top)) : strings.recap.cardNothing}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {years.length > 0 ? (
        <section aria-labelledby={yearsId} className="flex flex-col gap-2">
          <h2 id={yearsId} className="text-heading rule-ledger m-0">{strings.recap.years}</h2>
          <ul aria-labelledby={yearsId} className="m-0 flex list-none flex-wrap gap-x-4 p-0">
            {years.map((y) => <li key={y}><Linked to={{ name: 'year', year: y }}>{strings.recap.yearTitle(y)}</Linked></li>)}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/** Home: at most one recap offer (settle day, then last month's recap, then the year in review), and on this day. */
export function RecapBanners() {
  const layer = useDataLayer();
  const today = layer.today();
  const household = useHousehold().data ?? null;
  const rows = useEntries().data ?? NO_ENTRIES;
  const chapters = useChapters().data;
  const input = useRecapInput();
  const [, setHidden] = useState(0);
  const thisMonth = today.slice(0, 7);
  const lastMonth = addMonths(startOfMonth(today), -1).slice(0, 7);
  const day = Number(today.slice(8, 10));
  const hadLast = rows.some((e) => e.deleted_at === null && e.date.startsWith(lastMonth));
  const lastYear = String(Number(today.slice(0, 4)) - 1);
  const hadLastYear = rows.some((e) => e.deleted_at === null && e.date.startsWith(lastYear));
  const settleDay = household?.settle_day ?? null;

  let offer: { to: Parameters<typeof go>[0]; text: string } | null = null;
  if (settleDay !== null && day === settleDay && !settleSeen(thisMonth)) {
    offer = { to: { name: 'recap', month: thisMonth }, text: strings.recap.settleDay(strings.recap.shortName(thisMonth)) };
  } else if (hadLast && !recapSeen(lastMonth)) {
    offer = { to: { name: 'recap', month: lastMonth }, text: strings.recap.ready(strings.recap.shortName(lastMonth)) };
  } else if (today.slice(5, 7) === '01' && hadLastYear && !yearSeen(lastYear)) {
    offer = { to: { name: 'year', year: lastYear }, text: strings.recap.yearOffer(lastYear) };
  }

  const memory = input ? onThisDay(input.entries, input.commentCounts, today) : null;
  const memoryHidden = read('smsm-onthisday-hidden') === today;
  const where = memory ? (memory.place ?? chapters?.find((c) => c.id === memory.chapterId)?.name ?? null) : null;
  const memoryId = useId();

  return (
    <>
      {offer ? (
        <div className="bg-surface border-line flex rounded-[16px] border px-4 py-1">
          <Linked to={offer.to}>{offer.text}</Linked>
        </div>
      ) : null}
      {memory && !memoryHidden ? (
        <section aria-labelledby={memoryId} className="bg-surface border-line flex flex-col gap-2 rounded-[16px] border px-4 py-3">
          <h2 id={memoryId} className="text-caption text-ink-2 m-0">{strings.recap.onThisDay}</h2>
          <a
            href={`/entry/${memory.id}`}
            onClick={(e) => { e.preventDefault(); go({ name: 'entry', id: memory.id }); }}
            className="text-body text-ink inline-flex min-h-11 items-center break-words"
          >
            {strings.recap.aYearAgo(memory.description, formatPence(memory.amount), where)}
          </a>
          <div>
            <button
              type="button"
              onClick={() => { write('smsm-onthisday-hidden', today); setHidden((n) => n + 1); }}
              className="text-forest text-secondary press -ml-2 inline-flex min-h-11 items-center rounded-full px-2"
            >
              {strings.recap.notNow}
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
