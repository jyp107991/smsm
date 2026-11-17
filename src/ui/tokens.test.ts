/**
 * Colour tokens (DESIGN §3.1) and their contrast (WCAG 2, AA). S0's own check: every text/background
 * pair the UI uses meets AA in both themes, and tokens.css says exactly what tokens.ts says.
 *
 * The contrast and colour maths below are written independently of src/ui/tokens.ts on purpose, so a
 * mistake in the app's contrast() cannot make the AA checks pass.
 */
import { describe, expect, it } from 'vitest';
import { CATEGORY_COLOURS, TOKENS, USED_PAIRS, contrast } from './tokens';

// Read tokens.css from disk. (Vitest turns `?raw` CSS imports into ''; and the app tsconfig has no Node
// types, so node:fs is imported by a non-literal specifier and given the one signature used here.)
const nodeFs = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ nodeFs)) as { readFileSync: (path: string, encoding: 'utf8') => string };
const tokensCss = readFileSync('src/styles/tokens.css', 'utf8'); // vitest runs from the repo root

type Theme = 'light' | 'dark';
const THEMES: Theme[] = ['light', 'dark'];

// DESIGN §3.1, copied by hand from the table.
const DESIGN_TABLE: Record<string, { light: string; dark: string }> = {
  paper: { light: '#DCDFCD', dark: '#1D221A' },
  surface: { light: '#E8E3D5', dark: '#272D23' },
  sunk: { light: '#C8CCB6', dark: '#161A14' },
  ink: { light: '#2B2118', dark: '#E9EADC' },
  'ink-2': { light: '#4F463A', dark: '#AFB19F' },
  line: { light: '#BCC0A8', dark: '#3A4234' },
  forest: { light: '#3E4938', dark: '#C3CFAE' },
  'on-forest': { light: '#ECE7DA', dark: '#1D221A' },
  moss: { light: '#4A5840', dark: '#A3B58D' },
  walnut: { light: '#6F5138', dark: '#A8825F' },
  oak: { light: '#AA9071', dark: '#C9AE8C' },
  honey: { light: '#74521F', dark: '#DDB978' },
  berry: { light: '#8A3A30', dark: '#E79283' },
};

const CATEGORY_ORDER = ['moss', 'amber', 'walnut', 'honey', 'slate', 'plum', 'oak', 'berry', 'lake', 'clay', 'fern', 'stone'];

// ---------- independent colour maths ----------

type RGB = [number, number, number];

