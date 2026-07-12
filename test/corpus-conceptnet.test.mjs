// corpus/conceptnet tests — the committed tech-domain slice, the relation →
// ACE-OWL mapping table, and the memory seeder (ROADMAP Phase 2).
//
// The load-bearing guarantee is the DRIFT GUARD: every relation present in
// corpus/conceptnet/slice.jsonl must have a row in src/corpus/conceptnet-map.toml
// — regenerating the slice can never silently outrun the mapping.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SLICE_FILE, MAP_FILE, loadSlice, loadMap, toFacts, termText, seedMemory,
} from "../src/corpus/conceptnet.mjs";
import { bareEnTerm, toRow, CANONICAL_RELS } from "../corpus/conceptnet/fetch-slice.mjs";
import { loadMemory, normFactTerm } from "../src/memory/core.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import { lookupByProseTokens } from "../src/prose.mjs";

const attr = (ind, key) => (ind?.attributes || []).find((a) => a.key === key)?.value;

test("slice: loads, en→en only, well-shaped, within the 5 MB budget", async () => {
  const assertions = await loadSlice();
  assert.ok(assertions.length >= 300, `a real slice, not a stub (got ${assertions.length})`);
  const seen = new Set();
  for (const a of assertions) {
    assert.match(a.start, /^\/c\/en\/[^/]+$/, `en start, sense-stripped: ${a.start}`);
    assert.match(a.end, /^\/c\/en\/[^/]+$/, `en end, sense-stripped: ${a.end}`);
    assert.match(a.rel, /^\/r\/[A-Za-z]+$/);
    assert.equal(typeof a.weight, "number");
    const key = `${a.start} ${a.rel} ${a.end}`;
    assert.ok(!seen.has(key), `no duplicate assertion: ${key}`);
    seen.add(key);
  }
  const { size } = await stat(SLICE_FILE);
  assert.ok(size <= 5_000_000, `slice stays within budget: ${size} bytes`);
});

test("drift guard: every relation in the slice has a mapping row; the table is the full canonical set", async () => {
  const [assertions, map] = await Promise.all([loadSlice(), loadMap()]);
  const inSlice = new Set(assertions.map((a) => a.rel));
  for (const rel of inSlice) {
    assert.ok(map.has(rel), `slice relation ${rel} missing from conceptnet-map.toml`);
  }
  // the table covers the whole canonical closed set (34 relations), so a
  // future regeneration cannot surface an unmapped canonical relation
  assert.equal(map.size, 34);
  for (const rel of CANONICAL_RELS) assert.ok(map.has(rel), `${rel} mapped`);
  for (const [rel, row] of map) {
    assert.ok(row.surface.includes("{start}") && row.surface.includes("{end}"), `${rel} surface template is slotted`);
    if (row.ace !== "none") assert.match(row.predicate, /^(rdfs|owl|mgx):/, `${rel} emits a namespaced predicate`);
  }
  // toFacts consumes the whole slice without throwing — the executable form of the guard
  assert.ok(toFacts(assertions, map).length > 0);
});

test("toFacts: mapped relations become appendFact-shaped triples; none-rows skipped; unmapped throws", async () => {
  const map = await loadMap();
  const facts = toFacts([
    { start: "/c/en/software_bug", rel: "/r/IsA", end: "/c/en/error", weight: 2 },
    { start: "/c/en/computer", rel: "/r/DerivedFrom", end: "/c/en/compute", weight: 1 }, // ace=none
  ], map);
  assert.deepEqual(facts, [{
    subject: "software bug",
    predicate: "rdfs:subClassOf",
    object: "error",
    provenance: "corpus:conceptnet /r/IsA",
  }]);
  assert.throws(
    () => toFacts([{ start: "/c/en/a", rel: "/r/MadeUpRel", end: "/c/en/b" }], map),
    /slice\/map drift: relation \/r\/MadeUpRel/,
  );
  assert.equal(termText("/c/en/source_code"), "source code");
  assert.equal(termText("not-a-concept"), null);
});

test("toFacts: /r/RelatedTo now emits (re-examined 2026-07-12, TOO_HARD_AUDIT.md) routed through the corpus-weak: provenance prefix, not the plain corpus: prefix other relations use", async () => {
  const map = await loadMap();
  const facts = toFacts([
    { start: "/c/en/software", rel: "/r/RelatedTo", end: "/c/en/computer", weight: 1 },
  ], map);
  assert.deepEqual(facts, [{
    subject: "software",
    predicate: "mgx:relatedTo",
    object: "computer",
    provenance: "corpus-weak:conceptnet /r/RelatedTo",
  }]);
});

test("toFacts: /r/Synonym, /r/Antonym, /r/SimilarTo emit real facts at full corpus trust (only RelatedTo is weak)", async () => {
  const map = await loadMap();
  const facts = toFacts([
    { start: "/c/en/couch", rel: "/r/Synonym", end: "/c/en/sofa", weight: 1 },
    { start: "/c/en/hot", rel: "/r/Antonym", end: "/c/en/cold", weight: 1 },
    { start: "/c/en/creek", rel: "/r/SimilarTo", end: "/c/en/stream", weight: 1 },
  ], map);
  assert.deepEqual(facts, [
    { subject: "couch", predicate: "mgx:synonym", object: "sofa", provenance: "corpus:conceptnet /r/Synonym" },
    { subject: "hot", predicate: "mgx:antonym", object: "cold", provenance: "corpus:conceptnet /r/Antonym" },
    { subject: "creek", predicate: "mgx:similarTo", object: "stream", provenance: "corpus:conceptnet /r/SimilarTo" },
  ]);
});

