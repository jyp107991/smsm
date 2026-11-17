import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';
import { CircleExclamationPoint } from 'lucide-react';
import { strings } from '../strings';
import { cx, ICON } from './util';

export interface FieldProps extends Omit<ComponentPropsWithRef<'input'>, 'size'> {
  /** Always visible above the input. */
  label: string;
  /** Help under the input, in secondary text. */
  hint?: string;
  /** What is wrong and what to do; replaces the hint and marks the input invalid. */
  error?: string;
  /**
   * text: an ordinary input on a sunk well. amount: the hero of a money form (S2 polish Q-L12): pounds and pence
   * in the display serif on a hairline, with "£" and a decimal keypad (`inputmode="decimal"`); the value stays
   * the person's text, parsed by core/money.
   */
  variant?: 'text' | 'amount';
  /** Amount only: something shown at the line's right end, such as a sum's result ("= £34.50"). */
  trailing?: ReactNode;
}

/**
 * A labelled input on a sunk well with a 12 px radius (DESIGN §3.3), or, for an amount, the figure itself on a
 * hairline that turns forest while it has focus. `inputMode`, `enterKeyHint`, `autoComplete` and every other
 * input attribute pass straight through.
 */
export function Field({ label, hint, error, variant = 'text', trailing, id, className, inputMode, enterKeyHint, ...rest }: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const noteId = `${inputId}-note`;
  const amount = variant === 'amount';
  const note = error ?? hint;
  return (
    <div className={cx('flex min-w-0 flex-col', amount ? 'gap-1' : 'gap-1.5', className)}>
      <label htmlFor={inputId} className="text-secondary text-ink-2 font-medium">
        {label}
      </label>
      <div
        className={cx(
          'flex min-w-0',
          amount
            ? cx(
                // A 1 px hairline; focused, it turns forest with a 1 px shadow under it (no change of size).
                'items-baseline gap-1 border-b transition-[border-color,box-shadow] duration-150',
                error
                  ? 'border-berry shadow-[0_1px_0_var(--berry)]'
                  : 'border-line focus-within:border-forest focus-within:shadow-[0_1px_0_var(--forest)]',
              )
            : cx(
                'bg-sunk min-h-12 items-center rounded-[12px] border-2 px-4',
                'focus-within:outline-forest focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-solid',
                error ? 'border-berry' : 'border-transparent',
              ),
        )}
      >
        {amount ? (
          <span aria-hidden="true" className="text-amount text-ink-2">
            {strings.ui.currency}
          </span>
        ) : null}
        <input
          id={inputId}
          {...rest}
          inputMode={inputMode ?? (amount ? 'decimal' : undefined)}
          enterKeyHint={enterKeyHint}
          autoComplete={rest.autoComplete ?? (amount ? 'off' : undefined)}
          aria-invalid={error ? true : undefined}
          aria-describedby={note ? noteId : undefined}
          className={cx(
            'text-ink placeholder:text-ink-2 w-full min-w-0 flex-1 bg-transparent outline-none',
            amount ? 'text-amount nums-list py-1' : 'text-body py-2',
          )}
        />
        {amount && trailing !== undefined ? (
          <span aria-live="polite" className="text-secondary text-ink-2 nums-list shrink-0 whitespace-nowrap">{trailing}</span>
        ) : null}
      </div>
      {note ? (
        <p id={noteId} className={cx('text-secondary flex items-start gap-1.5', error ? 'text-berry' : 'text-ink-2')}>
          {error ? <CircleExclamationPoint size={18} strokeWidth={ICON.stroke} aria-hidden="true" className="mt-px shrink-0" /> : null}
          <span className="min-w-0 break-words">{note}</span>
        </p>
      ) : null}
    </div>
  );
}
