import type { ComponentPropsWithRef, ReactNode } from 'react';
import { LoaderCircle, type LucideIcon } from 'lucide-react';
import { strings } from '../strings';
import { cx, ICON } from './util';

export type ButtonVariant = 'primary' | 'plain' | 'destructive';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  /** primary: forest fill, one per screen. plain: a quiet sunk fill. destructive: berry text. */
  variant?: ButtonVariant;
  /** Shows a spinner in place of the label, keeps the button's size, and ignores presses. */
  loading?: boolean;
  /** A Lucide icon before the label. */
  icon?: LucideIcon;
  /** Stretch to the width of the container. */
  block?: boolean;
  children: ReactNode;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-forest text-on-forest',
  plain: 'bg-sunk text-ink',
  destructive: 'bg-transparent text-berry',
};

/**
 * The app's button (DESIGN §3.3: fully rounded; at least 44 px tall). A button says what it does
 * ("Save"); its toast says it did it ("Saved").
 */
export function Button({ variant = 'primary', loading = false, icon: Icon, block = false, className, children, type = 'button', disabled, onClick, ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      {...rest}
      disabled={disabled}
      aria-busy={loading || undefined}
      // Stays focusable while loading (so focus is not lost), but presses are ignored.
      aria-disabled={loading || undefined}
      // preventDefault also stops a submit button sending its form twice (a duplicate save).
      onClick={loading ? (e) => { e.preventDefault(); } : onClick}
      className={cx(
        'relative inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full px-5 py-2.5',
        'text-body font-semibold select-none',
        'transition-transform duration-150 active:scale-[0.98] disabled:opacity-50 aria-disabled:active:scale-100',
        'forced-colors:border forced-colors:border-[ButtonText]',
        VARIANTS[variant],
        block && 'w-full',
        className,
      )}
    >
      <span className={cx('inline-flex min-w-0 items-center gap-2', loading && 'invisible')}>
        {Icon ? <Icon size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" className="shrink-0" /> : null}
        <span className="min-w-0">{children}</span>
      </span>
      {loading ? (
        <span className="absolute inset-0 flex items-center justify-center">
          <LoaderCircle size={ICON.size} strokeWidth={ICON.stroke} aria-hidden="true" className="animate-spin motion-reduce:animate-none" />
          <span className="sr-only">{strings.ui.working}</span>
        </span>
      ) : null}
    </button>
  );
}
