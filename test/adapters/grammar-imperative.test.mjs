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

test("look stands alone or takes a bare object; 'look at X' is the examine synonym", () => {
  assert.deepEqual(parse("look"), { pattern: "imperative", verb: "look", residue: [] });
  assert.deepEqual(parse("look around"), { pattern: "imperative", verb: "look", residue: [] });
  assert.deepEqual(parse("look at the portrait"), { pattern: "imperative", verb: "examine", object: "portrait", residue: [] });
  assert.deepEqual(parse("look the portrait"), { pattern: "imperative", verb: "look", object: "portrait", residue: [] },
    "a bare 'look OBJECT' now carries its object — the close-look surface, routed through the shared object handler");
  assert.deepEqual(parse("look housekeeper"), { pattern: "imperative", verb: "look", object: "housekeeper", residue: [] });
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

test("a sentence led by anything outside the closed verb set (or its synonyms/typo repairs) is a hard null", () => {
  assert.equal(parse("walk north"), null, "'walk' reads as real English, not a typo of 'talk' — never silently reinterpreted");
  assert.equal(parse("the butler opens the cabinet"), null, "a subjectful declarative is not an imperative");
  assert.equal(parse(""), null);
});

test("examine and talk each take a single bare object, no direction or instrument", () => {
  assert.deepEqual(parse("examine the cabinet"), { pattern: "imperative", verb: "examine", object: "cabinet", residue: [] });
  assert.deepEqual(parse("talk butler"), { pattern: "imperative", verb: "talk", object: "butler", residue: [] });
  assert.equal(parse("examine"), null, "examine with no object is not the pattern");
  assert.equal(parse("talk"), null, "talk with no object is not the pattern");
});

test("VERB_SYNONYMS normalizes an alternate phrasing onto its canonical verb, silently (no 'corrected' field)", () => {
  assert.deepEqual(parse("pick up the lamp"), { pattern: "imperative", verb: "take", object: "lamp", residue: [] });
  assert.deepEqual(parse("pick the lamp"), { pattern: "imperative", verb: "take", object: "lamp", residue: [] });
  assert.deepEqual(parse("grab the lamp"), { pattern: "imperative", verb: "take", object: "lamp", residue: [] });
  assert.deepEqual(parse("put down the lamp"), { pattern: "imperative", verb: "drop", object: "lamp", residue: [] });
  assert.deepEqual(parse("leave the lamp"), { pattern: "imperative", verb: "drop", object: "lamp", residue: [] });
  assert.deepEqual(parse("talk to the butler"), { pattern: "imperative", verb: "talk", object: "butler", residue: [] });
  assert.deepEqual(parse("speak with the butler"), { pattern: "imperative", verb: "talk", object: "butler", residue: [] });
  assert.deepEqual(parse("look at the portrait"), { pattern: "imperative", verb: "examine", object: "portrait", residue: [] });
  assert.deepEqual(parse("inspect the portrait"), { pattern: "imperative", verb: "examine", object: "portrait", residue: [] });
  assert.deepEqual(parse("shut the cabinet"), { pattern: "imperative", verb: "close", object: "cabinet", residue: [] });
  assert.equal(parse("pick up the lamp").corrected, undefined, "a recognised synonym is not reported as a correction");
});

test("VERB_SYNONYMS reaches a 3-4-token idiom, not just a 2-token prefix", () => {
  // playtests/PLAYTEST_LOG_004.md: these previously fell through the imperative
  // parser entirely (returning null) and got picked up by the ordinary ask
  // pipeline's keyword matching instead — a confident wrong code-graph answer,
  // not an honest miss.
  assert.deepEqual(parse("chat with the butler"), { pattern: "imperative", verb: "talk", object: "butler", residue: [] });
  assert.deepEqual(parse("converse with the butler"), { pattern: "imperative", verb: "talk", object: "butler", residue: [] });
  assert.deepEqual(parse("have a look at the desk"), { pattern: "imperative", verb: "examine", object: "desk", residue: [] });
  assert.deepEqual(parse("take a look at the desk"), { pattern: "imperative", verb: "examine", object: "desk", residue: [] });
  assert.deepEqual(parse("check out the desk"), { pattern: "imperative", verb: "examine", object: "desk", residue: [] });
  // the longest match wins: "look at" alone must still resolve as it always did.
  assert.deepEqual(parse("look at the desk"), { pattern: "imperative", verb: "examine", object: "desk", residue: [] });
});

test("a bounded fuzzy pre-pass repairs a typo'd verb or direction and names the repair on the command", () => {
  assert.deepEqual(parse("got south"), {
    pattern: "imperative", verb: "go", direction: "south", residue: [], corrected: [{ from: "got", to: "go" }],
  });
  assert.deepEqual(parse("go easte"), {
    pattern: "imperative", verb: "go", direction: "east", residue: [], corrected: [{ from: "easte", to: "east" }],
  });
  assert.deepEqual(parse("lookl"), {
    pattern: "imperative", verb: "look", residue: [], corrected: [{ from: "lookl", to: "look" }],
  });
  assert.equal(parse("go sideways"), null, "a direction two edits away is still an honest miss, not a guess");
});

test("the fuzzy pre-pass also repairs a typo on a VERB_SYNONYMS word, including a multi-word idiom's own lead word", () => {
  // playtests/PLAYTEST_LOG_007.md: a typo'd synonym previously had nothing to
  // fuzzy-match against (the candidate pool held only canonical verb targets,
  // never the synonym surface words themselves), so it fell all the way
  // through to a generic conversational miss instead of an honest per-room
  // decline.
  assert.deepEqual(parse("pikc the lamp"), {
    pattern: "imperative", verb: "take", object: "lamp", residue: [], corrected: [{ from: "pikc", to: "pick" }],
  });
  assert.deepEqual(parse("hav a look at the desk"), {
    pattern: "imperative", verb: "examine", object: "desk", residue: [], corrected: [{ from: "hav", to: "have" }],
  });
  assert.deepEqual(parse("chekc out the desk"), {
    pattern: "imperative", verb: "examine", object: "desk", residue: [], corrected: [{ from: "chekc", to: "check" }],
  });
});
