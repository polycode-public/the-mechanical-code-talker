import test from "node:test";
import assert from "node:assert/strict";
import {
  FACT_PREDICATE_PHRASES, predicatePhrase, factSentence, phraseRendererSource,
  baseVerbSurface, thirdPersonSingularSurface, isSubjectPlural,
  FINDING_CAVEATS, findingCaveat,
} from "../../src/domain/fact-phrase.mjs";

test("predicatePhrase returns a curated phrase for every table entry", () => {
  assert.equal(predicatePhrase("rdfs:subClassOf"), "is a kind of");
  assert.equal(predicatePhrase("rdf:type"), "is a");
  assert.equal(predicatePhrase("mgx:hasA"), "has");
  assert.equal(predicatePhrase("mgx:causes"), "causes");
  assert.equal(predicatePhrase("mgx:desires"), "wants");
  assert.equal(predicatePhrase("mgx:currently-in"), "is in");
  // A curated entry, not the minted-verb branch: without it the mgx:<letters>
  // fold ran attributedTo through the third-person-singular fold and gave back
  // "attributedToes".
  assert.equal(predicatePhrase("mgx:attributedTo"), "is attributed to");
});

test("predicatePhrase renders a minted verb predicate as its third-person surface", () => {
  assert.equal(predicatePhrase("mgx:eat"), "eats");
  assert.equal(predicatePhrase("mgx:fly"), "flies");
  assert.equal(predicatePhrase("mgx:rest-on"), "rests on");
});

test("isSubjectPlural reads the head noun: regular plural, irregular plural, singular, and a multi-word subject's head", () => {
  assert.equal(isSubjectPlural("scientists"), true);
  assert.equal(isSubjectPlural("people"), true);
  assert.equal(isSubjectPlural("children"), true);
  assert.equal(isSubjectPlural("an earthquake"), false);
  assert.equal(isSubjectPlural("a scientist"), false);
  assert.equal(isSubjectPlural("the news"), false);
  // "the group of scientists" agrees on the head noun "group", not the
  // trailing "of ..." phrase's own noun.
  assert.equal(isSubjectPlural("the group of scientists"), false);
  assert.equal(isSubjectPlural(""), false);
  assert.equal(isSubjectPlural(undefined), false);
});

test("predicatePhrase folds a minted verb onto its subject's number: a regular plural takes the bare form, an irregular plural takes it too, a singular subject keeps the third-person fold", () => {
  assert.equal(predicatePhrase("mgx:report", "scientists"), "report");
  assert.equal(predicatePhrase("mgx:report", "people"), "report");
  assert.equal(predicatePhrase("mgx:strike", "an earthquake"), "strikes");
  assert.equal(predicatePhrase("mgx:rest-on", "the group of scientists"), "rests on");
  // No subject given at all: today's pre-existing singular default, unchanged.
  assert.equal(predicatePhrase("mgx:report"), "reports");
});

test("factSentence agrees a minted verb with its own row.subject", () => {
  assert.equal(
    factSentence({ subject: "scientists", predicate: "mgx:report", object: "a finding" }),
    "scientists report a finding",
  );
  assert.equal(
    factSentence({ subject: "an earthquake", predicate: "mgx:strike", object: "the coast" }),
    "an earthquake strikes the coast",
  );
  assert.equal(
    factSentence({ subject: "the group of scientists", predicate: "mgx:report", object: "a finding" }),
    "the group of scientists reports a finding",
  );
});

test("a lexicon-minted predicate comes pre-inflected, so a plural subject reads it back through the bare form", () => {
  assert.equal(predicatePhrase("tmct:releases", "rescuers"), "release");
  assert.equal(predicatePhrase("tmct:releases", "russia"), "releases");
  assert.equal(predicatePhrase("tmct:uses", "people"), "use");
  assert.equal(predicatePhrase("tmct:carries", "the ships"), "carry");
  assert.equal(predicatePhrase("tmct:touches", "the wires"), "touch");
  // The camel-cased preposition is its own word, and the verb in front of it
  // agrees the same way.
  assert.equal(predicatePhrase("tmct:reliesOn", "systems"), "rely on");
  assert.equal(predicatePhrase("tmct:reliesOn", "the system"), "relies on");
  assert.equal(predicatePhrase("tmct:dependsOn", "the modules"), "depend on");
  // No subject given at all: today's pre-existing singular default, unchanged.
  assert.equal(predicatePhrase("tmct:releases"), "releases");
});

test("factSentence agrees a lexicon-minted verb with its own row.subject", () => {
  assert.equal(
    factSentence({ subject: "rescuers", predicate: "tmct:releases", object: "a quake victim" }),
    "rescuers release a quake victim",
  );
  assert.equal(
    factSentence({ subject: "russia", predicate: "tmct:releases", object: "robert gilman" }),
    "russia releases robert gilman",
  );
});

test("predicatePhrase's do-support negation agrees with the subject too: 'do not' for a plural subject, 'does not' for a singular one", () => {
  assert.equal(predicatePhrase("mgxneg:eat", "scientists"), "do not eat");
  assert.equal(predicatePhrase("mgxneg:eat", "a fox"), "does not eat");
  // No subject given at all: today's pre-existing singular default, unchanged.
  assert.equal(predicatePhrase("mgxneg:eat"), "does not eat");
});

test("a curated predicate's phrase is fixed English, unaffected by subject plurality", () => {
  assert.equal(predicatePhrase("mgx:causes", "scientists"), "causes");
  assert.equal(predicatePhrase("mgx:hasA", "scientists"), "has");
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
  assert.equal(findingCaveat("reported-speech"), "(read from reported speech)");
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
  assert.equal(Object.keys(FINDING_CAVEATS).length, 4, "the caveat table is closed");
});

test("phraseRendererSource carries everything the reader stands on", () => {
  const source = phraseRendererSource();
  for (const name of ["TEACH_PARTICIPLE_SRC", "thirdPersonSingularSurface", "baseVerbSurface", "isSubjectPlural", "predicatePhrase", "factSentence"]) {
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
  // The plural fold has to survive the same round-trip: the browser copy owns
  // its own IRREGULAR_PLURAL_NOUNS/SINGULAR_NOUNS_ENDING_S tables, not a
  // shared reference back into this module.
  assert.equal(
    browserSentence({ subject: "scientists", predicate: "mgx:report", object: "a finding" }),
    "scientists report a finding",
  );
  assert.equal(
    browserSentence({ subject: "rescuers", predicate: "tmct:releases", object: "a quake victim" }),
    "rescuers release a quake victim",
  );
  assert.equal(browserPhrase("tmct:reliesOn", "systems"), "rely on");
});
