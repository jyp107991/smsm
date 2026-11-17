/**
 * The cat's and the dog's parts (DESIGN §2.3), drawn by hand in one 120-unit space with the head
 * centred at (60, 45). Flat fills, one ink outline, round forms. A pose only chooses which parts
 * render and where (see Animal.tsx); it never needs new drawings, except where a part lies down.
 *
 * Fills are named, not coloured: 'coat', 'pale' (birch muzzle and chest), 'dark' (the dog's ears),
 * 'blush'. rig.css maps them to tokens.
 */
import type { AnimalKind, FaceAnatomy } from './moods';

export type Fill = 'coat' | 'pale' | 'dark' | 'blush' | 'ink';
export interface Piece {
  d: string;
  fill: Fill;
  outline: boolean;
}

export interface Anatomy {
  face: FaceAnatomy;
  /** The head: outline, then the pale muzzle and the nose on top. */
  head: Piece[];
  earLeft: Piece[];
  earRight: Piece[];
  /** True when the left ear hangs in front of the head (the dog's flopped ear). */
  earLeftInFront: boolean;
  cheeks: Piece[];
  body: Piece[];
  tail: Piece[];
  paws: Piece[];
  /** Lying down (pose 'curled'). */
  curledBody: Piece[];
  curledTail: Piece[];
  /** Paws resting on an edge (pose 'peeking'); the edge is y = PEEK_EDGE. */
  peekPaws: Piece[];
}

export const PEEK_EDGE = 70;

const p = (d: string, fill: Fill, outline = true): Piece => ({ d, fill, outline });

