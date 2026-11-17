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

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
const LATIN = /^\p{Script=Latin}$/u;

/**
 * S2 polish Q-U6: a description as it is shown and saved. A name with a spelling of its own, found as whole
 * words in any case, takes that spelling ("ikea lamp" → "IKEA lamp", "easyjet" → "easyJet"); then a lowercase
 * Latin first letter is capitalised ("tesco" → "Tesco"), unless the description starts with such a name. Other
 * scripts, digits and symbols stay as typed ("이마트"), and so does anything else the person wrote.
 *
 * `spellings` maps a lowercase name to its spelling (the same letters, only their case differs).
 */
export function tidyDescription(text: string, spellings: ReadonlyMap<string, string>): string {
  let out = text;
  let startsSpelled = false;
  const lower = text.toLowerCase();
  // Positions line up only when lowercasing keeps the length (a few letters grow, e.g. "İ").
  if (lower.length === text.length) {
    const taken = new Set<number>();
    for (const key of [...spellings.keys()].sort((a, b) => b.length - a.length)) {
      const spelled = spellings.get(key) ?? '';
      if (key === '' || spelled.toLowerCase() !== key) continue;
      for (let at = lower.indexOf(key); at !== -1; at = lower.indexOf(key, at + 1)) {
        const end = at + key.length;
        const wholeWords = !LETTER_OR_DIGIT.test(lower.charAt(at - 1)) && !LETTER_OR_DIGIT.test(lower.charAt(end));
        let free = true;
        for (let i = at; i < end; i += 1) if (taken.has(i)) free = false;
        if (!wholeWords || !free) continue;
        out = out.slice(0, at) + spelled + out.slice(end);
        for (let i = at; i < end; i += 1) taken.add(i);
        if (at === 0) startsSpelled = true;
      }
    }
  }
  if (startsSpelled) return out;
  const first = out.charAt(0);
  const upper = first.toUpperCase();
  return LATIN.test(first) && upper !== first && upper.length === 1 ? upper + out.slice(1) : out;
}
