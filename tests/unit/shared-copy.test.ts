/// <reference types="node" />
/**
 * S8 (NOT-1): the push function's copies of the core (supabase/functions/_shared/, written by scripts/sync-shared.ts)
 * are the core itself, byte for byte, so a phone shows exactly the words the core's tests check.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('the push function’s copy of the core (NOT-1)', () => {
  for (const name of ['notify.ts', 'money.ts']) {
    it(`NOT-1: supabase/functions/_shared/${name} is src/core/${name}`, () => {
      const copy = readFileSync(resolve(process.cwd(), `supabase/functions/_shared/${name}`), 'utf8');
      expect(copy, 'run npx tsx scripts/sync-shared.ts').toBe(readFileSync(resolve(process.cwd(), `src/core/${name}`), 'utf8'));
    });
  }
});
