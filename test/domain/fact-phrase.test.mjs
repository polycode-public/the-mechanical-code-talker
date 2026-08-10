import test from "node:test";
import assert from "node:assert/strict";
import {
  FACT_PREDICATE_PHRASES, predicatePhrase, factSentence, phraseRendererSource,
  baseVerbSurface, thirdPersonSingularSurface,
  FINDING_CAVEATS, findingCaveat,
} from "../../src/domain/fact-phrase.mjs";

test("predicatePhrase returns a curated phrase for every table entry", () => {
  assert.equal(predicatePhrase("rdfs:subClassOf"), "is a kind of");
  assert.equal(predicatePhrase("rdf:type"), "is a");
  assert.equal(predicatePhrase("mgx:hasA"), "has");
  assert.equal(predicatePhrase("mgx:causes"), "causes");
  assert.equal(predicatePhrase("mgx:desires"), "wants");
  assert.equal(predicatePhrase("mgx:currently-in"), "is in");
});

test("predicatePhrase renders a minted verb predicate as its third-person surface", () => {
  assert.equal(predicatePhrase("mgx:eat"), "eats");
  assert.equal(predicatePhrase("mgx:fly"), "flies");
  assert.equal(predicatePhrase("mgx:rest-on"), "rests on");
});

test("baseVerbSurface strips a real -es ending without eating the base's own e", () => {
  assert.equal(baseVerbSurface("causes"), "cause");
  assert.equal(baseVerbSurface("uses"), "use");
  assert.equal(baseVerbSurface("raises"), "raise");
  assert.equal(baseVerbSurface("passes"), "pass");
  assert.equal(baseVerbSurface("buzzes"), "buzz");
  assert.equal(baseVerbSurface("boxes"), "box");
  assert.equal(baseVerbSurface("watches"), "watch");
  assert.equal(baseVerbSurface("goes"), "go");
  assert.equal(baseVerbSurface("flies"), "fly");
  assert.equal(baseVerbSurface("has"), "have");
  for (const lemma of ["cause", "use", "raise", "pass", "buzz", "box", "watch", "go", "eat"]) {
    assert.equal(baseVerbSurface(thirdPersonSingularSurface(lemma)), lemma);
  }
});

test("predicatePhrase renders the minted comparative, participle and shared-attribute shapes", () => {
  assert.equal(predicatePhrase("mgx:smaller-than"), "is smaller than");
  assert.equal(predicatePhrase("mgx:connected-with"), "is connected with");
  assert.equal(predicatePhrase("mgx:same-goal-as"), "has the same goal as");
});

test("predicatePhrase negates a minted predicate through its own positive phrase", () => {
  assert.equal(predicatePhrase("mgxneg:capableOf"), "cannot");
  assert.equal(predicatePhrase("mgxneg:receivesAction"), "cannot be");
  assert.equal(predicatePhrase("mgxneg:hasProperty"), "is not");
  assert.equal(predicatePhrase("mgxneg:atLocation"), "is not found in");
  assert.equal(predicatePhrase("mgxneg:causes"), "does not cause");
  assert.equal(predicatePhrase("mgxneg:eat"), "does not eat");
});

// The one polarity pair that is not a prefix swap: the negation branch would
// read it as "mgx:subClassOf", a term that exists nowhere, so the curated
// table has to answer it first.
test("the stated negative subclass twin renders from the table, not the prefix swap", () => {
  assert.equal(predicatePhrase("mgxneg:subClassOf"), "is not a kind of");
});

test("predicatePhrase falls back to the predicate's local name when nothing else matches", () => {
  assert.equal(predicatePhrase("mgx:some-unlisted-relation"), "some-unlisted-relation");
  assert.equal(predicatePhrase("nonamespace"), "nonamespace");
  assert.equal(predicatePhrase(""), "");
});

// A predicate in a namespace tmct itself mints (the lexicon stamps "tmct:" on
// every verb it knows) must never reach a reader as a raw CURIE.
test("predicatePhrase strips the namespace off a predicate no branch claims", () => {
  assert.equal(predicatePhrase("tmct:needs"), "needs");
  assert.equal(predicatePhrase("schema:knowsAbout"), "knowsAbout");
  assert.equal(
    factSentence({ subject: "latency", predicate: "tmct:needs", object: "result" }),
    "latency needs result",
  );
});

