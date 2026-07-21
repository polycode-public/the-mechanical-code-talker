// idb-persist: the page-side IndexedDB wrapper, driven end to end against a
// stubbed indexedDB — round-trip, the discard-on-mismatch policy
// (schemaVersion and stamp), and the best-effort contract (any storage
// failure, or no storage at all, resolves to no-saved-state / no-op, never a
// thrown error).
import { test } from "node:test";
import assert from "node:assert/strict";
import { openPersistedStore } from "../../src/surfaces/web/idb-persist.mjs";

// ---- a minimal indexedDB stub: async request objects (fired on a macrotask,
// after handlers attach, like the real thing), one Map per object store,
// out-of-line keys. `failing` makes every store operation error, to exercise
// the wrapper's catch paths.
function createFakeIndexedDB({ failing = false } = {}) {
  const databases = new Map(); // dbName -> Map(storeName -> Map(key -> value))
  const later = (fn) => setTimeout(fn, 0);

  function asyncRequest(operation) {
    const request = { onsuccess: null, onerror: null, result: undefined, error: null };
    later(() => {
      try {
        if (failing) throw new Error("stubbed storage failure");
        request.result = operation();
        if (request.onsuccess) request.onsuccess({ target: request });
      } catch (error) {
        request.error = error;
        if (request.onerror) request.onerror({ target: request });
      }
    });
    return request;
  }

  const indexedDB = {
    open(dbName) {
      const request = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, result: null, error: null };
      later(() => {
        const isNew = !databases.has(dbName);
        if (isNew) databases.set(dbName, new Map());
        const stores = databases.get(dbName);
        request.result = {
          createObjectStore(storeName) {
            if (!stores.has(storeName)) stores.set(storeName, new Map());
            return {};
          },
          transaction(storeName) {
            const data = stores.get(storeName);
            return {
              objectStore() {
                return {
                  get: (key) => asyncRequest(() => data.get(key)),
                  put: (value, key) => asyncRequest(() => { data.set(key, value); return key; }),
                  delete: (key) => asyncRequest(() => { data.delete(key); }),
                };
              },
            };
          },
        };
        if (isNew && request.onupgradeneeded) request.onupgradeneeded({ target: request });
        if (request.onsuccess) request.onsuccess({ target: request });
      });
      return request;
    },
  };

  const dataFor = (dbName, storeName = "memory") => databases.get(dbName)?.get(storeName);
  return { indexedDB, dataFor };
}

test("save then load round-trips the payload, with the record's own stamp and savedAt", async () => {
  const { indexedDB } = createFakeIndexedDB();
  const store = openPersistedStore({ storeKey: "chat", stamp: "1.2.3:100", indexedDB });
  const payload = { individuals: [{ id: "f1", class: "Fact" }], proseIndex: {} };

  assert.equal(await store.save(payload), true);
  const record = await store.load();
  assert.equal(record.schemaVersion, 1);
  assert.equal(record.stamp, "1.2.3:100");
  assert.ok(record.savedAt, "the record carries when it was saved");
  assert.deepEqual(record.payload, payload);
});

test("a later save overwrites the earlier record — one snapshot per storeKey, never a history", async () => {
  const { indexedDB, dataFor } = createFakeIndexedDB();
  const store = openPersistedStore({ storeKey: "chat", stamp: "s", indexedDB });
  await store.save({ n: 1 });
  await store.save({ n: 2 });
  assert.deepEqual((await store.load()).payload, { n: 2 });
  assert.equal(dataFor("tmct").size, 1);
});

test("two storeKeys in the same database hold independent records", async () => {
  const { indexedDB } = createFakeIndexedDB();
  const chat = openPersistedStore({ storeKey: "chat", stamp: "s", indexedDB });
  const adventure = openPersistedStore({ storeKey: "adventure", stamp: "s", indexedDB });
  await chat.save({ who: "chat" });
  await adventure.save({ who: "adventure" });
  assert.deepEqual((await chat.load()).payload, { who: "chat" });
  assert.deepEqual((await adventure.load()).payload, { who: "adventure" });
});

test("a schemaVersion mismatch discards the record: load resolves null and the stale record is deleted", async () => {
  const { indexedDB, dataFor } = createFakeIndexedDB();
  const store = openPersistedStore({ storeKey: "chat", stamp: "s", indexedDB });
  await store.save({ n: 1 });
  dataFor("tmct").set("chat", { ...dataFor("tmct").get("chat"), schemaVersion: 999 });

  assert.equal(await store.load(), null);
  assert.equal(dataFor("tmct").has("chat"), false, "the unreadable record is gone, not left to fail again next boot");
});

test("a stamp mismatch (a new deploy or a changed seed) discards the record and starts fresh", async () => {
  const { indexedDB, dataFor } = createFakeIndexedDB();
  const oldDeploy = openPersistedStore({ storeKey: "chat", stamp: "1.0.0:100", indexedDB });
  await oldDeploy.save({ taught: ["old"] });

  const newDeploy = openPersistedStore({ storeKey: "chat", stamp: "2.0.0:150", indexedDB });
  assert.equal(await newDeploy.load(), null);
  assert.equal(dataFor("tmct").has("chat"), false);
});

test("load with nothing ever saved resolves null", async () => {
  const { indexedDB } = createFakeIndexedDB();
  const store = openPersistedStore({ storeKey: "chat", stamp: "s", indexedDB });
  assert.equal(await store.load(), null);
});

test("a storage failure resolves to no-saved-state / no-op — load null, save false — never a thrown error", async () => {
  const { indexedDB } = createFakeIndexedDB({ failing: true });
  const store = openPersistedStore({ storeKey: "chat", stamp: "s", indexedDB });
  assert.equal(await store.load(), null);
  assert.equal(await store.save({ n: 1 }), false);
  assert.equal(await store.clear(), false);
});

test("no indexedDB at all (private mode) resolves the same way: load null, save/clear false", async () => {
  const store = openPersistedStore({ storeKey: "chat", stamp: "s", indexedDB: null });
  assert.equal(await store.load(), null);
  assert.equal(await store.save({ n: 1 }), false);
  assert.equal(await store.clear(), false);
});

test("clear removes the saved record, so the next load starts from nothing", async () => {
  const { indexedDB, dataFor } = createFakeIndexedDB();
  const store = openPersistedStore({ storeKey: "chat", stamp: "s", indexedDB });
  await store.save({ n: 1 });
  assert.equal(await store.clear(), true);
  assert.equal(await store.load(), null);
  assert.equal(dataFor("tmct").has("chat"), false);
});
