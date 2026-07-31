import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendFact, appendFacts, loadMemory, readFactRows,
  createSqliteMemoryStore, closeSqliteMemoryStore,
} from "../../src/adapters/memory/core.mjs";
import { assertIndividualValid } from "../../src/adapters/memory/shacl.mjs";
import {
  GROUP_ROLLUP_THRESHOLD, ROLLUP_KEEP_PER_TYPE,
  CHAIN_ROLLUP_THRESHOLD, CHAIN_KEEP_DEPTH,
  ROLLUP_SOURCE_IDS_PROP, ROLLUP_RECORD_IDS_PROP, ROLLUP_COUNT_PROP,
  ROLLUP_EARLIEST_PROP, ROLLUP_LATEST_PROP, ROLLUP_PRIOR_PROP,
  headRollupIdFor, chainRollupIdFor, isHeadRollupId, isChainRollupId,
  mergeRollups, noisyOr, absorbedSourceIds, absorbedRecordIds,
} from "../../src/domain/memory/compaction.mjs";

const TRIPLE = { subject: "dog", predicate: "mgx:capableOf", object: "bark" };

async function withStore(run) {
  const dir = await mkdtemp(join(tmpdir(), "tmct-compaction-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** One teach session per index, each with a later assertion time than the last,
 *  so "newest" is unambiguous and the keep-window is checkable by name. */
const teachTag = (n) => `teach:chat:s${String(n).padStart(3, "0")}@${new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString()}`;

const distinctTeachRows = (count) =>
  Array.from({ length: count }, (_, i) => ({ ...TRIPLE, provenance: teachTag(i + 1) }));

const factRecords = async (dir) =>
  (await loadMemory(dir)).individuals.filter((i) => i?.class === "Fact");

const attrOf = (ind, prop) => (ind?.attributes || []).find((a) => a?.prop === prop)?.value || "";

// ---- Pool 1: many sources corroborating one triple -------------------------

test("a type one head short of the rollup threshold keeps every record it has", async () => {
  await withStore(async (dir) => {
    await appendFacts(dir, distinctTeachRows(GROUP_ROLLUP_THRESHOLD - 1));
    const records = await factRecords(dir);
    assert.equal(records.length, GROUP_ROLLUP_THRESHOLD - 1);
    assert.equal(records.filter((r) => isHeadRollupId(r.id)).length, 0);
  });
});

test("a type reaching the rollup threshold keeps the newest per-type window and summarizes the rest", async () => {
  await withStore(async (dir) => {
    const { ids } = await appendFacts(dir, distinctTeachRows(GROUP_ROLLUP_THRESHOLD));
    const groupId = ids[0];
    const records = await factRecords(dir);

    const rollups = records.filter((r) => isHeadRollupId(r.id));
    assert.equal(rollups.length, 1);
    assert.equal(rollups[0].id, headRollupIdFor(groupId, "teach"));

    const heads = records.filter((r) => !isHeadRollupId(r.id));
    assert.equal(heads.length, ROLLUP_KEEP_PER_TYPE);

    const absorbed = GROUP_ROLLUP_THRESHOLD - ROLLUP_KEEP_PER_TYPE;
    assert.equal(absorbedSourceIds(rollups[0]).length, absorbed);
    assert.equal(attrOf(rollups[0], ROLLUP_COUNT_PROP), String(absorbed));
  });
});

test("the heads a rollup leaves standing are the newest ones, not an arbitrary slice", async () => {
  await withStore(async (dir) => {
    await appendFacts(dir, distinctTeachRows(GROUP_ROLLUP_THRESHOLD));
    const records = await factRecords(dir);
    const kept = records
      .filter((r) => !isHeadRollupId(r.id))
      .map((r) => attrOf(r, "mgx:sourceId"))
      .sort();
    const newest = Array.from(
      { length: ROLLUP_KEEP_PER_TYPE },
      (_, i) => `src:teach-chat:s${String(GROUP_ROLLUP_THRESHOLD - ROLLUP_KEEP_PER_TYPE + i + 1).padStart(3, "0")}`,
    ).sort();
    assert.deepEqual(kept, newest);

    // and the absorbed ids are exactly the older ones
    const rollup = records.find((r) => isHeadRollupId(r.id));
    const oldest = Array.from(
      { length: GROUP_ROLLUP_THRESHOLD - ROLLUP_KEEP_PER_TYPE },
      (_, i) => `src:teach-chat:s${String(i + 1).padStart(3, "0")}`,
    ).sort();
    assert.deepEqual(absorbedSourceIds(rollup), oldest);
  });
});

test("a rollup covers one source type and leaves every other type's heads alone", async () => {
  await withStore(async (dir) => {
    await appendFacts(dir, [
      ...distinctTeachRows(GROUP_ROLLUP_THRESHOLD),
      ...["c1", "c2", "c3"].map((name) => ({ ...TRIPLE, provenance: `corpus:${name}` })),
    ]);
    const records = await factRecords(dir);
    const rollups = records.filter((r) => isHeadRollupId(r.id));
    assert.equal(rollups.length, 1, "only the type over its own threshold is summarized");
    assert.equal(attrOf(rollups[0], "mgx:sourceId"), "rollup:teach");

    const corpusHeads = records.filter((r) => attrOf(r, "mgx:sourceId").startsWith("src:corpus:"));
    assert.equal(corpusHeads.length, 3, "a corpus pool under its own threshold is untouched");
  });
});

// ---- Pool 2: one source re-asserting its own claim --------------------------

/** Assert the same triple from ONE source `count` times, each with a later
 *  embedded timestamp, so every write after the first supersedes its own head. */
async function reassert(dir, count) {
  let groupId = "";
  for (let n = 1; n <= count; n += 1) {
    const { id } = await appendFact(dir, {
      ...TRIPLE,
      provenance: `teach:chat:solo@${new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString()}`,
    });
    groupId = id;
  }
  return groupId;
}

test("a chain one leaf short of its threshold keeps every demoted record", async () => {
  await withStore(async (dir) => {
    await reassert(dir, CHAIN_ROLLUP_THRESHOLD); // n writes leave n-1 demoted leaves
    const records = await factRecords(dir);
    assert.equal(records.filter((r) => isChainRollupId(r.id)).length, 0);
    assert.equal(records.length, CHAIN_ROLLUP_THRESHOLD);
  });
});

test("a chain reaching its threshold keeps the newest leaves and summarizes the older ones", async () => {
  await withStore(async (dir) => {
    const groupId = await reassert(dir, CHAIN_ROLLUP_THRESHOLD + 1);
    const records = await factRecords(dir);

    const rollups = records.filter((r) => isChainRollupId(r.id));
    assert.equal(rollups.length, 1);
    assert.equal(rollups[0].id, chainRollupIdFor(groupId, "src:teach-chat:solo"));

    const leaves = records.filter((r) => /#v[0-9]+$/.test(r.id));
    assert.equal(leaves.length, CHAIN_KEEP_DEPTH);

    const absorbed = CHAIN_ROLLUP_THRESHOLD - CHAIN_KEEP_DEPTH;
    assert.equal(absorbedRecordIds(rollups[0]).length, absorbed);
    assert.equal(attrOf(rollups[0], ROLLUP_COUNT_PROP), String(absorbed));
  });
});

test("a chain summary carries no prior, because a demoted leaf never counted toward trust", async () => {
  await withStore(async (dir) => {
    await reassert(dir, CHAIN_ROLLUP_THRESHOLD + 1);
    const rollup = (await factRecords(dir)).find((r) => isChainRollupId(r.id));
    assert.equal(attrOf(rollup, ROLLUP_PRIOR_PROP), "");
    assert.ok(attrOf(rollup, ROLLUP_EARLIEST_PROP), "but it does keep the span it absorbed");
    assert.ok(attrOf(rollup, ROLLUP_LATEST_PROP));
  });
});

test("a compacted chain stays walkable: the oldest leaf still standing points at the summary", async () => {
  await withStore(async (dir) => {
    const groupId = await reassert(dir, CHAIN_ROLLUP_THRESHOLD + 1);
    const records = await factRecords(dir);
    const rollupId = chainRollupIdFor(groupId, "src:teach-chat:solo");
    const pointsAtRollup = records.filter((r) => attrOf(r, "mgx:supersedes") === rollupId);
    assert.equal(pointsAtRollup.length, 1, "exactly one leaf bridges to the summary");
    assert.ok(/#v[0-9]+$/.test(pointsAtRollup[0].id));
  });
});

test("a chain summary never joins the group fold, because it was never a vote", async () => {
  await withStore(async (dir) => {
    await reassert(dir, CHAIN_ROLLUP_THRESHOLD + 1);
    const [row] = readFactRows(await loadMemory(dir));
    assert.equal(row.assertions.length, 1, "one live head, and nothing from the compacted history");
    assert.ok(!row.assertions.some((a) => isChainRollupId(a.id)));
  });
});

// ---- Replication safety ----------------------------------------------------

const rollupFixture = (id, { ids, prop, earliest, latest, prior }) => ({
  id,
  label: "dog mgx:capableOf bark",
  class: "Fact",
  derived_from: [],
  mentions: [],
  attributes: [
    { prop: "rdf:type", key: "type", value: "rdf:Statement" },
    { prop: "rdf:subject", key: "subject", value: "dog" },
    { prop: "rdf:predicate", key: "predicate", value: "mgx:capableOf" },
    { prop: "rdf:object", key: "object", value: "bark" },
    { prop: "mgx:createdAt", key: "createdAt", value: earliest },
    { prop: "mgx:sourceId", key: "sourceId", value: "rollup:corpus" },
    { prop, key: "rollupSourceIds", value: ids.join(" ") },
    { prop: ROLLUP_COUNT_PROP, key: "rollupCount", value: String(ids.length) },
    { prop: ROLLUP_EARLIEST_PROP, key: "rollupEarliest", value: earliest },
    { prop: ROLLUP_LATEST_PROP, key: "rollupLatest", value: latest },
    ...(prior === undefined ? [] : [{ prop: ROLLUP_PRIOR_PROP, key: "rollupPrior", value: String(prior) }]),
  ],
});

test("two peers that compacted the same group at different moments converge, in either order", () => {
  const id = headRollupIdFor("fact:abcd1234abcd1234", "corpus");
  const priorFor = () => 0.7;
  const peerA = rollupFixture(id, {
    ids: ["src:corpus:a", "src:corpus:b", "src:corpus:c"],
    prop: ROLLUP_SOURCE_IDS_PROP,
    earliest: "2026-01-01T00:00:00.000Z",
    latest: "2026-03-01T00:00:00.000Z",
    prior: 0.973,
  });
  const peerB = rollupFixture(id, {
    ids: ["src:corpus:c", "src:corpus:d"],
    prop: ROLLUP_SOURCE_IDS_PROP,
    earliest: "2026-02-01T00:00:00.000Z",
    latest: "2026-05-01T00:00:00.000Z",
    prior: 0.91,
  });

  const aThenB = mergeRollups(peerA, peerB, { priorFor });
  const bThenA = mergeRollups(peerB, peerA, { priorFor });
  assert.deepEqual(aThenB, bThenA, "merge is commutative — the same summary either way");

  assert.deepEqual(
    absorbedSourceIds(aThenB),
    ["src:corpus:a", "src:corpus:b", "src:corpus:c", "src:corpus:d"],
    "the absorbed ids union rather than one side winning",
  );
  assert.equal(attrOf(aThenB, ROLLUP_COUNT_PROP), "4", "the count is re-derived from the union, not summed");
  assert.equal(attrOf(aThenB, ROLLUP_EARLIEST_PROP), "2026-01-01T00:00:00.000Z", "min of earliest");
  assert.equal(attrOf(aThenB, ROLLUP_LATEST_PROP), "2026-05-01T00:00:00.000Z", "max of latest");
  assert.equal(
    attrOf(aThenB, ROLLUP_PRIOR_PROP),
    String(noisyOr([0.7, 0.7, 0.7, 0.7])),
    "the prior is recomputed over the union, never carried over from either side",
  );
});

test("merging a summary that is already absorbed changes nothing", () => {
  const id = headRollupIdFor("fact:abcd1234abcd1234", "corpus");
  const priorFor = () => 0.7;
  const peerA = rollupFixture(id, {
    ids: ["src:corpus:a", "src:corpus:b"],
    prop: ROLLUP_SOURCE_IDS_PROP,
    earliest: "2026-01-01T00:00:00.000Z",
    latest: "2026-03-01T00:00:00.000Z",
    prior: 0.91,
  });
  const merged = mergeRollups(peerA, peerA, { priorFor });
  assert.deepEqual(mergeRollups(merged, peerA, { priorFor }), merged, "idempotent under re-delivery");
});

test("a chain summary merges by union too, and gains no prior on the way through", () => {
  const id = chainRollupIdFor("fact:abcd1234abcd1234", "src:teach-chat:solo");
  const leaf = (n) => `fact:abcd1234abcd1234@src:teach-chat:solo#v${n}`;
  const peerA = rollupFixture(id, {
    ids: [leaf(1), leaf(2)],
    prop: ROLLUP_RECORD_IDS_PROP,
    earliest: "2026-01-01T00:00:00.000Z",
    latest: "2026-02-01T00:00:00.000Z",
  });
  const peerB = rollupFixture(id, {
    ids: [leaf(2), leaf(3)],
    prop: ROLLUP_RECORD_IDS_PROP,
    earliest: "2026-01-15T00:00:00.000Z",
    latest: "2026-03-01T00:00:00.000Z",
  });
  const merged = mergeRollups(peerA, peerB, { priorFor: () => 0.7 });
  assert.deepEqual(absorbedRecordIds(merged), [leaf(1), leaf(2), leaf(3)]);
  assert.deepEqual(merged, mergeRollups(peerB, peerA, { priorFor: () => 0.7 }));
  assert.equal(attrOf(merged, ROLLUP_PRIOR_PROP), "", "a chain summary stays trust-free even when a prior is offered");
});

test("a re-synced copy of an absorbed assertion stays absorbed instead of returning as a live head", async () => {
  await withStore(async (dir) => {
    await appendFacts(dir, distinctTeachRows(GROUP_ROLLUP_THRESHOLD));
    const before = await factRecords(dir);
    const rollup = before.find((r) => isHeadRollupId(r.id));
    const [absorbedSource] = absorbedSourceIds(rollup);
    assert.ok(absorbedSource, "the fixture actually absorbed something");

    // The same source says the same thing again, exactly as a late mesh
    // delivery or a re-run sync would replay it.
    await appendFacts(dir, [{ ...TRIPLE, provenance: teachTag(1) }]);

    const after = await factRecords(dir);
    assert.equal(after.length, before.length, "no record reappears");
    assert.ok(
      !after.some((r) => r.id.endsWith(`@${absorbedSource}`)),
      "the absorbed source gets no live head back",
    );
    assert.deepEqual(
      absorbedSourceIds(after.find((r) => isHeadRollupId(r.id))),
      absorbedSourceIds(rollup),
      "and the summary is unchanged by the replay",
    );
  });
});

test("compacting a group twice keeps one summary holding both absorptions", async () => {
  await withStore(async (dir) => {
    await appendFacts(dir, distinctTeachRows(GROUP_ROLLUP_THRESHOLD));
    const firstPass = absorbedSourceIds((await factRecords(dir)).find((r) => isHeadRollupId(r.id)));

    // Enough further sources to carry the kept window back over the threshold.
    const second = Array.from(
      { length: GROUP_ROLLUP_THRESHOLD - ROLLUP_KEEP_PER_TYPE },
      (_, i) => ({ ...TRIPLE, provenance: teachTag(GROUP_ROLLUP_THRESHOLD + i + 1) }),
    );
    await appendFacts(dir, second);

    const records = await factRecords(dir);
    const rollups = records.filter((r) => isHeadRollupId(r.id));
    assert.equal(rollups.length, 1, "one summary per type, never a chain of them");

    const absorbed = absorbedSourceIds(rollups[0]);
    for (const id of firstPass) assert.ok(absorbed.includes(id), `${id} stays absorbed across a second pass`);
    assert.equal(attrOf(rollups[0], ROLLUP_COUNT_PROP), String(absorbed.length));
    assert.equal(records.filter((r) => !isHeadRollupId(r.id)).length, ROLLUP_KEEP_PER_TYPE);
  });
});

// ---- Reading a compacted group ---------------------------------------------

test("a head summary folds into group trust as one pseudo-record, decayed off the span it absorbed", () => {
  const groupId = "fact:abcd1234abcd1234";
  const latest = "2026-01-01T00:00:00.000Z";
  const memory = {
    individuals: [
      rollupFixture(headRollupIdFor(groupId, "corpus"), {
        ids: ["src:corpus:a", "src:corpus:b"],
        prop: ROLLUP_SOURCE_IDS_PROP,
        earliest: "2025-06-01T00:00:00.000Z",
        latest,
        prior: 0.91,
      }),
    ],
    objectProperties: [],
  };

  const fresh = readFactRows(memory, { now: Date.parse(latest) });
  assert.equal(fresh.length, 1);
  const [row] = fresh;
  assert.equal(row.id, groupId);
  assert.equal(row.subject, "dog");
  assert.equal(row.assertions.length, 1, "the whole summary reads as ONE record in the fold");

  const [pseudo] = row.assertions;
  assert.equal(pseudo.ownTrust, 0.91, "its own weight is the stored noisy-OR base");
  assert.equal(pseudo.assertedAt, latest, "and its recency clock is the newest assertion it absorbed");
  assert.equal(pseudo.rollup.count, 2);
  assert.deepEqual(row.sourceIds, ["src:corpus:a", "src:corpus:b"], "the absorbed sources still read as vouching");

  // Recency is applied at READ time off rollupLatest, never baked into the
  // stored prior: the same record read much later scores lower.
  assert.equal(row.trust, 0.91);
  const [aged] = readFactRows(memory, { now: Date.parse(latest) + 365 * 24 * 60 * 60 * 1000 });
  assert.ok(aged.trust < row.trust, "a summary ages like any other record");
  assert.ok(aged.trust >= 0.91 * 0.9, "and stays inside the recency band's floor");
});

test("a head summary corroborates the live heads beside it rather than replacing them", () => {
  const groupId = "fact:abcd1234abcd1234";
  const now = Date.parse("2026-01-01T00:00:00.000Z");
  const head = {
    id: `${groupId}@src:corpus:live`,
    label: "dog mgx:capableOf bark",
    class: "Fact",
    attributes: [
      { prop: "rdf:subject", key: "subject", value: "dog" },
      { prop: "rdf:predicate", key: "predicate", value: "mgx:capableOf" },
      { prop: "rdf:object", key: "object", value: "bark" },
      { prop: "mgx:sourceId", key: "sourceId", value: "src:corpus:live" },
      { prop: "mgx:createdAt", key: "createdAt", value: "2026-01-01T00:00:00.000Z" },
      { prop: "mgx:trustScore", key: "trustScore", value: "0.7" },
    ],
  };
  const rollup = rollupFixture(headRollupIdFor(groupId, "corpus"), {
    ids: ["src:corpus:a"],
    prop: ROLLUP_SOURCE_IDS_PROP,
    earliest: "2026-01-01T00:00:00.000Z",
    latest: "2026-01-01T00:00:00.000Z",
    prior: 0.7,
  });

  const [row] = readFactRows({ individuals: [head, rollup], objectProperties: [] }, { now });
  assert.equal(row.assertions.length, 2);
  assert.equal(row.trust, noisyOr([0.7, 0.7]), "the summary is one more term in the same noisy-OR");
});

test("a head summary projects its own type and prior into the indexed fact columns", async () => {
  await withStore(async (dir) => {
    const handle = await createSqliteMemoryStore(join(dir, "graph.sqlite"));
    try {
      await appendFacts(handle, distinctTeachRows(GROUP_ROLLUP_THRESHOLD));
      const rows = handle.db.prepare("SELECT * FROM facts ORDER BY id").all();
      const rollupRow = rows.find((r) => isHeadRollupId(r.id));
      assert.ok(rollupRow, "the summary reaches the projection like any other record");
      // A summary has no tag and no Source of its own, so both of these would
      // read empty/zero without the projection knowing what a summary is.
      assert.equal(rollupRow.source_type, "teach", "its type comes off the id that carries it");
      assert.ok(rollupRow.trust_score > 0, "and its weight is the rollup prior, not a missing trustScore");
      assert.equal(rollupRow.superseded_by, null, "a summary is a live head");
      assert.equal(rows.filter((r) => !isHeadRollupId(r.id)).length, ROLLUP_KEEP_PER_TYPE);
    } finally {
      closeSqliteMemoryStore(handle);
    }
  });
});

test("every rollup record shape the write path mints passes the store's own validity gate", async () => {
  await withStore(async (dir) => {
    await appendFacts(dir, distinctTeachRows(GROUP_ROLLUP_THRESHOLD));
    await reassert(dir, CHAIN_ROLLUP_THRESHOLD + 1);
    const rollups = (await factRecords(dir)).filter((r) => isHeadRollupId(r.id) || isChainRollupId(r.id));
    assert.ok(rollups.length >= 2, "both pools produced a summary to check");
    for (const rollup of rollups) await assertIndividualValid(rollup);
  });
});
