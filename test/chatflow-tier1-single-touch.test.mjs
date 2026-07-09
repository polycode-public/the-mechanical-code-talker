// chatflow-tier1-single-touch.test.mjs — SKILL_CHAT_PLAYTEST regression transcripts,
// genuine Tier 1 ("single touch + one drill-down" — §3: "what is a class" -> follow
// ONE of the product's own guided "Want to go deeper?" questions verbatim -> ONE
// natural follow-up in the user's own words to ITS answer, then stop).
//
// Driven against the SHIPPED examples/mini-webapp graph via `ephemeral: true`
// (chat.mjs's createSession) — reads the real graph but writes session/provenance
// state to a throwaway temp dir, so the committed fixture is never touched (verified
// by test/chat-ephemeral.test.mjs's own byte-identical guarantee; this file relies on
// that same mechanism rather than re-proving it).
//
// The five dead-ends this pins (all ROUTING/recognition, no new grammar rigidity,
// found via the product's OWN guided follow-ups — §0's "an offered example that
// itself fails when tried" bar):
//   T1  "does <X> <verb> anything/something [else]" ("does listTasks call anything
//       else") hit the {ambiguousParse} tie (grammar kept "anything else" as one
//       object span, keyword-spot split "else" off alone) — interpret/normalize.mjs's
//       DOES-X-VERB-ANYTHING-ELSE frame rewrites the whole shape onto the working
//       "what does X <verb>" canonical form.
//   T2  A leading staccato connective before an already-complete question ("and what
//       imports it") had "and" itself misread as the ask-shape subject term — a miss
//       the relaxation cascade couldn't rescue ("and" is protected CONTENT_VOCAB
//       elsewhere). interpret/normalize.mjs strips a leading and/also/so/then/now/but
//       ONLY when immediately followed by a real question opener.
//   T3  "that class"/"this module" (a context pronoun immediately followed by the
//       kind noun it already stands in for) hit {ambiguousParse} the same way as T1
//       (the two strategies split the span differently) — folded to the bare pronoun
//       before either strategy runs.
//   T4  "what else is in X" (not a compositional marker, so parseComposite never saw
//       it) only reached an answer via the relaxation cascade, which refuses to accept
//       a relaxed reading that still renders an honest EMPTY — so a genuinely empty
//       class bottomed out at the bare grammar wall instead of a specific "no contains
//       edges" receipt. Added as its own PHRASING_FRAME sibling to "what is in X".
//   T5  "is <X> public/private/static/abstract/constant/exported/tested/…" (a single-
//       ENTITY qualifier check — "is it a public attribute?", "is Task.title public")
//       had no recognizer at all, even for a concretely named entity with no anaphora
//       involved — ask.mjs's new parseQualifierCheck/evalQualCheck answers it with the
//       existing qualHolds() predicate the set-filter path already used.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/chat.mjs";
import { clearCache } from "../src/source.mjs";

const WALL = /couldn't parse this as a graph question/;
const AMBIGUOUS = /this could mean more than one thing/;
const COULDNT_RESOLVE = /couldn't resolve one of the terms/;
const COMPOSITE_MISS = /couldn't compile this compositional question/;
const DEAD_END = new RegExp([WALL, AMBIGUOUS, COULDNT_RESOLVE, COMPOSITE_MISS].map((r) => r.source).join("|"));

const REPO = new URL("../examples/mini-webapp", import.meta.url).pathname;

async function driveSession(queries) {
  clearCache();
  const s = await createSession({ repoPath: REPO, env: {}, ephemeral: true });
  const turns = [];
  try {
    for (const q of queries) turns.push(await s.turn(q));
  } finally {
    await s.close();
  }
  return turns;
}

function assertAllFlow(turns, queries) {
  for (const [i, t] of turns.entries()) {
    assert.doesNotMatch(t.answer, DEAD_END, `turn ${i} "${queries[i]}" must not dead-end: ${t.answer.slice(0, 120)}`);
  }
}

