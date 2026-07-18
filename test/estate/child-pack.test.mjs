// scripts/fetch-child-corpus.mjs builds corpus/child/ from the pinned ConceptNet
// 5.7.0 dump against corpus/conceptnet/child-seed.mjs. The build phases are pure
// exported functions, driven here over a hand-written dump-row fixture so the
// map/filter/shard/emit pipeline is pinned without any dump on disk. The
// committed-pack guards at the bottom activate only where corpus/child/ has
// actually been built (mirrored on reference-pack.test.mjs's missing-pack skip).

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  mapChildFacts, buildRowsByTerm, emitChildPack,
  BUDGET_SHARDS_GZ_BYTES, BUDGET_INDEX_GZ_BYTES, BUDGET_FACTS, CHILD_PER_TERM_CAP,
  CHILD_ADMITTED_RELS, CHILD_LICENSE_NOTICE,
} from "../../scripts/fetch-child-corpus.mjs";
import { shardNameFor, isChildFactsRow, isChildIndexEntry, CHILD_SHARD_COUNT } from "../../src/domain/child-pack.mjs";
import { loadMap } from "../../src/adapters/corpus/conceptnet.mjs";
import { normFactTerm } from "../../src/domain/hash.mjs";
import { loadChildFacts, clearChildPackCache } from "../../src/adapters/corpus/child-pack.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PACK_DIR = join(REPO_ROOT, "corpus", "child");

const edge = (start, rel, end, weight = 1) => ({ start: `/c/en/${start}`, rel, end: `/c/en/${end}`, weight });

// ---- the mapping + row-building steps, individually -------------------------

test("the admitted relation set is the canonical 34 plus exactly /r/NotCapableOf", () => {
  assert.ok(CHILD_ADMITTED_RELS.has("/r/NotCapableOf"));
  assert.ok(CHILD_ADMITTED_RELS.has("/r/IsA"));
  assert.ok(!CHILD_ADMITTED_RELS.has("/r/NotDesires"), "no other /r/Not* is admitted");
});

test("mapChildFacts maps through conceptnet-map.toml, drops ace=none and the weak relation, throws on drift", async () => {
  const map = await loadMap();
  const facts = mapChildFacts([
    edge("penguin", "/r/IsA", "bird", 2),
    edge("penguin", "/r/NotCapableOf", "fly", 3),
    edge("bird", "/r/CapableOf", "fly", 4),
    edge("bird", "/r/RelatedTo", "sky"),      // mgx:relatedTo — dropped (weak tier)
    edge("bird", "/r/HasContext", "biology"), // ace=none — dropped
  ], map);
  assert.deepEqual(facts, [
    { subject: "penguin", predicate: "rdfs:subClassOf", object: "bird", weight: 2 },
    { subject: "penguin", predicate: "mgxneg:capableOf", object: "fly", weight: 3 },
    { subject: "bird", predicate: "mgx:capableOf", object: "fly", weight: 4 },
  ]);
  assert.throws(() => mapChildFacts([edge("a", "/r/MadeUpRel", "b")], map), /slice\/map drift: relation \/r\/MadeUpRel/);
});

test("buildRowsByTerm double-keys each edge under both endpoints and caps a term at CHILD_PER_TERM_CAP", () => {
  const facts = [
    { subject: "penguin", predicate: "rdfs:subClassOf", object: "bird", weight: 2 },
    { subject: "penguin", predicate: "mgx:capableOf", object: "swim", weight: 3 },
  ];
  const rows = buildRowsByTerm(facts);
  assert.deepEqual([...rows.keys()].sort(), ["bird", "penguin", "swim"]);
  assert.ok(rows.get("bird").facts.some((f) => f.subject === "penguin" && f.object === "bird"), "bird's row carries the incoming edge");
  assert.equal(rows.get("penguin").facts.length, 2, "penguin keys both of its outgoing edges");

  // a hypernym flooded with incoming subclasses keeps its OWN facts first, then fills with kinds
  const flood = [{ subject: "bird", predicate: "mgx:capableOf", object: "fly", weight: 5 }];
  for (let i = 0; i < CHILD_PER_TERM_CAP + 20; i += 1) flood.push({ subject: `species${i}`, predicate: "rdfs:subClassOf", object: "bird", weight: 1 });
  const capped = buildRowsByTerm(flood).get("bird");
  assert.equal(capped.facts.length, CHILD_PER_TERM_CAP, "capped");
  assert.ok(capped.facts.some((f) => f.subject === "bird" && f.object === "fly"), "the term's own capability survives the flood of kinds");
});

