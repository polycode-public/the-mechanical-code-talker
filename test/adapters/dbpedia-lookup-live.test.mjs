// The live DBpedia Lookup research source: one GET against the ranked entity
// search, mapped into the shipped reference-pack article-row shape, with the
// top hit's own DBpedia category as the isa — DBpedia's classification, not a
// parse of prose. Courtesy (throttle, cool-off, cache, honest miss) is the
// same shared gate every other live adapter uses.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createDbpediaLookupLiveProvider, DBPEDIA_LOOKUP_ORIGIN } from "../../src/adapters/corpus/dbpedia-lookup-live.mjs";
import { isReferenceArticleRow } from "../../src/domain/reference-pack.mjs";

function jsonResponse(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => body,
  };
}

function docsBody(docs) {
  return { docs };
}

const HEART_DOC = {
  resource: ["http://dbpedia.org/resource/Heart"],
  label: ["<B>Heart</B>"],
  comment: ["The heart is a muscular organ in most animals."],
  category: ["http://dbpedia.org/resource/Category:Cardiac_anatomy"],
};

test("the top hit maps to a valid article row, its category folded into the isa", async () => {
  const fetchImpl = async (url) => {
    assert.match(String(url), /\/api\/search\?query=heart/);
    return jsonResponse(docsBody([HEART_DOC]));
  };
  const provider = createDbpediaLookupLiveProvider({ fetchImpl, minIntervalMs: 0 });
  const row = await provider.lookup("heart");
  assert.ok(isReferenceArticleRow(row));
  assert.equal(row.term, "heart");
  assert.equal(row.title, "Heart", "the bold-tagged label is stripped of markup");
  assert.equal(row.text, "The heart is a muscular organ in most animals.");
  assert.equal(row.isa, "cardiac anatomy");
  assert.equal(row.url, "http://dbpedia.org/resource/Heart");
  assert.equal(row.source, "DBpedia");
  assert.equal(row.licence, "CC BY-SA 3.0");
});

test("only the top-ranked doc is read; a later doc's fields never leak in", async () => {
  const fetchImpl = async () => jsonResponse(docsBody([
    HEART_DOC,
    { resource: ["http://dbpedia.org/resource/Heart_(band)"], label: ["Heart (band)"], comment: ["An American rock band."], category: [] },
  ]));
  const provider = createDbpediaLookupLiveProvider({ fetchImpl, minIntervalMs: 0 });
  const row = await provider.lookup("heart");
  assert.equal(row.title, "Heart");
});

test("an empty docs array, a missing category, and an incomplete top doc", async () => {
  const empty = createDbpediaLookupLiveProvider({ fetchImpl: async () => jsonResponse(docsBody([])), minIntervalMs: 0 });
  assert.equal(await empty.lookup("zorblattian"), null);

  const noCategory = createDbpediaLookupLiveProvider({
    fetchImpl: async () => jsonResponse(docsBody([{ ...HEART_DOC, category: [] }])),
    minIntervalMs: 0,
  });
  const row = await noCategory.lookup("heart");
  assert.ok(row, "a doc with no category still grounds");
  assert.equal(row.isa, undefined);

  const incomplete = createDbpediaLookupLiveProvider({
    fetchImpl: async () => jsonResponse(docsBody([{ resource: ["http://dbpedia.org/resource/X"], label: [], comment: [], category: [] }])),
    minIntervalMs: 0,
  });
  assert.equal(await incomplete.lookup("x"), null, "a doc with no usable label/comment is a miss, not a half-built row");
});

test("a dead transport, a garbage body, and an empty term all read as a miss, never a throw", async () => {
  const dead = createDbpediaLookupLiveProvider({ fetchImpl: async () => { throw new Error("down"); }, minIntervalMs: 0 });
  assert.equal(await dead.lookup("heart"), null);

  const garbage = createDbpediaLookupLiveProvider({ fetchImpl: async () => jsonResponse({ nothing: "useful" }), minIntervalMs: 0 });
  assert.equal(await garbage.lookup("heart"), null);

  const provider = createDbpediaLookupLiveProvider({ fetchImpl: async () => jsonResponse(docsBody([HEART_DOC])), minIntervalMs: 0 });
  assert.equal(await provider.lookup(""), null);
  assert.equal(await provider.lookup(null), null);
});

test("the provenance tag carries the source name and folded term", () => {
  const provider = createDbpediaLookupLiveProvider({ minIntervalMs: 0 });
  assert.equal(provider.provenanceTag("Heart"), "research:dbpedia-lookup:heart");
  assert.ok(provider.origin.startsWith("https://"));
  assert.equal(provider.origin, DBPEDIA_LOOKUP_ORIGIN);
});

test("a hit is cached — the second lookup costs zero further fetches", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return jsonResponse(docsBody([HEART_DOC])); };
  const provider = createDbpediaLookupLiveProvider({ fetchImpl, minIntervalMs: 0 });
  await provider.lookup("heart");
  await provider.lookup("heart");
  assert.equal(calls, 1);
});
