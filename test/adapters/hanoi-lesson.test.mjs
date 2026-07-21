// hanoi-lesson.mjs: the pure taught-sentence generator behind the live
// plan-browser session's disk-count control — every sentence must be the
// exact granularity `tmct import --file` teaches data/games/hanoi-3.txt at
// (one fact per array entry), and must generalize cleanly to any disk count.
import { test } from "node:test";
import assert from "node:assert/strict";

import { hanoiLessonSentences } from "../../src/domain/hanoi-lesson.mjs";

test("hanoiLessonSentences(3) reproduces data/games/hanoi-3.txt's taught content plus the puzzle's own disk/peg inventory, one fact per sentence", () => {
  const sentences = hanoiLessonSentences(3);
  assert.deepEqual(sentences, [
    "a disk is a kind of game piece.",
    "a peg is a kind of place.",
    "disk-1 is a disk.",
    "disk-2 is a disk.",
    "disk-3 is a disk.",
    "peg-a is a peg.",
    "peg-b is a peg.",
    "peg-c is a peg.",
    "puzzle has 3 disks.",
    "puzzle has 3 pegs.",
    "disk-1 is smaller than disk-2.",
    "disk-1 is smaller than disk-3.",
    "disk-2 is smaller than disk-3.",
    "you can move a disk onto a peg.",
    "you can move a disk onto a disk.",
    "to move a disk onto a target, nothing may rest on the disk.",
    "to move a disk onto a target, nothing may rest on the target.",
    "to move a disk onto a disk, the disk must be smaller than the target.",
    "moving a disk onto a target makes the disk rest on the target.",
    "a disk renders as a block.",
    "a peg renders as a slot.",
    "disk-1 rests on disk-2.",
    "disk-2 rests on disk-3.",
    "disk-3 rests on peg-a.",
    "the goal is that every disk rests on peg-c.",
    "solve it.",
  ]);
});

test("hanoiLessonSentences: the puzzle-inventory disk fact tracks the disk count and singularizes at one disk", () => {
  assert.ok(hanoiLessonSentences(5).includes("puzzle has 5 disks."));
  assert.ok(hanoiLessonSentences(1).includes("puzzle has 1 disk."));
  assert.ok(hanoiLessonSentences(1).includes("puzzle has 3 pegs."), "the peg count never varies");
});

test("hanoiLessonSentences: every entry is a single sentence ending in one terminator", () => {
  for (const sentence of hanoiLessonSentences(4)) {
    assert.match(sentence, /^[^.]*\.$/, `"${sentence}" is not exactly one sentence`);
  }
});

test("hanoiLessonSentences: teaches EVERY smaller-than pair, not just adjacent ones", () => {
  const sentences = hanoiLessonSentences(4);
  const pairs = sentences.filter((s) => /is smaller than/.test(s));
  // C(4,2) = 6 pairs for 4 disks.
  assert.equal(pairs.length, 6);
  assert.ok(pairs.includes("disk-1 is smaller than disk-4."), "non-adjacent pair (1,4) is taught");
  assert.ok(pairs.includes("disk-2 is smaller than disk-4."), "non-adjacent pair (2,4) is taught");
});

test("hanoiLessonSentences: the starting stack is largest-at-the-bottom on peg-a, for any disk count", () => {
  const sentences = hanoiLessonSentences(5);
  assert.ok(sentences.includes("disk-1 rests on disk-2."));
  assert.ok(sentences.includes("disk-4 rests on disk-5."));
  assert.ok(sentences.includes("disk-5 rests on peg-a."));
  assert.ok(!sentences.some((s) => /disk-5 rests on disk/.test(s)), "the largest disk never rests on another disk");
});

test("hanoiLessonSentences: a single disk needs no pairwise ordering facts and a trivial one-move stack", () => {
  const sentences = hanoiLessonSentences(1);
  assert.ok(!sentences.some((s) => /^disk-\d+ is smaller than disk-\d+\.$/.test(s)));
  assert.ok(sentences.includes("disk-1 rests on peg-a."));
  assert.ok(!sentences.some((s) => /disk-1 rests on disk/.test(s)));
});

test("hanoiLessonSentences: diskCount is floored and clamped to at least 1, never NaN leaking through", () => {
  for (const n of [0, -3, 1.9, NaN]) {
    const sentences = hanoiLessonSentences(n);
    assert.ok(sentences.every((s) => !/undefined|NaN/.test(s)), `diskCount=${n} leaked a placeholder`);
    assert.ok(sentences.includes("disk-1 rests on peg-a."), `diskCount=${n} still produces a 1-disk puzzle`);
  }
});

test("hanoiLessonSentences: an omitted diskCount falls back to the default 3-disk puzzle", () => {
  assert.deepEqual(hanoiLessonSentences(undefined), hanoiLessonSentences(3));
  assert.deepEqual(hanoiLessonSentences(), hanoiLessonSentences(3));
});

test("hanoiLessonSentences: goalPeg overrides the taught goal, everything else unchanged", () => {
  const sentences = hanoiLessonSentences(3, { goalPeg: "peg-b" });
  assert.ok(sentences.includes("the goal is that every disk rests on peg-b."));
  assert.ok(!sentences.includes("the goal is that every disk rests on peg-c."));
});

test("hanoiLessonSentences: teaching and solving always come last, in that order", () => {
  const sentences = hanoiLessonSentences(3);
  assert.equal(sentences.at(-1), "solve it.");
  assert.match(sentences.at(-2), /^the goal is that/);
});
