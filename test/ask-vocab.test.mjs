// ask-vocab.test.mjs — the committed vocabulary's own invariants (drift/collision
// guards) plus proof that newly-broadened phrases actually parse through ask.mjs's
// grammar, not just exist in the table.
import { test } from "node:test";
import assert from "node:assert/strict";
import { RELATIONS, VERB_TO_KIND, ENTITY_TO_TYPE, MODIFIER_TO_KIND, MISSPELLINGS, WRONG_WORDS, AGGREGATE_TRIGGERS, LIST_TRIGGERS } from "../src/ask-vocab.mjs";
import { parseQuery } from "../src/ask.mjs";

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
  ["which classes is defined in Widget", "contains"],
  ["which modules verifies auth", "tests"],
  ["which modules exercises auth", "tests"],
  ["which classes is a subclass of Base", "inherits"],
  ["which classes is a kind of Base", "inherits"],
  ["which modules was changed in a.py", "touches"],
  ["which modules was modified by a.py", "touches"],
  ["which modules changes alongside a.py", "cochange"],
  ["which modules shares commits with a.py", "cochange"],
];

for (const [query, expectedKind] of NEW_PHRASE_CASES) {
  test(`parseQuery: newly-broadened phrase "${query}" resolves to kind ${expectedKind}`, () => {
    const parsed = parseQuery(query);
    assert.ok(parsed, `"${query}" failed to parse at all`);
    assert.equal(parsed.kind, expectedKind);
  });
}

// ---- MISSPELLINGS / WRONG_WORDS (two-level fuzzy, 2026-07-02): correction-table
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
    "which", "what", "does", "the", "where",
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
