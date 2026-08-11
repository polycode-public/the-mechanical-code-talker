// Backend D — a consumer's own row store bound as a memoryDir token. What this
// suite holds the dispatch to:
//
//   - one readRows() per cold open, then no backend reads at all;
//   - a mutate writes the delta and nothing else, and the cache it leaves
//     behind matches what a fresh handle would assemble;
//   - the two scalar sidecars land in meta, and the research queue lands as
//     rows, one per title;
//   - a seed overlay is read-only: putRows never receives a seed row, whether
//     the seed arrives as a parsed payload or as an open sqlite store;
//   - two live handles racing on one store both land, supersessions included;
//   - a row-backed session answers the same taught turns as a sqlite-backed
//     one, so this is a storage seam and not a behaviour change.

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  wrapRowBackend, wrapRowBackendOverSqliteSeed, isRowHandle, isMemoryOrSqliteHandle, openMemoryBackend,
  createInMemoryStore, readOnlyMemorySnapshot, resolveMemoryGraphFile,
  createSqliteMemoryStore, closeSqliteMemoryStore, openSqliteSeedStore, sqliteSeedFactTermValues,
  loadMemory, appendFact, appendFacts, appendUtterances, removeFacts, readFactRows,
  loadSyllogiseState, saveSyllogiseState, loadNodeId, saveNodeId,
  BackendRejected, FACT_CLASS,
} from "../../src/adapters/memory/core.mjs";
import { createRowMemoryBackend } from "../../src/adapters/memory/row-backend-memory.mjs";
import { payloadToRows, bookkeepingEntries, BOOKKEEPING_RESEARCH_QUEUE } from "../../src/adapters/memory/rows.mjs";
import {
  loadResearchQueue, saveResearchQueue, clearResearchQueue,
  loadResearchedTerms, markTermResearched,
} from "../../src/adapters/research-queue-store.mjs";
import { createSession } from "../../src/services/chat.mjs";
import { clearCache } from "../../src/adapters/source.mjs";

const SESSION = "01890000-0000-7000-8000-0000000000d4";
const OTHER = "01890000-0000-7000-8000-0000000000e5";
const T1 = "2026-07-10T10:00:00.000Z";
const T2 = "2026-07-10T10:01:00.000Z";
const T3 = "2026-07-11T10:00:00.000Z";
const T4 = "2026-07-12T10:00:00.000Z";

const teach = (at) => `teach:chat:${SESSION}@${at}`;
const ace = (at) => `ace:chat:${OTHER}@${at}`;
const attrValue = (ind, prop) => (ind?.attributes || []).find((a) => a?.prop === prop)?.value || "";
const factOf = (payload, id) => payload.individuals.find((i) => i.id === id);

/** A reference backend that counts what core asked of it. */
function spyBackend(inner = createRowMemoryBackend()) {
  const calls = { readRows: 0, putRows: [], deleteRows: [], putMeta: [], close: 0 };
  return {
    calls,
    inner,
    backend: {
      ...inner,
      async readRows() { calls.readRows += 1; return inner.readRows(); },
      async putRows(rows) { calls.putRows.push(rows.map((r) => r.rowKey)); return inner.putRows(rows); },
      async deleteRows(keys) { calls.deleteRows.push([...keys]); return inner.deleteRows(keys); },
      async putMeta(key, value) { calls.putMeta.push(key); return inner.putMeta(key, value); },
      async close() { calls.close += 1; return inner.close(); },
    },
  };
}

const lastWrite = (spy) => spy.calls.putRows.at(-1) || [];
const factRowKeys = async (impl) => (await impl.readRows()).filter((r) => r.rowClass === "fact").map((r) => r.rowKey);

// ---- the handle -------------------------------------------------------------

test("a row backend binds as a store handle, and every path that needs a file refuses it by name", () => {
  const handle = wrapRowBackend(createRowMemoryBackend());
  assert.equal(handle.backend, "row");
  assert.equal(isRowHandle(handle), true);
  assert.equal(isMemoryOrSqliteHandle(handle), true, "the raw-path guard covers a row handle too");
  assert.throws(() => resolveMemoryGraphFile(handle), /not a file path/);
  assert.equal(isRowHandle(createInMemoryStore()), false);
  assert.equal(isRowHandle("/some/repo"), false);
});

