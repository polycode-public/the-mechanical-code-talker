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
import { stripNoise } from "../src/interpret/strategies/noise-strip.mjs";
import { parseQuery, ask } from "../src/ask.mjs";
import { buildEntities } from "../src/graph-build.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import { ingestSchemaDocs } from "../src/schema-docs.mjs";

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

// ---- merge contamination guard: an APPROXIMATE (fuzzy/lemma) candidate may
// never stand in for — or ride alongside — an exact parse. The "assuming you
// meant …" announcement belongs ONLY to answers that actually leaned on the
// approximate tier (ask.test.mjs pins the announced case; here we pin the
// merge-level tier discipline that keeps an exact answer unannounced). ----

test("merge: a fuzzy TWIN of an exact parse is discarded — the exact candidate wins and keeps exact provenance", () => {
  const exact = REV("src/logging.mjs");
  const twin = REV("src/logging.mjs");
  const merged = mergeStrategyResults([
    { strategyId: "grammar", class: "graph-query", candidates: [{ parsed: exact, confidence: 0.9 }] },
    { strategyId: "spell-repair", class: "graph-query", candidates: [{ parsed: twin, confidence: 0.8, via: "fuzzy", note: "assuming you meant src/logging.mjs" }] },
  ]);
  assert.equal(merged.parsed, exact, "the exact strategy's own parse object must win");
  assert.equal(merged.winner.via, null);
  assert.equal(merged.winner.note, null, "the fuzzy twin's announcement note must not leak onto the exact winner");
  assert.deepEqual(merged.alternates, []);
});

test("merge: an approximate DISAGREEING candidate is also discarded when anything parsed exactly (never a forced ambiguity)", () => {
  const exact = REV("alpha");
  const merged = mergeStrategyResults([
    { strategyId: "grammar", class: "graph-query", candidates: [{ parsed: exact, confidence: 0.9 }] },
    { strategyId: "fuzzy-guess", class: "graph-query", candidates: [{ parsed: REV("alfa"), confidence: 0.8, via: "fuzzy" }] },
  ]);
  assert.equal(merged.parsed, exact);
  assert.equal(merged.parsed.ambiguousParse, undefined);
});

test("merge: an approximate candidate DOES win when nothing parsed exactly, provenance preserved", () => {
  const fuzzy = REV("src/logging.mjs");
  const merged = mergeStrategyResults([
    { strategyId: "spell-repair", class: "graph-query", candidates: [{ parsed: fuzzy, confidence: 0.6, via: "fuzzy" }] },
  ]);
  assert.equal(merged.parsed, fuzzy);
  assert.equal(merged.winner.via, "fuzzy");
});

// ============================================================================
// item 10 — normalization repairs + the noise-strip strategy, end-to-end.
// A real graph fixture (mirrors ask.test.mjs's shape): src/logging.mjs is
// imported by myFile.mjs; NOTHING imports myFile.mjs (the honest-negative
// case the relaxation cascade can never rescue — it refuses to relax into a
// miss — which is exactly where noise-strip earns its place).
// ============================================================================

const MODULES = [
  { path: "src/logging.mjs", dotted: "src.logging", imports: [], calls: [],
    defines: [{ name: "Logger", kind: "class", lineno: 1, decorators: [] }] },
  { path: "myFile.mjs", dotted: "myFile", imports: ["src.logging"], calls: [],
    defines: [{ name: "startup", kind: "function", lineno: 3, decorators: [] }] },
];
function buildGraph() {
  const entities = buildEntities(MODULES, []);
  ingestSchemaDocs(entities);
  return parseEntities(entities);
}

test("item 10 (normalize): emphatic trailing \"??\" is repaired — the parse and the answer match the single-\"?\" phrasing", () => {
  const graph = buildGraph();
  assert.deepEqual(
    parseQuery("which modules import src/logging.mjs??"),
    parseQuery("which modules import src/logging.mjs?"),
  );
  const noisy = ask(graph, "which modules import src/logging.mjs??");
  const clean = ask(graph, "which modules import src/logging.mjs");
  assert.equal(noisy.content, clean.content);
  assert.equal(noisy.tmct_ask.miss, false);
  assert.match(noisy.content, /myFile\.mjs/);
  // and the pipeline record says normalization changed the input
  return interpret("which modules import src/logging.mjs??").then((rec) => {
    assert.equal(rec.normalizationChanged, true);
    assert.equal(rec.normalized, "which modules import src/logging.mjs?");
  });
});

test("item 10 (noise-strip): stripNoise removes curated noise but never grammar words, Capitalized names, or dotted terms", () => {
  const { text, dropped } = stripNoise("man which modules import myFile.mjs", null);
  assert.equal(text, "which modules import myFile.mjs");
  assert.deepEqual(dropped, ["man"]);
  const untouched = stripNoise("does Base import walk.mjs", null);
  assert.deepEqual(untouched.dropped, []);
});

test("item 10 (noise-strip): NEW tolerant behavior — a vocative-led question whose honest answer is NEGATIVE now answers like the clean phrasing (it missed as \"couldn't resolve\" before)", () => {
  const graph = buildGraph();
  // nothing imports myFile.mjs: the cascade refuses to relax into a miss, so
  // before this strategy the keyword-spot garbage parse (ask{subject:"man"})
  // died as "couldn't resolve one of the terms in this question."
  const noisy = ask(graph, "hey man which modules import myFile.mjs");
  const clean = ask(graph, "which modules import myFile.mjs");
  assert.equal(noisy.content, clean.content);
  assert.match(noisy.content, /No modules found whose module directly imports myFile\.mjs/);
  assert.equal(noisy.tmct_ask.miss, true); // the honest blank, not a parse failure
  assert.doesNotMatch(noisy.content, /couldn't resolve/);
});

test("item 10 (noise-strip): the wink stop-word tier — a leading adverb wink flags (\"anyway\") strips the same way", () => {
  const graph = buildGraph();
  const noisy = ask(graph, "anyway which modules import myFile.mjs");
  const clean = ask(graph, "which modules import myFile.mjs");
  assert.equal(noisy.content, clean.content);
  assert.doesNotMatch(noisy.content, /couldn't resolve/);
});

test("item 10 (noise-strip): positive answers come back IDENTICAL to the clean phrasing (no relaxation preamble, no announcement)", () => {
  const graph = buildGraph();
  const noisy = ask(graph, "hey man which modules import src/logging.mjs");
  const clean = ask(graph, "which modules import src/logging.mjs");
  assert.equal(noisy.content, clean.content);
  assert.doesNotMatch(noisy.content, /read as|assuming you meant/);
  assert.match(noisy.content, /myFile\.mjs/);
});

test("item 10 (noise-strip): a vocative-led META question answers like its clean phrasing", () => {
  const graph = buildGraph();
  const noisy = ask(graph, "dude what does cochange mean");
  const clean = ask(graph, "what does cochange mean");
  assert.equal(noisy.content, clean.content);
  assert.equal(noisy.tmct_ask.miss, false);
});

test("item 10 (noise-strip): the strategy never fires when the anchored grammar owns the text as-given", async () => {
  // anchored parses this whole sentence (T2), noise ("the") and all — the
  // strategy must yield null rather than compete with the grammar's own parse.
  const rec = await interpret("which modules import myFile.mjs", { nlp: null });
  assert.ok(!rec.results.some((r) => r.strategyId === "noise-strip"));
  // and the pinned two-strategy ambiguity stays exactly the legacy surface
  const amb = parseQuery("which classes extends Base and couples to logging");
  assert.equal(amb.ambiguousParse, true);
  assert.equal(amb.candidates.length, 2);
});
