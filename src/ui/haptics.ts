/**
 * Haptics on Android (DESIGN §3.4): a 10 ms tick on save, two ticks on settle, none elsewhere. Silent where
 * the phone has no vibration or the person asked for reduced motion.
 */
import { prefersReducedMotion } from './rig/motion';

function vibrate(pattern: number | number[]): void {
  if (prefersReducedMotion()) return;
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern);
  } catch {
    /* not allowed here (an iframe, a desktop): nothing to do */
  }
}

export function tickSaved(): void {
  vibrate(10);
}

export function tickSettled(): void {
  vibrate([10, 70, 10]);
}
