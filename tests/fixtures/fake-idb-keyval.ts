/**
 * An in-memory stand-in for `idb-keyval` (jsdom has no IndexedDB), for screen tests of what the app keeps in
 * IndexedDB through `idbStorage()` (src/data/storage.ts). Use it as a module mock:
 *
 *   vi.mock('idb-keyval', async () => (await import('../../tests/fixtures/fake-idb-keyval')).fakeIdbKeyval);
 *
 * Every store lives in `idbData` (by "db/store", then key), which outlives a render: closing the app and
 * opening it again (a new data layer, sessionStorage cleared) still finds what was stored. Clear it between
 * tests with `idbData.clear()`.
 */
type Store = Map<IDBValidKey, unknown>;
type UseStore = (<T>(mode: IDBTransactionMode, cb: (s: IDBObjectStore) => T | PromiseLike<T>) => Promise<T>) & { storeName?: string };

export const idbData = new Map<string, Store>();

function storeOf(custom?: UseStore): Store {
  const name = custom?.storeName ?? 'keyval-store/keyval';
  let s = idbData.get(name);
  if (!s) {
    s = new Map();
    idbData.set(name, s);
  }
  return s;
}

const clone = <T>(v: T): T => (v === undefined ? v : structuredClone(v));

function createStore(dbName: string, storeName: string): UseStore {
  const use = (() => Promise.reject(new Error('the fake idb-keyval has no raw transactions'))) as UseStore;
  use.storeName = `${dbName}/${storeName}`;
  return use;
}

export const fakeIdbKeyval = {
  createStore,
  promisifyRequest: () => Promise.reject(new Error('the fake idb-keyval has no raw requests')),
  get: (key: IDBValidKey, custom?: UseStore) => Promise.resolve(clone(storeOf(custom).get(key))),
  set: (key: IDBValidKey, value: unknown, custom?: UseStore) => {
    storeOf(custom).set(key, clone(value));
    return Promise.resolve();
  },
  setMany: (entries: [IDBValidKey, unknown][], custom?: UseStore) => {
    for (const [k, v] of entries) storeOf(custom).set(k, clone(v));
    return Promise.resolve();
  },
  getMany: (keys: IDBValidKey[], custom?: UseStore) => Promise.resolve(keys.map((k) => clone(storeOf(custom).get(k)))),
  update: (key: IDBValidKey, updater: (old: unknown) => unknown, custom?: UseStore) => {
    const s = storeOf(custom);
    s.set(key, clone(updater(clone(s.get(key)))));
    return Promise.resolve();
  },
  del: (key: IDBValidKey, custom?: UseStore) => {
    storeOf(custom).delete(key);
    return Promise.resolve();
  },
  delMany: (keys: IDBValidKey[], custom?: UseStore) => {
    for (const k of keys) storeOf(custom).delete(k);
    return Promise.resolve();
  },
  clear: (custom?: UseStore) => {
    storeOf(custom).clear();
    return Promise.resolve();
  },
  keys: (custom?: UseStore) => Promise.resolve([...storeOf(custom).keys()]),
  values: (custom?: UseStore) => Promise.resolve([...storeOf(custom).values()].map(clone)),
  entries: (custom?: UseStore) => Promise.resolve([...storeOf(custom).entries()].map(([k, v]) => [k, clone(v)] as [IDBValidKey, unknown])),
};
