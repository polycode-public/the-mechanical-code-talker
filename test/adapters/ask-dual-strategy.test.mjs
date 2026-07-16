// ask-dual-strategy.test.mjs — the ELIZA/PARRY-style combine-and-merge rework
// (§3.5/3.6 of ask-vocab.mjs, ask.mjs's parseAnchored + parseKeywordSpot + merge):
// normalization, negation frames, keyword-spotting's tolerance for casual/
// dialectal phrasing, and the merge step's agree/disagree/single-hit/no-hit
// outcomes. The anchored-template strategy is unmodified and already covered by
// ask.test.mjs — these tests exercise the NEW second strategy and the merge on
// top of it, using the operator's own worked phrasings where given.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuery, normalizeQuery, applyNegationFrames } from "../../src/domain/ask.mjs";

// ---- the operator's own worked example: three real phrasings of "what calls
// this", tolerant of register (formal "invokes", neutral "calls", casual
// "executes ... where from") and of word order, must all resolve identically. ----

test("keyword-spot: \"what calls this\" / \"who invokes this\" / \"something executes this, where from\" all parse identically", () => {
  const a = parseQuery("what calls this");
  const b = parseQuery("who invokes this");
  const c = parseQuery("something executes this, where from");
  assert.deepEqual(a, { shape: "reverse", entityType: null, modifier: "direct", kind: "calls", object: "this" });
  assert.deepEqual(b, a);
  assert.deepEqual(c, a);
});

// ---- negation: a double-negative/negative-rhetorical frame must resolve to
// the SAME underlying query (kind + shape) as its plain affirmative form — the
// object may differ in surface pronoun ("it" vs "this"), but both are context
// pronouns referring to the same kind of thing, not a different relation. ----

test("negation: \"there ain't nothin' callin' it?\" parses to the SAME shape/kind as \"what calls it\"", () => {
  const negative = parseQuery("there ain't nothin' callin' it?");
  const affirmative = parseQuery("what calls it");
  assert.ok(negative, "the double-negative form failed to parse at all");
  assert.equal(negative.shape, affirmative.shape);
  assert.equal(negative.kind, affirmative.kind);
  assert.equal(negative.object, affirmative.object);
});

test("negation: \"there's no module that imports auth\" parses the same as \"what imports auth\"", () => {
  const negative = parseQuery("there's no module that imports auth");
  const affirmative = parseQuery("what imports auth");
  assert.equal(negative.kind, "imports");
  assert.equal(negative.object, affirmative.object);
});

test("negation: tag-question double-negative — \"nothing calls it, does it\" parses as \"what calls it\"", () => {
  const p = parseQuery("nothing calls it, does it");
  assert.equal(p.kind, "calls");
  assert.equal(p.object, "it");
});

test("applyNegationFrames: unrecognized text passes through unchanged", () => {
  assert.equal(applyNegationFrames("which functions call helper"), "which functions call helper");
});

// ---- normalization building blocks, tested directly ----

test("normalizeQuery: expands contractions without lowercasing the whole string (object case is preserved)", () => {
  assert.equal(normalizeQuery("what's myFile import"), "what is myFile import");
});

test("normalizeQuery: g-drop restores dropped-g casual verb forms", () => {
  assert.equal(normalizeQuery("who is callin' helper"), "who is calling helper");
});

test("normalizeQuery: filler/politeness words are stripped, real content words are not", () => {
  const norm = normalizeQuery("um so like could you tell me quickly which functions hits helper");
  assert.equal(norm, "which functions hits helper");
});

// ---- filler-heavy casual phrasing end-to-end through parseQuery ----

test("keyword-spot: a filler-heavy casual phrasing parses the same as its plain equivalent", () => {
  const casual = parseQuery("um so like could you tell me quickly which functions hits helper");
  const plain = parseQuery("which functions call helper");
  assert.equal(casual.kind, plain.kind);
  assert.equal(casual.entityType, plain.entityType);
  assert.equal(casual.object, plain.object);
});

// ---- keyword-spotting tolerates reordering the anchored templates can't ----

test("keyword-spot: \"does myFile import logging\" (ask-shape) still agrees with the anchored strategy, not just fires standalone", () => {
  // both strategies independently reach the ask shape for a well-formed anchored sentence —
  // proof the second strategy doesn't regress a sentence the FIRST strategy already handles.
  const p = parseQuery("does myFile import logging");
  assert.equal(p.shape, "ask");
  assert.equal(p.subject, "myFile");
  assert.equal(p.object, "logging");
});

