// The materialised `fact_heads` table and the cross-object supersession edge —
// the two derived-local breadcrumbs the sqlite backend keeps over a read-time
// computation that is already correct without either of them.
//
// The property this suite exists to hold: a head stores the aggregate BASE and
// nothing that depends on when it was written. Recency is a function of the
// READING moment, so a head that folded the decay in would be wrong the instant
// it hit disk. Every other test here is downstream of that one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendFact, appendFacts, removeFacts, loadMemory, readFactRows,
  factGroupId, factHeadsOf, attachFactHeads, readObjectSupersessions,
  createSqliteMemoryStore, closeSqliteMemoryStore,
} from "../../src/adapters/memory/core.mjs";
import {
  computeAssertionGroupTrust, computeAssertionGroupTrustBase, recencyNudge,
} from "../../src/domain/memory/trust.mjs";

const BARK = { subject: "dog", predicate: "mgx:capableOf", object: "bark" };
const DAY = 24 * 60 * 60 * 1000;

async function withSqliteStore(run) {
  const dir = await mkdtemp(join(tmpdir(), "tmct-fact-heads-"));
  const handle = await createSqliteMemoryStore(join(dir, "graph.sqlite"));
  try {
    return await run(handle);
  } finally {
    closeSqliteMemoryStore(handle);
    await rm(dir, { recursive: true, force: true });
  }
}

const headRows = (handle) =>
  handle.db.prepare("SELECT triple_hash, trust_base, inputs_json, updated_at FROM fact_heads ORDER BY triple_hash").all();

const headFor = (handle, groupId) =>
  handle.db.prepare("SELECT trust_base, inputs_json FROM fact_heads WHERE triple_hash = ?").get(groupId);

/** The same payload with its head index stripped — what a backend that keeps no
 *  heads hands a reader, and what the fold path has to answer on its own. */
const withoutHeads = (memory) => JSON.parse(JSON.stringify(memory));

/** Every group's stored base against the base its own live records fold to.
 *  Run after a write, this is the whole transactional-recompute contract. */
async function assertHeadsMatchFold(handle, note) {
  const memory = await loadMemory(handle);
  const rows = readFactRows(withoutHeads(memory));
  const stored = new Map(headRows(handle).map((r) => [r.triple_hash, r]));
  assert.equal(stored.size, rows.length, `${note}: one head per live group`);
  for (const row of rows) {
    const head = stored.get(row.id);
    assert.ok(head, `${note}: ${row.id} has a materialised head`);
    assert.equal(
      head.trust_base,
      computeAssertionGroupTrustBase(row.assertions).score,
      `${note}: ${row.id} stores the base its own records fold to`,
    );
  }
}

// ---- The base is stored; the recency is not -------------------------------

test("a head stores the recency-free aggregate base, and the read applies the decay at the reading moment", async () => {
  await withSqliteStore(async (handle) => {
    // Two independent sources, both asserting at a fixed instant, so the decay
    // below is the only thing that can move the answer.
    const assertedAt = "2026-07-01T00:00:00.000Z";
    await appendFacts(handle, [
      { ...BARK, provenance: "corpus:human /r/CapableOf" },
      { ...BARK, provenance: `teach:chat:s1@${assertedAt}` },
    ]);

    const [head] = headRows(handle);
    assert.ok(head, "the write materialised a head");
    const inputs = JSON.parse(head.inputs_json);
    assert.deepEqual(inputs.map((i) => i.sourceType).sort(), ["corpus", "teach"]);

    // The stored base is the noisy-OR with the time axis removed, so it equals
    // the aggregate computed at ANY instant with the decay neutralised.
    assert.equal(head.trust_base, computeAssertionGroupTrustBase(inputs).score);

    // Read the same group at three widening distances from the assertion.
    const memory = await loadMemory(handle);
    const readAt = (ms) => readFactRows(memory, { now: ms })[0].trust;
    const t0 = Date.parse(assertedAt);
    const fresh = readAt(t0);
    const aWeekOn = readAt(t0 + 7 * DAY);
    const aYearOn = readAt(t0 + 365 * DAY);

    // The decay is real and monotone, so the read is genuinely time-dependent.
    assert.ok(fresh > aWeekOn, `a week of decay lowers the read (${fresh} -> ${aWeekOn})`);
    assert.ok(aWeekOn > aYearOn, `a year of decay lowers it further (${aWeekOn} -> ${aYearOn})`);
    // And every one of those reads sits at or below the recency-free base,
    // which is what "the base is the ceiling the decay works down from" means.
    for (const score of [fresh, aWeekOn, aYearOn]) assert.ok(score <= head.trust_base);

    // The stored column never moved while all that was happening.
    const after = headRows(handle);
    assert.equal(after.length, 1);
    assert.equal(after[0].trust_base, head.trust_base, "reading never rewrites the stored base");
    assert.equal(after[0].inputs_json, head.inputs_json);
  });
});

