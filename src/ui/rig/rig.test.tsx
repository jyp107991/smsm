/**
 * The cat and the dog (DESIGN §2.3): one SVG rig per animal, built from named parts. Mood swaps only
 * the eye, brow and mouth paths; pose decides which parts render; motion is CSS classes on the parts,
 * off under reduced motion. The plank (BAL-3) tilts by plankTilt().
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Animal, MOODS, POSES } from './Animal';
import { Plank } from './Plank';
import { plankTilt } from '../plank';

type Mood = (typeof MOODS)[number];
type Kind = 'cat' | 'dog';
const KINDS: Kind[] = ['cat', 'dog'];

const ALL_PARTS = ['head', 'ear-left', 'ear-right', 'eyes', 'brows', 'mouth', 'cheeks', 'body', 'tail', 'paws'];
const HEAD_PARTS = ['head', 'ear-left', 'ear-right', 'eyes', 'brows', 'mouth', 'cheeks'];
const MOOD_PARTS = ['eyes', 'brows', 'mouth'];

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

/** Make `(prefers-reduced-motion: reduce)` match (and `no-preference` not). */
function preferReducedMotion(): void {
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes('prefers-reduced-motion') && !query.includes('no-preference'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

function onlySvg(container: HTMLElement): SVGSVGElement {
  const svgs = container.querySelectorAll('svg');
  expect(svgs).toHaveLength(1);
  return svgs[0]!;
}

function partNames(root: Element): string[] {
  return [...root.querySelectorAll('[data-part]')].map((el) => el.getAttribute('data-part') ?? '');
}

function motionClasses(root: Element): string[] {
  const all = [root, ...root.querySelectorAll('*')];
  return all.flatMap((el) => (el.getAttribute('class') ?? '').split(/\s+/).filter((c) => c.startsWith('rig-m-')));
}

/** The svg's markup with the mood parts taken out: what a mood change must leave untouched. */
function withoutMoodParts(svg: SVGSVGElement): string {
  const copy = svg.cloneNode(true) as SVGSVGElement;
  for (const el of copy.querySelectorAll(MOOD_PARTS.map((p) => `[data-part="${p}"]`).join(','))) el.remove();
  return copy.innerHTML;
}

function moodMarkup(svg: SVGSVGElement): string {
  return MOOD_PARTS.map((p) => svg.querySelector(`[data-part="${p}"]`)?.outerHTML ?? '').join('\n');
}

describe('Animal rig', () => {
  it('has the eight moods and four poses from DESIGN §2.3', () => {
    expect([...MOODS]).toEqual(['calm', 'happy', 'sheepish', 'pleased', 'curious', 'sleepy', 'surprised', 'proud']);
    expect([...POSES]).toEqual(['head', 'sitting', 'peeking', 'curled']);
  });

  for (const kind of KINDS) {
    for (const pose of POSES) {
      for (const mood of MOODS) {
        it(`${kind}, ${mood}, ${pose}: one svg, role img, named`, () => {
          const { container } = render(<Animal kind={kind} mood={mood} pose={pose} motion={false} />);
          const svg = onlySvg(container);
          expect(svg.getAttribute('role')).toBe('img');
          expect(screen.getByRole('img', { name: kind })).toBe(svg);
          for (const part of container.querySelectorAll('[data-part]')) {
            expect(part.tagName.toLowerCase()).toBe('g');
            expect(ALL_PARTS).toContain(part.getAttribute('data-part'));
          }
          expect(partNames(svg)).toContain('head');
        });
      }
    }

    it(`${kind}: the title prop becomes the accessible name`, () => {
      render(<Animal kind={kind} title="Sam's animal" />);
      expect(screen.getByRole('img', { name: "Sam's animal" })).toBeTruthy();
    });

    it(`${kind}: renders with only a kind (default mood and pose)`, () => {
      const { container } = render(<Animal kind={kind} />);
      expect(onlySvg(container).getAttribute('role')).toBe('img');
    });

    it(`${kind}, sitting: every named part is there, once`, () => {
      for (const mood of MOODS) {
        const { container, unmount } = render(<Animal kind={kind} mood={mood} pose="sitting" motion={false} />);
        expect(partNames(onlySvg(container)).sort()).toEqual([...ALL_PARTS].sort());
        unmount();
      }
    });

    it(`${kind}, head: only the head's parts`, () => {
      for (const mood of MOODS) {
        const { container, unmount } = render(<Animal kind={kind} mood={mood} pose="head" motion={false} />);
        expect(partNames(onlySvg(container)).sort()).toEqual([...HEAD_PARTS].sort());
        unmount();
      }
    });

    it(`${kind}, peeking: head and paws over the edge`, () => {
      const { container } = render(<Animal kind={kind} pose="peeking" motion={false} />);
      const parts = partNames(onlySvg(container));
      expect(parts).toContain('head');
      expect(parts).toContain('paws');
    });

    it(`${kind}, curled: head and body`, () => {
      const { container } = render(<Animal kind={kind} pose="curled" motion={false} />);
      const parts = partNames(onlySvg(container));
      expect(parts).toContain('head');
      expect(parts).toContain('body');
    });

    for (const pose of POSES) {
      it(`${kind}, ${pose}: changing mood changes only eyes, brows and mouth`, () => {
        const { container, rerender } = render(<Animal kind={kind} mood="calm" pose={pose} motion={false} />);
        const base = withoutMoodParts(onlySvg(container));
        for (const mood of MOODS) {
          rerender(<Animal kind={kind} mood={mood} pose={pose} motion={false} />);
          expect(withoutMoodParts(onlySvg(container)), `${kind} ${pose} ${mood}`).toBe(base);
        }
      });
    }

    for (const pose of ['sitting', 'head'] as const) {
      it(`${kind}, ${pose}: each mood has its own face`, () => {
        const faces = new Map<string, Mood>();
        const { container, rerender } = render(<Animal kind={kind} mood="calm" pose={pose} motion={false} />);
        for (const mood of MOODS) {
          rerender(<Animal kind={kind} mood={mood} pose={pose} motion={false} />);
          const face = moodMarkup(onlySvg(container));
          expect(faces.get(face), `${mood} looks the same as ${String(faces.get(face))}`).toBeUndefined();
          faces.set(face, mood);
        }
      });
    }

    for (const pose of POSES) {
      it(`${kind}, ${pose}: motion classes when motion is on`, () => {
        const { container } = render(<Animal kind={kind} pose={pose} motion={true} />);
        expect(motionClasses(onlySvg(container)).length).toBeGreaterThan(0);
      });

      it(`${kind}, ${pose}: no motion classes with motion={false}`, () => {
        const { container } = render(<Animal kind={kind} pose={pose} motion={false} />);
        expect(motionClasses(onlySvg(container))).toEqual([]);
      });

      it(`${kind}, ${pose}: no motion classes when reduced motion is preferred, even with motion on`, () => {
        preferReducedMotion();
        const { container } = render(<Animal kind={kind} pose={pose} motion={true} />);
        expect(motionClasses(onlySvg(container))).toEqual([]);
      });
    }
  }
});

describe('Plank (BAL-3)', () => {
  const balances = [0, 1, -1, 2450, -2450, 10000, -10000, 19999, 20000, -20000, 50000, -123456];

  for (const leftNetPence of balances) {
    it(`BAL-3: data-tilt follows plankTilt at ${String(leftNetPence)} pence`, () => {
      const { container } = render(
        <Plank left={{ kind: 'cat', mood: 'pleased' }} right={{ kind: 'dog', mood: 'sheepish' }} leftNetPence={leftNetPence} motion={false} />,
      );
      const tilted = container.querySelectorAll('[data-tilt]');
      expect(tilted).toHaveLength(1);
      expect(Number(tilted[0]!.getAttribute('data-tilt'))).toBe(plankTilt(leftNetPence));
    });
  }

  it('BAL-3: level at zero', () => {
    const { container } = render(
      <Plank left={{ kind: 'dog', mood: 'happy' }} right={{ kind: 'cat', mood: 'happy' }} leftNetPence={0} motion={false} />,
    );
    expect(container.querySelector('[data-tilt]')?.getAttribute('data-tilt')).toBe('0');
  });

  it('BAL-3: shows both animals, either way round', () => {
    for (const [left, right] of [
      ['cat', 'dog'],
      ['dog', 'cat'],
    ] as const) {
      const { container, unmount } = render(
        <Plank left={{ kind: left, mood: 'pleased' }} right={{ kind: right, mood: 'sheepish' }} leftNetPence={-5000} motion={false} />,
      );
      const names = screen.getAllByRole('img', { hidden: true }).map((el) => el.getAttribute('aria-label') ?? '');
      expect(names.some((n) => /cat/i.test(n))).toBe(true);
      expect(names.some((n) => /dog/i.test(n))).toBe(true);
      expect(container.querySelectorAll('[data-part="head"]').length).toBeGreaterThanOrEqual(2);
      unmount();
    }
  });

  it('BAL-3: no motion classes with motion={false}', () => {
    const { container } = render(
      <Plank left={{ kind: 'cat', mood: 'calm' }} right={{ kind: 'dog', mood: 'calm' }} leftNetPence={3000} motion={false} />,
    );
    expect(motionClasses(container)).toEqual([]);
  });
});
