/**
 * Bills (S3; REC-7, REC-8, DESIGN §4.5): "What home costs" in one sentence, then one view at a time: this
 * month as a calendar (posted and due days marked, the month's total), the next 30 days as a list, or the
 * subscriptions with their cost a month and a year. Every figure is the core's (bills/model.ts). Tapping a
 * bill opens its regular payment to edit, pause or end. Paused and ended ones wait at the bottom.
 */
import { useId, useMemo, useState } from 'react';
import { formatDate, monthWeeks, type IsoDate } from '../../core/dates';
import { formatPence, pence } from '../../core/money';
import { useDataLayer, useEntries, useRecurring, type RecurringRow } from '../../data';
import { Button, Segmented } from '../../ui/primitives';
import { cx } from '../../ui/primitives/util';
import { strings } from '../../ui/strings';
import { NO_ENTRIES } from '../shared/empty';
import { useSheets } from '../sheets';
import { homeCostPerMonth, isRunning, monthView, next30, subscriptions } from './model';

type View = 'month' | 'next' | 'subs';
const NO_TEMPLATES: RecurringRow[] = [];

export function Bills() {
  const layer = useDataLayer();
  const today = layer.today();
  const templates = useRecurring().data ?? NO_TEMPLATES;
  const sheets = useSheets();
  const [view, setView] = useState<View>('month');
  const costsId = useId();
  const perMonth = useMemo(() => homeCostPerMonth(templates, today), [templates, today]);
  const stopped = useMemo(() => templates.filter((t) => !isRunning(t, today)), [templates, today]);
  const open = (id: string) => { sheets.openEntry({ mode: 'recurring', id }); };

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-16">
      <h1 className="text-title m-0 flex min-h-12 items-center">{strings.bills.title}</h1>

      <section aria-labelledby={costsId} className="flex flex-col gap-3">
        <h2 id={costsId} className="text-subtitle text-ink-2 m-0">{strings.bills.costs}</h2>
        <p className="text-sentence nums-list m-0">{strings.bills.perMonth(formatPence(perMonth))}</p>
        {templates.length === 0 ? <p className="text-secondary text-ink-2 m-0">{strings.bills.none}</p> : null}
        <div>
          <Button onClick={() => { sheets.openEntry({ mode: 'recurring' }); }}>{strings.bills.add}</Button>
        </div>
      </section>

      {templates.length > 0 ? (
        <>
          <Segmented
            label={strings.bills.view}
            options={[
              { value: 'month', label: strings.bills.thisMonth },
              { value: 'next', label: strings.bills.next30 },
              { value: 'subs', label: strings.bills.subscriptions },
            ]}
            value={view}
            onValueChange={setView}
          />
          {view === 'month' ? <ThisMonth templates={templates} today={today} /> : null}
          {view === 'next' ? <Next30 templates={templates} today={today} onOpen={open} /> : null}
          {view === 'subs' ? <Subscriptions templates={templates} today={today} onOpen={open} /> : null}
        </>
      ) : null}

      {stopped.length > 0 ? (
        <section aria-labelledby={`${costsId}-stopped`} className="flex flex-col">
          <h2 id={`${costsId}-stopped`} className="text-heading rule-ledger m-0">{strings.bills.later}</h2>
          <ul aria-labelledby={`${costsId}-stopped`} className="m-0 list-none p-0">
            {stopped.map((t) => (
              <li key={t.id} className="border-line border-b last:border-b-0">
                <Row
                  label={t.description}
                  detail={t.active ? strings.bills.ended : strings.bills.paused}
                  amount={formatPence(pence(t.amount_pence))}
                  onClick={() => { open(t.id); }}
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

/** A tappable bill row: the description and its detail on the left, the amount on the right. */
function Row({ label, detail, amount, onClick }: { label: string; detail: string; amount: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={`${label}, ${detail}, ${amount}`}
      onClick={onClick}
      className="press flex min-h-14 w-full min-w-0 items-center gap-3 py-2.5 text-left"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body text-ink truncate">{label}</span>
        <span className="text-secondary text-ink-2 truncate">{detail}</span>
      </span>
      <span className="text-body nums-list text-ink shrink-0 text-right">{amount}</span>
    </button>
  );
}

function ThisMonth({ templates, today }: { templates: readonly RecurringRow[]; today: IsoDate }) {
  const entries = useEntries().data ?? NO_ENTRIES;
  const view = useMemo(() => monthView(templates, entries, today), [templates, entries, today]);
  const titleId = useId();
  const [year, month] = [Number(today.slice(0, 4)), Number(today.slice(5, 7))];
  const title = strings.datePicker.month(strings.datePicker.months[month - 1] ?? '', year);
  const names = (xs: string[]) => [...new Set(xs)].join(', ');
  return (
    <section className="flex flex-col gap-3">
      <h2 id={titleId} className="text-heading m-0">{title}</h2>
      <div role="grid" aria-labelledby={titleId} className="-mx-3.5 flex flex-col">
        <div role="row" className="grid grid-cols-7">
          {strings.datePicker.weekdays.map(([letter, name], i) => (
            <span key={i} role="columnheader" className="text-caption text-ink-2 flex h-6 items-center justify-center">
              <span aria-hidden="true">{letter}</span>
              <span className="sr-only">{name}</span>
            </span>
          ))}
        </div>
        {monthWeeks(today).map((week, w) => (
          <div key={w} role="row" className="grid grid-cols-7">
            {week.map((day, i) => {
              if (day === null) return <span key={i} role="gridcell" className="h-12" />;
              const marks = view.days.get(day);
              const posted = marks && marks.posted.length > 0 ? names(marks.posted) : null;
              const due = marks && marks.due.length > 0 ? names(marks.due) : null;
              const what = posted && due ? strings.bills.dayBoth(posted, due) : posted ? strings.bills.dayPosted(posted) : due ? strings.bills.dayDue(due) : null;
              const name = formatDate(day, today);
              return (
                <span
                  key={day}
                  role="gridcell"
                  aria-label={what ? strings.bills.dayLabel(name, what) : name}
                  aria-current={day === today ? 'date' : undefined}
                  className="flex h-12 flex-col items-center justify-center gap-0.5"
                >
                  <span aria-hidden="true" className={cx(
                      'text-body nums-list inline-flex size-8 items-center justify-center rounded-full leading-none',
                      day === today ? 'bg-forest-tint text-forest font-semibold' : day < today ? 'text-ink-2' : 'text-ink',
                    )}>
                    {Number(day.slice(8, 10))}
                  </span>
                  <span aria-hidden="true" className="flex h-1.5 items-center gap-0.5">
                    {posted ? <span className="bg-forest size-1.5 rounded-full" /> : null}
                    {due ? <span className="border-forest size-1.5 rounded-full border" /> : null}
                  </span>
                </span>
              );
            })}
          </div>
        ))}
      </div>
      <p className="text-body nums-list m-0">{strings.bills.monthTotal(formatPence(view.total))}</p>
    </section>
  );
}

function Next30({ templates, today, onOpen }: { templates: readonly RecurringRow[]; today: IsoDate; onOpen: (id: string) => void }) {
  const bills = useMemo(() => next30(templates, today), [templates, today]);
  const id = useId();
  return (
    <section className="flex flex-col">
      <h2 id={id} className="text-heading rule-ledger m-0">{strings.bills.next30}</h2>
      {bills.length === 0 ? (
        <p className="text-secondary text-ink-2 mt-3 mb-0">{strings.bills.nothingSoon}</p>
      ) : (
        <ul aria-labelledby={id} className="m-0 list-none p-0">
          {bills.map((b) => {
            const amount = formatPence(b.amount);
            return (
              <li key={`${b.id}:${b.date}`} className="border-line border-b last:border-b-0">
                <Row
                  label={b.description}
                  detail={formatDate(b.date, today)}
                  amount={b.amountVaries ? strings.bills.about(amount) : amount}
                  onClick={() => { onOpen(b.id); }}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Subscriptions({ templates, today, onOpen }: { templates: readonly RecurringRow[]; today: IsoDate; onOpen: (id: string) => void }) {
  const subs = useMemo(() => subscriptions(templates, today), [templates, today]);
  const id = useId();
  return (
    <section className="flex flex-col">
      <h2 id={id} className="text-heading rule-ledger m-0">{strings.bills.subscriptions}</h2>
      {subs.lines.length === 0 ? (
        <p className="text-secondary text-ink-2 mt-3 mb-0">{strings.bills.noSubscriptions}</p>
      ) : (
        <>
          <ul aria-labelledby={id} className="m-0 list-none p-0">
            {subs.lines.map((l) => (
              <li key={l.template.id} className="border-line border-b last:border-b-0">
                <Row
                  label={l.template.description}
                  detail={strings.bills.aYear(formatPence(l.perYear))}
                  amount={strings.bills.aMonth(formatPence(l.perMonth))}
                  onClick={() => { onOpen(l.template.id); }}
                />
              </li>
            ))}
          </ul>
          <p className="text-body nums-list mt-3 mb-0">{strings.bills.yearInAll(formatPence(subs.perYear))}</p>
        </>
      )}
    </section>
  );
}
