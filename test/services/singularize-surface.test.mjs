// singularizeSurface — the naive, no-NLP plural/3sg fold shared across ~17 chat
// lanes (habitual-capability, quantified-has, teach). The hard part is the "-ses"
// ending: a base already ending in silent "-e" just adds "-s" (collapse ->
// collapses), while a bare sibilant "-s" base adds "-es" (bus -> buses), and the
// two collide in spelling. These cases pin both arms.
import { test } from "node:test";
import assert from "node:assert/strict";

import { singularizeSurface } from "../../src/services/chat.mjs";

test("singularizeSurface: '-se' bases strip one letter, keeping the silent e", () => {
  // The motivating case: "it collapses" must fold to the verb "collapse", not
  // the mangled "collaps".
  assert.equal(singularizeSurface("collapses"), "collapse");
  assert.equal(singularizeSurface("causes"), "cause");
  assert.equal(singularizeSurface("roses"), "rose");
  assert.equal(singularizeSurface("uses"), "use");
  assert.equal(singularizeSurface("pauses"), "pause");
  assert.equal(singularizeSurface("responses"), "response");
  assert.equal(singularizeSurface("phrases"), "phrase");
});

test("singularizeSurface: bare-sibilant '-s' bases strip the whole '-es'", () => {
  assert.equal(singularizeSurface("buses"), "bus");
  assert.equal(singularizeSurface("gases"), "gas");
  assert.equal(singularizeSurface("lenses"), "lens");
  assert.equal(singularizeSurface("viruses"), "virus");
  assert.equal(singularizeSurface("biases"), "bias");
});

test("singularizeSurface: doubled '-ss' bases keep both s (no exception list needed)", () => {
  assert.equal(singularizeSurface("classes"), "class");
  assert.equal(singularizeSurface("glasses"), "glass");
  assert.equal(singularizeSurface("bosses"), "boss");
  assert.equal(singularizeSurface("kisses"), "kiss");
  assert.equal(singularizeSurface("masses"), "mass");
});

test("singularizeSurface: the other '-es' endings still strip two letters", () => {
  assert.equal(singularizeSurface("boxes"), "box");
  assert.equal(singularizeSurface("foxes"), "fox");
  assert.equal(singularizeSurface("witches"), "witch");
  assert.equal(singularizeSurface("wishes"), "wish");
  assert.equal(singularizeSurface("dishes"), "dish");
});

test("singularizeSurface: '-ies' folds to '-y', plain '-s' drops one", () => {
  assert.equal(singularizeSurface("puppies"), "puppy");
  assert.equal(singularizeSurface("berries"), "berry");
  assert.equal(singularizeSurface("dogs"), "dog");
  assert.equal(singularizeSurface("cats"), "cat");
});

test("singularizeSurface: leaves non-plural surfaces alone", () => {
  // A doubled-consonant "ss" tail and an "-ous" adjective are never plural
  // markers, and an already-singular word is returned untouched.
  assert.equal(singularizeSurface("class"), "class");
  assert.equal(singularizeSurface("venomous"), "venomous");
  assert.equal(singularizeSurface("dog"), "dog");
  assert.equal(singularizeSurface(""), "");
  // Surrounding whitespace is trimmed before the fold runs.
  assert.equal(singularizeSurface("  dogs  "), "dog");
});
