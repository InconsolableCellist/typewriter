// Diskette images kept between visits in IndexedDB (architecture 8.5). The software's store interface is synchronous
// ({ load, save, list, remove }), so every saved image is read once before the system starts, and writes go out in
// the background. When IndexedDB is unavailable (private windows, blocked storage) it behaves as a memory store.
const DB = 'wordproc1980', OS = 'diskettes';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(OS);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class IdbStore {
  static async create() {
    const s = new IdbStore();
    try {
      s.db = await open();
      await new Promise((resolve, reject) => {
        const tx = s.db.transaction(OS, 'readonly'), os = tx.objectStore(OS);
        const req = os.openCursor();
        req.onsuccess = () => { const c = req.result; if (!c) return resolve(); s.records.set(c.key, new Uint8Array(c.value)); c.continue(); };
        req.onerror = () => reject(req.error);
      });
    } catch (e) { console.info('diskettes will not persist', e); s.db = null; }
    return s;
  }

  constructor() { this.records = new Map(); this.db = null; }
  load(id) { const b = this.records.get(id); return b ? b.slice() : null; }
  list() { return [...this.records.keys()]; }
  save(id, bytes) {
    this.records.set(id, bytes.slice());
    this._put(id, bytes.slice().buffer);
  }
  remove(id) { this.records.delete(id); this._put(id, undefined, true); }
  _put(id, value, del = false) {
    if (!this.db) return;
    try {
      const os = this.db.transaction(OS, 'readwrite').objectStore(OS);
      if (del) os.delete(id); else os.put(value, id);
    } catch (e) { console.warn('diskette save failed', e); }
  }
}

/** Overlays the saved images on a fresh library: what the visitor wrote last time replaces the first-run contents. */
export function restoreLibrary(library, store) {
  for (const id of store.list()) {
    const img = library.get(id), bytes = store.load(id);
    if (img && bytes && bytes.length === img.bytes.length) { img.bytes.set(bytes); img.version++; }
  }
  return library;
}