test("keyword-spot only: \"which functions hits helper\" (anchored's own VERB_ALT already covers this, both strategies agree)", () => {
  const p = parseQuery("which functions hits helper");
  assert.equal(p.kind, "calls");
  assert.equal(p.entityType, "Function");
  assert.equal(p.object, "helper");
});

// ---- merge: a genuine strategy disagreement surfaces honestly as ambiguous,
// never a silently-preferred guess ----

test("merge: two strategies disagreeing on shape/kind surfaces as ambiguousParse with both candidates, not a guess", () => {
  // "extends Base" (inherits) sits right after the entity, which the ANCHORED template reads
  // literally as its verb; but "couples to" (imports) is a longer phrase, so the
  // POSITION-INDEPENDENT keyword-spotter finds and prioritizes it instead — the two
  // strategies genuinely disagree on both shape and kind for this sentence.
  const p = parseQuery("which classes extends Base and couples to logging");
  assert.equal(p.ambiguousParse, true);
  assert.equal(p.candidates.length, 2);
  const kinds = p.candidates.map((c) => c.kind).sort();
  assert.deepEqual(kinds, ["imports", "inherits"]);
});

test("merge: an out-of-grammar sentence neither strategy can parse is still an honest null, not a forced ambiguity", () => {
  assert.equal(parseQuery("what is the meaning of this codebase"), null);
});

// ---- "what is a kind of X" (2026-07-11 live bug): the anchored grammar's T5
// "meta-whatis" template ALSO matches this phrasing (reading "kind of animal" as a
// literal term to define) and used to collide with keyword-spot's correct
// "is a kind of" -> reverse/inherits reading to manufacture a spurious
// {ambiguousParse} tie — a genuine follow-up question ("dog is a kind of animal" ->
// "what is a kind of animal") hit a forced disambiguation wall instead of an answer.
// grammar.mjs's T5 now rejects the meta reading for this shape (ARTICLE_RELATION_
// CONTINUATIONS, ask-vocab.mjs), so only keyword-spot's reading survives — no tie. ----

test("kind-of collision fix: \"what is a kind of animal\" / \"what is a kind of horse\" parse UNAMBIGUOUSLY to the reverse/inherits reading, not the spurious meta tie", () => {
  const a = parseQuery("what is a kind of animal");
  assert.deepEqual(a, { shape: "reverse", entityType: null, modifier: "direct", kind: "inherits", object: "animal" });
  const b = parseQuery("what is a kind of horse");
  assert.deepEqual(b, { shape: "reverse", entityType: null, modifier: "direct", kind: "inherits", object: "horse" });
});

test("kind-of collision fix: \"what is a subclass of X\" (the sibling inherits verb) gets the same unambiguous fix", () => {
  const p = parseQuery("what is a subclass of animal");
  assert.deepEqual(p, { shape: "reverse", entityType: null, modifier: "direct", kind: "inherits", object: "animal" });
});

test("kind-of collision fix: plain \"what is a Commit\"/\"what is a Module\" (no relation-verb continuation) is UNCHANGED — still the closed-set bare-form meta reading", () => {
  const commit = parseQuery("what is a Commit");
  assert.deepEqual(commit, { shape: "meta", entityType: null, modifier: "direct", kind: "meta", object: "Commit" });
});

test("kind-of collision fix scoping: \"what is a superclass of X\" / \"what is a parent class of X\" (the REVERSE-direction inherits verbs) still surface the honest {ambiguousParse} — NOT silently resolved", () => {
  // "is a superclass of"/"is a parent class of" mean the OPPOSITE direction of "is a
  // kind of"/"is a subclass of" (INHERITS_REVERSE_VERBS, ask-vocab.mjs) — keyword-spot's
  // decomposition only applies that direction swap in the two-sided "ask" shape, not
  // this afterText-only "reverse" shape, so blindly suppressing the meta reading here
  // too would trade an honest wall for a confidently WRONG answer. ARTICLE_RELATION_
  // CONTINUATIONS deliberately excludes these two verbs — this test locks that scoping in.
  const sup = parseQuery("what is a superclass of shirehorse");
  assert.equal(sup.ambiguousParse, true);
  const kinds = sup.candidates.map((c) => c.kind).sort();
  assert.deepEqual(kinds, ["inherits", "meta"]);
  const parent = parseQuery("what is a parent class of shirehorse");
  assert.equal(parent.ambiguousParse, true);
});