test("the stored base is what the aggregate reads when nothing has aged, and strictly above what it reads once time has passed", async () => {
  await withSqliteStore(async (handle) => {
    const assertedAt = "2026-07-01T00:00:00.000Z";
    await appendFact(handle, { ...BARK, provenance: `teach:chat:s1@${assertedAt}` });
    const memory = await loadMemory(handle);
    const [head] = headRows(handle);
    const t0 = Date.parse(assertedAt);

    // At the assertion instant the decay multiplier is exactly 1, so the
    // read-time aggregate and the stored base coincide.
    assert.equal(recencyNudge(assertedAt, t0), 1);
    assert.equal(readFactRows(memory, { now: t0 })[0].trust, head.trust_base);

    // A month later it does not, and the gap is the recency band the head
    // deliberately does not carry.
    const later = readFactRows(memory, { now: t0 + 30 * DAY })[0].trust;
    assert.ok(later < head.trust_base, `${later} < ${head.trust_base}`);
  });
});

test("a head read and a bare group fold return the same number at the same instant", async () => {
  await withSqliteStore(async (handle) => {
    await appendFacts(handle, [
      { ...BARK, provenance: "corpus:human /r/CapableOf" },
      { ...BARK, provenance: "teach:chat:s1@2026-07-01T00:00:00.000Z" },
      { subject: "dog", predicate: "mgx:hasA", object: "tail", provenance: "corpus:human /r/HasA" },
    ]);
    const memory = await loadMemory(handle);
    assert.ok(factHeadsOf(memory)?.size, "the loaded payload carries the head index");

    for (const now of [Date.parse("2026-07-01T00:00:00.000Z"), Date.now(), Date.parse("2027-01-01T00:00:00.000Z")]) {
      const viaHead = readFactRows(memory, { now });
      const viaFold = readFactRows(withoutHeads(memory), { now });
      assert.deepEqual(
        viaHead.map((r) => [r.id, r.trust]),
        viaFold.map((r) => [r.id, r.trust]),
        `head and fold agree at ${new Date(now).toISOString()}`,
      );
    }
  });
});

// ---- The recompute is transactional, and fires for every touching write ----

test("every write that touches a group re-materialises that group's head", async () => {
  await withSqliteStore(async (handle) => {
    await appendFact(handle, { ...BARK, provenance: "corpus:human /r/CapableOf" });
    await assertHeadsMatchFold(handle, "first assertion");

    await appendFacts(handle, [
      { ...BARK, provenance: "teach:chat:s1@2026-07-01T00:00:00.000Z" },
      { subject: "dog", predicate: "mgx:hasA", object: "tail", provenance: "corpus:human /r/HasA" },
    ]);
    await assertHeadsMatchFold(handle, "batch adding a corroborator and a new group");

    // A same-source re-assertion with a newer timestamp supersedes, so the
    // group's live heads change without its record count changing.
    await appendFact(handle, { ...BARK, provenance: "teach:chat:s1@2026-07-09T00:00:00.000Z" });
    await assertHeadsMatchFold(handle, "same-source supersession");

    await appendFact(handle, { subject: "cat", predicate: "mgx:capableOf", object: "purr", provenance: "web:https://example.invalid/cat" });
    await assertHeadsMatchFold(handle, "an unrelated group");
  });
});

