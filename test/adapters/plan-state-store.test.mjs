// Executing a plan step writes the board snapshot as REAL rows in the memory
// store — the "checked against board@stepK's written facts" claim in the
// rendered answer is backed by rows a reader can load, not by the planner's
// own in-memory state. The rendered plan-lane behaviours (solve, next,
// declines) live as planning-lane corpus rows; this file pins the store side.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runTurn } from "../../src/services/chat.mjs";
import { loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";
import { clearCache } from "../../src/adapters/source.mjs";

const DOMAIN = [
  "a disk is a kind of game piece.",
  "a peg is a kind of place.",
  "disk-1 is a disk.",
  "peg-a is a peg.",
  "peg-b is a peg.",
  "you can move a disk onto a peg.",
  "moving a disk onto a peg makes the disk rest on the target.",
  "disk-1 rests on peg-a.",
];

test("executed plan steps write @stepK snapshot rows into the store; the final step confirms the goal from them", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plan-store-"));
  try {
    let state = { focus: null, last: null, planState: null };
    const turn = async (line) => {
      const r = await runTurn(line, {
        config: {}, memoryDir: dir,
        focus: state.focus, last: state.last, planState: state.planState,
      });
      state.focus = r.focus ?? state.focus;
      state.last = r.last ?? state.last;
      if ("planState" in r) state.planState = r.planState;
      return r;
    };
    for (const line of DOMAIN) await turn(line);
    await turn("the goal is that every disk rests on peg-b.");
    const solve = await turn("solve it");
    assert.match(String(solve.answer), /^plan found — 1 move/);
    const final = await turn("next");
    assert.match(String(final.answer), /step 1 of 1/);
    assert.match(String(final.answer), /done — every disk rests on peg-b \(checked against board@step1's written facts, not assumed\)\./);
    assert.equal(state.planState.done, true);
    // The snapshot is a real row in the store, not a rendering artefact.
    const rows = readFactRows(await loadMemory(dir));
    const snapshot = rows.filter((r) => r.subject.endsWith("@step1"));
    assert.equal(snapshot.length, 1);
    assert.equal(snapshot[0].subject, "disk-1@step1");
    assert.equal(snapshot[0].predicate, "mgx:rest-on");
    assert.equal(snapshot[0].object, "peg-b");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

const BLOCKS = [
  "a block is a kind of game piece.",
  "a spot is a kind of place.",
  "block-1 is a block.",
  "spot-a is a spot.",
  "spot-b is a spot.",
  "spot-c is a spot.",
  "you can put a block onto a spot.",
  "putting a block onto a spot makes the block rest on the target.",
  "block-1 rests on spot-a.",
];

test("the final-step drift net re-searches from the drifted board and holds the found plan", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plan-store-drift-"));
  try {
    let state = { focus: null, last: null, planState: null };
    const turn = async (line, planState) => {
      const r = await runTurn(line, {
        config: {}, memoryDir: dir,
        focus: state.focus, last: state.last, planState: planState ?? state.planState,
      });
      state.focus = r.focus ?? state.focus;
      state.last = r.last ?? state.last;
      if ("planState" in r) state.planState = r.planState;
      return r;
    };
    for (const line of BLOCKS) await turn(line);
    // A real solve always reaches its own goal, so the final-step goal-check
    // failure is driven with a hand-built plan whose predicted final board
    // (block-1 on spot-b) falls a move short of the held goal (spot-c) yet is
    // still re-solvable — exactly the drift the net is there to catch.
    const drifted = {
      goals: [{ universal: false, term: "block-1", predicate: "rest-on", object: "spot-c" }],
      goalTexts: ["block-1 rests on spot-c"],
      goalText: "block-1 rests on spot-c",
      actions: [{ name: "put onto", subject: "block-1", target: "spot-b", label: "put block-1 onto spot-b" }],
      states: [
        [{ subject: "block-1", predicate: "mgx:rest-on", object: "spot-a" }],
        [{ subject: "block-1", predicate: "mgx:rest-on", object: "spot-b" }],
      ],
      stepGoals: ["put block-1 onto spot-b"],
      cursor: 0, done: false, stepBase: 0,
    };
    const r = await turn("next", drifted);
    assert.match(String(r.answer), /the state drifted, so I replanned from board@step1: 1\. put block-1 onto spot-c\. Say "next" to continue\./);
    // The found plan is HELD (not settled as done) and stacks above the drifted
    // board@step1, so its own step will write @step2.
    assert.notEqual(state.planState.done, true);
    assert.equal(state.planState.actions[0].label, "put block-1 onto spot-c");
    assert.equal(state.planState.stepBase, 1);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a second plan minted after a prior plan left @step1 standing writes its step above it and confirms from the right layer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plan-store-replan-"));
  try {
    let state = { focus: null, last: null, planState: null };
    const turn = async (line) => {
      const r = await runTurn(line, {
        config: {}, memoryDir: dir,
        focus: state.focus, last: state.last, planState: state.planState,
      });
      state.focus = r.focus ?? state.focus;
      state.last = r.last ?? state.last;
      if ("planState" in r) state.planState = r.planState;
      return r;
    };
    for (const line of DOMAIN) await turn(line);
    await turn("the goal is that every disk rests on peg-b.");
    await turn("solve it");
    await turn("next"); // disk-1 now rests on peg-b at board@step1
    // A fresh goal off the finished plan, solved from the board@step1 fold.
    await turn("the goal is that every disk rests on peg-a.");
    const solve2 = await turn("solve it");
    assert.match(String(solve2.answer), /^plan found — 1 move/);
    const final2 = await turn("next");
    // The move must write @step2 (above the standing @step1) and confirm from it.
    assert.match(String(final2.answer), /board@step2:/);
    assert.match(String(final2.answer), /done — every disk rests on peg-a \(checked against board@step2's written facts, not assumed\)\./);
    assert.equal(state.planState.stepBase, 1);
    const rows = readFactRows(await loadMemory(dir));
    const step2 = rows.filter((r) => r.subject === "disk-1@step2");
    assert.equal(step2.length, 1);
    assert.equal(step2[0].predicate, "mgx:rest-on");
    assert.equal(step2[0].object, "peg-a");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
