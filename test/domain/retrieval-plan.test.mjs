import test from "node:test";
import assert from "node:assert/strict";
import {
  subjectWordsOf, foldedFormsOf, queryTerms, fuzzyVariantsFor, buildRetrievalPlan,
  factTripleOf, expandedTerms, ancestryTerms, ANCESTRY_PREDICATE,
} from "../../src/domain/retrieval-plan.mjs";

const factRow = ({ subject, predicate, object, rowKey = `${subject}|${predicate}|${object}` }) => ({
  rowKey,
  rowClass: "fact",
  term: subject,
  json: JSON.stringify({
    ord: 0,
    individual: {
      id: rowKey,
      class: "Fact",
      attributes: [
        { prop: "rdf:subject", key: "subject", value: subject },
        { prop: "rdf:predicate", key: "predicate", value: predicate },
        { prop: "rdf:object", key: "object", value: object },
      ],
    },
  }),
});

const wordsOnly = (text) => subjectWordsOf(text).map((entry) => entry.word);

test("keeps the words that could name a subject and drops the grammar around them", () => {
  assert.deepEqual(wordsOnly("what is a dolphin"), ["dolphin"]);
  assert.deepEqual(wordsOnly("how many legs does a spider have"), ["legs", "spider"]);
  assert.deepEqual(wordsOnly("tell me about tariffs"), ["tariffs"]);
});

test("a dotted module name survives as one word", () => {
  assert.deepEqual(wordsOnly("what does store.mjs import"), ["store.mjs"]);
});

test("folds a plural onto the lemma the lexicon declares", () => {
  assert.deepEqual(foldedFormsOf("legs"), ["leg", "legs"]);
});

test("falls back to the regular singular for a word the lexicon never declared", () => {
  assert.deepEqual(foldedFormsOf("tariffs"), ["tariff", "tariffs"]);
});

test("leaves a singular that merely ends in s alone", () => {
  assert.deepEqual(foldedFormsOf("analysis"), ["analysis"]);
  assert.deepEqual(foldedFormsOf("virus"), ["virus"]);
  assert.deepEqual(foldedFormsOf("class"), ["class"]);
});

test("pairs only the words the writer put side by side", () => {
  assert.ok(queryTerms("what is a roman letter").includes("roman letter"));
  const spread = queryTerms("how many legs does a spider have");
  assert.ok(!spread.includes("legs spider"), `words separated by "many" and "does" must not pair: ${spread.join(", ")}`);
});

test("query terms come back sorted and deduped", () => {
  const terms = queryTerms("a letter and a letter and a roman letter");
  assert.deepEqual(terms, [...new Set(terms)].sort());
});

test("fuzzy variants stay inside the cap and lead with the nearest form", () => {
  const vocabulary = ["dolfins", "coffin", "dolman", "dolphin"];
  assert.deepEqual(fuzzyVariantsFor("dolfin", { vocabulary, cap: 2 }), ["dolfins", "coffin"]);
  assert.deepEqual(fuzzyVariantsFor("dolfin", { vocabulary, cap: 10 }), ["dolfins", "coffin", "dolman", "dolphin"]);
});

test("candidates at the same distance fall back to alphabetical order", () => {
  const vocabulary = ["dolphin", "dolman", "coffin"];
  assert.deepEqual(fuzzyVariantsFor("dolfin", { vocabulary, cap: 3 }), ["coffin", "dolman", "dolphin"]);
});

test("the same term and vocabulary give the same variants every time", () => {
  const vocabulary = ["dolphin", "dolman", "dolmen", "coffin"];
  assert.deepEqual(
    fuzzyVariantsFor("dolfin", { vocabulary, cap: 4 }),
    fuzzyVariantsFor("dolfin", { vocabulary, cap: 4 }),
  );
});

test("a term that is already in the vocabulary gets no variants", () => {
  assert.deepEqual(fuzzyVariantsFor("dolphin", { vocabulary: ["dolphin", "dolman"], cap: 4 }), []);
});

test("a real English word is not a typo, so it earns no variants", () => {
  assert.deepEqual(fuzzyVariantsFor("rests", { vocabulary: ["tests", "rest"], cap: 4 }), []);
});

test("a short or non-alphabetic term earns no variants", () => {
  assert.deepEqual(fuzzyVariantsFor("cat", { vocabulary: ["cot", "car"], cap: 4 }), []);
  assert.deepEqual(fuzzyVariantsFor("store.mjs", { vocabulary: ["store.mjs"], cap: 4 }), []);
});