test("a corroborating write moves the stored base, so the head tracks the group rather than its first write", async () => {
  await withSqliteStore(async (handle) => {
    await appendFact(handle, { ...BARK, provenance: "corpus:human /r/CapableOf" });
    const alone = headRows(handle)[0].trust_base;

    await appendFact(handle, { ...BARK, provenance: "teach:chat:s1@2026-07-01T00:00:00.000Z" });
    const corroborated = headRows(handle)[0].trust_base;
    assert.ok(corroborated > alone, `corroboration raises the base (${alone} -> ${corroborated})`);
  });
});

test("retracting a group's last record drops its head instead of leaving one behind", async () => {
  await withSqliteStore(async (handle) => {
    await appendFacts(handle, [
      { ...BARK, provenance: "corpus:human /r/CapableOf" },
      { subject: "dog", predicate: "mgx:hasA", object: "tail", provenance: "corpus:human /r/HasA" },
    ]);
    assert.equal(headRows(handle).length, 2);

    const groupId = readFactRows(await loadMemory(handle)).find((r) => r.object === "bark").id;
    await removeFacts(handle, [groupId]);

    const remaining = headRows(handle);
    assert.equal(remaining.length, 1, "the retracted group's head went with it");
    assert.ok(!remaining.some((r) => r.triple_hash === groupId));
    await assertHeadsMatchFold(handle, "after retraction");
  });
});

test("a second connection writing the same group recomputes the head over both writers' records", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-fact-heads-concurrent-"));
  const dbPath = join(dir, "graph.sqlite");
  const first = await createSqliteMemoryStore(dbPath);
  const second = await createSqliteMemoryStore(dbPath);
  try {
    await appendFact(first, { ...BARK, provenance: "corpus:human /r/CapableOf" });
    await appendFact(second, { ...BARK, provenance: "teach:chat:s1@2026-07-01T00:00:00.000Z" });

    // The later writer's own transaction folded a group it did not write alone.
    // It never had to be told: the data_version guard invalidated its payload
    // cache when the first connection committed, so the payload it mutated
    // already carried both records.
    const [head] = headRows(second);
    assert.deepEqual(JSON.parse(head.inputs_json).map((i) => i.sourceType).sort(), ["corpus", "teach"]);

    const [row] = readFactRows(withoutHeads(await loadMemory(second)));
    assert.equal(row.assertions.length, 2);
    assert.equal(head.trust_base, computeAssertionGroupTrustBase(row.assertions).score);
  } finally {
    closeSqliteMemoryStore(first);
    closeSqliteMemoryStore(second);
    await rm(dir, { recursive: true, force: true });
  }
});

