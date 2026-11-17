/**
 * TXT-2: Enter must never save in the middle of composing a character (Korean, Japanese, Chinese keyboards).
 * While composing, browsers flag the key event (`isComposing`) and Android keyboards send keyCode 229
 * ("being composed"); either one means the Enter belongs to the keyboard, not to the form.
 */
import type { KeyboardEvent } from 'react';

export function isComposingKey(e: { keyCode: number; nativeEvent: { isComposing?: boolean } }): boolean {
  // keyCode is deprecated, but 229 is the only sign of composing that some Android keyboards give.
  return e.nativeEvent.isComposing === true || e.keyCode === 229;
}

/** onKeyDown for the field whose Enter saves the form: a held Enter's repeats save nothing (Q-F1, Q-U1). */
export function enterSavesOnce(e: KeyboardEvent<HTMLElement>): void {
  if (e.key === 'Enter' && e.repeat) {
    e.preventDefault();
    return;
  }
  holdEnterWhileComposing(e);
}

/** onKeyDown for a field inside a form: an Enter while composing never submits it. */
export function holdEnterWhileComposing(e: KeyboardEvent<HTMLElement>): void {
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- keyCode 229: see isComposingKey
  if (e.key === 'Enter' && isComposingKey({ keyCode: e.keyCode, nativeEvent: e.nativeEvent })) e.preventDefault();
}

/**
 * S2 polish Q-U1: onKeyDown for a field whose Enter (Android's "Next") moves on to the next field or button
 * instead of saving the form. While composing, the Enter belongs to the keyboard: nothing moves.
 */
export function enterMovesTo(e: KeyboardEvent<HTMLElement>, next: HTMLElement | null | undefined): void {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  // A held key repeats: only the first press moves on (the repeats would run on through the form).
  if (e.repeat) return;
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- keyCode 229: see isComposingKey
  if (isComposingKey({ keyCode: e.keyCode, nativeEvent: e.nativeEvent })) return;
  next?.focus();
}
