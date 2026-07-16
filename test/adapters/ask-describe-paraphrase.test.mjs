// ask-describe-paraphrase.test.mjs — the describe-paraphrase phrasing frames:
// "what is X for", "what is the purpose of X", and the scoped "what does X do
// in this codebase" all rewrite onto the meta/whatis shape and answer exactly
// like the already-recognized "what is a X". The vocabulary phrasings that
// carry an a/an article or a pronoun ("what is a horse for", "what is it
// for") must pass through the frames untouched — those belong to the
// memory-facts readers, and rewriting them would misread a general noun as a
// code-entity term. Convention per ask-find.test.mjs: buildEntities/
// parseEntities build a REAL graph from a small fixture; each capability gets
// a HIT plus an honest-miss control, end-to-end through ask().
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEntities } from "../../src/adapters/graph-build.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { ingestSchemaDocs } from "../../src/schema-docs.mjs";
import { parseQuery, ask } from "../../src/domain/ask.mjs";
import { applyPhrasingFrames } from "../../src/domain/interpret/normalize.mjs";

const MODULES = [
  { path: "src/payment.mjs", dotted: "src.payment", imports: [], calls: [],
    defines: [{ name: "PaymentProcessor", kind: "class", lineno: 1, decorators: [] }] },
  { path: "src/validate.mjs", dotted: "src.validate", imports: [], calls: [],
    defines: [{ name: "validate", kind: "function", lineno: 1, decorators: [] }] },
];

function buildGraph() {
  const entities = buildEntities(MODULES, [], {});
  ingestSchemaDocs(entities);
  return parseEntities(entities);
}
const graph = buildGraph();

const baseline = ask(graph, "what is a PaymentProcessor");

test("sanity: the baseline paraphrase 'what is a PaymentProcessor' answers via the meta fallback", () => {
  assert.equal(baseline.tmct_ask.miss, false);
  assert.match(baseline.content, /^PaymentProcessor is a class in this codebase/);
});

test("'what is PaymentProcessor for' answers byte-identically to 'what is a PaymentProcessor'", () => {
  const r = ask(graph, "what is PaymentProcessor for");
  assert.equal(r.tmct_ask.miss, false);
  assert.equal(r.content, baseline.content);
});

test("'what is PaymentProcessor used for' answers byte-identically to the baseline too", () => {
  const r = ask(graph, "what is PaymentProcessor used for");
  assert.equal(r.content, baseline.content);
});

test("'what is the purpose of PaymentProcessor' answers byte-identically to the baseline", () => {
  const r = ask(graph, "what is the purpose of PaymentProcessor");
  assert.equal(r.tmct_ask.miss, false);
  assert.equal(r.content, baseline.content);
});

test("'what is the purpose of the PaymentProcessor' drops the article like resolveObject does", () => {
  const r = ask(graph, "what is the purpose of the PaymentProcessor");
  assert.equal(r.content, baseline.content);
});

test("'what does PaymentProcessor do in this codebase' answers byte-identically to the baseline", () => {
  const r = ask(graph, "what does PaymentProcessor do in this codebase");
  assert.equal(r.tmct_ask.miss, false);
  assert.equal(r.content, baseline.content);
});

test("the frames parse the purpose-of and scoped-do paraphrases to the same meta shape as the baseline", () => {
  const want = parseQuery("what is a PaymentProcessor");
  assert.equal(want.shape, "meta");
  assert.deepEqual(parseQuery("what is the purpose of PaymentProcessor"), want);
  assert.deepEqual(parseQuery("what does PaymentProcessor do in this codebase"), want);
});

test("'what is X for' stays parse-less (chat's module-overview lane gates on the miss) yet still answers through ask()'s fallback", () => {
  assert.equal(parseQuery("what is PaymentProcessor for"), null);
  const r = ask(graph, "what is PaymentProcessor for");
  assert.equal(r.tmct_ask.parsed, null);
  assert.equal(r.tmct_ask.miss, false);
});

test("function-grain paraphrase: 'what is the purpose of validate' answers like 'what is a validate'", () => {
  const r = ask(graph, "what is the purpose of validate");
  const base = ask(graph, "what is a validate");
  assert.equal(r.tmct_ask.miss, false);
  assert.equal(r.content, base.content);
  assert.match(r.content, /^validate is a function in this codebase/);
});

test("honest-miss control: a paraphrase naming nothing in the graph stays a miss, never a guess", () => {
  const r = ask(graph, "what is the purpose of Zorblatt");
  assert.equal(r.tmct_ask.miss, true);
  const r2 = ask(graph, "what is Zorblatt for");
  assert.equal(r2.tmct_ask.miss, true);
});

// ---- the vocabulary phrasings the frames must NOT claim ----

test("article-led vocabulary phrasings pass through the frames untouched", () => {
  for (const q of [
    "what is a horse for",
    "what is an engine for",
    "what is a widget used for",
    "what is the purpose of a horse",
    "what does a dog do in this codebase",
  ]) {
    assert.equal(applyPhrasingFrames(q), q, `frame must not rewrite "${q}"`);
  }
});

test("pronoun-led phrasings pass through the frames untouched", () => {
  for (const q of ["what is it for", "what is this for", "what is that for"]) {
    assert.equal(applyPhrasingFrames(q), q, `frame must not rewrite "${q}"`);
  }
});

test("the reverse-by-object vocabulary shapes are untouched ('what is for riding', 'what can be used for riding')", () => {
  assert.equal(applyPhrasingFrames("what is for riding"), "what is for riding");
  assert.equal(applyPhrasingFrames("what can be used for riding"), "what can be used for riding");
});

test("bare 'what does X do' (no scope tail) is not rewritten — the chat module-overview lane owns it", () => {
  assert.equal(applyPhrasingFrames("what does PaymentProcessor do"), "what does PaymentProcessor do");
  assert.equal(parseQuery("what does PaymentProcessor do"), null);
});
