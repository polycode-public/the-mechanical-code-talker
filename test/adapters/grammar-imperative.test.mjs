// The imperative command pattern: a subjectless action command parsed
// against a closed verb set into a structured (non-triple) command. Pure
// parser tests — no chat wiring, no memory writes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseImperative } from "../../src/domain/grammar/ace.mjs";
import { loadLexicon } from "../../src/domain/grammar/lexicon.mjs";

const lexicon = loadLexicon();
const parse = (s) => parseImperative(s, lexicon);

test("go takes exactly one closed-set direction", () => {
  assert.deepEqual(parse("go north"), { pattern: "imperative", verb: "go", direction: "north", residue: [] });
  assert.deepEqual(parse("go down"), { pattern: "imperative", verb: "go", direction: "down", residue: [] });
  assert.equal(parse("go sideways"), null, "an unlisted direction is a hard null, never a guess");
  assert.equal(parse("go"), null);
  assert.equal(parse("go on"), null, "the plan lane's own continuation word is not a direction");
});

test("a bare transitive command resolves its object through the lexicon-noun gate", () => {
  assert.deepEqual(parse("take the key"), { pattern: "imperative", verb: "take", object: "key", residue: [] });
  assert.deepEqual(parse("take key"), { pattern: "imperative", verb: "take", object: "key", residue: [] });
  assert.deepEqual(parse("drop the lamp"), { pattern: "imperative", verb: "drop", object: "lamp", residue: [] });
  assert.deepEqual(parse("open the portrait."), { pattern: "imperative", verb: "open", object: "portrait", residue: [] });
  assert.deepEqual(parse("close the cabinet"), { pattern: "imperative", verb: "close", object: "cabinet", residue: [] });
});

test("look stands alone (optionally 'around') and anything longer is not this pattern", () => {
  assert.deepEqual(parse("look"), { pattern: "imperative", verb: "look", residue: [] });
  assert.deepEqual(parse("look around"), { pattern: "imperative", verb: "look", residue: [] });
  assert.equal(parse("look at the portrait"), null);
});

test("unlock carries its instrument through 'with', and works bare when the instrument is omitted", () => {
  assert.deepEqual(parse("unlock the cabinet with the key"), {
    pattern: "imperative", verb: "unlock", object: "cabinet", instrument: "key", residue: [],
  });
  assert.deepEqual(parse("unlock the cabinet"), { pattern: "imperative", verb: "unlock", object: "cabinet", residue: [] });
});

test("give carries its receiver through 'to'", () => {
  assert.deepEqual(parse("give the letter to the housekeeper"), {
    pattern: "imperative", verb: "give", object: "letter", indirectObject: "housekeeper", residue: [],
  });
  assert.equal(parse("give the letter"), null, "a give with no receiver is not the pattern");
});

test("an undeclared word in a structurally valid command rides out as residue, named", () => {
  const miss = parse("take the blunderbuss");
  assert.equal(miss.pattern, "imperative");
  assert.equal(miss.verb, "take");
  assert.deepEqual(miss.residue, ["blunderbuss"]);
  assert.equal(miss.object, undefined, "a residue miss binds no slots");
});

test("a sentence led by anything outside the closed verb set is a hard null", () => {
  assert.equal(parse("walk north"), null);
  assert.equal(parse("examine the cabinet"), null);
  assert.equal(parse("the butler opens the cabinet"), null, "a subjectful declarative is not an imperative");
  assert.equal(parse(""), null);
});
