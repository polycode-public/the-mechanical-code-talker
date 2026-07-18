// The child triples pack's two halves: the pure contract (shard naming,
// row/index shapes, the provenance tag) and the lazy fs loader with its
// provider seam. Driven by the hand-written mini-pack in
// test/fixtures/child-pack/, which mirrors the real pack's layout exactly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHILD_PACK_NAME, CHILD_SHARD_COUNT, shardNameFor,
  isChildIndexEntry, isChildFact, isChildFactsRow, childProvenanceTag,
} from "../../src/domain/child-pack.mjs";
import { fnv1aHex, normFactTerm } from "../../src/domain/hash.mjs";
import { provenanceTagToSource } from "../../src/domain/memory/trust.mjs";
import {
  childPackDir, loadChildIndex, loadChildFacts,
  registerChildPackProvider, getChildPackProvider, clearChildPackCache,
} from "../../src/adapters/corpus/child-pack.mjs";

const FIXTURE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "child-pack");

const factOf = (subject, predicate, object, weight) => ({ subject, predicate, object, ...(weight ? { weight } : {}) });
const rowOf = (term, facts) => ({ term, facts });

async function writePack(dir, rows, { indexOverride } = {}) {
  await mkdir(join(dir, "shards"), { recursive: true });
  const byShard = new Map();
  const index = {};
  for (const r of rows) {
    const s = shardNameFor(r.term);
    if (!byShard.has(s)) byShard.set(s, []);
    byShard.get(s).push(r);
    index[r.term] = { s, t: r.term, n: r.facts.length };
  }
  for (const [s, shardRows] of byShard) {
    await writeFile(join(dir, "shards", `${s}.jsonl.gz`), gzipSync(shardRows.map((r) => JSON.stringify(r)).join("\n")));
  }
  await writeFile(join(dir, "index.json.gz"), gzipSync(JSON.stringify(indexOverride ?? index)));
}

// ---- the pure contract ------------------------------------------------------

test("shardNameFor is the normFactTerm FNV-1a first byte mod 32, spelled child-00 … child-1f", () => {
  for (const term of ["penguin", "Penguin", "the penguin", "teddy bear", ""]) {
    const expected = parseInt(fnv1aHex(normFactTerm(term)).slice(0, 2), 16) % CHILD_SHARD_COUNT;
    assert.equal(shardNameFor(term), `child-${expected.toString(16).padStart(2, "0")}`);
  }
  assert.match(shardNameFor("anything"), /^child-[0-1][0-9a-f]$/);
  // normFactTerm folds case and a leading article (not plurals — that lemma
  // fold is the caller's, exactly as the reference pack expects)
  assert.equal(shardNameFor("The Penguin"), shardNameFor("penguin"), "case and article fold, so spellings converge");
});

test("index-entry, fact and row validators accept the shipped shapes and reject near-misses", () => {
  assert.ok(isChildIndexEntry({ s: "child-1a", t: "penguin", n: 3 }));
  assert.ok(!isChildIndexEntry({ s: "child-2a", t: "penguin", n: 1 }), "shard out of range (>= 32)");
  assert.ok(!isChildIndexEntry({ s: "child-1a", t: "", n: 1 }));
  assert.ok(!isChildIndexEntry({ s: "child-1a", t: "penguin", n: 0 }), "a zero-fact row is never indexed");
  assert.ok(!isChildIndexEntry(null));

  assert.ok(isChildFact(factOf("penguin", "rdfs:subClassOf", "bird")));
  assert.ok(isChildFact(factOf("penguin", "mgxneg:capableOf", "fly", 2)));
  assert.ok(!isChildFact(factOf("penguin", "rdfs:subClassOf", "")));
  assert.ok(!isChildFact({ subject: "penguin", predicate: "rdfs:subClassOf", object: "bird", weight: 0 }), "weight, when present, is positive");
  assert.ok(!isChildFact({ subject: "penguin", predicate: "rdfs:subClassOf", object: "bird", weight: "2" }), "weight is a number");

  const row = rowOf("penguin", [factOf("penguin", "rdfs:subClassOf", "bird"), factOf("owl", "rdfs:subClassOf", "penguin")]);
  assert.ok(isChildFactsRow(row), "a fact touching the term as subject OR object is in-row");
  assert.ok(!isChildFactsRow(rowOf("penguin", [])), "an empty row is invalid");
  assert.ok(!isChildFactsRow(rowOf("penguin", [factOf("robin", "rdfs:subClassOf", "bird")])), "a fact touching neither endpoint is rejected");
  assert.ok(!isChildFactsRow(rowOf("", [factOf("x", "p", "y")])));
});

test("childProvenanceTag emits the tag trust.mjs parses back to the shared conceptnet corpus Source", () => {
  assert.equal(childProvenanceTag("Penguin"), "child:conceptnet:penguin");
  assert.equal(childProvenanceTag("the teddy bear"), "child:conceptnet:teddy bear");
  assert.deepEqual(provenanceTagToSource(childProvenanceTag("penguin")), { kind: "corpus", name: CHILD_PACK_NAME });
});

