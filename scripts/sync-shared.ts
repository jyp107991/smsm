/**
 * S8: the push Edge Function speaks with the app's own words (src/core/notify.ts) and money formatting
 * (src/core/money.ts). The functions bundler is only sure to reach files under supabase/functions/, so this copies
 * the two there, byte for byte; tests/unit/push-function.test.ts and tests/unit/shared-copy.test.ts fail when a
 * copy differs from its source.
 * Usage: npx tsx scripts/sync-shared.ts           (write the copies)
 *        npx tsx scripts/sync-shared.ts --check   (fail if a copy is stale)
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SHARED = ['notify.ts', 'money.ts'] as const;

const check = process.argv.includes('--check');
let stale = false;
for (const name of SHARED) {
  const source = readFileSync(`src/core/${name}`, 'utf8');
  const target = `supabase/functions/_shared/${name}`;
  let current: string | null;
  try { current = readFileSync(target, 'utf8'); } catch { current = null; }
  if (current === source) continue;
  if (check) {
    console.error(`${target} differs from src/core/${name}: run npx tsx scripts/sync-shared.ts`);
    stale = true;
  } else {
    writeFileSync(target, source);
    console.log(`wrote ${target}`);
  }
}
if (stale) process.exit(1);
