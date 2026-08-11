// The extractor's named structural findings (src/services/extract-facts.mjs):
// the detectors that decline a mis-read candidate, the definitional frame that
// mints the edge a sentence actually states, and the identifier-token detector
// that reads a raw surface before it folds to a stored term.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ingestText, optimisticReading, optimisticTriples,
  readsAsEntityTerm, readsAsIdentifierToken, identifierTermsIn,
} from "../../src/services/extract-facts.mjs";

const LATENCY_SENTENCE =
  "In engineering, latency is the name for the time period that needs to be waited to see a result.";
const VOLCANO_SENTENCE =
  "A volcano is a mountain that has lava coming out from a magma chamber under the ground.";
const SCAFFOLDING_SENTENCE =
  "An item with no guid tag, so normalizeFeedItems falls back to the link.";

test("a definitional copula frame declines the isa and mints the naming edge instead", async () => {
  // "X is the name for Y" defines X. Reading "name" as the class puts latency
  // under a class it has nothing to do with.
  const reading = optimisticReading(LATENCY_SENTENCE, { findings: true });
  assert.deepEqual(reading.triples, [
    { subject: "latency", predicate: "mgx:nameFor", object: "time period" },
  ]);
  assert.deepEqual(reading.minted, [{
    finding: "definitional-frame",
    fact: { subject: "latency", predicate: "mgx:nameFor", object: "time period" },
  }]);
  assert.deepEqual(
    reading.declined.find((d) => d.finding === "definitional-frame").candidate,
    { subject: "latency", predicate: "rdfs:subClassOf", object: "name" },
  );

  // The mint is gated; the decline of the false isa is not.
  const gated = optimisticReading(LATENCY_SENTENCE);
  assert.deepEqual(gated.triples, []);
  assert.deepEqual(gated.minted, []);
  assert.equal(gated.declined.some((d) => d.finding === "definitional-frame"), true);
});

test("a relation verb in a relative clause hanging off the object's complement is declined by name", () => {
  // "that" follows "period", a noun inside the object's own complement, so the
  // clause restricts the period, not latency.
  const declined = optimisticReading(LATENCY_SENTENCE).declined
    .filter((d) => d.finding === "relative-clause-verb");
  assert.equal(declined.length, 1);
  assert.equal(declined[0].candidate.predicate, "tmct:needs");
  assert.equal(declined[0].candidate.object, "result");

  // The same shape with a plain object head: the isa stands, the relative
  // clause's verb still declines.
  const measured = optimisticReading(
    "In engineering, latency is a measure for the time period that needs to be waited to see a result.",
  );
  assert.deepEqual(measured.triples, [
    { subject: "latency", predicate: "rdfs:subClassOf", object: "measure" },
  ]);
  assert.deepEqual(measured.declined, [{
    finding: "relative-clause-verb",
    candidate: { subject: "latency", predicate: "tmct:needs", object: "result" },
  }]);
});

test("a relative pronoun directly after the copula object still binds its verb to the sentence subject", () => {
  // The adjacency rule keeps the true mint: "that" follows "mountain", the
  // object run's own end, so the clause restricts the class volcano was given.
  assert.deepEqual(optimisticTriples(VOLCANO_SENTENCE), [
    { subject: "volcano", predicate: "rdfs:subClassOf", object: "mountain" },
    { subject: "volcano", predicate: "tmct:has", object: "lava" },
  ]);
  assert.deepEqual(optimisticReading(VOLCANO_SENTENCE).declined, []);

  // A multi-word object run heads at its last noun, and "which" follows it.
  assert.deepEqual(
    optimisticTriples("The violin is a string instrument which has four strings and is played with a bow."),
    [
      { subject: "violin", predicate: "rdfs:subClassOf", object: "string instrument" },
      { subject: "violin", predicate: "tmct:has", object: "string" },
    ],
  );
});

