/**
 * Where the phone keeps the household's copy, the write queue and kept-back writes: IndexedDB through
 * idb-keyval (OFF-1, OFF-5). An in-memory store stands in for tests and the demo.
 */
import type { AsyncStorage } from '@tanstack/react-query-persist-client';
import { createStore, del, get, set } from 'idb-keyval';

export interface PromiseStorage {
  getItem(key: string): Promise<string | undefined>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export function idbStorage(): PromiseStorage {
  const store = createStore('smsm', 'cache');
  return {
    getItem: (key) => get<string>(key, store),
    setItem: (key, value: string) => set(key, value, store),
    removeItem: (key) => del(key, store),
  };
}

export function memoryStorage(initial: Iterable<[string, string]> = []): AsyncStorage & { map: Map<string, string> } {
  const map = new Map(initial);
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
  };
}

/**
 * OFF-1: ask the browser to keep this site's storage (not evict it under pressure). Asked once per open;
 * the browser decides, usually without a prompt for an installed app. Resolves with the answer.
 */
export async function requestPersistentStorage(
  storage: Pick<StorageManager, 'persist' | 'persisted'> | undefined = typeof navigator === 'undefined' ? undefined : navigator.storage,
): Promise<boolean> {
  try {
    // Older browsers have no StorageManager at all.
    if (storage === undefined || typeof storage.persist !== 'function') return false;
    if (await storage.persisted()) return true;
    return await storage.persist();
  } catch {
    return false;
  }
}
