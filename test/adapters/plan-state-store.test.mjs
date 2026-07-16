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

import { runTurn } from "../../src/chat.mjs";
import { loadMemory, readFactRows } from "../../src/memory/core.mjs";
import { clearCache } from "../../src/source.mjs";

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
