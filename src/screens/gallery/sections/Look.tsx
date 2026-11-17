/** Gallery: logo variants, the plank at five balances, and the cat and dog in every mood and pose (DESIGN §7). */
import { useState } from 'react';
import { formatPence, pence } from '../../../core/money';
import { Logo, type LogoVariant } from '../../../ui/Logo';
import { Animal, MOODS, POSES, type Mood } from '../../../ui/rig/Animal';
import { Plank } from '../../../ui/rig/Plank';

const LOGOS: readonly { variant: LogoVariant; note: string }[] = [
  { variant: 'a', note: 'A: plain letters, like a clean sans-serif ㅅ and ㅁ.' },
  { variant: 'b', note: 'B: as A, with a door in the bottom of ㅁ.' },
  { variant: 'c', note: 'C: ㅅ with feet that sweep out, like eaves.' },
];

export function LogoSection() {
  return (
    <section aria-labelledby="g-logo" className="flex flex-col gap-4">
      <h2 id="g-logo" className="text-[1.375rem] leading-tight font-semibold">Logo</h2>
      <p className="text-ink-2">ㅅ on ㅁ, a house. Shown at app-icon size (48) and larger. Pick one.</p>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {LOGOS.map((l) => (
          <li key={l.variant} className="bg-surface flex items-center gap-4 rounded-[16px] p-3">
            <Logo size={48} variant={l.variant} title={`Logo ${l.variant.toUpperCase()} at 48 pixels`} />
            <Logo size={96} variant={l.variant} title={`Logo ${l.variant.toUpperCase()} at 96 pixels`} />
            <span className="min-w-0 text-[0.9375rem]">{l.note}</span>
          </li>
        ))}
      </ul>
    </section>
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
    <section aria-labelledby="g-plank" className="flex flex-col gap-4">
      <h2 id="g-plank" className="text-[1.375rem] leading-tight font-semibold">The plank</h2>
      <p className="text-ink-2">Sam (the cat) on the left, Jae (the dog) on the right. Whoever is owed sits higher; level is square.</p>
      {BALANCES.map((b) => {
        const leftMood: Mood = b === 0 ? 'happy' : b > 0 ? 'pleased' : 'sheepish';
        const rightMood: Mood = b === 0 ? 'happy' : b > 0 ? 'sheepish' : 'pleased';
        return (
          <figure key={b} className="m-0 flex flex-col items-center gap-2">
            <Plank left={{ kind: 'cat', mood: leftMood }} right={{ kind: 'dog', mood: rightMood }} leftNetPence={b} />
            <figcaption className="text-[1.0625rem] font-semibold">{sentence(b)}</figcaption>
          </figure>
        );
      })}
    </section>
  );
}

export function RigSection() {
  const [motion, setMotion] = useState(true);
  return (
    <section aria-labelledby="g-rig" className="flex flex-col gap-4">
      <h2 id="g-rig" className="text-[1.375rem] leading-tight font-semibold">The cat and the dog</h2>
      <p className="text-ink-2">Eight moods in four poses: head, sitting, peeking over an edge, curled up.</p>
      <button
        type="button"
        aria-pressed={motion}
        onClick={() => { setMotion((m) => !m); }}
        className="bg-sunk min-h-11 self-start rounded-full px-5 font-semibold"
      >
        {motion ? 'Motion on' : 'Motion off'}
      </button>
      {(['cat', 'dog'] as const).map((kind) => (
        <div key={kind} className="flex flex-col gap-2">
          <h3 className="text-[1.0625rem] font-semibold">{kind === 'cat' ? 'The cat' : 'The dog'}</h3>
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
    </section>
  );
}
