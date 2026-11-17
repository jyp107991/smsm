import { useId, type ComponentPropsWithRef } from 'react';
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
   * text: an ordinary input. amount: pounds and pence, shown large with "£", decimal keypad
   * (`inputmode="decimal"`); the value stays the person's text, parsed by core/money.
   */
  variant?: 'text' | 'amount';
}

/**
 * A labelled input on a sunk well with a 12 px radius (DESIGN §3.3). `inputMode`, `enterKeyHint`,
 * `autoComplete` and every other input attribute pass straight through.
 */
export function Field({ label, hint, error, variant = 'text', id, className, inputMode, enterKeyHint, ...rest }: FieldProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const noteId = `${inputId}-note`;
  const amount = variant === 'amount';
  const note = error ?? hint;
  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={inputId} className="text-secondary text-ink-2 font-medium">
        {label}
      </label>
      <div
        className={cx(
          'bg-sunk flex min-w-0 items-center rounded-[12px] border-2 px-4',
          'focus-within:outline-forest focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-solid',
          error ? 'border-berry' : 'border-transparent',
          amount ? 'min-h-16' : 'min-h-12',
        )}
      >
        {amount ? (
          <span aria-hidden="true" className="text-amount text-ink-2 pr-1">
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
            'text-ink placeholder:text-ink-2 w-full min-w-0 bg-transparent py-2 outline-none',
            amount ? 'text-amount nums-list' : 'text-body',
          )}
        />
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
