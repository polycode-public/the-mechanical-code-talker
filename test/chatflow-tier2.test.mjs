// chatflow-tier2.test.mjs — SKILL_CHAT_PLAYTEST regression transcripts, Tier 2
// (cross-concept & relation touches: "what about imports", "what calls are
// there", mixing nouns and relations — the RELATION concept force). Freezes
// the flowing turns found in the 0.9.14 playtest cycle so a re-introduced
// dead-end is caught for free. Played against a synthetic fixture graph
// (test/fixtures/entities.fixture.json) copied into a fresh tmpdir per test —
// never the shipped examples/mini-webapp graph, which is a committed artifact
// that would otherwise pick up stray session/provenance writes on every test
// run (the lesson from the Tier-1 cycle's own report).
//
// The fixes under test (all routing/wording + one new curated relation entry,
// no new query capability — every underlying query already worked directly):
//   T1  relationTermOf's own extra shapes ("what X are there", "what are the
//       X") had NO typo tolerance at all — "waht calls are there" fell
//       straight through to the grammar wall (relationTermOf reads the RAW
//       query, with no ask()-grammar envelope to inherit normalization from).
//       Fixed via interpret/normalize.mjs's new exported correctMisspellings()
//       (just the curated typo table, not the full normalizeQuery pipeline,
//       which would corrupt "tell me about X" into "about X").
//   T2  texting-shorthand "r" for "are"/"is" ("what r the calls", "what
//       calls r there") — narrowly scoped to relationTermOf's own closed
//       anchor shapes, same judgment call as chat.mjs's existing
//       SHORTHAND_CONTRACTIONS for the identity lane.
//   T3  vagueTouchTermOf ("tell me about X" / "what about X") had the same
//       typo gap ("waht about calls") plus its own dropped-letter typo ("tel
//       me about calls" missed the "^tell me about …" regex outright).
//   T4  vagueTouchTermOf now peels the SAME closed greeting/thanks/modal-
//       wrapper preambles ask()'s own grammar already peels (applyPreambleFrames,
//       not the full pipeline): "cheers, what about imports then" and "could
//       you kindly tell me about the calls" used to fall through to a bogus
//       object search ("no module matching 'kindly about' found").
//   T5  "g'day" (AU/NZ dialect, §3b) joins GREETING_PREAMBLE_RE's lead-in
//       alternation — "g'day, what does Base contain" used to parse "g'day
//       Base" as an ambiguous module search instead of stripping the greeting.
//   T6  a NEW curated relation, "reexports" (corpus/seon/relations.jsonl +
//       concept.mjs's RELATION_TERM/RELATION_KINDS/RELATION_RENDER/
//       RELATION_FOLLOWUP_SHAPES): "what about exports"/"tell me about
//       reexports" used to dead-end even though the direct query ("what does
//       X export") already worked — the vague-touch relation force simply had
//       no entry for the word at all.
//
// SECOND PASS (still 0.9.14, repeated Tier 2 per SKILL_CHAT_PLAYTEST §1 Step 6
// — the first pass found real gaps, so this pass reused the SAME tier at
// DIFFERENT entry points: different relation types (tests/contains/cochange,
// not just calls/imports), and the §3b formal-register/ESL angle instead of
// the first pass's typo/dialect/texting-shorthand angle):
//   T7  ask.mjs's AGG_TAIL_FILLER (the bare "which X exist"/"what X are
//       there" list trigger's own filler-tail allowance) had "codebase" but
//       not the demonstrative right before it — "which classes exist IN THIS
//       codebase"/"which methods exist in this codebase" fell to the grammar
//       wall because "this" isn't a STOPWORDS entry either. Fixed by adding
//       "this"/"that" to AGG_TAIL_FILLER.
//   T8  GREETING_PREAMBLE_RE's lead-in alternation had every INFORMAL greeting
//       (hi/hey/yo/howdy/g'day) but no FORMAL-register one at all — "Good day,
//       what is a method" hit the grammar wall outright, and "Good morning,
//       what about tests" fell through to a bogus "no module matching 'Good
//       morning' found" object search — chat.mjs's own bare-turn GREETINGS
//       closed set already answers these phrases standalone, but this lead-in
//       regex (greeting FUSED onto a real question) never carried them.
//   T9  vagueTouchTermOf's capture ate a trailing meta-noun naming WHAT KIND
//       of thing the touched word already is — "tell me about the cochange
//       relation"/"what about the inherits relationship" captured the WHOLE
//       tail ("cochange relation") as the term, which RELATION_TERM's closed
//       dict (single words only) could never match, so the query fell through
//       to the grammar wall instead of the relation force.
//   T10 a bare "explain X" had NO recognized shape at all (normalize.mjs's
//       own EXPLAIN_WRAPPER_RE only unwraps a WH-QUESTION remainder, not a
//       bare noun) — "explain cochange"/"explain tests to me" hit the grammar
//       wall, and the politeness-wrapped "please explain cochange"/"kindly
//       explain cochange" (never forming ANY ask()-grammar parse attempt, so
//       envelope.parsed is unconditionally null for this shape) tripped
//       isConversational()'s ≤3-word heuristic and fell to the generic
//       orientation card before the relation force ever got a turn. Fixed by
//       a new EXPLAIN_TOUCH_RE (feeding vagueTouchTermOf) plus a matching
//       exemption from the conversational catch-all, the same pattern already
//       used for "what about X" continuations and pronoun describes.
//   T11 ESL word-order ("please you tell me what is Class", "you tell me what
//       is Class") left a bare leading "you" that "could/can/would/will you"
//       (MODAL_WRAPPER_RE) doesn't cover, since those require the verb-first
//       order — the leftover pronoun broke the bare "what is Class" no-
//       article COUNT reading specifically (it requires the whole normalized
//       string to match, unlike the "what is a Class" meta form, which
//       matches more tolerantly). Fixed by adding "you" to ask-vocab.mjs's
//       FILLER_WORDS (it carries no grammatical weight in this grammar).
//   T12 (found by a background strategy-advisor tick, not this pass's own
//       chat transcripts, but squarely a Tier-2 relation-touch dead-end):
//       composeRelation returned null for a KNOWN relation with ZERO edges of
//       that kind, letting the caller's raw grammar attempt at "what about
//       exports"/"tell me about reexports" fall through to a garbled "no
//       module matching 'about'/'exports' found" on a graph with no
//       reexports edges at all (examples/mini-webapp, and the realistic case
//       for most repos) — cycle 3's own T6 test only ever exercised the
//       has-edges path. Fixed in src/concept.mjs: composeRelation now
//       degrades to a two-band answer (definition + "this codebase has no X
//       edges in the index") instead of null.
//
// THIRD PASS (0.9.14, repeated Tier 2 per SKILL_CHAT_PLAYTEST §1 Step 6 —
// entry points NOT yet covered by passes 1-2: numeric/quantifier relation
// touches, "which ones" anaphora, negation, rapid topic-switching, and the
// two relation kinds — defines/touches — a background advisor tick flagged
// as having zero dedicated coverage across T1-T12):
//   T13 chat.mjs's answerCount (the mechanical header-count shortcut, checked
//       BEFORE the ask engine on every turn) matched ONLY the noun immediately
//       after "how many"/"count"/"number of" and silently discarded any
//       RESTRICTOR tail — "how many modules import app/lib/a.mjs" answered
//       "8 modules." (the whole-graph module total) instead of the 3 that
//       actually import it; "how many classes inherit from Base" likewise
//       answered the total class count instead of 1. ask.mjs's own AGGREGATE
//       node already evaluates a restrictor tail correctly, so answerCount now
//       declines (→ null, falls through to the real ask engine) whenever the
//       tail names a genuine relation verb — RESTRICTOR_VERB_RE, built from
//       ask-vocab.mjs's own VERB_TO_KIND + PASSIVE_PARTICIPLE_TO_KIND closed
//       vocabulary, so "how many modules ARE NOT TESTED" (a passive-participle
//       restrictor) is caught too. Deliberately NOT widened to "any non-filler
//       tail word" — that misfires on the tail's own OBJECT NAME ("...does
//       WIDGET have") and on discourse filler ("...are there THEN"), regressing
//       an existing frozen case (chatbench-levers.test.mjs's "so, uh, how many
//       classes are there then"). "have"/"has"/"holds"/"hold" are deliberately
//       EXCLUDED from the restrictor-verb set: VERB_TO_KIND maps them to
//       "defines" unconditionally, but ask.mjs's own engine resolves "what X
//       does Y have" and "which X does Y have" to DIFFERENT, inconsistent kinds
//       for the identical query (a genuine pre-existing ambiguity in the core
//       clause grammar, out of THIS cycle's routing-only scope) — deferring a
//       "have" tail would trade one wrong-answer risk for another, so it stays
//       on the unchanged bare-count path.
//   T14 "which ones"/"which one" — the natural question-form follow-up asking
//       to re-list the previous answer's set ("which modules import
//       app/lib/a.mjs" → "3 modules." → "which ones") had NO recognized shape
//       at all: ask.mjs's parseAnaphora only fires on an ANAPHORA_TRIGGERS
//       pronoun (them/those/these) via "of <pronoun>" or as a bare pronoun
//       right after a LIST/AGGREGATE trigger ("list them") — "ones" is neither,
//       so the turn fell to the generic orientation card instead of carrying
//       focus. Fixed by a narrowly-scoped, whole-query-only "which
//       ones"/"which one" branch reusing the SAME anaphora node a "list them"
//       follow-up already gets — so it inherits that node's existing behavior
//       for BOTH shapes of a previous answer: a prior LIST-shape turn re-lists
//       correctly, and a prior COUNT-shape turn (which never carries a match
//       set — count nodes deliberately return `matches: []`) gets the SAME
//       honest, guiding "needs a previous answer to refer to" nudge a bare
//       "which of those" already gets with no prior list — never a wall.
//   T15/T16 defines/touches relation-force coverage (advisor-flagged: zero
//       dedicated T1-T12 coverage for either kind, on both the populated and
//       the zero-edge path) — found ALREADY FLOWING, no fix needed:
//       composeRelation's T12 zero-edge degrade (this same file, above) is
//       generic over every RELATION_KINDS entry, not reexports-specific, so
//       "what about defines"/"tell me about the defines relation" and "what
//       about touches"/"tell me about the touches relation" already compose
//       correctly on a populated graph, and already degrade to the honest
//       "this codebase has no X edges in the index" two-band answer on a graph
//       with none. Frozen here per §4 ("freeze what flows") to close the
//       coverage gap the advisor found, even though no dead-end turned up.
//
// FOURTH PASS (0.9.15, repeated Tier 2 per SKILL_CHAT_PLAYTEST §1 Step 6 —
// entry points NOT yet covered by passes 1-3: rapid-fire STACCATO short
// follow-ups inside a relation-touch chain ("and Y?", "also Z" — no "about"
// at all, unlike every earlier pass's fixes), relation touches interleaved
// with the Tier-0 identity/AI-identity closed sets in the SAME conversation,
// and the "contains" relation kind exercised by name via the vague-touch
// force for the first time (T1-T16 only ever hit it through a direct
// per-object query)):
//   T17 a bare connective + a KNOWN relation word ("and calls?", "also
//       tests", "so inherits") had no recognized shape at all — unlike "what
//       about X"/"tell me about X" (T1-T12), this staccato shorthand has no
//       anchor verb whatsoever. Without a fix it fell straight through to
//       ask()'s own raw grammar, which parsed the leading connective ITSELF
//       as the object term ("and calls" read as kind=calls object="and",
//       silently resolving "and" via the standing focus/contextId fallback
//       into an unrelated, honestly-empty-but-wrong answer) or matched no
//       shape at all and hit the grammar wall outright. Fixed by a new
//       branch in relationTermOf (chat.mjs): `/^(?:and|also|so|then|now)\s+
//       ([a-z][a-z-]*)$/` — scoped safe by RELATION_TERM's own closed dict
//       downstream, so an unrelated word or real entity name ("and Widget?")
//       still falls through unchanged (see T19).
//   T18 the SAME staccato shorthand for a bare demonstrative pronoun
//       continuation ("and that?", "also this") — the sibling of the
//       already-working "what about it" (describeWrapperAnswer's pronoun
//       resolution) but with no "about" at all. Used to fall to the generic
//       orientation card (isConversational's ≤3-word catch-all caught it,
//       and DESCRIBE_WRAPPER_RE requires an actual anchor word this shape
//       never has). Fixed by a new STACCATO_PRONOUN_RE
//       (`/^(?:and|also|so|then|now)\s+(it|that|this|those|them)\s*\??$/`)
//       tried alongside DESCRIBE_WRAPPER_RE in describeWrapperAnswer, plus
//       the matching isConversational-catch-all exemption.
//   T19 the SAME staccato shorthand swapping in a real CODE-ISH subject
//       ("and Widget?", "and app/lib/f.mjs?") — the bare-connective sibling
//       of discourseRewrite's own "what about X" (CHATBENCH_006 lever 2).
//       Fixed by a new STACCATO_SWAP_RE tried in discourseRewrite alongside
//       WHAT_ABOUT_RE, gated (unlike WHAT_ABOUT_RE's explicit question
//       framing) on the swapped-in word ITSELF being unambiguously code-ish
//       (NAME_TOKEN_RE — a path, a Capitalized symbol, or lowerCamelCase) so
//       ordinary staccato discourse ("and then?", "so what", "and also")
//       never misfires into a bogus subject swap.
//   Also spot-checked, found ALREADY FLOWING, no fix needed: relation touches
//   interleaved with Tier-0 identity/AI-identity mid-conversation ("who are
//   you" -> "what about imports" -> "are you an AI" -> a direct graph query
//   -> "are you chatgpt" -> another relation touch — every turn answers its
//   own lane cleanly, no cross-contamination), and the "contains" relation
//   kind's OWN vague-touch force + every remaining RELATION_TERM synonym not
//   yet exercised by name (members, containment, subclasses, coverage,
//   declaration, coupled) — all already correctly resolve via the existing
//   T1-T12 machinery.
//
// FIFTH PASS (0.9.15, repeated Tier 2 per SKILL_CHAT_PLAYTEST §1 Step 6 — the
// 4th pass's own recommendation: hammer the staccato/ellipsis surface FURTHER
// — staccato negation, staccato count follow-ups, and multi-hop staccato
// chains 3+ turns deep, none of which T1-T19 exercised):
//   T20 staccato NEGATION, bare-pronoun flavor ("not that one", "not those",
//       "not it") — names no alternative at all, so what the user DOES want
//       is knowable only to them, not the graph. Used to fall to the generic
//       orientation card (isConversational's ≤3-word catch-all). Fixed by a
//       new STACCATO_NEGATION_RE branch in nudgeAnswer (chat.mjs) — an honest,
//       FOCUS-tailored nudge ("not sure what you'd like instead of X — name
//       it directly, e.g. …"), plus the matching isConversational exemption
//       (isStaccatoNegation) every other staccato shape already has.
//   T21 staccato NEGATION, named-entity flavor ("not app/lib/b.mjs", "not
//       Widget then") — names a real candidate to EXCLUDE from a just-given
//       list, but that's a capability the engine genuinely doesn't have (even
//       the fully-spelled "which of those is not X" doesn't compile —
//       verified live, parsePredicateFilter has no negation branch). A
//       codeish term used to hit the raw grammar wall outright (isConversational
//       already declines on a slash/Capitalized token, so this needed no
//       catch-all exemption, only the nudgeAnswer branch itself, same as T20).
//       Never fabricated as a real filtered answer — an honest capability-gap
//       nudge, same discipline as nudgeAnswer's existing opinion/risk/write-
//       code nudges.
//   T22 multi-hop STACCATO SWAP chains 3+ turns deep ("what calls X" -> "and
//       Widget?" -> "and Button?" -> "and app/lib/f.mjs?") broke on the THIRD
//       swap: discourseRewrite (chat.mjs) rewrites off `last.query`, which
//       runTurn's own `nextLast` built from the raw verbatim USER TEXT ("and
//       Widget?"), not the reconstructed positive query ("what calls
//       Widget") the 2nd swap actually asked — so the 3rd swap tried to
//       substitute "Button" into "and Widget?" itself (which has no clause
//       shape at all), corrupting the turn into a nonsense re-ask and hitting
//       the grammar wall. Fixed by threading runAsk's own reconstructed
//       `askQuery` forward as `last.query` (a new `effectiveQuery` field,
//       gated on the rewrite actually firing AND the rewritten query
//       structurally PARSING — `envelope.parsed`, not `!recordMiss`: this
//       engine's own "miss" flag covers a structurally-valid honest EMPTY too,
//       which must still count as a valid chain continuation, only a genuine
//       grammar failure must not).
//   T23 the STACCATO PRONOUN shape (T18) had no tolerance for a trailing
//       "one"/"ones" — "also that one?", "and those ones" (at least as
//       natural as the bare "also that?" T18 already covers) fell to the
//       generic orientation card because STACCATO_PRONOUN_RE required the
//       pronoun to be the LAST token. Fixed by widening the regex with an
//       optional non-capturing `(?:\s+ones?)?` tail — the capture group
//       (just the pronoun) is unchanged, so DESCRIBE_PRONOUN_RE's downstream
//       test is unaffected.
//   T24 IMPLICIT anaphoric counts with NO explicit "of them/those" at all —
//       "and how many are tested" (a fluent staccato elision of "how many OF
//       THOSE are tested") — answerCount's own bare noun-scan greedily (and
//       wrongly) captured the linking verb ITSELF as the counted noun ("how
//       many ARE tested" -> noun="are"), answering the nonsensical "I can't
//       count 'are'." (or, with no prior list at all, falling through further
//       to a bogus "no module matching 'and many' found" object search).
//       Fixed by a new IMPLICIT_ANAPHORA_COUNT_RE: answerCount declines this
//       shape unconditionally (→ falls through to the ask engine), and runAsk
//       rewrites the elided "of those" back in before calling ask() — so the
//       anaphora node's EXISTING "how many of those are tested" handling
//       (T13/T14) answers it correctly whether or not a prior list stands
//       (with none, the SAME honest "needs a previous answer" nudge T14
//       already gets for "which ones" after a bare count, never a wall).
//       Same pass, a sibling fix: a trailing discourse tag on an otherwise-
//       bare anaphora follow-up ("how many of those THEN") used to be read as
//       an uncompilable FILTER clause (a PARSE-time miss with the wrong,
//       generic wording) instead of dropped as filler — reaching the SAME
//       honest "needs a previous answer" nudge as the bare "how many of
//       those" when there's truly no prior set. Fixed by adding "then"/
//       "though" to ask.mjs's PRED_LEAD_SKIP (the same discourse-tag
//       tolerance WHAT_ABOUT_RE already carries for "what about X then").
//
// SEVENTH PASS (cycle 9, targeted substring-match sweep per cycle 8's own
// recommendation — every OTHER short closed-vocabulary word in a staccato/
// leftover-object position, not just the five already patched):
//   T35 root-cause fix, not a call-site patch: resolveObject's own tier-3
//       containment check (src/ask.mjs) had NO minimum-length floor, so ANY
//       short closed-vocabulary word left over as parsed.object (not just the
//       five STACCATO_LEAKED_CONNECTIVES words already guarded in chat.mjs)
//       was a near-certain accidental substring of some real label. "or
//       calls?" (an un-guarded connective — "or" was never in the closed
//       five-word set) proves the class: before the fix it silently rebound
//       FOCUS to a bogus substring match exactly like "and calls?" did;
//       after, resolveObject itself declines below a 4-char floor (matching
//       tier 5's own established floor), so every future short word is
//       closed at the source, not one call site at a time.
//   T36 a sibling fix one tier further down: the closed-set "is there a/an
//       <kind> in <module>" existence recognizer (d1491e6) resolves its scope
//       clause via the SAME resolveObject — a nonexistent module
//       ("app/lib/nope.mjs") used to ambiguously "match" a real module purely
//       by sharing generic directory/extension components ("app"/"mjs") with
//       every module in the pool. Fixed by requiring a slashed term's
//       filename STEM (not just any component) to be present, while still
//       tolerating a leaked verb/noise word elsewhere in the term.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearCache } from "../src/source.mjs";
import { driveSessionTurns, stripGoalLine } from "./helpers/session.mjs";

