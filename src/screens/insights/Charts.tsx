/**
 * Insights charts (DESIGN §4.6): hand-drawn SVG with direct labels, no legends, a baseline only; every mark can
 * be tapped (or focused) for its figure. Colours from the tokens; both themes; nothing animates.
 */
import { useState } from 'react';
import { formatPence, type Pence } from '../../core/money';
import { cx } from '../../ui/primitives/util';

/** Horizontal bars, each labelled on the bar ("Eating out £420.00"), largest first, as a list. */
export function Bars({ label, items }: { label: string; items: readonly { key: string; name: string; amount: Pence; colour?: string }[] }) {
  const max = Math.max(1, ...items.map((i) => i.amount));
  return (
    <ul aria-label={label} className="m-0 flex list-none flex-col gap-2 p-0">
      {items.map((i) => {
        const pct = Math.max(2, Math.round((Math.max(0, i.amount) / max) * 100));
        return (
          <li key={i.key} className="relative flex min-h-11 items-center overflow-hidden rounded-[8px]">
            <span
              aria-hidden="true"
              className="bg-forest-tint absolute inset-y-0 left-0 rounded-[8px]"
              style={{ width: `${String(pct)}%`, ...(i.colour ? { background: `color-mix(in oklch, var(--cat-${i.colour}) 35%, transparent)` } : {}) }}
            />
            <span className="text-body relative flex w-full min-w-0 items-baseline justify-between gap-3 px-3">
              <span className="min-w-0 truncate">{i.name}</span>{' '}
              <span className="nums-list shrink-0">{formatPence(i.amount)}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Twelve slim columns over a baseline; the current one marked; tap one for its figure. */
export function Columns({ label, items }: { label: string; items: readonly { key: string; name: string; short: string; amount: Pence; current?: boolean }[] }) {
  const [picked, setPicked] = useState<string | null>(null);
  const max = Math.max(1, ...items.map((i) => i.amount));
  const shown = items.find((i) => i.key === picked) ?? items.find((i) => i.current) ?? items[items.length - 1];
  return (
    <div className="flex flex-col gap-2">
      <p className="text-body nums-list m-0 min-h-[1.5rem]" aria-live="polite">{shown ? `${shown.name}: ${formatPence(shown.amount)}` : ''}</p>
      <ul aria-label={label} className="border-line m-0 flex h-36 list-none items-end gap-1 border-b p-0">
        {items.map((i) => {
          const h = Math.max(2, Math.round((Math.max(0, i.amount) / max) * 100));
          return (
            <li key={i.key} className="flex h-full min-w-0 flex-1 items-end">
              <button
                type="button"
                aria-label={`${i.name}: ${formatPence(i.amount)}`}
                aria-pressed={picked === i.key}
                onClick={() => { setPicked(i.key); }}
                className="press flex h-full w-full min-w-0 items-end justify-center"
              >
                <span
                  aria-hidden="true"
                  className={cx('block w-full max-w-5 rounded-t-[4px]', i.current ? 'bg-forest' : picked === i.key ? 'bg-walnut' : 'bg-forest-tint')}
                  style={{ height: `${String(h)}%` }}
                />
              </button>
            </li>
          );
        })}
      </ul>
      <div aria-hidden="true" className="text-caption text-ink-2 flex gap-1">
        {items.map((i) => <span key={i.key} className="min-w-0 flex-1 text-center">{i.short}</span>)}
      </div>
    </div>
  );
}
