/**
 * A gallery section: a title in the display voice on a ledger rule, and, where there is something to
 * choose, one plain line saying what (DESIGN §5). The section is a region named by its title.
 */
import type { ReactNode } from 'react';

export function Section({ id, title, ask, children }: { id: string; title: string; ask?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h2 id={id} className="text-heading rule-ledger m-0">{title}</h2>
        {ask ? <p className="text-note m-0">{ask}</p> : null}
      </div>
      {children}
    </section>
  );
}
