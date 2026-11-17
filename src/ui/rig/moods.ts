/**
 * Faces for the rig (DESIGN §2.3): a mood swaps only the eyes, brows and mouth.
 * Eight moods × two animals come from one small generator per feature, fed with each animal's anatomy,
 * so the cat and the dog stay consistent and no extra drawings are ever needed.
 * All coordinates are in the rig's 120-unit drawing space (see shapes.ts).
 */

export const MOODS = ['calm', 'happy', 'sheepish', 'pleased', 'curious', 'sleepy', 'surprised', 'proud'] as const;
export type Mood = (typeof MOODS)[number];

export type AnimalKind = 'cat' | 'dog';

/** How a shape is painted: an ink line, an ink fill, a pale highlight or a blush tongue. */
export type Paint = 'line' | 'ink' | 'shine' | 'blush';
export interface Shape {
  d: string;
  paint: Paint;
}
export interface Face {
  eyes: Shape[];
  brows: Shape[];
  mouth: Shape[];
}

/** Where each animal's features sit. */
export interface FaceAnatomy {
  eyeL: readonly [number, number];
  eyeR: readonly [number, number];
  eyeR0: number; // dot-eye radius
  mouth: readonly [number, number]; // the bottom of the nose, where the mouth hangs from
  mouthScale: number;
  browLift: number; // brow height above the eye centre
}

const n = (v: number): string => String(Math.round(v * 100) / 100);

function dot(cx: number, cy: number, r: number): string {
  return `M${n(cx - r)} ${n(cy)}a${n(r)} ${n(r)} 0 1 0 ${n(2 * r)} 0a${n(r)} ${n(r)} 0 1 0 ${n(-2 * r)} 0Z`;
}

function ellipse(cx: number, cy: number, rx: number, ry: number): string {
  return `M${n(cx - rx)} ${n(cy)}a${n(rx)} ${n(ry)} 0 1 0 ${n(2 * rx)} 0a${n(rx)} ${n(ry)} 0 1 0 ${n(-2 * rx)} 0Z`;
}

function shine(cx: number, cy: number, r: number): Shape {
  return { d: dot(cx + r * 0.38, cy - r * 0.4, r * 0.36), paint: 'shine' };
}

function eyes(a: FaceAnatomy, mood: Mood): Shape[] {
  const r = a.eyeR0;
  const both = (f: (x: number, y: number, side: -1 | 1) => Shape[]): Shape[] => [
    ...f(a.eyeL[0], a.eyeL[1], -1),
    ...f(a.eyeR[0], a.eyeR[1], 1),
  ];
  switch (mood) {
    case 'calm':
      return both((x, y) => [{ d: dot(x, y, r), paint: 'ink' }]);
    case 'happy':
      return both((x, y) => [
        { d: dot(x, y, r * 1.12), paint: 'ink' },
        shine(x, y, r * 1.12),
      ]);
    case 'sheepish':
      // Looking down and away.
      return both((x, y) => [{ d: dot(x - r * 0.35, y + r * 0.45, r * 0.92), paint: 'ink' }]);
    case 'pleased':
      // Content, eyes closed in two little hills.
      return both((x, y) => [
        { d: `M${n(x - r * 1.35)} ${n(y + r * 0.45)}Q${n(x)} ${n(y - r * 1.55)} ${n(x + r * 1.35)} ${n(y + r * 0.45)}`, paint: 'line' },
      ]);
    case 'curious':
      // Bright and interested: both eyes round with a shine, one opened a little wider.
      return both((x, y, side) => {
        const rr = side === 1 ? r * 1.18 : r * 1.02;
        return [{ d: dot(x, y, rr), paint: 'ink' }, shine(x, y, rr)];
      });
    case 'sleepy':
      // Closed and drooping.
      return both((x, y) => [
        { d: `M${n(x - r * 1.35)} ${n(y + r * 0.1)}Q${n(x)} ${n(y + r * 1.5)} ${n(x + r * 1.35)} ${n(y + r * 0.1)}`, paint: 'line' },
      ]);
    case 'surprised':
      return both((x, y) => [
        { d: dot(x, y, r * 1.38), paint: 'ink' },
        shine(x, y, r * 1.38),
      ]);
    case 'proud':
      // Eyes shut with satisfaction, set a little higher (chin up), under raised brows (see brows()).
      return both((x, y) => [
        { d: `M${n(x - r * 1.3)} ${n(y)}Q${n(x)} ${n(y - r * 1.75)} ${n(x + r * 1.3)} ${n(y)}`, paint: 'line' },
      ]);
  }
}

