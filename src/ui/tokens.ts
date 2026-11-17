/**
 * The single list of colour tokens (DESIGN §3.1): reference sRGB hex per theme.
 * `src/styles/tokens.css` declares the same names in OKLCH; each converts back to these values
 * within ±1 per sRGB channel. Change a colour here and there together.
 */

export type TokenName =
  | 'paper'
  | 'surface'
  | 'sunk'
  | 'ink'
  | 'ink-2'
  | 'line'
  | 'forest'
  | 'on-forest'
  | 'moss'
  | 'walnut'
  | 'oak'
  | 'honey'
  | 'berry';

export interface ThemeColour {
  light: string;
  dark: string;
}

export const TOKENS: Record<TokenName, ThemeColour> = {
  paper: { light: '#EEF0E5', dark: '#1D221A' },
  surface: { light: '#FAFAF5', dark: '#272D23' },
  sunk: { light: '#D6D9C7', dark: '#161A14' },
  ink: { light: '#2B2118', dark: '#E9EADC' },
  'ink-2': { light: '#5E5446', dark: '#AFB19F' },
  line: { light: '#D6D9C7', dark: '#3A4234' },
  forest: { light: '#3E4938', dark: '#C3CFAE' },
  'on-forest': { light: '#F4F5EC', dark: '#1D221A' },
  moss: { light: '#57664A', dark: '#A3B58D' },
  walnut: { light: '#6F5138', dark: '#A8825F' },
  oak: { light: '#AA9071', dark: '#C9AE8C' },
  honey: { light: '#85602A', dark: '#DDB978' },
  berry: { light: '#9C4338', dark: '#E79283' },
};

export const TOKEN_NAMES = Object.keys(TOKENS) as TokenName[];

export type CategoryColourName =
  | 'moss'
  | 'amber'
  | 'walnut'
  | 'honey'
  | 'slate'
  | 'plum'
  | 'oak'
  | 'berry'
  | 'lake'
  | 'clay'
  | 'fern'
  | 'stone';

/**
 * Category colours: small dots and chart fills only, never text, and charts always carry labels.
 * In this order, neighbours (including stone → moss when a chart wraps round) are told apart by
 * lightness first, so they stay apart for red-green colour blindness too.
 *
 * Chosen by a seeded search in OKLCH (natural hue per name, muted chroma, a lightness band per name)
 * that maximised the smallest OKLab distance between neighbours, under normal vision and simulated
 * deuteranopia and protanopia (Machado, Oliveira & Fernandes 2009, severity 1, in linear RGB).
 * Every value is at least 3:1 against paper and surface in its theme (graphics, WCAG 1.4.11).
 *
 * Minimum OKLab ΔE between neighbours (×100; ~2 is a just-noticeable difference):
 *   light 11.8 (normal 12.8, deuteranopia 11.9, protanopia 11.8; tritanopia 9.3)
 *   dark  13.9 (normal 14.4, deuteranopia 13.9, protanopia 13.9; tritanopia 12.5)
 * Minimum between any two of the twelve (normal vision): light 5.9, dark 5.6.
 */
export const CATEGORY_COLOURS: Record<CategoryColourName, ThemeColour> = {
  moss: { light: '#3E4E22', dark: '#718063' },
  amber: { light: '#BD7436', dark: '#F5B986' },
  walnut: { light: '#5C4130', dark: '#9A826F' },
  honey: { light: '#8E7544', dark: '#C5B68B' },
  slate: { light: '#3F4855', dark: '#717B8A' },
  plum: { light: '#8D5F7E', dark: '#C09FB5' },
  oak: { light: '#9A8763', dark: '#DED0B1' },
  berry: { light: '#905155', dark: '#BA776E' },
  lake: { light: '#4A8BA9', dark: '#8FD1E5' },
  clay: { light: '#704F3F', dark: '#B58F7C' },
  fern: { light: '#6B946B', dark: '#A7E1BB' },
  stone: { light: '#676662', dark: '#A5A5A1' },
};

export const CATEGORY_COLOUR_NAMES = Object.keys(CATEGORY_COLOURS) as CategoryColourName[];

