/**
 * TXT-2: Enter must never save in the middle of composing a character (Korean, Japanese, Chinese keyboards).
 * While composing, browsers flag the key event (`isComposing`) and Android keyboards send keyCode 229
 * ("being composed"); either one means the Enter belongs to the keyboard, not to the form.
 */
import type { KeyboardEvent } from 'react';

export function isComposingKey(e: Pick<KeyboardEvent, 'keyCode'> & { nativeEvent: { isComposing?: boolean } }): boolean {
  return e.nativeEvent.isComposing === true || e.keyCode === 229;
}

/** onKeyDown for a field inside a form: an Enter while composing never submits it. */
export function holdEnterWhileComposing(e: KeyboardEvent<HTMLElement>): void {
  if (e.key === 'Enter' && isComposingKey(e)) e.preventDefault();
}