function brows(a: FaceAnatomy, mood: Mood): Shape[] {
  const w = a.eyeR0 * 1.25; // half-width of a brow
  const line = (d: string): Shape => ({ d, paint: 'line' });
  const by = (y: number): number => y - a.browLift;
  const [xl, yl] = a.eyeL;
  const [xr, yr] = a.eyeR;
  switch (mood) {
    case 'sheepish':
      // Bashful, not worried: soft arcs, the inner ends lifted a little.
      return [
        line(`M${n(xl - w)} ${n(by(yl) + 1)}Q${n(xl + w * 0.1)} ${n(by(yl) - 1.6)} ${n(xl + w)} ${n(by(yl) - 1)}`),
        line(`M${n(xr + w)} ${n(by(yr) + 1)}Q${n(xr - w * 0.1)} ${n(by(yr) - 1.6)} ${n(xr - w)} ${n(by(yr) - 1)}`),
      ];
    case 'curious':
      // Interested: both brows raised in soft arcs, one a little higher (never one flat, which reads as doubt).
      return [
        line(`M${n(xl - w)} ${n(by(yl) - 0.2)}Q${n(xl)} ${n(by(yl) - 2.6)} ${n(xl + w)} ${n(by(yl) - 0.6)}`),
        line(`M${n(xr - w)} ${n(by(yr) - 1)}Q${n(xr)} ${n(by(yr) - 4.2)} ${n(xr + w)} ${n(by(yr) - 1)}`),
      ];
    case 'surprised':
      return [
        line(`M${n(xl - w)} ${n(by(yl) - 1.4)}Q${n(xl)} ${n(by(yl) - 4.6)} ${n(xl + w)} ${n(by(yl) - 1.4)}`),
        line(`M${n(xr - w)} ${n(by(yr) - 1.4)}Q${n(xr)} ${n(by(yr) - 4.6)} ${n(xr + w)} ${n(by(yr) - 1.4)}`),
      ];
    case 'proud':
      // Raised high and relaxed.
      return [
        line(`M${n(xl - w)} ${n(by(yl) - 0.4)}Q${n(xl)} ${n(by(yl) - 3.4)} ${n(xl + w)} ${n(by(yl) - 1.6)}`),
        line(`M${n(xr + w)} ${n(by(yr) - 0.4)}Q${n(xr)} ${n(by(yr) - 3.4)} ${n(xr - w)} ${n(by(yr) - 1.6)}`),
      ];
    case 'calm':
    case 'happy':
    case 'pleased':
    case 'sleepy':
      return [];
  }
}

function mouth(a: FaceAnatomy, kind: AnimalKind, mood: Mood): Shape[] {
  const s = a.mouthScale;
  const [mx, my] = a.mouth;
  const X = (dx: number): string => n(mx + dx * s);
  const Y = (dy: number): string => n(my + dy * s);
  const line = (d: string): Shape => ({ d, paint: 'line' });
  // The little line from the nose that the two lips hang from: cats have a short one, dogs a longer one.
  const philtrum = kind === 'cat' ? 1.6 : 2.6;
  const lips = (w: number, dip: number): string =>
    `M${X(0)} ${Y(0)}V${Y(philtrum)}M${X(-w)} ${Y(philtrum + 0.6)}Q${X(-w / 2)} ${Y(philtrum + dip)} ${X(0)} ${Y(philtrum)}Q${X(w / 2)} ${Y(philtrum + dip)} ${X(w)} ${Y(philtrum + 0.6)}`;
  switch (mood) {
    case 'calm':
      return [line(lips(4.6, 3))];
    case 'happy': {
      const top = philtrum + 0.4;
      return [
        {
          d: `M${X(-5.4)} ${Y(top)}Q${X(0)} ${Y(top + 1.6)} ${X(5.4)} ${Y(top)}Q${X(4.6)} ${Y(top + 8)} ${X(0)} ${Y(top + 8)}Q${X(-4.6)} ${Y(top + 8)} ${X(-5.4)} ${Y(top)}Z`,
          paint: 'ink',
        },
        { d: ellipse(mx, my + (top + 5.9) * s, 2.7 * s, 1.7 * s), paint: 'blush' },
        line(`M${X(0)} ${Y(0)}V${Y(top)}`),
      ];
    }
    case 'sheepish':
      // A small lopsided smile, one corner tucked up: "I know, I know".
      return [line(`M${X(0)} ${Y(0)}V${Y(philtrum)}M${X(-3.8)} ${Y(philtrum + 1.2)}Q${X(-1.9)} ${Y(philtrum + 2.8)} ${X(0)} ${Y(philtrum)}Q${X(1.7)} ${Y(philtrum + 2.4)} ${X(3.4)} ${Y(philtrum + 0.1)}`)];
    case 'pleased':
      return [line(lips(6.4, 4.4))];
    case 'curious': {
      // A small open smile, "ooh": the happy mouth's shape at half the size, without the tongue.
      const top = philtrum + 0.5;
      return [
        line(`M${X(0)} ${Y(0)}V${Y(top)}`),
        {
          d: `M${X(-2.9)} ${Y(top)}Q${X(0)} ${Y(top + 0.8)} ${X(2.9)} ${Y(top)}Q${X(2.4)} ${Y(top + 3.8)} ${X(0)} ${Y(top + 3.8)}Q${X(-2.4)} ${Y(top + 3.8)} ${X(-2.9)} ${Y(top)}Z`,
          paint: 'ink',
        },
      ];
    }
    case 'sleepy':
      return [line(lips(3.2, 2))];
    case 'surprised':
      return [{ d: ellipse(mx, my + (philtrum + 3.4) * s, 2.3 * s, 2.9 * s), paint: 'ink' }];
    case 'proud':
      // A small satisfied smile, one corner higher.
      return [line(`M${X(0)} ${Y(0)}V${Y(philtrum)}M${X(-5)} ${Y(philtrum + 1)}Q${X(-2.5)} ${Y(philtrum + 4)} ${X(0)} ${Y(philtrum)}Q${X(3)} ${Y(philtrum + 4.2)} ${X(6.6)} ${Y(philtrum - 0.8)}`)];
  }
}

export function faceFor(kind: AnimalKind, anatomy: FaceAnatomy, mood: Mood): Face {
  return { eyes: eyes(anatomy, mood), brows: brows(anatomy, mood), mouth: mouth(anatomy, kind, mood) };
}
