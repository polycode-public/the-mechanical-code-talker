// The plan lane end to end: teach a game domain in sentences, state a goal,
// solve, execute step by step, and confirm the goal from the written facts.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runTurn } from "../src/chat.mjs";
import { loadMemory, readFactRows } from "../src/memory/core.mjs";
import { clearCache } from "../src/source.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };

const DOMAIN_SENTENCES = [
  "a disk is a kind of game piece.",
  "a peg is a kind of place.",
  "disk-1 is a disk.", "disk-2 is a disk.", "disk-3 is a disk.",
  "peg-a is a peg.", "peg-b is a peg.", "peg-c is a peg.",
  "disk-1 is smaller than disk-2.", "disk-1 is smaller than disk-3.",
  "disk-2 is smaller than disk-3.",
  "you can move a disk onto a peg.",
  "you can move a disk onto a disk.",
  "to move a disk onto a target, nothing may rest on the disk.",
  "to move a disk onto a target, nothing may rest on the target.",
  "to move a disk onto a disk, the disk must be smaller than the target.",
  "moving a disk onto a target makes the disk rest on the target.",
  "a disk renders as a block.", "a peg renders as a slot.",
];
const STATE_SENTENCES = [
  "disk-1 rests on disk-2.", "disk-2 rests on disk-3.", "disk-3 rests on peg-a.",
];
const GOAL_SENTENCE = "the goal is that every disk rests on peg-c.";

/** A minimal session: threads focus/last/planState the way createSession does. */
function makeSession(dir) {
  const s = { focus: null, last: null, planState: null };
  s.turn = async (line) => {
    const r = await runTurn(line, {
      config: CONFIG, memoryDir: dir,
      focus: s.focus, last: s.last, planState: s.planState,
    });
    s.focus = r.focus ?? s.focus;
    s.last = r.last ?? s.last;
    if ("planState" in r) s.planState = r.planState;
    return r;
  };
  return s;
}

async function teachAll(s, sentences) {
  for (const line of sentences) {
    const r = await s.turn(line);
    assert.match(String(r.answer), /^noted/, `teach failed: ${line} -> ${String(r.answer).split("\n")[0]}`);
  }
}

