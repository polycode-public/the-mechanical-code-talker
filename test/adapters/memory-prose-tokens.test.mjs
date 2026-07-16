// The memory store carries its own copy of the prose tokenizer
// (src/adapters/memory/prose-tokens.mjs) because the store may not import the domain
// layer and prose.mjs may not import the store. The two copies must never
// drift: stored mgx:hasProseTokens values and the payload proseIndex have to
// keep matching what the graph/ask side would compute. This suite pins every
// shared function to its prose.mjs twin over a hostile input battery.

import { test } from "node:test";
import assert from "node:assert/strict";

import * as domainProse from "../../src/prose.mjs";
import * as storeProse from "../../src/adapters/memory/prose-tokens.mjs";

const INPUTS = [
  "",
  null,
  undefined,
  "x",
  "renderImagePixels",
  "HTTPSConnection",
  "parseXML2Json",
  "app/lib/payment-system.mjs",
  "snake_case_name.and.dots",
  "a an the of to in — stopwords only",
  "The quick brown fox jumps over the lazy dog, twice: the fox again!",
  "Ünïcode tökens and emoji 🦊 mixed with fnAlpha.callSite()",
  "x".repeat(41) + " " + "y".repeat(40) + " ok",
  Array.from({ length: 200 }, (_, i) => `word${i}`).join(" "),
  "MiXeD CaSe WITH ACRONYMS NASA HTTPServer v2Beta3",
  "line one\nline two with fnBeta\n\tline three: memory/core.mjs",
];

test("splitIdentifierWords: the store copy matches prose.mjs on every battery input", () => {
  for (const input of INPUTS) {
    assert.deepEqual(storeProse.splitIdentifierWords(input), domainProse.splitIdentifierWords(input), JSON.stringify(input)?.slice(0, 60));
  }
});

test("tokenizeProse: the store copy matches prose.mjs, including the stopword drop and the 120-token cap", () => {
  for (const input of INPUTS) {
    assert.deepEqual(storeProse.tokenizeProse(input), domainProse.tokenizeProse(input), JSON.stringify(input)?.slice(0, 60));
  }
  const long = Array.from({ length: 300 }, (_, i) => `tok${i}`).join(" ");
  assert.equal(storeProse.tokenizeProse(long).length, 120);
});

test("proseTokensFor: the store copy matches prose.mjs for name/doc/both/neither", () => {
  const cases = [
    {},
    { name: "renderImagePixels" },
    { doc: "Draws the player's image as pixels." },
    { name: "memory/core.mjs", doc: "the OWL-labelled store on disk" },
    { name: null, doc: null },
  ];
  for (const c of cases) {
    assert.deepEqual(storeProse.proseTokensFor(c), domainProse.proseTokensFor(c), JSON.stringify(c));
  }
});

test("buildProseIndex: the store copy builds the identical inverted index, sorted ids included", () => {
  const individuals = [
    { id: "b", attributes: [{ key: "prose_tokens", value: "alpha beta" }] },
    { id: "a", attributes: [{ key: "prose_tokens", value: "beta gamma" }] },
    { id: "c", attributes: [] },
    { id: "d", attributes: [{ key: "prose_tokens", value: "" }] },
    { id: "e" },
  ];
  assert.deepEqual(storeProse.buildProseIndex(individuals), domainProse.buildProseIndex(individuals));
});
