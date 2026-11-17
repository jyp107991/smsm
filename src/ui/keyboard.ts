/** The on-screen keyboard (S2 polish Q-U4, Q-U6): whether it is really open. Shared by the tab bar and Quick add. */
import { useEffect, useState } from 'react';

function isTextEntry(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable || el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'].includes(el.type);
}

/** How much shorter the visible page must be than the tallest seen at this width to be a keyboard, in px. */
const KEYBOARD_PX = 150;

/**
 * True while the on-screen keyboard is really open (S2 polish Q-U4): a text field has focus on a touch
 * screen and the visual viewport is clearly shorter than the tallest it has been at this width (index.html
 * sets `interactive-widget=resizes-content`, so the keyboard shrinks the page). Focus alone is not enough:
 * a hardware keyboard, or a field focused before the keyboard rises, leaves the tab bar where it is.
 * The tallest height is kept per width and forgotten when the phone turns, so turning it doesn't read as a
 * keyboard; it is compared with what has been seen rather than `screen.height`, which some browsers shrink
 * with the viewport. Heights are taken at the page's scale, so pinch-zoom doesn't read as a keyboard either.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)');
    const viewport = window.visualViewport;
    const tallest = new Map<number, number>();
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      // After focusout, activeElement is only settled on the next frame.
      frame = requestAnimationFrame(() => {
        const width = Math.round(window.innerWidth);
        // At the page's own scale: pinch-zoom shrinks the visual viewport too, and that isn't a keyboard.
        const height = viewport ? viewport.height * viewport.scale : window.innerHeight;
        const most = Math.max(tallest.get(width) ?? 0, height);
        tallest.set(width, most);
        setOpen(coarse.matches && isTextEntry(document.activeElement) && most - height > KEYBOARD_PX);
      });
    };
    // Turned on its side, the phone has a new tallest height; what was seen before no longer counts.
    // (Older browsers and test pages have no screen.orientation; they still send orientationchange.)
    const orientation = (screen as { orientation?: ScreenOrientation }).orientation;
    let facedType = orientation?.type;
    let facedWidth = Math.round(window.innerWidth);
    // Only a real turn counts (the orientation and the width both change): some browsers send the event
    // for any resize, the keyboard's included.
    const turned = () => {
      const type = orientation?.type;
      const width = Math.round(window.innerWidth);
      if (type !== facedType && width !== facedWidth) tallest.clear();
      facedType = type;
      facedWidth = width;
      update();
    };
    update();
    orientation?.addEventListener('change', turned);
    window.addEventListener('orientationchange', turned);
    viewport?.addEventListener('resize', update);
    window.addEventListener('resize', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      cancelAnimationFrame(frame);
      orientation?.removeEventListener('change', turned);
      window.removeEventListener('orientationchange', turned);
      viewport?.removeEventListener('resize', update);
      window.removeEventListener('resize', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
    };
  }, []);
  return open;
}