test("wrapping something that is not a row backend refuses by naming what is missing", () => {
  assert.throws(
    () => wrapRowBackend({ kind: "tmct-memory-row-backend", contractVersion: 1, readRows() {} }),
    (e) => e instanceof BackendRejected && /putRows\(\) is missing/.test(e.message),
  );
});

test("openMemoryBackend takes a backend object as the choice and never touches the repo path", async () => {
  const spy = spyBackend();
  const { dir, close } = await openMemoryBackend("/no/such/repo", spy.backend);
  assert.equal(dir.backend, "row");
  assert.equal(dir.impl, spy.backend, "the injected store is bound as-is");
  await close();
  assert.equal(spy.calls.close, 1, "session teardown closes the injected store");
});

test("openMemoryBackend passes an already-wrapped handle straight through, seed overlay intact", async () => {
  const spy = spyBackend();
  const handle = wrapRowBackend(spy.backend, { basePayload: { memory: true, individuals: [], objectProperties: [] } });
  const { dir, close } = await openMemoryBackend("/no/such/repo", handle);
  assert.equal(dir, handle);
  await close();
  assert.equal(spy.calls.close, 1);
});

// ---- reads and the delta write ---------------------------------------------

test("a cold load reads the store once, and every later read is served from the handle", async () => {
  const spy = spyBackend();
  const dir = wrapRowBackend(spy.backend);
  await loadMemory(dir);
  await loadMemory(dir);
  await loadMemory(dir);
  assert.equal(spy.calls.readRows, 1, "one readRows for the cold open, none after it");
});

test("a mutate writes only the rows that moved, and the scalars go to meta", async () => {
  const spy = spyBackend();
  const dir = wrapRowBackend(spy.backend);
  await appendFacts(dir, [
    { subject: "man", predicate: "IsA", object: "person", provenance: teach(T1), createdAt: T1 },
    { subject: "hat", predicate: "IsA", object: "clothing", provenance: teach(T1), createdAt: T1 },
  ]);
  const firstWrite = lastWrite(spy);
  assert.ok(firstWrite.length >= 3, "the two facts plus their source land on the first write");

  // A second source's fact leaves the first source's facts alone. Their audit
  // stamps move on every mutate; nothing a store needs to hear about does.
  await appendFact(dir, { subject: "kim", predicate: "isIn", object: "hall", provenance: ace(T2), createdAt: T2 });
  const secondWrite = lastWrite(spy);
  assert.equal(
    secondWrite.filter((k) => k.startsWith("fact:")).length, 1,
    `only the new fact's row is written, got ${secondWrite.join(", ")}`,
  );
  assert.equal(
    secondWrite.some((k) => firstWrite.includes(k) && k.startsWith("fact:")), false,
    "no fact row from the first turn is rewritten by the second",
  );
  assert.deepEqual([...new Set(spy.calls.putMeta)].sort(), ["memory", "prefixes"]);

  // Re-teaching what the store already holds moves no record. The statedBy
  // group still travels: re-asserting an edge moves it to the end of its
  // group, and that order is recency by design.
  spy.calls.putRows.length = 0;
  await appendFact(dir, { subject: "man", predicate: "IsA", object: "person", provenance: teach(T1), createdAt: T1 });
  assert.deepEqual(
    spy.calls.putRows.flat().filter((k) => k.startsWith("fact:")), [],
    "an idempotent re-teach rewrites no fact row",
  );
});

test("a removal deletes the rows it retired and writes the tombstone, nothing else", async () => {
  const spy = spyBackend();
  const dir = wrapRowBackend(spy.backend);
  await appendFacts(dir, [
    { subject: "man", predicate: "IsA", object: "person", provenance: teach(T1), createdAt: T1 },
    { subject: "hat", predicate: "IsA", object: "clothing", provenance: teach(T1), createdAt: T1 },
  ]);
  const before = await loadMemory(dir);
  const doomed = readFactRows(before).find((r) => r.subject === "hat");
  spy.calls.putRows.length = 0;
  spy.calls.deleteRows.length = 0;

  await removeFacts(dir, [doomed.id], { provenance: teach(T2), retractedAt: T2 });

  const deleted = spy.calls.deleteRows.flat();
  assert.ok(deleted.length >= 1, "the retired record's row is deleted");
  assert.ok(deleted.every((k) => !k.includes("man")), "the untouched fact keeps its row");
  const after = readFactRows(await loadMemory(dir));
  assert.deepEqual(after.map((r) => r.subject), ["man"]);
});

