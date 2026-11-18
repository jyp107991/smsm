/** The live eval only (docs/AI.md §5): `npm run eval:ai`. Never part of `npm test` (it calls Workers AI). */
import { defineConfig } from 'vitest/config';

const mdText = { name: 'md-text', transform(code: string, id: string) { return id.endsWith('.md') ? `export default ${JSON.stringify(code)};` : null; } };

export default defineConfig({
  plugins: [mdText],
  test: { include: ['tests/ai/eval/*.eval.ts'], environment: 'node', testTimeout: 30 * 60_000 },
});
