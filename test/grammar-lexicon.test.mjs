// grammar/lexicon.mjs tests — the declared lexicon: loading + merging, the
// deterministic morphology folds, classify(), and the data integrity of the
// committed core JSON (every declared typing is a legal one).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadLexicon, classify, numberOf, thirdPerson, predicateOf,
  lookupNoun, lookupVerb, lookupAdjective, lookupProperName,
  DETERMINERS, QUANTIFIERS,
} from "../src/grammar/lexicon.mjs";

test("loadLexicon: the committed core is a real starter vocabulary (size floors), cached when unextended", () => {
  const lex = loadLexicon();
  assert.ok(lex.nouns.size >= 100, `nouns: ${lex.nouns.size} >= 100`);
  assert.ok(lex.verbs.size >= 40, `verbs: ${lex.verbs.size} >= 40`);
  assert.ok(lex.adjectives.size >= 20, `adjectives: ${lex.adjectives.size} >= 20`);
  assert.ok(lex.properNames.size >= 10, `proper names: ${lex.properNames.size} >= 10`);
  const total = lex.nouns.size + lex.verbs.size + lex.adjectives.size + lex.properNames.size;
  assert.ok(total >= 150 && total <= 300, `starter lexicon stays a starter: ${total} entries`);
  assert.equal(loadLexicon(), lex, "no-extra load is cached (the JSON is immutable at runtime)");
});

test("core data integrity: every adjective declares a legal type, every noun property typing is data|object", () => {
  const lex = loadLexicon();
  for (const [lemma, e] of lex.adjectives) {
    assert.ok(e.type === "subclass" || e.type === "data", `adjective ${lemma} typed`);
  }
  for (const [lemma, e] of lex.nouns) {
    if (e.property != null) assert.ok(e.property === "data" || e.property === "object", `noun ${lemma} property typing`);
  }
  // the software-domain anchors the ontology and tests lean on are present
  for (const n of ["module", "class", "function", "test", "service", "repository", "bug", "commit", "developer"]) {
    assert.ok(lex.nouns.has(n), `core noun "${n}"`);
  }
  for (const v of ["import", "call", "test", "contain", "extend", "use", "depend", "have"]) {
    assert.ok(lex.verbs.has(v), `core verb "${v}"`);
  }
});

test("loadLexicon(extra): user entries merge in and win on conflict; the cached core is untouched", () => {
  const lex = loadLexicon({
    nouns: { widget: {}, license: { property: "object" } },
    verbs: { frobnicate: {} },
    adjectives: { bespoke: { type: "subclass" } },
    properNames: ["Seonix"],
  });
  assert.equal(lookupNoun(lex, "widgets").lemma, "widget");
  assert.equal(lookupNoun(lex, "license").property, "object", "extra overrides the core typing");
  assert.equal(lookupVerb(lex, "frobnicates").lemma, "frobnicate");
  assert.equal(lookupAdjective(lex, "bespoke").type, "subclass");
  assert.equal(lookupProperName(lex, "seonix"), "Seonix");
  assert.equal(loadLexicon().nouns.get("license").property, "data", "core cache unpolluted");
  assert.equal(loadLexicon().nouns.has("widget"), false);
});

test("loadLexicon(extra): a lying declaration throws instead of making the grammar guess", () => {
  assert.throws(() => loadLexicon({ adjectives: { odd: {} } }), /type must be "subclass" or "data"/);
  assert.throws(() => loadLexicon({ adjectives: { odd: { type: "weird" } } }), /"odd"/);
  assert.throws(() => loadLexicon({ nouns: { thing: { property: "fuzzy" } } }), /"data" or "object"/);
});