// ---- the fs loader over the committed mini-pack -----------------------------

test("the fixture pack loads: a known term returns its full triples row, normalised keys converge", () => {
  clearChildPackCache();
  const penguin = loadChildFacts(FIXTURE_DIR, "penguin");
  assert.ok(isChildFactsRow(penguin));
  assert.ok(penguin.facts.some((f) => f.predicate === "rdfs:subClassOf" && f.object === "bird"), "penguin is a bird");
  assert.ok(penguin.facts.some((f) => f.predicate === "mgxneg:capableOf" && f.object === "fly"), "penguin cannot fly (the negation datum)");
  assert.deepEqual(loadChildFacts(FIXTURE_DIR, "Penguin"), penguin, "a case variant folds to the same row");
  assert.deepEqual(loadChildFacts(FIXTURE_DIR, "the penguin"), penguin, "a leading article is normalised away");
  const teddy = loadChildFacts(FIXTURE_DIR, "teddy bear");
  assert.equal(teddy.term, "teddy bear", "a multiword term keys on its normFactTerm");
});

test("an unindexed term returns null even when a shard holds a row for it — the index is the only door", () => {
  clearChildPackCache();
  // the fixture plants a heron row in its shard but not in the index
  assert.equal(loadChildFacts(FIXTURE_DIR, "heron"), null);
});

test("an absent pack dir reads as null, never a throw", () => {
  clearChildPackCache();
  const nowhere = join(tmpdir(), "tmct-no-such-child-pack-dir");
  assert.equal(loadChildIndex(nowhere), null);
  assert.equal(loadChildFacts(nowhere, "penguin"), null);
});

test("a corrupt shard reads as null, never a throw", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-childpack-corrupt-"));
  try {
    const s = shardNameFor("penguin");
    await mkdir(join(dir, "shards"), { recursive: true });
    await writeFile(join(dir, "index.json.gz"), gzipSync(JSON.stringify({ penguin: { s, t: "penguin", n: 1 } })));
    await writeFile(join(dir, "shards", `${s}.jsonl.gz`), Buffer.from("this is not gzip"));
    clearChildPackCache();
    assert.equal(loadChildFacts(dir, "penguin"), null);
  } finally {
    clearChildPackCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("index and shards are cached per dir: a disk mutation is invisible until the cache is cleared", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-childpack-cache-"));
  try {
    await writePack(dir, [rowOf("penguin", [factOf("penguin", "rdfs:subClassOf", "bird", 1)])]);
    clearChildPackCache();
    assert.equal(loadChildFacts(dir, "penguin").facts[0].weight, 1);
    await writePack(dir, [rowOf("penguin", [factOf("penguin", "rdfs:subClassOf", "bird", 9)])]);
    assert.equal(loadChildFacts(dir, "penguin").facts[0].weight, 1, "served from cache, no re-read");
    clearChildPackCache();
    assert.equal(loadChildFacts(dir, "penguin").facts[0].weight, 9);
  } finally {
    clearChildPackCache();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- the provider seam ------------------------------------------------------

test("the default provider is the fs loader over childPackDir (TMCT_CHILD_PACK_DIR wins)", async () => {
  assert.equal(childPackDir({ TMCT_CHILD_PACK_DIR: "/somewhere/else" }), "/somewhere/else");
  const prior = process.env.TMCT_CHILD_PACK_DIR;
  process.env.TMCT_CHILD_PACK_DIR = FIXTURE_DIR;
  try {
    clearChildPackCache();
    const hit = await getChildPackProvider().lookup("penguin");
    assert.ok(hit.facts.some((f) => f.object === "bird"));
    assert.equal(await getChildPackProvider().lookup("heron"), null);
  } finally {
    if (prior === undefined) delete process.env.TMCT_CHILD_PACK_DIR;
    else process.env.TMCT_CHILD_PACK_DIR = prior;
    clearChildPackCache();
  }
});

test("a registered provider replaces the fs loader; null restores it", async () => {
  const canned = rowOf("penguin", [factOf("penguin", "rdfs:subClassOf", "bird")]);
  try {
    registerChildPackProvider({ lookup: async (t) => (t === "penguin" ? canned : null) });
    assert.deepEqual(await getChildPackProvider().lookup("penguin"), canned);
    assert.equal(await getChildPackProvider().lookup("owl"), null);
  } finally {
    registerChildPackProvider(null);
  }
  assert.equal(typeof getChildPackProvider().lookup, "function", "the default seam is back");
});

// ---- fixture integrity ------------------------------------------------------

test("the committed fixture pack matches its own manifest byte-for-byte", async () => {
  const manifest = JSON.parse(await readFile(join(FIXTURE_DIR, "manifest.json"), "utf8"));
  assert.ok(manifest.files.length >= 5, "index + shards + notice");
  for (const entry of manifest.files) {
    const body = await readFile(join(FIXTURE_DIR, entry.file));
    assert.equal(body.length, entry.bytes, `${entry.file}: byte count drifted`);
    assert.equal(createHash("sha256").update(body).digest("hex"), entry.sha256, `${entry.file}: sha256 drifted`);
  }
});
