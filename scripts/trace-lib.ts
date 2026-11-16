/**
 * The spec is executable (ENGINEERING §2). Every criterion id in docs/SPEC.md must be named by at least
 * one test, or deferred in docs/OPEN_ITEMS.md under "## Deferred criteria" as "- ID: reason (S<n>)".
 * A test that names an id the spec does not define is an error too.
 */
export interface TraceInput {
  spec: string;
  openItems: string;
  tests: { path: string; text: string }[];
}
export interface TraceResult {
  ids: string[];
  tested: Map<string, string[]>;
  deferred: Map<string, string>;
  missing: string[];
  unknown: { id: string; path: string }[];
  ok: boolean;
}

const ID = /\b([A-Z]{2,4})-(\d{1,3})\b/g;

export function specIds(spec: string): string[] {
  const ids: string[] = [];
  for (const line of spec.split('\n')) {
    const m = /^- \**([A-Z]{2,4}-\d{1,3})\b/.exec(line);
    if (m?.[1] && !ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

export function deferredIds(openItems: string): Map<string, string> {
  const out = new Map<string, string>();
  const start = openItems.indexOf('## Deferred criteria');
  if (start < 0) return out;
  const rest = openItems.slice(start + 1);
  const end = rest.indexOf('\n## ');
  const section = end < 0 ? rest : rest.slice(0, end);
  for (const line of section.split('\n')) {
    const m = /^- ([A-Z]{2,4}-\d{1,3}(?:, *[A-Z]{2,4}-\d{1,3})*):\s*(.+)$/.exec(line.trim());
    if (!m?.[1] || !m[2]) continue;
    for (const id of m[1].split(/, */)) out.set(id, m[2]);
  }
  return out;
}

export function trace(input: TraceInput): TraceResult {
  const ids = specIds(input.spec);
  const prefixes = new Set(ids.map((i) => i.split('-')[0]));
  const known = new Set(ids);
  const tested = new Map<string, string[]>();
  const unknown: { id: string; path: string }[] = [];
  for (const t of input.tests) {
    for (const m of t.text.matchAll(ID)) {
      const id = m[0];
      if (!prefixes.has(m[1] ?? '')) continue;
      if (!known.has(id)) {
        if (!unknown.some((u) => u.id === id && u.path === t.path)) unknown.push({ id, path: t.path });
        continue;
      }
      const paths = tested.get(id) ?? [];
      if (!paths.includes(t.path)) paths.push(t.path);
      tested.set(id, paths);
    }
  }
  const deferred = deferredIds(input.openItems);
  for (const id of deferred.keys()) if (!known.has(id)) unknown.push({ id, path: 'docs/OPEN_ITEMS.md' });
  const missing = ids.filter((id) => !tested.has(id) && !deferred.has(id));
  return { ids, tested, deferred, missing, unknown, ok: missing.length === 0 && unknown.length === 0 };
}
