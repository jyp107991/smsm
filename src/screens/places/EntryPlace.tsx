/**
 * S4b in the Add sheet: the place chip (PLC-2: "Kyoto", with Remove place) and "Paid in JPY" (PLC-6: the foreign
 * amount in the Amount field, the day's rate filled in and editable, the pounds worked out exactly by the core).
 */
import { useEffect, useId, useState, type ReactNode } from 'react';
import { currencyOf, formatForeign, foreignToPence } from '../../core/fx';
import { formatPence } from '../../core/money';
import { rateFor } from '../../data';
import { Field } from '../../ui/primitives';
import { strings } from '../../ui/strings';
import { Toggle } from '../entry/RecurringParts';
import type { FormState } from '../entry/form';

export function PlaceRow({ place, onEdit, onRemove }: { place: string; onEdit: () => void; onRemove: () => void }) {
  return (
    <Labelled label={strings.places.place}>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={strings.places.place}>
        <button type="button" onClick={onEdit} className="bg-sunk text-ink text-secondary press inline-flex min-h-11 items-center rounded-[12px] px-3 font-medium">
          {place}
        </button>
        <button type="button" onClick={onRemove} className="text-forest text-secondary press inline-flex min-h-11 items-center rounded-full px-3 font-medium">
          {strings.places.removePlace}
        </button>
      </div>
    </Labelled>
  );
}

/** "Paid in JPY": only when the entry's country uses another currency. */
export function ForeignAmount({ s, home, setForm }: { s: FormState; home: string; setForm: (change: (prev: FormState) => FormState) => void }) {
  // Always from the latest form, so a rate arriving later never puts back what was typed meanwhile.
  const onChange = (next: Partial<FormState>) => { setForm((prev) => ({ ...prev, ...next })); };
  const id = useId();
  const currency = currencyOf(s.country ?? home);
  const [note, setNote] = useState<string | null>(null);
  const on = s.foreign !== undefined && s.foreign !== null;
  const rateText = s.foreign?.rateText ?? '';
  // The day's rate, fetched once when turned on with no rate typed (offline: the last one kept, said so).
  useEffect(() => {
    if (!on || !currency || rateText !== '') return;
    let live = true;
    void rateFor(currency).then((r) => {
      if (!live) return;
      if (r) {
        // Only into an empty Rate box: a rate the person typed while it loaded wins.
        setForm((prev) => (prev.foreign && prev.foreign.currency === currency && prev.foreign.rateText === ''
          ? { ...prev, foreign: { currency, rateText: r.rate } } : prev));
        setNote(r.stale ? strings.places.rateStale(r.date) : null);
      } else setNote(strings.places.rateNone);
    });
    return () => { live = false; };
    // Only when it is turned on or the currency changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [on, currency]);
  if (!currency || currency === 'GBP') return null;
  const pounds = on ? foreignToPence(s.amountText, rateText) : null;
  return (
    <div className="flex flex-col gap-2">
      <Toggle
        label={strings.places.paidIn(currency)}
        on={on}
        onChange={(next) => { onChange({ foreign: next ? { currency, rateText: '' } : null }); setNote(null); }}
      />
      {on ? (
        <div className="flex flex-col gap-1.5">
          <Field
            label={strings.places.rate}
            inputMode="decimal"
            autoComplete="off"
            value={rateText}
            aria-describedby={`${id}-rate`}
            onChange={(e) => { onChange({ foreign: { currency, rateText: e.target.value } }); setNote(null); }}
          />
          <p id={`${id}-rate`} className="text-secondary text-ink-2 nums-list m-0">
            {note ?? (rateText !== '' ? strings.places.rateLine(currency, rateText) : '')}
          </p>
          {pounds !== null ? (
            <p className="text-body nums-list m-0">{strings.places.converted(formatForeign(s.amountText, currency), formatPence(pounds))}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Labelled({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span aria-hidden="true" className="text-secondary text-ink-2 font-medium">{label}</span>
      {children}
    </div>
  );
}