test("plan lane: teach, state, goal, solve — 7 optimal moves with the plan attached", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plan-lane-"));
  try {
    const s = makeSession(dir);
    await teachAll(s, [...DOMAIN_SENTENCES, ...STATE_SENTENCES]);
    const goal = await s.turn(GOAL_SENTENCE);
    assert.match(String(goal.answer), /^noted — the goal is that every disk rests on peg-c/);
    const solve = await s.turn("solve it");
    const text = String(solve.answer);
    assert.match(text, /^plan found — 7 moves \(shortest\):/);
    assert.match(text, /1\. move disk-1 onto peg-c/);
    assert.match(text, /7\. move disk-1 onto disk-2/);
    assert.match(text, /because — you taught me the "move onto" rule/);
    assert.match(text, /Goal \(inferred\): Plan a move sequence from the current state to the goal \(7 moves\)/);
    // The 4R contract.
    assert.equal(solve.plan.actions.length, 7);
    assert.equal(solve.plan.states.length, 8);
    assert.equal(solve.plan.stepGoals.length, 7);
    assert.match(solve.plan.stepGoals[0], /move disk-1 onto peg-c \(step 1 of 7, working toward: every disk rests on peg-c\)/);
    assert.equal(solve.plan.goal.text, "every disk rests on peg-c");
    assert.equal(solve.plan.goal.specs.length, 1);
    assert.deepEqual(solve.plan.domain.renderHints, { disk: "block", peg: "slot" });
    assert.equal(solve.plan.domain.ordering.length, 3);
    assert.ok(Array.isArray(solve.plan.domain.classMembers.disk));
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("plan lane: legal moves is one ply, no search; next x7 writes @stepK rows and confirms the goal from the store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plan-next-"));
  try {
    const s = makeSession(dir);
    await teachAll(s, [...DOMAIN_SENTENCES, ...STATE_SENTENCES]);
    await s.turn(GOAL_SENTENCE);
    const legal = await s.turn("what moves are legal now?");
    assert.match(String(legal.answer), /^2 legal moves from here:/);
    await s.turn("solve it");
    for (let i = 1; i <= 6; i += 1) {
      const r = await s.turn("next");
      assert.match(String(r.answer), new RegExp(`^moved — .* \\(step ${i} of 7\\)`));
      assert.match(String(r.answer), new RegExp(`board@step${i}:`));
    }
    // An aside mid-plan leaves the plan intact.
    const aside = await s.turn("what is a dog");
    assert.ok(aside.answer.length > 0);
    assert.equal(s.planState.done, false);
    assert.equal(s.planState.cursor, 6);
    const final = await s.turn("next");
    assert.match(String(final.answer), /step 7 of 7/);
    assert.match(String(final.answer), /done — every disk rests on peg-c \(checked against board@step7's written facts, not assumed\)\./);
    assert.equal(s.planState.done, true);
    // The snapshots are real rows in the store.
    const rows = readFactRows(await loadMemory(dir));
    const step7 = rows.filter((r) => r.subject.endsWith("@step7"));
    assert.equal(step7.length, 3);
    assert.ok(step7.every((r) => r.predicate === "mgx:rest-on"));
    // A finished plan releases "next" back to its old meaning (no active plan).
    const after = await s.turn("next");
    assert.doesNotMatch(String(after.answer), /^moved —/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("plan lane: each missing precondition declines honestly and specifically", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plan-decline-"));
  try {
    const s = makeSession(dir);
    // No action rules at all.
    await teachAll(s, STATE_SENTENCES.slice(0, 1));
    const noRules = await s.turn("solve it");
    assert.match(String(noRules.answer), /^no action rules taught yet — teach the game first/);
    // Rules but no state.
    const dir2 = await mkdtemp(join(tmpdir(), "plan-decline2-"));
    try {
      const s2 = makeSession(dir2);
      await teachAll(s2, DOMAIN_SENTENCES);
      const noState = await s2.turn("solve it");
      assert.match(String(noState.answer), /^no current state taught yet — state the board first/);
      // State but no goal.
      await teachAll(s2, STATE_SENTENCES);
      const noGoal = await s2.turn("solve it");
      assert.match(String(noGoal.answer), /^no goal set yet — teach one first/);
    } finally {
      await rm(dir2, { recursive: true, force: true });
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("plan lane: the combined one-message form (state + goal + solve) answers with receipts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plan-combined-"));
  try {
    const s = makeSession(dir);
    await teachAll(s, DOMAIN_SENTENCES);
    const combined = await s.turn(
      "disk-1 rests on disk-2. disk-2 rests on disk-3. disk-3 rests on peg-a. " +
      "the goal is that every disk rests on peg-c. solve it.");
    const text = String(combined.answer);
    assert.match(text, /^• noted — remembered: disk-1 rests on disk-2/m);
    assert.match(text, /• noted — the goal is that every disk rests on peg-c/);
    assert.match(text, /plan found — 7 moves \(shortest\):/);
    assert.equal(combined.plan?.actions?.length, 7);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

const RIVER_DOMAIN_SENTENCES = [
  "a passenger is a kind of game piece.",
  "a bank is a kind of place.",
  "wolf-1 is a wolf.", "wolf-1 is a passenger.",
  "goat-1 is a goat.", "goat-1 is a passenger.",
  "cabbage-1 is a cabbage.", "cabbage-1 is a passenger.",
  "farmer-1 is a farmer.",
  "bank-east is a bank.", "bank-west is a bank.",
  "you can ferry a passenger onto a bank.",
  "you can ferry a farmer onto a bank.",
  "ferrying a passenger onto a bank makes the passenger stand on the target.",
  "ferrying a passenger onto a bank makes the farmer stand on the target.",
  "to ferry a passenger onto a bank, the wolf may not be with the goat without the farmer.",
  "to ferry a passenger onto a bank, the goat may not be with the cabbage without the farmer.",
];
const RIVER_STATE_SENTENCES = [
  "wolf-1 stands on bank-east.", "goat-1 stands on bank-east.",
  "cabbage-1 stands on bank-east.", "farmer-1 stands on bank-east.",
];

test("plan lane: a co-travel effect plus taught constraints solve the river crossing — next x7 ferries everyone across", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plan-river-"));
  try {
    const s = makeSession(dir);
    await teachAll(s, [...RIVER_DOMAIN_SENTENCES, ...RIVER_STATE_SENTENCES]);
    // Constraint pruning is visible one ply deep: only the goat may cross first.
    const legal = await s.turn("what moves are legal now?");
    assert.match(String(legal.answer), /^1 legal move from here:/);
    assert.match(String(legal.answer), /1\. ferry goat-1 onto bank-west/);
    await s.turn("the goal is that every passenger stands on bank-west.");
    const solve = await s.turn("solve it");
    assert.match(String(solve.answer), /^plan found — 7 moves \(shortest\):/);
    assert.match(String(solve.answer), /1\. ferry goat-1 onto bank-west/);
    for (let i = 1; i <= 6; i += 1) {
      const r = await s.turn("next");
      assert.match(String(r.answer), new RegExp(`^moved — .* \\(step ${i} of 7\\)`));
      assert.match(String(r.answer), new RegExp(`board@step${i}:`));
    }
    const final = await s.turn("next");
    assert.match(String(final.answer), /step 7 of 7/);
    assert.match(String(final.answer), /done — every passenger stands on bank-west \(checked against board@step7's written facts, not assumed\)\./);
    assert.equal(s.planState.done, true);
    // The co-travel effect wrote real rows: the farmer crossed with the goat
    // on step 1, without ever being the moved subject.
    const rows = readFactRows(await loadMemory(dir));
    const step1 = rows.filter((r) => r.subject.endsWith("@step1") && r.predicate === "mgx:stand-on");
    assert.equal(step1.find((r) => r.subject === "farmer-1@step1")?.object, "bank-west");
    assert.equal(step1.find((r) => r.subject === "goat-1@step1")?.object, "bank-west");
    assert.equal(step1.find((r) => r.subject === "wolf-1@step1")?.object, "bank-east");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("teach fixes: comparative objects store without trailing punctuation; bare taxonomy frames", async () => {
  const dir = await mkdtemp(join(tmpdir(), "plan-teach-"));
  try {
    const s = makeSession(dir);
    // Comparative trailing-period fix.
    await s.turn("disk-1 is smaller than disk-2.");
    let rows = readFactRows(await loadMemory(dir));
    const comp = rows.find((r) => r.predicate === "mgx:smaller-than");
    assert.equal(comp.object, "disk-2");
    // Hyphenated instance membership teaches bare.
    const inst = await s.turn("disk-1 is a disk.");
    assert.match(String(inst.answer), /^noted — remembered: disk-1 is a kind of disk/);
    // Article-led kind-of with a two-word object teaches bare.
    const kindOf = await s.turn("a disk is a kind of game piece.");
    assert.match(String(kindOf.answer), /^noted — remembered: disk is a kind of game piece/);
    // A plain-word bare copula stays out of the new frames (no hyphen, no
    // kind-of infix): whatever answers it, it is never these frames' teach.
    const plain = await s.turn("zork is a zork.");
    rows = readFactRows(await loadMemory(dir));
    assert.ok(!rows.some((r) => r.subject === "zork" && r.predicate === "rdfs:subClassOf"),
      `plain-word bare copula must not store via the taxonomy frames: ${String(plain.answer).split("\n")[0]}`);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
