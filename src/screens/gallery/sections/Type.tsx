/** Gallery: the three type options on a realistic Home (DESIGN §3.2, §7). The owner picks by looking. */
import { Plank } from '../../../ui/rig/Plank';
import { Button, Field } from '../../../ui/primitives';
import { Animal } from '../../../ui/rig/Animal';
import { OptionMark, Section } from './Section';

// The other two options' Korean slices, for the gallery only (the default's are loaded by main.tsx).
void import('../../../styles/fonts-korean-b.css');
void import('../../../styles/fonts-korean-c.css');

const OPTIONS = [
  { cls: 'type-a', letter: 'A', name: 'Pencil and paper', fonts: 'Gowun Batang with Gowun Dodum', note: 'Drawn as a pair by one Korean designer. Soft, like a note left on the table.', pick: true },
  { cls: 'type-b', letter: 'B', name: 'The printed ledger', fonts: 'Hahmlet throughout', note: 'One serif for everything. Crisp and exact, like a book from a stationer’s.', pick: false },
  { cls: 'type-c', letter: 'C', name: 'Old letters', fonts: 'Nanum Myeongjo with Gowun Dodum', note: 'Classic ink for the headings, a soft hand for the rest.', pick: false },
] as const;

const ROWS = [
  { emoji: '🛒', what: '이마트 성수점', who: 'dog' as const, amount: '£86.20' },
  { emoji: '🍜', what: 'Dishoom with 지수', who: 'cat' as const, amount: '£64.00' },
  { emoji: '🚆', what: 'Trainline', who: 'dog' as const, amount: '£23.40' },
];

function MiniHome({ cls }: { cls: string }) {
  return (
    <div className={`${cls} bg-paper border-line flex flex-col gap-3 rounded-[20px] border p-4`}>
      <Plank left={{ kind: 'cat', mood: 'sheepish' }} right={{ kind: 'dog', mood: 'pleased' }} leftNetPence={-2450} motion={false} />
      <p className="text-sentence m-0 text-center">
        Sam owes Jae <span className="text-amount">£24.50</span>
      </p>
      <p className="text-secondary text-ink-2 m-0 text-center">Next one’s on Sam</p>
      <Button variant="primary" className="self-center">Settle up</Button>
      <Field label="Quick add" defaultValue="42.50 tesco" readOnly hint="£42.50 · Tesco · Groceries · Jae paid · 50/50" />
      <div className="mt-2">
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
    <Section id="g-type" title="Letters" ask="Which hand should smsm be written in? Each one draws your Korean names too.">
      {OPTIONS.map((o) => (
        <div key={o.cls} className="flex flex-col gap-3">
          <div className={`${o.cls} flex gap-3`}>
            <OptionMark letter={o.letter} />
            <div className="min-w-0">
              <h3 className="text-title m-0">{o.name}</h3>
              <p className="text-secondary text-ink-2 m-0">
                {o.fonts}. {o.note}
                {o.pick ? <span className="text-ink"> The warmest of the three.</span> : null}
              </p>
            </div>
          </div>
          <MiniHome cls={o.cls} />
        </div>
      ))}
    </Section>
  );
}
