// sprite-animation: the pure tick-driven machinery behind the sprite tiles'
// hover flip, the focused cell's two animation modes, and the oscillate-and-
// turn walk a moving scene entity performs. Everything is a pure function of
// its arguments, so each behaviour pins exactly.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isMovingSwatchLabel, movingCounterpartLabel, nextFocusMode, FOCUS_MODE_ORDER,
  frameAtTick, focusModeFrames, oscillateWalkStep, walkFrameLabelCandidates,
  SPRITE_POSE_REST, SPRITE_POSE_MOVING,
} from "../../src/domain/sprite-animation.mjs";

test("a moving frame's label is recognized whether bare or combined with a facing", () => {
  assert.equal(isMovingSwatchLabel("moving"), true);
  assert.equal(isMovingSwatchLabel("left + moving"), true);
  assert.equal(isMovingSwatchLabel("half-left + moving"), true);
  assert.equal(isMovingSwatchLabel("left"), false);
  assert.equal(isMovingSwatchLabel("happy"), false);
  assert.equal(isMovingSwatchLabel(null), false);
});

test("a resting tile names the moving frame it flips against: default against bare moving, a facing against its combined frame", () => {
  assert.equal(movingCounterpartLabel("default"), "moving");
  assert.equal(movingCounterpartLabel("plain"), "moving");
  assert.equal(movingCounterpartLabel(null), "moving");
  assert.equal(movingCounterpartLabel("left"), "left + moving");
  assert.equal(movingCounterpartLabel("half-right"), "half-right + moving");
});

test("a click toggles the focused cell between its two modes and back", () => {
  assert.deepEqual([...FOCUS_MODE_ORDER], ["turning", "emotions"]);
  assert.equal(nextFocusMode("turning"), "emotions");
  assert.equal(nextFocusMode("emotions"), "turning");
  assert.equal(nextFocusMode(undefined), "turning", "an unknown mode lands back on the default");
});

test("frameAtTick loops through the frames and returns null with nothing to show", () => {
  const frames = ["a", "b", "c"];
  assert.equal(frameAtTick(frames, 0), "a");
  assert.equal(frameAtTick(frames, 4), "b");
  assert.equal(frameAtTick(frames, 300), "a");
  assert.equal(frameAtTick(frames, -1), "c", "a negative tick still lands inside the list");
  assert.equal(frameAtTick([], 5), null);
  assert.equal(frameAtTick(null, 5), null);
});

test("the focused cell animates the asked-for axis, falls back to an axis with real art, and animates nothing with one frame everywhere", () => {
  const turn = ["l", "c", "r"];
  const moods = ["happy", "sad"];
  const moving = ["idle", "stride"];
  assert.deepEqual(focusModeFrames("turning", { turnFrames: turn, moodFrames: moods, movingFrames: moving }), turn);
  assert.deepEqual(focusModeFrames("emotions", { turnFrames: turn, moodFrames: moods, movingFrames: moving }), moods);
  assert.deepEqual(focusModeFrames("turning", { turnFrames: [], moodFrames: moods, movingFrames: moving }), moving,
    "no turntable art falls back to the pose flip before the moods");
  assert.deepEqual(focusModeFrames("emotions", { turnFrames: turn, moodFrames: [] }), turn);
  assert.deepEqual(focusModeFrames("turning", { turnFrames: ["only"], moodFrames: ["one"] }), [],
    "one frame is not an animation on any axis");
});

test("the walk crosses one way alternating static and moving, turns through the half facings at the end, and comes back", () => {
  const steps = [];
  for (let t = 0; t < 18; t += 1) steps.push(oscillateWalkStep(t, { legTicks: 6 }));
  const facings = steps.map((s) => s.facing);
  assert.deepEqual(facings.slice(0, 6), ["right", "right", "right", "right", "right", "right"]);
  assert.deepEqual(facings.slice(6, 9), ["half-right", null, "half-left"], "the right-end turn walks the half facings through the front");
  assert.deepEqual(facings.slice(9, 15), ["left", "left", "left", "left", "left", "left"]);
  assert.deepEqual(facings.slice(15, 18), ["half-left", null, "half-right"], "the left-end turn mirrors it");
  assert.deepEqual(steps.slice(0, 4).map((s) => s.pose), ["moving", "static", "moving", "static"], "walking alternates the two poses");
  assert.ok(steps.slice(6, 9).every((s) => s.pose === "static"), "turning happens standing still");
});

test("the walk's offset swings half a sprite width each side of centre and is periodic", () => {
  const offsets = [];
  for (let t = 0; t < 18; t += 1) offsets.push(oscillateWalkStep(t, { legTicks: 6 }).offsetFraction);
  assert.ok(Math.max(...offsets) === 0.5 && Math.min(...offsets) === -0.5, "the swing reaches exactly half a width each way");
  for (let i = 1; i < 6; i += 1) assert.ok(offsets[i] > offsets[i - 1], "walking right moves right every step");
  for (let i = 10; i < 15; i += 1) assert.ok(offsets[i] < offsets[i - 1], "walking left moves left every step");
  assert.deepEqual(oscillateWalkStep(18, { legTicks: 6 }), oscillateWalkStep(0, { legTicks: 6 }), "the cycle wraps");
  assert.deepEqual(oscillateWalkStep(-1, { legTicks: 6 }), oscillateWalkStep(17, { legTicks: 6 }), "a negative tick reads the same cycle");
});

test("a walk step names its frame candidates most specific first, ending on the material tile", () => {
  assert.deepEqual(
    walkFrameLabelCandidates({ facing: "left", pose: "moving", material: "black" }),
    ["left + moving", "left", "moving", "black"],
  );
  assert.deepEqual(walkFrameLabelCandidates({ facing: "half-right", pose: "static" }), ["half-right"]);
  assert.deepEqual(walkFrameLabelCandidates({ pose: "moving" }), ["moving"]);
  assert.deepEqual(walkFrameLabelCandidates({}), []);
});

test("the pose words are the two the tiles print", () => {
  assert.equal(SPRITE_POSE_REST, "static");
  assert.equal(SPRITE_POSE_MOVING, "moving");
});
