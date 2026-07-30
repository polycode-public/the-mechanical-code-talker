// scene-compose: which real classes a free-typed sentence names, resolved
// through ask.mjs's own resolveObject rather than by matching class names here.
//
// The behaviour that matters is the pairing: the resolver's surface-form tiers
// are taken (casing, a leading article, a grain word), and its near-miss tiers
// are refused. Composing draws a picture with no citation beside it, so a
// sprite drawn from an edit-distance guess would be a claim the visitor can't
// audit — the tests below pin both halves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSceneItems, tokenizeSceneText } from "../../src/domain/scene-compose.mjs";

const indexOf = (...names) => Object.fromEntries(names.map((n) => [n, { materials: {} }]));
const named = (items) => items.map((i) => i.className);

test("a class named in plain lowercase resolves, one item per occurrence, in the order typed", () => {
  const index = indexOf("doctor", "hat", "cabinet");
  assert.deepEqual(named(extractSceneItems("a doctor with a hat, and a cabinet", index)), ["doctor", "hat", "cabinet"]);
});

test("the resolver's own surface handling carries the casing a visitor actually types", () => {
  const index = indexOf("doctor", "cat");
  assert.deepEqual(named(extractSceneItems("a Doctor and a Cat", index)), ["doctor", "cat"]);
  assert.deepEqual(named(extractSceneItems("DOCTOR", index)), ["doctor"]);
});

test("a near-miss word never draws a sprite, even when a real class is one letter away", () => {
  // The resolver's fuzzy tier reads "wood" as "food" and "glass" as "grass".
  // Right for a question answered in words and cited; wrong for a picture.
  const index = indexOf("food", "grass", "cabinet", "lamp");
  assert.deepEqual(named(extractSceneItems("a wood cabinet", index)), ["cabinet"]);
  assert.deepEqual(named(extractSceneItems("a glass lamp", index)), ["lamp"]);
  assert.deepEqual(named(extractSceneItems("three trees", indexOf("tree"))), [], "a plural is not an exact naming either");
});

test("a word that merely contains a real class name never draws that class", () => {
  const index = indexOf("book");
  assert.deepEqual(named(extractSceneItems("a bookcase", index)), []);
});

test("a multi-word class wins the position it starts at over a shorter class inside it", () => {
  const index = indexOf("water", "body of water");
  assert.deepEqual(named(extractSceneItems("a wide body of water stretched out", index)), ["body of water"]);
});

test("the shorter class still answers on its own when the longer one is not what was typed", () => {
  const index = indexOf("water", "body of water");
  assert.deepEqual(named(extractSceneItems("the water was calm", index)), ["water"]);
});

test("a sentence naming no real class draws nothing rather than reaching for the nearest label", () => {
  const index = indexOf("doctor", "hat", "cabinet", "lamp");
  assert.deepEqual(extractSceneItems("xyzzy plugh", index), []);
  assert.deepEqual(extractSceneItems("", index), []);
  assert.deepEqual(extractSceneItems(undefined, index), []);
  assert.deepEqual(extractSceneItems("a doctor", {}), [], "an empty index can never match");
});

test("a material word is kept only when it is one of its own class's real labels", () => {
  const index = {
    cabinet: { materials: { wood: true } },
    lamp: { materials: { glass: true } },
  };
  assert.deepEqual(extractSceneItems("wood cabinet", index), [{ className: "cabinet", materialLabel: "wood" }]);
  assert.deepEqual(extractSceneItems("wood lamp", index), [{ className: "lamp", materialLabel: null }],
    "a material real for one class never leaks onto another");
  assert.deepEqual(extractSceneItems("red lamp", index), [{ className: "lamp", materialLabel: null }],
    "an unrecognized modifier is dropped, never invented into a match");
});

test("a class is repeated once per real occurrence rather than collapsed", () => {
  assert.deepEqual(named(extractSceneItems("a cat, then another cat", indexOf("cat"))), ["cat", "cat"]);
});

test("tokenizing splits on punctuation without fusing or splitting a real word", () => {
  assert.deepEqual(tokenizeSceneText("a doctor, a hat.").map((t) => t.word), ["a", "doctor", "a", "hat"]);
  assert.deepEqual(tokenizeSceneText(null), []);
});
