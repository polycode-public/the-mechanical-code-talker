// interpret.test.mjs — the multi-strategy interpretation pipeline (ROADMAP item 8:
// interpret/pipeline.mjs + interpret/merge.mjs) and the normalization pre-pass
// record (item 10). The LEGACY behaviors (two-strategy agree/disagree over real
// queries) stay pinned by ask.test.mjs/ask-dual-strategy.test.mjs; these tests
// prove the pipeline's own contract: N-strategy registration, same-class dedupe,
// distinct-class "if you mean X then …" surround, and crash isolation (a throwing
// strategy is dropped, never fatal).
import { test } from "node:test";
import assert from "node:assert/strict";
import { interpret, STRATEGIES, normalizeInput, runStrategiesSync } from "../src/interpret/pipeline.mjs";
import { mergeStrategyResults, alternateLines, sameParse } from "../src/interpret/merge.mjs";
import { parseQuery } from "../src/ask.mjs";

// A tiny strategy factory: fixed id/class, returns the given parse for any text.
const fixed = (id, cls, parsed, confidence, note = null) => ({
  id,
  class: cls,
  run: () => ({ strategyId: id, class: cls, candidates: [{ parsed, confidence, note }] }),
});
const REV = (object) => ({ shape: "reverse", entityType: null, modifier: "direct", kind: "imports", object });

// ---- registration: the default registry carries the legacy strategies, and a
// caller-supplied registry of N strategies runs them all ----

test("registration: the default STRATEGIES registry carries grammar + keyword-spot in precedence order", () => {
  const ids = STRATEGIES.map((s) => s.id);
  assert.ok(ids.includes("grammar"), "grammar strategy not registered");
  assert.ok(ids.includes("keyword-spot"), "keyword-spot strategy not registered");
  assert.ok(ids.indexOf("grammar") < ids.indexOf("keyword-spot"), "grammar must outrank keyword-spot");
});

test("registration: N custom strategies all run and all report (results carries one entry per hit)", async () => {
  const strategies = [
    fixed("s1", "a", REV("x"), 0.9),
    fixed("s2", "b", REV("y"), 0.6),
    fixed("s3", "c", REV("z"), 0.5),
  ];
  const rec = await interpret("anything at all", { strategies, nlp: null });
  assert.equal(rec.results.length, 3);
  assert.deepEqual(rec.results.map((r) => r.strategyId), ["s1", "s2", "s3"]);
});

test("registration: an ASYNC strategy participates via Promise.all like a sync one", async () => {
  const asyncStrategy = {
    id: "slow", class: "async-class",
    run: async () => ({ strategyId: "slow", class: "async-class", candidates: [{ parsed: REV("later"), confidence: 0.4 }] }),
  };
  const rec = await interpret("whatever", { strategies: [fixed("fast", "a", REV("now"), 0.9), asyncStrategy], nlp: null });
  assert.equal(rec.results.length, 2);
  assert.equal(rec.class, "a");
  assert.equal(rec.alternates.length, 1);
  assert.equal(rec.alternates[0].strategyId, "slow");
});

// ---- same-class merge: identical parses dedupe onto the higher-precedence
// strategy; distinct parses in the winning class are the legacy ambiguity ----

test("same-class merge: two strategies agreeing dedupe to ONE parse (no ambiguity), higher precedence wins the representative", async () => {
  const p1 = REV("walk.mjs");
  const p2 = REV("walk.mjs"); // a distinct object, same meaning
  const rec = await interpret("q", { strategies: [fixed("hi", "graph-query", p1, 0.9), fixed("lo", "graph-query", p2, 0.7)], nlp: null });
  assert.equal(rec.parsed, p1, "the higher-precedence strategy's own parse object must survive");
  assert.equal(rec.parsed.ambiguousParse, undefined);
  assert.deepEqual(rec.alternates, []);
});

test("same-class merge: distinct parses in the winning class surface as the legacy {ambiguousParse, candidates}", async () => {
  const a = REV("alpha");
  const b = REV("beta");
  const rec = await interpret("q", { strategies: [fixed("s1", "graph-query", a, 0.9), fixed("s2", "graph-query", b, 0.7)], nlp: null });
  assert.equal(rec.parsed.ambiguousParse, true);
  assert.deepEqual(rec.parsed.candidates, [a, b]);
});

test("same-class merge: sameParse treats \"commit <sha>\" and the bare sha as the same term (the legacy comparator)", () => {
  assert.equal(sameParse(
    { shape: "forward", kind: "touches", object: "commit ef74e44e25c8" },
    { shape: "forward", kind: "touches", object: "ef74e44e25c8" },
  ), true);
});

// ---- distinct-class results: the winner answers, alternates carry the
// "if you mean X then …" surround ----

test("distinct-class merge: highest-confidence class wins; other classes become alternates", async () => {
  const win = REV("walk.mjs");
  const alt = { shape: "forward", entityType: null, modifier: "direct", kind: "calls", object: "walk.mjs" };
  const rec = await interpret("q", {
    strategies: [fixed("s1", "graph-query", win, 0.9), fixed("s2", "call-question", alt, 0.6, "the call graph reading")],
    nlp: null,
  });
  assert.equal(rec.class, "graph-query");
  assert.equal(rec.parsed, win);
  assert.equal(rec.alternates.length, 1);
  assert.equal(rec.alternates[0].class, "call-question");
  assert.equal(rec.alternates[0].parsed, alt);
});

