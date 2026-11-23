import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

afterEach(() => {
  cleanup();
});

// jsdom has no matchMedia; tests that care about reduced motion replace this.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  configurable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }),
});

/**
 * jsdom runs no CSS animations, so a sheet sliding away (vaul's "slideToBottom", Radix Presence waiting for
 * its animationend) would stay mounted for ever and keep the page under it hidden from the accessibility tree.
 * In a browser it goes after half a second. Here it finishes as soon as it starts: when a sheet or its scrim
 * turns "closed", its animation ends straight away, as the browser's would.
 */
new MutationObserver((changes) => {
  for (const c of changes) {
    const el = c.target as HTMLElement;
    if (c.attributeName !== 'data-state' || el.getAttribute('data-state') !== 'closed') continue;
    if (!el.hasAttribute('data-vaul-drawer') && !el.hasAttribute('data-vaul-overlay')) continue;
    queueMicrotask(() => {
      if (!el.isConnected || el.getAttribute('data-state') !== 'closed') return;
      const end = new Event('animationend', { bubbles: true });
      Object.defineProperty(end, 'animationName', { value: getComputedStyle(el).animationName });
      el.dispatchEvent(end);
    });
  }
}).observe(document, { subtree: true, attributes: true, attributeFilter: ['data-state'] });

/**
 * S9 (performance audit P2): the sheet's own code (vaul) is fetched after the app's first screen, in idle time
 * (src/screens/lazy.tsx), long before a person can open a sheet. The screens' tests start from that state, as
 * the app is by the time anyone taps; a sheet opened before its file arrives waits for it (s9-perf.test.tsx).
 */
await (await import('../src/ui/primitives/Sheet')).preloadSheet();