// ---- the emit end-to-end over the fixture -----------------------------------

test("emitChildPack writes a byte-deterministic pack that round-trips through the loader", async () => {
  const map = await loadMap();
  const facts = mapChildFacts([
    edge("penguin", "/r/IsA", "bird", 2),
    edge("penguin", "/r/NotCapableOf", "fly", 3),
    edge("owl", "/r/IsA", "bird", 2),
    edge("bird", "/r/CapableOf", "fly", 4),
  ], map);
  const rows = buildRowsByTerm(facts);
  const out = await mkdtemp(join(tmpdir(), "tmct-childpack-emit-"));
  try {
    const manifest = emitChildPack(rows, out, { dump: { url: "u", mirror: "m", version: "5.7.0", sha256: "s" }, metrics: null, built: "2026-07-18" });
    assert.equal(manifest.counts.terms, rows.size);
    for (const f of manifest.files) {
      const body = readFileSync(join(out, f.file));
      assert.equal(createHash("sha256").update(body).digest("hex"), f.sha256, `${f.file}: manifest sha256 is the emitted bytes`);
    }
    clearChildPackCache();
    const penguin = loadChildFacts(out, "penguin");
    assert.ok(penguin.facts.some((f) => f.predicate === "mgxneg:capableOf" && f.object === "fly"), "the negation datum round-trips");

    const again = await mkdtemp(join(tmpdir(), "tmct-childpack-emit2-"));
    try {
      emitChildPack(rows, again, { dump: { url: "u", mirror: "m", version: "5.7.0", sha256: "s" }, metrics: null, built: "2026-07-18" });
      for (const f of manifest.files) {
        assert.deepEqual(readFileSync(join(again, f.file)), readFileSync(join(out, f.file)), `${f.file}: byte-deterministic emit`);
      }
    } finally {
      await rm(again, { recursive: true, force: true });
    }
  } finally {
    clearChildPackCache();
    await rm(out, { recursive: true, force: true });
  }
});

test("emitChildPack fails loudly on a blown fact budget instead of trimming", async () => {
  const rows = new Map();
  for (let i = 0; i <= BUDGET_FACTS; i += 1) rows.set(`t${i}`, { term: `t${i}`, facts: [{ subject: `t${i}`, predicate: "rdfs:subClassOf", object: "thing" }] });
  const out = await mkdtemp(join(tmpdir(), "tmct-childpack-budget-"));
  try {
    assert.throws(() => emitChildPack(rows, out, { dump: {}, metrics: null }), /budget/);
    assert.ok(!existsSync(join(out, "manifest.json")), "an over-budget build writes no manifest");
  } finally {
    await rm(out, { recursive: true, force: true });
  }
});

// ---- the committed pack, where it exists ------------------------------------

const missingPack = existsSync(join(PACK_DIR, "manifest.json"))
  ? false
  : "corpus/child/manifest.json absent — the child pack is not built in this checkout. "
    + "Run `npm run gen:child-corpus` (reads the pinned ConceptNet dump from ~/.cache/tmct-conceptnet/) to enable these guards.";

test("the committed pack matches its manifest byte-for-byte and stays inside its budgets", { skip: missingPack }, () => {
  const manifest = JSON.parse(readFileSync(join(PACK_DIR, "manifest.json"), "utf8"));
  let shardGz = 0;
  let indexGz = 0;
  for (const entry of manifest.files) {
    const body = readFileSync(join(PACK_DIR, entry.file));
    assert.equal(body.length, entry.bytes, `${entry.file}: byte count drifted from the manifest`);
    assert.equal(createHash("sha256").update(body).digest("hex"), entry.sha256, `${entry.file}: sha256 drifted from the manifest`);
    if (entry.file.startsWith("shards/")) shardGz += body.length;
    if (entry.file === "index.json.gz") indexGz = body.length;
  }
  assert.ok(shardGz > 0 && shardGz <= BUDGET_SHARDS_GZ_BYTES, `shards total ${shardGz} gz bytes within budget`);
  assert.ok(indexGz > 0 && indexGz <= BUDGET_INDEX_GZ_BYTES, `index ${indexGz} gz bytes within budget`);
  assert.ok(manifest.counts.facts > 0 && manifest.counts.facts <= BUDGET_FACTS, "fact count within budget");
});