test("kind-of collision fix scoping: the frozen 'what does imports mean' ambiguity (am-meta-imports) is untouched by this fix", () => {
  const p = parseQuery("what does imports mean");
  assert.equal(p.ambiguousParse, true);
  const kinds = p.candidates.map((c) => c.kind).sort();
  assert.deepEqual(kinds, ["imports", "meta"]);
});

test("kind-of collision fix scoping: the pinned genuine cross-strategy ambiguity (\"which classes extends Base and couples to logging\") is untouched", () => {
  const p = parseQuery("which classes extends Base and couples to logging");
  assert.equal(p.ambiguousParse, true);
  assert.equal(p.candidates.length, 2);
});

test("merge: when only the keyword-spotting strategy fires, its result is returned as-is (no anchored fallback needed)", () => {
  // "what calls this" cannot match any anchored TEMPLATE (none of the three fixed shapes
  // start with "what" + a bare verb with no "does"/"do") — proof this phrasing genuinely
  // depends on the second strategy, not a coincidental anchored match.
  const p = parseQuery("what calls this");
  assert.equal(p.shape, "reverse");
  assert.equal(p.kind, "calls");
  assert.equal(p.object, "this");
});

// ---- commit questions (viewer commit-chat fix): the "commit <sha>" noun must not
// split the two strategies — anchored keeps the noun inside its captured object
// span, keyword-spot consumes it as the entity keyword, and the merge treats
// "commit abc1234" / "abc1234" as the same term rather than a disagreement. ----

test("merge: \"which changes touch commit ef74e44e25c8\" — both strategies fire and AGREE (no ambiguousParse)", () => {
  const p = parseQuery("which changes touch commit ef74e44e25c8");
  assert.equal(p.ambiguousParse, undefined);
  assert.deepEqual(p, { shape: "reverse", entityType: "Change", modifier: "direct", kind: "touches", object: "commit ef74e44e25c8" });
});

test("keyword-spot only: casual \"what changed in abc1234\" (no anchored template starts \"what changed\")", () => {
  const p = parseQuery("what changed in abc1234");
  assert.deepEqual(p, { shape: "reverse", entityType: null, modifier: "direct", kind: "touches", object: "abc1234" });
});

test("keyword-spot only: \"which changes landed in commit ef74e44e25c8\" and the passive \"what was touched by commit ef74e44e25c8\" both reach the commit question", () => {
  const landed = parseQuery("which changes landed in commit ef74e44e25c8");
  assert.equal(landed.kind, "touches");
  assert.equal(landed.entityType, "Change");
  assert.equal(landed.object, "commit ef74e44e25c8");
  // the passive names its agent ("by commit <sha>") and questions its patient
  // ("what"), so it reads forward from the commit. The spotter consumes "commit"
  // as the entity keyword, leaving the bare sha as the object; traverse() reads a
  // resolved Commit as the touch subject whichever way the shape points, so this
  // reaches the same answer the active "what did commit <sha> touch" gives.
  const passive = parseQuery("what was touched by commit ef74e44e25c8");
  assert.equal(passive.kind, "touches");
  assert.equal(passive.shape, "forward");
  assert.equal(passive.entityType, "Commit");
  assert.equal(passive.object, "ef74e44e25c8");
});

// ---- two-level fuzzy (2026-07-02): the keyword-spot strategy's FUZZY tier —
// adapter-free (nlp:null throughout), so everything here also holds in the
// inlined viewer bundle. Exact curated matches always win; the fuzzy rewrite
// fires only when NO exact verb phrase exists anywhere in the sentence, targets
// verb/modifier keywords only, and refuses distance ties outright. ----

test("fuzzy keyword: \"which modules impotr walk.mjs\" (transposition, not in MISSPELLINGS) parses via the bounded-edit-distance tier", () => {
  const p = parseQuery("which modules impotr walk.mjs", { nlp: null });
  assert.deepEqual(p, {
    shape: "reverse", entityType: "Module", modifier: "direct", kind: "imports", object: "walk.mjs",
    // the repair is disclosed on the AST, naming the word it rewrote, so
    // consumers can tell a fuzzy-tier reading from an exact-vocabulary one
    fuzzyVerb: { from: "impotr", to: "import" },
  });
});

