/**
 * S2 polish 1b: the derived steps in tokens.css are mixes of the palette, not new colours, and the text drawn
 * on them still meets WCAG AA in both themes (DESIGN §3.1: "an automated test checks every pair that is used").
 *   --forest-tint  a chosen chip or active filter (Q-L2): forest text on it.
 *   --wash         the hover and press film (ink at 6 %, 11 % pressed) over any fill: the text under it.
 * The colour maths is written here independently of src/ui/tokens.ts, as in tokens.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { TOKENS } from './tokens';

const nodeFs = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ nodeFs)) as { readFileSync: (path: string, encoding: 'utf8') => string };
const tokensCss = readFileSync('src/styles/tokens.css', 'utf8');

type RGB = [number, number, number];
const THEMES = ['light', 'dark'] as const;

function rgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const unlin = (c: number) => { const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; return Math.min(255, Math.max(0, v * 255)); };
const lum = ([r, g, b]: RGB) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a: RGB, b: RGB) => { const x = lum(a); const y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

function toOklch([r8, g8, b8]: RGB): [number, number, number] {
  const [r, g, b] = [lin(r8), lin(g8), lin(b8)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}
function fromOklch([L, C, H]: [number, number, number]): RGB {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    unlin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    unlin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    unlin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ];
}
/** CSS `color-mix(in oklch, a p, b)`: shorter-arc hue interpolation. */
function mixOklch(a: RGB, b: RGB, p: number): RGB {
  const x = toOklch(a);
  const y = toOklch(b);
  let dh = x[2] - y[2];
  if (dh > 180) dh -= 360;
  if (dh < -180) dh += 360;
  return fromOklch([x[0] * p + y[0] * (1 - p), x[1] * p + y[1] * (1 - p), y[2] + dh * p]);
}
/** A film of `top` at `alpha` over `under`, as painted (sRGB). */
function over(under: RGB, top: RGB, alpha: number): RGB {
  return under.map((c, i) => c * (1 - alpha) + top[i]! * alpha) as RGB;
}

describe('derived tokens (S2 polish 1b)', () => {
  it('Q-L2: --forest-tint is forest washed 14 % into sunk, declared once', () => {
    expect(tokensCss).toMatch(/--forest-tint:\s*color-mix\(in oklch, var\(--forest\) 14%, var\(--sunk\)\);/);
  });

  for (const theme of THEMES) {
    it(`Q-L2 ${theme}: forest text on --forest-tint meets AA (4.5)`, () => {
      const tint = mixOklch(rgb(TOKENS.forest[theme]), rgb(TOKENS.sunk[theme]), 0.14);
      expect(ratio(rgb(TOKENS.forest[theme]), tint)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${theme}: text keeps AA under the pressed film (--wash-strong) on every fill it is used on`, () => {
      expect(tokensCss).toMatch(/--wash-strong:\s*color-mix\(in oklch, var\(--ink\) 11%, transparent\);/);
      const ink = rgb(TOKENS.ink[theme]);
      const pairs: [string, string][] = [['ink', 'sunk'], ['ink', 'surface'], ['ink', 'paper'], ['ink-2', 'surface'], ['forest', 'surface'], ['on-forest', 'forest'], ['berry', 'paper']];
      for (const [fg, bg] of pairs) {
        const film = over(rgb(TOKENS[bg as keyof typeof TOKENS][theme]), ink, 0.11);
        expect(ratio(rgb(TOKENS[fg as keyof typeof TOKENS][theme]), film), `${fg} on ${bg} pressed`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
