/**
 * The Home plank (DESIGN §4.1, SPEC BAL-3): a walnut plank on a small oak pivot with the two animals
 * riding its ends. It tilts toward whoever is owed (their end rises), in proportion to the balance,
 * and re-levels with a spring. Under reduced motion it shows its tilt without animating.
 * The sentence beneath it carries the meaning; the plank is the picture of it.
 */
import { motion as m } from 'motion/react';
import { Animal, type AnimalKind, type Mood } from './Animal';
import { plankTilt } from '../plank';
import { usePrefersReducedMotion } from './motion';
import { strings } from '../strings';
import './rig.css';

export interface PlankSeat {
  kind: AnimalKind;
  mood: Mood;
}
export interface PlankProps {
  left: PlankSeat;
  right: PlankSeat;
  /** The left person's net position in pence: positive when the left person is owed. */
  leftNetPence: number;
  motion?: boolean;
  /** Square: the two sit close, nearer the middle (DESIGN §2.3). */
  together?: boolean;
  /** The all-square moment: both hop once (nothing under reduced motion). */
  hop?: boolean;
}

/** Each animal's size on the plank, in px. Fixed, so the plank never changes height. */
const SEAT = 88;
// Settles in about a quarter of a second with almost no overshoot (DESIGN §3.4: quiet, 180–260 ms).
const SPRING = { type: 'spring', stiffness: 300, damping: 34, mass: 1 } as const;

function Beam() {
  return (
    <svg aria-hidden="true" focusable="false">
      <rect x="0" y="0" width="100%" height="100%" rx="6" className="rig-plank-wood rig-plank-o" />
      <line x1="5%" x2="31%" y1="38%" y2="38%" className="rig-plank-grain" />
      <line x1="38%" x2="56%" y1="38%" y2="38%" className="rig-plank-grain" />
      <line x1="16%" x2="47%" y1="68%" y2="68%" className="rig-plank-grain" />
      <line x1="60%" x2="94%" y1="58%" y2="58%" className="rig-plank-grain" />
      <line x1="70%" x2="88%" y1="30%" y2="30%" className="rig-plank-grain" />
      <ellipse cx="63%" cy="34%" rx="1.4%" ry="16%" className="rig-plank-grain" />
    </svg>
  );
}

export function Plank({ left, right, leftNetPence, motion = true, together = false, hop = false }: PlankProps) {
  const reduced = usePrefersReducedMotion();
  const tilt = plankTilt(leftNetPence);
  const label = strings.rig.plank(strings.rig.kind[left.kind], strings.rig.kind[right.kind], tilt > 0 ? 'left' : tilt < 0 ? 'right' : 'level');

  const seats = (
    <>
      <div className={`rig-plank-seat rig-plank-seat-left${together ? ' rig-plank-together' : ''}`}>
        <div className={hop && motion && !reduced ? 'rig-m-hop' : undefined}>
          <Animal kind={left.kind} mood={left.mood} pose="sitting" size={SEAT} motion={motion} />
        </div>
      </div>
      <div className={`rig-plank-seat rig-plank-seat-right${together ? ' rig-plank-together' : ''}`}>
        <div className={hop && motion && !reduced ? 'rig-m-hop' : undefined} style={hop ? { animationDelay: '90ms' } : undefined}>
          <Animal kind={right.kind} mood={right.mood} pose="sitting" size={SEAT} motion={motion} />
        </div>
      </div>
      <Beam />
    </>
  );

  return (
    <div className="rig-plank" role="img" aria-label={label}>
      <svg className="rig-plank-pivot" viewBox="0 0 56 38" aria-hidden="true" focusable="false">
        <path d="M28 3C30 3 31.4 4.2 32.4 6L50 33C51.4 35.4 50.2 37 47.6 37H8.4C5.8 37 4.6 35.4 6 33L23.6 6C24.6 4.2 26 3 28 3Z" className="rig-plank-oak rig-plank-o" />
      </svg>
      {motion && !reduced ? (
        <m.div className="rig-plank-beam" data-tilt={tilt} initial={false} animate={{ rotate: tilt }} transition={SPRING}>
          {seats}
        </m.div>
      ) : (
        <div className="rig-plank-beam" data-tilt={tilt} style={{ transform: `rotate(${tilt}deg)` }}>
          {seats}
        </div>
      )}
    </div>
  );
}