function parseHex(hex: string): RGB {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m?.[1]) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function srgbToLinear(c255: number): number {
  const c = c255 / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function linearToSrgb255(c: number): number {
  const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return v * 255;
}

function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map(srgbToLinear) as RGB;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function refContrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** OKLCH → sRGB 0..255 (unclamped), Björn Ottosson's matrices as used by CSS Color 4. */
function oklchToSrgb(l: number, c: number, hDeg: number): RGB {
  const h = (hDeg * Math.PI) / 180;
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;
  const L = l_ ** 3;
  const M = m_ ** 3;
  const S = s_ ** 3;
  const r = 4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S;
  const g = -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S;
  const bl = -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S;
  return [linearToSrgb255(r), linearToSrgb255(g), linearToSrgb255(bl)];
}

/** sRGB hex → OKLab. */
function hexToOklab(hex: string): [number, number, number] {
  const [r, g, b] = parseHex(hex).map(srgbToLinear) as RGB;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function deltaEOk(a: string, b: string): number {
  const [l1, a1, b1] = hexToOklab(a);
  const [l2, a2, b2] = hexToOklab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

/** A CSS colour as written in tokens.css: #rrggbb, #rgb, or oklch(L C H) (L as 0..1 or %, H optionally in deg). */
function cssColourToRgb(value: string): RGB {
  const v = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) return parseHex(`#${short[1]!}${short[1]!}${short[2]!}${short[2]!}${short[3]!}${short[3]!}`);
  if (/^#[0-9a-f]{6}$/.test(v)) return parseHex(v);
  const ok = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*\)$/.exec(v);
  if (ok) {
    const l = Number(ok[1]) / (ok[2] === '%' ? 100 : 1);
    return oklchToSrgb(l, Number(ok[3]), Number(ok[4]));
  }
  throw new Error(`unsupported colour in tokens.css: ${value}`);
}

/** Every `--name: light-dark(a, b)` declaration for a token name, in order. */
function cssDeclarations(name: string): { light: string; dark: string }[] {
  const escaped = name.replace(/[-]/g, '\\-');
  const re = new RegExp(`--${escaped}\\s*:\\s*light-dark\\(\\s*(#[0-9a-fA-F]{3,6}|oklch\\([^)]*\\))\\s*,\\s*(#[0-9a-fA-F]{3,6}|oklch\\([^)]*\\))\\s*\\)`, 'g');
  return [...tokensCss.matchAll(re)].map((m) => ({ light: m[1]!, dark: m[2]! }));
}

const tokenNames = Object.keys(TOKENS) as (keyof typeof TOKENS)[];
const minFor = { text: 4.5, 'large-text': 3, graphic: 3 } as const;

// ---------- the colour maths in this file is itself right ----------

const round = (x: number) => Math.round(x) || 0; // no -0

describe('reference maths used by these tests', () => {
  it('reproduces WCAG known values', () => {
    expect(refContrast('#000000', '#ffffff')).toBeCloseTo(21, 10);
    expect(refContrast('#777777', '#ffffff')).toBeCloseTo(4.478, 3);
  });
  it('OKLCH conversion round-trips known colours', () => {
    // oklch(1 0 0) is white, oklch(0 0 0) black; oklch(0.6279554 0.2576833 29.2338851) is #ff0000.
    expect(oklchToSrgb(1, 0, 0).map(round)).toEqual([255, 255, 255]);
    expect(oklchToSrgb(0, 0, 0).map(round)).toEqual([0, 0, 0]);
    expect(oklchToSrgb(0.6279554, 0.2576833, 29.2338851).map(round)).toEqual([255, 0, 0]);
  });
});

// ---------- TOKENS matches DESIGN ----------

describe('TOKENS (DESIGN §3.1)', () => {
  it('has exactly the tokens in the DESIGN table', () => {
    expect([...tokenNames].sort()).toEqual(Object.keys(DESIGN_TABLE).sort());
  });

  for (const [name, expected] of Object.entries(DESIGN_TABLE)) {
    it(`${name} has the listed light and dark values`, () => {
      const t = (TOKENS as Record<string, { light: string; dark: string } | undefined>)[name];
      expect(t, `TOKENS.${name} missing`).toBeDefined();
      expect(t!.light.toLowerCase()).toBe(expected.light.toLowerCase());
      expect(t!.dark.toLowerCase()).toBe(expected.dark.toLowerCase());
    });
  }
});

// ---------- contrast() ----------

describe('contrast()', () => {
  it('black on white is 21, white on white is 1', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 6);
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21, 6);
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 6);
  });

  it('matches known ratios', () => {
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.478, 2);
    // DESIGN §3.1 measured values, light theme, on paper (updated with the owner's no-white palette, 17 Nov).
    expect(contrast(DESIGN_TABLE.ink!.light, DESIGN_TABLE.paper!.light)).toBeCloseTo(11.6, 1);
    expect(contrast(DESIGN_TABLE['ink-2']!.light, DESIGN_TABLE.paper!.light)).toBeCloseTo(6.8, 1);
    expect(contrast(DESIGN_TABLE.forest!.light, DESIGN_TABLE.paper!.light)).toBeCloseTo(7.0, 1);
    expect(contrast(DESIGN_TABLE.honey!.light, DESIGN_TABLE.paper!.light)).toBeCloseTo(5.2, 1);
    expect(contrast(DESIGN_TABLE['on-forest']!.light, DESIGN_TABLE.forest!.light)).toBeCloseTo(7.7, 1);
  });

  it('is symmetric and agrees with an independent WCAG implementation on every token pair', () => {
    for (const theme of THEMES) {
      for (const a of tokenNames) {
        for (const b of tokenNames) {
          const x = TOKENS[a][theme];
          const y = TOKENS[b][theme];
          expect(contrast(x, y)).toBeCloseTo(refContrast(x, y), 3);
          expect(contrast(x, y)).toBeCloseTo(contrast(y, x), 10);
        }
      }
    }
  });

  it('accepts upper- and lower-case hex alike', () => {
    expect(contrast('#2B2118', '#EEF0E5')).toBeCloseTo(contrast('#2b2118', '#eef0e5'), 10);
  });
});

// ---------- USED_PAIRS meet AA ----------