test("a phrasal-verb remainder never reads as a term, while a one-word particle still does", () => {
  assert.equal(readsAsEntityTerm("back to the link"), false);
  assert.equal(readsAsEntityTerm("out of the water"), false);
  assert.equal(readsAsEntityTerm("away from the coast"), false);
  // One word is exempt: a bare particle-shaped word is a fine object for a
  // capability or relation fact.
  assert.equal(readsAsEntityTerm("back"), true);
  assert.equal(readsAsEntityTerm("out"), true);
  // Real compounds are untouched.
  assert.equal(readsAsEntityTerm("time period"), true);
  assert.equal(readsAsEntityTerm("string instrument"), true);
});

test("a place named after a compass direction still reads as a term, while a real prepositional phrase does not", () => {
  // A tagger reading the lowercased term has no capital left to tell the
  // place from the direction, and calls the leading word an adverb.
  assert.equal(readsAsEntityTerm("north korea"), true);
  assert.equal(readsAsEntityTerm("south sandwich islands"), true);
  assert.equal(readsAsEntityTerm("western australia"), true);
  // "of" after the compass word means it really is heading a phrase.
  assert.equal(readsAsEntityTerm("north of the border"), false);
  assert.equal(readsAsEntityTerm("south of anchorage"), false);
});

test("an identifier-shaped surface is detected before it folds to a stored term", () => {
  for (const token of ["normalizeFeedItems", "parseXML", "feed_items", "news.feed", "src/domain/prose.mjs"]) {
    assert.equal(readsAsIdentifierToken(token), true, `${token} reads as an identifier`);
  }
  for (const token of ["guitar", "Sales", "latency", "", "time period"]) {
    assert.equal(readsAsIdentifierToken(token), false, `${token} reads as a word`);
  }
  // The stored key the finding attaches to is the folded term, so a consumer
  // can match it against a row endpoint after normFactTerm lower-cased it.
  assert.deepEqual([...identifierTermsIn(SCAFFOLDING_SENTENCE)], ["normalizefeeditems"]);
  assert.deepEqual([...identifierTermsIn("A volcano is a mountain.")], []);
});

test("ingestText reports the latency sentence as one named decline and one definitional mint", async () => {
  const result = await ingestText(LATENCY_SENTENCE, { optimistic: true, findings: true });

  assert.deepEqual(result.optimistic.map(({ subject, predicate, object }) => ({ subject, predicate, object })), [
    { subject: "latency", predicate: "mgx:nameFor", object: "time period" },
  ]);
  assert.deepEqual(result.minted.map((m) => ({ finding: m.finding, fact: m.fact })), [{
    finding: "definitional-frame",
    fact: { subject: "latency", predicate: "mgx:nameFor", object: "time period" },
  }]);
  assert.equal(result.minted[0].sentence, LATENCY_SENTENCE);

  const relative = result.declined.filter((d) => d.finding === "relative-clause-verb");
  assert.equal(relative.length, 1);
  assert.equal(relative[0].sentence, LATENCY_SENTENCE);
  assert.equal(relative[0].candidate.predicate, "tmct:needs");
  // Nothing else survived: no tmct:needs row, no isa under "name".
  assert.equal(result.extracted.length, 0);
});

test("ingestText declines a phrasal-verb remainder the recognizer over-read as a term", async () => {
  const result = await ingestText(SCAFFOLDING_SENTENCE, { optimistic: true, findings: true });

  const fragments = result.declined.filter((d) => d.finding === "fragment-term");
  assert.equal(fragments.length >= 1, true, "the over-read remainder is declined by name");
  assert.equal(fragments[0].sentence, SCAFFOLDING_SENTENCE);
  assert.equal(fragments[0].candidate.object, "back to the link");
  // Nothing from the scaffolding sentence reaches the store.
  assert.deepEqual(result.extracted, []);
  assert.deepEqual(result.optimistic, []);
});

test("a sentence with nothing to decline reports empty finding lists", async () => {
  const result = await ingestText(VOLCANO_SENTENCE, { optimistic: true, findings: true });
  assert.deepEqual(result.declined, []);
  assert.deepEqual(result.minted, []);
  assert.deepEqual(
    result.optimistic.map(({ subject, predicate, object }) => ({ subject, predicate, object })),
    [
      { subject: "volcano", predicate: "rdfs:subClassOf", object: "mountain" },
      { subject: "volcano", predicate: "tmct:has", object: "lava" },
    ],
  );
});
