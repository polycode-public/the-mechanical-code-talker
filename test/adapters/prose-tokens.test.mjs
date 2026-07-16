// The adapters layer carries its own copy of the prose tokenizer
// (src/adapters/prose-tokens.mjs) because an adapter may not import the domain
// layer and prose.mjs may not import an adapter. The two copies must never
// drift: stored mgx:hasProseTokens values and the payload proseIndex have to
// keep matching what the graph/ask side would compute. This suite pins every
// shared function to its prose.mjs twin over a hostile input battery.

import { test } from "node:test";
import assert from "node:assert/strict";

import * as domainProse from "../../src/domain/prose.mjs";
import * as adapterProse from "../../src/adapters/prose-tokens.mjs";

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

test("splitIdentifierWords: the adapter copy matches prose.mjs on every battery input", () => {
  for (const input of INPUTS) {
    assert.deepEqual(adapterProse.splitIdentifierWords(input), domainProse.splitIdentifierWords(input), JSON.stringify(input)?.slice(0, 60));
  }
});

test("tokenizeProse: the adapter copy matches prose.mjs, including the stopword drop and the 120-token cap", () => {
  for (const input of INPUTS) {
    assert.deepEqual(adapterProse.tokenizeProse(input), domainProse.tokenizeProse(input), JSON.stringify(input)?.slice(0, 60));
  }
  const long = Array.from({ length: 300 }, (_, i) => `tok${i}`).join(" ");
  assert.equal(adapterProse.tokenizeProse(long).length, 120);
});

test("proseTokensFor: the adapter copy matches prose.mjs for name/doc/both/neither", () => {
  const cases = [
    {},
    { name: "renderImagePixels" },
    { doc: "Draws the player's image as pixels." },
    { name: "memory/core.mjs", doc: "the OWL-labelled store on disk" },
    { name: null, doc: null },
  ];
  for (const c of cases) {
    assert.deepEqual(adapterProse.proseTokensFor(c), domainProse.proseTokensFor(c), JSON.stringify(c));
  }
});

test("buildProseIndex: the adapter copy builds the identical inverted index, sorted ids included", () => {
  const individuals = [
    { id: "b", attributes: [{ key: "prose_tokens", value: "alpha beta" }] },
    { id: "a", attributes: [{ key: "prose_tokens", value: "beta gamma" }] },
    { id: "c", attributes: [] },
    { id: "d", attributes: [{ key: "prose_tokens", value: "" }] },
    { id: "e" },
  ];
  assert.deepEqual(adapterProse.buildProseIndex(individuals), domainProse.buildProseIndex(individuals));
});

test("attachProseTokens: the adapter copy attaches the identical mgx:hasProseTokens attributes, Commit's message included", () => {
  const build = () => [
    { id: "m", class: "Module", label: "payment/core.mjs", attributes: [{ key: "doc", value: "Charges a card and records the receipt." }] },
    { id: "c", class: "Commit", label: "3f9ab12", attributes: [{ key: "message", value: "fix rounding in subtotal" }] },
    { id: "n", class: "Module", label: "x", attributes: [] },
    { id: "u", class: "Class", label: "InvoiceRenderer" },
  ];
  assert.deepEqual(adapterProse.attachProseTokens(build()), domainProse.attachProseTokens(build()));
  assert.deepEqual(adapterProse.attachProseTokens(build(), { enabled: false }), domainProse.attachProseTokens(build(), { enabled: false }));
});
