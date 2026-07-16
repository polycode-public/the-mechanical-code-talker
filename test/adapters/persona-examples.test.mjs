import test from "node:test";
import assert from "node:assert/strict";
import { isRealSentence, normalizeExample } from "../../src/domain/persona/examples.mjs";

test("isRealSentence: a real example sentence passes", () => {
  assert.equal(isRealSentence("the dog barked all night"), true);
  assert.equal(isRealSentence("he took the bus to work"), true);
});

test("isRealSentence: a 'see table 1' cross-reference stub is rejected", () => {
  assert.equal(isRealSentence("see table 1"), false);
  assert.equal(isRealSentence("see table 1."), false);
  assert.equal(isRealSentence("See Table 1"), false, "the check is case-insensitive");
  assert.equal(isRealSentence("see figure"), false);
});

test("isRealSentence: surrounding whitespace does not rescue a stub", () => {
  assert.equal(isRealSentence("  see table 1  "), false);
});

test("isRealSentence: a real sentence that merely starts with 'see' still passes", () => {
  assert.equal(isRealSentence("see the dog run across the yard"), true);
});

test("isRealSentence: a non-string is stringified rather than throwing", () => {
  assert.equal(isRealSentence(null), true);
  assert.equal(isRealSentence(42), true);
});

test("normalizeExample: a plain string example passes through unchanged", () => {
  assert.equal(normalizeExample("the dog barked all night"), "the dog barked all night");
});

test("documented shape: an attributed literary quote yields its text, dropping the source", () => {
  // Real, found live: none of Small tier's 665 words hit this shape, so it went
  // uncaught until Medium/Large widened coverage. WordNet's example for
  // "ecstasy" is a {source, text} mapping rather than a plain string.
  assert.equal(
    normalizeExample({ source: "Charles Dickens", text: "listening to sweet music in an ecstasy" }),
    "listening to sweet music in an ecstasy",
  );
});

test("normalizeExample: a {source, text} shape works even with no source present", () => {
  assert.equal(normalizeExample({ text: "a sentence" }), "a sentence");
});

test("normalizeExample: any other shape is null, never a guess", () => {
  assert.equal(normalizeExample(null), null);
  assert.equal(normalizeExample(undefined), null);
  assert.equal(normalizeExample({ source: "Dickens" }), null, "a mapping with no text yields nothing");
  assert.equal(normalizeExample({ text: 42 }), null, "a non-string text is not coerced");
  assert.equal(normalizeExample(["a", "b"]), null);
});