test("the handle's cached payload is what a fresh handle assembles from the same store", async () => {
  const impl = createRowMemoryBackend();
  const dir = wrapRowBackend(impl);
  await appendUtterances(dir, [
    { role: "visitor", text: "does a man have a hat?", ts: T1, sessionId: SESSION, sessionStarted: T1 },
    { role: "tmct", text: "a man does have a hat.", ts: T2, sessionId: SESSION },
  ]);
  await appendFacts(dir, [
    { subject: "man", predicate: "IsA", object: "person", provenance: teach(T1), createdAt: T1 },
  ]);
  const warm = await loadMemory(dir);
  const cold = await loadMemory(wrapRowBackend(impl));
  assert.deepStrictEqual(cold, warm, "no divergence between the cache and a rebuild");
});

test("a failed write drops the cache so the next read rebuilds from the store", async () => {
  const spy = spyBackend();
  const dir = wrapRowBackend(spy.backend);
  await appendFact(dir, { subject: "man", predicate: "IsA", object: "person", provenance: teach(T1), createdAt: T1 });
  spy.calls.readRows = 0;
  spy.backend.putRows = async () => { throw new Error("the store said no"); };

  await assert.rejects(
    appendFact(dir, { subject: "hat", predicate: "IsA", object: "clothing", provenance: teach(T2), createdAt: T2 }),
    /the store said no/,
  );
  spy.backend.putRows = async (rows) => spy.inner.putRows(rows);
  const rebuilt = readFactRows(await loadMemory(dir));
  assert.equal(spy.calls.readRows, 1, "the next read went back to the store");
  assert.deepEqual(rebuilt.map((r) => r.subject), ["man"], "only what actually landed is there");
});

test("readOnlyMemorySnapshot over a row handle answers from the real rows and writes nothing back", async () => {
  const spy = spyBackend();
  const dir = wrapRowBackend(spy.backend);
  await appendFact(dir, { subject: "man", predicate: "IsA", object: "person", provenance: teach(T1), createdAt: T1 });
  const writesBefore = spy.calls.putRows.length;

  const snapshot = await readOnlyMemorySnapshot(dir);
  await appendFact(snapshot, { subject: "hat", predicate: "IsA", object: "clothing", provenance: teach(T2), createdAt: T2 });

  assert.deepEqual(readFactRows(await loadMemory(snapshot)).map((r) => r.subject).sort(), ["hat", "man"]);
  assert.deepEqual(readFactRows(await loadMemory(dir)).map((r) => r.subject), ["man"]);
  assert.equal(spy.calls.putRows.length, writesBefore, "the reader's own write never reached the store");
});

// ---- the sidecars -----------------------------------------------------------

test("the syllogise watermark and the node id round-trip through the store's meta", async () => {
  const spy = spyBackend();
  const dir = wrapRowBackend(spy.backend);
  assert.equal(await loadSyllogiseState(dir), null);
  assert.equal(await loadNodeId(dir), null);

  const state = { version: 2, factIds: ["fact:aaaa", "fact:bbbb"], completedAt: T1 };
  await saveSyllogiseState(dir, state);
  await saveNodeId(dir, "0123456789abcdef");

  assert.deepEqual(await loadSyllogiseState(dir), state);
  assert.equal(await loadNodeId(dir), "0123456789abcdef");
  assert.deepEqual(await loadSyllogiseState(wrapRowBackend(spy.backend)), state, "a second handle reads the same watermark");
  assert.equal(spy.calls.putRows.length, 0, "a scalar sidecar never becomes a row");
});

