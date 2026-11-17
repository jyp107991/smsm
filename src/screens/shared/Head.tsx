import { Animal, type Mood } from '../../ui/rig/Animal';
import { cx } from '../../ui/primitives/util';

/** A person's animal head, as decoration beside their name (DESIGN §2.3: always the person's own animal). */
export function Head({ animal, size = 20, mood = 'calm', className, nod = false }: {
  animal: 'cat' | 'dog';
  size?: number;
  mood?: Mood;
  className?: string;
  /** One nod (the payer's head on the "Saved" toast). */
  nod?: boolean;
}) {
  return (
    <span aria-hidden="true" className={cx('inline-flex shrink-0', nod && 'rig-m-hop', className)}>
      <Animal kind={animal} pose="head" size={size} mood={mood} motion={false} />
    </span>
  );
}
