// ask-dual-strategy.test.mjs — the ELIZA/PARRY-style combine-and-merge rework
// (§3.5/3.6 of ask-vocab.mjs, ask.mjs's parseAnchored + parseKeywordSpot + merge):
// normalization, negation frames, keyword-spotting's tolerance for casual/
// dialectal phrasing, and the merge step's agree/disagree/single-hit/no-hit
// outcomes. The anchored-template strategy is unmodified and already covered by
// ask.test.mjs — these tests exercise the NEW second strategy and the merge on
// top of it, using the operator's own worked phrasings where given.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuery, normalizeQuery, applyNegationFrames } from "../src/ask.mjs";

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

test("merge: \"what did commit abc1234 touch\" — anchored captures \"commit abc1234\", keyword-spot strips the noun; still one agreed parse", () => {
  const p = parseQuery("what did commit abc1234 touch");
  assert.equal(p.ambiguousParse, undefined);
  assert.equal(p.shape, "forward");
  assert.equal(p.kind, "touches");
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
  // in the passive form there is no other entity noun, so the spotter consumes
  // "commit" as the entity keyword and the object is the bare sha — traverse()
  // treats an entityType of "Commit" on a commit-subject question as a wildcard
  // (no Commit->Commit edges exist), so this still answers.
  const passive = parseQuery("what was touched by commit ef74e44e25c8");
  assert.equal(passive.kind, "touches");
  assert.equal(passive.shape, "reverse");
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
  assert.deepEqual(p, { shape: "reverse", entityType: "Module", modifier: "direct", kind: "imports", object: "walk.mjs" });
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
