/**
 * S7 (EXP-1, OFF-3): the monthly statement at /statement/YYYY-MM. The two names, the month, the balance at the
 * start (everything before the month) and at the end (everything up to its last day), every live entry and
 * settle-up of the month with who paid and each share, the totals each person paid and shared, and the day it was
 * made. Every figure is the core's (core/statement over netPositions), from the phone's copy, so it works offline.
 * "Save as PDF" opens the phone's print sheet; the print stylesheet (app.css) prints it light, without navigation.
 */
import { ArrowLeft } from 'lucide-react';
import { useId, useMemo } from 'react';
import { balanceState } from '../../core/balance';
import { formatShortDate, type IsoDate } from '../../core/dates';
import { formatPence, pence } from '../../core/money';
import { statement, type StatementRow } from '../../core/statement';
import { useDataLayer, useEntries, useSettlements } from '../../data';
import { Button, ICON } from '../../ui/primitives';
import { go } from '../../ui/router';
import { strings } from '../../ui/strings';
import { toInsight, toSettle } from '../insights/model';
import { usePeople } from '../shared/people';
import { balanceWords } from '../shared/words';

/** "14 Nov 2026": the date in full. */
const fullDate = (d: IsoDate) => formatShortDate(d, '0000-01-01');

export function StatementPage({ month }: { month: string }) {
  const layer = useDataLayer();
  const today = layer.today();
  const people = usePeople();
  const entries = useEntries().data;
  const settlements = useSettlements().data;
  const [a, b] = people.list;
  const tableName = useId();
  const s = useMemo(() => {
    if (!entries || !settlements || !a || !b) return null;
    return statement(entries.map(toInsight), settlements.map((x) => ({ ...toSettle(x), id: x.id })), [a.id, b.id], month);
  }, [entries, settlements, a, b, month]);
  const name = strings.recap.monthName(month);
  const balance = (nets: Record<string, number>) => {
    if (!a || !b) return '';
    const w = balanceWords(balanceState(nets as Parameters<typeof balanceState>[0], [a.id, b.id]), people.name);
    return w.amount === null ? w.words : `${w.words}${w.amount}`;
  };
  const detail = (r: StatementRow): string[] => {
    if (r.kind === 'settlement') return [strings.statement.settleLine];
    const shares = [a, b].filter((p) => p !== undefined).map((p) => strings.statement.share(p.name, formatPence(pence(r.shares[p.id] ?? 0))));
    const payer = [a, b].find((p) => p !== undefined && (r.paid[p.id] ?? 0) > 0);
    const first = r.kind === 'money_back' ? strings.statement.moneyBack : payer ? strings.statement.paidBy(payer.name) : '';
    return [first, ...shares].filter((x) => x !== '');
  };
  const what = (r: StatementRow): string =>
    r.kind === 'settlement' && r.from && r.to ? strings.statement.settleUp(people.name(r.from), people.name(r.to)) : r.description;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 px-5 pt-[max(1rem,env(safe-area-inset-top))] pb-16 print:max-w-none print:pt-0">
      <header className="flex flex-col gap-2">
        <div className="flex min-h-12 items-center print:hidden">
          <button
            type="button"
            onClick={() => { go({ name: 'settings' }); }}
            className="text-ink press -ml-2.5 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2.5"
          >
            <ArrowLeft size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" />
            {strings.statement.back}
          </button>
        </div>
        <h1 className="text-title m-0 break-words">{strings.statement.title(name)}</h1>
        {a && b ? <p className="text-secondary text-ink-2 m-0 break-words">{strings.statement.between(a.name, b.name)}</p> : null}
      </header>

      {s ? (
        <>
          <div className="flex flex-col gap-2">
            <p className="m-0 flex flex-wrap gap-x-2">
              <span className="text-ink-2">{strings.statement.start}</span>
              <span className="nums-list font-medium">{balance(s.opening)}</span>
            </p>
            <p className="m-0 flex flex-wrap gap-x-2">
              <span className="text-ink-2">{strings.statement.end}</span>
              <span className="nums-list font-medium">{balance(s.closing)}</span>
            </p>
          </div>

          <section aria-labelledby={tableName} className="flex flex-col gap-2">
            <h2 id={tableName} className="text-heading rule-ledger m-0">{strings.statement.entries}</h2>
            <table aria-labelledby={tableName} className="w-full table-fixed border-collapse text-left">
              <thead>
                <tr className="border-line border-b">
                  <th scope="col" className="text-caption text-ink-2 w-14 py-2 pr-2 font-medium">{strings.statement.date}</th>
                  <th scope="col" className="text-caption text-ink-2 py-2 pr-2 font-medium">{strings.statement.what}</th>
                  <th scope="col" className="text-caption text-ink-2 w-24 py-2 text-right font-medium">{strings.statement.amount}</th>
                </tr>
              </thead>
              <tbody>
                {s.rows.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="text-secondary text-ink-2 py-3">{strings.statement.nothing}</td>
                  </tr>
                ) : s.rows.map((r) => (
                  <tr key={r.id} className="border-line border-b align-top last:border-b-0">
                    <td className="text-secondary nums-list py-2 pr-2 whitespace-nowrap">{formatShortDate(r.date, r.date)}</td>
                    <td className="py-2 pr-2">
                      <span className="text-body block [overflow-wrap:anywhere]">{what(r)}</span>
                      <span className="text-caption text-ink-2 nums-list block">
                        {/* Each part kept on one line where it fits ("Sam £22.61" never splits). */}
                        {detail(r).map((part, i) => (
                          <span key={`${String(i)}:${part}`}>
                            {i > 0 ? ' · ' : null}
                            <span className="inline-block [overflow-wrap:anywhere]">{part}</span>
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="text-body nums-list py-2 text-right whitespace-nowrap">{formatPence(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {a && b ? (
            <section aria-label={strings.statement.totals} className="flex flex-col gap-1">
              <h2 className="text-heading rule-ledger m-0">{strings.statement.totals}</h2>
              {[a, b].map((p) => (
                <p key={`paid-${p.id}`} className="nums-list m-0 break-words">{strings.statement.paid(p.name, formatPence(s.paidBy[p.id] ?? pence(0)))}</p>
              ))}
              {[a, b].map((p) => (
                <p key={`shared-${p.id}`} className="nums-list m-0 break-words">{strings.statement.shared(p.name, formatPence(s.sharedBy[p.id] ?? pence(0)))}</p>
              ))}
            </section>
          ) : null}

          <p className="text-caption text-ink-2 m-0">{strings.statement.made(fullDate(today))}</p>
          <div className="print:hidden">
            <Button variant="plain" onClick={() => { window.print(); }}>{strings.statement.save}</Button>
          </div>
        </>
      ) : (
        <div className="min-h-40" aria-busy="true" />
      )}
    </div>
  );
}
