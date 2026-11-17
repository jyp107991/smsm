/** Gallery: the three type options on a realistic Home (DESIGN §3.2, §7). The owner picks by looking. */
import { Plank } from '../../../ui/rig/Plank';
import { Button, Field } from '../../../ui/primitives';
import { Animal } from '../../../ui/rig/Animal';

const OPTIONS = [
  { cls: 'type-a', label: 'A: Bricolage Grotesque', note: 'One family for everything; a hand-cut display voice. Recommended.' },
  { cls: 'type-b', label: 'B: Fraunces and Figtree', note: 'A soft serif for sentences and titles, a plain sans for the interface. More bookish.' },
  { cls: 'type-c', label: 'C: Nunito', note: 'Rounder and gentler throughout; more ordinary.' },
] as const;

const ROWS = [
  { emoji: '🛒', what: '이마트 성수점', who: 'dog' as const, amount: '£86.20' },
  { emoji: '🍜', what: 'Dishoom with 지수', who: 'cat' as const, amount: '£64.00' },
  { emoji: '🚆', what: 'Trainline', who: 'dog' as const, amount: '£23.40' },
];

function MiniHome({ cls }: { cls: string }) {
  return (
    <div className={`${cls} bg-paper flex flex-col gap-3 rounded-[20px] p-4`}>
      <Plank left={{ kind: 'cat', mood: 'sheepish' }} right={{ kind: 'dog', mood: 'pleased' }} leftNetPence={-2450} motion={false} />
      <p className="text-sentence m-0 text-center">
        Sam owes Jae <span className="text-amount">£24.50</span>
      </p>
      <p className="text-secondary text-ink-2 m-0 text-center">Next one’s on Sam</p>
      <Button variant="primary" className="self-center">Settle up</Button>
      <Field label="Quick add" defaultValue="42.50 tesco" readOnly hint="£42.50 · Tesco · Groceries · Jae paid · 50/50" />
      <div>
        <p className="text-title m-0">November so far</p>
        <p className="text-secondary text-ink-2 m-0">£1,240 · about £80 under your usual pace</p>
      </div>
      <ul className="m-0 list-none p-0">
        {ROWS.map((r) => (
          <li key={r.what} className="border-line flex min-h-11 items-center gap-3 border-b last:border-b-0">
            <span aria-hidden="true">{r.emoji}</span>
            <span className="min-w-0 flex-1 truncate">{r.what}</span>
            <Animal kind={r.who} pose="head" size={22} motion={false} title={r.who === 'dog' ? 'Jae paid' : 'Sam paid'} />
            <span className="nums-list w-20 text-right">{r.amount}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TypeSection() {
  return (
    <section aria-labelledby="g-type" className="flex flex-col gap-4">
      <h2 id="g-type" className="text-[1.375rem] leading-tight font-semibold">Type</h2>
      <p className="text-ink-2">Three typefaces on the same Home screen. Korean falls back to your phone’s own font.</p>
      {OPTIONS.map((o) => (
        <div key={o.cls} className="flex flex-col gap-2">
          <h3 className="text-[1.0625rem] font-semibold">{o.label}</h3>
          <p className="text-ink-2 m-0 text-[0.9375rem]">{o.note}</p>
          <MiniHome cls={o.cls} />
        </div>
      ))}
    </section>
  );
}
