/// <reference types="node" />
/**
 * S8 fresh-review fix 5 (NOT-1): public/push.js alerts again for a tag that comes back on purpose (a batch of
 * entries, an approval), and replaces quietly otherwise.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

function worker() {
  const listeners = new Map<string, (e: unknown) => void>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const self: Record<string, unknown> = {
    addEventListener: (type: string, fn: (e: unknown) => void) => { listeners.set(type, fn); },
    registration: { showNotification: (title: string, options: Record<string, unknown>) => { shown.push({ title, options }); return Promise.resolve(); } },
    clients: { matchAll: () => Promise.resolve([]), openWindow: () => Promise.resolve(null) },
    location: new URL('https://smsm.example/sw.js'), navigator: {}, URL, Promise, JSON, Number,
  };
  self.self = self;
  runInNewContext(readFileSync(resolve(process.cwd(), 'public/push.js'), 'utf8'), self);
  const push = async (payload: unknown) => {
    const waits: Promise<unknown>[] = [];
    listeners.get('push')?.({ data: { json: () => payload }, waitUntil: (p: Promise<unknown>) => { waits.push(p); } });
    await Promise.all(waits);
  };
  return { shown, push };
}

describe('public/push.js: renotify (NOT-1; review fix 5)', () => {
  it('NOT-1: a payload asking for it alerts again under the same tag; others don’t', async () => {
    const sw = worker();
    await sw.push({ title: 'smsm', body: 'Sam added 30 entries · All square', path: '/activity', tag: 'entries:sam', icon: '/icons/head-dog.png', count: 0, renotify: true });
    await sw.push({ title: 'smsm', body: 'Sam added Tesco £1.00 · All square', path: '/entry/e', tag: 'entry:e', icon: '/icons/head-dog.png', count: 0 });
    await sw.push({ title: 'smsm', body: 'x', path: '/', icon: '/icons/head-dog.png', count: 0, renotify: true });
    expect(sw.shown[0]?.options).toMatchObject({ tag: 'entries:sam', renotify: true });
    expect(sw.shown[1]?.options['renotify']).toBeUndefined();
    expect(sw.shown[2]?.options['renotify']).toBeUndefined();
  });
});
