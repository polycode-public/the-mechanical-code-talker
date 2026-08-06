// scripts/claims/planner-domains.mjs: the blocksworld and gripper rule-set
// generators claim-planner.mjs scales, and the shared solvePlannerInstance
// entry point every caller (this rig, a later browser button) drives
// through. Mirrors test/adapters/hanoi-lesson.test.mjs's own checks against
// data/games/hanoi-3.txt: the generator's rule-only sentences must reproduce
// the committed rule file's taught content exactly, and a small instance
// must actually teach and solve, not just look well-formed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  blocksworldRuleSentences, blocksworldInstanceSentences,
  gripperRuleSentences, gripperInstanceSentences,
  solvePlannerInstance,
} from "../../scripts/claims/planner-domains.mjs";
import { splitSentencesPreservingPaths } from "../../src/services/sentences.mjs";

const BLOCKSWORLD_RULES_PATH = fileURLToPath(new URL("../../test-benchmarks/claims/blocksworld-rules.txt", import.meta.url));
const GRIPPER_RULES_PATH = fileURLToPath(new URL("../../test-benchmarks/claims/gripper-rules.txt", import.meta.url));

/** The sentences `tmct import --file` would actually teach from a rule
 *  file: strip `#` comment lines, then split the remaining body the same
 *  way src/services/import-file.mjs does. */
function taughtSentencesOf(path) {
  const body = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n");
  return splitSentencesPreservingPaths(body);
}

test("blocksworldRuleSentences(3) reproduces test-benchmarks/claims/blocksworld-rules.txt's taught content", () => {
  assert.deepEqual(blocksworldRuleSentences(3), taughtSentencesOf(BLOCKSWORLD_RULES_PATH));
});

test("gripperRuleSentences(3) reproduces test-benchmarks/claims/gripper-rules.txt's taught content", () => {
  assert.deepEqual(gripperRuleSentences(3), taughtSentencesOf(GRIPPER_RULES_PATH));
});

test("blocksworldInstanceSentences: a stack starts on spot-a and the goal targets spot-c, teaching and solving last", () => {
  const sentences = blocksworldInstanceSentences(4);
  assert.ok(sentences.includes("block-1 rests on block-2."));
  assert.ok(sentences.includes("block-3 rests on block-4."));
  assert.ok(sentences.includes("block-4 rests on spot-a."));
  assert.equal(sentences.at(-1), "solve it.");
  assert.equal(sentences.at(-2), "the goal is that every block rests on spot-c.");
});

test("gripperInstanceSentences: every ball starts in room-a and the goal targets room-c, teaching and solving last", () => {
  const sentences = gripperInstanceSentences(4);
  for (const ball of ["ball-1", "ball-2", "ball-3", "ball-4"]) {
    assert.ok(sentences.includes(`${ball} rests inside room-a.`));
  }
  assert.equal(sentences.at(-1), "solve it.");
  assert.equal(sentences.at(-2), "the goal is that every ball rests inside room-c.");
});

test("blocksworldInstanceSentences: every entry is a single sentence ending in one terminator, for any block count", () => {
  for (const sentence of blocksworldInstanceSentences(5)) {
    assert.match(sentence, /^[^.]*\.$/, `"${sentence}" is not exactly one sentence`);
  }
});

test("gripperInstanceSentences: every entry is a single sentence ending in one terminator, for any ball count", () => {
  for (const sentence of gripperInstanceSentences(5)) {
    assert.match(sentence, /^[^.]*\.$/, `"${sentence}" is not exactly one sentence`);
  }
});

test("solvePlannerInstance teaches and solves a 3-block blocksworld instance with no declined sentence", async () => {
  const result = await solvePlannerInstance("blocksworld", 3);
  assert.equal(result.declined, null, JSON.stringify(result.declined));
  assert.equal(result.solved, true);
  assert.equal(result.moves, 3);
});

test("solvePlannerInstance teaches and solves a 3-ball gripper instance with no declined sentence", async () => {
  const result = await solvePlannerInstance("gripper", 3);
  assert.equal(result.declined, null, JSON.stringify(result.declined));
  assert.equal(result.solved, true);
  assert.equal(result.moves, 3);
});

test("solvePlannerInstance reaches hanoi's own shipped lesson through the same registry", async () => {
  const result = await solvePlannerInstance("hanoi", 3);
  assert.equal(result.declined, null, JSON.stringify(result.declined));
  assert.equal(result.solved, true);
  assert.equal(result.moves, 7);
});

test("solvePlannerInstance rejects an unknown domain name rather than silently returning nothing", async () => {
  await assert.rejects(() => solvePlannerInstance("nonexistent-domain", 3), /unknown domain/);
});