test("the committed manifest pins the dump, records the seed, and carries the acceptance metrics", { skip: missingPack }, () => {
  const manifest = JSON.parse(readFileSync(join(PACK_DIR, "manifest.json"), "utf8"));
  assert.ok(manifest.dump?.url && manifest.dump?.sha256 && manifest.dump?.version, "the manifest pins the dump it was built from");
  assert.equal(manifest.seed?.file, "corpus/conceptnet/child-seed.mjs");
  assert.match(manifest.seed?.license || "", /MPL-2\.0/, "the seed is maintainer-owned, not a shipped external list");
  const m = manifest.acceptance;
  assert.ok(m, "the acceptance metrics are recorded");
  // floors, not exact numbers — a re-cut may shift these, but a catastrophic
  // regression (the plan's original "2 kinds of bird, 0 capabilities") fails
  assert.ok(m.kindsOfBird.count >= 100, `kinds of bird ${m.kindsOfBird.count} clears the plan's baseline of 2`);
  assert.ok(m.capabilitiesOnBirds.count >= 10, `capabilities on birds ${m.capabilitiesOnBirds.count}`);
  assert.ok(m.thingsThatCanFly.count >= 10, `things that can fly ${m.thingsThatCanFly.count}`);
});

test("the committed LICENSE-NOTICE is the one the build script emits (CC-BY-SA-4.0)", { skip: missingPack }, () => {
  assert.equal(readFileSync(join(PACK_DIR, "LICENSE-NOTICE"), "utf8"), CHILD_LICENSE_NOTICE);
  assert.match(CHILD_LICENSE_NOTICE, /CC-BY-SA 4\.0/);
});

test("every committed index entry names an existing shard holding its row", { skip: missingPack }, () => {
  const index = JSON.parse(gunzipSync(readFileSync(join(PACK_DIR, "index.json.gz"))).toString("utf8"));
  const shardRows = new Map();
  for (const [term, entry] of Object.entries(index)) {
    assert.ok(isChildIndexEntry(entry), `index["${term}"] is not a valid {s, t, n} entry`);
    if (!shardRows.has(entry.s)) {
      const file = join(PACK_DIR, "shards", `${entry.s}.jsonl.gz`);
      assert.ok(existsSync(file), `index["${term}"] names missing shard ${entry.s}`);
      const rows = new Map();
      for (const line of gunzipSync(readFileSync(file)).toString("utf8").split("\n")) {
        if (line.trim()) { const r = JSON.parse(line); rows.set(r.term, r); }
      }
      shardRows.set(entry.s, rows);
    }
    assert.ok(shardRows.get(entry.s).has(entry.t), `index["${term}"] points at "${entry.t}", absent from shard ${entry.s}`);
  }
});

test("every committed shard row is valid, correctly sharded, and a normFactTerm fixed point within the fact cap", { skip: missingPack }, () => {
  const manifest = JSON.parse(readFileSync(join(PACK_DIR, "manifest.json"), "utf8"));
  for (const entry of manifest.files) {
    if (!entry.file.startsWith("shards/")) continue;
    const shard = entry.file.slice("shards/".length).replace(/\.jsonl\.gz$/, "");
    for (const line of gunzipSync(readFileSync(join(PACK_DIR, entry.file))).toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      assert.ok(isChildFactsRow(row), `${entry.file}: malformed row ${line.slice(0, 80)}`);
      assert.equal(row.term, normFactTerm(row.term), `"${row.term}" is not a normFactTerm fixed point`);
      assert.equal(shardNameFor(row.term), shard, `"${row.term}" sits in the wrong shard`);
      assert.ok(row.facts.length <= CHILD_PER_TERM_CAP, `"${row.term}" has ${row.facts.length} facts, over the per-term cap`);
    }
  }
  assert.equal(CHILD_SHARD_COUNT, 32);
});
