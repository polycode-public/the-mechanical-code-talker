// The row projection (memory/rows.mjs) and the backend contract it writes for
// (memory/row-backend.mjs). What this suite holds the projection to:
//
//   - a seeded store round-trips: every individual, every edge group and every
//     derived field comes back, and re-projecting the assembled payload is a
//     fixed point;
//   - assembly is a pure function of the row set — one row set fed in two
//     orders builds the same payload;
//   - supersession is additive: the superseded record's row carries no backward
//     pointer, assembly derives it, and two conflicting supersessions both land;
//   - the per-row cap fails at projection time with the offending fact's
//     provenance, or logs and skips under the drop posture;
//   - diffRows writes only what moved, for an append, a supersession and a
//     retraction.

import test from "node:test";
import assert from "node:assert/strict";

import {
  createInMemoryStore, loadMemory,
  appendUtterances, appendFacts, appendRule, removeFacts,
  RULE_KIND_COMPOSE2, FACT_CLASS,
} from "../../src/adapters/memory/core.mjs";
import {
  payloadToRows, rowsToPayload, diffRows, payloadMeta,
  bookkeepingRow, bookkeepingEntries, BOOKKEEPING_RESEARCH_QUEUE,
} from "../../src/adapters/memory/rows.mjs";
import {
  BackendRejected, BackendUnavailable, isRowBackend, rowBackendProblems,
  isValidRow, rowProblems, assertValidRow,
  MAX_ROW_BYTES, ROW_CLASSES, ROW_BACKEND_KIND, ROW_BACKEND_CONTRACT_VERSION,
} from "../../src/adapters/memory/row-backend.mjs";

const SESSION = "01890000-0000-7000-8000-00000000beef";
const T1 = "2026-07-10T10:00:00.000Z";
const T2 = "2026-07-10T10:01:00.000Z";
const T3 = "2026-07-11T10:00:00.000Z";

const teach = (at) => `teach:chat:${SESSION}@${at}`;

/** A store holding one of every individual class the memory graph mints, plus
 *  the edge groups those writes draw. */
async function seededStore() {
  const dir = createInMemoryStore();
  await appendUtterances(dir, [
    { role: "visitor", text: "does a man have a hat?", ts: T1, sessionId: SESSION, sessionStarted: T1 },
    { role: "tmct", text: "a man does have a hat.", ts: T2, sessionId: SESSION },
  ]);
  await appendFacts(dir, [
    { subject: "man", predicate: "IsA", object: "person", provenance: teach(T1), createdAt: T1 },
    { subject: "hat", predicate: "IsA", object: "clothing", provenance: teach(T1), createdAt: T1 },
    { subject: "kim", predicate: "isIn", object: "hall", provenance: teach(T1), createdAt: T1 },
  ]);
  await appendRule(dir, {
    name: "grandparent", kind: RULE_KIND_COMPOSE2,
    slots: { base1: "parentOf", base2: "parentOf" },
    provenance: teach(T1), createdAt: T1,
  });
  return dir;
}

/** The same store after one source re-asserts a triple it already stated with a
 *  newer embedded timestamp, which demotes its own earlier record to a leaf. */
async function supersededStore() {
  const dir = await seededStore();
  await appendFacts(dir, [
    { subject: "kim", predicate: "isIn", object: "hall", provenance: teach(T3), createdAt: T3 },
  ]);
  return dir;
}

const byId = (individuals) => new Map(individuals.map((i) => [i.id, i]));
const rowFor = (rows, rowKey) => rows.find((r) => r.rowKey === rowKey);
const recordOf = (row) => JSON.parse(row.json);
const attrValue = (ind, prop) => (ind.attributes || []).find((a) => a.prop === prop)?.value || "";
const factsOf = (payload) => payload.individuals.filter((i) => i.class === FACT_CLASS);

// ---- classification ---------------------------------------------------------

