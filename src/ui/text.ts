const ELLIPSIS = '…';

let segmenter: Intl.Segmenter | undefined;

function graphemes(s: string): string[] {
  segmenter ??= new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  return Array.from(segmenter.segment(s), (part) => part.segment);
}

/**
 * Shortens text to at most `maxGraphemes` user-perceived characters (SPEC TXT-6), cutting only between
 * whole graphemes so a Hangul syllable, an emoji with skin tone or a flag is never split. When the text
 * is cut, the last kept character is replaced by "…" so the result still fits in `maxGraphemes`.
 * Text that already fits is returned unchanged.
 */
export function truncate(s: string, maxGraphemes: number): string {
  const limit = Math.max(0, Math.floor(maxGraphemes));
  const parts = graphemes(s);
  if (parts.length <= limit) return s;
  if (limit === 0) return '';
  const kept = parts.slice(0, limit - 1);
  // "Tesco…", not "Tesco …": drop whole trailing whitespace graphemes before the ellipsis.
  while (kept.length > 0 && /^\s+$/u.test(kept[kept.length - 1] ?? '')) kept.pop();
  return kept.join('') + ELLIPSIS;
}
