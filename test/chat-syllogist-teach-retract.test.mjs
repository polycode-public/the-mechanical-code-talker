// chat-syllogist-teach-retract.test.mjs — PLAN_SYLLOGIST.md's two routed
// "design question" findings from BENCHMARK_CONVERSATION_1.8.14.md, both
// closed for real here (not deferred):
//
//   1. Taught-fact RETRACTION never took, in any phrasing — the data-layer
//      primitive (retractSubClassOf, src/syllogise.mjs, PLAN_SYLLOGIST.md §3)
//      shipped with no chat-level phrasing wired to call it. teachLane now
//      recognizes "X is not a Y" and "forget that X is a Y" as closed
//      retraction triggers and calls retractSubClassOf for real.
//
//   2. Teaching against a subject name that's already a real code-graph
//      symbol (e.g. "Task") was entirely unreachable — the ask engine's own
//      relaxation cascade (src/ask.mjs relaxParse, "DROP-UNMATCHED") could
//      silently answer a malformed DECLARATIVE teach sentence as if it were
//      a different, valid QUESTION (dropping the taught object entirely),
//      so the miss-gated TEACH lane never ran. runAsk's relaxedTeachCollision
//      guard (src/chat.mjs) now detects this narrow collision and gives the
//      teach lane a real turn — the graph fact and the taught fact coexist.
//
// Driven against the SHIPPED examples/mini-webapp graph via `ephemeral: true`
// (chat.mjs's createSession) for the Task/graph-collision cases, and a bare
// runTurn (config: {}, no graph) for the pure-teach retraction cases — the
// same two driving styles this suite's neighbors (chatflow-tier5, wiring-
// facts) already use.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../src/chat.mjs";
import { driveSessionTurns } from "./helpers/session.mjs";
import { clearCache } from "../src/source.mjs";

const CONFIG = {};
const mem = (tag) => mkdtemp(join(tmpdir(), `tmct-syllogist-${tag}-`));
const REPO = new URL("../examples/mini-webapp", import.meta.url).pathname;

// ---- Finding 1: retraction ---------------------------------------------

test("retraction: 'X is not a Y' un-teaches a directly-taught subClassOf fact, verified by a before/after yes-no read", async () => {
  const dir = await mem("not-a");
  try {
    const taught = await runTurn("a task is a kind of animal", { config: CONFIG, memoryDir: dir });
    assert.equal(taught.record.miss, false);

    const before = await runTurn("is a task an animal", { config: CONFIG, memoryDir: dir });
    assert.match(before.answer, /^yes/);

    const retracted = await runTurn("a task is not an animal", { config: CONFIG, memoryDir: dir });
    assert.equal(retracted.record.miss, false, "a genuine retraction of an already-taught fact is not a miss");
    assert.equal(retracted.record.via, "retract");
    assert.match(retracted.answer, /forgotten/);

    const after = await runTurn("is a task an animal", { config: CONFIG, memoryDir: dir });
    assert.doesNotMatch(after.answer, /^yes/, "the retracted fact must not still answer yes");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("retraction: 'forget that X is a kind of Y' is a second recognized retraction phrasing", async () => {
  const dir = await mem("forget");
  try {
    await runTurn("a cache is a kind of animal", { config: CONFIG, memoryDir: dir });
    const before = await runTurn("is a cache an animal", { config: CONFIG, memoryDir: dir });
    assert.match(before.answer, /^yes/);

    const retracted = await runTurn("forget that a cache is a kind of animal", { config: CONFIG, memoryDir: dir });
    assert.equal(retracted.record.via, "retract");
    assert.equal(retracted.record.miss, false);

    const after = await runTurn("is a cache an animal", { config: CONFIG, memoryDir: dir });
    assert.doesNotMatch(after.answer, /^yes/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("retraction: an 'actually, X is not Y' preamble-wrapped retraction works the same as the bare phrasing", async () => {
  const dir = await mem("actually");
  try {
    await runTurn("a task is a kind of animal", { config: CONFIG, memoryDir: dir });
    const retracted = await runTurn("actually, a task is not an animal", { config: CONFIG, memoryDir: dir });
    assert.equal(retracted.record.via, "retract");
    assert.equal(retracted.record.miss, false);
    const after = await runTurn("is a task an animal", { config: CONFIG, memoryDir: dir });
    assert.doesNotMatch(after.answer, /^yes/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("retraction: a negation of a fact that was NEVER taught is an honest non-retraction — falls through to the ordinary decline, never a false 'forgotten' claim", async () => {
  const dir = await mem("never-taught");
  try {
    const r = await runTurn("a task is not an animal", { config: CONFIG, memoryDir: dir });
    assert.notEqual(r.record.via, "retract", "nothing was ever taught, so this must never claim a retraction happened");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("retraction: a negated PROPERTY claim ('X is not <adjective>') keeps its pre-existing honest decline, never mistaken for a subClassOf retraction trigger", async () => {
  const dir = await mem("prop-neg");
  try {
    await runTurn("remember that the logger module is deprecated", { config: CONFIG, memoryDir: dir });
    const r = await runTurn("remember that the logger module is not deprecated", { config: CONFIG, memoryDir: dir });
    assert.notEqual(r.record.via, "retract");
    assert.match(r.answer, /^I couldn't store that —/);
    // the original (non-negated) fact must survive untouched.
    const still = await runTurn("is the logger module deprecated", { config: CONFIG, memoryDir: dir });
    assert.match(still.answer, /^yes/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- Finding 2: graph-fact vs. taught-fact precedence -------------------

const driveSession = (queries) => driveSessionTurns({ repoPath: REPO, env: {}, ephemeral: true }, queries);

test("graph-collision: teaching 'a Task is a kind of animal' now succeeds even though Task is a real code-graph symbol — coexists with the graph's own inherits fact", async () => {
  const turns = await driveSession([
    "a Task is a kind of animal",   // used to be silently answered as a QUESTION ("Record"), never taught
    "is Task an animal",            // the taught fact must now read back
    "describe Task",                // both the graph edge AND the taught fact must be visible together
  ]);
  assert.match(turns[0].answer, /task rdfs:subClassOf animal|task is a kind of animal/,
    "the teach-shaped declarative must be recognized and stored, not silently reinterpreted as a question");
  assert.doesNotMatch(turns[0].answer, /^read as /, "must not be answered as a repaired QUESTION instead of being taught");
  assert.match(turns[1].answer, /^yes/, "the just-taught fact reads back");
  assert.match(turns[2].answer, /inherits.*Record/s, "the real code-graph inherits edge (Task -> Record) is untouched");
  assert.match(turns[2].answer, /taught facts:[\s\S]*task is a kind of animal/, "the taught fact is ALSO visible — coexistence, not replacement");
});

test("graph-collision: a teach-shaped sentence against a graph symbol that can't fit the subClassOf shape still stores SOMETHING real (never silently dropped back to a bare graph-only reading with no acknowledgement)", async () => {
  // "gizmo" is not a lexicon noun, but Task's capitalization grounds it as a
  // property-mint subject (unknownAdjectiveFallback's own bare-Capitalized-
  // name convention) — so this still stores (as a property fact, not
  // subClassOf), rather than silently vanishing back into the graph's
  // "Record" reading with no acknowledgement that a teach was attempted.
  const turns = await driveSession(["a Task is a kind of gizmo"]);
  assert.match(turns[0].answer, /noted — remembered/, "a teach-shaped sentence against a graph symbol always gets a real, stored acknowledgement now");
});