export type PairUse = 'text' | 'large-text' | 'graphic';

/** The AA threshold for each use (WCAG 2: 1.4.3 and 1.4.11). */
export const AA: Record<PairUse, number> = { text: 4.5, 'large-text': 3, graphic: 3 };

/**
 * Every foreground/background pair the interface uses. Each must meet AA in both themes.
 * Deliberately absent (they fail in light, DESIGN §3.1): honey, moss and berry as text on sunk;
 * oak anywhere as text or as a lone graphic (it is wood inside drawings with an ink outline);
 * walnut as text (it is structure: the plank, the tab-bar edge, chapter spines).
 */
export const USED_PAIRS: { fg: TokenName; bg: TokenName; use: PairUse }[] = [
  // Body and secondary text on every ground.
  { fg: 'ink', bg: 'paper', use: 'text' },
  { fg: 'ink', bg: 'surface', use: 'text' },
  { fg: 'ink', bg: 'sunk', use: 'text' },
  { fg: 'ink-2', bg: 'paper', use: 'text' },
  { fg: 'ink-2', bg: 'surface', use: 'text' },
  { fg: 'ink-2', bg: 'sunk', use: 'text' },
  // Forest: selected tab and segment labels, links, selected chips.
  { fg: 'forest', bg: 'paper', use: 'text' },
  { fg: 'forest', bg: 'surface', use: 'text' },
  { fg: 'forest', bg: 'sunk', use: 'text' },
  // Primary button label.
  { fg: 'on-forest', bg: 'forest', use: 'text' },
  // Good news and amounts owed (on the page and in sheets; never on sunk).
  { fg: 'moss', bg: 'paper', use: 'text' },
  { fg: 'moss', bg: 'surface', use: 'text' },
  { fg: 'honey', bg: 'paper', use: 'text' },
  { fg: 'honey', bg: 'surface', use: 'text' },
  { fg: 'honey', bg: 'paper', use: 'large-text' },
  // Destructive buttons and field errors.
  { fg: 'berry', bg: 'paper', use: 'text' },
  { fg: 'berry', bg: 'surface', use: 'text' },
  // Graphics: focus rings, icons, selected outlines, the tab-bar edge, the sheet handle.
  { fg: 'forest', bg: 'paper', use: 'graphic' },
  { fg: 'forest', bg: 'surface', use: 'graphic' },
  { fg: 'forest', bg: 'sunk', use: 'graphic' },
  { fg: 'ink', bg: 'paper', use: 'graphic' },
  { fg: 'ink', bg: 'surface', use: 'graphic' },
  { fg: 'ink-2', bg: 'paper', use: 'graphic' },
  { fg: 'ink-2', bg: 'surface', use: 'graphic' },
  { fg: 'ink-2', bg: 'sunk', use: 'graphic' },
  { fg: 'on-forest', bg: 'forest', use: 'graphic' },
  { fg: 'walnut', bg: 'paper', use: 'graphic' },
  { fg: 'walnut', bg: 'surface', use: 'graphic' },
  { fg: 'moss', bg: 'paper', use: 'graphic' },
  { fg: 'moss', bg: 'surface', use: 'graphic' },
  { fg: 'honey', bg: 'paper', use: 'graphic' },
  { fg: 'berry', bg: 'surface', use: 'graphic' },
  // A field in error: a berry border round the sunk well.
  { fg: 'berry', bg: 'sunk', use: 'graphic' },
];

function channel(hex: string, offset: number): number {
  const v = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2 relative luminance of a `#RRGGBB` colour. */
export function luminance(hex: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) throw new Error(`Not a #RRGGBB colour: ${hex}`);
  return 0.2126 * channel(hex, 1) + 0.7152 * channel(hex, 3) + 0.0722 * channel(hex, 5);
}

/** WCAG 2 contrast ratio between two `#RRGGBB` colours (1 to 21, order does not matter). */
export function contrast(hexA: string, hexB: string): number {
  const a = luminance(hexA);
  const b = luminance(hexB);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
