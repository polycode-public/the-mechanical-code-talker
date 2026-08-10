// The offline pack-backed research source: reads the shipped reference pack
// off disk, never the network, and satisfies the research-source.mjs
// contract the live adapters (wikipedia-live.mjs, wikidata-live.mjs) also
// meet.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createSimpleWikipediaPackSource,
  SIMPLE_WIKIPEDIA_PACK_ORIGIN,
  SIMPLE_WIKIPEDIA_PACK_SOURCE_NAME,
} from "../../src/adapters/corpus/simple-wikipedia-pack.mjs";
import {
  isResearchSource, isResearchSourceRow, isResearchFact, researchFacts, researchSources,
} from "../../src/adapters/corpus/research-source.mjs";
import { provenanceTagToSource } from "../../src/domain/memory/trust.mjs";

function noNetworkFetch() {
  return async () => { throw new Error("simple-wikipedia-pack must never call fetch"); };
}

test("registers itself under its own name in the research-source registry", () => {
  const entry = researchSources().find((e) => e.name === SIMPLE_WIKIPEDIA_PACK_SOURCE_NAME);
  assert.ok(entry, "simple-wikipedia-pack is registered");
  assert.equal(typeof entry.create, "function");
});

test("names itself and the origin its content came from, satisfying the source contract", () => {
  const source = createSimpleWikipediaPackSource();
  assert.ok(isResearchSource(source));
  assert.equal(source.name, SIMPLE_WIKIPEDIA_PACK_SOURCE_NAME);
  assert.equal(source.origin, SIMPLE_WIKIPEDIA_PACK_ORIGIN);
});

test("its provenance tag names the pack source and reads back as a live-reference Source", () => {
  const source = createSimpleWikipediaPackSource();
  const tag = source.provenanceTag("owl");
  assert.equal(tag, "research:simple-wikipedia-pack:owl");
  const parsed = provenanceTagToSource(tag);
  assert.equal(parsed.kind, "referenceLive");
});

test("a term the shipped pack carries resolves to a valid article row, no fetch involved", async () => {
  globalThis.fetch = noNetworkFetch();
  try {
    const source = createSimpleWikipediaPackSource();
    const row = await source.lookup("owl");
    assert.ok(row, "owl grounds from the shipped pack");
    assert.ok(isResearchSourceRow(row));
    assert.equal(row.term, "owl");
    assert.equal(row.title, "Owl");
    assert.equal(row.isa, "bird");
    assert.match(row.url, /^https:\/\/simple\.wikipedia\.org\//);
  } finally {
    delete globalThis.fetch;
  }
});

test("a term the pack does not carry is a plain miss, not a throw", async () => {
  const source = createSimpleWikipediaPackSource();
  assert.equal(await source.lookup("zorblattian-nonsense-term"), null);
  assert.equal(await source.lookup(""), null);
  assert.equal(await source.lookup(null), null);
});

test("the lead sentence's isa licenses one subClassOf fact under this source's own tag", async () => {
  const source = createSimpleWikipediaPackSource();
  const row = await source.lookup("owl");
  const facts = researchFacts(source, "owl", row);
  assert.deepEqual(facts, [{
    subject: "owl",
    predicate: "rdfs:subClassOf",
    object: "bird",
    provenance: "research:simple-wikipedia-pack:owl",
  }]);
  for (const fact of facts) assert.ok(isResearchFact(fact));
});

test("pageByTitle resolves the same row an exact title names, no round trip beyond the pack read", async () => {
  const source = createSimpleWikipediaPackSource();
  const row = await source.pageByTitle("Owl");
  assert.ok(row);
  assert.equal(row.title, "Owl");
});

test("linkedTitles reads the pack's own cross-references: other pack terms the article's text mentions, stopwords excluded", async () => {
  const source = createSimpleWikipediaPackSource();
  const linked = await source.linkedTitles("Owl", { limit: 5 });
  assert.ok(Array.isArray(linked));
  assert.ok(linked.length > 0, "the owl article mentions at least one other pack term");
  assert.ok(linked.includes("Bird"), "birds -> bird is a real pack cross-reference");
  assert.ok(!linked.includes("Owl"), "the article never links to itself");
});

test("linkedTitles on a term the pack does not carry is null, not a throw", async () => {
  const source = createSimpleWikipediaPackSource();
  assert.equal(await source.linkedTitles("Zorblattian Nonsense"), null);
});
