/**
 * TXT-6: long and non-Latin text truncates by whole characters (grapheme clusters, Intl.Segmenter).
 *
 * Convention tested here: `maxGraphemes` is the most the result may show, the "…" included, so a
 * truncated label always fits the room it was given. Text that already fits comes back unchanged,
 * with no "…".
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { truncate } from './text';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const graphemes = (s: string): string[] => [...segmenter.segment(s)].map((g) => g.segment);
const ELLIPSIS = '…';

const FAMILY = '👩‍👩‍👧‍👦'; // ZWJ sequence: 7 code points, 11 UTF-16 units, one grapheme
const THUMB = '👍🏽'; // emoji + skin-tone modifier
const FLAG_GB = '🇬🇧'; // regional-indicator pair
const FLAG_KR = '🇰🇷';
const RAINBOW = '🏳️‍🌈'; // flag + variation selector + ZWJ + rainbow
const E_ACUTE = 'é'; // e + combining acute
const STACKED = 'à̖̗'; // a + three combining marks
const HAN_NFD = '한'; // 한 as conjoining jamo (NFD): three code points, one grapheme
const KEYCAP = '1️⃣'; // 1️⃣

const ATOMS = ['a', 'Z', ' ', '-', '한', '국', '어', '김', '지', '민', FAMILY, THUMB, FLAG_GB, FLAG_KR, RAINBOW, E_ACUTE, STACKED, HAN_NFD, KEYCAP, 'é', '£', '4'];

describe('TXT-6 truncate', () => {
  it('TXT-6: leaves text that fits unchanged, with no ellipsis', () => {
    expect(truncate('Tesco', 5)).toBe('Tesco');
    expect(truncate('Tesco', 40)).toBe('Tesco');
    expect(truncate('', 3)).toBe('');
    expect(truncate('김지민', 3)).toBe('김지민');
    expect(truncate(`${FAMILY}${FAMILY}`, 2)).toBe(`${FAMILY}${FAMILY}`);
    expect(truncate(`${E_ACUTE}${E_ACUTE}${E_ACUTE}`, 3)).toBe(`${E_ACUTE}${E_ACUTE}${E_ACUTE}`);
  });

  it('TXT-6: cuts Latin text and adds one "…", within the limit', () => {
    expect(truncate('Sainsburys', 6)).toBe('Sains…');
    expect(truncate('abcdef', 4)).toBe('abc…');
    expect(graphemes(truncate('abcdefghijklmnop', 10))).toHaveLength(10);
  });

  it('TXT-6: never splits an emoji ZWJ sequence, modifier or flag', () => {
    expect(truncate(`${FAMILY}${FAMILY}${FAMILY}`, 2)).toBe(`${FAMILY}${ELLIPSIS}`);
    expect(truncate(`${THUMB}${THUMB}${THUMB}`, 2)).toBe(`${THUMB}${ELLIPSIS}`);
    expect(truncate(`${FLAG_GB}${FLAG_KR}${FLAG_GB}`, 2)).toBe(`${FLAG_GB}${ELLIPSIS}`);
    expect(truncate(`${RAINBOW}${RAINBOW}${RAINBOW}`, 2)).toBe(`${RAINBOW}${ELLIPSIS}`);
    expect(truncate(`ab${FAMILY}cd`, 4)).toBe(`ab${FAMILY}${ELLIPSIS}`);
  });

  it('TXT-6: never splits Hangul, precomposed or as conjoining jamo', () => {
    expect(truncate('한국어로 된 긴 이름', 4)).toBe('한국어…');
    expect(truncate(`${HAN_NFD}${HAN_NFD}${HAN_NFD}`, 2)).toBe(`${HAN_NFD}${ELLIPSIS}`);
  });

  it('TXT-6: never separates a letter from its combining marks', () => {
    expect(truncate(`${E_ACUTE}${E_ACUTE}${E_ACUTE}`, 2)).toBe(`${E_ACUTE}${ELLIPSIS}`);
    expect(truncate(`${STACKED}${STACKED}${STACKED}`, 2)).toBe(`${STACKED}${ELLIPSIS}`);
    expect(truncate(`${KEYCAP}${KEYCAP}${KEYCAP}`, 2)).toBe(`${KEYCAP}${ELLIPSIS}`);
  });

  it('TXT-6: with room for one character, a cut string is just "…"', () => {
    expect(truncate('abc', 1)).toBe(ELLIPSIS);
    expect(truncate('a', 1)).toBe('a');
  });

  it('TXT-6: for any text, the result is whole graphemes of the original, within the limit, "…" only when cut', () => {
    const text = fc.oneof(
      fc.array(fc.constantFrom(...ATOMS), { maxLength: 40 }).map((a) => a.join('')),
      fc.string({ unit: 'grapheme', maxLength: 40 }),
    );
    fc.assert(
      fc.property(text, fc.integer({ min: 1, max: 45 }), (s, max) => {
        const out = truncate(s, max);
        const original = graphemes(s);
        expect(out.isWellFormed()).toBe(true);
        if (original.length <= max) {
          expect(out).toBe(s);
          return;
        }
        expect(out.endsWith(ELLIPSIS)).toBe(true);
        expect(graphemes(out).length).toBeLessThanOrEqual(max);
        const kept = out.slice(0, -ELLIPSIS.length);
        const keptG = graphemes(kept);
        // The kept part is exactly the first k graphemes of the original (whole clusters, none altered).
        expect(keptG).toEqual(original.slice(0, keptG.length));
        expect(original.slice(0, keptG.length).join('')).toBe(kept);
      }),
      { numRuns: 500 },
    );
  });
});