test("a head survives the connection: reopening the store reads back the same base", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-fact-heads-reopen-"));
  const dbPath = join(dir, "graph.sqlite");
  try {
    const first = await createSqliteMemoryStore(dbPath);
    await appendFacts(first, [
      { ...BARK, provenance: "corpus:human /r/CapableOf" },
      { ...BARK, provenance: "teach:chat:s1@2026-07-01T00:00:00.000Z" },
    ]);
    const before = headRows(first);
    closeSqliteMemoryStore(first);

    const second = await createSqliteMemoryStore(dbPath);
    try {
      assert.deepEqual(headRows(second).map((r) => [r.triple_hash, r.trust_base]), before.map((r) => [r.triple_hash, r.trust_base]));
    } finally {
      closeSqliteMemoryStore(second);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- No head row: the fold answers, unchanged ------------------------------

test("a store with no head table at all folds every group and answers correctly", async () => {
  // A plain directory is the flat-JSON backend, which keeps no derived tables
  // — so this is the fallback path with nothing to fall back FROM.
  const dir = await mkdtemp(join(tmpdir(), "tmct-fact-heads-flat-"));
  try {
    await appendFacts(dir, [
      { ...BARK, provenance: "corpus:human /r/CapableOf" },
      { ...BARK, provenance: "teach:chat:s1@2026-07-01T00:00:00.000Z" },
    ]);
    const memory = await loadMemory(dir);
    assert.equal(factHeadsOf(memory), null, "no backend, no head index");

    const rows = readFactRows(memory, { now: Date.parse("2026-07-01T00:00:00.000Z") });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].assertions.length, 2);
    assert.equal(rows[0].trust, computeAssertionGroupTrustBase(rows[0].assertions).score);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a group with no head of its own falls back to its fold while its neighbours use theirs", async () => {
  await withSqliteStore(async (handle) => {
    await appendFacts(handle, [
      { ...BARK, provenance: "corpus:human /r/CapableOf" },
      { subject: "dog", predicate: "mgx:hasA", object: "tail", provenance: "corpus:human /r/HasA" },
    ]);
    const memory = await loadMemory(handle);
    const full = readFactRows(memory, { now: Date.now() });

    // Drop ONE group's head from the index and read again: the group with no
    // head has to fold itself, and has to land on the same number.
    const partial = withoutHeads(memory);
    const heads = new Map(factHeadsOf(memory));
    const dropped = full[0].id;
    heads.delete(dropped);
    attachFactHeads(partial, heads);

    assert.deepEqual(
      readFactRows(partial, { now: Date.now() }).map((r) => [r.id, r.trust]),
      full.map((r) => [r.id, r.trust]),
    );
  });
});

test("a hand-built payload with no head index reads exactly as it always did", async () => {
  const memory = {
    individuals: [
      {
        id: "fact:deadbeefdeadbeef@src:corpus:human", class: "Fact", label: "dog mgx:capableOf bark",
        attributes: [
          { prop: "rdf:subject", key: "subject", value: "dog" },
          { prop: "rdf:predicate", key: "predicate", value: "mgx:capableOf" },
          { prop: "rdf:object", key: "object", value: "bark" },
          { prop: "mgx:createdAt", key: "createdAt", value: "2026-07-01T00:00:00.000Z" },
          { prop: "mgx:trustScore", key: "trustScore", value: "0.7" },
        ],
      },
    ],
    objectProperties: [],
  };
  const rows = readFactRows(memory, { now: Date.parse("2026-07-01T00:00:00.000Z") });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, "fact:deadbeefdeadbeef");
  assert.equal(rows[0].trust, 0.7);
});

// ---- Local derived state: never exported, never on the wire ---------------

test("the head index never reaches a serialised payload, an export, or a wire fact", async () => {
  await withSqliteStore(async (handle) => {
    await appendFacts(handle, [
      { ...BARK, provenance: "corpus:human /r/CapableOf" },
      { ...BARK, provenance: "teach:chat:s1@2026-07-01T00:00:00.000Z" },
    ]);
    const memory = await loadMemory(handle);
    assert.ok(factHeadsOf(memory), "the live payload does carry the index");

    // Anything that leaves this process goes through one of these two, and a
    // symbol-keyed property survives neither.
    const serialised = JSON.stringify(memory);
    for (const token of ["fact_heads", "trust_base", "inputs_json", "fact_object_supersessions"]) {
      assert.ok(!serialised.includes(token), `a serialised payload carries no ${token}`);
    }
    assert.equal(factHeadsOf(JSON.parse(serialised)), null);
    assert.equal(factHeadsOf(structuredClone(memory)), null);

    // The replicated state is the individuals and the edges. Neither grew.
    assert.ok(memory.individuals.every((i) => ["Fact", "Source"].includes(i.class)));
    assert.deepEqual(
      Object.keys(memory).sort(),
      ["classes", "generated_at", "individuals", "memory", "objectProperties", "prefixes", "proseIndex", "vocabulary"],
    );

    // The row surface the P2P layer builds wire facts from is unchanged, so a
    // broadcast cannot pick up head material it has no field for.
    const [row] = readFactRows(memory);
    assert.deepEqual(
      Object.keys(row).sort(),
      ["assertions", "environments", "id", "justification", "object", "predicate", "provenance", "quantifier", "sourceIds", "sourceTypes", "subject", "trust"],
    );
    for (const a of row.assertions) {
      assert.deepEqual(
        Object.keys(a).sort().filter((k) => !["observedAt"].includes(k)),
        ["assertedAt", "createdAt", "id", "ownTrust", "provenance", "sourceId", "sourceType"],
      );
    }
  });
});

// ---- The cross-object supersession edge ------------------------------------

const place = (handle, object, ts) =>
  appendFact(handle, { subject: "lamp", predicate: "mgx:located-in", object, provenance: `teach:chat:s1@${ts}` });

test("a single placement records no supersession edge — nothing has succeeded anything yet", async () => {
  await withSqliteStore(async (handle) => {
    await place(handle, "hall", "2026-07-01T00:00:00.000Z");
    assert.deepEqual(readObjectSupersessions(handle), []);
  });
});

test("a latest-observation-wins winner moving records the edge between the two groups' own ids", async () => {
  await withSqliteStore(async (handle) => {
    await place(handle, "hall", "2026-07-01T00:00:00.000Z");
    await place(handle, "attic", "2026-07-02T00:00:00.000Z");

    const edges = readObjectSupersessions(handle);
    assert.equal(edges.length, 1);
    const rows = readFactRows(await loadMemory(handle));
    const attic = rows.find((r) => r.object === "attic");
    assert.equal(edges[0].subject, "lamp");
    assert.equal(edges[0].predicate, "mgx:located-in");
    assert.equal(edges[0].toId, attic.id, "the edge names the winning GROUP id");
    assert.equal(edges[0].fromId, "", "the chain's first entry has nothing before it");
    assert.equal(edges[0].toId, factGroupId(edges[0].toId), "a group id, never a record id");
  });
});

test("a resolution that finds the same winner again records nothing — the edge marks a change, not a read", async () => {
  await withSqliteStore(async (handle) => {
    await place(handle, "hall", "2026-07-01T00:00:00.000Z");
    await place(handle, "attic", "2026-07-02T00:00:00.000Z");
    assert.equal(readObjectSupersessions(handle).length, 1);

    // Re-assert the SAME winning object from a second source, twice, and add an
    // OLDER placement that loses. Every one of these re-runs the resolution.
    await appendFact(handle, { subject: "lamp", predicate: "mgx:located-in", object: "attic", provenance: "teach:chat:s2@2026-07-03T00:00:00.000Z" });
    await appendFact(handle, { subject: "lamp", predicate: "mgx:located-in", object: "attic", provenance: "teach:chat:s3@2026-07-04T00:00:00.000Z" });
    await place(handle, "cellar", "2026-06-01T00:00:00.000Z");

    assert.equal(readObjectSupersessions(handle).length, 1, "the winner never moved, so the chain never grew");
  });
});

test("successive moves build a walkable chain, each edge naming what it replaced", async () => {
  await withSqliteStore(async (handle) => {
    await place(handle, "hall", "2026-07-01T00:00:00.000Z");
    await place(handle, "attic", "2026-07-02T00:00:00.000Z");
    await place(handle, "cellar", "2026-07-03T00:00:00.000Z");

    const edges = readObjectSupersessions(handle, { subject: "lamp", predicate: "mgx:located-in" });
    assert.equal(edges.length, 2);
    assert.deepEqual(edges.map((e) => e.ord), [0, 1]);
    assert.equal(edges[1].fromId, edges[0].toId, "each edge starts where the last one ended");

    const rows = readFactRows(await loadMemory(handle));
    assert.equal(edges[1].toId, rows.find((r) => r.object === "cellar").id);
  });
});

test("a multi-word subject records its edge under the whole subject, not the first word of it", async () => {
  await withSqliteStore(async (handle) => {
    const move = (object, ts) =>
      appendFact(handle, { subject: "polar bear", predicate: "mgx:located-in", object, provenance: `teach:chat:s1@${ts}` });
    await move("arctic", "2026-07-01T00:00:00.000Z");
    await move("zoo", "2026-07-02T00:00:00.000Z");

    const edges = readObjectSupersessions(handle, { subject: "polar bear", predicate: "mgx:located-in" });
    assert.equal(edges.length, 1);
    assert.equal(edges[0].subject, "polar bear");
    assert.equal(edges[0].predicate, "mgx:located-in");
  });
});

test("a merge predicate never records an edge — its objects are all true at once", async () => {
  await withSqliteStore(async (handle) => {
    await appendFacts(handle, [
      { subject: "dog", predicate: "mgx:hasA", object: "tail", provenance: "teach:chat:s1@2026-07-01T00:00:00.000Z" },
      { subject: "dog", predicate: "mgx:hasA", object: "legs", provenance: "teach:chat:s1@2026-07-02T00:00:00.000Z" },
    ]);
    assert.deepEqual(readObjectSupersessions(handle), []);
  });
});

test("the supersession chain is local too — it never reaches a serialised payload", async () => {
  await withSqliteStore(async (handle) => {
    await place(handle, "hall", "2026-07-01T00:00:00.000Z");
    await place(handle, "attic", "2026-07-02T00:00:00.000Z");
    const [edge] = readObjectSupersessions(handle);
    assert.ok(edge);

    const memory = await loadMemory(handle);
    const serialised = JSON.stringify(memory);
    // The table and its columns. (A bare "supersedes" would match the ontology
    // note for the same-source chain, which IS replicated record content and a
    // different mechanism entirely.)
    for (const token of ["fact_object_supersessions", "from_id", "to_id", "recorded_at"]) {
      assert.ok(!serialised.includes(token), `a serialised payload carries no ${token}`);
    }
    // And no edge group encodes the recorded chain: the winner moving is a
    // local breadcrumb, so the graph itself must be identical to one that never
    // resolved anything.
    const props = (memory.objectProperties || []).map((g) => g.prop);
    assert.ok(props.every((p) => !/supersession/i.test(p)), `no supersession edge group (${props.join(", ")})`);
    for (const group of memory.objectProperties || []) {
      for (const e of group.examples || []) {
        assert.ok(!(e.subject === edge.fromId && e.object === edge.toId), "the recorded edge is not a graph edge");
      }
    }
  });
});

test("a backend that keeps no derived tables reports an empty supersession chain rather than failing", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-fact-heads-nochain-"));
  try {
    await place(dir, "hall", "2026-07-01T00:00:00.000Z");
    await place(dir, "attic", "2026-07-02T00:00:00.000Z");
    assert.deepEqual(readObjectSupersessions(dir), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- The base primitive itself --------------------------------------------

test("computeAssertionGroupTrustBase strips the time axis and nothing else", async () => {
  const records = [
    { sourceId: "src:corpus:human", sourceType: "corpus", ownTrust: 0.7, assertedAt: "2019-01-01T00:00:00.000Z" },
    { sourceId: "src:teach-chat:s1", sourceType: "teach", ownTrust: 0.95, assertedAt: "2019-01-01T00:00:00.000Z" },
  ];
  // The base does not depend on `now` at all — that is what makes it storable.
  const base = computeAssertionGroupTrustBase(records).score;
  assert.equal(base, computeAssertionGroupTrustBase(records).score);

  // It equals the ordinary aggregate read at the assertion instant, where the
  // decay multiplier is 1, and sits strictly above one read years later.
  const t0 = Date.parse("2019-01-01T00:00:00.000Z");
  assert.equal(computeAssertionGroupTrust(records, { now: t0 }).score, base);
  assert.ok(computeAssertionGroupTrust(records, { now: t0 + 365 * DAY }).score < base);
});
