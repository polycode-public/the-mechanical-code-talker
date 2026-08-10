// ask-vocab.test.mjs — the committed vocabulary's own invariants (drift/collision
// guards) plus proof that newly-broadened phrases actually parse through ask.mjs's
// grammar, not just exist in the table.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RELATIONS, VERB_TO_KIND, ENTITY_TO_TYPE, MODIFIER_TO_KIND, MISSPELLINGS, WRONG_WORDS, AGGREGATE_TRIGGERS, LIST_TRIGGERS, phraseForRelation } from "../../src/domain/ask-vocab.mjs";
import { parseQuery, normalizeQuery } from "../../src/domain/ask.mjs";

// The aggregate/list TRIGGER words are grammar vocabulary too (parseAggregate/parseList
// read them), so a correction may legitimately restore one ("manyn"→"many", "lst"→"list").
const TRIGGER_WORDS = [...AGGREGATE_TRIGGERS, ...LIST_TRIGGERS].flatMap((p) => p.split(" "));

test("RELATIONS: no verb phrase is claimed by more than one relation", () => {
  const seen = new Map();
  for (const [kind, { verbs }] of Object.entries(RELATIONS)) {
    for (const v of verbs) {
      assert.ok(!seen.has(v), `"${v}" claimed by both ${seen.get(v)} and ${kind}`);
      seen.set(v, kind);
    }
  }
  assert.ok(seen.size >= 60, "the broadened vocabulary should carry considerably more than the original ~30 phrases");
});

test("VERB_TO_KIND is derived from RELATIONS, not hand-duplicated", () => {
  const expectedSize = Object.values(RELATIONS).reduce((n, r) => n + r.verbs.length, 0);
  assert.equal(Object.keys(VERB_TO_KIND).length, expectedSize);
  for (const [kind, { verbs }] of Object.entries(RELATIONS)) {
    for (const v of verbs) assert.equal(VERB_TO_KIND[v], kind);
  }
});

test("every relation in RELATIONS carries at least one verb phrase (no empty/dead relation)", () => {
  for (const [kind, { verbs }] of Object.entries(RELATIONS)) {
    assert.ok(verbs.length > 0, `relation "${kind}" has no verb phrases`);
  }
});

test("phraseForRelation derives the third-person verb phrase from RELATIONS' own bare form", () => {
  assert.equal(phraseForRelation("imports"), "imports");
  assert.equal(phraseForRelation("calls"), "calls");
  assert.equal(phraseForRelation("contains"), "contains");
  assert.equal(phraseForRelation("defines"), "defines");
  assert.equal(phraseForRelation("inherits"), "inherits from");
  assert.equal(phraseForRelation("tests"), "tests");
  assert.equal(phraseForRelation("touches"), "touches");
  assert.equal(phraseForRelation("cochange"), "co-changes with");
  assert.equal(phraseForRelation("reexports"), "re-exports");
  assert.equal(phraseForRelation("uses"), "uses");
  assert.equal(phraseForRelation("serves"), "serves");
  assert.equal(phraseForRelation("denotes"), "denotes");
});

test("phraseForRelation: a symbol-grain kind reads its coarse sibling's phrase", () => {
  assert.equal(phraseForRelation("callsSymbol"), "calls");
  assert.equal(phraseForRelation("touchesSymbol"), "touches");
});

test("phraseForRelation: an unrecognized kind falls back to a plain camelCase split, never a thrown error", () => {
  assert.equal(phraseForRelation("someWeirdKind"), "some weird kind");
  assert.equal(phraseForRelation(""), "");
  assert.equal(phraseForRelation(undefined), "");
});

test("ENTITY_TO_TYPE / MODIFIER_TO_KIND still export the fixed small tables ask.mjs expects", () => {
  assert.equal(ENTITY_TO_TYPE.module, "Module");
  assert.equal(ENTITY_TO_TYPE.functions, "Function");
  assert.equal(MODIFIER_TO_KIND.explicitly, "direct");
  assert.equal(MODIFIER_TO_KIND.transitively, "transitive");
});

