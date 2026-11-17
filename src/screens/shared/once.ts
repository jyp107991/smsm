/**
 * S2 polish Q-F1 (ADD-6, ADD-7): a tap that saves money records once. Each tap-action gets one row id; taps
 * that follow it closely (a double tap, Enter held on the button) belong to the same action and do nothing
 * more. A tap after a pause is a new action on purpose (a second Duplicate makes a second copy).
 */
import { useRef } from 'react';
import { newId } from '../../data';

/** Taps closer together than this are the same action. A double tap is well under it; each repeat extends it. */
export const SAME_TAP_MS = 700;

export function useTapAction(now: () => number = () => performance.now()): (run: (id: string) => void) => void {
  const last = useRef<number | null>(null);
  return (run) => {
    const t = now();
    const repeat = last.current !== null && t - last.current < SAME_TAP_MS;
    last.current = t;
    if (repeat) return;
    run(newId());
  };
}
