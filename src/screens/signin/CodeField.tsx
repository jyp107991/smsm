/**
 * PPL-1: the emailed code. One real field ("Code", a one-time code with the numeric keypad) drawn as six
 * boxes; pasting the code, or the phone offering it from the email, fills all six at once.
 */
import { useId, useState, type ClipboardEvent } from 'react';
import { cx } from '../../ui/primitives/util';
import { strings } from '../../ui/strings';

export const CODE_LENGTH = 6;

/** The digits of a code as typed or pasted ("123 456", "Your code: 123456"), at most six. */
export function codeDigits(text: string): string {
  return text.normalize('NFKC').replace(/\D/g, '').slice(0, CODE_LENGTH);
}

export function CodeField({ value, onChange, invalid, autoFocus = false }: {
  value: string;
  onChange: (code: string) => void;
  invalid: boolean;
  /** Focused as it appears (right after the code is sent, Q-L5), so the phone can offer the code at once. */
  autoFocus?: boolean;
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    onChange(codeDigits(e.clipboardData.getData('text')));
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-secondary text-ink-2 font-medium">{strings.signIn.code}</label>
      <div className="relative">
        {/* The six boxes: drawing only; the field above them is the real one. */}
        <div aria-hidden="true" className="grid grid-cols-6 gap-2">
          {Array.from({ length: CODE_LENGTH }, (_, i) => {
            const active = focused && (i === value.length || (i === CODE_LENGTH - 1 && value.length === CODE_LENGTH));
            return (
              <span
                key={i}
                className={cx(
                  'bg-sunk text-title nums-list flex h-14 items-center justify-center rounded-[12px] border-2 transition-colors duration-150',
                  invalid ? 'border-berry' : active ? 'border-forest' : 'border-transparent',
                )}
              >
                {value[i] ?? ''}
              </span>
            );
          })}
        </div>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          enterKeyHint="go"
          pattern="[0-9]*"
          maxLength={CODE_LENGTH}
          value={value}
          aria-invalid={invalid || undefined}
          autoFocus={autoFocus}
          onChange={(e) => { onChange(codeDigits(e.target.value)); }}
          onPaste={onPaste}
          onFocus={() => { setFocused(true); }}
          onBlur={() => { setFocused(false); }}
          className="absolute inset-0 h-full w-full bg-transparent text-transparent caret-transparent opacity-0 outline-none"
        />
      </div>
    </div>
  );
}
