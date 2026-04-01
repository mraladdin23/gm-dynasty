// ─────────────────────────────────────────────────────────
//  Dynasty Locker Room — IndexedDB Cache
//  Replaces localStorage for the large Sleeper player DB
//  (~6MB, exceeds the 5MB localStorage quota)
//  All other small data (ver stamps, user prefs) stay in localStorage
// ─────────────────────────────────────────────────────────

const DLRIDB = (() => {
  const DB_NAME    = "dlr_cache";
  const DB_VERSION = 1;
  const STORE      = "kvstore";
  let _db = null;

  function _open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        e.target.result.createObjectStore(STORE);
      };
      req.onsuccess = e => {
        _db = e.target.result;
        resolve(_db);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function get(key) {
    try {
      const db = await _open();
      return new Promise((resolve, reject) => {
        const tx  = db.transaction(STORE, "readonly");
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror   = () => reject(req.error);
      });
    } catch(e) {
      // Fallback to localStorage
      try { return JSON.parse(localStorage.getItem(key)); } catch(_) { return null; }
    }
  }

  async function set(key, value) {
    try {
      const db = await _open();
      return new Promise((resolve, reject) => {
        const tx  = db.transaction(STORE, "readwrite");
        const req = tx.objectStore(STORE).put(value, key);
        req.onsuccess = () => resolve();
        req.onerror   = () => reject(req.error);
      });
    } catch(e) {
      // Fallback to localStorage (may fail for large data)
      try { localStorage.setItem(key, JSON.stringify(value)); } catch(_) {}
    }
  }

  async function remove(key) {
    try {
      const db = await _open();
      return new Promise((resolve, reject) => {
        const tx  = db.transaction(STORE, "readwrite");
        const req = tx.objectStore(STORE).delete(key);
        req.onsuccess = () => resolve();
        req.onerror   = () => reject(req.error);
      });
    } catch(e) {}
  }

  return { get, set, remove };
})();