test("tier1/class: 'what is a class' -> 'which classes inherit from Record' (verbatim guided Q) -> 'does Project inherit from Record too?'", async () => {
  const queries = [
    "what is a class",
    "which classes inherit from Record",
    "does Project inherit from Record too?",
  ];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  assert.match(turns[0].answer, /A class is a template/, "concept force leads with the class definition");
  assert.match(turns[0].answer, /Want to go deeper\?/, "concept force offers guided follow-ups");
  assert.match(turns[0].answer, /which classes inherit from Record/, "the guided Q we follow is genuinely offered");
  assert.match(turns[1].answer, /Task/, "the guided Q names a real subclass of Record");
  assert.match(turns[2].answer, /^Yes — inherits edge from Project to Record\.?/, "the natural follow-up gets a real, correct Yes");
});

test("tier1/function: 'what is a function' -> 'what calls loadStore' (verbatim guided Q) -> 'does listTasks call anything else?'", async () => {
  const queries = [
    "what is a function",
    "what calls loadStore",
    "does listTasks call anything else?",
  ];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  assert.match(turns[0].answer, /A function is a named, reusable block of code/, "concept force leads with the function definition");
  assert.match(turns[0].answer, /what calls loadStore/, "the guided Q we follow is genuinely offered");
  assert.match(turns[1].answer, /listTasks/, "loadStore's caller is named");
  assert.match(turns[2].answer, /loadStore/, "T1 fix: 'call anything else' resolves onto the real call list, not an ambiguous tie");
});

test("tier1/module: 'what is a module' -> 'what does src/core/store.mjs import' (verbatim guided Q) -> 'and what imports it?'", async () => {
  const queries = [
    "what is a module",
    "what does src/core/store.mjs import",
    "and what imports it?",
  ];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  assert.match(turns[0].answer, /A module is a source file/, "concept force leads with the module definition");
  assert.match(turns[0].answer, /what does src\/core\/store\.mjs import/, "the guided Q we follow is genuinely offered");
  assert.match(turns[1].answer, /src\/core\/model\.mjs/, "store.mjs's own import is named");
  assert.match(turns[2].answer, /src\/handlers\/tasks\.mjs/, "T2 fix: a leading 'and' no longer swallows the pronoun question");
});

test("tier1/method: 'what is a method' -> 'which class contains Task.complete' (verbatim guided Q) -> 'what else is in that class'", async () => {
  const queries = [
    "what is a method",
    "which class contains Task.complete",
    "what else is in that class",
  ];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  assert.match(turns[0].answer, /A method is a function that belongs to a class/, "concept force leads with the method definition");
  assert.match(turns[0].answer, /which class contains Task\.complete/, "the guided Q we follow is genuinely offered");
  assert.match(turns[1].answer, /Task/, "Task.complete's containing class is named");
  // T3+T4 fix: "that class" no longer ties {ambiguousParse}, and "what else is in X"
  // reaches the SAME honest, specific receipt the direct "what is in X" form gives
  // (never the bare wall) — Task.complete (a leaf method) genuinely has no further
  // members, so the honest answer names it and says so, rather than fabricating one.
  assert.match(turns[2].answer, /Task\.complete/, "T3+T4 fix: 'that class' resolves and 'what else is in X' gets the real, specific receipt");
  assert.match(turns[2].answer, /no contains edges/, "…an honest, specific empty — never the bare grammar wall");
});

test("tier1/attribute: 'what is an attribute' -> 'which class contains Task.title' (verbatim guided Q) -> 'is it a public attribute?'", async () => {
  const queries = [
    "what is an attribute",
    "which class contains Task.title",
    "is it a public attribute?",
  ];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  assert.match(turns[0].answer, /An attribute is a named piece of data/, "concept force leads with the attribute definition");
  assert.match(turns[0].answer, /which class contains Task\.title/, "the guided Q we follow is genuinely offered");
  assert.match(turns[1].answer, /Task/, "Task.title's containing class is named");
  assert.match(turns[2].answer, /^Yes — Task\.title is public\.?/, "T5 fix: a single-entity qualifier check now answers directly, never the bare wall");
});

test("tier1/qualifier-check sanity: a NAMED entity with no anaphora at all also answers ('is Task.title public')", async () => {
  // T5's own regression floor, independent of any focus/anaphora machinery — the
  // playtest found this walled even with zero pronouns involved.
  const turns = await driveSession(["is Task.title public", "is Task.title private", "is Task.title exported"]);
  assertAllFlow(turns, ["is Task.title public", "is Task.title private", "is Task.title exported"]);
  assert.equal(turns[0].answer.startsWith("Yes — Task.title is public."), true);
  assert.equal(turns[1].answer.startsWith("No — Task.title is not private."), true);
  assert.equal(turns[2].answer.startsWith("No — Task.title is not exported."), true);
});