// One newly-added phrase per relation, proven through the real grammar (parseQuery),
// not just present in the table — a phrase could exist in RELATIONS and still fail to
// parse if VERB_ALT's regex construction were ever broken.
const NEW_PHRASE_CASES = [
  ["which modules relies on auth", "imports"],
  ["which modules requires auth", "imports"],
  ["which modules references auth", "imports"],
  ["which modules pulls in auth", "imports"],
  ["which functions hits helper", "calls"],
  ["which functions triggers helper", "calls"],
  ["which functions executes helper", "calls"],
  // "which classes … defined in X" now routes to the membership lane (typed
  // list over a container), so the contains VERB_ALT phrase is proven through
  // the untyped form instead.
  ["what is defined in Widget", "contains"],
  ["which modules verifies auth", "tests"],
  ["which modules exercises auth", "tests"],
  ["which classes is a subclass of Base", "inherits"],
  ["which classes is a kind of Base", "inherits"],
  ["which modules was changed in a.py", "touches"],
  ["which modules was modified by a.py", "touches"],
  ["which modules changes alongside a.py", "cochange"],
  ["which modules shares commits with a.py", "cochange"],
  // Present-tense bare cochange form (Seonix Batch 4/5 follow-up) — only the past
  // tense "changed with" existed before; empirically verified that VERB_ALT's
  // longest-first sort alone resolves this (no ENTITY_TO_TYPE "Change"-noun
  // collision reached parseRelationalOrQualified's fallback scan for this shape).
  ["which modules changes with a.py", "cochange"],
  ["which modules usually changes with a.py", "cochange"],
  ["which modules tends to change with a.py", "cochange"],
];

for (const [query, expectedKind] of NEW_PHRASE_CASES) {
  test(`parseQuery: newly-broadened phrase "${query}" resolves to kind ${expectedKind}`, () => {
    const parsed = parseQuery(query);
    assert.ok(parsed, `"${query}" failed to parse at all`);
    assert.equal(parsed.kind, expectedKind);
  });
}

// ---- MISSPELLINGS / WRONG_WORDS (two-level fuzzy): correction-table
// invariants — a key that IS vocabulary would rewrite legitimate queries, and a
// value that ISN'T canonical would "correct" into a word the grammar cannot use. ----

test("MISSPELLINGS/WRONG_WORDS: no key is itself a vocabulary word or grammar anchor", () => {
  const vocab = new Set([
    ...Object.keys(VERB_TO_KIND).flatMap((k) => k.split(" ")),
    ...Object.keys(ENTITY_TO_TYPE),
    ...Object.keys(MODIFIER_TO_KIND),
    "which", "what", "does", "do", "did", "is", "are", "the",
  ]);
  for (const key of [...Object.keys(MISSPELLINGS), ...Object.keys(WRONG_WORDS)]) {
    assert.ok(!vocab.has(key), `correction key "${key}" is a real vocabulary word — it would rewrite legitimate queries`);
  }
});

test("MISSPELLINGS/WRONG_WORDS: every value is a canonical word the grammar actually owns", () => {
  const canonical = new Set([
    ...Object.keys(VERB_TO_KIND).flatMap((k) => k.split(" ")),
    ...Object.keys(ENTITY_TO_TYPE),
    ...Object.keys(MODIFIER_TO_KIND),
    ...TRIGGER_WORDS,
    // "that" (C3, "dat"→"that"): a genuine grammar-owned anchor word
    // elsewhere in this codebase — chat.mjs's CONTEXT_WORDS pronoun set,
    // TEACH_RE's "remember that X" clause, DESCRIBE_PRONOUN_RE — this
    // vocab-level canon set just never needed to list it until now.
    "which", "what", "does", "the", "where", "that",
  ]);
  for (const [key, value] of [...Object.entries(MISSPELLINGS), ...Object.entries(WRONG_WORDS)]) {
    assert.ok(canonical.has(value), `"${key}" corrects to "${value}", which no grammar table owns`);
  }
});

test("MISSPELLINGS/WRONG_WORDS: the two tables never disagree over a key (a typo cannot be both)", () => {
  for (const key of Object.keys(MISSPELLINGS)) {
    assert.ok(!(key in WRONG_WORDS), `"${key}" appears in both correction tables`);
  }
});

test("MISSPELLINGS: covers a plausible typo for every entity-noun family and the core verb families", () => {
  const values = new Set(Object.values(MISSPELLINGS));
  for (const canonical of ["function", "class", "module", "method", "commit", "variable", "attribute", "import", "inherits", "extends", "touches", "changed", "which", "what", "does"]) {
    assert.ok(values.has(canonical) || values.has(canonical + "s"), `no misspelling entry corrects to "${canonical}"`);
  }
});

// ---- "w/" -> "with" / leetspeak "4" -> "for": neither can live in the
// MISSPELLINGS/WRONG_WORDS tables above
// (see normalize.mjs's own docblock ahead of W_SLASH_RE/FOR_DIGIT_THANKS_RE/
// FOR_DIGIT_EXAMPLE_RE for the two structural reasons), so they get their own
// narrow regex pass inside normalizeQuery instead. These tests prove: the
// corrections fire in realistic sentences, all the way through parseQuery (not
// just normalizeQuery's own text output); and — critically — the digit-
// protection invariant these regexes were built around is unmoved: a real
// count/sha/line-number "4" is never touched. ----

