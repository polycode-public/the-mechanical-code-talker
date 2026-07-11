// chatflow-persona-sweep-1.7.0.test.mjs — SKILL_BENCHMARK_CONVERSATION.md §3.4
// persona-sweep regression transcripts (four parallel personas driving real CLI
// sessions against a tmpdir copy of examples/mini-webapp). Freezes the dead-ends
// the sweep found and fixed, cross-referenced across personas — see the fix
// commit(s) this file ships alongside for the full root-cause writeup.
//
// Priority 1 (highest signal, confirmed 4x independently across 2 personas):
// a "teach/remember" fallback (chat.mjs's generalVerbTeach, reached via
// teachLane's BARE/unwrapped path) was silently absorbing ordinary
// non-assertion sentences as if they were taught facts — GENERAL_VERB_TEACH_RE's
// verb slot is a bare `[a-z]+` with no check that the captured word is a real
// verb, so a closed-class function word landing there (a possessive pronoun, a
// preposition, a subordinating conjunction) minted a nonsense mgx:<word>
// predicate and rendered a garbled "confirmation" that LOOKS like a successful
// teach — worse than a wall, because it carries no error/nudge at all. Fixed by
// (1) a question-mark guard (a genuine assertion never ends in "?") and (2) a
// new closed-class GENERAL_VERB_NOT_A_VERB_RE excluding pronouns/prepositions/
// conjunctions from the verb slot — never a POS-tagger heuristic (tried and
// rejected: wink mistags the legitimate "grace mentors alan" as NOUN NOUN NOUN
// in context, which would have regressed test/chat-teachlane-general-verb.test.mjs).
//
// Priority 2 (severe — kills the whole session): "good day to you", a plain
// formal greeting, was misparsed as a farewell/exit trigger.
//
// Priority 3 (deferred — see this file's own note below, or the fix commit if
// it landed): "my cat whiskers is a cat" (possessive-named-instance teach).
//
// Priority 4 (deferred/fixed — see the fix commit): a bare known class/entity
// name with no verb ("task", "usercontroller") getting no describe/focus
// treatment.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/chat.mjs";
import { clearCache } from "../src/source.mjs";

const REPO = new URL("../examples/mini-webapp", import.meta.url).pathname;
const WALL = /couldn't parse this as a graph question/;
const GARBLED_TEACH = /^noted — remembered/;

async function driveSession(queries, env = {}) {
  clearCache();
  const s = await createSession({ repoPath: REPO, env, ephemeral: true });
  const turns = [];
  try {
    for (const q of queries) turns.push(await s.turn(q));
  } finally {
    await s.close();
  }
  return turns;
}

// ---- Priority 1 — the four live repros, each its own turn, each must NOT be
// silently taught as a garbled fact. Falling through to an honest decline
// (the grammar wall, a context-pronoun nudge, etc.) is the correct outcome
// here — the bug was the CONFIDENT-WRONG absorb, not the miss itself.
test("persona-sweep P1: 'can you review my code for me' is never silently taught (used to store 'review mies code for me')", async () => {
  const [turn] = await driveSession(["can you review my code for me"]);
  assert.doesNotMatch(turn.answer, GARBLED_TEACH, `must not silently teach -> ${turn.answer}`);
  assert.doesNotMatch(turn.answer, /\bmies\b/, "the garbled 'mies' predicate render must never appear");
});

test("persona-sweep P1: 'g day mate, you alright?' (TMCT_NO_SEED=1) is never silently taught (used to store 'g days mate, you alright')", async () => {
  const [turn] = await driveSession(["g day mate, you alright?"], { TMCT_NO_SEED: "1" });
  assert.doesNotMatch(turn.answer, GARBLED_TEACH, `must not silently teach -> ${turn.answer}`);
  assert.doesNotMatch(turn.answer, /\bdays\b/, "the garbled 'days' predicate render must never appear");
});

test("persona-sweep P1: 'impact if i change it??' is never silently taught (used to store 'impact ifs i change it')", async () => {
  const [turn] = await driveSession(["impact if i change it??"]);
  assert.doesNotMatch(turn.answer, GARBLED_TEACH, `must not silently teach -> ${turn.answer}`);
  assert.doesNotMatch(turn.answer, /\bifs\b/, "the garbled 'ifs' predicate render must never appear");
});

test("persona-sweep P1: 'defs in model.mjs' is never silently taught (used to store 'defs ins model.mjs')", async () => {
  const [turn] = await driveSession(["defs in model.mjs"]);
  assert.doesNotMatch(turn.answer, GARBLED_TEACH, `must not silently teach -> ${turn.answer}`);
  assert.doesNotMatch(turn.answer, /\bins\b/, "the garbled 'ins' predicate render must never appear");
});

// ---- Priority 1 regression guard — the real, working teach shapes named in
// the sweep's own dispatch (P1's own boundary check) must keep working.
test("persona-sweep P1 regression: 'john is a man' / 'every cat is an animal' / 'paris is the capital of france' still teach correctly", async () => {
  const turns = await driveSession([
    "john is a man",
    "every cat is an animal",
    "paris is the capital of france",
  ]);
  assert.match(turns[0].answer, /noted — remembered: john is a kind of man/);
  assert.match(turns[1].answer, /noted — remembered 1 fact: cat rdfs:subClassOf animal/);
  assert.match(turns[2].answer, /noted — remembered: paris capitals france/);
});

test("persona-sweep P1 regression: bare general-verb teaches ('grace mentors alan today', 'remember margo eats ribs') still store", async () => {
  const turns = await driveSession(["grace mentors alan today", "remember margo eats ribs"]);
  assert.match(turns[0].answer, /^noted — remembered: grace mentors alan today/);
  assert.match(turns[1].answer, /^noted — remembered: margo eats ribs/);
});