test("the research queue lands as one bookkeeping row per title, never as a meta blob", async () => {
  const spy = spyBackend();
  const dir = wrapRowBackend(spy.backend);
  const run = {
    topic: "tariff", key: "tariff", title: "Tariff", limit: 3, maxDepth: 1, maxTopics: 12,
    pending: ["Customs", "Import"], depths: { customs: 1, import: 1 },
    done: [{ title: "Tariff", facts: 4, depth: 0 }], skipped: [], nodeCapReached: false,
  };
  await saveResearchQueue(dir, run);

  const stored = await spy.inner.readRows();
  const entries = bookkeepingEntries(stored, BOOKKEEPING_RESEARCH_QUEUE);
  assert.equal(entries.length, 4, "the run's own row plus one row per title");
  assert.ok(stored.every((r) => r.rowClass !== "bookkeeping" || r.term === ""), "a bookkeeping row carries no index term");
  assert.deepEqual(await loadResearchQueue(dir), run);
  assert.deepEqual(
    readFactRows(await loadMemory(wrapRowBackend(spy.backend))), [],
    "no bookkeeping row ever composes into an answer",
  );

  const stepped = { ...run, pending: ["Import"], done: [...run.done, { title: "Customs", facts: 2, depth: 1 }], depths: { import: 1 } };
  await saveResearchQueue(dir, stepped);
  assert.deepEqual(await loadResearchQueue(dir), stepped, "a stepped queue reads back stepped");

  await clearResearchQueue(dir);
  assert.equal(await loadResearchQueue(dir), null);
  assert.deepEqual(bookkeepingEntries(await spy.inner.readRows(), BOOKKEEPING_RESEARCH_QUEUE), []);
});

test("two turns stepping one queue at the same time both land", async () => {
  const impl = createRowMemoryBackend();
  const dir = wrapRowBackend(impl);
  const run = {
    topic: "tariff", key: "tariff", title: "Tariff", limit: 3, maxDepth: 1, maxTopics: 12,
    pending: ["Customs", "Import"], depths: { customs: 1, import: 1 },
    done: [{ title: "Tariff", facts: 4, depth: 0 }], skipped: [], nodeCapReached: false,
  };
  await saveResearchQueue(dir, run);

  // Each turn holds its own snapshot and marks its own title done.
  const first = await loadResearchQueue(dir);
  const second = await loadResearchQueue(dir);
  await saveResearchQueue(dir, {
    ...first, pending: ["Import"], depths: { import: 1 },
    done: [...first.done, { title: "Customs", facts: 2, depth: 1 }],
  });
  await saveResearchQueue(dir, {
    ...second, pending: ["Customs"], depths: { customs: 1 },
    done: [...second.done, { title: "Import", facts: 5, depth: 1 }],
  });

  const merged = await loadResearchQueue(dir);
  assert.deepEqual(merged.done.map((d) => d.title).sort(), ["Customs", "Import", "Tariff"],
    "neither turn's completed title was erased by the other");
});

test("the researched-terms set is one row per term, additive across turns", async () => {
  const impl = createRowMemoryBackend();
  const dir = wrapRowBackend(impl);
  assert.deepEqual([...await loadResearchedTerms(dir)], []);
  await markTermResearched(dir, "tariff");
  await markTermResearched(dir, "customs");
  await markTermResearched(dir, "tariff");
  assert.deepEqual([...await loadResearchedTerms(dir)].sort(), ["customs", "tariff"]);
  assert.deepEqual(readFactRows(await loadMemory(wrapRowBackend(impl))), []);
});

