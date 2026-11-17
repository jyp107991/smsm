import type { ComponentPropsWithRef, ReactNode } from 'react';
import { Check } from 'lucide-react';
import type { CategoryColourName } from '../tokens';
import { strings } from '../strings';
import { cx } from './util';

export interface ChipProps extends Omit<ComponentPropsWithRef<'button'>, 'onChange'> {
  /** Pressed state, announced as aria-pressed and shown with a forest outline and a tick. */
  selected?: boolean;
  /** Called with the new state when pressed. */
  onSelectedChange?: (selected: boolean) => void;
  /** A category colour dot before the label. */
  colour?: CategoryColourName;
  /** Marks a suggestion (for example the guessed category) with a small forest dot after the label. */
  suggested?: boolean;
  children: ReactNode;
}

/**
 * A selectable chip (DESIGN §3.3: 12 px radius). The visible chip is 36 px tall; its hit area
 * extends to 44 px, so rows of chips need at least 8 px between them.
 * Selected is never colour alone: the outline and a tick appear together.
 */
export function Chip({ selected = false, onSelectedChange, colour, suggested = false, className, children, onClick, type = 'button', ...rest }: ChipProps) {
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
        'relative inline-flex h-9 max-w-full min-w-11 items-center justify-center gap-1.5 rounded-[12px] border-2 px-3',
        'text-secondary select-none',
        // The hit area: 4 px above and below the visible chip.
        'before:absolute before:inset-x-0 before:-inset-y-1 before:content-[""]',
        'font-medium',
        selected ? 'border-forest bg-surface text-forest' : 'bg-sunk text-ink border-transparent',
        className,
      )}
    >
      {selected || colour ? (
        // The tick takes the colour dot's place, so a chip with a colour keeps its width when pressed.
        <span aria-hidden="true" className="-ml-0.5 flex size-4 shrink-0 items-center justify-center">
          {selected ? (
            <Check size={16} strokeWidth={2.25} />
          ) : (
            <span className="size-2.5 rounded-full" style={{ background: `var(--cat-${colour ?? 'stone'})` }} />
          )}
        </span>
      ) : null}
      <span className="min-w-0 truncate">{children}</span>
      {suggested ? (
        <>
          <span aria-hidden="true" className="bg-forest size-1.5 shrink-0 rounded-full" />
          <span className="sr-only">{strings.ui.suggested}</span>
        </>
      ) : null}
    </button>
  );
}
