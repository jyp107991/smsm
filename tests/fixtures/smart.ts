/// <reference types="node" />
/**
 * S6a fakes (docs/slices/S6.md "Interfaces → Data"): the smart-feature service, the phone's photo store and the photo
 * shrinker, for data and screen tests. No real receipts, nothing sent anywhere: the "photo" is a tiny generated image.
 *
 * What the data layer options take (pinned by src/data/smart.test.ts):
 *   ai: AiService {
 *     scan(image: Blob, ctx: { categories: string[]; today: string; country: string }): Promise<AiResult>
 *     parse(text: string, ctx: { categories: string[]; chapters: string[]; today: string }): Promise<AiResult>
 *     categorise(description: string, categories: string[]): Promise<AiResult>
 *   }  AiResult = { ok: true; data } | { ok: false; reason: 'off' | 'limit' | 'timeout' | 'invalid' | 'error' }
 *   photos: PhotoStore { put(path: string, photo: Blob): Promise<void>; get(path: string): Promise<Blob | null> }
 *     (the app's is IndexedDB 'smsm-photos'; here a Map that outlives a restart when the same store is passed again)
 *   downscale: (photo: Blob) => Promise<Blob>   (the app's: canvas, 1280 px on the long side, JPEG 0.8)
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';

export type AiReason = 'off' | 'limit' | 'timeout' | 'invalid' | 'error';
export type AiResult = { ok: true; data: unknown } | { ok: false; reason: AiReason };

/** A recorded Workers AI reply's JSON content (tests/ai/replies/<name>.json), as the server would pass it on. */
export function recorded(name: string): Record<string, unknown> {
  const reply = JSON.parse(readFileSync(resolve(process.cwd(), 'tests/ai/replies', `${name}.json`), 'utf8')) as {
    response?: unknown; choices?: { message: { content: string } }[];
  };
  const raw: unknown = reply.response ?? reply.choices?.[0]?.message.content;
  if (typeof raw !== 'string') return raw as Record<string, unknown>;
  return JSON.parse(raw.replace(/^```(?:json)?\s*/u, '').replace(/\s*```\s*$/u, '')) as Record<string, unknown>;
}

const NOT_ASKED = (): Promise<AiResult> => Promise.reject(new Error('this fake was not told how to answer'));

/** A fake AiService; each task answers what it is given (a result, or a function of the call). */
export function fakeAi(answers: {
  scan?: AiResult | ((image: Blob, ctx: unknown) => Promise<AiResult>);
  parse?: AiResult | ((text: string, ctx: unknown) => Promise<AiResult>);
  categorise?: AiResult | ((description: string, categories: string[]) => Promise<AiResult>);
} = {}) {
  const as = <A extends unknown[]>(a: AiResult | ((...args: A) => Promise<AiResult>) | undefined) =>
    a === undefined ? NOT_ASKED : typeof a === 'function' ? a : () => Promise.resolve(a);
  return {
    scan: vi.fn(as(answers.scan)),
    parse: vi.fn(as(answers.parse)),
    categorise: vi.fn(as(answers.categorise)),
  };
}

/** An answer the test releases when it wants (to type while the reading is on its way). */
export function deferred<T>() {
  let resolve: (v: T) => void = () => undefined;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

/** The phone's photo store, in memory. */
export function memoryPhotos() {
  const map = new Map<string, Blob>();
  return {
    map,
    put: vi.fn((path: string, photo: Blob) => { map.set(path, photo); return Promise.resolve(); }),
    get: vi.fn((path: string) => Promise.resolve(map.get(path) ?? null)),
  };
}

/** A 1×1 PNG, the smallest real image (base64). */
export const TINY_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

/** A "camera photo": a generated image, never a real receipt. */
export function receiptPhoto(name = 'receipt.png'): File {
  const bytes = Uint8Array.from(atob(TINY_PNG_BASE64), (c) => c.charCodeAt(0));
  return new File([bytes], name, { type: 'image/png' });
}

/** The shrinker: answers a smaller JPEG it made (so a test can tell what was sent). */
export function fakeDownscale() {
  const made: Blob[] = [];
  const fn = vi.fn((photo: Blob) => {
    const small = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), String(photo.size)], { type: 'image/jpeg' });
    made.push(small);
    return Promise.resolve(small);
  });
  return Object.assign(fn, { made });
}
