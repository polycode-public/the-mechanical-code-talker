// The extractor's named structural findings (src/services/extract-facts.mjs):
// the detectors that decline a mis-read candidate, the definitional frame that
// mints the edge a sentence actually states, and the identifier-token detector
// that reads a raw surface before it folds to a stored term.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ingestText, optimisticReading, optimisticTriples, reportedClauseOf,
  readsAsEntityTerm, readsAsIdentifierToken, identifierTermsIn, splitsPhrasalVerb,
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

test("a clause led by a pronoun or cut off after an auxiliary never reads as a term", () => {
  assert.equal(readsAsEntityTerm("he’s also destroyed the city’s soul"), false);
  assert.equal(readsAsEntityTerm("they were arrested"), false);
  assert.equal(readsAsEntityTerm("its own budget"), false);
  assert.equal(readsAsEntityTerm("rooms were"), false);
  assert.equal(readsAsEntityTerm("the talks have"), false);
  // One word stands: a headline writes the United States as "US".
  assert.equal(readsAsEntityTerm("us"), true);
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

test("a headline torn into subject, predicate and remainder leaves a term with a clause word inside it, and that never reads as a name", () => {
  assert.equal(readsAsEntityTerm("colombia as rescuers free quake victim"), false);
  assert.equal(readsAsEntityTerm("keir starmer faces a vote"), false);
  assert.equal(readsAsEntityTerm("new gun permits after mass shooting"), false);
  assert.equal(readsAsEntityTerm("boats hit by mystery attackers"), false);
  assert.equal(readsAsEntityTerm("glaciers on the climate dashboard"), false);
  // A source that quoted the headline is naming a title, and a title is free
  // to read as a clause.
  assert.equal(readsAsEntityTerm('"tim king, amigados developer, has died"'), true);
});

test("a name built with \"of\" still reads as a name, and so does a surname the clause-word list also spells", () => {
  assert.equal(readsAsEntityTerm("house of representatives"), true);
  assert.equal(readsAsEntityTerm("isle of man"), true);
  // A participle opens plenty of real names, and the lowercased stored key
  // gives a tagger nothing but the verb reading.
  assert.equal(readsAsEntityTerm("united states"), true);
  assert.equal(readsAsEntityTerm("united states of america"), true);
  assert.equal(readsAsEntityTerm("united nations"), true);
  // The interior rule reads strictly interior positions, so a surname at the
  // end of a name is untouched.
  assert.equal(readsAsEntityTerm("theresa may"), true);
  assert.equal(readsAsEntityTerm("brian may"), true);
  assert.equal(readsAsEntityTerm("ecuadorean fishing boat"), true);
  assert.equal(readsAsEntityTerm("quake victim"), true);
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

test("ingestText declines a row that pairs a verb with its own particle", async () => {
  const sentence = "Ahead of the eclipse, prices surge and stocks sell out.";
  const result = await ingestText(sentence, { optimistic: true, findings: true });

  const split = result.declined.filter((d) => d.finding === "phrasal-particle");
  assert.equal(split.length, 1, "the particle-as-object row is declined by name");
  assert.deepEqual(split[0].candidate, { subject: "stocks", predicate: "mgx:sell", object: "out" });
  // "sell out" names no object here, so nothing is stored in its place.
  assert.deepEqual(result.extracted, []);
  assert.deepEqual(result.optimistic, []);
});

test("splitsPhrasalVerb reads the pair table, not the particle alone", () => {
  assert.equal(splitsPhrasalVerb({ subject: "stocks", predicate: "mgx:sell", object: "out" }), true);
  assert.equal(splitsPhrasalVerb({ subject: "council", predicate: "tmct:carries", object: "out" }), true);
  // "back" is a fine object for a verb the table never pairs it with.
  assert.equal(splitsPhrasalVerb({ subject: "player", predicate: "mgx:hurt", object: "back" }), false);
  assert.equal(splitsPhrasalVerb({ subject: "russia", predicate: "tmct:releases", object: "robert gilman" }), false);
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

test("a bare -ed complement after a copula is a mis-tagged participle, never a class", async () => {
  const result = await ingestText(
    "While dozens have been rescued, the search continues for an unknown number of missing people.",
    { optimistic: true, findings: true },
  );
  assert.deepEqual(result.extracted, []);
  assert.deepEqual(result.optimistic, []);
});

test("a determiner keeps a perfect copula's class complement mintable", async () => {
  const result = await ingestText("The kraken has been a legend.", { optimistic: true, findings: true });
  assert.deepEqual(
    result.optimistic.map(({ subject, predicate, object }) => ({ subject, predicate, object })),
    [{ subject: "kraken", predicate: "rdfs:subClassOf", object: "legend" }],
  );
});

const groundedTriples = (result) =>
  [...result.extracted, ...result.optimistic].map(({ subject, predicate, object }) => ({ subject, predicate, object }));

test("an attributed report grounds the claim it carries, never the saying of it", async () => {
  const leading = await ingestText("Officials said the quake killed more than 100 people.", { optimistic: true });
  assert.deepEqual(groundedTriples(leading), [{ subject: "quake", predicate: "mgx:kill", object: "person" }]);

  const trailing = await ingestText("Rescuers freed the quake victim, officials said.", { optimistic: true });
  assert.deepEqual(groundedTriples(trailing), [{ subject: "rescuers", predicate: "mgx:free", object: "quake victim" }]);
});

test("an attribution verb that changes what the sentence says about the claim is never unwrapped", () => {
  for (const sentence of [
    "The ministry denied the quake killed more than 100 people.",
    "Campaigners alleged the quake killed more than 100 people.",
    "Experts claimed the region has a complicated history.",
  ]) {
    assert.equal(reportedClauseOf(sentence), sentence, `left whole: ${sentence}`);
  }
});

test("a speaker the article named still reaches the enrichment queue after the claim is unwrapped", async () => {
  const result = await ingestText(
    'Russia released Robert Gilman on "a humanitarian basis," President Trump said.',
    { optimistic: true },
  );
  const terms = [...result.ungroundedCounts.keys()];
  assert.ok(terms.includes("president trump"), `the speaker still queues: ${terms.join(", ")}`);
});
