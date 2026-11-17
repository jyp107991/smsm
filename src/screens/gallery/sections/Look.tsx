/** Gallery: the mark, the plank at five balances, and the cat and dog in every mood and pose (DESIGN §7). */
import { useState } from 'react';
import { formatPence, pence } from '../../../core/money';
import { Logo, type LogoVariant } from '../../../ui/Logo';
import { Animal, MOODS, POSES, type Mood } from '../../../ui/rig/Animal';
import { Plank } from '../../../ui/rig/Plank';
import { OptionMark, Section } from './Section';

const LOGOS: readonly { variant: LogoVariant; name: string; note: string }[] = [
  { variant: 'a', name: 'Plain letters', note: 'ㅅ and ㅁ as you would type them.' },
  { variant: 'b', name: 'With a door', note: 'The same, with a gap in the foot of ㅁ.' },
  { variant: 'c', name: 'Under the eaves', note: 'ㅅ with feet that sweep out, like a roof.' },
];

export function LogoSection() {
  return (
    <Section id="g-logo" title="The mark" ask="ㅅ on ㅁ, a roof on a house. Which one is ours?">
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {LOGOS.map((l) => (
          <li key={l.variant} className="bg-surface flex gap-3 rounded-[16px] p-4">
            <OptionMark letter={l.variant.toUpperCase()} />
            <div className="flex min-w-0 flex-col gap-3">
              <div>
                <p className="text-subtitle m-0">{l.name}</p>
                <p className="text-secondary text-ink-2 m-0">{l.note}</p>
              </div>
              <div className="flex items-end gap-4">
                <Logo size={48} variant={l.variant} title={`Mark ${l.variant.toUpperCase()} at 48 pixels`} />
                <Logo size={96} variant={l.variant} title={`Mark ${l.variant.toUpperCase()} at 96 pixels`} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}

const BALANCES = [-25000, -4000, 0, 1200, 20000] as const;

function sentence(leftNet: number): string {
  if (leftNet === 0) return 'All square';
  const amount = formatPence(pence(Math.abs(leftNet)));
  return leftNet > 0 ? `Jae owes Sam ${amount}` : `Sam owes Jae ${amount}`;
}

export function PlankSection() {
  return (
    <Section id="g-plank" title="The plank" ask="Whoever is owed sits higher. Level means square.">
      {BALANCES.map((b) => {
        const leftMood: Mood = b === 0 ? 'happy' : b > 0 ? 'pleased' : 'sheepish';
        const rightMood: Mood = b === 0 ? 'happy' : b > 0 ? 'sheepish' : 'pleased';
        return (
          <figure key={b} className="m-0 flex flex-col items-center gap-2">
            <Plank left={{ kind: 'cat', mood: leftMood }} right={{ kind: 'dog', mood: rightMood }} leftNetPence={b} />
            <figcaption className="text-subtitle">{sentence(b)}</figcaption>
          </figure>
        );
      })}
    </Section>
  );
}

export function RigSection() {
  const [motion, setMotion] = useState(true);
  return (
    <Section id="g-rig" title="The cat and the dog">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-note m-0">Eight moods, four ways to sit.</p>
        <button
          type="button"
          aria-pressed={motion}
          onClick={() => { setMotion((m) => !m); }}
          className="border-forest aria-pressed:bg-forest aria-pressed:text-on-forest min-h-11 rounded-full border-2 px-5"
        >
          Let them move
        </button>
      </div>
      {(['cat', 'dog'] as const).map((kind) => (
        <div key={kind} className="flex flex-col gap-3">
          <h3 className="text-subtitle m-0">{kind === 'cat' ? 'Sam, the cat' : 'Jae, the dog'}</h3>
          <div className="grid grid-cols-4 gap-2">
            {MOODS.map((mood) =>
              POSES.map((pose) => (
                <div key={`${mood}-${pose}`} className="bg-surface flex flex-col items-center rounded-[12px] p-1">
                  <Animal kind={kind} mood={mood} pose={pose} size={64} motion={motion} title={`${kind}, ${mood}, ${pose}`} />
                  <span className="text-ink-2 text-[0.75rem]">{pose === 'head' ? mood : pose}</span>
                </div>
              )),
            )}
          </div>
        </div>
      ))}
    </Section>
  );
}
