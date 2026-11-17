/**
 * S2 polish Q-F1 (fresh review): the repeat-tap filter that keeps the rest of a double tap off what a closing
 * sheet uncovers. A press that began ignored is ignored to its end (a long press's late click); scripted
 * events and taps elsewhere or later always go through; StrictMode's practice run of a sheet's effects arms
 * nothing (only a real close does).
 */
import { render } from '@testing-library/react';
import { createElement, StrictMode } from 'react';
import { describe, expect, it } from 'vitest';
import { createRepeatTapFilter, repeatTapFiltersArmed, watchTaps, type TapLike } from './taps';
import { Sheet } from './primitives';

const at = (type: string, x = 100, y = 700, isTrusted = true): TapLike => ({ type, clientX: x, clientY: y, isTrusted });

describe('createRepeatTapFilter', () => {
  const spot = { x: 100, y: 700 };

  it('Q-F1: a second tap at the same spot just after is ignored, all of it', () => {
    const ignore = createRepeatTapFilter(spot, 500);
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) expect(ignore(at(type), 100)).toBe(true);
  });

  it('Q-F1: a long press that began ignored has its late click ignored too', () => {
    const ignore = createRepeatTapFilter(spot, 500);
    expect(ignore(at('pointerdown'), 300)).toBe(true);
    expect(ignore(at('pointerup'), 1200)).toBe(true);
    expect(ignore(at('click'), 1210)).toBe(true);
    // The press is over: the next one, later, goes through.
    expect(ignore(at('pointerdown'), 1500)).toBe(false);
  });

  it('Q-F1: taps elsewhere, later, or scripted always go through', () => {
    const ignore = createRepeatTapFilter(spot, 500);
    expect(ignore(at('pointerdown', 300, 300), 100)).toBe(false);
    expect(ignore(at('click', 100, 700, false), 100)).toBe(false);
    expect(ignore(at('pointerdown'), 600)).toBe(false);
  });
});

describe('Sheet', () => {
  it('Q-F1: StrictMode running a sheet\'s effects twice arms nothing; a real close does', () => {
    // A tap has just come down (as it would on the button that opened the sheet).
    const sheet = (open: boolean) => createElement(StrictMode, null, createElement(Sheet, { open, onOpenChange: () => undefined, title: 'Test', children: 'Hello' }));
    watchTaps();
    window.dispatchEvent(new MouseEvent('pointerdown', { clientX: 10, clientY: 10 }));
    const view = render(sheet(true));
    expect(repeatTapFiltersArmed()).toBe(0);
    view.rerender(sheet(false));
    expect(repeatTapFiltersArmed()).toBe(1);
    view.unmount();
  });
});
