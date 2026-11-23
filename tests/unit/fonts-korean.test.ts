/**
 * S9 P3 (performance audit): the Korean font slices (scripts/fonts-korean.ts, DESIGN §3.2) must only ever be
 * fetched for Korean. Fontsource's slices also list ASCII, Latin-1, punctuation, currency and letterlike signs;
 * declared after the Latin faces they won over them, so an English-only Home fetched seven Korean files. Every
 * Hangul character must still resolve to a slice of the chosen face, and the first screen's largest text (the
 * balance amount, Gowun Batang 700 Latin) is preloaded with the other Latin files.
 */
import { describe, expect, it } from 'vitest';

// The app tsconfig (which covers tests/unit) has no Node types: node:fs by a non-literal specifier, as in strings.test.ts.
const nodeFs = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ nodeFs)) as { readFileSync: (path: string, encoding: 'utf8') => string };

/** The blocks a Korean slice must never claim: the Latin faces (type.css) draw them. */
const LATIN_BLOCKS: readonly [number, number, string][] = [
  [0x0000, 0x007f, 'ASCII'],
  [0x0080, 0x00ff, 'Latin-1'],
  [0x2000, 0x206f, 'general punctuation'],
  [0x20a0, 0x20cf, 'currency'],
  [0x2100, 0x214f, 'letterlike'],
];

interface Face { family: string; weight: string; file: string; ranges: [number, number][] }

function parse(css: string): Face[] {
  const faces: Face[] = [];
  for (const m of css.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const body = m[1] ?? '';
    const family = /font-family:\s*'([^']+)'/.exec(body)?.[1] ?? '';
    const weight = /font-weight:\s*([^;]+);/.exec(body)?.[1]?.trim() ?? '';
    const file = /url\('([^']+)'\)/.exec(body)?.[1] ?? '';
    const range = /unicode-range:\s*([^;]+);/.exec(body)?.[1] ?? '';
    const ranges = range.split(',').map((r) => r.trim()).filter(Boolean).map((r): [number, number] => {
      const [a, b] = r.replace(/^U\+/i, '').split('-');
      const lo = parseInt(a ?? '', 16);
      return [lo, b === undefined ? lo : parseInt(b, 16)];
    });
    faces.push({ family, weight, file, ranges });
  }
  return faces;
}

const covers = (faces: Face[], cp: number) => faces.some((f) => f.ranges.some(([lo, hi]) => cp >= lo && cp <= hi));

describe('S9 P3: Korean slices are fetched only for Korean', () => {
  for (const option of ['a', 'b', 'c'] as const) {
    const faces = parse(readFileSync(`src/styles/fonts-korean-${option}.css`, 'utf8'));

    it(`TXT-6 option ${option.toUpperCase()}: no slice claims ASCII, Latin-1, general punctuation, currency or letterlike signs`, () => {
      expect(faces.length).toBeGreaterThan(50);
      for (const f of faces) {
        expect(f.ranges.length, `${f.file} has an empty unicode-range`).toBeGreaterThan(0);
        for (const [lo, hi] of f.ranges) {
          for (const [blo, bhi, name] of LATIN_BLOCKS) {
            expect(hi < blo || lo > bhi, `${f.file} claims ${name} (U+${lo.toString(16)}-${hi.toString(16)})`).toBe(true);
          }
        }
      }
    });

    it(`TXT-6 option ${option.toUpperCase()}: every Hangul syllable and letter still resolves to a slice of each face`, () => {
      const families = [...new Set(faces.map((f) => `${f.family} ${f.weight}`))];
      expect(families.length).toBeGreaterThan(0);
      for (const fam of families) {
        const own = faces.filter((f) => `${f.family} ${f.weight}` === fam);
        for (let cp = 0xac00; cp <= 0xd7a3; cp += 1) {
          if (!covers(own, cp)) throw new Error(`${fam}: U+${cp.toString(16)} (${String.fromCodePoint(cp)}) has no slice`);
        }
        // Compatibility jamo (ㅅㅁ, the mark's letters), which the packages draw (their files have no U+1100 block).
        for (const cp of [0x3131, 0x3145, 0x3141, 0x314f]) {
          expect(covers(own, cp), `${fam}: U+${cp.toString(16)}`).toBe(true);
        }
      }
    });
  }

  it('the generator itself leaves those blocks out (so a font package update keeps the rule)', () => {
    const script = readFileSync('scripts/fonts-korean.ts', 'utf8');
    expect(script).toMatch(/0x2000/);
    expect(script).toMatch(/0x20a0|0x20A0/);
    expect(script).toMatch(/0x2100/);
  });
});

describe('S9 P3: the first screen’s fonts are preloaded', () => {
  const html = readFileSync('index.html', 'utf8');
  const preloads = [...html.matchAll(/<link[^>]*rel="preload"[^>]*>/g)].map((m) => m[0]);

  it('DESIGN §6: Gowun Batang 700 Latin (the balance amount, the largest text on Home) is preloaded with the 400 faces', () => {
    for (const file of ['gowun-dodum-latin-400-normal.woff2', 'gowun-batang-latin-400-normal.woff2', 'gowun-batang-latin-700-normal.woff2']) {
      const link = preloads.find((l) => l.includes(file));
      expect(link, `${file} is not preloaded`).toBeDefined();
      expect(link).toMatch(/as="font"/);
      expect(link).toMatch(/crossorigin/);
    }
  });

  it('DESIGN §3.2: no Korean file is ever preloaded', () => {
    expect(preloads.filter((l) => /-\d+-\d+-normal\.woff2/.test(l))).toEqual([]);
  });
});
