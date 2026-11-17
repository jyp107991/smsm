/**
 * Settings → "Settle day" (S5b; SET-4): the household's day of the month for the recap and settling up, or Off.
 * Either person sets it; it needs a connection (it is the household's, not this phone's).
 */
import { useId, useState } from 'react';
import { setSettleDay, useHousehold } from '../../data';
import { strings } from '../../ui/strings';
import { plainError } from '../shared/plain';

export function ordinal(n: number): string {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  return `${String(n)}${suffix}`;
}

export function SettleDay() {
  const id = useId();
  const household = useHousehold().data ?? null;
  const [error, setError] = useState<string | null>(null);
  // The choice holds while it saves (review: a controlled select snapped back until the refresh landed).
  const [choosing, setChoosing] = useState<number | null | undefined>(undefined);
  const value = choosing === undefined ? (household?.settle_day ?? null) : choosing;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-secondary text-ink-2 font-medium">{strings.settleDay.label}</label>
      <select
        id={id}
        value={value === null ? '' : String(value)}
        aria-describedby={`${id}-line`}
        onChange={(e) => {
          setError(null);
          const day = e.target.value === '' ? null : Number(e.target.value);
          setChoosing(day);
          setSettleDay(day)
            .catch((err: unknown) => { setError(plainError(err)); })
            .finally(() => { setChoosing(undefined); });
        }}
        className="bg-sunk text-ink text-body min-h-12 w-full rounded-[12px] px-4 outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <option value="">{strings.settleDay.off}</option>
        {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={String(d)}>{ordinal(d)}</option>)}
      </select>
      <p id={`${id}-line`} className="text-secondary text-ink-2 m-0">{strings.settleDay.line}</p>
      {error ? <p role="alert" className="text-secondary text-berry m-0">{error}</p> : null}
    </div>
  );
}
