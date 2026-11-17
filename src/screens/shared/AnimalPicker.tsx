/**
 * PPL-3: the two animals as large picker cards (DESIGN §2.3 "Setup"). The one the partner already is shows
 * as taken and says whose it is ("Sam is the cat"), on the card itself, dimmed and not choosable (Q-L6).
 * Both cards keep the same frame: the drawing sits in a fixed box at the same height in each, so the two
 * line up whatever is written under them. Chosen is the one "selected" language for choice cards (Q-L2):
 * a surface card with a 1.5 px forest border; outlines only for keyboard focus.
 */
import { useId } from 'react';
import { Animal } from '../../ui/rig/Animal';
import { cx } from '../../ui/primitives/util';
import { strings } from '../../ui/strings';

/** The drawing's box, in px: fixed, so both cards' animals share a top and a height. */
const ART = 96;

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
          const takenName = takenBy?.animal === animal ? takenBy.name : null;
          const taken = takenName !== null;
          const chosen = value === animal && !taken;
          return (
            <label
              key={animal}
              className={cx(
                'relative flex min-h-44 min-w-0 flex-col items-center gap-1.5 rounded-[16px] border-[1.5px] px-2 pt-4 pb-3 text-center',
                'has-[:focus-visible]:outline-forest has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-solid',
                chosen ? 'border-forest bg-surface' : 'bg-sunk border-transparent',
                // Taken: the card is dimmed and its drawing greyed, while its words stay readable (AA).
                taken ? 'opacity-80' : 'press',
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
              <span aria-hidden="true" className={cx('flex shrink-0 items-end justify-center', taken && 'opacity-60 saturate-50')} style={{ width: ART, height: ART }}>
                <Animal kind={animal} pose="sitting" mood={chosen ? 'happy' : 'calm'} size={ART} motion={chosen} />
              </span>
              <span className={cx('text-body', chosen ? 'text-forest' : 'text-ink')}>{animal === 'cat' ? strings.setup.cat : strings.setup.dog}</span>
              {takenName !== null ? <span className="text-caption text-ink max-w-full break-words">{strings.setup.taken(takenName, animal)}</span> : null}
            </label>
          );
        })}
      </div>
    </div>
  );
}
