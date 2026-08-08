// Every routed turn carries its ISO 24617-2 dialogue act on the record — a
// lookup over the lane the router already picked, never a classifier. The
// load-bearing row: the honest miss labels autoNegative in the autoFeedback
// dimension (tmct reporting its own processing failed), never a task answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runTurn } from "../../src/services/chat.mjs";

async function freshRepo() {
  return mkdtemp(join(tmpdir(), "tmct-dact-"));
}

const turn = (line, opts = {}) => runTurn(line, { config: null, env: {}, ...opts });

test("a teach declarative labels inform (task)", async () => {
  const dir = await freshRepo();
  try {
    const r = await turn("every dog is a mammal", { memoryDir: dir });
    assert.deepEqual(r.record.dialogueAct, { act: "inform", dimension: "task" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an answered wh-question labels setQuestion; an answered yes/no labels propositionalQuestion", async () => {
  const dir = await freshRepo();
  try {
    await turn("every dog is a mammal", { memoryDir: dir });
    const set = await turn("what is a dog", { memoryDir: dir });
    assert.equal(set.record.miss, false, "the taught fact answers");
    assert.deepEqual(set.record.dialogueAct, { act: "setQuestion", dimension: "task" });
    const propositional = await turn("is a dog a mammal", { memoryDir: dir });
    assert.equal(propositional.record.miss, false);
    assert.deepEqual(propositional.record.dialogueAct, { act: "propositionalQuestion", dimension: "task" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the honest miss labels autoNegative in the autoFeedback dimension, never a task act", async () => {
  const dir = await freshRepo();
  try {
    const r = await turn("what is a zorblatt", { memoryDir: dir });
    assert.equal(r.record.miss, true);
    assert.deepEqual(r.record.dialogueAct, { act: "autoNegative", dimension: "autoFeedback" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a grounded choice question labels choiceQuestion (task)", async () => {
  const dir = await freshRepo();
  try {
    await turn("every whale is a mammal", { memoryDir: dir });
    const r = await turn("is a whale a fish or a mammal", { memoryDir: dir });
    assert.equal(r.record.miss, false);
    assert.deepEqual(r.record.dialogueAct, { act: "choiceQuestion", dimension: "task" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a greeting labels initialGreeting (socialObligationsManagement)", async () => {
  const r = await turn("hi");
  assert.deepEqual(r.record.dialogueAct, { act: "initialGreeting", dimension: "socialObligationsManagement" });
});

test("game turns are task-dimension: the opening informs, a hint answers", async () => {
  const dir = await freshRepo();
  try {
    const opening = await turn("think of a number between 1 and 100", { memoryDir: dir, env: { TMCT_GAME_SECRET: "42" } });
    assert.deepEqual(opening.record.dialogueAct, { act: "inform", dimension: "task" });
    const hint = await turn("50", { memoryDir: dir, planState: opening.planState, last: opening.last });
    assert.match(hint.answer, /^lower/);
    assert.deepEqual(hint.record.dialogueAct, { act: "answer", dimension: "task" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a narrated turn prints the dialogue-act line in its trace block", async () => {
  const r = await runTurn("hi", { config: null, env: {}, narrate: true });
  assert.match(r.answer, /--- narrate ---/);
  assert.match(r.answer, /dialogue act: initialGreeting \(socialObligationsManagement dimension, ISO 24617-2\)/);
});
