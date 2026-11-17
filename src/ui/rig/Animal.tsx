/**
 * The cat and the dog (DESIGN §2.3): one SVG rig assembled from named parts.
 * - Mood swaps only the eyes, brows and mouth (moods.ts).
 * - Pose decides which parts render and where.
 * - Motion is CSS on single named parts (rig.css), only when asked for and reduced motion is not preferred.
 */
import type { ReactNode } from 'react';
import { MOODS, faceFor, type AnimalKind, type Mood, type Shape } from './moods';
import { anatomyOf, type Piece } from './shapes';
import { usePrefersReducedMotion } from './motion';
import './rig.css';

export { MOODS };
export type { Mood, AnimalKind };

export const POSES = ['head', 'sitting', 'peeking', 'curled'] as const;
export type Pose = (typeof POSES)[number];

export type PartName = 'head' | 'ear-left' | 'ear-right' | 'eyes' | 'brows' | 'mouth' | 'cheeks' | 'body' | 'tail' | 'paws';

/** Square view boxes, framed per pose so each fills its box. */
const VIEW_BOX: Record<Pose, string> = {
  head: '16 -2 88 88',
  sitting: '0 -3 120 120',
  peeking: '16 -16.6 88 88',
  curled: '2 16 114 114',
};
/** Where the head sits when curled up (lying on its front paws, at the front of the body). */
const CURLED_HEAD = 'translate(-15 33)';

export interface AnimalProps {
  kind: AnimalKind;
  mood?: Mood;
  pose?: Pose;
  size?: number;
  motion?: boolean;
  title?: string;
}

function pieces(list: Piece[]): ReactNode {
  return list.map((pc, i) => <path key={i} d={pc.d} className={`rig-f-${pc.fill}${pc.outline ? ' rig-o' : ''}`} />);
}

function shapes(list: Shape[]): ReactNode {
  return list.map((s, i) => <path key={i} d={s.d} className={`rig-p-${s.paint}`} />);
}

function Part({ name, motion, children }: { name: PartName; motion?: string | false; children: ReactNode }) {
  return (
    <g data-part={name} className={motion || undefined}>
      {children}
    </g>
  );
}

export function Animal({ kind, mood = 'calm', pose = 'sitting', size = 120, motion = true, title }: AnimalProps) {
  const reduced = usePrefersReducedMotion();
  const moving = motion && !reduced;
  const a = anatomyOf(kind);
  const face = faceFor(kind, a.face, mood);
  const m = (cls: string): string | false => moving && cls;

  const earLeft = <Part name="ear-left">{pieces(a.earLeft)}</Part>;
  const headUnit = (
    <g className={m('rig-m-tilt') || undefined}>
      {a.earLeftInFront ? null : earLeft}
      <Part name="ear-right" motion={m('rig-m-ear')}>
        {pieces(a.earRight)}
      </Part>
      <Part name="head">{pieces(a.head)}</Part>
      {a.earLeftInFront ? earLeft : null}
      <Part name="cheeks">{pieces(a.cheeks)}</Part>
      <Part name="eyes" motion={m('rig-m-blink')}>
        {shapes(face.eyes)}
      </Part>
      <Part name="brows">{shapes(face.brows)}</Part>
      <Part name="mouth">{shapes(face.mouth)}</Part>
    </g>
  );
  const tailMotion = m(kind === 'cat' ? 'rig-m-sway' : 'rig-m-wag');

  let drawing: ReactNode;
  switch (pose) {
    case 'head':
      drawing = headUnit;
      break;
    case 'sitting':
      drawing = (
        <>
          <Part name="tail" motion={tailMotion}>
            {pieces(a.tail)}
          </Part>
          <Part name="body" motion={m('rig-m-breath')}>
            {pieces(a.body)}
          </Part>
          <Part name="paws">{pieces(a.paws)}</Part>
          {headUnit}
        </>
      );
      break;
    case 'peeking':
      drawing = (
        <>
          {headUnit}
          <Part name="paws">{pieces(a.peekPaws)}</Part>
        </>
      );
      break;
    case 'curled': {
      // The cat's long tail wraps round the front; the dog's short one curls up behind.
      const tail = (
        <Part name="tail" motion={tailMotion}>
          {pieces(a.curledTail)}
        </Part>
      );
      drawing = (
        <>
          {kind === 'dog' ? tail : null}
          <Part name="body" motion={m('rig-m-breath')}>
            {pieces(a.curledBody)}
          </Part>
          <g transform={CURLED_HEAD}>{headUnit}</g>
          {kind === 'cat' ? tail : null}
        </>
      );
      break;
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox={VIEW_BOX[pose]}
      role="img"
      aria-label={title ?? kind}
      className={`rig rig-${kind} rig-pose-${pose}`}
      data-mood={mood}
      data-pose={pose}
      overflow="hidden"
    >
      {drawing}
    </svg>
  );
}
