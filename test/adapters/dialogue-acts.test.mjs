// The dialogue-act vocabulary is a closed, ISO-named table: every act carries
// one of the standard's ten dimensions, the lane lookup only points at acts
// the table holds, and the honest miss reads as feedback about tmct's own
// processing, never as a task answer.
import test from "node:test";
import assert from "node:assert/strict";
import {
  DIALOGUE_ACTS, DIALOGUE_ACT_DIMENSIONS, LANE_DIALOGUE_ACTS, dialogueActForLane,
} from "../../src/domain/dialogue-acts.mjs";

test("every act carries one of the ten ISO dimensions and a real gloss", () => {
  assert.equal(DIALOGUE_ACT_DIMENSIONS.length, 10, "the second edition has ten dimensions");
  const dimensions = new Set(DIALOGUE_ACT_DIMENSIONS);
  for (const [name, entry] of Object.entries(DIALOGUE_ACTS)) {
    assert.ok(dimensions.has(entry.dimension), `${name} names a real dimension, got "${entry.dimension}"`);
    assert.ok(entry.gloss && entry.gloss.length >= 20, `${name} has a non-trivial gloss`);
    assert.match(name, /^[a-z][a-zA-Z]*$/, `${name} is a camelCase data-category name`);
  }
});

test("the vocabulary is a closed set: frozen tables that reject growth at runtime", () => {
  assert.ok(Object.isFrozen(DIALOGUE_ACTS));
  assert.ok(Object.isFrozen(LANE_DIALOGUE_ACTS));
  assert.ok(Object.isFrozen(DIALOGUE_ACT_DIMENSIONS));
  for (const entry of Object.values(DIALOGUE_ACTS)) assert.ok(Object.isFrozen(entry));
  assert.throws(() => { DIALOGUE_ACTS.smalltalk = { dimension: "task", gloss: "x" }; }, TypeError);
  assert.throws(() => { LANE_DIALOGUE_ACTS.teach = "request"; }, TypeError);
});

test("the functions the lanes need are all present, question sub-types included", () => {
  for (const name of [
    "setQuestion", "propositionalQuestion", "checkQuestion", "choiceQuestion",
    "inform", "answer", "confirm", "disconfirm",
    "agreement", "disagreement", "correction",
    "request", "instruct", "suggestion", "offer",
    "autoPositive", "autoNegative",
    "initialGreeting", "returnGreeting", "thanking", "apology",
  ]) {
    assert.ok(Object.hasOwn(DIALOGUE_ACTS, name), `${name} is in the vocabulary`);
  }
});

test("every lane in the lookup maps to an act the vocabulary holds", () => {
  for (const [lane, act] of Object.entries(LANE_DIALOGUE_ACTS)) {
    assert.ok(Object.hasOwn(DIALOGUE_ACTS, act), `lane ${lane} points at a declared act, got "${act}"`);
  }
});

test("a miss is feedback about tmct's own processing, never a task answer", () => {
  assert.equal(LANE_DIALOGUE_ACTS["honest-miss"], "autoNegative");
  assert.equal(DIALOGUE_ACTS.autoNegative.dimension, "autoFeedback");
  assert.deepEqual(dialogueActForLane("honest-miss"), { act: "autoNegative", dimension: "autoFeedback" });
});

test("the lane resolver answers with act + dimension, and an uncovered lane is null, not a guess", () => {
  assert.deepEqual(dialogueActForLane("teach"), { act: "inform", dimension: "task" });
  assert.deepEqual(dialogueActForLane("ask-set"), { act: "setQuestion", dimension: "task" });
  assert.deepEqual(dialogueActForLane("greeting"), { act: "initialGreeting", dimension: "socialObligationsManagement" });
  assert.equal(dialogueActForLane("no-such-lane"), null);
  assert.equal(dialogueActForLane("constructor"), null, "an inherited object name is not a lane");
  assert.equal(dialogueActForLane(undefined), null);
});
