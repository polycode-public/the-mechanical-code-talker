// memory-backend-conformance.mjs — the published contract test suite for a
// memory row backend (src/adapters/memory/row-backend.mjs's §3.1 interface),
// shaped like conformance.mjs: an implementation is conformant iff it passes
// `runMemoryBackendConformance(name, makeBackend)` against a bare backend
// object, no other tmct internals required. `makeBackend()` returns a fresh,
// independent backend each call — its own session, holding nothing from any
// earlier call.
//
// What the suite checks: the duck-typed shape; every row class round-trips
// through `putRows`/`readRows`; a bookkeeping row round-trips but never
// reaches an assembled answer; meta scalars round-trip and an unset key
// reads null; `deleteRows` and `deleteAll` leave their targets absent from
// every later read, satisfied whether the backend removes the row or
// tombstones it behind a filtered read; a batch carrying one bad row still
// leaves the good rows durable; one row set fed in two arrival orders
// assembles to the same payload; the two failure classes carry their stable
// codes; and the optional term read, when implemented, answers exactly the
// rows on that term.
//
// Public surface: runMemoryBackendConformance(name, makeBackend),
// assertWireRow, buildFixtureRows, collectRows.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ROW_CLASSES, BOOKKEEPING_ROW_CLASS,
  BackendRejected, BackendUnavailable,
  isRowBackend, rowBackendProblems,
} from "../adapters/memory/row-backend.mjs";
import { rowsToPayload, bookkeepingRow, BOOKKEEPING_RESEARCH_QUEUE } from "../adapters/memory/rows.mjs";

/** `readRows()`/`readRowsByTerm()` may hand back a `Promise<row[]>` or an
 *  `AsyncIterable<row>` — this normalizes either into a plain array.
 *  Awaiting a non-thenable async-iterable is a documented no-op, so this
 *  works without knowing which shape a given backend chose. */
export async function collectRows(rowsOrIterable) {
  const value = await rowsOrIterable;
  if (Array.isArray(value)) return value;
  const collected = [];
  for await (const row of value) collected.push(row);
  return collected;
}

export function assertWireRow(row, where) {
  assert.ok(row && typeof row === "object", `${where}: a wire row`);
  assert.equal(typeof row.rowKey, "string", `${where}: rowKey is a string`);
  assert.ok(row.rowKey.length > 0, `${where}: rowKey is non-empty`);
  assert.ok(ROW_CLASSES.includes(row.rowClass), `${where}: rowClass "${row.rowClass}" is in the closed set`);
  assert.equal(typeof row.term, "string", `${where}: term is a string`);
  assert.equal(typeof row.json, "string", `${where}: json is a string`);
}

const byRowKey = (rows) => new Map(rows.map((row) => [row.rowKey, row]));

/** One row per closed `rowClass` — including `bookkeeping` and `edge-group`
 *  — plus a second `fact` row on a distinct term, so every check below has
 *  something to round-trip, exclude, or filter by term. Individuals carry a
 *  made-up class name: `rowsToPayload` only special-cases the real Fact
 *  class for supersession derivation, which none of these checks exercise,
 *  so an arbitrary class string keeps this module free of any dependence on
 *  `core.mjs`'s individual shapes beyond what the wire-row contract itself
 *  needs. */