test("every individual class in the store projects onto its own row class, and each edge group onto one row", async () => {
  const dir = await seededStore();
  const hat = factsOf(await loadMemory(dir)).find((f) => attrValue(f, "rdf:subject") === "hat");
  await removeFacts(dir, [hat.id], { provenance: teach(T2), retractedAt: T2 });
  const payload = await loadMemory(dir);
  const rows = payloadToRows(payload);

  const classesSeen = new Set(rows.map((r) => r.rowClass));
  assert.deepEqual(
    [...classesSeen].sort(),
    ["edge-group", "fact", "retraction", "rule", "session", "source", "utterance"],
  );
  for (const rowClass of classesSeen) assert.ok(ROW_CLASSES.includes(rowClass), `${rowClass} is outside the closed set`);

  const groupRows = rows.filter((r) => r.rowClass === "edge-group");
  assert.equal(groupRows.length, payload.objectProperties.length);
  for (const group of payload.objectProperties) assert.ok(rowFor(rows, `edge-group:${group.prop}`), `no row for ${group.prop}`);

  const individualRows = rows.filter((r) => r.rowClass !== "edge-group");
  assert.equal(individualRows.length, payload.individuals.length);
  for (const row of individualRows) assert.ok(isValidRow(row), rowProblems(row).join("; "));
});

test("a fact row is keyed on the assertion record id and indexed on its normalized subject term", async () => {
  const dir = await seededStore();
  const payload = await loadMemory(dir);
  const rows = payloadToRows(payload);

  for (const fact of factsOf(payload)) {
    const row = rowFor(rows, fact.id);
    assert.ok(row, `no row for ${fact.id}`);
    assert.equal(row.rowClass, "fact");
    assert.equal(row.term, attrValue(fact, "rdf:subject"));
    assert.ok(fact.id.includes("@"), "a record id names the asserting source");
  }
  assert.deepEqual(
    rows.filter((r) => r.rowClass !== "fact").map((r) => r.term),
    rows.filter((r) => r.rowClass !== "fact").map(() => ""),
  );
});

test("an individual whose class no row class covers is refused, naming the individual", () => {
  const payload = { individuals: [{ id: "widget:1", class: "Widget", attributes: [] }], objectProperties: [] };
  assert.throws(() => payloadToRows(payload), (error) => {
    assert.ok(error instanceof BackendRejected);
    assert.equal(error.code, "TMCT_BACKEND_REJECTED");
    assert.match(error.message, /widget:1/);
    assert.match(error.message, /Widget/);
    return true;
  });
});

// ---- round trip -------------------------------------------------------------

test("a seeded payload round-trips: every individual, every edge group and every derived field come back", async () => {
  const dir = await seededStore();
  const payload = await loadMemory(dir);
  const meta = payloadMeta(payload);
  const back = rowsToPayload(payloadToRows(payload), { meta });

  const before = byId(payload.individuals);
  const after = byId(back.individuals);
  assert.deepEqual([...after.keys()].sort(), [...before.keys()].sort());
  for (const [id, individual] of before) assert.deepStrictEqual(after.get(id), individual);

  assert.deepStrictEqual(back.objectProperties, payload.objectProperties);
  assert.deepStrictEqual(back.prefixes, payload.prefixes);
  assert.deepStrictEqual(back.vocabulary, payload.vocabulary);
  assert.deepStrictEqual(back.proseIndex, payload.proseIndex);
  assert.equal(back.memory, payload.memory);
  assert.equal(back.generated_at, T2, "generated_at is the latest utterance timestamp the store holds");
  assert.equal(back.generated_at, payload.generated_at);
  assert.deepEqual(
    back.classes.map((c) => [c.name, c.count]),
    payload.classes.map((c) => [c.name, c.count]),
  );

  const again = rowsToPayload(payloadToRows(back), { meta: payloadMeta(back) });
  assert.deepStrictEqual(again, back, "re-projecting an assembled payload is a fixed point");
});

test("assembly is a pure function of the row set: one row set in two orders builds the same payload", async () => {
  const dir = await supersededStore();
  const payload = await loadMemory(dir);
  const rows = payloadToRows(payload);

  const reversed = [...rows].reverse();
  const shuffled = [...rows].sort((a, b) => (a.rowKey > b.rowKey ? -1 : 1));
  const first = rowsToPayload(rows);
  assert.deepStrictEqual(rowsToPayload(reversed), first);
  assert.deepStrictEqual(rowsToPayload(shuffled), first);
});

test("Fact individuals come back in content-addressed id order whatever order their rows arrived in", async () => {
  const dir = await seededStore();
  const payload = await loadMemory(dir);
  const rows = payloadToRows(payload);
  const ids = factsOf(rowsToPayload(rows)).map((f) => f.id);
  assert.deepEqual(ids, [...ids].sort());
  assert.deepEqual(factsOf(rowsToPayload([...rows].reverse())).map((f) => f.id), ids);
});

// ---- supersession is additive -----------------------------------------------

