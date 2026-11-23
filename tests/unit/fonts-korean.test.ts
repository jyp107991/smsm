/**
 * S9 P3 (performance audit): the Korean font slices (scripts/fonts-korean.ts, DESIGN §3.2) must only ever be
 * fetched for Korean. Fontsource's slices also list ASCII, Latin-1, punctuation and signs; declared after the
 * Latin faces they won over them, so an English-only Home fetched seven Korean files. Every Hangul character must
 * still resolve to a slice of the chosen face, and the first screen's largest text (the balance amount, Gowun
 * Batang 700 Latin) is preloaded with the other Latin files.
 *
 * S9 review: only what the Latin faces actually draw (their unicode-range in type.css) leaves the Korean slices.
 * Cutting whole blocks also dropped ₩ ℃ ℉ ℓ № ℡ Ω Å, which then no face of ours drew.
 */
import { describe, expect, it } from 'vitest';

// The app tsconfig (which covers tests/unit) has no Node types: node:fs by a non-literal specifier, as in strings.test.ts.
const nodeFs = 'node:fs';
const { readFileSync } = (await import(/* @vite-ignore */ nodeFs)) as { readFileSync: (path: string, encoding: 'utf8') => string };

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

/** What the Latin faces draw: every Latin @font-face's unicode-range in type.css. */
const LATIN = parse(readFileSync('src/styles/type.css', 'utf8')).filter((f) => f.file.includes('-latin-'));
const latin = (cp: number) => covers(LATIN, cp);

/** Every code point a set of ranges covers (Korean slices stay well under U+10000). */
function codePoints(ranges: readonly [number, number][]): Set<number> {
  const out = new Set<number>();
  for (const [lo, hi] of ranges) for (let cp = lo; cp <= hi; cp += 1) out.add(cp);
  return out;
}

/** The package each Korean family comes from, and Fontsource's own numbered slices (before the script's cut). */
const PACKAGES: Record<string, string> = {
  'Gowun Batang': '@fontsource/gowun-batang', 'Gowun Dodum': '@fontsource/gowun-dodum',
  'Hahmlet Variable': '@fontsource-variable/hahmlet', 'Nanum Myeongjo': '@fontsource/nanum-myeongjo',
};
function packageSlices(family: string): [number, number][] {
  const json = JSON.parse(readFileSync(`node_modules/${PACKAGES[family] ?? ''}/unicode.json`, 'utf8')) as Record<string, string>;
  return Object.entries(json).filter(([k]) => /^\[\d+\]$/.test(k)).flatMap(([, r]) => parse(`@font-face { unicode-range: ${r}; }`)[0]?.ranges ?? []);
}

describe('S9 P3: Korean slices are fetched only for Korean', () => {
  for (const option of ['a', 'b', 'c'] as const) {
    const faces = parse(readFileSync(`src/styles/fonts-korean-${option}.css`, 'utf8'));

    it(`TXT-6 option ${option.toUpperCase()}: no slice claims a character the Latin faces draw`, () => {
      expect(LATIN.length).toBeGreaterThan(3);
      expect(faces.length).toBeGreaterThan(50);
      for (const f of faces) {
        expect(f.ranges.length, `${f.file} has an empty unicode-range`).toBeGreaterThan(0);
        for (const [lo, hi] of f.ranges) {
          for (let cp = lo; cp <= hi; cp += 1) {
            if (latin(cp)) throw new Error(`${f.file} claims U+${cp.toString(16)}, which the Latin faces draw`);
          }
        }
      }
    });

    it(`TXT-6 option ${option.toUpperCase()}: nothing else is lost: Fontsource's slices = these slices + the Latin faces' part of them`, () => {
      for (const family of [...new Set(faces.map((f) => f.family))]) {
        const weight = faces.find((f) => f.family === family)?.weight;
        const now = codePoints(faces.filter((f) => f.family === family && f.weight === weight).flatMap((f) => f.ranges));
        const before = codePoints(packageSlices(family));
        const lost = [...before].filter((cp) => !now.has(cp) && !latin(cp));
        expect(lost.map((cp) => `U+${cp.toString(16)}`), `${family}: characters no face draws any more`).toEqual([]);
        const added = [...now].filter((cp) => !before.has(cp));
        expect(added, `${family}: characters the package's slices never had`).toEqual([]);
      }
    });

    it(`TXT-6 option ${option.toUpperCase()}: ₩ (and ℃, №, Ω) still come from the Korean face`, () => {
      for (const family of [...new Set(faces.map((f) => f.family))]) {
        const own = faces.filter((f) => f.family === family);
        for (const cp of [0x20a9, 0x2103, 0x2116, 0x2126]) {
          if (!codePoints(packageSlices(family)).has(cp)) continue;
          expect(covers(own, cp), `${family}: U+${cp.toString(16)}`).toBe(true);
        }
      }
      expect(covers(faces, 0x20a9), 'no slice has ₩').toBe(true);
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

  it('the generator takes the Latin faces\' ranges from type.css itself (so a change there or a font update keeps the rule)', () => {
    const script = readFileSync('scripts/fonts-korean.ts', 'utf8');
    expect(script).toMatch(/src\/styles\/type\.css/);
    expect(script).not.toMatch(/0x20a0|0x2100/i);
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
