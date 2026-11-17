/**
 * S6a smart features on the phone: the AI service (POST /api/ai on the app's own Worker, Workers AI behind it; no key
 * on the phone), the phone's photo store (IndexedDB, so a photo taken offline survives closing the app until it is
 * uploaded) and the photo shrinker. All injectable through the data layer's options, so tests and the demo use fakes.
 */
import { createStore, get, set } from 'idb-keyval';
import { shrink } from './photos';

export type AiReason = 'off' | 'limit' | 'timeout' | 'invalid' | 'error';
export type AiResult = { ok: true; data: unknown } | { ok: false; reason: AiReason };

export interface AiService {
  scan(image: Blob, ctx: { categories: string[]; today: string; country: string }): Promise<AiResult>;
  parse(text: string, ctx: { categories: string[]; chapters: string[]; today: string }): Promise<AiResult>;
  categorise(description: string, categories: string[]): Promise<AiResult>;
}

export interface PhotoStore {
  put(path: string, photo: Blob): Promise<void>;
  get(path: string): Promise<Blob | null>;
}

export type Downscale = (photo: Blob) => Promise<Blob>;

const REASONS: readonly AiReason[] = ['off', 'limit', 'timeout', 'invalid', 'error'];

/** Nothing is read: every task answers "off" (a build without the Worker, before sign-in). */
export const offAi: AiService = {
  scan: () => Promise.resolve({ ok: false, reason: 'off' }),
  parse: () => Promise.resolve({ ok: false, reason: 'off' }),
  categorise: () => Promise.resolve({ ok: false, reason: 'off' }),
};

async function base64(photo: Blob): Promise<string> {
  const bytes = new Uint8Array(await photo.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/**
 * The app's AI: the Worker's /api/ai with this person's sign-in. Every failure (offline, slow, signed out, a reply
 * that isn't JSON) comes back as a reason, never a throw, so every screen falls back quietly.
 */
export function workerAi(accessToken: () => Promise<string | null>, endpoint = '/api/ai'): AiService {
  async function ask(body: Record<string, unknown>, ms: number): Promise<AiResult> {
    const token = await accessToken().catch(() => null);
    if (!token) return { ok: false, reason: 'off' };
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(ms),
      });
      if (!res.ok) return { ok: false, reason: res.status === 401 ? 'off' : 'error' };
      const out = (await res.json()) as { ok?: unknown; data?: unknown; reason?: unknown };
      if (out.ok === true) return { ok: true, data: out.data };
      const reason = REASONS.find((r) => r === out.reason);
      return { ok: false, reason: reason ?? 'error' };
    } catch (err) {
      return { ok: false, reason: err instanceof Error && err.name === 'TimeoutError' ? 'timeout' : 'error' };
    }
  }
  return {
    // The Worker allows 25 s for a scan across its models; the phone waits a little longer than that.
    scan: async (image, ctx) => ask({ task: 'scan', image: await base64(image), ...ctx }, 30_000),
    parse: (text, ctx) => ask({ task: 'parse', text, ...ctx }, 10_000),
    categorise: (description, categories) => ask({ task: 'categorise', description, categories }, 10_000),
  };
}

/** The phone's photos, in IndexedDB (database "smsm-photos"). */
export function idbPhotos(): PhotoStore {
  const store = createStore('smsm-photos', 'photos');
  return {
    put: (path, photo) => set(path, photo, store),
    get: async (path) => (await get<Blob>(path, store)) ?? null,
  };
}

/** Photos kept in memory (the demo; nothing outlives the page). */
export function memoryPhotoStore(): PhotoStore {
  const map = new Map<string, Blob>();
  return {
    put: (path, photo) => { map.set(path, photo); return Promise.resolve(); },
    get: (path) => Promise.resolve(map.get(path) ?? null),
  };
}

export const defaultDownscale: Downscale = shrink;