export function buildFixtureRows() {
  const rows = [];
  let ord = 0;
  for (const rowClass of ROW_CLASSES) {
    if (rowClass === BOOKKEEPING_ROW_CLASS) {
      rows.push(bookkeepingRow(BOOKKEEPING_RESEARCH_QUEUE, "fixture", { note: "conformance fixture" }));
      continue;
    }
    if (rowClass === "edge-group") {
      rows.push({
        rowKey: "edge-group:fixture:prop",
        rowClass,
        term: "",
        json: JSON.stringify({ ord: ord++, group: { prop: "fixture:prop", examples: [] } }),
      });
      continue;
    }
    const term = rowClass === "fact" ? "alpha" : "";
    rows.push({
      rowKey: `fixture:${rowClass}:1`,
      rowClass,
      term,
      json: JSON.stringify({ ord: ord++, individual: { id: `fixture:${rowClass}:1`, class: rowClass, label: rowClass, attributes: [] } }),
    });
  }
  rows.push({
    rowKey: "fixture:fact:2",
    rowClass: "fact",
    term: "beta",
    json: JSON.stringify({ ord: ord++, individual: { id: "fixture:fact:2", class: "fact", label: "fact-2", attributes: [] } }),
  });
  return rows;
}

/** Wrap a real backend so one named row is refused by the WRAPPER itself,
 *  never reaching the backend's own `putRows` — the rest of the batch still
 *  goes through the real backend's own call. This is how the suite proves
 *  per-row atomicity without assuming anything about how a given backend's
 *  `putRows` behaves on invalid input: the wrapper is what rejects the
 *  poisoned row, and the check is whether the backend's OWN state still
 *  durably holds everything else. */
function poisonOneRow(backend, poisonRowKey) {
  return {
    ...backend,
    async putRows(candidateRows) {
      const rest = (candidateRows || []).filter((row) => row.rowKey !== poisonRowKey);
      const poisoned = (candidateRows || []).some((row) => row.rowKey === poisonRowKey);
      if (rest.length) await backend.putRows(rest);
      if (poisoned) throw new BackendRejected(`poisoned row ${poisonRowKey}`, { rowKey: poisonRowKey });
    },
  };
}

