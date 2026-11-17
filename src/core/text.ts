/**
 * Text keys for matching and search (SPEC TXT-3): Unicode-normalised (NFKC, so full-width and half-width
 * forms and composed/decomposed Hangul agree), case-folded without a locale, trimmed, inner spaces collapsed.
 */
export function normaliseKey(s: string): string {
  return s.normalize('NFKC').toLowerCase().trim().replace(/\s+/gu, ' ');
}

export function matches(haystack: string, needle: string): boolean {
  const n = normaliseKey(needle);
  return n === '' || normaliseKey(haystack).includes(n);
}
