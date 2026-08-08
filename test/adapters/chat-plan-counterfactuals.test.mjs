// Plan-justification counterfactuals: the "what if <piece> started <place>
// instead?" hypothetical re-solve and the "why did you <act> A instead of
// B?" / "why not B first?" forced-alternative compare, both answered off
// the active plan slot inside planFollowUpAnswer. The rendered behaviours
// (templates, corpus phrasing) live as planning-lane corpus rows; this file
// pins the read-only contract — the held plan survives every question
// unchanged, and an impossible alternative names its violated precondition
// rather than guessing.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runTurn } from "../../src/services/chat.mjs";
import { readFactRows, loadMemory } from "../../src/adapters/memory/core.mjs";
import { clearCache } from "../../src/adapters/source.mjs";
import { hanoiLessonSentences } from "../../src/domain/hanoi-lesson.mjs";

/** Drives a scratch session's turns through runTurn, re-threading focus/
 *  last/planState the way every real caller does (chat-session.mjs,
 *  test/helpers/session.mjs). Returns the driver plus a snapshot of state
 *  the caller can read after each turn. */
function sessionOver(dir, extraOptions = {}) {
  const state = { focus: null, last: null, planState: null };
  const turn = async (line) => {
    const r = await runTurn(line, {
      config: {}, memoryDir: dir,
      focus: state.focus, last: state.last, planState: state.planState,
      ...extraOptions,
    });
    state.focus = r.focus ?? state.focus;
    state.last = r.last ?? state.last;
    if ("planState" in r) state.planState = r.planState;
    return r;
  };
  return { turn, state };
}

async function withScratchDir(prefix, fn) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  try {
    await fn(dir);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
}

// The small non-worst-case board below is deliberately NOT the shipped
// hanoi lesson: the shipped 3-disk lesson teaches the worst-case start (a
// full stack on one peg, goal the opposite peg), so any single-piece
// hypothetical from it can only need an equal-or-shorter re-solve, never a
// longer one — there is no room under a shared move bound to exercise the
// "moves exist but the bound ran out" decline. This board starts already
// two-thirds solved instead, leaving room for a hypothetical to cost more.
const SPREAD_BOARD = [
  "a disk is a kind of game piece.",
  "a peg is a kind of place.",
  "disk-1 is a disk.",
  "disk-2 is a disk.",
  "peg-a is a peg.",
  "peg-b is a peg.",
  "peg-c is a peg.",
  "disk-1 is smaller than disk-2.",
  "you can move a disk onto a peg.",
  "you can move a disk onto a disk.",
  "to move a disk onto a target, nothing may rest on the disk.",
  "to move a disk onto a target, nothing may rest on the target.",
  "to move a disk onto a disk, the disk must be smaller than the target.",
  "moving a disk onto a target makes the disk rest on the target.",
  "disk-2 rests on peg-c.",
  "disk-1 rests on peg-a.",
];

test("a hypothetical start re-solves from the modified board and reports its own move count", async () => {
  await withScratchDir("plan-cf-whatif-", async (dir) => {
    const { turn } = sessionOver(dir);
    for (const line of hanoiLessonSentences(3)) await turn(line);
    const r = await turn("what if disk-1 started on peg-c instead?");
    assert.match(String(r.answer), /^from that start it takes \d+ moves \(shortest\):/);
    assert.match(String(r.answer), /hypothetical only/);
  });
});

test("a hypothetical start leaves the held plan, its cursor and its move count untouched", async () => {
  await withScratchDir("plan-cf-whatif-untouched-", async (dir) => {
    const { turn, state } = sessionOver(dir);
    for (const line of hanoiLessonSentences(3)) await turn(line);
    const beforeActions = state.planState.actions;
    await turn("what if disk-1 started on peg-c instead?");
    assert.equal(state.planState.actions, beforeActions, "the held plan's own actions array is the same reference");
    assert.equal(state.planState.cursor, 0);
    const next = await turn("what is the next move");
    assert.match(String(next.answer), /^the next move is move 1 of 7: move disk-1 onto peg-c/);
    const count = await turn("how many moves");
    assert.match(String(count.answer), /^7 moves in the plan/);
  });
});

test("a hypothetical start whose goal is unreachable names the move bound", async () => {
  await withScratchDir("plan-cf-whatif-bound-", async (dir) => {
    const { turn } = sessionOver(dir, { gameConfig: { planning: { maxDepth: 1 } } });
    for (const line of SPREAD_BOARD) await turn(line);
    const solve = await turn("the goal is that every disk rests on peg-c.");
    assert.match(String(solve.answer), /noted/);
    const solved = await turn("solve it");
    assert.match(String(solved.answer), /^plan found — 1 move/);
    const r = await turn("what if disk-2 started on peg-b instead?");
    assert.match(String(r.answer), /^no plan from that start within 1 moves to: every disk rests on peg-c\./);
  });
});

