// The `./phrase` export subpath: an embedding host renders tmct's own fact
// rows and provenance tags the way tmct renders them, instead of re-deriving
// English from raw CURIEs or hand-assembling a citation link.
import { test } from "node:test";
import assert from "node:assert/strict";

import { predicatePhrase as enginePredicatePhrase, factSentence as engineFactSentence } from "../../src/domain/fact-phrase.mjs";

const phrase = await import("@polycode-projects/the-mechanical-code-talker/phrase");

test("the subpath publishes the renderer the answer path itself uses", () => {
  assert.equal(phrase.predicatePhrase, enginePredicatePhrase);
  assert.equal(phrase.factSentence, engineFactSentence);
  for (const name of ["FACT_PREDICATE_PHRASES", "thirdPersonSingularSurface", "baseVerbSurface", "gerundVerbSurface", "referenceTagToUrl", "articleUrlFor"]) {
    assert.ok(name in phrase, `./phrase is missing ${name}`);
  }
});

test("a consumer renders a stored row without meeting a CURIE", () => {
  assert.equal(phrase.factSentence({ subject: "a heart", predicate: "mgx:hasA", object: "a valve" }), "a heart has a valve");
  assert.equal(phrase.factSentence({ subject: "latency", predicate: "tmct:needs", object: "result" }), "latency needs result");
  assert.equal(phrase.predicatePhrase("mgxneg:capableOf"), "cannot");
});

test("referenceTagToUrl rebuilds the revision-pinned article link", () => {
  assert.deepEqual(phrase.referenceTagToUrl("reference:simplewiki:Latency@6848029"), {
    pack: "simplewiki",
    title: "Latency",
    revid: "6848029",
    url: "https://simple.wikipedia.org/wiki/Latency?oldid=6848029",
  });
});

test("referenceTagToUrl underscores a title with spaces", () => {
  assert.deepEqual(phrase.referenceTagToUrl("reference:simplewiki:Polar bear@912"), {
    pack: "simplewiki",
    title: "Polar bear",
    revid: "912",
    url: "https://simple.wikipedia.org/wiki/Polar_bear?oldid=912",
  });
});

test("referenceTagToUrl places the live pack on its own origin", () => {
  assert.equal(
    phrase.referenceTagToUrl("reference:wikipedia-live:Otter@41").url,
    "https://en.wikipedia.org/wiki/Otter?oldid=41",
  );
});

test("a tag referenceTagToUrl cannot place returns null, never a guessed URL", () => {
  for (const tag of [
    "teach:chat:019f@2026-08-07T00:00:00.000Z",
    "corpus:conceptnet",
    "reference:some-other-pack:Latency@1",
    "reference:simplewiki:Latency",
    "reference:simplewiki:Latency@notanumber",
    "reference:simplewiki",
    "reference:",
    "",
    null,
    undefined,
  ]) {
    assert.equal(phrase.referenceTagToUrl(tag), null, `expected null for ${JSON.stringify(tag)}`);
  }
});