test("factSentence renders one sentence per predicate family", () => {
  assert.equal(factSentence({ subject: "a heart", predicate: "mgx:hasA", object: "a valve" }), "a heart has a valve");
  assert.equal(factSentence({ subject: "a robin", predicate: "rdfs:subClassOf", object: "a bird" }), "a robin is a kind of a bird");
  assert.equal(factSentence({ subject: "fire", predicate: "mgx:causes", object: "smoke" }), "fire causes smoke");
  assert.equal(factSentence({ subject: "a knife", predicate: "mgx:usedFor", object: "cutting" }), "a knife is used for cutting");
  assert.equal(factSentence({ subject: "a lamp", predicate: "mgx:currently-in", object: "the study" }), "a lamp is in the study");
  assert.equal(factSentence({ subject: "a dog", predicate: "mgx:bark", object: "loudly" }), "a dog barks loudly");
});

// The extraction tier's definitional edge. The minted-verb fallback would read
// "mgx:nameFor" as "nameFors", so the curated table has to answer it first.
test("the definitional edge reads as its curated phrase, not a folded verb surface", () => {
  assert.equal(predicatePhrase("mgx:nameFor"), "is the name for");
  assert.equal(
    factSentence({ subject: "latency", predicate: "mgx:nameFor", object: "time period" }),
    "latency is the name for time period",
  );
});

test("findingCaveat renders one short template per kept finding, and nothing for a clean row", () => {
  assert.equal(findingCaveat("clause-fallback"), "(read from a clause fragment)");
  assert.equal(findingCaveat("pronoun-carry"), "(subject carried from the previous sentence)");
  assert.equal(findingCaveat("identifier-token"), "(identifier token)");
  // A fact row is the shape a renderer actually holds.
  assert.equal(
    findingCaveat({ subject: "cell", predicate: "rdfs:subClassOf", object: "unit", extraction: ["pronoun-carry"] }),
    "(subject carried from the previous sentence)",
  );
  // Nothing recorded, nothing said.
  assert.equal(findingCaveat({ subject: "cell", predicate: "rdfs:subClassOf", object: "unit" }), "");
  assert.equal(findingCaveat([]), "");
  assert.equal(findingCaveat(undefined), "");
  // The definitional frame's own phrase already says how the row was read.
  assert.equal(findingCaveat("definitional-frame"), "");
  // A decline reason names a candidate that was never stored.
  assert.equal(findingCaveat("relative-clause-verb"), "");
});

test("a row carrying several findings reads them in the table's order, not the row's", () => {
  const caveat = "(read from a clause fragment) (identifier token)";
  assert.equal(findingCaveat(["clause-fallback", "identifier-token"]), caveat);
  assert.equal(findingCaveat(["identifier-token", "clause-fallback"]), caveat);
  assert.equal(Object.keys(FINDING_CAVEATS).length, 3, "the caveat table is closed");
});

test("phraseRendererSource carries everything the reader stands on", () => {
  const source = phraseRendererSource();
  for (const name of ["TEACH_PARTICIPLE_SRC", "thirdPersonSingularSurface", "baseVerbSurface", "predicatePhrase", "factSentence"]) {
    assert.match(source, new RegExp(`const ${name} =`));
  }
  // The page supplies the table; everything else has to come from here, or a
  // branch of the reader throws in the browser instead of rendering.
  const inBrowser = new Function("FACT_PREDICATE_PHRASES", `${source}\nreturn { predicatePhrase, factSentence };`);
  const { predicatePhrase: browserPhrase, factSentence: browserSentence } = inBrowser(FACT_PREDICATE_PHRASES);
  assert.equal(browserPhrase("mgx:hasA"), "has");
  assert.equal(browserPhrase("mgx:eat"), "eats");
  assert.equal(browserPhrase("mgxneg:capableOf"), "cannot");
  assert.equal(browserPhrase("mgx:connected-with"), "is connected with");
  assert.equal(browserPhrase("tmct:needs"), "needs");
  assert.equal(browserSentence({ subject: "fire", predicate: "mgx:causes", object: "smoke" }), "fire causes smoke");
});
