import { useId, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cx, ICON } from './util';

export interface DisclosureProps {
  /** What it holds, in a few words ("More details"). */
  label: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}

/**
 * A full-width row that shows or hides what is under it (S2 polish Q-L14: "More details" in the Add sheet and
 * Settle up). A ruled line on the page like the lists, its words on the margin and a chevron at the end that
 * turns as it opens (still under reduced motion, without the turn's movement). `aria-expanded` says which.
 */
export function Disclosure({ label, open, onOpenChange, children }: DisclosureProps) {
  const id = useId();
  return (
    <div className="border-line flex flex-col border-t">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => { onOpenChange(!open); }}
        className={cx(
          'text-body text-ink press -mx-2 flex min-h-12 w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-[12px] px-2 text-left',
        )}
      >
        <span className="min-w-0">{label}</span>
        <ChevronDown
          size={ICON.size}
          strokeWidth={ICON.stroke}
          aria-hidden="true"
          className={cx('text-ink-2 shrink-0 transition-transform duration-200 motion-reduce:transition-none', open && '[transform:rotate(180deg)]')}
        />
      </button>
      {open ? <div id={id} className="pt-2">{children}</div> : null}
    </div>
  );
}
