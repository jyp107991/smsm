/**
 * The plank's beam on its spring (DESIGN §3.4: the plank re-levels with a spring, via the animation library).
 * S9 (performance audit P2): in a file of its own, with the library's features, so Home's first script holds
 * none of it. Plank.tsx draws the same beam standing still until this has arrived, after the first screen.
 */
import type { ReactNode } from 'react';
import { domAnimation, LazyMotion } from 'motion/react';
import * as m from 'motion/react-m';

// Settles in about a quarter of a second with almost no overshoot (DESIGN §3.4: quiet, 180–260 ms).
const SPRING = { type: 'spring', stiffness: 300, damping: 34, mass: 1 } as const;

export function PlankBeam({ tilt, onRest, children }: { tilt: number; onRest?: (tilt: number) => void; children: ReactNode }) {
  return (
    // `strict`: only `m` elements here, never the full `motion` ones (which would carry every feature).
    <LazyMotion features={domAnimation} strict>
      <m.div
        className="rig-plank-beam"
        data-tilt={tilt}
        initial={false}
        animate={{ rotate: tilt }}
        transition={SPRING}
        onAnimationComplete={() => { onRest?.(tilt); }}
      >
        {children}
      </m.div>
    </LazyMotion>
  );
}
