// The memory-backend conformance kit (memory-backend-conformance.mjs) runs
// against two backend flavors — the reference in-memory backend (physical
// delete) and a hand-built tombstoning fixture (delete-by-filtered-read) —
// to prove the kit checks the observable delete contract rather than which
// implementation choice a backend made. Beyond the shared kit, this file
// pins the reference backend's own extras: TTL expiry, post-close rejection,
// and defensive copies on read. It also proves the package's
// `./memory-backend-conformance` export subpath resolves.
import test from "node:test";
import assert from "node:assert/strict";

import { runMemoryBackendConformance, buildFixtureRows, collectRows } from "../../src/tools/memory-backend-conformance.mjs";
import { createRowMemoryBackend } from "../../src/adapters/memory/row-backend-memory.mjs";
import {
  ROW_BACKEND_KIND, ROW_BACKEND_CONTRACT_VERSION, BackendUnavailable, assertValidRow,
} from "../../src/adapters/memory/row-backend.mjs";

runMemoryBackendConformance("the reference in-memory backend", () => createRowMemoryBackend());

/** A second backend flavor that deletes by tombstoning: a deleted row or
 *  meta entry stays in its map with a `deletedAt` stamp, and every read
 *  filters stamped entries out. Running the shared kit against this too is
 *  what proves the kit's delete checks are satisfied by either
 *  implementation choice, as the contract promises. */
function createTombstoningFixtureBackend() {
  const rows = new Map();
  const meta = new Map();

  return {
    kind: ROW_BACKEND_KIND,
    contractVersion: ROW_BACKEND_CONTRACT_VERSION,

    async readRows() {
      return [...rows.values()].filter((row) => !row.deletedAt).map((row) => ({ ...row }));
    },

    async readRowsByTerm(term) {
      return [...rows.values()].filter((row) => !row.deletedAt && row.term === term).map((row) => ({ ...row }));
    },

    async putRows(candidateRows) {
      const validated = (candidateRows || []).map((row) => assertValidRow(row));
      for (const row of validated) rows.set(row.rowKey, { ...row, deletedAt: undefined });
    },

    async deleteRows(rowKeys) {
      for (const key of rowKeys || []) {
        const existing = rows.get(key);
        if (existing) rows.set(key, { ...existing, deletedAt: Date.now() });
      }
    },

    async readMeta(key) {
      const entry = meta.get(key);
      return entry && !entry.deletedAt ? entry.value : null;
    },

    async putMeta(key, value) {
      meta.set(key, { value, deletedAt: undefined });
    },

    async deleteAll() {
      for (const [key, row] of rows) rows.set(key, { ...row, deletedAt: Date.now() });
      for (const [key, entry] of meta) meta.set(key, { ...entry, deletedAt: Date.now() });
    },

    async close() {},
  };
}

runMemoryBackendConformance("a tombstoning fixture backend", createTombstoningFixtureBackend);

test("the reference backend is the kit's own fixture, and passes it", () => {
  // runMemoryBackendConformance above already ran the full kit against
  // createRowMemoryBackend(); this test documents that fact for a reader
  // who lands here without following the two calls above.
  assert.equal(typeof createRowMemoryBackend, "function");
});

test("the reference backend expires a row past its TTL, honestly and on an injected clock", async () => {
  let clockSeconds = 1_000;
  const backend = createRowMemoryBackend({ clock: () => clockSeconds });
  await backend.putRows([
    { rowKey: "fixture:fact:1", rowClass: "fact", term: "alpha", json: "{}", expiresAt: 1_010 },
    { rowKey: "fixture:fact:2", rowClass: "fact", term: "beta", json: "{}" }, // no policy set
  ]);
  assert.equal((await collectRows(backend.readRows())).length, 2, "neither row has expired yet");
  clockSeconds = 1_020;
  const live = await collectRows(backend.readRows());
  assert.deepEqual(live.map((row) => row.rowKey), ["fixture:fact:2"], "the TTL-stamped row is gone; the unstamped one never expires");
});

test("after close(), the reference backend rejects further calls with BackendUnavailable", async () => {
  const backend = createRowMemoryBackend();
  await backend.putRows(buildFixtureRows());
  await backend.close();
  await assert.rejects(backend.readRows(), (error) => {
    assert.ok(error instanceof BackendUnavailable);
    assert.equal(error.code, "TMCT_BACKEND_UNAVAILABLE");
    return true;
  });
});

test("the reference backend hands back defensive copies, so a caller mutating a read row cannot corrupt the store", async () => {
  const backend = createRowMemoryBackend();
  await backend.putRows([{ rowKey: "fixture:fact:1", rowClass: "fact", term: "alpha", json: "{}" }]);
  const [row] = await collectRows(backend.readRows());
  row.json = "corrupted";
  const [again] = await collectRows(backend.readRows());
  assert.equal(again.json, "{}");
});

test("the package's ./memory-backend-conformance subpath resolves to the same kit", async () => {
  const subpath = await import("@polycode-projects/the-mechanical-code-talker/memory-backend-conformance");
  assert.equal(typeof subpath.runMemoryBackendConformance, "function");
  assert.equal(typeof subpath.buildFixtureRows, "function");
  assert.equal(typeof subpath.collectRows, "function");
});
