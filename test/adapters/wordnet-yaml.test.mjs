import test from "node:test";
import assert from "node:assert/strict";
import { parseYaml } from "../../src/domain/wordnet/yaml.mjs";

// Every fixture here is a literal string. The parser is pure, so these run on
// a machine with no WordNet clone — which is the point of it living in domain/.

test("parseYaml: a flat block mapping of bare scalars", () => {
  assert.deepEqual(parseYaml("a: one\nb: two\n"), { a: "one", b: "two" });
});

test("parseYaml: blank lines and # comments are skipped", () => {
  assert.deepEqual(parseYaml("# a comment\n\na: one\n\n  # indented comment\nb: two\n"), { a: "one", b: "two" });
});

test("parseYaml: a nested mapping one indent deeper", () => {
  assert.deepEqual(parseYaml("outer:\n  inner: value\n"), { outer: { inner: "value" } });
});

test("parseYaml: a sequence at the same indent as its own key", () => {
  assert.deepEqual(parseYaml("members:\n- dog\n- cat\n"), { members: ["dog", "cat"] });
});

test("parseYaml: a sequence indented under its key", () => {
  assert.deepEqual(parseYaml("members:\n  - dog\n  - cat\n"), { members: ["dog", "cat"] });
});

test("parseYaml: a key with no value is null", () => {
  assert.deepEqual(parseYaml("a:\nb: two\n"), { a: null, b: "two" });
});

test("parseYaml: single- and double-quoted scalars lose their quotes", () => {
  assert.deepEqual(parseYaml(`a: 'one'\nb: "two"\n`), { a: "one", b: "two" });
});

test("parseYaml: a bare scalar wrapping onto a more-indented continuation line joins with one space", () => {
  assert.deepEqual(
    parseYaml("definition: a long definition that\n  wraps onto a second line\n"),
    { definition: "a long definition that wraps onto a second line" },
  );
});

test("parseYaml: a list item shaped '- key: value' reads as an inline mapping", () => {
  assert.deepEqual(
    parseYaml("sense:\n  - id: example-n-1\n    synset: 00001740-n\n"),
    { sense: [{ id: "example-n-1", synset: "00001740-n" }] },
  );
});

test("parseYaml: the WordNet entries shape — word -> pos -> sense list", () => {
  const text = [
    "dog:",
    "  n:",
    "    sense:",
    "      - id: dog%1:05:00::",
    "        synset: 02086723-n",
    "      - id: dog%1:18:00::",
    "        synset: 10133978-n",
    "  v:",
    "    sense:",
    "      - id: dog%2:38:00::",
    "        synset: 02001858-v",
    "",
  ].join("\n");
  assert.deepEqual(parseYaml(text), {
    dog: {
      n: { sense: [{ id: "dog%1:05:00::", synset: "02086723-n" }, { id: "dog%1:18:00::", synset: "10133978-n" }] },
      v: { sense: [{ id: "dog%2:38:00::", synset: "02001858-v" }] },
    },
  });
});

// ---- The two fixes the parser's own comments record -------------------------
// Both are regressions the WordNet dump actually provoked, so they are pinned
// as behaviour, not left to the comment alone.

test("documented fix: a quoted scalar containing a literal ': ' is not misread as a key line", () => {
  assert.deepEqual(
    parseYaml(`definition: "the four gospels: Matthew, Mark, Luke, and John"\n`),
    { definition: "the four gospels: Matthew, Mark, Luke, and John" },
  );
});

test("documented fix: a quoted scalar wrapping after a colon keeps continuing, not truncating at the colon", () => {
  // The bare-scalar heuristic would read "Matthew, Mark, Luke, and John" as a
  // new key line and drop the rest of the string. Inside an open quote every
  // line is a continuation until the closing quote.
  const text = `definition: "the four gospels:\n  Matthew, Mark, Luke, and John"\n`;
  assert.deepEqual(parseYaml(text), { definition: "the four gospels: Matthew, Mark, Luke, and John" });
});

test("documented fix: a quoted list item containing ': ' stays a scalar, not an inline mapping", () => {
  assert.deepEqual(
    parseYaml(`example:\n  - "the cetaceans, including: whales, dolphins"\n`),
    { example: ["the cetaceans, including: whales, dolphins"] },
  );
});

test("documented fix: a multi-word key ('M-1 rifle') matches — the first colon wins, not the last", () => {
  assert.deepEqual(parseYaml("M-1 rifle:\n  n:\n    sense:\n      - id: x\n"), {
    "M-1 rifle": { n: { sense: [{ id: "x" }] } },
  });
});

test("documented fix: a multi-word key with a space ('ice cream') is one key, not split", () => {
  const parsed = parseYaml("ice cream: dessert\n");
  assert.deepEqual(Object.keys(parsed), ["ice cream"]);
  assert.equal(parsed["ice cream"], "dessert");
});

// ---- The approximations the parser deliberately keeps ------------------------

test("an unquoted inline scalar keeps every later colon — the FIRST colon splits key from value", () => {
  assert.deepEqual(parseYaml("definition: gospels including: Matthew and Mark\n"), {
    definition: "gospels including: Matthew and Mark",
  });
});

test("approximation: an unquoted scalar whose CONTINUATION line contains 'word: ' truncates there, as documented", () => {
  // The parser's own comment accepts this: a continuation line that happens to
  // hold a bare "word: " sequence is rare in this corpus, and the output is
  // hand-reviewed. Quoting the scalar is what defends against it (above).
  // Pinned so the tradeoff is visible rather than rediscovered.
  assert.deepEqual(parseYaml("definition: a definition that\n  wraps then: says more\n"), {
    definition: "a definition that",
  });
});

test("approximation: not a general YAML parser — no flow style, so '[a, b]' stays a string", () => {
  assert.deepEqual(parseYaml("members: [dog, cat]\n"), { members: "[dog, cat]" });
});
