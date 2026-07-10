// HANDOVER.md 2026-07-10 item 3: a stranger's very first turn, wrapped in an
// unrecognized opener, used to hit the raw structural wall instead of a
// helpful orientation response. Repro: "hey, first time trying this out -
// what is in here?" as the literal FIRST turn of a fresh session (no prior
// focus/context) — GREETING_PREAMBLE_RE stripped "hey," correctly, but the
// remainder ("first time trying this out - what is in here?") matched no
// existing preamble frame (BROWSING_PREAMBLE_RE only covered "just poking/
// looking around" phrasings) and no CAPABILITY_PHRASES entry either, so it
// fell through to ask()'s structural pipeline and failed outright.
//
// Two independent fixes, both exercised here:
//   (1) BROWSING_PREAMBLE_RE (interpret/normalize.mjs) widened to also
//       recognize "first time trying this out/using this/here" as the SAME
//       self-orientation preamble species "just poking around" already is.
//   (2) metaLane (chat.mjs) gained a no-standing-focus fallback: a bare
//       "what is in here"/"what's in here" with NO focus to resolve "here"
//       against now reaches the SAME orientation reading META_ORIENT_RE's
//       "what does this do"-family already produces, instead of the honest
//       but unhelpful "'here' needs a selected node…" miss.
//
// Driven against the SHIPPED examples/mini-webapp graph via `ephemeral: true`
// (chat.mjs's createSession), same mechanism test/chatflow-tier6.test.mjs uses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSession } from "../src/chat.mjs";
import { clearCache } from "../src/source.mjs";

const REPO = new URL("../examples/mini-webapp", import.meta.url).pathname;
// Two DIFFERENT, both legitimate, orientation wordings live in this codebase:
// metaLane's own orientationText() (the "what does this do"-family answer,
// including this fix's new no-focus "what is in here" fallback) renders "This
// is a tmct code graph — N entities…"; conversationalTurn's CAPABILITY_PHRASES/
// ORIENT_OPENERS lane (and the isConversational short-miss catch-all) renders
// the separate T_ORIENTATION template, "I'm tmct — a deterministic, offline
// code-graph assistant…". Both count as "the orientation card, not a dead
// end" — which one a given query reaches depends on which lane claims it.
const META_ORIENT_TEXT_RE = /^This is a tmct code graph/;
const ORIENTATION_ANSWER_RE = /^I'm tmct — a deterministic, offline code-graph assistant/;
const WALL_RE = /couldn't parse this as a graph question/;
const NEEDS_SELECTED_NODE_RE = /needs a selected node to refer to/;

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

test("stranger's first turn: 'hey, first time trying this out - what is in here?' gets the orientation card, not the raw wall", async () => {
  const [turn] = await driveSession(["hey, first time trying this out - what is in here?"]);
  assert.doesNotMatch(turn.answer, WALL_RE, "must not hit the raw structural wall");
  assert.doesNotMatch(turn.answer, NEEDS_SELECTED_NODE_RE, "must not hit the context-pronoun-unresolved miss either");
  assert.match(turn.answer, META_ORIENT_TEXT_RE);
});

test("non-regression: bare 'hey what is in here?' still flows to a helpful answer (no dead end), same lane as the repro", async () => {
  // Pre-fix this resolved as a context-pronoun-unresolved miss ("'here' needs a
  // selected node…") — a first-time stranger has no focus for "here" to
  // resolve against, so the SAME no-standing-focus fallback the repro now
  // reaches also upgrades this case to the orientation card. Strictly better,
  // never a dead end either way.
  const [turn] = await driveSession(["hey what is in here?"]);
  assert.doesNotMatch(turn.answer, WALL_RE);
  assert.doesNotMatch(turn.answer, NEEDS_SELECTED_NODE_RE);
  assert.match(turn.answer, META_ORIENT_TEXT_RE);
});

test("non-regression: bare 'just poking around' (no continuation) still reaches the SAME conversational orientation card as before (untouched lane)", async () => {
  const [turn] = await driveSession(["just poking around"]);
  assert.match(turn.answer, ORIENTATION_ANSWER_RE);
});

test("non-regression: 'just poking around, what is in here?' still flows (BROWSING_PREAMBLE_RE strip untouched, only the no-focus fallback downstream is new)", async () => {
  const [turn] = await driveSession(["just poking around, what is in here?"]);
  assert.doesNotMatch(turn.answer, WALL_RE);
  assert.doesNotMatch(turn.answer, NEEDS_SELECTED_NODE_RE);
  assert.match(turn.answer, META_ORIENT_TEXT_RE);
});

test("non-regression: 'what is in here?' with a REAL standing focus still resolves against that focus, not the new no-focus fallback", async () => {
  // Drive a real describe turn first so the session holds a standing focus
  // (src/core/model.mjs), then ask "what is in here?" — the no-focus fallback
  // is gated on `!focus?.label`, so this must resolve exactly as it did before
  // this change: a real (empty) containment check against the focused module,
  // never either orientation card.
  const [, turn] = await driveSession(["describe src/core/model.mjs", "what is in here?"]);
  assert.doesNotMatch(turn.answer, META_ORIENT_TEXT_RE, "a standing focus must never be diverted to the new no-focus fallback");
  assert.doesNotMatch(turn.answer, ORIENTATION_ANSWER_RE);
  assert.match(turn.answer, /no contains edges in the index/);
});