test("fuzzy keyword: a distance TIE between two vocab words is refused — the query stays an honest grammar miss", () => {
  // "coves" is 1 edit from BOTH "cover" (tests) and "moves" (cochange's "moves
  // together with" constituent) — no unique intent, so no rewrite, so no verb.
  assert.equal(parseQuery("which modules coves logging", { nlp: null }), null);
});

test("fuzzy keyword: never fires when an exact verb phrase exists — the exact parse is byte-identical to before", () => {
  const p = parseQuery("which functions call helper", { nlp: null });
  assert.deepEqual(p, { shape: "reverse", entityType: "Function", modifier: "direct", kind: "calls", object: "helper" });
});

test("fuzzy keyword: entity nouns are not fuzzy targets — an identifier 2 edits from \"file\" is left alone as the subject term", () => {
  // "myfile" would be within bound of the entity noun "file"; entity nouns are
  // excluded from FUZZY_TARGET_WORDS precisely so this stays the subject term.
  const p = parseQuery("does myfile import logging", { nlp: null });
  assert.equal(p.shape, "ask");
  assert.equal(p.subject, "myfile");
});

// ---- query families (2026-07-02): where/when carry no relation verb (where) or a
// question-word rerouting (when) — both must come out of the anchored template AND
// the keyword-spot decomposition as the SAME parse, or the merge would surface a
// spurious ambiguity on every location/temporal question. ----

test("merge: \"where is walk.mjs defined\" — both strategies agree on the where shape", () => {
  const p = parseQuery("where is walk.mjs defined", { nlp: null });
  assert.equal(p.ambiguousParse, undefined);
  assert.deepEqual(p, { shape: "where", entityType: null, modifier: "direct", kind: "where", object: "walk.mjs" });
});

test("merge: \"when did walk.mjs change\" — both strategies agree on the when shape", () => {
  const p = parseQuery("when did walk.mjs change", { nlp: null });
  assert.equal(p.ambiguousParse, undefined);
  assert.deepEqual(p, { shape: "when", entityType: null, modifier: "direct", kind: "touches", object: "walk.mjs" });
});

test("keyword-spot: a decorative \"where\" next to a real relation verb does NOT become a location question (existing worked phrasing preserved)", () => {
  const p = parseQuery("something executes this, where from", { nlp: null });
  assert.equal(p.shape, "reverse");
  assert.equal(p.kind, "calls");
});

test("merge: \"what was in commit ef74e44e25c8\" — the commit-content frame rewrites before both strategies, so they agree (no ambiguousParse)", () => {
  const p = parseQuery("what was in commit ef74e44e25c8", { nlp: null });
  assert.equal(p.ambiguousParse, undefined);
  assert.equal(p.shape, "forward");
  assert.equal(p.kind, "touches");
  assert.equal(p.object, "commit ef74e44e25c8");
});

// ---- full regression: every phrase the P0 anchored grammar already handled
// must still resolve to the exact same parse now that a second strategy runs
// alongside it (ask.test.mjs covers this in depth; these are extra spot checks
// on phrases likely to interact with the new normalization/keyword-spot passes). ----

test("regression: plain formal/neutral anchored phrasings are unaffected by the dual-strategy rework", () => {
  assert.deepEqual(parseQuery("Which functions explicitly couple to logging"),
    { shape: "reverse", entityType: "Function", modifier: "direct", kind: "imports", object: "logging" });
  assert.deepEqual(parseQuery("what does myFile import"),
    { shape: "forward", entityType: null, modifier: "direct", kind: "imports", object: "myFile" });
  assert.equal(parseQuery("which classes inherit from Base").kind, "inherits");
});

// ---- found live (playtest sprint round 1, SKILL_PLAYTEST_SPRINT.md): "what
// tests cover X" and "which tests test X" — the relation-noun "tests" and the
// relation's OWN verb synonym ("cover"/"test") are adjacent, and only the noun
// got consumed, leaving the real verb glued into the object ("cover X" instead
// of "X"). Fixed by stripping a redundant same-kind verb immediately after the
// matched one, anchored to that exact position (never a general re-scan). ----

