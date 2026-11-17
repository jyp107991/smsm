import * as ToggleGroup from '@radix-ui/react-toggle-group';
import { Check } from 'lucide-react';
import { cx } from './util';

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

export interface ChoicesProps<T extends string> {
  /** Names the radio group ("How it’s shared"). */
  label: string;
  options: readonly ChoiceOption<T>[];
  value: T;
  onValueChange: (value: T) => void;
  className?: string;
}

/**
 * Choose one of several, drawn as chips (S2 polish Q-U5: the split's "50/50 · Jae 60 · Sam 40 · … · Other").
 * A radio group (Radix ToggleGroup, single): arrow keys move between the choices, and one is always chosen.
 *
 * The chips speak the one "selected" language (Q-L2): the chosen one is a tonal forest fill with forest text
 * and a tick; outlines only for keyboard focus. Each chip is always as wide as it is when chosen (its label
 * with the tick is laid out invisibly underneath), so choosing never changes a width and the rows of chips
 * never re-wrap (DESIGN §6: no layout shift). The visible chip is 36 px tall; its hit area reaches 44 px.
 */
export function Choices<T extends string>({ label, options, value, onValueChange, className }: ChoicesProps<T>) {
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        const option = options.find((o) => o.value === next);
        if (option) onValueChange(option.value);
      }}
      className={cx('flex flex-wrap gap-x-2 gap-y-3', className)}
    >
      {options.map((o) => {
        const chosen = o.value === value;
        return (
          <ToggleGroup.Item
            key={o.value}
            value={o.value}
            className={cx(
              'relative inline-grid h-9 max-w-full min-w-11 place-items-center rounded-[12px] border-2 border-transparent px-3',
              'text-secondary press font-medium select-none active:scale-[0.97]',
              'before:absolute before:inset-x-0 before:-inset-y-1 before:content-[""]',
              chosen ? 'bg-forest-tint text-forest' : 'bg-sunk text-ink',
            )}
          >
            {/* The chosen width, kept whether or not it is chosen. */}
            <span aria-hidden="true" className="invisible col-start-1 row-start-1 flex items-center gap-1.5 whitespace-nowrap">
              <Check size={16} strokeWidth={2.25} />
              <span>{o.label}</span>
            </span>
            <span className="col-start-1 row-start-1 flex min-w-0 items-center gap-1.5 whitespace-nowrap">
              {chosen ? <Check size={16} strokeWidth={2.25} aria-hidden="true" className="-ml-0.5 shrink-0" /> : null}
              <span className="nums-list min-w-0 truncate">{o.label}</span>
            </span>
          </ToggleGroup.Item>
        );
      })}
    </ToggleGroup.Root>
  );
}
