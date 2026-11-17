// Fresh review of wave 2: brands spelled with symbols or all capitals keep their own spelling in quick add.
import { describe, expect, it } from 'vitest';
import merchants from '../../content/merchants.json';
import { tidyDescription } from './text';

const spellings = new Map(Object.keys(merchants).map((k) => [k.toLowerCase(), k]));

describe('Q-U6 tidyDescription: brands keep their own spelling', () => {
  it.each([
    ['m&s', 'M&S'],
    ['h&m socks', 'H&M socks'],
    ['ee bill', 'EE bill'],
    ['b&q paint', 'B&Q paint'],
  ])('%j → %j', (typed, tidy) => {
    expect(tidyDescription(typed, spellings)).toBe(tidy);
  });
});
