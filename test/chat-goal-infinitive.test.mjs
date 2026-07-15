// The plan lane's goal sentence accepts its infinitive-complement voicings —
// "the goal is for every disk to rest on peg-b", "i want every disk to rest
// on peg-b" — restating the that-form in the confirmation, and a goal turn
// never carries a canonical built from a fuzzy-repaired parse.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../src/chat.mjs";
import { clearCache } from "../src/source.mjs";

const CONFIG = {};

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

async function withDomainSession(tag, run) {
  const dir = await mkdtemp(join(tmpdir(), `tmct-goal-${tag}-`));
  try {
    const s = makeSession(dir);
    for (const line of DOMAIN) await s.turn(line);
    await run(s);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
}

test("'the goal is for every disk to rest on peg-b' registers the goal and solves", async () => {
  await withDomainSession("forto", async (s) => {
    const goal = await s.turn("the goal is for every disk to rest on peg-b.");
    assert.match(goal.answer, /^noted — the goal is that every disk rests on peg-b/);
    const solved = await s.turn("solve it");
    assert.match(solved.answer, /plan found — 1 move/);
  });
});

test("'i want every disk to rest on peg-b' registers the same goal", async () => {
  await withDomainSession("want", async (s) => {
    const goal = await s.turn("i want every disk to rest on peg-b.");
    assert.match(goal.answer, /^noted — the goal is that every disk rests on peg-b/);
    assert.doesNotMatch(goal.answer, /pronouns aren't things I can classify/);
    const solved = await s.turn("solve it");
    assert.match(solved.answer, /plan found — 1 move/);
  });
});

test("a goal turn carries no canonical from the fuzzy-repaired structural parse", async () => {
  await withDomainSession("canon", async (s) => {
    const goal = await s.turn("the goal is that every disk rests on peg-b.");
    assert.match(goal.answer, /^noted — the goal is that every disk rests on peg-b/);
    assert.doesNotMatch(goal.answer, /Canonical:/);
    assert.equal(goal.record.canonical ?? null, null);
  });
});

test("the verbless want form declines without recording a goal", async () => {
  await withDomainSession("verbless", async (s) => {
    await s.turn("i want every disk on peg-b.");
    const solved = await s.turn("solve it");
    assert.match(solved.answer, /no goal set yet/);
  });
});
