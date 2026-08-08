// The live Wiktionary research source: one GET against the REST definition
// endpoint, mapped into the shipped reference-pack article-row shape, with
// genus extraction (the head noun of the definition's own opening phrase)
// standing in for the copula-driven isaOf reference-pack.mjs uses on a
// Wikipedia lead. Courtesy (throttle, cool-off, cache, honest miss) is the
// same shared gate every other live adapter uses.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createWiktionaryLiveProvider,
  WIKTIONARY_LIVE_ORIGIN,
} from "../../src/adapters/corpus/wiktionary-live.mjs";
import { isReferenceArticleRow } from "../../src/domain/reference-pack.mjs";

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headers[String(name).toLowerCase()] ?? null },
    json: async () => body,
  };
}

function definitionBody(entries) {
  return entries;
}

test("a noun sense's definition maps to a valid article row, its genus resolved from the definition's head noun", async () => {
  const fetchImpl = async (url) => {
    assert.match(String(url), /\/api\/rest_v1\/page\/definition\/volcano/);
    return jsonResponse(definitionBody([
      { partOfSpeech: "noun", language: "English", definitions: [{ definition: "a vent or fissure on the surface of a planet." }] },
    ]));
  };
  const provider = createWiktionaryLiveProvider({ fetchImpl, minIntervalMs: 0 });
  const row = await provider.lookup("volcano");
  assert.ok(isReferenceArticleRow(row));
  assert.equal(row.term, "volcano");
  assert.equal(row.isa, "vent");
  assert.equal(row.summary, "a vent or fissure on the surface of a planet.");
  assert.equal(row.url, `${WIKTIONARY_LIVE_ORIGIN}/wiki/volcano`);
});

test("a multi-word genus phrase resolves to its head noun, not the leading adjective", async () => {
  const fetchImpl = async () => jsonResponse(definitionBody([
    { partOfSpeech: "noun", language: "English", definitions: [{ definition: "A muscular organ that pumps blood through the circulatory system." }] },
  ]));
  const provider = createWiktionaryLiveProvider({ fetchImpl, minIntervalMs: 0 });
  const row = await provider.lookup("heart");
  assert.equal(row.isa, "organ");
});

test("markup in the definition is stripped before it reaches the row", async () => {
  const fetchImpl = async () => jsonResponse(definitionBody([
    { partOfSpeech: "noun", language: "English", definitions: [{ definition: "a <b>bright</b> object &amp; <script>alert(1)</script> a hazard" }] },
  ]));
  const provider = createWiktionaryLiveProvider({ fetchImpl, minIntervalMs: 0 });
  const row = await provider.lookup("quasar");
  assert.equal(row.text, "a bright object & alert(1) a hazard");
  assert.ok(!row.text.includes("<"), "no tag survives stripMarkup");
});

test("the live API's language-keyed shape ({ en: [...] }) reads the same as a flat array", async () => {
  const fetchImpl = async () => jsonResponse({ en: [
    { partOfSpeech: "noun", language: "English", definitions: [{ definition: "a small rodent." }] },
  ] });
  const provider = createWiktionaryLiveProvider({ fetchImpl, minIntervalMs: 0 });
  const row = await provider.lookup("mouse");
  assert.equal(row.isa, "rodent");
});

test("a definition with no article at its head licenses no isa, but still grounds", async () => {
  const fetchImpl = async () => jsonResponse(definitionBody([
    { partOfSpeech: "verb", language: "English", definitions: [{ definition: "to run very quickly" }] },
  ]));
  const provider = createWiktionaryLiveProvider({ fetchImpl, minIntervalMs: 0 });
  const row = await provider.lookup("sprint");
  assert.ok(row);
  assert.equal(row.isa, undefined);
});

test("a non-English or non-noun/verb sense is skipped in favour of a later grounded one", async () => {
  const fetchImpl = async () => jsonResponse(definitionBody([
    { partOfSpeech: "noun", language: "French", definitions: [{ definition: "un objet brillant" }] },
    { partOfSpeech: "interjection", language: "English", definitions: [{ definition: "an expression of surprise" }] },
    { partOfSpeech: "noun", language: "English", definitions: [{ definition: "a bright celestial body." }] },
  ]));
  const provider = createWiktionaryLiveProvider({ fetchImpl, minIntervalMs: 0 });
  const row = await provider.lookup("star");
  assert.equal(row.summary, "a bright celestial body.");
});

test("no groundable sense at all reads as a miss", async () => {
  const fetchImpl = async () => jsonResponse(definitionBody([
    { partOfSpeech: "interjection", language: "English", definitions: [{ definition: "hello there" }] },
  ]));
  const provider = createWiktionaryLiveProvider({ fetchImpl, minIntervalMs: 0 });
  assert.equal(await provider.lookup("hey"), null);
});

test("an empty body, a 404, a dead transport and an empty term all read as a miss, never a throw", async () => {
  assert.equal(await createWiktionaryLiveProvider({ fetchImpl: async () => jsonResponse([]), minIntervalMs: 0 }).lookup("nothing"), null);
  assert.equal(await createWiktionaryLiveProvider({ fetchImpl: async () => jsonResponse({}, { status: 404 }), minIntervalMs: 0 }).lookup("missing"), null);
  assert.equal(await createWiktionaryLiveProvider({ fetchImpl: async () => { throw new Error("down"); }, minIntervalMs: 0 }).lookup("term"), null);
  const provider = createWiktionaryLiveProvider({ fetchImpl: async () => jsonResponse([]), minIntervalMs: 0 });
  assert.equal(await provider.lookup(""), null);
  assert.equal(await provider.lookup(null), null);
});

test("the provenance tag carries the source name and folded term", () => {
  const provider = createWiktionaryLiveProvider({ minIntervalMs: 0 });
  assert.equal(provider.provenanceTag("Heart"), "research:wiktionary:heart");
});

test("a hit is cached — the second lookup costs zero further fetches", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return jsonResponse(definitionBody([
    { partOfSpeech: "noun", language: "English", definitions: [{ definition: "a small rodent." }] },
  ])); };
  const provider = createWiktionaryLiveProvider({ fetchImpl, minIntervalMs: 0 });
  await provider.lookup("mouse");
  await provider.lookup("mouse");
  assert.equal(calls, 1);
});
