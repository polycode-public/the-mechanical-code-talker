// viz-ticker: the shared play/pause/step/reset primitive extracted from
// plan-viz.mjs's own inlined ticker script (PLAN_SPIDER_FLY.md §11).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTicker } from "../../src/services/viz-ticker.mjs";

const instantWait = () => Promise.resolve();

test("stepOnce runs onTick exactly once and renders animating true then false around it", async () => {
  const renders = [];
  let ticks = 0;
  const ticker = createTicker({
    onTick: async () => { ticks += 1; },
    onRender: (s) => renders.push(s),
    wait: instantWait,
  });
  const advanced = await ticker.stepOnce();
  assert.equal(advanced, true);
  assert.equal(ticks, 1);
  assert.deepEqual(renders, [{ playing: false, animating: true }, { playing: false, animating: false }]);
});

test("stepOnce is a no-op once hasNext() is false, and reports it did not advance", async () => {
  let ticks = 0;
  const ticker = createTicker({ onTick: async () => { ticks += 1; }, hasNext: () => false, wait: instantWait });
  const advanced = await ticker.stepOnce();
  assert.equal(advanced, false);
  assert.equal(ticks, 0);
});

test("play() advances until hasNext() turns false, pacing each step through the injected wait", async () => {
  let count = 0;
  const waits = [];
  const ticker = createTicker({
    onTick: async () => { count += 1; },
    hasNext: () => count < 3,
    waitMs: 50,
    wait: (ms) => { waits.push(ms); return Promise.resolve(); },
  });
  await ticker.play();
  assert.equal(count, 3, "stopped exactly when hasNext() turned false");
  assert.deepEqual(waits, [50, 50], "paced between steps, but not after the final one");
  assert.equal(ticker.getState().playing, false, "play() leaves the ticker paused once it runs out of steps");
});

test("play() then play() again pauses mid-run rather than restarting", async () => {
  let count = 0;
  let resumeTick;
  const tickGate = new Promise((resolve) => { resumeTick = resolve; });
  const ticker = createTicker({
    onTick: async () => {
      count += 1;
      if (count === 1) await tickGate; // hold the first tick open so play() can race pause
    },
    hasNext: () => count < 5,
    wait: instantWait,
  });
  const playPromise = ticker.play();
  // The ticker is mid-first-tick (animating) — a second play() call while
  // animating must be a no-op, never a second concurrent loop.
  await ticker.play();
  assert.equal(ticker.getState().animating, true);
  resumeTick();
  await playPromise;
  assert.equal(count, 5, "only one play loop ran to completion");
});

test("pause() during play() stops the loop without finishing every step", async () => {
  let count = 0;
  const ticker = createTicker({
    onTick: async () => {
      count += 1;
      if (count === 2) ticker.pause();
    },
    hasNext: () => count < 10,
    wait: instantWait,
  });
  await ticker.play();
  assert.equal(count, 2, "pause() called from inside the second tick stops after it, never running a third");
  assert.equal(ticker.getState().playing, false);
});

test("reset() is a no-op while a step is still animating, and runs the caller's onReset once it finishes", async () => {
  let resumeTick;
  const gate = new Promise((resolve) => { resumeTick = resolve; });
  let resets = 0;
  const ticker = createTicker({
    onTick: async () => { await gate; },
    onReset: async () => { resets += 1; },
    wait: instantWait,
  });
  const stepPromise = ticker.stepOnce();
  await ticker.reset();
  assert.equal(resets, 0, "reset() declined while animating");
  resumeTick();
  await stepPromise;
  await ticker.reset();
  assert.equal(resets, 1, "reset() runs once the tick has finished");
});

test("getState returns a fresh snapshot each call, never a live reference a caller could mutate", () => {
  const ticker = createTicker({ onTick: async () => {}, wait: instantWait });
  const a = ticker.getState();
  a.playing = true;
  assert.equal(ticker.getState().playing, false, "mutating a returned snapshot never touches the ticker's own state");
});
