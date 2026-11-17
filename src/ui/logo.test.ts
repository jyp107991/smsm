/// <reference types="node" />
// Owner feedback (17 Nov): the mark sat too close to the tile's top and bottom edges and didn't look centred;
// on Android the launcher's mask (circle/squircle) could also clip it. The approved drawing is kept; it is
// placed with LOGO_PLACEMENT so it has even breathing room, sits inside the maskable safe zone (a circle of
// radius 40 around the centre), and is optically centred (its box a touch above centre, because ㅁ carries
// more ink than ㅅ).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOGO_MARKS, LOGO_PLACEMENT, LOGO_STROKE, type LogoVariant } from './Logo';

function points(d: string): [number, number][] {
  // M/L/C/Q carry x y pairs; H and V carry one number and keep the other coordinate.
  const tokens = d.match(/[MLHVCQZ]|-?\d+(\.\d+)?/gi) ?? [];
  const out: [number, number][] = [];
  let cmd = '';
  let x = 0;
  let y = 0;
  let pendingX: number | null = null;
  for (const t of tokens) {
    if (/[A-Z]/i.test(t)) { cmd = t.toUpperCase(); continue; }
    const n = Number(t);
    if (cmd === 'H') { x = n; out.push([x, y]); continue; }
    if (cmd === 'V') { y = n; out.push([x, y]); continue; }
    if (pendingX === null) { pendingX = n; continue; }
    x = pendingX; y = n; pendingX = null;
    out.push([x, y]);
  }
  expect(out.length).toBeGreaterThan(2);
  return out;
}

function placed(variant: LogoVariant): { minX: number; maxX: number; minY: number; maxY: number; far: number } {
  const { scale: s, x: tx, y: ty } = LOGO_PLACEMENT;
  const half = (LOGO_STROKE / 2) * s;
  const pts = [...points(LOGO_MARKS[variant].roof), ...points(LOGO_MARKS[variant].walls)].map(([x, y]): [number, number] => [x * s + tx, y * s + ty]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const far = Math.max(...pts.map(([x, y]) => Math.hypot(x - 50, y - 50))) + half;
  return { minX: Math.min(...xs) - half, maxX: Math.max(...xs) + half, minY: Math.min(...ys) - half, maxY: Math.max(...ys) + half, far };
}

describe('the mark sits well in its tile (owner, 17 Nov)', () => {
  for (const v of ['a', 'b', 'c'] as const) {
    it(`logo ${v}: inside the maskable safe zone, even room above and below, centred across`, () => {
      const b = placed(v);
      expect(b.far).toBeLessThanOrEqual(40);
      expect(b.minY).toBeGreaterThanOrEqual(15);
      expect(100 - b.maxY).toBeGreaterThanOrEqual(15);
      // Optically centred: the box sits slightly above the middle (0–4 units), never below it.
      const mid = (b.minY + b.maxY) / 2;
      expect(50 - mid).toBeGreaterThanOrEqual(0);
      expect(50 - mid).toBeLessThanOrEqual(4);
      expect(Math.abs((b.minX + b.maxX) / 2 - 50)).toBeLessThan(0.01);
    });
  }

  it('every icon file uses the same placement as the app (no stale copy of the old, edge-to-edge mark)', () => {
    const { scale: s, x, y } = LOGO_PLACEMENT;
    const transform = `matrix(${String(s)} 0 0 ${String(s)} ${String(x)} ${String(y)})`;
    for (const f of ['icon.svg', 'favicon.svg', 'icon-monochrome.svg', 'logo-a.svg', 'logo-b.svg', 'logo-c.svg']) {
      expect(readFileSync(`public/icons/${f}`, 'utf8'), f).toContain(`transform="${transform}"`);
    }
  });
});
