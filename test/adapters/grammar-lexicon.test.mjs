// grammar/lexicon.mjs tests — the declared lexicon: loading + merging, the
// deterministic morphology folds, classify(), and the data integrity of the
// committed core JSON (every declared typing is a legal one).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadLexicon, classify, numberOf, thirdPerson, predicateOf,
  lookupNoun, lookupVerb, lookupAdjective, lookupProperName,
  DETERMINERS, QUANTIFIERS,
} from "../../src/domain/grammar/lexicon.mjs";
import { mergedLexiconExtra } from "../../src/services/extensions.mjs";

test("loadLexicon: the committed core is a real starter vocabulary (size floors), cached when unextended", () => {
  const lex = loadLexicon();
  // The human-persona lexicon grew in two steps: the Small tier roughly
  // doubled the core (180/63/33/15 software-only ->
  // 464/92/58/22 software+human-world); the Medium/Large tiers then
  // added thousands more NOUNS specifically (WordNet's own real hypernym/
  // meronym population, curated down per-clump — see
  // scripts/build-persona-tiers.mjs), leaving verbs/adjectives/proper names
  // untouched (Large's facts are all noun-noun IsA/HasA/MadeOf relations, no
  // new predicate words needed). Floors/ceiling raised to match — this still
  // pins "a real, bounded vocabulary", not an unbounded dump (a future
  // change that pulls in WordNet's verb/adjective files too would
  // deliberately need to raise this again, not silently blow past it).
  assert.ok(lex.nouns.size >= 9000, `nouns: ${lex.nouns.size} >= 9000`);
  assert.ok(lex.verbs.size >= 80, `verbs: ${lex.verbs.size} >= 80`);
  assert.ok(lex.adjectives.size >= 50, `adjectives: ${lex.adjectives.size} >= 50`);
  assert.ok(lex.properNames.size >= 20, `proper names: ${lex.properNames.size} >= 20`);
  const total = lex.nouns.size + lex.verbs.size + lex.adjectives.size + lex.properNames.size;
  assert.ok(total >= 9000 && total <= 12000, `starter lexicon stays a bounded, curated vocabulary: ${total} entries`);
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

// ---- Part 3 (extension-pack batch): mergedLexiconExtra bias-ordering merge ----

const tmp = () => mkdtemp(join(tmpdir(), "tmct-lex-merge-"));

test("mergedLexiconExtra: no active lexicon/pack entries -> null (loadLexicon(undefined) stays the byte-identical cached core)", async () => {
  const entries = new Map([
    ["seon", { kind: "corpus", active: true, corpusPath: "/x/seon.jsonl" }],
    ["mypack", { kind: "lexicon", active: false, lexiconPath: "/x/inactive.json" }],
  ]);
  assert.equal(await mergedLexiconExtra(entries), null);
  assert.equal(await mergedLexiconExtra(new Map()), null);
});

test("mergedLexiconExtra: a HIGHER-bias bundle's same-lemma entry wins on collision (ascending merge order)", async () => {
  const dir = await tmp();
  try {
    const lowPath = join(dir, "low.json");
    const highPath = join(dir, "high.json");
    await writeFile(lowPath, JSON.stringify({ nouns: { widget: { property: "data" } } }));
    await writeFile(highPath, JSON.stringify({ nouns: { widget: { property: "object" } } }));
    const entries = new Map([
      ["low", { kind: "lexicon", active: true, lexiconPath: lowPath }],
      ["high", { kind: "lexicon", active: true, lexiconPath: highPath }],
    ]);
    const extra = await mergedLexiconExtra(entries, { low: 0.5, high: 2 });
    assert.equal(extra.nouns.widget.property, "object", "the higher-bias bundle's entry wins");

    // flip the bias assignment — the merge order flips, so the winner flips too
    const extraFlipped = await mergedLexiconExtra(entries, { low: 5, high: 0.5 });
    assert.equal(extraFlipped.nouns.widget.property, "data", "now the (relabelled) higher-bias bundle wins");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mergedLexiconExtra: ties (equal/absent bias) keep the entries Map's own iteration order — last-in-order wins", async () => {
  const dir = await tmp();
  try {
    const aPath = join(dir, "a.json");
    const bPath = join(dir, "b.json");
    await writeFile(aPath, JSON.stringify({ nouns: { widget: { property: "data" } } }));
    await writeFile(bPath, JSON.stringify({ nouns: { widget: { property: "object" } } }));
    // Map iteration order: a, then b — both unconfigured (bias defaults to 1, a tie)
    const entries = new Map([
      ["a", { kind: "lexicon", active: true, lexiconPath: aPath }],
      ["b", { kind: "lexicon", active: true, lexiconPath: bPath }],
    ]);
    const extra = await mergedLexiconExtra(entries);
    assert.equal(extra.nouns.widget.property, "object", "b, later in iteration order, wins the tie");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mergedLexiconExtra: merges verbs/adjectives/properNames too, deduping properNames; feeds loadLexicon(extra) directly", async () => {
  const dir = await tmp();
  try {
    const path = join(dir, "pack.json");
    await writeFile(path, JSON.stringify({
      nouns: { frob: {} },
      verbs: { frobnicate: {} },
      adjectives: { bespoke: { type: "subclass" } },
      properNames: ["Seonix"],
    }));
    const entries = new Map([["mypack", { kind: "pack", active: true, lexiconPath: path }]]);
    const extra = await mergedLexiconExtra(entries);
    const lex = loadLexicon(extra);
    assert.equal(lookupNoun(lex, "frobs").lemma, "frob");
    assert.equal(lookupVerb(lex, "frobnicates").lemma, "frobnicate");
    assert.equal(lookupAdjective(lex, "bespoke").type, "subclass");
    assert.equal(lookupProperName(lex, "seonix"), "Seonix");
    // core vocabulary is still there (extra MERGES, never replaces)
    assert.ok(lex.nouns.has("module"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mergedLexiconExtra: inactive entries and non-lexicon/pack kinds are skipped; a corpus-only pack entry (no lexiconPath) is skipped too", async () => {
  const entries = new Map([
    ["inactive", { kind: "lexicon", active: false, lexiconPath: "/does/not/matter.json" }],
    ["corpus-only-pack", { kind: "pack", active: true, corpusPath: "/x.jsonl" }], // no lexiconPath
    ["templates", { kind: "templates", active: true, templatesPath: "/x.jsonl" }],
  ]);
  assert.equal(await mergedLexiconExtra(entries), null);
});