test("toFacts: /r/SymbolOf now emits (re-examined 2026-07-12, TOO_HARD_AUDIT.md — same stale shape as RelatedTo) at full corpus trust", async () => {
  const map = await loadMap();
  const facts = toFacts([
    { start: "/c/en/dove", rel: "/r/SymbolOf", end: "/c/en/peace", weight: 1 },
  ], map);
  assert.deepEqual(facts, [
    { subject: "dove", predicate: "mgx:symbolOf", object: "peace", provenance: "corpus:conceptnet /r/SymbolOf" },
  ]);
});

test("fetch filter rules: bare en terms, canonical rels only, policy-filtered rels dropped", () => {
  assert.equal(bareEnTerm("/c/en/dog/n"), "/c/en/dog");
  assert.equal(bareEnTerm("/c/fr/chien"), null);
  const mk = (rel, start, end) => ({ rel: { "@id": rel }, start: { "@id": start }, end: { "@id": end }, weight: 2, surfaceText: "s" });
  assert.deepEqual(
    toRow(mk("/r/IsA", "/c/en/bug/n", "/c/en/insect")),
    { start: "/c/en/bug", rel: "/r/IsA", end: "/c/en/insect", weight: 2, surfaceText: "s" },
  );
  assert.equal(toRow(mk("/r/ExternalURL", "/c/en/bug", "/c/en/x")), null, "policy-filtered rel dropped");
  assert.equal(toRow(mk("/r/NotARelation", "/c/en/bug", "/c/en/x")), null, "unknown rel dropped, not an error");
  assert.equal(toRow(mk("/r/IsA", "/c/en/bug", "/c/de/käfer")), null, "non-en endpoint dropped");
  assert.equal(toRow(mk("/r/IsA", "/c/en/bug/n", "/c/en/bug/v")), null, "self-loop after sense-stripping dropped");
});

test("seedMemory: facts land in .tmct/memory via appendFact, retrievable via loadMemory; re-seed is a no-op", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-corpus-seed-"));
  try {
    const first = await seedMemory(dir, { limit: 25 });
    assert.equal(first.total, 25);
    assert.ok(first.appended >= 20, `most of the first 25 are distinct facts (got ${first.appended})`);
    assert.equal(first.appended + first.skipped, first.total);

    const m = await loadMemory(dir);
    const facts = m.individuals.filter((i) => i.class === "Fact");
    assert.equal(facts.length, first.appended, "every appended fact is a Fact individual");
    for (const f of facts) {
      assert.equal(attr(f, "type"), "rdf:Statement");
      assert.equal(attr(f, "subject"), normFactTerm(attr(f, "subject")), "terms stored normalized (lowercase, no /c/en/)");
      assert.match(attr(f, "provenance"), /corpus:conceptnet \/r\//);
    }
    // and the store is a queryable graph: parseEntities + prose lookup work
    const g = parseEntities(m);
    const some = facts[0];
    assert.ok(g.byId.has(some.id));
    const hits = lookupByProseTokens(g.proseIndex, attr(some, "subject"));
    assert.ok(hits.some((h) => h.id === some.id), "a seeded fact is findable by its words");

    // idempotent: the same call again appends nothing and rewrites nothing
    const again = await seedMemory(dir, { limit: 25 });
    assert.deepEqual(
      { appended: again.appended, skipped: again.skipped, total: again.total },
      { appended: 0, skipped: 25, total: 25 },
    );
    const m2 = await loadMemory(dir);
    assert.equal(m2.individuals.filter((i) => i.class === "Fact").length, first.appended, "no duplicates on re-seed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("loadSlice/loadMap: bad data fails loudly (file:line for JSONL; named relation for the table)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-corpus-bad-"));
  try {
    const badSlice = join(dir, "bad.jsonl");
    await writeFile(badSlice, '{"start":"/c/en/a","rel":"/r/IsA","end":"/c/en/b"}\nnot json\n');
    await assert.rejects(() => loadSlice(badSlice), /bad\.jsonl:2: not valid JSON/);
    await writeFile(badSlice, '{"start":"/c/en/a","end":"/c/en/b"}\n');
    await assert.rejects(() => loadSlice(badSlice), /assertion missing "rel"/);

    const badMap = join(dir, "bad.toml");
    await writeFile(badMap, '[[relation]]\nrel = "/r/IsA"\nsurface = "{start} {end}"\nace = "wibble"\n');
    await assert.rejects(() => loadMap(badMap), /unknown ace pattern "wibble"/);
    await writeFile(badMap, '[[relation]]\nrel = "/r/IsA"\nsurface = "{start} {end}"\nace = "subClassOf"\n');
    await assert.rejects(() => loadMap(badMap), /names no predicate URI/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