test("a superseded record stores no backward pointer, and assembly derives it from the forward one", async () => {
  const dir = await supersededStore();
  const payload = await loadMemory(dir);
  const leaf = payload.individuals.find((i) => i.id.endsWith("#v1"));
  const head = payload.individuals.find((i) => i.id === leaf.id.replace(/#v1$/, ""));
  assert.equal(attrValue(leaf, "mgx:supersededBy"), head.id, "the store stamps both ends today");

  const rows = payloadToRows(payload);
  const storedLeaf = recordOf(rowFor(rows, leaf.id)).individual;
  assert.equal(
    storedLeaf.attributes.some((a) => a.prop === "mgx:supersededBy"), false,
    "the stored row carries the forward pointer only",
  );
  assert.equal(attrValue(recordOf(rowFor(rows, head.id)).individual, "mgx:supersedes"), leaf.id);

  const assembledLeaf = byId(rowsToPayload(rows).individuals).get(leaf.id);
  assert.equal(attrValue(assembledLeaf, "mgx:supersededBy"), head.id);
  assert.equal(
    assembledLeaf.attributes.at(-1).prop, "mgx:supersededBy",
    "the derived pointer is re-attached last; every other attribute keeps its place",
  );
  assert.deepStrictEqual(
    assembledLeaf.attributes.slice(0, -1),
    leaf.attributes.filter((a) => a.prop !== "mgx:supersededBy"),
  );
});

test("two writers superseding the same record concurrently both land, and assembly applies both", async () => {
  const dir = await supersededStore();
  const payload = await loadMemory(dir);
  const leaf = payload.individuals.find((i) => i.id.endsWith("#v1"));
  const head = payload.individuals.find((i) => i.id === leaf.id.replace(/#v1$/, ""));

  const rows = payloadToRows(payload);
  const headRow = rowFor(rows, head.id);
  const rival = recordOf(headRow);
  rival.individual = {
    ...rival.individual,
    id: `${head.id.split("@")[0]}@src:teach-chat:other`,
    attributes: rival.individual.attributes.map((a) => ({ ...a })),
  };
  const rivalRow = { ...headRow, rowKey: rival.individual.id, json: JSON.stringify(rival) };

  const assembled = rowsToPayload([...rows, rivalRow]);
  const assembledLeaf = byId(assembled.individuals).get(leaf.id);
  assert.deepEqual(
    attrValue(assembledLeaf, "mgx:supersededBy").split(" ").sort(),
    [head.id, rival.individual.id].sort(),
  );
  assert.deepStrictEqual(
    recordOf(rowFor(rows, leaf.id)), recordOf(rowFor(payloadToRows(payload), leaf.id)),
    "neither supersession rewrote the record they replaced",
  );
});

// ---- bookkeeping ------------------------------------------------------------

test("a bookkeeping row round-trips through the row set but never reaches the assembled payload", async () => {
  const dir = await seededStore();
  const payload = await loadMemory(dir);
  const rows = payloadToRows(payload);
  const queued = bookkeepingRow(BOOKKEEPING_RESEARCH_QUEUE, "tariff", { state: "pending", depth: 1 });

  assert.equal(queued.rowClass, "bookkeeping");
  assert.equal(queued.term, "");
  assert.ok(isValidRow(queued), rowProblems(queued).join("; "));

  const withBookkeeping = [...rows, queued];
  assert.deepEqual(bookkeepingEntries(withBookkeeping, BOOKKEEPING_RESEARCH_QUEUE), [
    { rowKey: queued.rowKey, kind: BOOKKEEPING_RESEARCH_QUEUE, key: "tariff", value: { state: "pending", depth: 1 } },
  ]);
  assert.deepEqual(bookkeepingEntries(rows), []);
  assert.deepStrictEqual(rowsToPayload(withBookkeeping), rowsToPayload(rows));
});

// ---- the per-row cap --------------------------------------------------------

/** A seeded store with one fact grown past the cap — a pathological extraction
 *  in the shape the store would actually hold it. */
async function payloadWithOneOversizedFact() {
  const payload = await loadMemory(await seededStore());
  const oversized = factsOf(payload).find((f) => attrValue(f, "rdf:subject") === "man");
  oversized.attributes.push({
    prop: "mgx:factJustification", key: "justification", value: "premise ".repeat(MAX_ROW_BYTES / 4),
  });
  return { payload, oversized };
}

test("an oversized row is refused at projection time, naming the offending fact's provenance", async () => {
  const { payload } = await payloadWithOneOversizedFact();
  assert.throws(() => payloadToRows(payload), (error) => {
    assert.ok(error instanceof BackendRejected);
    assert.equal(error.code, "TMCT_BACKEND_REJECTED");
    assert.equal(error.rowClass, "fact");
    assert.equal(error.provenance, teach(T1));
    assert.match(error.message, new RegExp(`${MAX_ROW_BYTES}-byte cap`));
    return true;
  });
});

test("under the drop posture the oversized row is logged and skipped, and the rest of the batch still projects", async () => {
  const { payload, oversized } = await payloadWithOneOversizedFact();
  const logged = [];
  const rows = payloadToRows(payload, { onOversizedRow: "drop", log: (line) => logged.push(line) });

  assert.equal(logged.length, 1);
  assert.match(logged[0], /dropped an oversized memory row/);
  assert.ok(logged[0].includes(teach(T1)), "the drop notice names the provenance");

  assert.equal(rowFor(rows, oversized.id), undefined);
  for (const fact of factsOf(payload)) {
    if (fact.id === oversized.id) continue;
    assert.ok(rowFor(rows, fact.id), `${fact.id} should still project`);
  }
  assert.equal(rows.length, payload.individuals.length + payload.objectProperties.length - 1);
  for (const row of rows) assert.ok(isValidRow(row), rowProblems(row).join("; "));
});

test("payloadToRows takes only the two documented oversize postures", async () => {
  const payload = await loadMemory(await seededStore());
  assert.throws(() => payloadToRows(payload, { onOversizedRow: "ignore" }), TypeError);
});

// ---- diffRows ---------------------------------------------------------------

/** Every put really did change: diffRows must never re-write a row whose stored
 *  bytes are the ones already there. */
function assertEveryPutMoved(before, puts) {
  for (const row of puts) {
    const prior = before.find((r) => r.rowKey === row.rowKey);
    if (prior) assert.notEqual(prior.json, row.json, `${row.rowKey} was written unchanged`);
  }
}

test("an append writes the new fact's row and leaves the rows the store never touched alone", async () => {
  const dir = await seededStore();
  const before = payloadToRows(await loadMemory(dir));
  await appendFacts(dir, [
    { subject: "dog", predicate: "IsA", object: "mammal", provenance: teach(T2), createdAt: T2 },
  ]);
  const after = payloadToRows(await loadMemory(dir), { priorRows: before });
  const { puts, deletes } = diffRows(before, after);

  assert.deepEqual(deletes, []);
  const added = puts.find((r) => r.term === "dog");
  assert.ok(added, "the new fact projects a row of its own");
  assert.equal(before.find((r) => r.rowKey === added.rowKey), undefined);
  assert.deepEqual(
    puts.filter((r) => ["utterance", "session"].includes(r.rowClass)).map((r) => r.rowKey), [],
    "an utterance carries no trust, so nothing about it moved",
  );
  assertEveryPutMoved(before, puts);
});

test("a supersession writes the demoted leaf as a new row and never rewrites the record it replaced", async () => {
  const dir = await seededStore();
  const before = payloadToRows(await loadMemory(dir));
  await appendFacts(dir, [
    { subject: "kim", predicate: "isIn", object: "hall", provenance: teach(T3), createdAt: T3 },
  ]);
  const after = payloadToRows(await loadMemory(dir), { priorRows: before });
  const { puts, deletes } = diffRows(before, after);

  assert.deepEqual(deletes, []);
  const leaf = puts.find((r) => r.rowKey.endsWith("#v1"));
  assert.ok(leaf, "the demoted leaf is a new row of its own");
  assert.equal(before.find((r) => r.rowKey === leaf.rowKey), undefined);
  assert.equal(
    recordOf(leaf).individual.attributes.some((a) => a.prop === "mgx:supersededBy"), false,
    "the leaf row stores no backward pointer for a later writer to clobber",
  );
  assertEveryPutMoved(before, puts);
});

test("a row whose only change is the derived backward pointer diffs as unchanged", async () => {
  const dir = await seededStore();
  const payload = await loadMemory(dir);
  const before = payloadToRows(payload);

  const fact = factsOf(payload)[0];
  fact.attributes.push({ prop: "mgx:supersededBy", key: "supersededBy", value: "fact:deadbeef@src:teach-chat:other" });
  const after = payloadToRows(payload, { priorRows: before });

  assert.deepEqual(diffRows(before, after), { puts: [], deletes: [] });
});

test("a retraction deletes the retracted record's row and writes the tombstone as its own row", async () => {
  const dir = await seededStore();
  const before = payloadToRows(await loadMemory(dir));
  const retracted = factsOf(await loadMemory(dir)).find((f) => attrValue(f, "rdf:subject") === "hat");
  await removeFacts(dir, [retracted.id], { provenance: teach(T2), retractedAt: T2 });
  const after = payloadToRows(await loadMemory(dir), { priorRows: before });
  const { puts, deletes } = diffRows(before, after);

  assert.deepEqual(deletes, [retracted.id]);
  const retractionRows = puts.filter((r) => r.rowClass === "retraction");
  assert.equal(retractionRows.length, 1);
  assert.equal(before.find((r) => r.rowKey === retractionRows[0].rowKey), undefined);
  assertEveryPutMoved(before, puts);
});

test("diffRows over an empty prior set is a full write, and an empty new set a full delete", async () => {
  const rows = payloadToRows(await loadMemory(await seededStore()));
  assert.deepEqual(diffRows([], rows), { puts: rows, deletes: [] });
  assert.deepEqual(diffRows(rows, []), { puts: [], deletes: rows.map((r) => r.rowKey) });
});

// ---- the contract -----------------------------------------------------------

const stubBackend = (overrides = {}) => ({
  kind: ROW_BACKEND_KIND,
  contractVersion: ROW_BACKEND_CONTRACT_VERSION,
  readRows: async () => [],
  putRows: async () => {},
  deleteRows: async () => {},
  readMeta: async () => null,
  putMeta: async () => {},
  deleteAll: async () => {},
  close: async () => {},
  ...overrides,
});

test("isRowBackend accepts a complete duck and names what a partial one is missing", () => {
  assert.equal(isRowBackend(stubBackend()), true);
  assert.equal(isRowBackend(stubBackend({ readRowsByTerm: async () => [] })), true, "the term read is optional");
  assert.equal(isRowBackend(null), false);
  assert.equal(isRowBackend("sqlite"), false);
  assert.equal(isRowBackend(stubBackend({ kind: "something-else" })), false);
  assert.equal(isRowBackend(stubBackend({ contractVersion: 2 })), false);

  const { putRows, ...noPutRows } = stubBackend();
  assert.deepEqual(rowBackendProblems(noPutRows), ["putRows() is missing"]);
  assert.deepEqual(rowBackendProblems(stubBackend({ readRowsByTerm: "yes" })), ["readRowsByTerm is present but not a function"]);
});

test("both failure classes carry their stable code, so a caller never matches on a message", () => {
  const rejected = new BackendRejected("too big", { rowKey: "fact:1@src:x", provenance: "teach:chat:s@t" });
  assert.ok(rejected instanceof Error);
  assert.equal(rejected.name, "BackendRejected");
  assert.equal(rejected.code, "TMCT_BACKEND_REJECTED");
  assert.equal(rejected.rowKey, "fact:1@src:x");
  assert.equal(rejected.provenance, "teach:chat:s@t");

  const cause = new Error("socket hang up");
  const unavailable = new BackendUnavailable("store unreachable", { cause, status: 503 });
  assert.equal(unavailable.name, "BackendUnavailable");
  assert.equal(unavailable.code, "TMCT_BACKEND_UNAVAILABLE");
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.cause, cause);
});

test("the row validator holds every wire field to its shape and the cap", () => {
  const valid = { rowKey: "fact:1@src:x", rowClass: "fact", term: "tariff", json: "{}" };
  assert.deepEqual(rowProblems(valid), []);
  assert.equal(assertValidRow(valid), valid);
  assert.deepEqual(rowProblems({ ...valid, expiresAt: 1739145600 }), []);

  assert.deepEqual(rowProblems({ ...valid, rowKey: "" }), ["rowKey must be a non-empty string"]);
  assert.deepEqual(rowProblems({ ...valid, term: null }), ["term must be a string, empty when the row has no term read path"]);
  assert.deepEqual(rowProblems({ ...valid, expiresAt: 1.5 }), ["expiresAt must be epoch seconds as an integer when present"]);
  assert.match(rowProblems({ ...valid, rowClass: "widget" })[0], /outside the closed set/);
  assert.match(rowProblems({ ...valid, json: "x".repeat(MAX_ROW_BYTES + 1) })[0], new RegExp(`over the ${MAX_ROW_BYTES}-byte cap`));

  assert.throws(() => assertValidRow({ ...valid, rowClass: "widget" }), (error) => {
    assert.ok(error instanceof BackendRejected);
    assert.equal(error.code, "TMCT_BACKEND_REJECTED");
    return true;
  });
});
