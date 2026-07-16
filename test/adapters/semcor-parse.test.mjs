import test from "node:test";
import assert from "node:assert/strict";
import {
  splitRecords, extractArray, extractText, isSimpleSentence, NOUN_POS,
} from "../../src/domain/semcor/parse.mjs";

// All four of these were exported from the script for testability and then
// never tested. Every fixture is a literal, so none of this needs the SemCor
// clone.

const FILE = [
  "_meta:",
  "  schema: semcor",
  "  version: 1",
  "",
  "br_a01_1:",
  "  lemmas: [\"the\", \"jury\", \"say\"]",
  "  pos: [\"DT\", \"NN\", \"VBD\"]",
  "  text: 'The jury said it found the evidence.'",
  "br_a01_2:",
  "  lemmas: [\"it\", \"be\"]",
  "  pos: [\"PRP\", \"VBD\"]",
  "  text: 'It was fine.'",
  "",
].join("\n");

test("splitRecords: one block per top-level record, with the _meta block skipped", () => {
  const blocks = splitRecords(FILE);
  assert.equal(blocks.length, 2);
  assert.ok(blocks[0].includes("The jury said"));
  assert.ok(blocks[1].includes("It was fine."));
  assert.ok(!blocks.some((b) => b.includes("schema: semcor")), "_meta must not survive as a record");
});

test("splitRecords: a file with no _meta block yields no records", () => {
  // The reader scans forward to "_meta:" and starts after it; without one it
  // runs off the end. Pinned as the behaviour it has.
  assert.deepEqual(splitRecords("br_a01_1:\n  text: 'Hello.'\n"), []);
});

test("splitRecords: empty text yields no records", () => {
  assert.deepEqual(splitRecords(""), []);
});

test("extractArray: a flow-style string array parses to a real array", () => {
  const block = "  lemmas: [\"the\", \"jury\"]\n  pos: [\"DT\", \"NN\"]";
  assert.deepEqual(extractArray(block, "lemmas"), ["the", "jury"]);
  assert.deepEqual(extractArray(block, "pos"), ["DT", "NN"]);
});

test("extractArray: an absent key is null", () => {
  assert.equal(extractArray("  text: 'x'", "lemmas"), null);
});

test("extractArray: an array wrapped across lines is rejoined by balancing brackets", () => {
  const block = [
    "  lemmas: [\"the\", \"jury\",",
    '    "say", "it"]',
    "  pos: [\"DT\"]",
  ].join("\n");
  assert.deepEqual(extractArray(block, "lemmas"), ["the", "jury", "say", "it"]);
});

test("extractArray: a nested array balances to the outer close, not the first ]", () => {
  const block = '  spans: [[1, 2], [3, 4]]';
  assert.deepEqual(extractArray(block, "spans"), [[1, 2], [3, 4]]);
});

test("extractArray: unparseable content is null rather than a throw", () => {
  assert.equal(extractArray("  lemmas: [not, valid, json]", "lemmas"), null);
});

test("extractText: reads a single-quoted scalar", () => {
  assert.equal(extractText("  text: 'The jury said it.'"), "The jury said it.");
});

test("extractText: YAML's '' escape becomes one literal apostrophe", () => {
  assert.equal(extractText("  text: 'It''s the jury''s call.'"), "It's the jury's call.");
});

test("extractText: a folded scalar's line breaks collapse to single spaces", () => {
  assert.equal(
    extractText("  text: 'The jury said\n    it found the evidence\n    convincing.'"),
    "The jury said it found the evidence convincing.",
  );
});

test("extractText: an absent text key is null", () => {
  assert.equal(extractText("  lemmas: [\"a\"]"), null);
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
