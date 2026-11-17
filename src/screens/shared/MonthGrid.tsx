/**
 * The in-app date picker (S2 polish Q-L13): a month as a grid of days, never the browser's own date input.
 * Days after the phone's today can't be chosen (Q-F2, DAT-2), every day is a 44 px target, and the grid is
 * a WAI-ARIA grid: arrow keys move a day or a week, Home/End to the week's ends, Page Up/Down a month, and
 * the month follows. Six rows whatever the month, so the sheet never changes height. Nothing moves by itself,
 * so there is nothing to stop under reduced motion.
 */
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { addDays, addMonths, formatDate, monthWeeks, startOfMonth, startOfWeek, type IsoDate } from '../../core/dates';
import { ICON, Sheet } from '../../ui/primitives';
import { cx } from '../../ui/primitives/util';
import { strings } from '../../ui/strings';

/** How a day reads in the grid: chosen on its own, an end of a chosen range, or inside one. */
export type DayMark = 'chosen' | 'start' | 'end' | 'inside' | null;

export interface MonthGridProps {
  /** The phone's today (DAT-2): later days are disabled. */
  today: IsoDate;
  /** The day the grid opens on and keyboard focus starts from. */
  focus: IsoDate;
  mark: (day: IsoDate) => DayMark;
  onPick: (day: IsoDate) => void;
  /** Put focus on the starting day as the grid appears (inside a sheet that just opened). */
  autoFocus?: boolean;
}

function clamp(day: IsoDate, today: IsoDate): IsoDate {
  return day > today ? today : day;
}

export function MonthGrid({ today, focus, mark, onPick, autoFocus = false }: MonthGridProps) {
  const titleId = useId();
  const [focused, setFocused] = useState(() => clamp(focus, today));
  const [month, setMonth] = useState(() => startOfMonth(clamp(focus, today)));
  /** Focus follows the keyboard's day once it is drawn (it may be in the next month). */
  const moved = useRef(false);
  const grid = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    grid.current?.querySelector<HTMLButtonElement>(`[data-day="${focused}"]`)?.focus();
  }, [focused, month]);
  // In a sheet that has just opened, the starting day takes focus once the sheet holds focus (a frame later,
  // after its focus trap has taken over from the sheet under it).
  useEffect(() => {
    if (!autoFocus) return;
    const frame = requestAnimationFrame(() => {
      grid.current?.querySelector<HTMLButtonElement>('button[tabindex="0"]')?.focus({ preventScroll: true });
    });
    return () => { cancelAnimationFrame(frame); };
  }, [autoFocus]);

  const [year, monthNumber] = [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
  const thisMonth = startOfMonth(today);
  /** Another month; the keyboard's place moves with the page (the same day of the month, or the nearest). */
  const show = (by: number) => {
    setMonth(addMonths(month, by));
    setFocused(clamp(addMonths(focused, by), today));
  };

  const keys = (e: KeyboardEvent<HTMLButtonElement>, day: IsoDate) => {
    const to: Record<string, () => IsoDate> = {
      ArrowLeft: () => addDays(day, -1),
      ArrowRight: () => addDays(day, 1),
      ArrowUp: () => addDays(day, -7),
      ArrowDown: () => addDays(day, 7),
      Home: () => startOfWeek(day),
      End: () => addDays(startOfWeek(day), 6),
      PageUp: () => addMonths(day, -1),
      PageDown: () => addMonths(day, 1),
    };
    const next = to[e.key];
    if (!next) return;
    e.preventDefault();
    const day2 = clamp(next(), today);
    moved.current = true;
    setFocused(day2);
    setMonth(startOfMonth(day2));
  };

  const weeks = monthWeeks(month);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <button
          type="button"
          aria-label={strings.datePicker.previousMonth}
          onClick={() => { show(-1); }}
          className="text-ink press inline-flex size-11 items-center justify-center rounded-full"
        >
          <ChevronLeft size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" />
        </button>
        <h3 id={titleId} aria-live="polite" className="text-subtitle m-0">
          {strings.datePicker.month(strings.datePicker.months[monthNumber - 1] ?? '', year)}
        </h3>
        <button
          type="button"
          aria-label={strings.datePicker.nextMonth}
          disabled={month >= thisMonth}
          onClick={() => { show(1); }}
          className="text-ink press inline-flex size-11 items-center justify-center rounded-full disabled:opacity-40"
        >
          <ChevronRight size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" />
        </button>
      </div>
      {/* Reaches into the sheet's margins a little, so seven 44 px days fit at 320 px. */}
      <div ref={grid} role="grid" aria-labelledby={titleId} className="-mx-3.5 flex flex-col">
        <div role="row" className="grid grid-cols-7">
          {strings.datePicker.weekdays.map(([letter, name], i) => (
            <span key={i} role="columnheader" className="text-caption text-ink-2 flex h-6 items-center justify-center">
              <span aria-hidden="true">{letter}</span>
              <span className="sr-only">{name}</span>
            </span>
          ))}
        </div>
        {weeks.map((week, w) => (
          <div key={w} role="row" className="grid grid-cols-7">
            {week.map((day, i) => {
              if (day === null) return <span key={i} role="gridcell" className="h-11" />;
              const m = mark(day);
              const later = day > today;
              const ends = m === 'chosen' || m === 'start' || m === 'end';
              return (
                <span
                  key={day}
                  role="gridcell"
                  aria-selected={m !== null}
                  className={cx(
                    'flex h-11 items-center justify-center',
                    // A range is one band from its first day to its last.
                    (m === 'inside' || (m === 'start' && mark(addDays(day, 1)) !== null) || (m === 'end' && mark(addDays(day, -1)) !== null)) && 'bg-forest-tint',
                    m === 'start' && 'rounded-l-full',
                    m === 'end' && 'rounded-r-full',
                  )}
                >
                  <button
                    type="button"
                    data-day={day}
                    aria-label={formatDate(day, today)}
                    aria-current={day === today ? 'date' : undefined}
                    disabled={later}
                    tabIndex={day === focused ? 0 : -1}
                    onClick={() => { onPick(day); }}
                    onKeyDown={(e) => { keys(e, day); }}
                    onFocus={() => { if (day !== focused) setFocused(day); }}
                    className={cx(
                      'text-body nums-list press relative inline-flex size-11 items-center justify-center rounded-full',
                      ends ? 'bg-forest-tint text-forest' : m === 'inside' ? 'text-forest' : 'text-ink',
                      later && 'text-ink-2 opacity-40',
                      // Today: a small forest mark under the number (outlines are for keyboard focus only).
                      day === today && 'after:bg-forest after:absolute after:bottom-1.5 after:size-1 after:rounded-full after:content-[""]',
                    )}
                  >
                    {Number(day.slice(8, 10))}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * "Pick a date" (Q-L13): the month grid in a small sheet over the form. Picking a day closes it; Escape, back
 * or Close leave the date as it was.
 */
export function DateSheet({ open, onClose, value, today, onPick }: {
  open: boolean;
  onClose: () => void;
  value: IsoDate;
  today: IsoDate;
  onPick: (day: IsoDate) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={(next) => { if (!next) onClose(); }} title={strings.entry.pickDate}>
      {/* Mounted with the sheet's content, so each opening starts on the chosen day. */}
      <MonthGrid
        today={today}
        focus={value}
        mark={(d) => (d === value ? 'chosen' : null)}
        onPick={(d) => {
          onPick(d);
          onClose();
        }}
        autoFocus
      />
    </Sheet>
  );
}