test("keyword-spot: a redundant same-kind verb right after the relation-noun trigger is stripped, not left in the object", () => {
  assert.deepEqual(parseQuery("what tests cover src/core/model.mjs"),
    { shape: "reverse", entityType: null, modifier: "direct", kind: "tests", object: "src/core/model.mjs" });
  assert.deepEqual(parseQuery("which tests cover src/core/model.mjs"),
    { shape: "reverse", entityType: null, modifier: "direct", kind: "tests", object: "src/core/model.mjs" });
  assert.deepEqual(parseQuery("which tests test src/core/model.mjs"),
    { shape: "reverse", entityType: null, modifier: "direct", kind: "tests", object: "src/core/model.mjs" });
  assert.deepEqual(parseQuery("what covers src/core/model.mjs"),
    { shape: "reverse", entityType: null, modifier: "direct", kind: "tests", object: "src/core/model.mjs" });
  assert.deepEqual(parseQuery("which modules cover src/core/model.mjs"),
    { shape: "reverse", entityType: "Module", modifier: "direct", kind: "tests", object: "src/core/model.mjs" });
});

// ---- found live (same round): a frequency adverb ("usually"/"typically") glued
// onto the object term instead of being stripped as filler — "what does X
// usually change together with" resolved to object "X usually", an unresolvable
// term. Fixed by adding the frequency-adverb family to STOPWORDS (normalize.mjs),
// the same filler-word mechanism every other stopword already uses. ----

test("keyword-spot: frequency-adverb filler (\"usually\"/\"typically\"/…) is stripped from the object like any other stopword", () => {
  assert.deepEqual(parseQuery("what does src/core/store.mjs usually change together with"),
    { shape: "reverse", entityType: null, modifier: "direct", kind: "cochange", object: "src/core/store.mjs" });
  assert.deepEqual(parseQuery("what does src/core/store.mjs change together with"),
    parseQuery("what does src/core/store.mjs usually change together with"),
    "the adverb-free and adverb-bearing phrasings parse identically");
});

// ---- found live (this round): a modal auxiliary ("should") survived the fuzzy-
// correction cascade — with no modal in STOPWORDS, "should" reached the cascade's
// bounded fuzzy-correct-toward-closed-vocab step and landed within edit distance of
// "hold" (a "defines" verb synonym, ask-vocab.mjs), corrupting "what should i look at
// first" into a confident-looking "read as 'what hold i at' — …" instead of an honest
// miss. Fixed by adding the modal family to STOPWORDS (normalize.mjs), the same
// filler-word mechanism the frequency-adverb fix above already uses. ----

test("keyword-spot: a modal auxiliary (\"should\"/\"would\"/…) never survives to the fuzzy-correction cascade", () => {
  // "should" must not corrupt into the unrelated closed-vocab word "hold" (a
  // "defines" verb synonym, ask-vocab.mjs) — the query has no compilable graph shape
  // at all, so it stays a direct-parse null (never a confident-wrong guess), exactly
  // like any other stopword-only residual.
  assert.equal(parseQuery("what should i look at first"), null);
  for (const modal of ["would", "could", "can", "will", "shall", "might", "must"]) {
    assert.equal(parseQuery(`what ${modal} i look at first`), null, `modal "${modal}" must not survive to a corrupted parse`);
  }
});

// ---- found live (playtest sprint round 3): a leading discourse marker ("btw")
// with no delimiter after it derailed the whole parse — "btw what does X change
// together with" was misread as an "ask"-shaped touches query with subject "btw
// X" instead of the intended reverse cochange query, because "btw" carried no
// grammatical weight anywhere in the tokenizer. Fixed by adding "btw"/"by the
// way" to FILLER_WORDS (ask-vocab.mjs), the same mechanism that already strips
// "so"/"like"/"hey" as bare discourse filler — no new preamble frame needed. ----

test("keyword-spot: a leading 'btw' discourse marker (no delimiter) is stripped like any other filler word", () => {
  assert.deepEqual(parseQuery("btw what does src/core/store.mjs change together with"),
    { shape: "reverse", entityType: null, modifier: "direct", kind: "cochange", object: "src/core/store.mjs" });
  assert.deepEqual(parseQuery("by the way what does src/core/store.mjs change together with"),
    parseQuery("what does src/core/store.mjs change together with"),
    "the 'btw' and 'by the way' forms parse identically to the bare phrasing");
});
