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
  try {
    const form = await request.formData();
    const file = form.getAll('photo').find((f) => f && typeof f === 'object' && typeof f.type === 'string' && f.type.startsWith('image/'));
    const words = ['title', 'text', 'url']
      .map((k) => form.get(k))
      .filter((v) => typeof v === 'string' && v.trim() !== '')
      .map((v) => v.trim());
    const text = [...new Set(words)].join(' ').slice(0, 500) || null;
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
