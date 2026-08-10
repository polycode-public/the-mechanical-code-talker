// row-backend-memory.mjs — the reference implementation of the memory
// row-backend contract (row-backend.mjs): the simplest complete backend, an
// in-process Map. It is the working example the contract's own doc-comment
// describes, the fixture the conformance kit proves itself against
// (src/tools/memory-backend-conformance.mjs), and the storage the row
// service's local double runs over.
//
// Deletes are physical here: a deleted row's key leaves the map. The
// contract only promises a deleted row is absent from every later read, so a
// backend that tombstones instead and filters reads is equally conformant —
// the kit checks the observable outcome, never which of the two this is.

import {
  ROW_BACKEND_KIND, ROW_BACKEND_CONTRACT_VERSION,
  BackendUnavailable, assertValidRow,
} from "./row-backend.mjs";

const nowEpochSeconds = () => Math.floor(Date.now() / 1000);

/** A row backend over an in-process Map, scoped to one session by
 *  construction (the caller makes a fresh one per session, exactly as every
 *  shipped backend does). `clock` is a hook for deterministic TTL tests. */
export function createRowMemoryBackend({ clock = nowEpochSeconds } = {}) {
  const rows = new Map();
  const meta = new Map();
  let closed = false;

  const assertOpen = () => {
    if (closed) throw new BackendUnavailable("this row backend was closed and can no longer be used");
  };

  const liveRows = () => [...rows.values()].filter(
    (row) => row.expiresAt === undefined || row.expiresAt > clock(),
  );

  return {
    kind: ROW_BACKEND_KIND,
    contractVersion: ROW_BACKEND_CONTRACT_VERSION,

    async readRows() {
      assertOpen();
      return liveRows().map((row) => ({ ...row }));
    },

    async readRowsByTerm(term) {
      assertOpen();
      return liveRows().filter((row) => row.term === term).map((row) => ({ ...row }));
    },

    async putRows(candidateRows) {
      assertOpen();
      // Validate every row before writing any of them: a batch carrying one
      // malformed row is refused whole, so a caller retries with the bad row
      // removed rather than discovering a half-applied write. Earlier,
      // already-durable rows from prior calls are untouched either way.
      const validated = (candidateRows || []).map((row) => assertValidRow(row));
      for (const row of validated) rows.set(row.rowKey, { ...row });
    },

    async deleteRows(rowKeys) {
      assertOpen();
      for (const key of rowKeys || []) rows.delete(key);
    },

    async readMeta(key) {
      assertOpen();
      return meta.has(key) ? meta.get(key) : null;
    },

    async putMeta(key, value) {
      assertOpen();
      meta.set(key, value);
    },

    async deleteAll() {
      assertOpen();
      rows.clear();
      meta.clear();
    },

    async close() {
      closed = true;
    },
  };
}