const WALL = /couldn't parse this as a graph question/;
const BAD_SEARCH = /no module matching/;
const FIXTURE = new URL("./fixtures/entities.fixture.json", import.meta.url).pathname;

// FEATURE B (0.9.x): every runAsk-composed answer carries an ALWAYS-ON trailing
// "\n\nGoal (inferred): …" line — this suite is about ROUTING/wall-avoidance,
// not that feature, so it's stripped right where turns are collected
// (driveSession/driveSessionOverGraph, below) rather than teaching every one of
// this file's exact-text assertions a new goal-line-shaped tail. `last.answer`
// (the why/say-more re-render source) is already goal-line-free by design
// (chat.mjs's withGoalLine docblock), so only `.answer`/`.logLines` need it here.

async function repoWithFixture() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-tier2-"));
  const payload = JSON.parse(await readFile(FIXTURE, "utf8"));
  await mkdir(join(dir, ".tmct"), { recursive: true });
  await writeFile(join(dir, ".tmct", "graph.json"), JSON.stringify(payload));
  return dir;
}

async function driveSession(queries) {
  const dir = await repoWithFixture();
  const turns = await driveSessionTurns({ repoPath: dir }, queries, { strip: stripGoalLine });
  return { dir, turns };
}

/** Same as repoWithFixture, but with a named top-level objectProperties GROUP
 *  stripped out entirely — for exercising a relation's ZERO-edge path (the
 *  fixture's own reexports group has a real edge, which is exactly what let
 *  the 0.9.14 second-pass zero-edge degrade bug slip past cycle 3's own tests:
 *  they only ever exercised the has-edges path). */
