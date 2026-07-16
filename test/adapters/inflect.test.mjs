import test from "node:test";
import assert from "node:assert/strict";

import {
  doublesFinalConsonant, pluralOf, pastOf, gerundOf, inflectionsOf, collisionsFrom,
} from "../../src/domain/inflect.mjs";

test("the regular verb takes -s, -ed and -ing with no spelling change", () => {
  assert.equal(pluralOf("walk"), "walks");
  assert.equal(pastOf("walk"), "walked");
  assert.equal(gerundOf("walk"), "walking");
});

test("a single final consonant after a single vowel doubles", () => {
  assert.equal(gerundOf("run"), "running");
  assert.equal(pastOf("stop"), "stopped");
  assert.equal(gerundOf("stop"), "stopping");
});

test("w, x and y never double", () => {
  assert.equal(gerundOf("box"), "boxing");
  assert.equal(gerundOf("draw"), "drawing");
  assert.equal(gerundOf("play"), "playing");
});

test("a consonant after two vowels does not double", () => {
  assert.equal(gerundOf("read"), "reading");
  assert.equal(pastOf("rain"), "rained");
});

test("a consonant after another consonant does not double", () => {
  assert.equal(gerundOf("test"), "testing");
  assert.equal(pastOf("rest"), "rested");
});

test("doublesFinalConsonant declines a word too short to have a preceding consonant", () => {
  assert.equal(doublesFinalConsonant("go"), false);
  assert.equal(doublesFinalConsonant("at"), false);
});

test("silent e drops before -ing and takes a bare -d for the past", () => {
  assert.equal(gerundOf("make"), "making");
  assert.equal(gerundOf("like"), "liking");
  assert.equal(pastOf("like"), "liked");
});

test("ee, oe and ye keep their e before -ing", () => {
  assert.equal(gerundOf("see"), "seeing");
  assert.equal(gerundOf("hoe"), "hoeing");
  assert.equal(gerundOf("dye"), "dyeing");
});

test("consonant + y becomes -ies and -ied", () => {
  assert.equal(pluralOf("carry"), "carries");
  assert.equal(pastOf("carry"), "carried");
  assert.equal(gerundOf("carry"), "carrying");
});

test("vowel + y keeps the y", () => {
  assert.equal(pluralOf("play"), "plays");
  assert.equal(pastOf("play"), "played");
});

test("a sibilant ending takes -es", () => {
  assert.equal(pluralOf("box"), "boxes");
  assert.equal(pluralOf("church"), "churches");
  assert.equal(pluralOf("pass"), "passes");
  assert.equal(pluralOf("wash"), "washes");
  assert.equal(pluralOf("buzz"), "buzzes");
});

test("ie becomes y before -ing", () => {
  assert.equal(gerundOf("lie"), "lying");
  assert.equal(gerundOf("die"), "dying");
});

// The rules are deliberately regular-only: the table's job is to name real
// English words the repair tier must not rewrite, and a form that is not real
// English costs at most one repair declined. An irregular table would buy
// nothing the collision check can use, so these approximations are the design.
test("the past of an irregular verb takes the regular ending — the rules model no irregulars", () => {
  assert.equal(pastOf("run"), "runned");
  assert.equal(pastOf("make"), "maked");
  assert.equal(pastOf("lie"), "lied");
});

test("doubling ignores stress, so a second syllable doubles too", () => {
  assert.equal(pastOf("visit"), "visitted");
  assert.equal(gerundOf("open"), "openning");
});

test("inflectionsOf returns the lemma with its three regular forms", () => {
  assert.deepEqual(inflectionsOf("rest"), ["rest", "rests", "rested", "resting"]);
});

test("collisionsFrom keeps a real word one edit from a repair target", () => {
  assert.deepEqual(collisionsFrom(["rests"]), ["rests"]);
});

test("collisionsFrom drops a repair target itself — a target is not a collision", () => {
  assert.deepEqual(collisionsFrom(["import", "rests"]), ["rests"]);
});

test("collisionsFrom drops a word no repair target attracts", () => {
  assert.deepEqual(collisionsFrom(["marmalade"]), []);
});

test("collisionsFrom sorts, so the generated table is reproducible", () => {
  const sorted = collisionsFrom(["tests", "rests", "nests"]);
  assert.deepEqual(sorted, [...sorted].sort());
});
