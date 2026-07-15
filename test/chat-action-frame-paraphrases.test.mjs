// The action-rule teach frames accept their natural paraphrases — modal
// "may", the passive signature voicing, and pronoun "it" in the effect — and
// every form lands on the same rule family a plan can compile.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../src/chat.mjs";
import { loadMemory, readRuleRows } from "../src/memory/core.mjs";
import { clearCache } from "../src/source.mjs";

const CONFIG = {};
const mem = (tag) => mkdtemp(join(tmpdir(), `tmct-frame-${tag}-`));

test("'you may move a disk onto a peg' stores the same signature rule as the 'can' form", async () => {
  const dir = await mem("may");
  try {
    const turn = await runTurn("you may move a disk onto a peg.", { config: CONFIG, memoryDir: dir, sessionId: "f1" });
    assert.match(turn.answer, /noted — remembered: you can move a disk onto a peg/);
    const rules = readRuleRows(await loadMemory(dir));
    assert.ok(rules.some((r) => r.name === "move onto" && r.kind === "action-signature"));
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the passive signature voicing 'a crate can be stacked onto a crate' stores the active rule", async () => {
  const dir = await mem("passive");
  try {
    const turn = await runTurn("a crate can be stacked onto a crate.", { config: CONFIG, memoryDir: dir, sessionId: "f2" });
    assert.match(turn.answer, /noted — remembered: you can stack a crate onto a crate/);
    const rules = readRuleRows(await loadMemory(dir));
    const sig = rules.find((r) => r.name === "stack onto" && r.kind === "action-signature");
    assert.ok(sig);
    assert.equal(sig.slots.subjectClass, "crate");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("'makes it rest on the target' reads the pronoun as the moved subject and stores the effect", async () => {
  const dir = await mem("it");
  try {
    const turn = await runTurn("stacking a crate onto a crate makes it rest on the target.", { config: CONFIG, memoryDir: dir, sessionId: "f3" });
    assert.match(turn.answer, /noted — remembered: stacking a crate onto a crate makes the crate rest on the target/);
    const rules = readRuleRows(await loadMemory(dir));
    const eff = rules.find((r) => r.name === "stack onto" && r.kind === "action-effect");
    assert.ok(eff);
    assert.equal(eff.slots.subjectRole, "subject");
    assert.equal(eff.slots.objectRole, "target");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a question lead never stores a rule through the widened frames", async () => {
  const dir = await mem("question");
  try {
    const turn = await runTurn("can you move a disk onto a peg?", { config: CONFIG, memoryDir: dir, sessionId: "f4" });
    assert.equal(readRuleRows(await loadMemory(dir)).length, 0);
    assert.notEqual(turn.record.via, "assert");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a paraphrase-taught family compiles and solves: may-signature + it-effect move one disk home", async () => {
  const dir = await mem("solve");
  try {
    const session = { focus: null, last: null, planState: null };
    const turn = async (line) => {
      const r = await runTurn(line, {
        config: CONFIG, memoryDir: dir,
        focus: session.focus, last: session.last, planState: session.planState,
      });
      session.focus = r.focus ?? session.focus;
      session.last = r.last ?? session.last;
      if ("planState" in r) session.planState = r.planState;
      return r;
    };
    for (const s of [
      "a disk is a kind of game piece.",
      "a peg is a kind of place.",
      "disk-1 is a disk.",
      "peg-a is a peg.",
      "peg-b is a peg.",
      "you may move a disk onto a peg.",
      "moving a disk onto a peg makes it rest on the target.",
      "disk-1 rests on peg-a.",
    ]) {
      await turn(s);
    }
    const goal = await turn("the goal is that every disk rests on peg-b.");
    assert.match(goal.answer, /^noted — the goal is that every disk rests on peg-b/);
    const solved = await turn("solve it");
    assert.match(solved.answer, /plan found — 1 move/);
    assert.match(solved.answer, /move disk-1 onto peg-b/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