async function repoWithFixtureMinus(predicate) {
  // Accepts a single predicate string OR an array — "touches" (RELATION_KINDS)
  // spans TWO fixture predicates (coarse "touches" + symbol-grain
  // "touchesSymbol"), so a true zero-edge test for that relation kind must
  // strip both at once (T16), while every earlier single-predicate caller
  // (T12's "reexports", T15's "defines") is unaffected.
  const excluded = new Set(Array.isArray(predicate) ? predicate : [predicate]);
  const dir = await mkdtemp(join(tmpdir(), "tmct-tier2-"));
  const payload = JSON.parse(await readFile(FIXTURE, "utf8"));
  payload.objectProperties = (payload.objectProperties || []).filter((g) => !excluded.has(g.predicate));
  await mkdir(join(dir, ".tmct"), { recursive: true });
  await writeFile(join(dir, ".tmct", "graph.json"), JSON.stringify(payload));
  return dir;
}

const driveSessionOverGraph = (dir, queries) => driveSessionTurns({ repoPath: dir }, queries, { strip: stripGoalLine });

const CALLS_RELATION_TEXT =
  "A call is one function invoking another.\n"
  + "In this codebase, for example: scripts/g.mjs calls app/lib/a.mjs and Widget.render calls fnAlpha (2 call edges).\n"
  + "Want to go deeper? Try:\n"
  + "  • what calls app/lib/a.mjs\n"
  + "  • what does scripts/g.mjs call";

