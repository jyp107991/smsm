/** Prompt files are bundled as text (wrangler.jsonc rules; the md-text plugin in vitest.config.ts). */
declare module '*.md' {
  const text: string;
  export default text;
}
