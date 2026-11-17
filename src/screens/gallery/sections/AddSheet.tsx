/**
 * Gallery: the add sheet as it will look (DESIGN §4.2), drawn in place rather than opened over the page.
 * Built from the real primitives; the live form with saving arrives in S2.
 */
import { useState } from 'react';
import { Button, Chip, Field, Segmented } from '../../../ui/primitives';
import { Animal } from '../../../ui/rig/Animal';

const CATEGORIES = [
  { name: 'Groceries', colour: 'moss' },
  { name: 'Eating out', colour: 'amber' },
  { name: 'Household', colour: 'oak' },
  { name: 'Other', colour: 'stone' },
] as const;

export function AddSheetExample() {
  const [category, setCategory] = useState<string>('Groceries');
  const [payer, setPayer] = useState<'jae' | 'sam'>('jae');
  const [split, setSplit] = useState('split');
  const [day, setDay] = useState('today');
  return (
    <div className="bg-surface shadow-float flex flex-col gap-4 rounded-t-[28px] px-5 pt-3 pb-5" aria-label="Add expense (example)" role="group">
      <span aria-hidden="true" className="bg-line mx-auto h-1.5 w-10 rounded-full" />
      <h3 className="text-title m-0">Add expense</h3>
      <Field label="Amount" variant="amount" defaultValue="42.50" />
      <Field label="Description" defaultValue="Tesco" enterKeyHint="next" />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Category">
        {CATEGORIES.map((c) => (
          <Chip key={c.name} colour={c.colour} selected={category === c.name} suggested={c.name === 'Groceries'} onSelectedChange={() => { setCategory(c.name); }}>
            {c.name}
          </Chip>
        ))}
      </div>
      <div className="flex gap-2" role="group" aria-label="Who paid">
        {(['jae', 'sam'] as const).map((p) => (
          <Chip key={p} selected={payer === p} onSelectedChange={() => { setPayer(p); }}>
            <span aria-hidden="true" className="inline-flex"><Animal kind={p === 'jae' ? 'dog' : 'cat'} pose="head" size={24} motion={false} /></span>
            {p === 'jae' ? 'Jae paid' : 'Sam paid'}
          </Chip>
        ))}
      </div>
      <Segmented
        label="Split"
        value={split}
        onValueChange={setSplit}
        options={[{ value: 'split', label: 'Split' }, { value: 'exact', label: 'Exact' }, { value: 'for', label: payer === 'jae' ? 'For Sam' : 'For Jae' }, { value: 'treat', label: 'My treat' }]}
      />
      <div className="flex flex-wrap gap-2" role="group" aria-label="Date">
        {[['today', 'Today'], ['yesterday', 'Yesterday'], ['pick', 'Pick a date']].map(([v, l]) => (
          <Chip key={v} selected={day === v} onSelectedChange={() => { setDay(v ?? 'today'); }}>{l}</Chip>
        ))}
      </div>
      <Button variant="primary" block>Save</Button>
    </div>
  );
}