test("a sqlite token keeps the queue file it always used", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-row-queue-"));
  try {
    const token = { backend: "sqlite", dbPath: join(dir, ".tmct", "memory", "graph.sqlite") };
    const run = {
      topic: "tariff", key: "tariff", pending: ["Customs"], done: [], skipped: [],
    };
    await saveResearchQueue(token, run);
    const { readFile } = await import("node:fs/promises");
    assert.deepEqual(JSON.parse(await readFile(join(dir, ".tmct", "research-queue.json"), "utf8")), run);
    assert.deepEqual(await loadResearchQueue(token), run);
    await clearResearchQueue(token);
    assert.equal(await loadResearchQueue(token), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- the seed overlay -------------------------------------------------------

/** A payload standing in for a bundled seed graph: facts the session reads and
 *  must never write back. */
async function seedPayload() {
  const seedStore = createInMemoryStore();
  await appendFacts(seedStore, [
    { subject: "dog", predicate: "IsA", object: "mammal", provenance: "corpus:conceptnet", createdAt: T1 },
    { subject: "mammal", predicate: "IsA", object: "animal", provenance: "corpus:conceptnet", createdAt: T1 },
  ]);
  return loadMemory(seedStore);
}

test("a seeded base is readable and never written back", async () => {
  const seed = await seedPayload();
  const seedKeys = new Set(payloadToRows(seed).map((r) => r.rowKey));
  const spy = spyBackend();
  const dir = wrapRowBackend(spy.backend, { basePayload: seed });

  const loaded = readFactRows(await loadMemory(dir));
  assert.deepEqual(loaded.map((r) => r.subject).sort(), ["dog", "mammal"], "the seed answers from turn one");

  await appendFact(dir, { subject: "kim", predicate: "isIn", object: "hall", provenance: teach(T2), createdAt: T2 });

  const written = spy.calls.putRows.flat();
  assert.ok(written.length, "the session's own fact did get written");
  for (const key of written) {
    assert.equal(seedKeys.has(key), false, `putRows received the seed row ${key}`);
  }
  assert.deepEqual(spy.calls.deleteRows.flat().filter((k) => seedKeys.has(k)), [], "and no seed row is deleted");

  const stored = await factRowKeys(spy.inner);
  assert.equal(stored.length, 1, "the store holds the taught fact alone");
  assert.deepEqual(
    readFactRows(await loadMemory(wrapRowBackend(spy.backend, { basePayload: seed }))).map((r) => r.subject).sort(),
    ["dog", "kim", "mammal"],
    "a fresh handle over the same seed and store assembles both",
  );
});

test("a store carrying no seed reads back only what its session wrote", async () => {
  const seed = await seedPayload();
  const impl = createRowMemoryBackend();
  await appendFact(wrapRowBackend(impl, { basePayload: seed }), {
    subject: "kim", predicate: "isIn", object: "hall", provenance: teach(T2), createdAt: T2,
  });
  assert.deepEqual(
    readFactRows(await loadMemory(wrapRowBackend(impl))).map((r) => r.subject), ["kim"],
    "the seed lives with the handle, not in the store",
  );
});

/** A payload standing in for a real corpus band's own high-fan-out property
 *  (one edge per fact) already over the per-row cap before any session ever
 *  teaches anything — MAX_ROW_BYTES's own module isn't imported here to keep
 *  this fixture's size independent of that constant's exact value; "20000"
 *  is comfortably past it either way. */
async function seedPayloadWithOversizedGroup() {
  const seed = await seedPayload();
  seed.objectProperties.push({
    prop: "mgx:hugeGroup",
    examples: [{ subject: "s", object: "o", extra: "x".repeat(20000) }],
  });
  return seed;
}

test("the seed overlay's own base rows never cap out on read, even one already over the per-row limit", async () => {
  const seed = await seedPayloadWithOversizedGroup();
  // onOversizedRow left at its default ("throw") on purpose: the base
  // overlay's own read never consults the handle's configured posture — see
  // core.mjs's readRowPayload.
  const dir = wrapRowBackend(spyBackend().backend, { basePayload: seed });

  const loaded = await loadMemory(dir);
  const hugeGroup = loaded.objectProperties.find((g) => g.prop === "mgx:hugeGroup");
  assert.ok(hugeGroup, "the oversized seed group reads back intact rather than being dropped or throwing");
  assert.equal(hugeGroup.examples.length, 1);
});

test("a write that would re-project an already-oversized seed group throws by default, naming the row", async () => {
  const dir = wrapRowBackend(spyBackend().backend, { basePayload: await seedPayloadWithOversizedGroup() });
  await assert.rejects(
    appendFact(dir, { subject: "kim", predicate: "isIn", object: "hall", provenance: teach(T2), createdAt: T2 }),
    (error) => {
      assert.equal(error.code, "TMCT_BACKEND_REJECTED");
      assert.equal(error.rowKey, "edge-group:mgx:hugeGroup");
      return true;
    },
  );
});

test("under onOversizedRow: \"drop\", the same write completes and the oversized seed row is still never written back", async () => {
  const spy = spyBackend();
  const dir = wrapRowBackend(spy.backend, { basePayload: await seedPayloadWithOversizedGroup(), onOversizedRow: "drop" });
  await appendFact(dir, { subject: "kim", predicate: "isIn", object: "hall", provenance: teach(T2), createdAt: T2 });
  const writtenKeys = spy.calls.putRows.flat();
  assert.ok(writtenKeys.length, "the session's own fact still writes");
  assert.equal(writtenKeys.includes("edge-group:mgx:hugeGroup"), false, "the oversized seed row is never written back");
});

// ---- the seed held as a sqlite store ----------------------------------------

const SEED_FACTS = [
  { subject: "dog", predicate: "IsA", object: "mammal", provenance: "corpus:conceptnet", createdAt: T1 },
  { subject: "mammal", predicate: "IsA", object: "animal", provenance: "corpus:conceptnet", createdAt: T1 },
];

/** A pre-built seed file: the facts written through the sqlite store's own
 *  writer, the payload that same store hands back, and the file reopened
 *  read-only — so both ways of holding one seed describe the same graph down
 *  to the wall-clock stamps its records carry. */
async function buildSeedSqlite(facts = SEED_FACTS) {
  const dir = await mkdtemp(join(tmpdir(), "tmct-seed-sqlite-"));
  const dbPath = join(dir, "seed.sqlite");
  const writable = await createSqliteMemoryStore(dbPath);
  await appendFacts(writable, facts);
  const payload = await loadMemory(writable);
  closeSqliteMemoryStore(writable);
  const store = await openSqliteSeedStore(dbPath);
  return { payload, store, async cleanup() { closeSqliteMemoryStore(store); await rm(dir, { recursive: true, force: true }); } };
}

test("a seed read out of a sqlite store assembles exactly what the same seed as a parsed payload does", async () => {
  const seed = await buildSeedSqlite();
  try {
    const fromPayload = await loadMemory(wrapRowBackend(createRowMemoryBackend(), { basePayload: seed.payload }));
    const fromStore = await loadMemory(wrapRowBackendOverSqliteSeed(createRowMemoryBackend(), seed.store));
    assert.deepEqual(fromStore, fromPayload);
  } finally {
    await seed.cleanup();
  }
});

test("a sqlite seed is readable from turn one and never written back", async () => {
  const seed = await buildSeedSqlite();
  const spy = spyBackend();
  try {
    const seedKeys = new Set(payloadToRows(seed.payload).map((r) => r.rowKey));
    const dir = wrapRowBackendOverSqliteSeed(spy.backend, seed.store);

    assert.deepEqual(
      readFactRows(await loadMemory(dir)).map((r) => r.subject).sort(), ["dog", "mammal"],
      "the seed answers before the session has written anything",
    );

    await appendFact(dir, { subject: "kim", predicate: "isIn", object: "hall", provenance: teach(T2), createdAt: T2 });

    const written = spy.calls.putRows.flat();
    assert.ok(written.length, "the session's own fact did get written");
    for (const key of written) assert.equal(seedKeys.has(key), false, `putRows received the seed row ${key}`);
    assert.deepEqual(spy.calls.deleteRows.flat().filter((k) => seedKeys.has(k)), [], "and no seed row is deleted");
    assert.equal(dir.baseRows, null, "the seed never materializes as a row array");

    assert.deepEqual(
      readFactRows(await loadMemory(wrapRowBackendOverSqliteSeed(spy.backend, seed.store))).map((r) => r.subject).sort(),
      ["dog", "kim", "mammal"],
      "a fresh handle over the same seed and store assembles both",
    );
  } finally {
    await seed.cleanup();
  }
});

test("overlay rows sit over a sqlite seed and under the session's own, and are read-only too", async () => {
  const seed = await buildSeedSqlite();
  const overlaySource = createInMemoryStore();
  await appendFacts(overlaySource, [
    { subject: "hall", predicate: "IsA", object: "room", provenance: "corpus:wordnet", createdAt: T1 },
  ]);
  const overlayRows = payloadToRows(await loadMemory(overlaySource));
  const spy = spyBackend();
  try {
    const dir = wrapRowBackendOverSqliteSeed(spy.backend, seed.store, { overlayRows });
    assert.deepEqual(
      readFactRows(await loadMemory(dir)).map((r) => r.subject).sort(), ["dog", "hall", "mammal"],
      "the overlay reads alongside the seed",
    );

    await appendFact(dir, { subject: "kim", predicate: "isIn", object: "hall", provenance: teach(T2), createdAt: T2 });
    const overlayKeys = new Set(overlayRows.map((r) => r.rowKey));
    for (const key of spy.calls.putRows.flat()) {
      assert.equal(overlayKeys.has(key), false, `putRows received the overlay row ${key}`);
    }
  } finally {
    await seed.cleanup();
  }
});

test("a write over a sqlite seed projects only the session's own rows, so an oversized seed row cannot fail it", async () => {
  // A seed whose statedBy group is over the per-row cap before any session has
  // taught anything — what a real corpus band's own fan-out looks like.
  const highFanOut = Array.from({ length: 40 }, (_, i) => ({
    subject: `term${i}`, predicate: "IsA", object: "thing", provenance: "corpus:conceptnet", createdAt: T1,
  }));
  const seed = await buildSeedSqlite([...SEED_FACTS, ...highFanOut]);
  const taught = { subject: "kim", predicate: "isIn", object: "hall", provenance: teach(T2), createdAt: T2 };
  try {
    await assert.rejects(
      appendFact(wrapRowBackend(spyBackend().backend, { basePayload: seed.payload }), taught),
      (error) => error.code === "TMCT_BACKEND_REJECTED",
      "the parsed-payload path re-projects the whole seed, so the oversized record reaches the cap",
    );

    const spy = spyBackend();
    const dir = wrapRowBackendOverSqliteSeed(spy.backend, seed.store);
    await appendFact(dir, taught);
    assert.equal(spy.calls.putRows.flat().length, 2, "the taught fact and its source, and nothing of the seed");
  } finally {
    await seed.cleanup();
  }
});

test("a sqlite seed's fact terms come off its own columns, matching the records it holds", async () => {
  const seed = await buildSeedSqlite();
  try {
    assert.deepEqual(
      [...new Set(sqliteSeedFactTermValues(seed.store))].sort(), ["animal", "dog", "mammal"],
    );
  } finally {
    await seed.cleanup();
  }
});

// ---- two live handles -------------------------------------------------------

test("two handles racing on one store both land, and neither deletes the other's rows", async () => {
  const spy = spyBackend();
  const seeded = wrapRowBackend(spy.backend);
  await appendFacts(seeded, [
    { subject: "kim", predicate: "isIn", object: "hall", provenance: teach(T1), createdAt: T1 },
    { subject: "kim", predicate: "isIn", object: "hall", provenance: ace(T1), createdAt: T1 },
  ]);
  spy.calls.deleteRows.length = 0;

  // Both open before either writes, so each holds a view the other's write
  // invalidates — the ordinary case for two turns on one session.
  const first = wrapRowBackend(spy.backend);
  const second = wrapRowBackend(spy.backend);
  await loadMemory(first);
  await loadMemory(second);
  await appendFacts(first, [{ subject: "kim", predicate: "isIn", object: "hall", provenance: teach(T3), createdAt: T3 }]);
  await appendFacts(second, [{ subject: "kim", predicate: "isIn", object: "hall", provenance: ace(T4), createdAt: T4 }]);

  assert.deepEqual(spy.calls.deleteRows.flat(), [], "an additive write deletes nothing");
  const keys = await factRowKeys(spy.inner);
  assert.equal(keys.length, 4, `two heads and two demoted leaves: ${keys.join(", ")}`);

  const assembled = await loadMemory(wrapRowBackend(spy.backend));
  for (const leaf of keys.filter((k) => k.endsWith("#v1"))) {
    const head = leaf.replace(/#v1$/, "");
    assert.equal(attrValue(factOf(assembled, head), "mgx:supersedes"), leaf,
      `${head} kept its forward pointer through the other writer's turn`);
    assert.equal(attrValue(factOf(assembled, leaf), "mgx:supersededBy"), head,
      "and assembly derives the backward one");
  }
});

test("two handles teaching different facts at once both survive the assembly", async () => {
  const impl = createRowMemoryBackend();
  const first = wrapRowBackend(impl);
  const second = wrapRowBackend(impl);
  await loadMemory(first);
  await loadMemory(second);
  await appendFact(first, { subject: "kim", predicate: "isIn", object: "hall", provenance: teach(T3), createdAt: T3 });
  await appendFact(second, { subject: "rex", predicate: "isIn", object: "yard", provenance: ace(T4), createdAt: T4 });

  assert.deepEqual(
    readFactRows(await loadMemory(wrapRowBackend(impl))).map((r) => r.subject).sort(), ["kim", "rex"],
  );
});

// ---- what rides the record --------------------------------------------------

test("per-assertion extraction findings survive the row round trip", async () => {
  const impl = createRowMemoryBackend();
  const dir = wrapRowBackend(impl);
  await appendFact(dir, {
    subject: "cell", predicate: "rdfs:subClassOf", object: "unit",
    provenance: "optimistic-extract:biology.md", extraction: ["clause-fallback"],
  });
  await appendFact(dir, {
    subject: "cell", predicate: "rdfs:subClassOf", object: "unit",
    provenance: "extracted:biology.md", extraction: ["pronoun-carry"],
  });

  const row = readFactRows(await loadMemory(wrapRowBackend(impl))).find((r) => r.subject === "cell");
  assert.deepEqual(row.extraction, ["clause-fallback", "pronoun-carry"], "the row's union comes back");
  assert.deepEqual(
    row.assertions.map((a) => a.extraction).filter(Boolean).flat().sort(),
    ["clause-fallback", "pronoun-carry"],
    "and each assertion keeps its own finding, not the union",
  );
});

test("a re-read hands back a payload the caller cannot mutate through", async () => {
  const impl = createRowMemoryBackend();
  const dir = wrapRowBackend(impl);
  await appendFact(dir, { subject: "man", predicate: "IsA", object: "person", provenance: teach(T1), createdAt: T1 });
  const first = await loadMemory(dir);
  first.individuals.length = 0;
  assert.equal((await loadMemory(dir)).individuals.filter((i) => i.class === FACT_CLASS).length, 1);
});

// ---- the same answers as the store beside it --------------------------------

/** Two sessions mint their own session ids and their own wall-clock stamps, and
 *  both ride the provenance an answer cites. Blank them out and what is left is
 *  the answer the store produced. */
const withoutSessionIdentity = (answer) => answer
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<session>")
  .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<at>");

test("a row-backed session answers the same taught turns as a sqlite-backed one", async () => {
  clearCache();
  const lines = ["every module is a component", "is a module a component?", "what is a module?"];
  const repo = await mkdtemp(join(tmpdir(), "tmct-row-session-"));
  const rowRepo = await mkdtemp(join(tmpdir(), "tmct-row-session-b-"));
  try {
    const sqlite = await createSession({ repoPath: repo, env: { TMCT_NO_SEED: "1" }, memoryBackend: "sqlite" });
    const sqliteAnswers = [];
    for (const line of lines) sqliteAnswers.push((await sqlite.turn(line)).answer);
    await sqlite.close();

    const impl = createRowMemoryBackend();
    const row = await createSession({ repoPath: rowRepo, env: { TMCT_NO_SEED: "1" }, memoryBackend: impl });
    assert.equal(row.memoryDir?.backend, "row", "the injected store is the session's memoryDir");
    const rowAnswers = [];
    for (const line of lines) rowAnswers.push((await row.turn(line)).answer);
    const banner = row.bannerLines.join("\n");
    const taught = readFactRows(await loadMemory(wrapRowBackend(impl)));
    await row.close();

    assert.deepEqual(
      rowAnswers.map(withoutSessionIdentity), sqliteAnswers.map(withoutSessionIdentity),
      "the storage seam changed no answer",
    );
    assert.match(banner, /kept in your configured store/);
    assert.doesNotMatch(banner, /the conversation is remembered to/);
    assert.ok(
      taught.some((r) => r.subject === "module" && r.object === "component"),
      "and the taught fact is in the injected store, not in a file",
    );
    await assert.rejects(loadMemory(wrapRowBackend(impl)), /closed/, "session teardown closed the injected store");
  } finally {
    await rm(repo, { recursive: true, force: true });
    await rm(rowRepo, { recursive: true, force: true });
  }
});