test("morphology folds are deterministic suffix rules, not NLP: plurals and 3sg both resolve", () => {
  const lex = loadLexicon();
  assert.equal(lookupNoun(lex, "repositories").lemma, "repository", "-ies → y");
  assert.equal(lookupNoun(lex, "classes").lemma, "class", "-sses → ss");
  assert.equal(lookupNoun(lex, "branches").lemma, "branch", "-ches → ch");
  assert.equal(lookupNoun(lex, "modules").lemma, "module", "-s strip");
  assert.equal(lookupNoun(lex, "indices").lemma, "index", "declared irregular plural");
  assert.equal(lookupNoun(lex, "status").lemma, "status", "an s-final lemma is not over-stripped");
  assert.equal(lookupVerb(lex, "relies").lemma, "rely");
  assert.equal(lookupVerb(lex, "uses").lemma, "use");
  assert.equal(lookupVerb(lex, "catches").lemma, "catch");
  assert.equal(lookupVerb(lex, "has").lemma, "have", "irregular has → have");
  assert.equal(lookupVerb(lex, "imports").lemma, "import");
});

test("thirdPerson/predicateOf: the emitted predicate is the 3sg surface form, prep camel-appended", () => {
  assert.equal(thirdPerson("import"), "imports");
  assert.equal(thirdPerson("rely"), "relies");
  assert.equal(thirdPerson("catch"), "catches");
  assert.equal(thirdPerson("have"), "has");
  const lex = loadLexicon();
  assert.equal(predicateOf(lex.verbs.get("import")), "tmct:imports");
  assert.equal(predicateOf(lex.verbs.get("depend")), "tmct:dependsOn");
  assert.equal(predicateOf(lex.verbs.get("inherit")), "tmct:inheritsFrom");
  assert.equal(predicateOf({ lemma: "x", predicate: "mgx:custom" }), "mgx:custom", "declared override wins");
});

test("classify: every category answers {pos, type}; closed-class tokens and numbers included", () => {
  assert.deepEqual(classify("every"), { pos: "determiner", type: "universal" });
  assert.deepEqual(classify("a"), { pos: "determiner", type: "indefinite" });
  assert.deepEqual(classify("no"), { pos: "determiner", type: "negative" });
  assert.deepEqual(classify("at least"), { pos: "quantifier", type: "owl:minCardinality" });
  assert.deepEqual(classify("at most"), { pos: "quantifier", type: "owl:maxCardinality" });
  assert.deepEqual(classify("exactly"), { pos: "quantifier", type: "owl:cardinality" });
  assert.deepEqual(classify("3"), { pos: "number", type: "cardinal", value: 3 });
  assert.deepEqual(classify("one"), { pos: "number", type: "cardinal", value: 1 });
  assert.deepEqual(classify("Modules"), { pos: "noun", type: "class", lemma: "module" });
  assert.deepEqual(classify("license"), { pos: "noun", type: "data-property", lemma: "license", property: "data" });
  assert.deepEqual(classify("owner"), { pos: "noun", type: "object-property", lemma: "owner", property: "object" });
  assert.deepEqual(classify("depends"), { pos: "verb", type: "objectProperty", lemma: "depend", predicate: "tmct:dependsOn", prep: "on" });
  assert.deepEqual(classify("legacy"), { pos: "adjective", type: "subclass", lemma: "legacy" });
  assert.deepEqual(classify("deprecated"), { pos: "adjective", type: "data", lemma: "deprecated" });
  assert.deepEqual(classify("GITLAB"), { pos: "properName", type: "individual", canonical: "GitLab" });
  assert.equal(classify("frobnicate"), null, "undeclared word → null, never a guess");
  assert.equal(classify(""), null);
  assert.equal(classify(null), null);
});

test("classify priority: a word declared as both noun and verb answers as noun; grammar disambiguates by position", () => {
  assert.equal(classify("test").pos, "noun");
  assert.equal(classify("review").pos, "noun");
  const lex = loadLexicon();
  assert.ok(lookupVerb(lex, "tests"), "…but the verb reading stays reachable for the parser");
});

test("numberOf: digits and small number words only — no fuzzy numerals", () => {
  assert.equal(numberOf("7"), 7);
  assert.equal(numberOf("ten"), 10);
  assert.equal(numberOf("dozens"), null);
  assert.equal(numberOf("3.5"), null);
});

test("exported closed classes match the pattern table (every/a/no + at least/at most/exactly)", () => {
  assert.deepEqual(Object.keys(DETERMINERS).sort(), ["a", "an", "every", "no", "the"]);
  assert.deepEqual(Object.keys(QUANTIFIERS).sort(), ["at least", "at most", "exactly"]);
});
