import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { trace } from './trace-lib.ts';

const TEST_FILE = /\.(test|spec)\.(ts|tsx)$|_test\.sql$/;
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (TEST_FILE.test(name)) out.push(p);
  }
  return out;
}

const files = ['src', 'tests', 'scripts', 'supabase'].flatMap((d) => walk(d));
const result = trace({
  spec: readFileSync('docs/SPEC.md', 'utf8'),
  openItems: readFileSync('docs/OPEN_ITEMS.md', 'utf8'),
  // The trace tests themselves use made-up ids on purpose.
  tests: files.filter((p) => !p.endsWith('trace.test.ts')).map((path) => ({ path, text: readFileSync(path, 'utf8') })),
});

const both = result.ids.filter((id) => result.tested.has(id) && result.deferred.has(id));
console.log(`criteria ${result.ids.length}: tested ${result.tested.size}, deferred ${result.deferred.size} (of which partly tested ${both.length})`);
if (result.missing.length) console.log(`neither tested nor deferred: ${result.missing.join(' ')}`);
for (const u of result.unknown) console.log(`unknown id ${u.id} in ${u.path}`);
process.exit(result.ok ? 0 : 1);
