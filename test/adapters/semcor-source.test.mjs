import test from "node:test";
import assert from "node:assert/strict";
import { readSemcorRecords, isSimpleSentence, NOUN_POS } from "../../scripts/lib/semcor-source.mjs";

// Every fixture is a literal, so none of this needs the SemCor clone.

const FILE = [
  "_meta:",
  "  schema: semcor",
  "  version: 1",
  "",
  "br_a01_1:",
  '  lemmas: ["the", "jury", "say"]',
  '  pos: ["DT", "NN", "VBD"]',
  "  text: 'The jury said it found the evidence.'",
  "br_a01_2:",
  '  lemmas: ["it", "be"]',
  '  pos: ["PRP", "VBD"]',
  "  text: 'It was fine.'",
  "",
].join("\n");

test("readSemcorRecords: one record per sentence, with the _meta schema block left out", () => {
  const records = readSemcorRecords(FILE);
  assert.equal(records.length, 2);
  assert.deepEqual(records.map((r) => r.id), ["br_a01_1", "br_a01_2"]);
  assert.deepEqual(records[0], {
    id: "br_a01_1",
    lemmas: ["the", "jury", "say"],
    pos: ["DT", "NN", "VBD"],
    text: "The jury said it found the evidence.",
  });
});

test("readSemcorRecords: empty text yields no records", () => {
  assert.deepEqual(readSemcorRecords(""), []);
});

test("readSemcorRecords: a file with no _meta block still yields its sentences", () => {
  const records = readSemcorRecords("br_a01_1:\n  text: 'Hello.'\n");
  assert.deepEqual(records.map((r) => r.text), ["Hello."]);
});

test("readSemcorRecords: flow-style arrays read as arrays, and a missing one is null", () => {
  const [rec] = readSemcorRecords("_meta:\n  schema: semcor\nbr_1:\n  lemmas: [\"the\", \"jury\"]\n  text: 'x'\n");
  assert.deepEqual(rec.lemmas, ["the", "jury"]);
  assert.equal(rec.pos, null);
});

test("readSemcorRecords: an array wrapped across lines is still one array", () => {
  const [rec] = readSemcorRecords([
    "_meta:",
    "  schema: semcor",
    "br_1:",
    '  lemmas: ["the", "jury",',
    '    "say", "it"]',
    "  text: 'x'",
    "",
  ].join("\n"));
  assert.deepEqual(rec.lemmas, ["the", "jury", "say", "it"]);
});

test("readSemcorRecords: YAML's '' escape becomes one literal apostrophe", () => {
  const [rec] = readSemcorRecords("_meta:\n  schema: semcor\nbr_1:\n  text: 'It''s the jury''s call.'\n");
  assert.equal(rec.text, "It's the jury's call.");
});

test("readSemcorRecords: a folded scalar's line breaks collapse to single spaces", () => {
  const [rec] = readSemcorRecords([
    "_meta:",
    "  schema: semcor",
    "br_1:",
    "  text: 'The jury said",
    "    it found the evidence",
    "    convincing.'",
    "",
  ].join("\n"));
  assert.equal(rec.text, "The jury said it found the evidence convincing.");
});

test("readSemcorRecords: an absent text key is null", () => {
  const [rec] = readSemcorRecords("_meta:\n  schema: semcor\nbr_1:\n  lemmas: [\"a\"]\n");
  assert.equal(rec.text, null);
});

test("isSimpleSentence: a short plain sentence passes", () => {
  assert.equal(isSimpleSentence("The dog barked at the postman.", 6), true);
});

test("isSimpleSentence: over 18 words is rejected", () => {
  assert.equal(isSimpleSentence("a short text", 19), false);
  assert.equal(isSimpleSentence("a short text", 18), true, "18 is the boundary and is allowed");
});

test("isSimpleSentence: a semicolon or colon is rejected", () => {
  assert.equal(isSimpleSentence("He left; she stayed.", 4), false);
  assert.equal(isSimpleSentence("She said this: no.", 4), false);
});

test("isSimpleSentence: more than one comma is rejected, exactly one is allowed", () => {
  assert.equal(isSimpleSentence("Bread, milk and eggs.", 4), true);
  assert.equal(isSimpleSentence("Bread, milk, and eggs.", 4), false);
});

test("isSimpleSentence: an embedded double quote is rejected as reported speech", () => {
  assert.equal(isSimpleSentence('He said "no" to it.', 5), false);
});

test("NOUN_POS: the two Brown noun tags, and nothing else", () => {
  assert.ok(NOUN_POS.has("NN"));
  assert.ok(NOUN_POS.has("NNS"));
  assert.equal(NOUN_POS.has("NNP"), false, "proper nouns are not targets");
  assert.equal(NOUN_POS.has("VBD"), false);
});