test("distinct-class merge: alternates render as \"if you mean X then …\" lines", async () => {
  const rec = await interpret("q", {
    strategies: [
      fixed("s1", "graph-query", REV("walk.mjs"), 0.9),
      fixed("s2", "call-question", { shape: "forward", kind: "calls", object: "walk.mjs" }, 0.6),
      fixed("s3", "vocab-question", { shape: "meta", kind: "meta", object: "walk" }, 0.5, 'the vocabulary question "what does walk mean"'),
    ],
    nlp: null,
  });
  const lines = alternateLines(rec.alternates);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /^if you mean calls "walk\.mjs" then /);
  // a strategy-supplied note beats the default description in the surround
  assert.match(lines[1], /^if you mean the vocabulary question "what does walk mean" then /);
  // and a caller holding a graph can answer each alternate outright
  const answered = alternateLines(rec.alternates, { answerFor: (a) => `<answer for ${a.parsed.kind}>` });
  assert.match(answered[0], /then <answer for calls>$/);
});

test("distinct-class merge: a cross-class alternate that AGREES with the winner is agreement, not an alternative reading", async () => {
  const rec = await interpret("q", {
    strategies: [fixed("s1", "graph-query", REV("same.mjs"), 0.9), fixed("s2", "other-class", REV("same.mjs"), 0.6)],
    nlp: null,
  });
  assert.equal(rec.class, "graph-query");
  assert.deepEqual(rec.alternates, [], "an identical parse in another class must not be surfaced as an alternate");
});

// ---- crash isolation: a broken strategy is dropped, never fatal ----

test("a strategy that THROWS never crashes interpret — it is dropped and the rest still answer", async () => {
  const boom = { id: "boom", class: "broken", run: () => { throw new Error("strategy bug"); } };
  const rec = await interpret("q", { strategies: [boom, fixed("ok", "graph-query", REV("x"), 0.9)], nlp: null });
  assert.equal(rec.results.length, 1);
  assert.deepEqual(rec.parsed, REV("x"));
});

test("a strategy that REJECTS (async throw) is dropped the same way", async () => {
  const reject = { id: "reject", class: "broken", run: async () => { throw new Error("async strategy bug"); } };
  const rec = await interpret("q", { strategies: [reject, fixed("ok", "graph-query", REV("x"), 0.9)], nlp: null });
  assert.equal(rec.results.length, 1);
  assert.deepEqual(rec.parsed, REV("x"));
});

test("runStrategiesSync: a throwing strategy is dropped on the synchronous (parseQuery) path too", () => {
  const boom = { id: "boom", class: "broken", run: () => { throw new Error("strategy bug"); } };
  const results = runStrategiesSync("which modules import walk.mjs", { nlp: null }, [boom, ...STRATEGIES]);
  assert.ok(results.length >= 1);
  assert.ok(results.every((r) => r.strategyId !== "boom"));
});

test("merge: no strategy result at all is an honest null (never a forced winner)", () => {
  assert.equal(mergeStrategyResults([]), null);
  assert.equal(mergeStrategyResults([null, undefined]), null);
});

// ---- legacy equivalence: the pipeline's winner on a real query IS parseQuery's
// answer (parseQuery routes through pipeline+merge — same winner, same shape) ----

test("legacy equivalence: interpret()'s winner matches parseQuery() for a plain reverse query", async () => {
  const rec = await interpret("which modules import walk.mjs", { nlp: null });
  assert.deepEqual(rec.parsed, parseQuery("which modules import walk.mjs", { nlp: null }));
  assert.equal(rec.class, "graph-query");
});

test("legacy equivalence: a genuine two-strategy disagreement stays the legacy ambiguity through the pipeline", async () => {
  const rec = await interpret("which classes extends Base and couples to logging", { nlp: null });
  assert.equal(rec.parsed.ambiguousParse, true);
  assert.equal(rec.parsed.candidates.length, 2);
});

// ---- the normalization pre-pass record (item 10) ----

test("normalizeInput: the pre-pass reports raw, normalized text, and whether it changed the input", () => {
  const unchanged = normalizeInput("which modules import walk.mjs");
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.text, unchanged.raw);
  const repaired = normalizeInput("what's callin' walk.mjs");
  assert.equal(repaired.changed, true);
  assert.equal(repaired.text, "what is calling walk.mjs");
});

test("interpret: the record notes when normalization changed the input, and strategies see the normalized text", async () => {
  let seen = null;
  const spy = { id: "spy", class: "spy", run: (text, ctx) => { seen = { text, raw: ctx.raw }; return null; } };
  const rec = await interpret("um so like which modules import walk.mjs", { strategies: [spy], nlp: null });
  assert.equal(rec.normalizationChanged, true);
  assert.equal(rec.normalized, "which modules import walk.mjs");
  assert.equal(seen.text, "which modules import walk.mjs");
  assert.equal(seen.raw, "um so like which modules import walk.mjs");
});

test("interpret: empty input is an honest empty record, no strategy runs", async () => {
  let ran = false;
  const spy = { id: "spy", class: "spy", run: () => { ran = true; return null; } };
  const rec = await interpret("   ", { strategies: [spy], nlp: null });
  assert.equal(rec.parsed, null);
  assert.deepEqual(rec.results, []);
  assert.equal(ran, false);
});