test("a zero cap turns variant expansion off without touching the vocabulary", () => {
  assert.deepEqual(fuzzyVariantsFor("dolfin", { vocabulary: ["dolphin"], cap: 0 }), []);
});

test("a cap that is not a whole number is refused rather than rounded", () => {
  assert.throws(() => fuzzyVariantsFor("dolfin", { vocabulary: [], cap: 1.5 }), TypeError);
});

test("the plan marks which terms the turn wrote and which retrieval guessed at", () => {
  const plan = buildRetrievalPlan({
    text: "what is a dolfin", fuzzy: true, hopDepth: 2, fuzzyVariantsPerTerm: 2,
    vocabulary: ["dolphin", "coffin"],
  });
  assert.deepEqual(plan.terms.map((entry) => [entry.term, entry.origin]), [
    ["coffin", "fuzzy"],
    ["dolfin", "exact"],
    ["dolphin", "fuzzy"],
  ]);
  assert.equal(plan.terms.find((entry) => entry.term === "dolphin").from, "dolfin");
});

test("fuzzy off asks only for what the turn actually said", () => {
  const plan = buildRetrievalPlan({
    text: "what is a dolfin", fuzzy: false, hopDepth: 2, fuzzyVariantsPerTerm: 4,
    vocabulary: ["dolphin", "coffin"],
  });
  assert.deepEqual(plan.terms.map((entry) => entry.term), ["dolfin"]);
  assert.equal(plan.fuzzy, false);
});

test("an exact term keeps its origin when a variant spells the same word", () => {
  const plan = buildRetrievalPlan({
    text: "what is a letter", fuzzy: true, hopDepth: 2, fuzzyVariantsPerTerm: 4,
    vocabulary: ["letter"],
  });
  assert.deepEqual(plan.terms.filter((entry) => entry.term === "letter").map((entry) => entry.origin), ["exact"]);
});

test("the same turn builds the same plan twice, and the plan cannot be edited after", () => {
  const build = () => buildRetrievalPlan({
    text: "is a dolphin a mammal", fuzzy: true, hopDepth: 2, fuzzyVariantsPerTerm: 4,
  });
  assert.deepEqual(build(), build());
  assert.ok(Object.isFrozen(build()));
  assert.ok(Object.isFrozen(build().terms));
});

test("a hop depth that is not a whole number is refused", () => {
  assert.throws(() => buildRetrievalPlan({ text: "a dolphin", hopDepth: -1, fuzzyVariantsPerTerm: 4 }), TypeError);
});

test("reads the triple out of a stored fact row", () => {
  assert.deepEqual(
    factTripleOf(factRow({ subject: "dolphin", predicate: ANCESTRY_PREDICATE, object: "mammal" })),
    { subject: "dolphin", predicate: ANCESTRY_PREDICATE, object: "mammal" },
  );
});

test("a row that is not a readable fact reads as no triple at all", () => {
  assert.equal(factTripleOf(null), null);
  assert.equal(factTripleOf({ rowClass: "source", json: "{}" }), null);
  assert.equal(factTripleOf({ rowClass: "fact", json: "not json" }), null);
  assert.equal(factTripleOf({ rowClass: "fact", json: JSON.stringify({ individual: { attributes: [] } }) }), null);
});

test("the next hop is every object the rows named, sorted and deduped", () => {
  const rows = [
    factRow({ subject: "dolphin", predicate: ANCESTRY_PREDICATE, object: "mammal" }),
    factRow({ subject: "dolphin", predicate: "mgx:capableOf", object: "swim" }),
    factRow({ subject: "whale", predicate: ANCESTRY_PREDICATE, object: "mammal" }),
  ];
  assert.deepEqual(expandedTerms(rows), ["mammal", "swim"]);
});

test("a term already asked for is not asked for again", () => {
  const rows = [factRow({ subject: "dolphin", predicate: ANCESTRY_PREDICATE, object: "mammal" })];
  assert.deepEqual(expandedTerms(rows, { seen: new Set(["mammal"]) }), []);
});

test("the ancestry chase follows superclass rows and nothing else", () => {
  const rows = [
    factRow({ subject: "dolphin", predicate: ANCESTRY_PREDICATE, object: "mammal" }),
    factRow({ subject: "dolphin", predicate: "mgx:capableOf", object: "swim" }),
  ];
  assert.deepEqual(ancestryTerms(rows), ["mammal"]);
});