test('normalizeQuery: "w/" corrects to "with" in a realistic sentence', () => {
  assert.equal(
    normalizeQuery("what changes together w/ store.mjs"),
    "what changes together with store.mjs",
  );
});

test('parseQuery: "w/" correction reaches the real grammar (cochange relation)', () => {
  const parsed = parseQuery("what changes together w/ store.mjs");
  assert.ok(parsed, '"what changes together w/ store.mjs" failed to parse at all');
  assert.equal(parsed.kind, "cochange");
});

test('normalizeQuery: "w/" is NOT rewritten inside a path fragment or "w/o"', () => {
  assert.equal(normalizeQuery("src/w/foo.mjs uses auth"), "src/w/foo.mjs uses auth");
  assert.equal(
    normalizeQuery("which modules import w/o auth"),
    "which modules import w/o auth",
  );
});

test('normalizeQuery: leetspeak "4" corrects to "for" in its narrow trigger shapes', () => {
  assert.equal(normalizeQuery("thx 4 the help"), "thx for the help");
  assert.equal(normalizeQuery("cheers 4 that"), "cheers for that");
  assert.equal(
    normalizeQuery("what does auth do, 4 example"),
    "what does auth do, for example",
  );
});

// ---- leading filler + dangling comma (fast-loop deferred finding, closed out
// for real this round): stripping a filler word alone used to leave its
// trailing comma behind as parse-corrupting debris — normalize.mjs's filler
// strip now swallows a comma immediately trailing the matched filler word/
// phrase (see stripFillerWords in interpret/normalize.mjs). ----
test('normalizeQuery: a filler word\'s trailing comma is stripped along with the word, not left dangling', () => {
  assert.equal(
    normalizeQuery("so um, like, what does the store module do exactly?"),
    "what does the store module do exactly?",
  );
  assert.equal(
    normalizeQuery("so, what does the store module do?"),
    "what does the store module do?",
  );
  assert.equal(
    normalizeQuery("ok cool, what does the store module do?"),
    "what does the store module do?",
  );
  // the plain (no-filler) form is byte-unchanged — the fix only ever removes
  // filler-glued punctuation, it never touches an ordinary content comma.
  assert.equal(
    normalizeQuery("what does the store module do exactly?"),
    "what does the store module do exactly?",
  );
});

test("normalizeQuery: an ordinary content comma (not glued to a filler word) survives the filler strip untouched", () => {
  assert.equal(normalizeQuery("please, tell me the modules, and the classes"), "the modules, and the classes");
  assert.equal(normalizeQuery("the modules, and the classes"), "the modules, and the classes");
});

test('parseQuery: leetspeak "4 example" correction reaches the real grammar', () => {
  const parsed = parseQuery("which modules call helper 4 example");
  assert.ok(parsed, '"which modules call helper 4 example" failed to parse at all');
  assert.equal(parsed.kind, "calls");
  assert.equal(parsed.object, "helper for example");
});

test('normalizeQuery: digit-protection invariant unmoved — a real count/sha/line-number "4" passes through untouched', () => {
  assert.equal(normalizeQuery("top 4 results"), "top 4 results");
  assert.equal(normalizeQuery("line 4"), "line 4");
  assert.equal(
    normalizeQuery("commit 4a2b1c3 touches store.mjs"),
    "commit 4a2b1c3 touches store.mjs",
  );
  // "4 example modules" is a genuine COUNT of example modules, not the "for
  // example" idiom — the trailing-word lookahead must refuse this one.
  assert.equal(
    normalizeQuery("show me the 4 example modules"),
    "show me the 4 example modules",
  );
  // "wait"/"used" were deliberately left OUT of the thanks-anchor set because
  // they collide with genuine counts ("wait 4 minutes" is a real duration) —
  // the digit must survive even though "wait" itself is filler stripped
  // elsewhere in the pipeline.
  assert.match(normalizeQuery("wait 4 minutes"), /\b4\b/);
  assert.doesNotMatch(normalizeQuery("wait 4 minutes"), /\bfor\b/);
});

test('parseQuery: digit-protection invariant unmoved through the full grammar ("top 4 modules" keeps its count)', () => {
  const parsed = parseQuery("top 4 modules call helper");
  assert.ok(parsed, '"top 4 modules call helper" failed to parse at all');
  assert.equal(parsed.subject, "top 4");
});
