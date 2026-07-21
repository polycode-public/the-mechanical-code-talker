// idb-persist.mjs — best-effort IndexedDB persistence for a page's in-memory
// session store (Backend B's whole payload snapshot), so what a visitor
// taught the page survives a reload on the same device.
//
// Every operation is best-effort by contract: a browser with no IndexedDB
// (private mode, storage denied, quota exceeded, an evicted database) makes
// load() resolve null and save()/clear() resolve false — never a thrown
// error, never a blocked boot. The page works identically without storage;
// this only keeps a return visit from starting over.
//
// One object store ("memory"), out-of-line keys, one record per storeKey:
//   { schemaVersion, stamp, savedAt, payload }
// A record whose schemaVersion or stamp doesn't match the caller's is
// DISCARDED on load (deleted, resolve null) rather than migrated — the fresh
// seed is always available and always correct, so a stale snapshot from an
// older deploy or a different seed must never win over it. `stamp` is the
// caller's own deploy identity (site version + seed size, say); rolling it
// is how a deploy invalidates every device's saved state at once.
//
// `indexedDB` is injectable so Node unit tests can drive the whole contract
// against a stub without a browser.

const SCHEMA_VERSION = 1;
const STORE_NAME = "memory";
const DB_VERSION = 1;

export function openPersistedStore({ dbName = "tmct", storeKey, stamp, indexedDB = globalThis.indexedDB } = {}) {
  let dbPromise = null;

  function openDb() {
    if (!indexedDB) return Promise.resolve(null);
    if (!dbPromise) {
      dbPromise = new Promise((resolve) => {
        let request;
        try {
          request = indexedDB.open(dbName, DB_VERSION);
        } catch {
          resolve(null);
          return;
        }
        request.onupgradeneeded = () => {
          try {
            request.result.createObjectStore(STORE_NAME);
          } catch {}
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
        request.onblocked = () => resolve(null);
      });
    }
    return dbPromise;
  }

  function settle(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("indexeddb request failed"));
    });
  }

  // Resolves the operation's result, or the NO_DB sentinel when there is no
  // usable database at all — callers translate that into their own no-op
  // shape (null / false) rather than treating it as data.
  const NO_DB = Symbol("no-db");
  async function withStore(mode, operate) {
    const db = await openDb();
    if (!db) return NO_DB;
    const tx = db.transaction(STORE_NAME, mode);
    return operate(tx.objectStore(STORE_NAME));
  }

  async function clear() {
    try {
      const result = await withStore("readwrite", (store) => settle(store.delete(storeKey)));
      return result !== NO_DB;
    } catch {
      return false;
    }
  }

  return {
    /** The saved record `{ schemaVersion, stamp, savedAt, payload }`, or null:
     *  nothing saved, storage unavailable, or a record whose schemaVersion or
     *  stamp no longer matches (discarded on the spot — the fresh seed wins). */
    async load() {
      try {
        const record = await withStore("readonly", (store) => settle(store.get(storeKey)));
        if (record === NO_DB || !record || typeof record !== "object") return null;
        if (record.schemaVersion !== SCHEMA_VERSION || record.stamp !== stamp) {
          await clear();
          return null;
        }
        return record;
      } catch {
        return null;
      }
    },

    /** Persist `payload` (the caller's own snapshot — pass a clone, not the
     *  live object) under this store's key. Resolves true only when the write
     *  actually landed. */
    async save(payload) {
      try {
        const record = { schemaVersion: SCHEMA_VERSION, stamp, savedAt: new Date().toISOString(), payload };
        const result = await withStore("readwrite", (store) => settle(store.put(record, storeKey)));
        return result !== NO_DB;
      } catch {
        return false;
      }
    },

    /** Remove this store's saved record. Resolves true when the delete landed. */
    clear,
  };
}
