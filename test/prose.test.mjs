// prose.test.mjs — the second-pass prose extraction + cross-reference index (PLAN_PROSE_INDEX.md).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  splitIdentifierWords, tokenizeProse, proseTokensFor,
  attachProseTokens, buildProseIndex, lookupByProseTokens,
} from "../src/prose.mjs";

test("splitIdentifierWords: camelCase, sentence-fragment names", () => {
  assert.deepEqual(
    splitIdentifierWords("calculateTotalPriceIncludingTax"),
    ["calculate", "total", "price", "including", "tax"],
  );
});

test("splitIdentifierWords: snake_case and kebab-case", () => {
  assert.deepEqual(splitIdentifierWords("is_user_authenticated"), ["is", "user", "authenticated"]);
  assert.deepEqual(splitIdentifierWords("parse-xml-file"), ["parse", "xml", "file"]);
});

test("splitIdentifierWords: acronym runs (the ELIZA-adjacent edge case set)", () => {
  assert.deepEqual(splitIdentifierWords("HTTPSConnection"), ["https", "connection"]);
  assert.deepEqual(splitIdentifierWords("parseXML"), ["parse", "xml"]);
  assert.deepEqual(splitIdentifierWords("XMLHttpRequest"), ["xml", "http", "request"]);
});

test("splitIdentifierWords: path-like module names — separators, hyphens, extension stripped", () => {
  assert.deepEqual(splitIdentifierWords("packages/seonix/src/ask-vocab.mjs"),
    ["packages", "seonix", "src", "ask", "vocab"]);
});

test("splitIdentifierWords: single-character tokens are dropped, empty/falsy input is []", () => {
  assert.deepEqual(splitIdentifierWords("a.b.c"), []); // all single-char segments
  assert.deepEqual(splitIdentifierWords(""), []);
  assert.deepEqual(splitIdentifierWords(null), []);
});

test("tokenizeProse: lowercase, punctuation-stripped, stopwords + short tokens dropped, deduped", () => {
  assert.deepEqual(
    tokenizeProse("Handles user authentication and billing."),
    ["handles", "user", "authentication", "billing"],
  );
  assert.deepEqual(tokenizeProse("The the THE"), []); // stopword, case-insensitive, deduped
});

test("tokenizeProse: caps at MAX_TOKENS_PER_DOC and drops over-length garbage tokens", () => {
  const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(" ");
  const tokens = tokenizeProse(long);
  assert.ok(tokens.length <= 120, `expected <=120 tokens, got ${tokens.length}`);
  const garbage = "x".repeat(50);
  assert.deepEqual(tokenizeProse(garbage), []); // over MAX_TOKEN_LEN
});

test("proseTokensFor: combines + dedupes + sorts identifier and doc tokens", () => {
  assert.deepEqual(
    proseTokensFor({ name: "userAuth", doc: "Handles user authentication." }),
    ["auth", "authentication", "handles", "user"],
  );
});

test("attachProseTokens: Module/Function individuals get tokens from label + doc attribute", () => {
  const individuals = [
    { id: "fn:a.py#calculateTotalPrice", label: "calculateTotalPrice", class: "Function", attributes: [] },
    { id: "mod:b.py", label: "b.py", class: "Module",
      attributes: [{ prop: "seon:hasDoc", key: "doc", value: "Handles billing." }] },
  ];
  attachProseTokens(individuals);
  const t1 = individuals[0].attributes.find((a) => a.key === "prose_tokens");
  assert.equal(t1.value, "calculate price total");
  const t2 = individuals[1].attributes.find((a) => a.key === "prose_tokens");
  assert.equal(t2.value, "billing handles");
});

test("attachProseTokens: Commit individuals use `message`, NOT the SHA `label` (no hex-fragment noise)", () => {
  const individuals = [{
    id: "commit:e6a9419567f7fb4b464a687f9aa76c0e6baa255b", label: "e6a9419567f7", class: "Commit",
    attributes: [{ prop: "mgx:commitMessage", key: "message", value: "feat(ask): mechanical NL query over the graph" }],
  }];
  attachProseTokens(individuals);
  const t = individuals[0].attributes.find((a) => a.key === "prose_tokens");
  assert.ok(t, "Commit individual should still get prose tokens (from message, not label)");
  assert.ok(!t.value.includes("9419567") && !t.value.includes("e6a9419567f7"),
    `SHA fragments must not leak into commit prose tokens, got: "${t.value}"`);
  assert.match(t.value, /\bmechanical\b/);
  assert.match(t.value, /\bgraph\b/);
});

test("attachProseTokens: individuals with nothing to index get no prose_tokens attribute", () => {
  const individuals = [{ id: "fn:a.py#x", label: "x", class: "Function", attributes: [] }]; // single-char, filtered
  attachProseTokens(individuals);
  assert.equal(individuals[0].attributes.find((a) => a.key === "prose_tokens"), undefined);
});

test("attachProseTokens: enabled=false is a true no-op (the SEONIX_PROSE_INDEX=0 disable path)", () => {
  const individuals = [{ id: "fn:a.py#calculateTotal", label: "calculateTotal", class: "Function", attributes: [] }];
  const before = JSON.stringify(individuals);
  attachProseTokens(individuals, { enabled: false });
  assert.equal(JSON.stringify(individuals), before, "disabled pass must not mutate individuals at all");
});

test("buildProseIndex: inverts prose_tokens into word -> sorted [ids]", () => {
  const individuals = [
    { id: "fn:a.py#calculateTotal", label: "calculateTotal", class: "Function", attributes: [] },
    { id: "fn:b.py#calculateTax", label: "calculateTax", class: "Function", attributes: [] },
  ];
  attachProseTokens(individuals);
  const index = buildProseIndex(individuals);
  assert.deepEqual(index.calculate, ["fn:a.py#calculateTotal", "fn:b.py#calculateTax"]);
  assert.deepEqual(index.total, ["fn:a.py#calculateTotal"]);
  assert.deepEqual(index.tax, ["fn:b.py#calculateTax"]);
});

test("buildProseIndex: individuals without prose_tokens contribute nothing (no crash on missing attribute)", () => {
  const individuals = [{ id: "fn:a.py#x", label: "x", class: "Function", attributes: [] }];
  assert.deepEqual(Object.keys(buildProseIndex(individuals)), []);
});

test("lookupByProseTokens: ranks by token-overlap count, most-shared first", () => {
  const individuals = [
    { id: "fn:a.py#calculateTotalPrice", label: "calculateTotalPrice", class: "Function", attributes: [] },
    { id: "fn:b.py#calculateTax", label: "calculateTax", class: "Function", attributes: [] },
    { id: "fn:c.py#unrelated", label: "unrelated", class: "Function", attributes: [] },
  ];
  attachProseTokens(individuals);
  const index = buildProseIndex(individuals);
  const hits = lookupByProseTokens(index, "calculate total price");
  assert.equal(hits[0].id, "fn:a.py#calculateTotalPrice"); // shares calculate+total+price = 3
  assert.equal(hits[0].score, 3);
  assert.ok(hits.some((h) => h.id === "fn:b.py#calculateTax")); // shares "calculate" = 1
  assert.ok(!hits.some((h) => h.id === "fn:c.py#unrelated"));
});

test("lookupByProseTokens: no query tokens or no matches → []", () => {
  const index = { calculate: ["fn:a.py#x"] };
  assert.deepEqual(lookupByProseTokens(index, "the a an"), []); // all stopwords/short
  assert.deepEqual(lookupByProseTokens(index, "frobnicate"), []); // real token, no match
});