test("a hypothetical start naming an untaught piece keeps the honest miss", async () => {
  await withScratchDir("plan-cf-whatif-untaught-", async (dir) => {
    const { turn } = sessionOver(dir);
    for (const line of hanoiLessonSentences(3)) await turn(line);
    const r = await turn("what if disk-99 started on peg-c instead?");
    assert.doesNotMatch(String(r.answer), /from that start/);
  });
});

test("the same hypothetical board answers identically whichever order its locative facts were taught in", async () => {
  const board = (order) => [
    "a disk is a kind of game piece.",
    "a peg is a kind of place.",
    "disk-1 is a disk.",
    "disk-2 is a disk.",
    "disk-3 is a disk.",
    "peg-a is a peg.",
    "peg-b is a peg.",
    "peg-c is a peg.",
    "disk-1 is smaller than disk-2.",
    "disk-1 is smaller than disk-3.",
    "disk-2 is smaller than disk-3.",
    "you can move a disk onto a peg.",
    "you can move a disk onto a disk.",
    "to move a disk onto a target, nothing may rest on the disk.",
    "to move a disk onto a target, nothing may rest on the target.",
    "to move a disk onto a disk, the disk must be smaller than the target.",
    "moving a disk onto a target makes the disk rest on the target.",
    ...order,
  ];
  const forward = board(["disk-1 rests on disk-2.", "disk-2 rests on disk-3.", "disk-3 rests on peg-a."]);
  const reversed = board(["disk-3 rests on peg-a.", "disk-2 rests on disk-3.", "disk-1 rests on disk-2."]);
  const answers = [];
  for (const teach of [forward, reversed]) {
    await withScratchDir("plan-cf-whatif-order-", async (dir) => {
      const { turn } = sessionOver(dir);
      for (const line of teach) await turn(line);
      await turn("the goal is that every disk rests on peg-c.");
      await turn("solve it");
      const r = await turn("what if disk-1 started on peg-c instead?");
      answers.push(String(r.answer));
    });
  }
  assert.equal(answers[0], answers[1]);
});

test("forcing the alternative first move reports the cost difference against the found plan", async () => {
  await withScratchDir("plan-cf-alt-cost-", async (dir) => {
    const { turn } = sessionOver(dir);
    for (const line of hanoiLessonSentences(3)) await turn(line);
    const r = await turn("why did you move disk-1 onto peg-c instead of peg-b?");
    assert.match(String(r.answer), /^forcing move disk-1 onto peg-b first costs \d+ moves against 7\./);
  });
});

test("an alternative with no legal first move names the taught precondition that blocks it", async () => {
  await withScratchDir("plan-cf-alt-precond-", async (dir) => {
    const { turn } = sessionOver(dir);
    for (const line of hanoiLessonSentences(3)) await turn(line);
    const r = await turn("why did you move disk-1 first instead of disk-2?");
    assert.match(String(r.answer), /^disk-2 can't go first — disk-1 rests on disk-2, and your "move onto" rule says nothing may rest on the piece you move\./);
  });
});

test("the why-not voicing and the instead-of voicing give the same contrastive answer", async () => {
  await withScratchDir("plan-cf-alt-voicing-", async (dir) => {
    const { turn } = sessionOver(dir);
    for (const line of hanoiLessonSentences(3)) await turn(line);
    const whyNot = await turn("why not move disk-2 first?");
    const insteadOf = await turn("why did you move disk-1 first instead of disk-2?");
    assert.equal(String(whyNot.answer), String(insteadOf.answer));
  });
});

test("an alternative naming a target-class term forces the target, not the subject", async () => {
  await withScratchDir("plan-cf-alt-target-", async (dir) => {
    const { turn } = sessionOver(dir);
    for (const line of hanoiLessonSentences(3)) await turn(line);
    const r = await turn("why did you move disk-1 onto peg-c instead of peg-b?");
    // The subject (disk-1) is unchanged; only the target is forced to peg-b.
    assert.match(String(r.answer), /forcing move disk-1 onto peg-b first/);
  });
});

test("a counterfactual with no plan standing returns nothing and the honest miss stands", async () => {
  await withScratchDir("plan-cf-cold-", async (dir) => {
    const { turn } = sessionOver(dir);
    for (const line of hanoiLessonSentences(3).slice(0, -2)) await turn(line); // teach everything, never solve
    const whatIf = await turn("what if disk-1 started on peg-c instead?");
    assert.doesNotMatch(String(whatIf.answer), /from that start/);
    const alt = await turn("why did you move disk-1 first instead of disk-2?");
    assert.doesNotMatch(String(alt.answer), /forcing/);
  });
});

test("a counterfactual stores no fact and writes no board snapshot", async () => {
  await withScratchDir("plan-cf-no-write-", async (dir) => {
    const { turn } = sessionOver(dir);
    for (const line of hanoiLessonSentences(3)) await turn(line);
    const before = readFactRows(await loadMemory(dir));
    await turn("what if disk-1 started on peg-c instead?");
    await turn("why did you move disk-1 first instead of disk-2?");
    const after = readFactRows(await loadMemory(dir));
    assert.equal(after.length, before.length);
    assert.ok(!after.some((r) => /@step\d+$/.test(r.subject)), "no @stepK snapshot row was written");
  });
});
