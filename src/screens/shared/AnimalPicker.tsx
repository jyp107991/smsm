/**
 * PPL-3: the two animals as large picker cards (DESIGN §2.3 "Setup"). The one the partner already is shows
 * as taken and says whose it is ("Sam is the cat").
 */
import { useId } from 'react';
import { Animal } from '../../ui/rig/Animal';
import { cx } from '../../ui/primitives/util';
import { strings } from '../../ui/strings';

export function AnimalPicker({ value, onChange, takenBy }: {
  value: 'cat' | 'dog' | null;
  onChange: (animal: 'cat' | 'dog') => void;
  /** The partner's name and animal, when they have one. */
  takenBy: { name: string; animal: 'cat' | 'dog' } | null;
}) {
  const labelId = useId();
  const group = useId();
  return (
    <div className="flex flex-col gap-2">
      <span id={labelId} className="text-secondary text-ink-2 font-medium">{strings.setup.animal}</span>
      <div role="radiogroup" aria-labelledby={labelId} className="grid grid-cols-2 gap-3">
        {(['cat', 'dog'] as const).map((animal) => {
          const taken = takenBy?.animal === animal;
          const chosen = value === animal;
          return (
            <label
              key={animal}
              className={cx(
                'relative flex min-h-44 flex-col items-center justify-center gap-1 rounded-[16px] border-2 px-2 py-3 text-center',
                'has-[:focus-visible]:outline-forest has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-solid',
                chosen ? 'border-forest bg-surface' : 'bg-sunk border-transparent',
                taken && 'opacity-70',
              )}
            >
              {/* The real control covers the card, so a tap anywhere on it chooses. */}
              <input
                type="radio"
                name={group}
                value={animal}
                checked={chosen}
                disabled={taken}
                onChange={() => { onChange(animal); }}
                className="absolute inset-0 m-0 cursor-pointer appearance-none rounded-[16px] opacity-0 disabled:cursor-not-allowed"
              />
              <span aria-hidden="true">
                <Animal kind={animal} pose="sitting" mood={taken ? 'calm' : chosen ? 'happy' : 'calm'} size={96} motion={chosen} />
              </span>
              <span className={cx('text-body', chosen ? 'text-forest' : 'text-ink')}>{animal === 'cat' ? strings.setup.cat : strings.setup.dog}</span>
              {takenBy?.animal === animal ? <span className="text-caption text-ink-2 break-words">{strings.setup.taken(takenBy.name, animal)}</span> : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}
