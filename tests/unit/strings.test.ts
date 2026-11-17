/**
 * TXT-7: every interface string lives in src/ui/strings.ts; screens and UI components render no
 * literal copy. DAT-5 (partial): every dependency is pinned to an exact version, in package.json and
 * the lockfile.
 *
 * The gallery (src/screens/gallery/) is a dev-only page full of sample data, so it is not scanned.
 */
import { describe, expect, it } from 'vitest';
import ts from 'typescript';
import { strings } from '../../src/ui/strings';

// The app tsconfig (which covers tests/unit) has no Node types, so node:fs is imported by a
// non-literal specifier and given just the signatures used here. Vitest runs from the repo root.
const nodeFs = 'node:fs';
const fs = (await import(/* @vite-ignore */ nodeFs)) as {
  readFileSync: (path: string, encoding: 'utf8') => string;
  readdirSync: (path: string, options: { recursive: true }) => string[];
  existsSync: (path: string) => boolean;
};

// ---------- the scanner ----------

/** Attributes whose string value is shown or read out to people. */
const COPY_ATTRIBUTES = new Set([
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-placeholder',
  'aria-valuetext',
  'alt',
  'title',
  'placeholder',
  'label',
]);

const HAS_LETTER = /\p{L}/u;
const ENTITY = /&(?:[a-z][a-z0-9]*|#\d+|#x[0-9a-f]+);/gi;

interface Finding {
  file: string;
  line: number;
  text: string;
}

function findLiteralCopy(file: string, source: string): Finding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const out: Finding[] = [];
  const at = (node: ts.Node, text: string) => {
    out.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: text.trim().slice(0, 60) });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      const text = node.getText(sf).replace(ENTITY, ' ');
      if (HAS_LETTER.test(text)) at(node, text);
    } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
      const name = node.name.getText(sf);
      if (COPY_ATTRIBUTES.has(name) && HAS_LETTER.test(node.initializer.text)) at(node, `${name}="${node.initializer.text}"`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function filesToScan(): string[] {
  const files: string[] = [];
  for (const root of ['src/screens', 'src/ui']) {
    if (!fs.existsSync(root)) continue;
    for (const rel of fs.readdirSync(root, { recursive: true })) {
      const path = `${root}/${rel.replace(/\\/g, '/')}`;
      if (!path.endsWith('.tsx')) continue;
      if (/\.test\.tsx$/.test(path)) continue;
      if (path.startsWith('src/screens/gallery/')) continue;
      files.push(path);
    }
  }
  return files.sort();
}

describe('TXT-7 interface strings', () => {
  it('TXT-7: the scanner itself finds literal copy and allows expressions', () => {
    const sample = [
      'export function A({ n }: { n: string }) {',
      '  return (',
      '    <div className="flex gap-2" data-part="head" aria-hidden="true">',
      '      Sam owes Jae',
      '      {strings.app.name}',
      "      {' · '}",
      '      <img alt="A cat" src="/x.png" />',
      '      <input placeholder="Amount" aria-label={strings.app.tagline} />',
      '      &nbsp;£ 4 ·',
      '      <svg role="img" aria-label={n}><title>Dog</title></svg>',
      '    </div>',
      '  );',
      '}',
    ].join('\n');
    const found = findLiteralCopy('sample.tsx', sample).map((f) => f.text);
    expect(found).toEqual(['Sam owes Jae', 'alt="A cat"', 'placeholder="Amount"', 'Dog']);
  });

  it('TXT-7: no literal copy in src/screens/**/*.tsx or src/ui/**/*.tsx (gallery and tests excepted)', () => {
    const files = filesToScan();
    expect(files.length).toBeGreaterThan(0);
    const findings = files.flatMap((f) => findLiteralCopy(f, fs.readFileSync(f, 'utf8')));
    expect(findings.map((f) => `${f.file}:${String(f.line)} ${f.text}`)).toEqual([]);
  });

  it('TXT-7: src/ui/strings.ts exports the strings object', () => {
    expect(typeof strings).toBe('object');
    expect(Object.keys(strings).length).toBeGreaterThan(0);
    expect(strings.app.name).toBe('smsm');
  });
});

// ---------- DAT-5 pinned dependencies ----------

const EXACT = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}
interface PackageLock {
  lockfileVersion: number;
  packages: Record<string, { version?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }>;
}

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as PackageJson;
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8')) as PackageLock;
const sections = ['dependencies', 'devDependencies', 'optionalDependencies'] as const;

describe('DAT-5 pinned dependencies', () => {
  it('DAT-5: the exact-version check rejects ranges and tags', () => {
    for (const ok of ['1.2.3', '19.3.1', '0.0.1', '1.0.0-beta.2', '2.0.0+build.5']) expect(ok).toMatch(EXACT);
    for (const bad of ['^1.2.3', '~1.2.3', '*', '1.x', '1.2.x', 'latest', 'next', '>=1.0.0', '1.2', '1', '1.2.3 - 2.0.0', '1.2.3 || 2.0.0', 'github:a/b', 'file:../x', 'npm:react@18.3.1', '']) {
      expect(bad).not.toMatch(EXACT);
    }
  });

  it('DAT-5: every dependency and devDependency in package.json is an exact version', () => {
    expect(Object.keys(pkg.dependencies ?? {}).length).toBeGreaterThan(0);
    expect(Object.keys(pkg.devDependencies ?? {}).length).toBeGreaterThan(0);
    const loose: string[] = [];
    for (const section of sections) {
      for (const [name, version] of Object.entries(pkg[section] ?? {})) {
        if (!EXACT.test(version)) loose.push(`${section}: ${name}@${version}`);
      }
    }
    expect(loose).toEqual([]);
  });

  it('DAT-5: the lockfile pins the same versions as package.json', () => {
    const root = lock.packages[''];
    expect(root).toBeDefined();
    expect(root!.dependencies ?? {}).toEqual(pkg.dependencies ?? {});
    expect(root!.devDependencies ?? {}).toEqual(pkg.devDependencies ?? {});
    const mismatched: string[] = [];
    for (const section of ['dependencies', 'devDependencies'] as const) {
      for (const [name, version] of Object.entries(pkg[section] ?? {})) {
        const installed = lock.packages[`node_modules/${name}`]?.version;
        if (installed !== version) mismatched.push(`${name}: package.json ${version}, lockfile ${String(installed)}`);
      }
    }
    expect(mismatched).toEqual([]);
  });
});