// SKILL_CHAT_PLAYTEST verification pass (this session): Seonix Batch 2/3 single-touch
// spot-checks, each its own independent turn (no drill-down needed — every one of these
// IS the single touch): bare no-article "what is Commit" (Batch 2 Fix 1a, restricted to
// ENTITY_TO_TYPE's closed vocabulary), the purpose-phrasing sibling of "what does X do"
// (Batch 3a MODULE_PURPOSE_RE, "whats X for"/"whats X about"), the reverse "superclass of"
// verb family (Batch 2 Fix 1b, subject/object swapped at parse time so both directions
// agree), and TRAILING_SCOPE_FILLER trimming a "what is a <noun> in this graph" tail
// (Batch 2 Fix 1c).
test("tier1/Seonix Batch 2+3 single-touch spot-check: bare 'what is Commit', purpose phrasing, reverse superclass verb, and scope-filler trim all flow", async () => {
  const queries = [
    "what is Commit",
    "whats src/lib/logger.mjs for",
    "whats Task about",
    "is Record a superclass of Task",
    "is Task a subclass of Record",
    "what is a Module in this graph",
  ];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  assert.match(turns[0].answer, /^A commit is a recorded snapshot/, "bare no-article 'what is Commit' direct-hits the meta definition");
  assert.equal(turns[1].answer, "src/lib/logger.mjs is a module — defines 3 (Logger, Logger.info, createLogger); no recorded tests. /describe src/lib/logger.mjs for the full breakdown.");
  assert.equal(turns[2].answer, "Task is a class — no recorded tests. /describe Task for the full breakdown.");
  assert.match(turns[3].answer, /^Yes — inherits edge from Task to Record\.?/, "'is Record a superclass of Task' swaps subject/object and agrees with the direct form");
  assert.match(turns[4].answer, /^Yes — inherits edge from Task to Record\.?/, "'is Task a subclass of Record' agrees with the reverse phrasing above");
  assert.match(turns[5].answer, /^A module is a source file/, "the trailing 'in this graph' scope filler is trimmed, reaching the same meta definition as bare 'what is a Module'");
});

// HANDOVER.md item 9 (found during this session's playtest-freeze verification pass):
// "whats logging for" — a bare, NOT-a-real-path term routed correctly to moduleOrientLane
// (MODULE_PURPOSE_RE) but resolveObject's tier 4 prose-index fallback then confidently
// resolved "logging" to an UNRELATED Commit individual (one whose commit MESSAGE happens
// to contain the word "logging") instead of src/lib/logger.mjs — the intended module,
// whose own basename ("logger") is a real morphological match (gerund/agent-noun pair) one
// suffix-swap away from the query word, not a substring of it. Root cause: resolveObject's
// tier 3 (src/ask.mjs) had no way to see that relationship at all (its component/stem
// checks are substring/exact only), so it fell straight through to tier 4, whose only hit
// was the commit's free-text message — a genuinely confident WRONG answer, the dead-end
// shape this whole project exists to prevent. Fixed with a narrow, Module-only
// derivational-suffix basename bridge in tier 3 (derivationalStem, src/ask.mjs) that never
// competes with tier 5's own typo-correction territory (see test/ask.test.mjs's own unit
// coverage for the tier-level mechanics) — this is the end-to-end confirmation that the
// real chat path now reaches the real module, not the commit.
test("tier1/Seonix item 9 fix: bare 'whats logging for' resolves to the real src/lib/logger.mjs module, never the unrelated Commit whose message happens to mention the word", async () => {
  const queries = ["whats logging for"];
  const turns = await driveSession(queries);
  assertAllFlow(turns, queries);
  assert.equal(turns[0].answer, "src/lib/logger.mjs is a module — defines 3 (Logger, Logger.info, createLogger); no recorded tests. /describe src/lib/logger.mjs for the full breakdown.");
  assert.doesNotMatch(turns[0].answer, /is a commit/, "must never resolve to the commit whose message merely mentions the word");
});