test("tier2/relation-anchor typos: 'waht calls are there' and 'what r the calls' both reach the calls relation force", async () => {
  const { dir, turns } = await driveSession([
    "waht calls are there",
    "what r the calls",
    "what calls r there",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
      assert.doesNotMatch(t.answer, BAD_SEARCH, `turn ${i} must not fall through to a bogus object search`);
      assert.equal(t.answer, CALLS_RELATION_TEXT, `turn ${i} composes the calls relation force`);
    }
    // sanity: a real one-letter identifier is never at risk — "r" only reads as
    // "are"/"is" immediately after "what" inside these curated anchor shapes.
    const { turns: t2 } = await driveSession(["what does app/lib/a.mjs import"]);
    assert.doesNotMatch(t2[0].answer, WALL);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/vague-touch typos: 'waht about calls' and 'tel me about calls' both reach the calls relation force", async () => {
  const { dir, turns } = await driveSession([
    "waht about calls",
    "tel me about calls",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
      assert.doesNotMatch(t.answer, BAD_SEARCH, `turn ${i} must not fall through to a bogus object search`);
      assert.equal(t.answer, CALLS_RELATION_TEXT, `turn ${i} composes the calls relation force`);
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/politeness+dialect preambles: 'cheers, what about imports then' and 'could you kindly tell me about the calls' both flow", async () => {
  const { dir, turns } = await driveSession([
    "cheers, what about imports then",
    "could you kindly tell me about the calls",
  ]);
  try {
    assert.doesNotMatch(turns[0].answer, WALL);
    assert.doesNotMatch(turns[0].answer, BAD_SEARCH);
    assert.match(turns[0].answer, /^To import is to bring another module's definitions/, "the greeting/tag preamble is peeled off, reaching the imports relation force");
    assert.doesNotMatch(turns[1].answer, WALL);
    assert.doesNotMatch(turns[1].answer, BAD_SEARCH);
    assert.equal(turns[1].answer, CALLS_RELATION_TEXT, "the modal+adverb wrapper is peeled off, reaching the calls relation force");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/g'day dialect lead-in: a direct graph question still resolves after the AU/NZ greeting is stripped", async () => {
  const { dir, turns } = await driveSession(["g'day, what does Base contain"]);
  try {
    assert.doesNotMatch(turns[0].answer, WALL);
    assert.doesNotMatch(turns[0].answer, /matches more than one module ambiguously/, "the greeting must not be parsed as part of the object term");
    assert.match(turns[0].answer, /^Base has no contains edges in the index\.$/, "an honest, specific miss — Base genuinely has no contains edges in this fixture");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/reexports relation force: 'what about exports'/'tell me about reexports' reach the same three-band answer a direct query already supported", async () => {
  const { dir, turns } = await driveSession([
    "what does app/functions/d/handler.mjs export",
    "what about exports",
    "tell me about reexports",
    "what about reexports",
  ]);
  try {
    assert.equal(turns[0].answer, "fnAlpha.", "the direct query already worked before this cycle");
    const expected =
      "A re-export is a module passing another module's definition through as part of its own public API.\n"
      + "In this codebase, for example: app/functions/d/handler.mjs re-exports fnAlpha (1 re-export edge).\n"
      + "Want to go deeper? Try:\n"
      + "  • what does app/functions/d/handler.mjs export\n"
      + "  • where is fnAlpha defined";
    for (let i = 1; i < turns.length; i += 1) {
      assert.doesNotMatch(turns[i].answer, WALL, `turn ${i} must not hit the grammar wall`);
      assert.doesNotMatch(turns[i].answer, BAD_SEARCH, `turn ${i} must not fall through to a bogus object search`);
      assert.equal(turns[i].answer, expected, `turn ${i} composes the reexports relation force`);
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/cross-concept drill-down: 'what is a class' -> 'what about inherits' -> 'which classes inherit from Widget' -> 'what about calls' flows end to end mixing nouns and relations", async () => {
  const { dir, turns } = await driveSession([
    "what is a class",
    "what about inherits",
    "which classes inherit from Widget",
    "what about calls",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
      assert.doesNotMatch(t.answer, BAD_SEARCH, `turn ${i} must not fall through to a bogus object search`);
    }
    assert.match(turns[0].answer, /^A class is a template/, "the noun concept force answers 'what is a class'");
    assert.match(turns[1].answer, /^Inheritance is one class deriving/, "the relation concept force answers 'what about inherits'");
    assert.equal(turns[2].answer, "in app/lib/c.mjs there is Button.", "a direct graph query still resolves mid-chain");
    assert.equal(turns[3].answer, CALLS_RELATION_TEXT, "'what about calls' composes the calls relation force to close the chain");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- SECOND PASS (T7-T12) ----

const TESTS_RELATION_TEXT =
  "A test is code that exercises another unit and checks its behaviour.\n"
  + "In this codebase, for example: app/unit-tests/b.test.mjs tests app/lib/b.mjs and app/unit-tests/b.test.mjs tests app/functions/d/handler.mjs (2 test edges).\n"
  + "Want to go deeper? Try:\n"
  + "  • what tests app/lib/b.mjs\n"
  + "  • where is app/functions/d/handler.mjs defined";

const COCHANGE_RELATION_TEXT =
  "Change-coupling is two files that tend to be changed together in the same commits.\n"
  + "In this codebase, for example: app/lib/a.mjs changes together with app/lib/b.mjs and app/lib/a.mjs changes together with app/lib/c.mjs (2 change-coupling edges).\n"
  + "Want to go deeper? Try:\n"
  + "  • where is app/lib/b.mjs defined\n"
  + "  • which modules import app/lib/a.mjs";

test("tier2/T7 AGG_TAIL_FILLER demonstrative: 'which classes/functions exist in this codebase' both list, not wall", async () => {
  const { dir, turns } = await driveSession([
    "which classes exist in this codebase",
    "which functions exist in this codebase",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
    }
    assert.equal(turns[0].answer, "Base, Widget and Button.");
    assert.equal(turns[1].answer, "fnAlpha().");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/T8 formal-register greeting lead-in: 'Good day, what is a class' and 'Good morning, what about tests' both flow (comma AND full-stop delimiter)", async () => {
  const { dir, turns } = await driveSession([
    "Good day, what is a class",
    "Good morning, what about tests",
    "Good day. What is a class",
  ]);
  try {
    assert.doesNotMatch(turns[0].answer, WALL);
    assert.match(turns[0].answer, /^A class is a template/, "the greeting is stripped, reaching the class concept force");
    assert.doesNotMatch(turns[1].answer, WALL);
    assert.doesNotMatch(turns[1].answer, BAD_SEARCH, "'Good morning' must not be parsed as part of the object term");
    assert.equal(turns[1].answer, TESTS_RELATION_TEXT);
    assert.doesNotMatch(turns[2].answer, WALL, "a formal lead-in as its OWN full-stopped sentence, not a comma splice, must strip the same way");
    assert.match(turns[2].answer, /^A class is a template/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/T9 trailing relation meta-noun: 'tell me about the tests relation' and 'what about the inherits relationship' both reach the relation force", async () => {
  const { dir, turns } = await driveSession([
    "tell me about the tests relation",
    "what about the inherits relationship",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
      assert.doesNotMatch(t.answer, BAD_SEARCH, `turn ${i} must not fall through to a bogus object search`);
    }
    assert.equal(turns[0].answer, TESTS_RELATION_TEXT);
    assert.match(turns[1].answer, /^Inheritance is one class deriving/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/T10 bare 'explain X' family: 'explain cochange', 'please explain cochange' and 'explain tests to me' all reach the relation force (not the grammar wall, not the generic orientation card)", async () => {
  const { dir, turns } = await driveSession([
    "explain cochange",
    "please explain cochange",
    "explain tests to me",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
      assert.doesNotMatch(t.answer, /I'm tmct — a deterministic/, `turn ${i} must not fall to the generic orientation card`);
    }
    assert.equal(turns[0].answer, COCHANGE_RELATION_TEXT);
    assert.equal(turns[1].answer, COCHANGE_RELATION_TEXT, "the 'please' politeness wrapper is peeled the same way");
    assert.equal(turns[2].answer, TESTS_RELATION_TEXT, "a trailing 'to me' is peeled the same way as a leading one");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

// Seonix Batch 2 Fix 1 (2026-07-09): "what is Class" (bare, no article) now parses
// DIRECTLY via grammar.mjs's meta-whatis template (T5) — "class" is one of the
// ENTITY_TO_TYPE closed-vocabulary terms Fix 1 opened the bare form to — so the
// direct parse no longer misses and the cascade's bare-kind-noun terminal rescue
// (the "read as \"count class\"" repair receipt this test used to pin) is never
// reached at all. The turn still lands a real, non-wall answer — now the meta
// definition of Class itself, which is at least as natural a reading of "what is
// Class" as the count — so this test is updated to the new direct-hit content
// rather than reverted; the T11 regression this test freezes (an ESL leading
// pronoun must not dead-end at the grammar wall) still holds.
test("tier2/T11 ESL leading pronoun: 'please you tell me what is Class' reaches a real answer (now the direct meta-whatis hit, Batch 2 Fix 1)", async () => {
  const { dir, turns } = await driveSession(["please you tell me what is Class"]);
  try {
    assert.doesNotMatch(turns[0].answer, WALL);
    assert.doesNotMatch(turns[0].answer, /I'm tmct — a deterministic/);
    assert.match(turns[0].answer, /^A class is a template that defines/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/T12 relation vague-touch on ZERO edges of a known kind degrades gracefully (advisor-flagged gap in cycle 3's own reexports fix, T6): 'what about exports'/'tell me about reexports' on a graph with NO reexports edges", async () => {
  const dir = await repoWithFixtureMinus("reexports");
  try {
    const turns = await driveSessionOverGraph(dir, [
      "what about exports",
      "tell me about reexports",
      "what does app/functions/d/handler.mjs export",
    ]);
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
      assert.doesNotMatch(t.answer, BAD_SEARCH, `turn ${i} must not fall through to a bogus object search over leftover words like "about"/"exports"`);
    }
    const expected =
      "A re-export is a module passing another module's definition through as part of its own public API.\n"
      + "This codebase has no re-export edges in the index.";
    assert.equal(turns[0].answer, expected);
    assert.equal(turns[1].answer, expected);
    assert.equal(turns[2].answer, "app/functions/d/handler.mjs has no export edges in the index.",
      "the per-object direct query keeps its own, already-honest empty phrasing");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- THIRD PASS (T13-T16) ----

test("tier2/T13 quantifier+relation counts: 'how many modules import X', 'how many classes inherit from Y' and 'how many modules are not tested' all count the RESTRICTED set, not the whole-graph total", async () => {
  const { dir, turns } = await driveSession([
    "how many modules import app/lib/a.mjs",
    "how many classes inherit from Base",
    "how many modules are not tested",
    // "have" stays on the bare-count path deliberately (T13's own doc note) —
    // this happens to read as a correct count in this fixture (Widget's one
    // real method), not because the restrictor was evaluated.
    "how many methods does Widget have",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
    }
    assert.equal(turns[0].answer, "3 modules.", "restricted to the 3 modules that actually import app/lib/a.mjs, not the graph's 8 total");
    assert.equal(turns[1].answer, "1 class.", "restricted to Widget (which inherits from Base), not the graph's 3 total classes");
    assert.equal(turns[2].answer, "6 modules.", "the passive-participle restrictor ('are not tested') is caught too");
    assert.equal(turns[3].answer, "1 method.");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/T13 regression: a discourse-final filler tail stays a bare count ('so, uh, how many classes are there then')", async () => {
  const { dir, turns } = await driveSession(["so, uh, how many classes are there then"]);
  try {
    assert.doesNotMatch(turns[0].answer, WALL);
    assert.equal(turns[0].answer, "3 classes.", "'then' names no relation verb — stays the bare header count, not a restrictor miss");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/T14 'which ones' anaphora: re-lists a prior LIST-shape answer, and gives an honest guiding nudge (not a wall) after a prior COUNT-shape answer", async () => {
  const { dir, turns } = await driveSession([
    "which modules import app/lib/a.mjs",
    "which ones",
    "how many modules import app/lib/a.mjs",
    "which ones",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
      assert.doesNotMatch(t.answer, /I'm tmct — a deterministic/, `turn ${i} must not fall to the generic orientation card`);
    }
    assert.equal(turns[0].answer, "app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.");
    assert.equal(turns[1].answer, "app/lib/b.mjs, app/lib/c.mjs and app/lib/e.mjs.", "'which ones' re-lists the same set the direct list query names");
    assert.equal(turns[2].answer, "3 modules.");
    assert.equal(
      turns[3].answer,
      "\"those\"/\"them\" needs a previous answer to refer to — ask a listing question first, then follow up.",
      "a prior COUNT never carries a match set (by design) — the honest anaphora-miss nudge, not a wall",
    );
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

const DEFINES_RELATION_TEXT =
  "A definition is where a name (a class, function, or variable) is introduced.\n"
  + "In this codebase, for example: app/lib/a.mjs defines fnAlpha, app/lib/b.mjs defines Widget and app/lib/b.mjs defines register (3 definition edges).\n"
  + "Want to go deeper? Try:\n"
  + "  • where is fnAlpha defined";

test("tier2/T15 defines relation force (advisor-flagged coverage gap, T1-T12 never touched it): 'what about defines'/'tell me about the defines relation' both flow, and degrade gracefully on zero edges", async () => {
  const { dir, turns } = await driveSession([
    "what about defines",
    "tell me about the defines relation",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
      assert.doesNotMatch(t.answer, BAD_SEARCH, `turn ${i} must not fall through to a bogus object search`);
      assert.equal(t.answer, DEFINES_RELATION_TEXT, `turn ${i} composes the defines relation force`);
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
  const zeroDir = await repoWithFixtureMinus("defines");
  try {
    const zeroTurns = await driveSessionOverGraph(zeroDir, [
      "what about defines",
      "what does app/lib/a.mjs define",
    ]);
    const expected =
      "A definition is where a name (a class, function, or variable) is introduced.\n"
      + "This codebase has no definition edges in the index.";
    assert.doesNotMatch(zeroTurns[0].answer, WALL);
    assert.equal(zeroTurns[0].answer, expected);
    assert.equal(zeroTurns[1].answer, "app/lib/a.mjs has no defines edges in the index.",
      "the per-object direct query keeps its own, already-honest empty phrasing");
  } finally {
    clearCache();
    await rm(zeroDir, { recursive: true, force: true });
  }
});

const TOUCHES_RELATION_TEXT =
  "A touch is a commit changing a file or a symbol in the codebase.\n"
  + "In this codebase, for example: abc1234 touches app/lib/a.mjs and abc1234 touches Widget.render (2 touch edges).\n"
  + "Want to go deeper? Try:\n"
  + "  • when did app/lib/a.mjs change\n"
  + "  • what did commit abc1234 touch";

test("tier2/T16 touches relation force (advisor-flagged coverage gap, T1-T12 never touched it): 'what about touches'/'tell me about the touches relation' both flow, and degrade gracefully on zero edges", async () => {
  const { dir, turns } = await driveSession([
    "what about touches",
    "tell me about the touches relation",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
      assert.doesNotMatch(t.answer, BAD_SEARCH, `turn ${i} must not fall through to a bogus object search`);
      assert.equal(t.answer, TOUCHES_RELATION_TEXT, `turn ${i} composes the touches relation force`);
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
  const zeroDir = await repoWithFixtureMinus(["touches", "touchesSymbol"]);
  try {
    const zeroTurns = await driveSessionOverGraph(zeroDir, [
      "what about touches",
      "what did commit abc1234 touch",
    ]);
    const expected =
      "A touch is a commit changing a file or a symbol in the codebase.\n"
      + "This codebase has no touch edges in the index.";
    assert.doesNotMatch(zeroTurns[0].answer, WALL);
    assert.equal(zeroTurns[0].answer, expected);
    assert.equal(zeroTurns[1].answer, "commit abc1234 touched nothing recorded in the index.",
      "the per-object direct query keeps its own, already-honest empty phrasing");
  } finally {
    clearCache();
    await rm(zeroDir, { recursive: true, force: true });
  }
});

// ---- FOURTH PASS (T17-T19) ----

const IMPORTS_RELATION_TEXT =
  "To import is to bring another module's definitions into the current one.\n"
  + "In this codebase, for example: app/lib/b.mjs imports app/lib/a.mjs, app/lib/c.mjs imports app/lib/a.mjs and app/functions/d/handler.mjs imports app/lib/b.mjs (7 import edges). …and 4 more — say 'more' to see them.\n"
  + "Want to go deeper? Try:\n"
  + "  • which modules import app/lib/a.mjs\n"
  + "  • what does app/lib/b.mjs import";

const CONTAINS_RELATION_TEXT =
  "Containment is a class or module holding a member (a method, attribute, or nested definition).\n"
  + "In this codebase, for example: Widget contains render and Widget contains name (2 containment edges).\n"
  + "Want to go deeper? Try:\n"
  + "  • what does Widget contain\n"
  + "  • which class contains render";

const INHERITS_RELATION_TEXT =
  "Inheritance is one class deriving its structure and behaviour from another.\n"
  + "In this codebase, for example: Widget inherits from Base and Button inherits from Widget (2 inheritance edges).\n"
  + "Want to go deeper? Try:\n"
  + "  • which classes inherit from Base\n"
  + "  • where is Widget defined";

test("tier2/T17 staccato relation-chain continuation: 'and calls?'/'also tests'/'and inherits?' (no \"about\" at all) all reach the relation force mid-chain", async () => {
  const { dir, turns } = await driveSession([
    "what about imports",
    "and calls?",
    "also tests",
    "what about contains",
    "and inherits?",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
      assert.doesNotMatch(t.answer, BAD_SEARCH, `turn ${i} must not fall through to a bogus object search over the leftover connective word`);
    }
    assert.equal(turns[0].answer, IMPORTS_RELATION_TEXT);
    assert.equal(turns[1].answer, CALLS_RELATION_TEXT, "'and calls?' composes the calls relation force, not a focus-object miss over the word \"and\"");
    assert.equal(turns[2].answer, TESTS_RELATION_TEXT, "'also tests' composes the tests relation force, not a bogus \"no module matching 'also' found\"");
    assert.equal(turns[3].answer, CONTAINS_RELATION_TEXT);
    assert.equal(turns[4].answer, INHERITS_RELATION_TEXT, "'and inherits?' composes the inherits relation force, not the grammar wall");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/T18 staccato pronoun continuation: 'and that?'/'also this'/'and it' (no \"about\"/\"describe\" at all) all resolve against the standing focus", async () => {
  const { dir, turns } = await driveSession([
    "what calls app/lib/a.mjs",
    "and that?",
    "also this",
    "who tests app/lib/b.mjs",
    "and it",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
      assert.doesNotMatch(t.answer, /I'm tmct — a deterministic/, `turn ${i} must not fall to the generic orientation card`);
    }
    assert.equal(turns[0].answer, "scripts/g.mjs.");
    assert.match(turns[1].answer, /^app\/lib\/a\.mjs — Module \(id: mod-a\)/, "'and that?' describes the standing focus (app/lib/a.mjs)");
    assert.equal(turns[2].answer, turns[1].answer, "'also this' resolves the same way as 'and that?'");
    assert.equal(turns[3].answer, "app/unit-tests/b.test.mjs.");
    assert.match(turns[4].answer, /^app\/lib\/b\.mjs — Module \(id: mod-b\)/, "'and it' describes the NEW standing focus after the drill-down (app/lib/b.mjs)");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/T19 staccato swap continuation: 'and Widget?'/'and app/lib/f.mjs?' (no \"about\" at all) re-ask the prior query shape with the new subject swapped in, while non-code-ish staccato ('so then', 'and also') never misfires into a bogus swap", async () => {
  const { dir, turns } = await driveSession([
    "what calls app/lib/a.mjs",
    "and Widget?",
    "so then",
    "and also",
    "which modules import app/lib/a.mjs",
    "and app/lib/f.mjs?",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
    }
    assert.equal(turns[0].answer, "scripts/g.mjs.");
    assert.equal(turns[1].answer, "No modules found whose module directly calls Widget. Try \"who touched <a module that actually has commits>\" or \"/describe <module>\" to see what's in the index.", "'and Widget?' re-asks 'what calls Widget' — an honest, specific empty, not a misparse");
    assert.match(turns[2].answer, /I'm tmct — a deterministic/, "'so then' has no code-ish swap-in candidate — falls through to the ordinary (guiding) orientation path, not a bogus subject swap");
    assert.doesNotMatch(turns[3].answer, WALL);
    assert.equal(turns[4].answer, "app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.");
    assert.equal(turns[5].answer, "app/lib/e.mjs.", "'and app/lib/f.mjs?' re-asks 'which modules import app/lib/f.mjs' with the swapped-in path");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- FIFTH PASS (T20-T24) ----

test("tier2/T20 staccato negation, bare-pronoun flavor: 'not that one'/'not those'/'not it' get a focus-tailored guiding nudge, never the generic orientation card", async () => {
  const { dir, turns } = await driveSession([
    "what calls app/lib/a.mjs",
    "not that one",
    "not those",
    "not it",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
      assert.doesNotMatch(t.answer, /I'm tmct — a deterministic/, `turn ${i} must not fall to the generic orientation card`);
    }
    assert.equal(turns[0].answer, "scripts/g.mjs.");
    const expected = `not sure what you'd like instead of app/lib/a.mjs — name it directly, e.g. "what calls app/lib/a.mjs".`;
    assert.equal(turns[1].answer, expected, "'not that one' — the trailing 'one' is tolerated the same way T23's STACCATO_PRONOUN_RE tolerates it");
    assert.equal(turns[2].answer, expected, "'not those' resolves the same way");
    assert.equal(turns[3].answer, expected, "'not it' resolves the same way");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/T20 staccato negation, bare-pronoun flavor with NO standing focus at all: an honest generic nudge, never a crash or a wall", async () => {
  const { dir, turns } = await driveSession(["not that one"]);
  try {
    assert.doesNotMatch(turns[0].answer, WALL);
    assert.equal(turns[0].answer, `not sure what you'd like instead of that — name it directly, e.g. "what calls Widget".`);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/T21 staccato negation, named-entity flavor: 'not app/lib/b.mjs' and 'not Widget then' both get an honest capability-gap nudge instead of the raw grammar wall", async () => {
  const { dir, turns } = await driveSession([
    "which modules import app/lib/a.mjs",
    "not app/lib/b.mjs",
    "not Widget then",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
    }
    assert.equal(turns[0].answer, "app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.");
    assert.equal(
      turns[1].answer,
      `I can't filter a previous list by exclusion yet — ask the positive shape directly (e.g. "which modules import <name>"), or ask about app/lib/b.mjs on its own.`,
      "'not app/lib/b.mjs' — a real member of the just-given list — names the gap honestly instead of the generic grammar wall",
    );
    assert.equal(
      turns[2].answer,
      `I can't filter a previous list by exclusion yet — ask the positive shape directly (e.g. "which modules import <name>"), or ask about Widget on its own.`,
      "'not Widget then' — a real graph entity that ISN'T in the list — gets the same honest nudge, not a fabricated 'excluding Widget' answer",
    );
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/T22 multi-hop staccato SWAP chain, 3+ turns deep: 'what calls X' -> 'and Widget?' -> 'and Button?' -> 'and app/lib/c.mjs?' all correctly continue the SAME clause shape, not a corrupted re-ask of the previous staccato turn's own raw text", async () => {
  const { dir, turns } = await driveSession([
    "what calls app/lib/a.mjs",
    "and Widget?",
    "and Button?",
    "and app/lib/c.mjs?",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
    }
    assert.equal(turns[0].answer, "scripts/g.mjs.");
    assert.equal(turns[1].answer, "No modules found whose module directly calls Widget. Try \"who touched <a module that actually has commits>\" or \"/describe <module>\" to see what's in the index.");
    assert.equal(turns[2].answer, "No modules found whose module directly calls Button. Try \"who touched <a module that actually has commits>\" or \"/describe <module>\" to see what's in the index.",
      "the 3rd staccato swap in a row still continues 'what calls <X>' — before this fix it corrupted into a nonsense re-ask of turn 2's OWN raw staccato text and hit the grammar wall");
    assert.equal(turns[3].answer, "No modules found whose module directly calls app/lib/c.mjs. Try \"who touched <a module that actually has commits>\" or \"/describe <module>\" to see what's in the index.",
      "a 4th staccato swap still continues correctly");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/T23 staccato pronoun continuation tolerates a trailing 'one'/'ones': 'also that one?' after TWO vague relation touches (no entity ever named) gets an honest no-focus nudge, not the generic orientation card", async () => {
  // Cycle 8 correction: this used to assert "also that one?" described
  // app/functions/d/handler.mjs as its "new standing focus" — but neither
  // "what about imports" nor "and calls?" ever names or resolves a real
  // entity (both are vague RELATION touches, not entity touches), so there
  // was never a legitimate focus to describe. That module was only ever
  // reached because ask()'s raw grammar parsed "and calls?" as kind=calls
  // object="and" (the leaked leading connective, once "calls" matched as a
  // bare verb) and resolveObject's substring tier matched "and" against
  // "h-AND-ler.mjs" — a confidently WRONG focus silently installed behind a
  // correct-looking relation-force answer (see STACCATO_LEAKED_CONNECTIVES in
  // chat.mjs). Now that leaked-connective resolution is excluded, the chain
  // genuinely has no antecedent, and "also that one?" correctly gets an
  // honest nudge (nudgeAnswer's own no-focus STACCATO_PRONOUN_RE branch) —
  // never the wall, and never a fabricated focus either.
  const { dir, turns } = await driveSession([
    "what about imports",
    "and calls?",
    "also that one?",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
      assert.doesNotMatch(t.answer, /I'm tmct — a deterministic/, `turn ${i} must not fall to the generic orientation card`);
    }
    assert.equal(turns[0].answer, IMPORTS_RELATION_TEXT);
    assert.equal(turns[1].answer, CALLS_RELATION_TEXT);
    assert.equal(turns[2].answer, 'not sure what "that" refers to yet — name something directly, e.g. "what calls <name>".',
      "'also that one?' honestly declines — neither prior turn ever named/resolved a real entity to describe");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/T25 staccato pronoun continuation resolves correctly when a relation-chain hop precedes it AND a real focus already stands: 'what does X import' -> 'and calls?' -> 'also that one?' still describes X, unaffected by the leaked-connective fix", async () => {
  const { dir, turns } = await driveSession([
    "what does app/lib/b.mjs import",
    "and calls?",
    "also that one?",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
      assert.doesNotMatch(t.answer, /I'm tmct — a deterministic/, `turn ${i} must not fall to the generic orientation card`);
    }
    assert.equal(turns[1].answer, CALLS_RELATION_TEXT, "'and calls?' still reaches the generic relation force mid-chain");
    assert.match(turns[2].answer, /^app\/lib\/b\.mjs — Module \(id: mod-b\)/,
      "'also that one?' describes the REAL standing focus (app/lib/b.mjs, set by turn 1) — the leaked-connective fix leaves a genuine focus untouched");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/T24 implicit anaphoric count with NO explicit 'of them/those': 'and how many are tested' counts the RESTRICTED prior set, both when a prior list stands and when none does", async () => {
  const { dir, turns } = await driveSession([
    "which modules import app/lib/a.mjs",
    "and how many are tested",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
      assert.doesNotMatch(t.answer, BAD_SEARCH, `turn ${i} must not fall through to a bogus 'and many' object search`);
    }
    assert.equal(turns[0].answer, "app/lib/b.mjs and app/lib/c.mjs and app/lib/e.mjs.");
    assert.equal(turns[1].answer, "1 module.", "restricted to app/lib/b.mjs (the one of the three that's actually tested), not the graph's whole-module total, and not the mis-parsed \"I can't count 'are'\"");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }

  const { dir: dir2, turns: turns2 } = await driveSession([
    "how many modules import app/lib/a.mjs",
    "and how many are tested",
  ]);
  try {
    assert.doesNotMatch(turns2[0].answer, WALL);
    assert.equal(turns2[0].answer, "3 modules.");
    assert.equal(
      turns2[1].answer,
      `"those"/"them" needs a previous answer to refer to — ask a listing question first, then follow up.`,
      "a prior COUNT never carries a match set (by design, T14) — the same honest anaphora-miss nudge 'which ones' already gets, never a wall or a bogus object search",
    );
  } finally {
    clearCache();
    await rm(dir2, { recursive: true, force: true });
  }
});

test("tier2/T24 sibling: a trailing discourse tag on a bare anaphora follow-up ('how many of those THEN') is dropped as filler, not misread as an uncompilable filter clause", async () => {
  const { dir, turns } = await driveSession([
    "how many modules import app/lib/a.mjs",
    "how many of those then",
  ]);
  try {
    assert.doesNotMatch(turns[0].answer, WALL);
    assert.equal(turns[0].answer, "3 modules.");
    assert.equal(
      turns[1].answer,
      `"those"/"them" needs a previous answer to refer to — ask a listing question first, then follow up.`,
      "before this fix, the trailing 'then' made this an uncompilable-filter miss with the wrong, generic wording instead of the honest no-prior-list nudge",
    );
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- cycle 8 (6th Tier-2 pass): staccato comparison/superlative follow-ups
// and deeper multi-hop RELATION-touch chain stress-testing (cycle 7's own
// recommendation). ----

test("tier2/T26 vague-touch/staccato 'cochange' reaches the relation force as a FRESH opener and as a bare mid-chain continuation, same as every sibling relation word", async () => {
  // cochange is the one relation (ask-vocab.mjs RELATIONS.cochange) whose every
  // registered verb phrase takes a preposition ("changed WITH X") — no bare
  // "cochanges X" — so ask()'s own raw grammar never gives this shape a parse,
  // tripping isConversational's <=3-word catch-all before the relation force
  // ever ran. Every sibling relation word (imports/calls/tests/inherits/
  // contains/defines/touches/reexports) already escaped this via its own bare
  // verb form; cochange needed its own isVagueRelationTouch exemption.
  const { dir: dir1, turns: turns1 } = await driveSession(["what about cochange"]);
  try {
    assert.doesNotMatch(turns1[0].answer, WALL);
    assert.doesNotMatch(turns1[0].answer, /I'm tmct — a deterministic/, "a fresh opener must not fall to the generic orientation card");
    assert.match(turns1[0].answer, /^Change-coupling is two files/);
  } finally {
    clearCache();
    await rm(dir1, { recursive: true, force: true });
  }

  const { dir: dir2, turns: turns2 } = await driveSession(["and cochange?"]);
  try {
    assert.doesNotMatch(turns2[0].answer, /I'm tmct — a deterministic/, "a bare staccato continuation with no prior turn at all must still reach the relation force");
    assert.match(turns2[0].answer, /^Change-coupling is two files/);
  } finally {
    clearCache();
    await rm(dir2, { recursive: true, force: true });
  }

  const { dir: dir3, turns: turns3 } = await driveSession(["what about imports", "and cochange?"]);
  try {
    for (const [i, t] of turns3.entries()) {
      assert.doesNotMatch(t.answer, /I'm tmct — a deterministic/, `turn ${i} must not fall to the generic orientation card`);
    }
    assert.equal(turns3[0].answer, IMPORTS_RELATION_TEXT);
    assert.match(turns3[1].answer, /^Change-coupling is two files/, "'and cochange?' mid an existing relation-touch chain reaches the cochange relation force, not the wall it used to hit");
  } finally {
    clearCache();
    await rm(dir3, { recursive: true, force: true });
  }
});

test("tier2/T27 'what about <entity noun>' (classes/modules/functions — a NOUN, not a relation) surfaces the bare-kind-noun count via the relaxation cascade, not a bogus 'no X found matching \"about\"' search", async () => {
  const { dir, turns } = await driveSession(["what about classes"]);
  try {
    assert.doesNotMatch(turns[0].answer, /no classes found matching "about"/,
      "'about' used to be misread as the FIND search term itself (parseRelationalOrQualified's unknown-qualifier fallback), not the topic-lead-in filler CASCADE_NOISE already curates it as");
    assert.equal(turns[0].answer, 'read as "count classes" — 3 classes.');
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/T28 a superlative's single unambiguous winner becomes the new focus, so an immediate pronoun follow-up ('what does it import', 'where is it defined') resolves instead of dead-ending on 'it needs a selected node'", async () => {
  const { dir, turns } = await driveSession([
    "which module has the most calls",
    "what does it import",
    "where is it defined",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, /needs a selected node to refer to/, `turn ${i} must not dead-end on a missing focus — the superlative winner (scripts/g.mjs) must already be the focus`);
    }
    assert.equal(turns[0].answer, "scripts/g.mjs — the most calls (1).");
    assert.equal(turns[1].answer, "scripts/g.mjs has no imports edges in the index.", "an honest empty over the RIGHT entity (scripts/g.mjs genuinely has no outgoing imports in the fixture) — not a focus-missing dead-end");
    assert.equal(turns[2].answer, "scripts/g.mjs is a module — the label is its repo path.");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/T29 staccato superlative repeat ('the biggest one'/'which is biggest'/'what about the biggest one') reuses the PRIOR ranking verbatim instead of the 'a superlative needs an entity kind' wall", async () => {
  const SUPERLATIVE_TEXT = "scripts/g.mjs — the most calls (1).";
  for (const followUp of ["the biggest one", "which is biggest", "what about the biggest one", "which one is the biggest"]) {
    const { dir, turns } = await driveSession(["which module has the most calls", followUp]);
    try {
      assert.doesNotMatch(turns[1].answer, /a superlative needs an entity kind/, `"${followUp}" must not hit the missing-entity-kind wall`);
      assert.equal(turns[1].answer, SUPERLATIVE_TEXT, `"${followUp}" repeats the exact prior ranking (same entityType, same metric) — never a guessed DIFFERENT metric like generic "connections"`);
    } finally {
      clearCache();
      await rm(dir, { recursive: true, force: true });
    }
  }
  // An unrelated prior turn must NOT be replayed — the ordinary honest miss stands.
  const { dir: dir2, turns: turns2 } = await driveSession(["what about imports", "the biggest one"]);
  try {
    assert.match(turns2[1].answer, /a superlative needs an entity kind/,
      "'the biggest one' after a NON-superlative last turn declines the repeat-rewrite and falls through to the ordinary honest miss, unchanged");
  } finally {
    clearCache();
    await rm(dir2, { recursive: true, force: true });
  }
});

test("tier2/T30 staccato comparative ('more than that'/'which is bigger') gets an honest capability nudge naming the standing focus, never a wall or the generic orientation card", async () => {
  for (const followUp of ["more than that", "which is bigger", "is there anything bigger", "bigger than that"]) {
    const { dir, turns } = await driveSession(["which module has the most calls", followUp]);
    try {
      assert.doesNotMatch(turns[1].answer, WALL, `"${followUp}" must not hit the grammar wall`);
      assert.doesNotMatch(turns[1].answer, /I'm tmct — a deterministic/, `"${followUp}" must not fall to the generic orientation card`);
      assert.equal(
        turns[1].answer,
        'I only name the single top (or bottom) match for a metric — no runner-up ranking, no comparing against a number. '
          + 'Ask about a specific module/class/function directly to compare it with scripts/g.mjs (e.g. "how many imports does <name> have").',
      );
    } finally {
      clearCache();
      await rm(dir, { recursive: true, force: true });
    }
  }
});

test("tier2/T31 STACCATO CONNECTIVE LEAKAGE: a bare-connective relation-chain continuation ('and calls?') never lets the leftover 'and' silently corrupt the standing FOCUS, even though its own visible answer looks fine", async () => {
  // Regression for the bug T23 (above) used to unknowingly pin: ask()'s raw
  // grammar parses "and calls?" as kind=calls object="and" once "calls"
  // matches as a bare verb, and resolveObject's substring tier has no
  // minimum-length floor — "and" is a near-certain accidental substring of
  // SOME real label. Here it would land on app/functions/d/h-AND-ler.mjs.
  const { dir, turns } = await driveSession([
    "what does app/lib/b.mjs import",
    "and calls?",
    "what calls it",
    "also tests?",
    "what tests it",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
    }
    assert.equal(turns[0].answer, "app/lib/a.mjs.");
    assert.equal(turns[1].answer, CALLS_RELATION_TEXT);
    assert.equal(turns[2].answer, "No modules found whose module directly calls it. Try \"who touched <a module that actually has commits>\" or \"/describe <module>\" to see what's in the index.",
      "an honest empty over the RIGHT entity (app/lib/b.mjs) — nothing in the fixture calls it — not a corrupted focus's own (also empty, but WRONG-reasoned) answer");
    assert.equal(
      turns[3].answer,
      "A test is code that exercises another unit and checks its behaviour.\n"
        + "In this codebase, for example: app/unit-tests/b.test.mjs tests app/lib/b.mjs and app/unit-tests/b.test.mjs tests app/functions/d/handler.mjs (2 test edges).\n"
        + "Want to go deeper? Try:\n"
        + "  • what tests app/lib/b.mjs\n"
        + "  • where is app/functions/d/handler.mjs defined",
    );
    assert.equal(turns[4].answer, "app/unit-tests/b.test.mjs.",
      "the CORRECT answer — app/lib/b.mjs genuinely IS tested by app/unit-tests/b.test.mjs — proving the focus survived 'and calls?' untouched; before the fix this rendered the WRONG 'no tests cover it' because focus had been silently rebound to a substring-matched module");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/T32 discourseRewrite swaps into a PRONOUN-shaped prior query too: 'what calls it' -> 'and Widget?' rewrites to 'what calls Widget' instead of hitting the raw grammar wall", async () => {
  const { dir, turns } = await driveSession([
    "what calls app/lib/a.mjs",
    "what calls it",
    "and Widget?",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall — 'and Widget?' after a pronoun-shaped prior turn ('what calls it', no NAME_TOKEN to swap) used to fall straight through`);
    }
    assert.equal(turns[0].answer, "scripts/g.mjs.");
    assert.equal(turns[1].answer, "scripts/g.mjs.", "'what calls it' re-asks the same query via the standing focus");
    assert.equal(turns[2].answer, "No modules found whose module directly calls Widget. Try \"who touched <a module that actually has commits>\" or \"/describe <module>\" to see what's in the index.",
      "'and Widget?' correctly rewrote to 'what calls Widget' (swapping into the bare PRONOUN 'it', since 'what calls it' has no real name token) — an honest empty over the RIGHT new subject, not a parse failure");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/T33 the reverse-object honest miss names the query's OWN entity type ('no class matching') instead of defaulting to 'module' when the searched term is neither sha- nor dotted-symbol-shaped", async () => {
  const { dir, turns } = await driveSession(["which classes inherit from Nonexistent"]);
  try {
    assert.equal(turns[0].answer, 'no class matching "Nonexistent" found in the index. Try "who touched <a module that actually has commits>" or "/describe <module>" to see what\'s in the index.',
      "entityType=Class was already on the parsed AST — the old hardcoded 'module' catch-all default ignored it");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }

  // The dotted/slash-free "symbol" shape read keeps its existing priority — a
  // bare filename-like term with no basename match at all is still read as
  // symbol-shaped regardless of any stated entity type (frozen by
  // test/chat.test.mjs's own "a.mjs" case, over an EMPTY graph where nothing
  // fuzzy-matches; this fixture's "a.mjs" itself resolves fine via basename
  // fuzzy match to app/lib/a.mjs, so a genuinely absent dotted term is used
  // here instead to isolate the same shape-priority rule).
  const { dir: dir2, turns: turns2 } = await driveSession(["which modules import nonexistent.mjs"]);
  try {
    assert.equal(turns2[0].answer, 'no symbol matching "nonexistent.mjs" found in the index. Try "who touched <a module that actually has commits>" or "/describe <module>" to see what\'s in the index.');
  } finally {
    clearCache();
    await rm(dir2, { recursive: true, force: true });
  }
});

test("tier2/T34 a bare pronoun with NO standing focus never resolves via the raw pronoun string either: consecutive 'where is it defined'/'what does it import' with nothing set both render the SAME honest miss, never a fabricated specific answer", async () => {
  // Found in final replay verification, cycle 8: the pronoun-reuse guard only
  // special-cased the case where a focus DOES stand — with none, it fell
  // through to resolveEntity(graph, "it"), hitting the exact CHATBENCH_0.7.1
  // B1-pron substring-match trap ("it" -> some label CONTAINING "it") as a
  // silent side effect on focus-bookkeeping, even though the turn's own
  // visible answer was already the correct honest miss — corrupting the NEXT
  // turn's "it" into a confidently WRONG (not just empty) specific answer.
  const { dir, turns } = await driveSession(["where is it defined", "what does it import"]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.equal(t.answer, '"it" needs a selected node to refer to — click a node first, or name it directly.',
        `turn ${i}: with no focus ever set, EVERY bare "it" must render the SAME honest miss — never a specific answer fabricated off a substring-matched bogus focus adopted by a PRIOR turn`);
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/T35 an UN-guarded connective ('or', never in the closed STACCATO_LEAKED_CONNECTIVES five-word set) proves the fix belongs in resolveObject itself: 'or calls?' never corrupts the standing FOCUS either", async () => {
  // Cycle 8 fixed "and"/"also"/"so"/"then"/"now" one word at a time at a
  // chat.mjs call site (STACCATO_LEAKED_CONNECTIVES). "or" was never added to
  // that set, so if the fix were still call-site-scoped, this would reproduce
  // T31's exact bug (focus silently rebound to a substring-matched module).
  // resolveObject's own tier-3 minimum-length floor (src/ask.mjs) closes it
  // at the source instead — every short word, guarded or not.
  const { dir, turns } = await driveSession([
    "what does app/lib/b.mjs import",
    "and calls?",
    "or calls?",
    "what tests it",
  ]);
  try {
    for (const [i, t] of turns.entries()) {
      assert.doesNotMatch(t.answer, WALL, `turn ${i} must not hit the grammar wall`);
    }
    assert.equal(turns[0].answer, "app/lib/a.mjs.");
    assert.equal(turns[1].answer, CALLS_RELATION_TEXT);
    assert.equal(turns[2].answer, 'no module matching "or" found in the index. Try "who touched <a module that actually has commits>" or "/describe <module>" to see what\'s in the index.',
      "an honest object-resolution miss — 'or' is a genuine accidental substring of a real label pre-fix, but the length floor keeps it an honest miss instead of a silent focus hijack");
    assert.equal(turns[3].answer, "app/unit-tests/b.test.mjs.",
      "the CORRECT answer — app/lib/b.mjs genuinely IS tested by app/unit-tests/b.test.mjs — proving the focus survived 'or calls?' untouched, exactly like T31 proved for 'and calls?'");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("tier2/T36 existence recognizer: 'is there a class in <nonexistent module>' stays an honest miss, never an ambiguous guess at a same-directory module sharing only generic path/extension components", async () => {
  const { dir, turns } = await driveSession(["is there a class in app/lib/nope.mjs"]);
  try {
    assert.equal(turns[0].answer, 'no module matching "app/lib/nope.mjs" found in the index.',
      "app/lib/nope.mjs doesn't exist — before the fix this ambiguously 'matched' a real app/lib/*.mjs module purely by sharing the 'app'/'mjs' path/extension components with every module in the pool");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- SKILL_CHAT_PLAYTEST verification pass (this session): Seonix Batch 3's commit-
// temporal + cochange work (HANDOVER item 3b), confirmed live end-to-end through a real
// chat session against the SHIPPED examples/mini-webapp graph (real dated commits + a
// real change-coupling edge) — the entities.fixture.json fixture above has neither, so
// this uses the SAME `ephemeral: true` mini-webapp pattern test/chatflow-tier1-single-
// touch.test.mjs and test/chatflow-tier4.test.mjs already rely on, not repoWithFixture. ----

const MINIWEBAPP = new URL("../examples/mini-webapp", import.meta.url).pathname;

const driveSessionMiniWebapp = (queries) =>
  driveSessionTurns({ repoPath: MINIWEBAPP, env: {}, ephemeral: true }, queries, { strip: stripGoalLine });

test("tier2/recent-commits drill-down: 'recent commits' -> 'what did the last commit touch' -> 'what did it touch' -> 'when did it change' (temporal substitution + anaphora carry-through)", async () => {
  const queries = [
    "recent commits",
    "what did the last commit touch",
    "what did it touch",
    "when did it change",
  ];
  const turns = await driveSessionMiniWebapp(queries);
  for (const [i, t] of turns.entries()) {
    assert.doesNotMatch(t.answer, WALL, `turn ${i} "${queries[i]}" must not dead-end`);
  }
  // "recent commits" renders a real dated list, not a false find-miss
  assert.match(turns[0].answer, /^8 recent commit\(s\): /);
  assert.match(turns[0].answer, /1b2c3d4e5f60 \(2026-05-24\) — refactor store persistence API/);
  // "the last commit" is substituted for the actual newest Commit individual BEFORE parsing
  assert.equal(turns[1].answer, "commit 1b2c3d4e5f60 touched modules src/core/store.mjs and src/core/model.mjs.");
  // "it" carries the focus the previous turn set (the same commit, named explicitly)
  assert.equal(turns[2].answer, turns[1].answer, "'what did it touch' repeats the SAME real answer via anaphora, not a fresh miss");
  assert.equal(turns[3].answer, 'commit 1b2c3d4e5f60 is dated 2026-05-24 ("refactor store persistence API").');
});

test("tier2/cochange natural follow-up: 'what usually changes with X' -> 'what about <the surfaced file>' -> 'where is it defined'", async () => {
  const queries = [
    "what usually changes with src/core/store.mjs",
    "what about model.mjs",
    "where is it defined",
  ];
  const turns = await driveSessionMiniWebapp(queries);
  for (const [i, t] of turns.entries()) {
    assert.doesNotMatch(t.answer, WALL, `turn ${i} "${queries[i]}" must not dead-end`);
  }
  assert.equal(turns[0].answer, "src/core/model.mjs.", "store.mjs's real change-coupling partner");
  // naming the newly-surfaced file swaps the query subject and gets the RECIPROCAL real
  // answer (model.mjs's own change-coupling partner is store.mjs) — genuine new information,
  // not a bare repeat of turn 0.
  assert.equal(turns[1].answer, "src/core/store.mjs.");
  // "it" resolves to the entity NAMED in the prior query (model.mjs), not the answer it named
  assert.match(turns[2].answer, /^src\/core\/model\.mjs is a module/);
});
