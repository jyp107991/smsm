/**
 * S9 (OPEN_ITEMS, "Actions pinned by tag, not commit"): every action a workflow uses is pinned to a full commit SHA,
 * so a moved or hijacked tag can't change what runs with the repository's secrets. The version it was pinned at is
 * kept in a comment (`# v7.0.1`) for people and for update tools. A workflow in this repository (`./.github/...`)
 * is part of the same commit, so it needs no pin.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const DIR = '.github/workflows';
const files = readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f));

interface Use { file: string; line: number; text: string; ref: string }

function usesIn(file: string): Use[] {
  const out: Use[] = [];
  readFileSync(`${DIR}/${file}`, 'utf8').split('\n').forEach((text, i) => {
    // `uses:` as a step or job key: "- uses: x", "  uses: x", with or without quotes.
    const m = /^\s*(?:-\s+)?uses:\s*['"]?([^'"\s#]+)['"]?(.*)$/.exec(text);
    if (m) out.push({ file, line: i + 1, text: text.trim(), ref: m[1] ?? '' });
  });
  return out;
}

const all = files.flatMap(usesIn);
const external = all.filter((u) => !u.ref.startsWith('./'));

describe('GitHub Actions are pinned to commits', () => {
  it('finds the workflows and the actions they use', () => {
    expect(files.length).toBeGreaterThan(0);
    expect(external.length).toBeGreaterThan(0);
  });

  it('every external action is owner/repo@<40-hex commit SHA> with its version tag in a comment', () => {
    const bad = external
      .filter((u) => !/^[\w.-]+\/[\w.-]+(?:\/[\w./-]+)?@[0-9a-f]{40}$/.test(u.ref) || !/#\s*v\d+(?:\.\d+){0,2}\s*$/.test(u.text))
      .map((u) => `${u.file}:${String(u.line)} ${u.text}`);
    expect(bad).toEqual([]);
  });

  it('one action is pinned to one commit everywhere, and its comment names one version', () => {
    const seen = new Map<string, Set<string>>();
    for (const u of external) {
      const [name] = u.ref.split('@');
      const version = /#\s*(v[\d.]+)\s*$/.exec(u.text)?.[1] ?? '?';
      const key = name ?? '';
      const set = seen.get(key) ?? new Set<string>();
      set.add(`${u.ref} ${version}`);
      seen.set(key, set);
    }
    const mixed = [...seen].filter(([, s]) => s.size > 1).map(([name, s]) => `${name}: ${[...s].join(', ')}`);
    expect(mixed).toEqual([]);
  });

  it('a local reusable workflow is the only unpinned use', () => {
    const local = all.filter((u) => u.ref.startsWith('./'));
    for (const u of local) expect(u.ref, `${u.file}:${String(u.line)}`).toMatch(/^\.\/\.github\/workflows\/[\w.-]+\.ya?ml$/);
  });
});