export function runMemoryBackendConformance(name, makeBackend) {
  test(`[${name}] advertises the row-backend contract`, () => {
    const backend = makeBackend();
    assert.equal(isRowBackend(backend), true, rowBackendProblems(backend).join("; "));
  });

  test(`[${name}] the exported failure classes carry stable names and codes`, () => {
    const rejected = new BackendRejected("refused");
    assert.ok(rejected instanceof Error);
    assert.equal(rejected.name, "BackendRejected");
    assert.equal(rejected.code, "TMCT_BACKEND_REJECTED");
    const unavailable = new BackendUnavailable("unreachable");
    assert.ok(unavailable instanceof Error);
    assert.equal(unavailable.name, "BackendUnavailable");
    assert.equal(unavailable.code, "TMCT_BACKEND_UNAVAILABLE");
  });

  test(`[${name}] every row class round-trips through putRows/readRows`, async () => {
    const backend = makeBackend();
    const fixture = buildFixtureRows();
    await backend.putRows(fixture);
    const got = byRowKey(await collectRows(backend.readRows()));
    for (const row of fixture) {
      const back = got.get(row.rowKey);
      assert.ok(back, `${row.rowKey} did not come back`);
      assertWireRow(back, row.rowKey);
      assert.equal(back.rowClass, row.rowClass);
      assert.equal(back.term, row.term);
      assert.equal(back.json, row.json);
    }
  });

  test(`[${name}] a bookkeeping row round-trips but never reaches the assembled answer`, async () => {
    const backend = makeBackend();
    const fixture = buildFixtureRows();
    await backend.putRows(fixture);
    const rows = await collectRows(backend.readRows());
    const bookkeepingRows = rows.filter((row) => row.rowClass === BOOKKEEPING_ROW_CLASS);
    assert.ok(bookkeepingRows.length > 0, "the fixture carries at least one bookkeeping row");
    const payload = rowsToPayload(rows);
    const answerFacingIds = new Set(payload.individuals.map((ind) => ind.id));
    for (const row of bookkeepingRows) assert.equal(answerFacingIds.has(row.rowKey), false, `${row.rowKey} leaked into the answer`);
  });

  test(`[${name}] meta scalars round-trip, and an unset key reads null`, async () => {
    const backend = makeBackend();
    assert.equal(await backend.readMeta("memory"), null);
    await backend.putMeta("memory", "chatty");
    await backend.putMeta("prefixes", JSON.stringify({ mgx: "urn:mgx:" }));
    assert.equal(await backend.readMeta("memory"), "chatty");
    assert.equal(await backend.readMeta("prefixes"), JSON.stringify({ mgx: "urn:mgx:" }));
    assert.equal(await backend.readMeta("neverSet"), null);
  });

  test(`[${name}] deleteRows leaves the deleted keys absent from every later read`, async () => {
    const backend = makeBackend();
    const fixture = buildFixtureRows();
    await backend.putRows(fixture);
    const [gone, ...kept] = fixture;
    await backend.deleteRows([gone.rowKey]);
    const rows = await collectRows(backend.readRows());
    assert.equal(rows.some((row) => row.rowKey === gone.rowKey), false);
    for (const row of kept) assert.ok(rows.some((r) => r.rowKey === row.rowKey), `${row.rowKey} should still be there`);
    // A missing key is a no-op, not a failure.
    await backend.deleteRows(["no-such-row-key"]);
  });

  test(`[${name}] deleteAll makes every row and meta entry absent`, async () => {
    const backend = makeBackend();
    await backend.putRows(buildFixtureRows());
    await backend.putMeta("memory", "chatty");
    await backend.putMeta("nodeId", "01890000-node");
    await backend.deleteAll();
    assert.deepEqual(await collectRows(backend.readRows()), []);
    assert.equal(await backend.readMeta("memory"), null);
    assert.equal(await backend.readMeta("nodeId"), null);
  });

  test(`[${name}] a batch carrying one refused row still leaves the good rows durable`, async () => {
    const backend = makeBackend();
    const [good1, good2, poison] = buildFixtureRows();
    const wrapped = poisonOneRow(backend, poison.rowKey);
    await assert.rejects(
      wrapped.putRows([good1, poison, good2]),
      (error) => {
        assert.ok(error instanceof BackendRejected, "the wrapper's own rejection is a BackendRejected");
        assert.equal(error.code, "TMCT_BACKEND_REJECTED");
        return true;
      },
    );
    const rows = await collectRows(backend.readRows());
    assert.ok(rows.some((row) => row.rowKey === good1.rowKey), "the first good row is durable on the real backend");
    assert.ok(rows.some((row) => row.rowKey === good2.rowKey), "the second good row is durable on the real backend");
    assert.equal(rows.some((row) => row.rowKey === poison.rowKey), false, "the poisoned row never reached the real backend");
  });

  test(`[${name}] one row set fed in two arrival orders assembles to the same payload`, async () => {
    const rows = buildFixtureRows();
    const forward = makeBackend();
    const backward = makeBackend();
    await forward.putRows(rows);
    await backward.putRows([...rows].reverse());

    const forwardRows = await collectRows(forward.readRows());
    const backwardRows = await collectRows(backward.readRows());
    assert.deepEqual(
      [...forwardRows].sort((a, b) => (a.rowKey < b.rowKey ? -1 : 1)),
      [...backwardRows].sort((a, b) => (a.rowKey < b.rowKey ? -1 : 1)),
      "the same row set, whatever order it arrived in, reads back as the same rows",
    );
    assert.deepStrictEqual(rowsToPayload(forwardRows), rowsToPayload(backwardRows));
  });

  test(`[${name}] readRowsByTerm, when implemented, answers exactly the rows on that term`, async () => {
    const backend = makeBackend();
    if (typeof backend.readRowsByTerm !== "function") return; // optional per the §3.1 contract
    const rows = buildFixtureRows();
    await backend.putRows(rows);
    const expected = rows.filter((row) => row.term === "alpha").map((row) => row.rowKey).sort();
    const got = (await collectRows(backend.readRowsByTerm("alpha"))).map((row) => row.rowKey).sort();
    assert.deepEqual(got, expected);
  });
}
