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
