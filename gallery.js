// gallery.js — IndexedDB-backed local photo gallery for Cue.
//
// Every shot the user takes goes here automatically (silently, locally).
// The user can later open the gallery, multi-select, and bulk-share to
// Photos via the iOS share sheet (one tap to save N photos at once,
// which is the closest a PWA can get to "auto-save" on iOS).
//
// Schema (object store 'shots'):
//   id          int auto-increment (primary key)
//   blob        Blob           — full-resolution JPEG
//   thumbBlob   Blob           — ~320px JPEG for the grid view
//   createdAt   number         — Date.now() at capture
//   mode        string         — 'preset' | 'paste'
//   context     string         — preset id or 'Copy a photo'
//   width       number?
//   height      number?

const DB_NAME    = 'cue-gallery';
const DB_VERSION = 1;
const STORE      = 'shots';

let _dbPromise = null;
function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB unsupported'));
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        store.createIndex('createdAt', 'createdAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => { _dbPromise = null; reject(req.error); };
  });
  return _dbPromise;
}

function tx(mode, fn) {
  return openDb().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    let out;
    try { out = fn(store); } catch (e) { reject(e); return; }
    t.oncomplete = () => resolve(out);
    t.onerror    = () => reject(t.error);
    t.onabort    = () => reject(t.error);
  }));
}

export async function saveShot(blob, thumbBlob, meta = {}) {
  return tx('readwrite', (store) => new Promise((resolve, reject) => {
    const req = store.add({
      blob,
      thumbBlob,
      createdAt: Date.now(),
      mode:      meta.mode    || '',
      context:   meta.context || '',
      width:     meta.width   || 0,
      height:    meta.height  || 0,
    });
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

// Returns shots newest-first with thumbnails attached. Caller revokes any
// URLs they create from the blobs.
export async function listShots() {
  return tx('readonly', (store) => new Promise((resolve, reject) => {
    const out = [];
    const idx = store.index('createdAt');
    const req = idx.openCursor(null, 'prev');
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return resolve(out);
      const v = cursor.value;
      out.push({
        id:        v.id,
        createdAt: v.createdAt,
        mode:      v.mode,
        context:   v.context,
        thumbBlob: v.thumbBlob,
        width:     v.width,
        height:    v.height,
      });
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  }));
}

// Pulls the full-res blob for one shot — used by bulk Save to Photos and
// the share / delete actions on a single tile.
export async function getShotBlob(id) {
  return tx('readonly', (store) => new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result ? req.result.blob : null);
    req.onerror   = () => reject(req.error);
  }));
}

export async function getShotsBlobs(ids) {
  return tx('readonly', (store) => Promise.all(ids.map(id => new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve({ id, blob: req.result ? req.result.blob : null });
    req.onerror   = () => reject(req.error);
  }))));
}

export async function deleteShots(ids) {
  return tx('readwrite', (store) => Promise.all(ids.map(id => new Promise((resolve, reject) => {
    const req = store.delete(id);
    req.onsuccess = () => resolve();
    req.onerror   = () => reject(req.error);
  }))));
}

export async function countShots() {
  return tx('readonly', (store) => new Promise((resolve, reject) => {
    const req = store.count();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  }));
}

export async function getStorageEstimate() {
  if (navigator.storage && navigator.storage.estimate) {
    try { return await navigator.storage.estimate(); }
    catch { return { usage: 0, quota: 0 }; }
  }
  return { usage: 0, quota: 0 };
}