function oval(cx: number, cy: number, rx: number, ry: number): string {
  return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`;
}

/** Mirrors an absolute-coordinate path (M, L, C, Q, Z only) across x = 60. */
function mirror(d: string): string {
  return d.replace(/(-?\d*\.?\d+)\s+(-?\d*\.?\d+)/g, (_m, x: string, y: string) => `${String(120 - Number(x))} ${y}`);
}

function peekPaw(cx: number, w: number): string {
  const e = PEEK_EDGE;
  return `M${cx - w} ${e}C${cx - w} ${e - 9} ${cx + w} ${e - 9} ${cx + w} ${e}Z`;
}

const cheeks = (y: number, dx: number): Piece[] => [
  p(oval(60 - dx, y, 4.6, 2.9), 'blush', false),
  p(oval(60 + dx, y, 4.6, 2.9), 'blush', false),
];

const catEar = 'M37 33L30.6 11.6Q29.8 7.6 33.6 9.4L55 22.4Z';
const catInnerEar = 'M38.6 29L34.6 15.2L48.6 24Z';

export const CAT: Anatomy = {
  face: { eyeL: [47.5, 45], eyeR: [72.5, 45], eyeR0: 3.4, mouth: [60, 55.6], mouthScale: 1, browLift: 8 },
  head: [
    p('M30 46C30 29 43 20 60 20C77 20 90 29 90 46C90 62 77 70 60 70C43 70 30 62 30 46Z', 'coat'),
    p('M49.5 59.4C49.5 54.4 54.6 52.4 60 54C65.4 52.4 70.5 54.4 70.5 59.4C70.5 64.2 65.6 66 60 64.6C54.4 66 49.5 64.2 49.5 59.4Z', 'pale', false),
    // A fringe of three short stripes on the brow: the cat's only marking.
    p('M55 21.6V27M60 20.4V27.6M65 21.6V27', 'coat'),
    p('M56.6 52.8Q60 51.2 63.4 52.8Q62.2 55.6 60 55.8Q57.8 55.6 56.6 52.8Z', 'ink', false),
  ],
  earLeft: [p(catEar, 'coat'), p(catInnerEar, 'pale', false)],
  earRight: [p(mirror(catEar), 'coat'), p(mirror(catInnerEar), 'pale', false)],
  earLeftInFront: false,
  cheeks: cheeks(55.6, 19),
  body: [
    p('M42 109C35.6 109 33.6 101 35.6 90C37.8 78 44 66 60 66C76 66 82.2 78 84.4 90C86.4 101 84.4 109 78 109Z', 'coat'),
    p('M51.4 70.6C55 69 65 69 68.6 70.6C70.2 82 66.4 95 60 98C53.6 95 49.8 82 51.4 70.6Z', 'pale', false),
  ],
  // Long, curling up the right side.
  tail: [p('M78 105C92 108 105.6 101 106.6 86C107.4 75 102.6 68.4 96.4 69.4C92.8 70 92.2 73.6 95.4 75.2C99.6 77.2 100.2 82.4 99.6 87.6C98.6 96 90.4 99.4 79 98.6Z', 'coat')],
  paws: [
    p(oval(49, 108, 7.4, 4.6), 'coat'),
    p(oval(71, 108, 7.4, 4.6), 'coat'),
  ],
  curledBody: [
    p('M24 110C13 110 12 94 22 86C32 74 52 66.6 74 66.6C96 66.6 110 79 110 95C110 105 104 110 96 110Z', 'coat'),
  ],
  // Wrapped round the front, its tip tucked under the chin.
  curledTail: [p('M104 101C99 112 70 115.4 40 112.6C30.6 111.8 25.6 109 27.6 104.8C29.2 101.8 34 103.8 40.4 104.6C66 107.6 90 106.6 98.6 97.4Z', 'coat')],
  peekPaws: [p(peekPaw(41, 8), 'coat'), p(peekPaw(79, 8), 'coat')],
};

// Pricked, leaning out, with a soft tip.
const dogEarUp = 'M65.4 24.6C70 16.4 79 8.6 87.6 6.4C91.2 5.6 93 8 92.4 11.6C91 21 88.4 30 84 38.4Z';

export const DOG: Anatomy = {
  face: { eyeL: [47, 43.6], eyeR: [73, 43.6], eyeR0: 3.7, mouth: [60, 56.6], mouthScale: 1.12, browLift: 8.4 },
  head: [
    p('M30.6 46C30.6 28 43.6 19.6 60 19.6C76.4 19.6 89.4 28 89.4 46C89.4 63.4 76.4 71.4 60 71.4C43.6 71.4 30.6 63.4 30.6 46Z', 'coat'),
    p('M46.4 60.4C46.4 53.4 52.6 50 60 50C67.4 50 73.6 53.4 73.6 60.4C73.6 67 67.4 69.8 60 69.8C52.6 69.8 46.4 67 46.4 60.4Z', 'pale', false),
    p('M54 52.6C54 49.8 56.8 49 60 49C63.2 49 66 49.8 66 52.6C66 55.6 62.4 57 60 57C57.6 57 54 55.6 54 52.6Z', 'ink', false),
  ],
  // The left ear flops down in front of the head; the right one stands up.
  earLeft: [p('M47.4 22C38.6 18.2 28.4 20.4 24.6 28.6C21.4 35.6 21 48 23.4 56.6C25 62.2 31.2 63.6 33.8 58.4C36.4 52.8 36.6 43.4 39.2 35.6C41 30.4 44 25.6 47.4 22Z', 'dark')],
  earRight: [p(dogEarUp, 'dark')],
  earLeftInFront: true,
  cheeks: cheeks(57, 20.4),
  body: [
    p('M40.6 109C33.8 109 31.8 101 33.8 90C36 77 43 66 60 66C77 66 84 77 86.2 90C88.2 101 86.2 109 79.4 109Z', 'coat'),
    p('M50.4 71C54.4 69.2 65.6 69.2 69.6 71C71 82 66.6 93.4 60 96C53.4 93.4 49 82 50.4 71Z', 'pale', false),
  ],
  // Short and upright, for wagging.
  tail: [p('M80 98C87.6 97.4 93 92.4 95.2 85.2C96.4 81 99.6 79 102.4 80.6C105.8 82.6 105.4 89.6 102 95.6C98.4 102 91 106.4 82 106.6Z', 'coat')],
  paws: [
    p(oval(48.6, 108, 8, 4.8), 'pale'),
    p(oval(71.4, 108, 8, 4.8), 'pale'),
  ],
  curledBody: [
    p('M24 110C13 110 12 94 22 86C32 74 52 66.6 74 66.6C96 66.6 110 79 110 95C110 105 104 110 96 110Z', 'coat'),
  ],
  curledTail: [p('M101.6 86.6C107.6 82 113.4 83.6 112.8 88.6C112.2 94.2 106.4 98.4 100.4 98.8Z', 'coat')],
  peekPaws: [p(peekPaw(40.6, 8.6), 'pale'), p(peekPaw(79.4, 8.6), 'pale')],
};

export function anatomyOf(kind: AnimalKind): Anatomy {
  return kind === 'cat' ? CAT : DOG;
}
