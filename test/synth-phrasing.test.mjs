// test/synth-phrasing.test.mjs — PLAN_CODE.md Track 1, Stage 0: the
// PHRASING_FRAMES warm-up synthesizer (synthbench/phrasing/synthesize.mjs).
// Proves the stage-0 exit bar (PLAN_CODE.md §6): synthesizing >=1 of the 6
// existing frame families byte-identically from its own hand-written
// examples, PLUS the cross-cutting requirement this whole track is built
// under (PLAN_CODE.md, operator directive): the synthesis process itself is
// deterministic — same input, same output, no randomness.

import { test } from "node:test";
import assert from "node:assert/strict";

import { synthesizeFrame, applyFrame } from "../synthbench/phrasing/synthesize.mjs";
import { FAMILIES } from "../synthbench/phrasing/examples.mjs";
import { applyPhrasingFrames } from "../src/interpret/normalize.mjs";

// ---- determinism -------------------------------------------------------------

test("synthesizeFrame: deterministic — same examples synthesize a byte-identical frame every time", () => {
  const a = synthesizeFrame(FAMILIES["members-of-class"]);
  const b = synthesizeFrame(FAMILIES["members-of-class"]);
  assert.equal(a.re.source, b.re.source, "same regex source");
  assert.equal(a.re.flags, b.re.flags, "same regex flags");
  assert.equal(a.template, b.template, "same recorded template");
  // the `to` closures themselves must behave identically, not just look alike
  for (const probe of ["what functions are in Foo", "what functions are in Bar"]) {
    const ma = probe.match(a.re);
    const mb = probe.match(b.re);
    assert.equal(a.to(ma), b.to(mb));
  }
});

test("synthesizeFrame: order-independent — shuffling the given examples changes nothing", () => {
  const forward = synthesizeFrame(FAMILIES["has-tests"]);
  const reversed = synthesizeFrame([...FAMILIES["has-tests"]].reverse());
  assert.equal(forward.re.source, reversed.re.source);
  assert.equal(forward.template, reversed.template);
});

// ---- honest-miss: refuses rather than guesses --------------------------------

test("synthesizeFrame: refuses (throws) rather than guess on underspecified input", () => {
  assert.throws(() => synthesizeFrame([{ from: "what functions are in Task", to: "what does Task contain" }]),
    /needs >=2/, "a single example has no varying span to generalize from");
  assert.throws(() => synthesizeFrame([
    { from: "what functions are in Task", to: "what does Task contain" },
    { from: "what functions are in Task", to: "what does Task contain" },
  ]), /varying object span/, "identical examples name no varying span");
});

// ---- stage-0 exit bar: reproduce a known-good frame family byte-identically --

test("stage 0 exit bar: members-of-class family reproduces normalize.mjs's real frame byte-identically", () => {
  const frame = synthesizeFrame(FAMILIES["members-of-class"]);
  // held-out probes — objects NOT in the training examples, still inside the
  // synthesized scaffold "what functions are in <obj>".
  for (const obj of ["Foo", "app/lib/a.mjs", "MyClass"]) {
    const probe = `what functions are in ${obj}`;
    const synthesized = applyFrame(probe, frame);
    const real = applyPhrasingFrames(probe);
    assert.equal(synthesized, real, `probe "${probe}"`);
    assert.equal(synthesized, `what does ${obj} contain`);
  }
});

test("stage 0 exit bar: where-defined family reproduces normalize.mjs's real frame byte-identically", () => {
  const frame = synthesizeFrame(FAMILIES["where-defined"]);
  for (const obj of ["Foo", "app/lib/a.mjs"]) {
    const probe = `what defined ${obj}`;
    assert.equal(applyFrame(probe, frame), applyPhrasingFrames(probe));
    assert.equal(applyFrame(probe, frame), `where is ${obj} defined`);
  }
});

test("stage 0 exit bar: has-tests family reproduces normalize.mjs's real frame byte-identically", () => {
  const frame = synthesizeFrame(FAMILIES["has-tests"]);
  for (const obj of ["Foo", "app/lib/a.mjs"]) {
    const probe = `is ${obj} tested`;
    assert.equal(applyFrame(probe, frame), applyPhrasingFrames(probe));
    assert.equal(applyFrame(probe, frame), `what tests ${obj}`);
  }
});

test("synthesizeFrame: an unmatched input passes through unchanged (honest miss, mirrors applyPhrasingFrames)", () => {
  const frame = synthesizeFrame(FAMILIES["members-of-class"]);
  assert.equal(applyFrame("who calls Widget.render", frame), "who calls Widget.render");
});
