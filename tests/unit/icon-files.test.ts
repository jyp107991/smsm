/**
 * The app icon is logo C (DECISIONS 17 Nov). Its files carry the logo in their names (app-c-*), so a new logo gets
 * new URLs and an installed app notices the change (Android updates a home-screen icon only when the manifest's
 * icons change). Every icon the manifest, the page or a notification names must exist.
 */
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const referenced = (file: string) => [...readFileSync(file, 'utf8').matchAll(/\/icons\/([\w.-]+\.(?:png|svg))/g)].map((m) => m[1] ?? '');

describe('app icon files', () => {
  it('every icon named by the manifest, the page and notifications exists, and the app icon is logo C', () => {
    const names = new Set([...referenced('vite.config.ts'), ...referenced('index.html'), ...referenced('public/push.js'), ...referenced('supabase/functions/push/handler.ts')]);
    expect(names.size).toBeGreaterThan(0);
    for (const name of names) expect(existsSync(`public/icons/${name}`), name).toBe(true);
    for (const name of ['app-c-192.png', 'app-c-512.png', 'app-c-maskable-512.png', 'app-c-monochrome-512.png']) expect(names.has(name), name).toBe(true);
    expect(readFileSync('public/icons/icon.svg', 'utf8')).toContain('M50 14C49 30 41 41 28 47');
  });
});
