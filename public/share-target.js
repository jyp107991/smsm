/*
 * smsm's share target (S6b; ADD-8, SPEC 5.3), loaded into the service worker (vite.config.ts importScripts).
 * Android's share sheet posts a photo, screenshot or text to /share; this keeps it on the phone and opens the app at
 * /?do=shared, where the Add sheet takes it (src/data/smartActions.ts takeShared). Nothing is sent anywhere.
 *
 * Storage, as idb-keyval lays it out (one object store per database, plain keys):
 *   database "smsm-shared", store "shared", key "latest" = { photo: "shared/<uuid>" | null, text: string | null }
 *   database "smsm-photos", store "photos", key "shared/<uuid>" = the photo (Blob)
 */
function openStore(db, store) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(db);
    req.onupgradeneeded = () => { req.result.createObjectStore(store); };
    req.onsuccess = () => { resolve(req.result); };
    req.onerror = () => { reject(req.error); };
  });
}

const MAX_PHOTO = 15 * 1024 * 1024;

async function take(db, store, key) {
  const conn = await openStore(db, store);
  const value = await new Promise((resolve, reject) => {
    const req = conn.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => { resolve(req.result); };
    req.onerror = () => { reject(req.error); };
  });
  conn.close();
  return value;
}

async function drop(db, store, key) {
  const conn = await openStore(db, store);
  await new Promise((resolve) => {
    const tx = conn.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => { resolve(); };
    tx.onerror = () => { resolve(); };
  });
  conn.close();
}

async function put(db, store, key, value) {
  const conn = await openStore(db, store);
  await new Promise((resolve, reject) => {
    const tx = conn.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => { resolve(); };
    tx.onerror = () => { reject(tx.error); };
  });
  conn.close();
}

async function keepShared(request) {
  // Only the phone's own share sheet (or this app) may hand things over: never another website's form.
  if (request.headers.get('sec-fetch-site') === 'cross-site') return Response.redirect('/', 303);
  try {
    const form = await request.formData();
    const file = form.getAll('photo').find((f) => f && typeof f === 'object' && typeof f.type === 'string' && f.type.startsWith('image/') && f.size <= MAX_PHOTO);
    const words = ['title', 'text', 'url']
      .map((k) => form.get(k))
      .filter((v) => typeof v === 'string' && v.trim() !== '')
      .map((v) => v.trim());
    const text = [...new Set(words)].join(' ').slice(0, 500) || null;
    // An earlier share never opened is let go (one at a time).
    const before = await take('smsm-shared', 'shared', 'latest').catch(() => null);
    if (before && before.photo) await drop('smsm-photos', 'photos', before.photo);
    let photo = null;
    if (file) {
      photo = `shared/${crypto.randomUUID()}`;
      await put('smsm-photos', 'photos', photo, file);
    }
    await put('smsm-shared', 'shared', 'latest', { photo, text });
  } catch {
    // Nothing kept: the app simply opens.
  }
  return Response.redirect('/?do=shared', 303);
}

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.origin === self.location.origin && url.pathname === '/share') {
    event.respondWith(keepShared(event.request));
  }
});