describe('USED_PAIRS: every used pair meets WCAG AA in both themes', () => {
  it('names only real tokens and known uses', () => {
    expect(USED_PAIRS.length).toBeGreaterThan(0);
    for (const p of USED_PAIRS) {
      expect(tokenNames).toContain(p.fg);
      expect(tokenNames).toContain(p.bg);
      expect(['text', 'large-text', 'graphic']).toContain(p.use);
    }
  });

  it('includes the pairs every screen uses', () => {
    const has = (fg: string, bg: string, use: string) => USED_PAIRS.some((p) => p.fg === fg && p.bg === bg && p.use === use);
    expect(has('ink', 'paper', 'text')).toBe(true);
    expect(has('ink', 'surface', 'text')).toBe(true);
    expect(has('ink', 'sunk', 'text')).toBe(true);
    expect(has('ink-2', 'paper', 'text')).toBe(true);
    expect(has('ink-2', 'surface', 'text')).toBe(true);
    expect(has('on-forest', 'forest', 'text')).toBe(true);
  });

  for (const p of USED_PAIRS) {
    for (const theme of THEMES) {
      it(`${p.fg} on ${p.bg} as ${p.use}, ${theme}: at least ${String(minFor[p.use])}`, () => {
        const ratio = refContrast(TOKENS[p.fg][theme], TOKENS[p.bg][theme]);
        expect(ratio).toBeGreaterThanOrEqual(minFor[p.use]);
      });
    }
  }

  it('never uses honey, moss or berry as body text on sunk (below 4.5 in light)', () => {
    for (const fg of ['honey', 'moss', 'berry']) {
      expect(USED_PAIRS.filter((p) => p.fg === fg && p.bg === 'sunk' && p.use === 'text')).toEqual([]);
    }
  });

  it('never uses oak as text, anywhere', () => {
    expect(USED_PAIRS.filter((p) => p.fg === 'oak' && p.use !== 'graphic')).toEqual([]);
  });
});

// ---------- tokens.css says the same as TOKENS ----------

describe('src/styles/tokens.css', () => {
  for (const name of Object.keys(DESIGN_TABLE)) {
    it(`declares --${name} with light-dark() equal to TOKENS (±1 per sRGB channel)`, () => {
      const decls = cssDeclarations(name);
      expect(decls.length, `--${name}: light-dark(...) not found`).toBeGreaterThan(0);
      const t = (TOKENS as Record<string, { light: string; dark: string } | undefined>)[name];
      expect(t).toBeDefined();
      for (const d of decls) {
        for (const theme of THEMES) {
          const got = cssColourToRgb(d[theme]);
          const want = parseHex(t![theme]);
          for (let i = 0; i < 3; i += 1) {
            expect(Math.abs(got[i]! - want[i]!), `--${name} ${theme} channel ${String(i)}: ${d[theme]} vs ${t![theme]}`).toBeLessThanOrEqual(1);
          }
        }
      }
    });
  }
});

// ---------- category colours ----------

describe('CATEGORY_COLOURS (DESIGN §3.1)', () => {
  it('has the twelve named hues', () => {
    expect(Object.keys(CATEGORY_COLOURS).sort()).toEqual([...CATEGORY_ORDER].sort());
  });

  it('each has a light and a dark sRGB value', () => {
    for (const name of CATEGORY_ORDER) {
      const c = (CATEGORY_COLOURS as Record<string, { light: string; dark: string } | undefined>)[name];
      expect(c, name).toBeDefined();
      expect(c!.light).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(c!.dark).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  // Neighbours in the listed order sit next to each other in charts. An OKLab distance of 0.02 is
  // roughly one just-noticeable difference; 0.08 (about four JNDs) keeps two small dots or two
  // adjacent bars clearly different at a glance on a phone, while still allowing muted hues.
  const MIN_DELTA_E_OK = 0.08;
  for (const theme of THEMES) {
    it(`adjacent hues are distinguishable in ${theme} (OKLab ΔE ≥ ${String(MIN_DELTA_E_OK)})`, () => {
      const colours = CATEGORY_COLOURS as Record<string, { light: string; dark: string }>;
      for (let i = 0; i + 1 < CATEGORY_ORDER.length; i += 1) {
        const a = CATEGORY_ORDER[i]!;
        const b = CATEGORY_ORDER[i + 1]!;
        const d = deltaEOk(colours[a]![theme], colours[b]![theme]);
        expect(d, `${a} vs ${b} (${theme}): ΔE ${String(Math.round(d * 1000) / 1000)}`).toBeGreaterThanOrEqual(MIN_DELTA_E_OK);
      }
    });
  }
});
