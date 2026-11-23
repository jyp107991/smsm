import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Check } from 'lucide-react';
import type { CategoryColourName } from '../tokens';
import { strings } from '../strings';
import { cx } from './util';

export interface ChipProps extends Omit<ComponentPropsWithRef<'button'>, 'onChange'> {
  /** Pressed state, announced as aria-pressed and shown with a tonal forest fill, forest text and a tick. */
  selected?: boolean;
  /** Called with the new state when pressed. */
  onSelectedChange?: (selected: boolean) => void;
  /** A category colour dot before the label. */
  colour?: CategoryColourName;
  /**
   * A small mark before the label instead of the colour dot (a category's emoji). Like the dot, the tick
   * takes its place when pressed, in a slot of fixed width, so the chip keeps its size.
   */
  icon?: ReactNode;
  /** Marks a suggestion (for example the guessed category) with a small forest dot after the label. */
  suggested?: boolean;
  /**
   * The suggestion dot's place is kept whether or not it shows, so a chip doesn't change width as the
   * suggestion moves (the category chips, re-guessed as a description is typed). Pass with `colour` or
   * `icon` for a chip that never changes size at all (DESIGN §6: no layout shift).
   */
  suggestible?: boolean;
  children: ReactNode;
}

/**
 * A selectable chip (DESIGN §3.3: 12 px radius). The visible chip is 36 px tall; its hit area
 * extends to 44 px, so rows of chips need at least 8 px between them.
 * Selected is never colour alone: the tonal fill and a tick appear together. Outlines are for keyboard
 * focus only (S2 polish Q-L2: one "selected" language).
 */
export function Chip({
  selected = false, onSelectedChange, colour, icon, suggested = false, suggestible = false, className, children, onClick, type = 'button', ...rest
}: ChipProps) {
  return (
    <button
      type={type}
      {...rest}
      aria-pressed={selected}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onSelectedChange?.(!selected);
      }}
      className={cx(
        'relative inline-flex h-9 max-w-full min-w-11 items-center justify-center gap-1.5 rounded-[12px] border-2 border-transparent px-3',
        'text-secondary press select-none active:scale-[0.97]',
        // The hit area: 44 px tall, from the border edge (the pseudo-element sits inside the 2 px border, so 6 px).
        'before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-[""]',
        'font-medium',
        selected ? 'bg-forest-tint text-forest' : 'bg-sunk text-ink',
        className,
      )}
    >
      {selected || colour || icon !== undefined ? (
        // The tick takes the dot's (or the icon's) place, so a chip with either keeps its width when pressed.
        <span aria-hidden="true" className={cx('-ml-0.5 flex h-4 shrink-0 items-center justify-center', icon !== undefined ? 'w-5' : 'w-4')}>
          {selected ? (
            <Check size={16} strokeWidth={2.25} />
          ) : icon !== undefined ? (
            icon
          ) : (
            <span className="size-2.5 rounded-full" style={{ background: `var(--cat-${colour ?? 'stone'})` }} />
          )}
        </span>
      ) : null}
      <span className="min-w-0 truncate">{children}</span>
      {suggested || suggestible ? (
        <span aria-hidden="true" className={cx('size-1.5 shrink-0 rounded-full', suggested ? 'bg-forest' : 'bg-transparent')} />
      ) : null}
      {suggested ? <span className="sr-only">{strings.ui.suggested}</span> : null}
    </button>
  );
}
