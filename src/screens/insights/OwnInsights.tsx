/**
 * S10 (INS-10; owner, 25 Nov: "insights must include and be separately produced for each individual"): each person's
 * own regular payments, produced apart from the shared figures and never mixed with them. Every figure is the core's,
 * over that person's own entries alone (core/insights ownView), by the same rules as shared spending: this month
 * against the usual pace (as Home), other periods against the same stretch before (comparisonPeriod); by category; the
 * month's own payments and their total; what their running own payments cost a month and a year (bills/model).
 */
import { useMemo } from 'react';
import { formatDay, type IsoDate } from '../../core/dates';
import { byCategory, comparisonPeriod, ownView, pace, periodOf, sharedSpend, type Period } from '../../core/insights';
import { formatPence, pence } from '../../core/money';
import { isDeleted, useAllEntries, useAllRecurring, useCategories, useDataLayer } from '../../data';
import { strings } from '../../ui/strings';
import { ownCosts } from '../bills/model';
import { NO_CATEGORIES, NO_ENTRIES } from '../shared/empty';
import { usePeople } from '../shared/people';
import type { Person } from '../shared/words';
import { Bars } from './Charts';
import { Figure } from './Insights';
import { ownPaceTail, toInsight } from './model';

/** One section per person with regular payments of their own (mine first). A chapter period shows this month. */
export function OwnInsights({ period, beforeWords }: { period: Period; beforeWords: string }) {
  const people = usePeople();
  const rows = useAllEntries().data ?? NO_ENTRIES;
  const templates = useAllRecurring().data;
  const owners = useMemo(() => {
    const has = new Set<string>();
    for (const e of rows) if (e.owner_id !== null && e.deleted_at === null) has.add(e.owner_id);
    for (const t of templates ?? []) if (t.owner_id !== null && !isDeleted(t)) has.add(t.owner_id);
    return [...people.list].sort((a, b) => Number(b.id === people.me?.id) - Number(a.id === people.me?.id)).filter((p) => has.has(p.id));
  }, [rows, templates, people.list, people.me]);
  if (owners.length === 0) return null;
  return <>{owners.map((p) => <OwnFigure key={p.id} person={p} period={period} beforeWords={beforeWords} />)}</>;
}

function OwnFigure({ person, period: shown, beforeWords }: { person: Person; period: Period; beforeWords: string }) {
  const layer = useDataLayer();
  const today: IsoDate = layer.today();
  const rows = useAllEntries().data ?? NO_ENTRIES;
  const templates = useAllRecurring().data;
  const categories = useCategories().data ?? NO_CATEGORIES;
  // A person's own payments are never in a chapter: with a chapter picked, this month.
  const period = shown.kind === 'chapter' ? periodOf('month', today) : shown;
  const key = `${period.kind}:${String(period.from)}:${String(period.to)}`;
  const view = useMemo(() => ownView(rows.filter((e) => e.owner_id === person.id).map(toInsight), person.id), [rows, person.id]);
  const figures = useMemo(() => {
    const month = period.kind === 'month';
    const prev = month ? null : comparisonPeriod(view, period);
    const thisMonth = periodOf('month', today);
    return {
      total: sharedSpend(view, period),
      before: prev ? sharedSpend(view, prev) : null,
      monthPace: month ? pace(view, today) : null,
      cats: byCategory(view, period),
      monthTotal: sharedSpend(view, thisMonth),
      monthList: view.filter((e) => !e.deleted && e.date >= (thisMonth.from ?? '') && e.date <= today)
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.description.localeCompare(b.description))),
    };
    // `period` is rebuilt each render; its days (key) are what it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, key, today]);
  const costs = useMemo(() => ownCosts(templates ?? [], person.id, today), [templates, person.id, today]);

  const tail = figures.monthPace ? ownPaceTail(figures.monthPace, person.name) : '';
  const sentence = figures.monthPace
    ? `${formatPence(figures.monthPace.soFar)}${tail}`
    : figures.before === null ? strings.insights.totalIn(formatPence(figures.total))
    : figures.before === figures.total ? strings.insights.same(formatPence(figures.total), beforeWords)
    : strings.insights.comparison(formatPence(figures.total), formatPence(pence(Math.abs(figures.total - figures.before))), figures.total > figures.before, beforeWords);
  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? strings.insights.uncategorised;
  const catColour = (id: string | null) => categories.find((c) => c.id === id)?.colour;

  return (
    <Figure title={strings.insights.own(person.name)} define={strings.insights.ownDefine}>
      <div className="flex flex-col gap-4" data-own-insights={person.id}>
        <p className="text-secondary text-ink-2 m-0">{strings.insights.ownLine}</p>
        <p className="text-sentence nums-list m-0">{sentence}</p>
        <p className="text-body nums-list m-0">{strings.insights.ownRunning(formatPence(costs.perMonth), formatPence(costs.perYear))}</p>
        <div className="flex flex-col">
          <h3 className="text-subtitle text-ink-2 m-0">{strings.insights.ownThisMonth}</h3>
          {figures.monthList.length === 0 ? <p className="text-secondary text-ink-2 mt-2 mb-0">{strings.insights.ownNothing}</p> : (
            <ul aria-label={strings.insights.ownThisMonth} className="m-0 list-none p-0">
              {figures.monthList.map((e) => (
                <li key={e.id} className="border-line flex min-h-11 items-baseline justify-between gap-4 border-b py-2 last:border-b-0">
                  <span className="text-body min-w-0 break-words">{e.description} <span className="text-secondary text-ink-2">{formatDay(e.date, today)}</span></span>{' '}
                  <span className="text-body nums-list shrink-0">{formatPence(e.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-body nums-list mt-2 mb-0">{strings.insights.ownMonthTotal(formatPence(figures.monthTotal))}</p>
        </div>
        {figures.cats.length > 0 ? (
          <div className="flex flex-col gap-3">
            <h3 className="text-subtitle text-ink-2 m-0">{strings.insights.ownByCategory}</h3>
            <Bars
              label={`${strings.insights.own(person.name)}: ${strings.insights.ownByCategory}`}
              items={figures.cats.map((c) => ({ key: c.categoryId ?? 'none', name: catName(c.categoryId), amount: c.total, ...(catColour(c.categoryId) ? { colour: catColour(c.categoryId) } : {}) }))}
            />
          </div>
        ) : null}
      </div>
    </Figure>
  );
}
