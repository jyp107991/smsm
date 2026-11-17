/**
 * Where focus goes back to when a sheet or menu closes (WCAG 2.4.3, DESIGN §6): to whatever opened it.
 * When that is gone (the quick-add reading disappears as it opens the form; a menu item goes with its
 * menu), focus goes to the page's fallback instead: the Quick add box on Home registers itself as that.
 */

let fallback: HTMLElement | null = null;

/** Registers the element focus falls back to; returns the unregister. One at a time (the latest wins). */
export function registerFocusFallback(el: HTMLElement): () => void {
  fallback = el;
  return () => {
    if (fallback === el) fallback = null;
  };
}

/** What has focus now, as something to come back to (nothing when it is the page itself). */
export function focusedElement(): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  const el = document.activeElement;
  return el instanceof HTMLElement && el !== document.body ? el : null;
}

/** Still in the page, shown and enabled. */
function canTakeFocus(el: HTMLElement | null): el is HTMLElement {
  if (!el?.isConnected) return false;
  if ((el as HTMLButtonElement).disabled) return false;
  if (el.closest('[inert]')) return false;
  return typeof el.checkVisibility === 'function' ? el.checkVisibility({ visibilityProperty: true }) : true;
}

/** Puts focus back on `opener`, or on the fallback when the opener has gone. True when something took it. */
export function returnFocus(opener: HTMLElement | null): boolean {
  const target = canTakeFocus(opener) ? opener : canTakeFocus(fallback) ? fallback : null;
  if (!target) return false;
  target.focus();
  return document.activeElement === target;
}
