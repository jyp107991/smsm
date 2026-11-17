import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { normaliseKey, matches } from './text';

const EMART = '이마트';
const EMART_NFD = EMART.normalize('NFD'); // the same word as separate jamo, as some keyboards produce it

describe('normaliseKey', () => {
  const cases: [string, string][] = [
    ['Tesco', 'tesco'],
    ['TESCO', 'tesco'],
    ['  Tesco   Extra ', 'tesco extra'],
    ['Tesco\tExtra\nMetro', 'tesco extra metro'],
    ['ＴＥＳＣＯ', 'tesco'],
    ['Ｔｅｓｃｏ　Ｅｘｔｒａ', 'tesco extra'],
    ['　マック　', 'マック'],
    ['ｾﾌﾞﾝｲﾚﾌﾞﾝ', 'セブンイレブン'],
    ['Pret A Manger', 'pret a manger'],
    ['☕ Pret', '☕ pret'],
    ['M&S', 'm&s'],
    ['Café Nero', 'café nero'],
    ['', ''],
    ['   ', ''],
  ];
  it.each(cases)('TXT-3 %j → %j', (input, expected) => {
    expect(normaliseKey(input)).toBe(expected);
  });

  it('TXT-3 Hangul typed as composed syllables or separate jamo is the same key', () => {
    expect(EMART_NFD).not.toBe(EMART);
    expect(normaliseKey(EMART_NFD)).toBe(normaliseKey(EMART));
    expect(normaliseKey(EMART)).toBe(EMART);
    expect(normaliseKey(` ${EMART_NFD}  강남점 `)).toBe(`${EMART} 강남점`);
  });

  it('TXT-3 accents typed precomposed or combining are the same key', () => {
    expect(normaliseKey('Café')).toBe(normaliseKey('Café'));
  });

  it('TXT-3 lower-cases without the locale (I stays i, not a dotless ı)', () => {
    expect(normaliseKey('IKEA')).toBe('ikea');
    expect(normaliseKey('ISTANBUL')).toBe('istanbul');
  });

  it('TXT-3 is idempotent and leaves no stray whitespace, for any text', () => {
    fc.assert(
      fc.property(fc.oneof(fc.string({ unit: 'binary' }), fc.string({ unit: 'grapheme' })), (s) => {
        const k = normaliseKey(s);
        expect(normaliseKey(k)).toBe(k);
        expect(k).toBe(k.trim());
        expect(/\s\s/.test(k)).toBe(false);
        expect(/[\t\n\r]/.test(k)).toBe(false);
      }),
    );
  });

  it('TXT-3 ignores case and character width for any ASCII text', () => {
    const toFullWidth = (s: string): string => s.replace(/[!-~]/g, (c) => String.fromCodePoint((c.codePointAt(0) ?? 0) + 0xfee0));
    fc.assert(
      fc.property(fc.string({ unit: 'grapheme-ascii' }), (s) => {
        const k = normaliseKey(s);
        expect(normaliseKey(s.toUpperCase())).toBe(k);
        expect(normaliseKey(toFullWidth(s))).toBe(k);
      }),
    );
  });
});

describe('matches', () => {
  it('TXT-3 finds a normalised substring', () => {
    expect(matches('Tesco Extra', 'tesco')).toBe(true);
    expect(matches('Tesco Extra', 'EXTRA')).toBe(true);
    expect(matches('Tesco   Extra', 'tesco extra')).toBe(true);
    expect(matches('ＴＥＳＣＯ', 'tes')).toBe(true);
    expect(matches('Big shop at Tesco', 'ＴＥＳＣＯ')).toBe(true);
    expect(matches(`${EMART} 강남점`, EMART_NFD)).toBe(true);
    expect(matches(`${EMART_NFD} 강남점`, EMART)).toBe(true);
    expect(matches('ｾﾌﾞﾝｲﾚﾌﾞﾝ 京都', 'セブン')).toBe(true);
    expect(matches('Café Nero', 'café')).toBe(true);
  });

  it('TXT-3 does not match what is not there', () => {
    expect(matches('Tesco', 'Sainsbury')).toBe(false);
    expect(matches('Tesco', 'tesco extra')).toBe(false);
    expect(matches(EMART, '홈플러스')).toBe(false);
  });

  it('TXT-3 an empty search matches everything', () => {
    expect(matches('Tesco', '')).toBe(true);
    expect(matches('Tesco', '   ')).toBe(true);
    expect(matches('', '')).toBe(true);
  });

  it('TXT-3 any run of whole words matches, typed in any case or width, in any script', () => {
    const word = fc.oneof(
      fc.string({ unit: fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'), minLength: 1, maxLength: 8 }),
      fc.string({ unit: fc.constantFrom('이', '마', '트', '강', '남', '점', '김', '밥'), minLength: 1, maxLength: 4 }),
      fc.string({ unit: fc.constantFrom('セ', 'ブ', 'ン', 'ラ', 'ー', 'メ', '京', '都'), minLength: 1, maxLength: 4 }),
    );
    const toFullWidth = (t: string): string => t.replace(/[!-~]/g, (c) => String.fromCodePoint((c.codePointAt(0) ?? 0) + 0xfee0));
    fc.assert(
      fc.property(fc.array(word, { minLength: 1, maxLength: 6 }), fc.nat(), fc.nat(), (words, i, j) => {
        const a = i % words.length;
        const b = a + 1 + (j % (words.length - a));
        const part = words.slice(a, b).join(' ');
        const text = words.join('  ');
        expect(matches(text, part)).toBe(true);
        expect(matches(text, part.toUpperCase())).toBe(true);
        expect(matches(text, toFullWidth(part))).toBe(true);
        expect(matches(toFullWidth(text), part.normalize('NFD'))).toBe(true);
      }),
    );
  });
});
