// interpret.test.mjs — the multi-strategy interpretation pipeline
// (interpret/pipeline.mjs + interpret/merge.mjs) and the normalization pre-pass
// record. The LEGACY behaviors (two-strategy agree/disagree over real
// queries) stay pinned by ask.test.mjs/ask-dual-strategy.test.mjs; these tests
// prove the pipeline's own contract: N-strategy registration, same-class dedupe,
// distinct-class "if you mean X then …" surround, and crash isolation (a throwing
// strategy is dropped, never fatal).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { interpret, STRATEGIES, normalizeInput, runStrategiesSync } from "../../src/domain/interpret/pipeline.mjs";
import { mergeStrategyResults, alternateLines, sameParse } from "../../src/domain/interpret/merge.mjs";
import {
  applyPreambleFrames, applySubordinationFrames, applySelfCorrectionFrames, applyConditionalFrames,
  COUNTERFACTUAL_RE, normalizeQuery, datedTeachSuffix, fillerClausePrefix, leadsInterrogative,
} from "../../src/domain/interpret/normalize.mjs";
import { stripNoise } from "../../src/domain/interpret/strategies/noise-strip.mjs";
import { parseQuery, ask } from "../../src/domain/ask.mjs";
import { nlpAdapter } from "../../src/adapters/ask-nlp.mjs";
import { setDefaultNlpAdapter } from "../../src/domain/interpret/nlp-registry.mjs";

// The wink stop-word tier tests below use the DEFAULT adapter, so this file
// wires the composition itself, the same way the product surfaces do.
setDefaultNlpAdapter(nlpAdapter);
import { buildEntities } from "../../src/adapters/graph-build.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { ingestSchemaDocs } from "../../src/tools/schema-docs.mjs";

// The richer committed fixture (imports + tests edges) — the local MODULES set
// below has neither, so the conditional-qualifier/counterfactual tests (which
// need real import AND test-coverage data) load it directly, mirroring
// wiring-facts.test.mjs's convention.
const RICH_FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));
function richGraph() { return parseEntities(JSON.parse(readFileSync(RICH_FIXTURE, "utf8"))); }

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

test("normalize: emphatic trailing \"??\" is repaired — the parse and the answer match the single-\"?\" phrasing", () => {
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

test("noise-strip: stripNoise removes curated noise but never grammar words, Capitalized names, or dotted terms", () => {
  const { text, dropped } = stripNoise("man which modules import myFile.mjs", null);
  assert.equal(text, "which modules import myFile.mjs");
  assert.deepEqual(dropped, ["man"]);
  const untouched = stripNoise("does Base import walk.mjs", null);
  assert.deepEqual(untouched.dropped, []);
});

test("noise-strip: NEW tolerant behavior — a vocative-led question whose honest answer is NEGATIVE now answers like the clean phrasing (it missed as \"couldn't resolve\" before)", () => {
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

test("noise-strip: the wink stop-word tier — a leading adverb wink flags (\"anyway\") strips the same way", () => {
  const graph = buildGraph();
  const noisy = ask(graph, "anyway which modules import myFile.mjs");
  const clean = ask(graph, "which modules import myFile.mjs");
  assert.equal(noisy.content, clean.content);
  assert.doesNotMatch(noisy.content, /couldn't resolve/);
});

test("noise-strip: positive answers come back IDENTICAL to the clean phrasing (no relaxation preamble, no announcement)", () => {
  const graph = buildGraph();
  const noisy = ask(graph, "hey man which modules import src/logging.mjs");
  const clean = ask(graph, "which modules import src/logging.mjs");
  assert.equal(noisy.content, clean.content);
  assert.doesNotMatch(noisy.content, /read as|assuming you meant/);
  assert.match(noisy.content, /myFile\.mjs/);
});

test("noise-strip: a vocative-led META question answers like its clean phrasing", () => {
  const graph = buildGraph();
  const noisy = ask(graph, "dude what does cochange mean");
  const clean = ask(graph, "what does cochange mean");
  assert.equal(noisy.content, clean.content);
  assert.equal(noisy.tmct_ask.miss, false);
});

// ============================================================================
// 0.8.2 feel wave (WS2) — closed preamble frames, determiner-insensitive merge,
// has-tests coverage rewrite, sha guard on the authorship frame.
// ============================================================================

// ---- 1. preamble frames (interpret/normalize.mjs applyPreambleFrames, hooked
// inside normalizeQuery before the FILLER strip) ----

test("preamble (greeting): 'hey there, quick question - <Q>' strips to the bare question and answers identically", () => {
  const graph = buildGraph();
  const noisy = "hey there, quick question - which modules import src/logging.mjs?";
  assert.equal(normalizeInput(noisy).text, "which modules import src/logging.mjs?");
  const r = ask(graph, noisy);
  const clean = ask(graph, "which modules import src/logging.mjs");
  assert.equal(r.content, clean.content);
  assert.equal(r.tmct_ask.miss, false);
  assert.match(r.content, /myFile\.mjs/);
});

test("preamble (greeting): delimiter variants — comma, hyphen, em-dash, with/without the quick-question bridge", () => {
  assert.equal(normalizeInput("hi - what calls Logger").text, "what calls Logger");
  assert.equal(normalizeInput("hello there — quick question: what calls Logger?").text, "what calls Logger?");
  assert.equal(normalizeInput("yo, who touched src/logging.mjs").text, "who touched src/logging.mjs");
  assert.equal(normalizeInput("hey, just a quick question - what calls Logger").text, "what calls Logger");
});

test("preamble (greeting): a BARE greeting is untouched by the frame (delimiter + non-empty remainder required)", () => {
  // the frame itself never fires on a bare greeting — chat's conversational lane
  // matches the RAW line ("hey there" ∈ GREET), so the greeting stays a greeting.
  assert.equal(applyPreambleFrames("hey there"), "hey there");
  assert.equal(applyPreambleFrames("hey there,"), "hey there,"); // empty remainder → no strip
  // and a vocative ("hey tmct, …") is NOT a greeting preamble — no delimiter after
  // the greeting word — so it stays for the noise-strip tier that already owns it.
  assert.match(normalizeInput("hey tmct, what calls fnAlpha thanks").text, /tmct/);
});

test("preamble (thanks): 'thanks, <Q>' / 'thanks so much, <Q>' strips to the bare question and answers identically", () => {
  const graph = buildGraph();
  const noisy = "thanks so much, which modules import src/logging.mjs?";
  assert.equal(normalizeInput(noisy).text, "which modules import src/logging.mjs?");
  const r = ask(graph, noisy);
  const clean = ask(graph, "which modules import src/logging.mjs");
  assert.equal(r.content, clean.content);
  assert.equal(r.tmct_ask.miss, false);
  assert.match(r.content, /myFile\.mjs/);
});

test("preamble (thanks): delimiter + phrase variants — 'thanks a lot', 'thank you', 'cheers', 'thx'", () => {
  assert.equal(normalizeInput("thanks, what calls Logger").text, "what calls Logger");
  assert.equal(normalizeInput("thanks a lot - what calls Logger").text, "what calls Logger");
  assert.equal(normalizeInput("thank you, who touched src/logging.mjs").text, "who touched src/logging.mjs");
  assert.equal(normalizeInput("cheers, what calls Logger?").text, "what calls Logger?");
  assert.equal(normalizeInput("thx — what calls Logger").text, "what calls Logger");
});

test("preamble (thanks): a BARE thanks is untouched by the frame (delimiter + non-empty remainder required)", () => {
  assert.equal(applyPreambleFrames("thanks so much"), "thanks so much");
  assert.equal(applyPreambleFrames("thanks,"), "thanks,"); // empty remainder → no strip
});

test("preamble (modal): 'can/could/will you … [, please][?]' unwraps to the bare question", () => {
  const graph = buildGraph();
  assert.equal(normalizeInput("can you tell me which modules import src/logging.mjs, please?").text,
    "which modules import src/logging.mjs");
  assert.equal(normalizeInput("will you show me which modules import src/logging.mjs").text,
    "which modules import src/logging.mjs");
  const r = ask(graph, "could you tell me which modules import src/logging.mjs please");
  assert.equal(r.content, ask(graph, "which modules import src/logging.mjs").content);
});

test("preamble (modal): 'can you tell me a joke' normalizes byte-identically to the bare joke line — the hm-joke wall is preserved", () => {
  const graph = buildGraph();
  assert.equal(normalizeInput("can you tell me a joke").text, normalizeInput("tell me a joke").text);
  const wrapped = ask(graph, "can you tell me a joke");
  assert.equal(wrapped.tmct_ask.miss, true);
  assert.match(wrapped.content, /^couldn't parse this as a graph question/);
  assert.equal(wrapped.content, ask(graph, "tell me a joke").content);
});

test("preamble (show/give-me): an entity remainder bridges to the describe surface", () => {
  assert.equal(normalizeInput("show me the store module").text, "describe store module");
  assert.equal(normalizeInput("can you show me the store module please").text, "describe store module");
  assert.equal(normalizeInput("give me src/logging.mjs").text, "describe src/logging.mjs");
  // the contraction table feeds the bridge ("gimme" → "give me" first)
  assert.equal(normalizeInput("gimme the store module").text, "describe store module");
});

test("preamble (show/give-me): a remainder carrying a relation verb or interrogative lead UNWRAPS to the real query", () => {
  const graph = buildGraph();
  assert.equal(normalizeInput("show me which modules import src/logging.mjs").text,
    "which modules import src/logging.mjs");
  const r = ask(graph, "show me which modules import src/logging.mjs");
  assert.equal(r.content, ask(graph, "which modules import src/logging.mjs").content);
  assert.equal(r.tmct_ask.miss, false);
});

test("preamble (show/give-me): a KIND-listing remainder is left untouched — the compositional list grammar owns it", () => {
  // "show me" is a LIST_TRIGGER; the bridge must not steal the working list shape.
  assert.equal(normalizeInput("show me untested modules").text, "show me untested modules");
  const parsed = parseQuery("show me untested modules", { nlp: null });
  assert.equal(parsed.node, "list");
  assert.deepEqual(parsed.base.filters, ["untested"]);
  // negation-set listings keep their boolean composition after the unwrap too
  const neg = parseQuery("show me modules not importing src/logging.mjs", { nlp: null });
  assert.equal(neg.node, "boolean");
});

// ---- 1b. filler-clause prefixes (interpret/normalize.mjs fillerClausePrefix) ----

test("fillerClausePrefix peels an interjection-plus-comment clause and returns the bare question", () => {
  assert.deepEqual(fillerClausePrefix("oh nice. um what about cats"), { prefix: "oh nice. um", remainder: "what about cats" });
  assert.deepEqual(fillerClausePrefix("ah cool, what is a horse"), { prefix: "ah cool,", remainder: "what is a horse" });
  // a bare interjection with NO delimiter is ordinary content, never peeled
  assert.equal(fillerClausePrefix("oh water is nice"), null);
});

test("fillerClausePrefix peels a bare hesitation particle with no delimiter", () => {
  assert.deepEqual(fillerClausePrefix("um what about cats"), { prefix: "um", remainder: "what about cats" });
  assert.deepEqual(fillerClausePrefix("anyway what is a horse"), { prefix: "anyway", remainder: "what is a horse" });
});

test("fillerClausePrefix peels a meta-announcement clause and its required delimiter", () => {
  assert.deepEqual(
    fillerClausePrefix("one more random thing, what is a horse"),
    { prefix: "one more random thing,", remainder: "what is a horse" },
  );
  // no delimiter after the announcement -> the whole line reads as ordinary
  // content, never a peel
  assert.equal(fillerClausePrefix("quick question what is a horse"), null);
});

test("fillerClausePrefix peels a stack of clauses in one pass", () => {
  assert.deepEqual(
    fillerClausePrefix("sorry, oh nice. um what about cats"),
    { prefix: "sorry, oh nice. um", remainder: "what about cats" },
  );
});

test("fillerClausePrefix peels a hesitation word that doubles as content, and leadsInterrogative declines the non-interrogative remainder", () => {
  // "well" leads FILLER_HESITATIONS, so the peel itself can't tell a
  // discourse hesitation from a content word — the sentence stays safe
  // because nothing downstream ever treats "water is a kind of liquid" as
  // the interrogative half of a write-boundary check.
  assert.deepEqual(
    fillerClausePrefix("well water is a kind of liquid."),
    { prefix: "well", remainder: "water is a kind of liquid." },
  );
  assert.equal(leadsInterrogative("well water is a kind of liquid."), false);
});

test("fillerClausePrefix returns null when the whole line is filler and nothing remains", () => {
  assert.equal(fillerClausePrefix("um"), null);
  assert.equal(fillerClausePrefix("anyway,"), null);
  assert.equal(fillerClausePrefix("quick question,"), null);
});

test("leadsInterrogative sees the question behind a filler clause that QUESTION_LEAD_RE cannot", () => {
  assert.equal(leadsInterrogative("anyway what is a horse"), true);
  assert.equal(leadsInterrogative("anyway horse is nice"), false);
  assert.equal(leadsInterrogative("what is a horse"), true);
});

test("the ack preamble peels a counting aside only when a delimiter follows it", () => {
  assert.equal(applyPreambleFrames("one more, what is a horse"), "what is a horse");
  // no delimiter -> "one more" is the sentence's own quantifier, left intact
  assert.equal(applyPreambleFrames("one more disk rests on peg-a."), "one more disk rests on peg-a.");
});

// ---- 2. determiner-insensitive candidate merge (interpret/merge.mjs) ----

test("merge (determiner): 'the logger' vs 'logger' is agreement, not ambiguity — and the det-less object survives", () => {
  assert.equal(sameParse(
    { shape: "reverse", kind: "imports", object: "the logger" },
    { shape: "reverse", kind: "imports", object: "logger" },
  ), true);
  const parsed = parseQuery("which modules import the logger", { nlp: null });
  assert.equal(parsed.ambiguousParse, undefined, "identical readings must not be surfaced as a choice");
  assert.equal(parsed.object, "logger", "downstream resolution must see the det-less term");
});

test("merge (determiner): genuinely DISTINCT terms still surface as the honest ambiguity", () => {
  const a = REV("alpha");
  const b = REV("the beta"); // det-stripping must not collapse different terms
  const merged = mergeStrategyResults([
    { strategyId: "s1", class: "graph-query", candidates: [{ parsed: a, confidence: 0.9 }] },
    { strategyId: "s2", class: "graph-query", candidates: [{ parsed: b, confidence: 0.7 }] },
  ]);
  assert.equal(merged.parsed.ambiguousParse, true);
});

// ---- 3. has-tests → coverage rewrite (normalize.mjs PHRASING_FRAMES) ----

test("has-tests: 'does X have tests' / 'is X tested' rewrite onto the coverage question (no more defines-edge garble)", () => {
  const graph = buildGraph();
  assert.equal(normalizeInput("does myFile.mjs have tests").text, "what tests myFile.mjs");
  assert.equal(normalizeInput("do the handlers have any tests?").text, "what tests the handlers");
  assert.equal(normalizeInput("does startup have test coverage").text, "what tests startup");
  assert.equal(normalizeInput("is myFile.mjs tested").text, "what tests myFile.mjs");
  const r = ask(graph, "does myFile.mjs have tests");
  assert.doesNotMatch(r.content, /defines edge/, "the has→defines misparse must be gone");
  assert.match(r.content, /No tests cover myFile\.mjs/);
  assert.equal(r.content, ask(graph, "what tests myFile.mjs").content);
});

test("has-tests Function-grain up-refine: 'does createTask have tests' resolves the Function correctly, then refines to its containing module (parity with the bare 'tests' verb question)", () => {
  // Hand-built graph (mirrors ask.test.mjs's grain-collision fixture pattern): a
  // real Function individual, defined-in a Module that a separate test module
  // covers via mgx:testsCoverage — the module-coarse edge the tests kind actually
  // stores; no edge can ever point AT a Function directly for this kind.
  const individuals = [
    { id: "mod:src/foo.mjs", label: "src/foo.mjs", class: "Module", attributes: [] },
    { id: "mod:test/foo.test.mjs", label: "test/foo.test.mjs", class: "Module", attributes: [] },
    { id: "fn:src/foo.mjs#createTask", label: "createTask", class: "Function", attributes: [] },
  ];
  const graph = {
    individuals, byId: new Map(individuals.map((i) => [i.id, i])), proseIndex: {}, truncated: [],
    relations: [
      {
        predicate: "seon:declaresMethod", prop: "seon:declaresmethod", count: 1,
        edges: [{ subject: "mod:src/foo.mjs", object: "fn:src/foo.mjs#createTask", subjectLabel: "src/foo.mjs", objectLabel: "createTask" }],
      },
      {
        predicate: "mgx:testsCoverage", prop: "mgx:testscoverage", count: 1,
        edges: [{ subject: "mod:test/foo.test.mjs", object: "mod:src/foo.mjs", subjectLabel: "test/foo.test.mjs", objectLabel: "src/foo.mjs" }],
      },
    ],
  };
  assert.equal(normalizeInput("does createTask have tests").text, "what tests createTask");
  const viaHasTests = ask(graph, "does createTask have tests");
  const viaTestsVerb = ask(graph, "what tests createTask");
  assert.equal(viaHasTests.tmct_ask.miss, false);
  assert.match(viaHasTests.content, /test\/foo\.test\.mjs/);
  assert.equal(viaHasTests.content, viaTestsVerb.content);
  assert.match(viaHasTests.tmct_ask.traversal, /refined from createTask to its containing module/);
});

test("has-tests guards: members questions and negated forms are NOT captured", () => {
  // "does X have methods" stays the members family, never a coverage rewrite
  assert.equal(normalizeInput("does Widget have methods").text, "does Widget have methods");
  // a negated subject span keeps its own set-complement handling downstream
  assert.equal(normalizeInput("is myFile.mjs not tested").text, "is myFile.mjs not tested");
  // the agent-marked passive keeps its own path (anchor is is/are, not which/what)
  assert.match(normalizeInput("which modules are tested by b.test.mjs").text, /^which modules are tested by/);
});

// ---- 4. sha guard on the authorship frame (normalize.mjs PHRASING_FRAMES) ----

test("authorship sha guard: a commit-sha object is NOT rewritten to 'who touched' (the author lane consumes it)", () => {
  assert.equal(normalizeInput("who is the author of abc1234").text, "who is the author of abc1234");
  assert.equal(normalizeInput("who wrote deadbeefcafe").text, "who wrote deadbeefcafe");
  assert.equal(normalizeInput("who authored commit abc1234").text, "who authored commit abc1234");
});

test("authorship sha guard: non-sha objects (files/symbols/anaphora) keep the touch rewrite", () => {
  assert.equal(normalizeInput("who is the author of walk.mjs").text, "who touched walk.mjs");
  assert.equal(normalizeInput("who wrote src/logging.mjs?").text, "who touched src/logging.mjs");
  // hex-looking but dotted → a module name, still rewritten
  assert.equal(normalizeInput("who wrote deadbeef.mjs").text, "who touched deadbeef.mjs");
  // anaphora rides through untouched
  assert.equal(normalizeInput("who wrote it").text, "who touched it");
});

test("noise-strip: the strategy never fires when the anchored grammar owns the text as-given", async () => {
  // anchored parses this whole sentence (T2), noise ("the") and all — the
  // strategy must yield null rather than compete with the grammar's own parse.
  const rec = await interpret("which modules import myFile.mjs", { nlp: null });
  assert.ok(!rec.results.some((r) => r.strategyId === "noise-strip"));
  // and the pinned two-strategy ambiguity stays exactly the legacy surface
  const amb = parseQuery("which classes extends Base and couples to logging");
  assert.equal(amb.ambiguousParse, true);
  assert.equal(amb.candidates.length, 2);
});

// ============================================================================
// Closed-frame subordination + conditionals, wired inside normalizeQuery (interpret/
// normalize.mjs) so both parse strategies see the rewritten text for free.
// ============================================================================

test("subordination: a leading framing clause strips to the bare question and answers identically", () => {
  const graph = buildGraph();
  const noisy = "since we're refactoring, which modules import src/logging.mjs?";
  assert.equal(applySubordinationFrames(noisy), "which modules import src/logging.mjs?");
  assert.equal(normalizeInput(noisy).text, "which modules import src/logging.mjs?");
  const r = ask(graph, noisy);
  const clean = ask(graph, "which modules import src/logging.mjs");
  assert.equal(r.content, clean.content);
  assert.equal(r.tmct_ask.miss, false);
});

test("subordination: the closed conjunction family (although/though/while/because/whereas/given that/now that)", () => {
  assert.equal(applySubordinationFrames("although this seems odd, who touched src/logging.mjs"), "who touched src/logging.mjs");
  assert.equal(applySubordinationFrames("though it's late, what calls Logger"), "what calls Logger");
  assert.equal(applySubordinationFrames("while you're at it, what calls Logger"), "what calls Logger");
  assert.equal(applySubordinationFrames("because i'm curious, who touched src/logging.mjs"), "who touched src/logging.mjs");
  assert.equal(applySubordinationFrames("whereas before, what calls Logger"), "what calls Logger");
  assert.equal(applySubordinationFrames("given that we shipped, who touched src/logging.mjs"), "who touched src/logging.mjs");
  assert.equal(applySubordinationFrames("now that it's stable, what calls Logger"), "what calls Logger");
});

test("subordination: a BARE clause (no delimiting comma) is untouched, and ordinary 'since' content stays intact", () => {
  assert.equal(applySubordinationFrames("since we're refactoring"), "since we're refactoring"); // empty remainder → no strip
  assert.equal(applySubordinationFrames("modules changed since last week"), "modules changed since last week");
});

// ---- self-correction: a
// mid-sentence false start ("what -- sorry, who inherits from Record") used to break
// term resolution — "couldn't resolve one of the terms in this question" — because
// the abandoned fragment/dash debris fed straight into term extraction. Same closed-
// frame, delimiter-anchored strip discipline as the subordination frames above. ----

test("self-correction: a false-start fragment before 'sorry,' strips to the bare question and answers identically", () => {
  const graph = richGraph();
  assert.equal(
    applySelfCorrectionFrames("what -- sorry, which classes inherit from Base"),
    "which classes inherit from Base",
  );
  assert.equal(normalizeQuery("what -- sorry, which classes inherit from Base"), "which classes inherit from Base");
  const r = ask(graph, "what -- sorry, which classes inherit from Base");
  const clean = ask(graph, "which classes inherit from Base");
  assert.equal(r.content, clean.content);
  assert.equal(r.tmct_ask.miss, false);
});

test("self-correction: the restarted question-word can differ from the abandoned one ('who -- sorry, what …')", () => {
  assert.equal(
    applySelfCorrectionFrames("who -- sorry, what inherits from Base"),
    "what inherits from Base",
  );
});

test("self-correction: a multi-word false start + 'i mean,' delimiter also strips", () => {
  assert.equal(
    applySelfCorrectionFrames("what is a class -- i mean, what is a module"),
    "what is a module",
  );
});

test("self-correction: delimiter variants — em-dash, no leading dash at all, trailing colon", () => {
  assert.equal(applySelfCorrectionFrames("what — sorry, who touched Base"), "who touched Base");
  assert.equal(applySelfCorrectionFrames("what, sorry, who touched Base"), "who touched Base");
  assert.equal(applySelfCorrectionFrames("what -- i mean: who touched Base"), "who touched Base");
});

test("self-correction: a stacked restart peels to the FINAL restart", () => {
  assert.equal(
    applySelfCorrectionFrames("what -- sorry, who -- sorry, what inherits from Base"),
    "what inherits from Base",
  );
});

test("self-correction: ordinary text with no restart marker is untouched — a bare em-dash aside is NOT mistaken for a restart", () => {
  assert.equal(applySelfCorrectionFrames("which modules import src/logging.mjs"), "which modules import src/logging.mjs");
  assert.equal(
    applySelfCorrectionFrames("modules — like Base — that inherit from Widget"),
    "modules — like Base — that inherit from Widget",
  );
});

test("conditional (qualifier composition): 'if a module imports X, is it tested' compiles to the working boolean-qualifier shape and answers correctly", () => {
  const graph = richGraph();
  assert.equal(
    applyConditionalFrames("if a module imports app/lib/a.mjs, is it tested"),
    "modules importing app/lib/a.mjs and tested",
  );
  const r = ask(graph, "if a module imports app/lib/a.mjs, is it tested");
  const clean = ask(graph, "modules importing app/lib/a.mjs and tested");
  assert.equal(r.content, clean.content);
  assert.equal(r.tmct_ask.miss, false);
  assert.match(r.content, /app\/lib\/b\.mjs/, "only the ACTUALLY-tested importer (b.mjs), not the whole import set");
});

test("conditional (qualifier composition): 'that'/'this' subject forms and a different relation verb", () => {
  assert.equal(
    applyConditionalFrames("if a class inherits from Base, is that tested"),
    "classes inheriting from Base and tested",
  );
  assert.equal(
    applyConditionalFrames("if a commit touches app/lib/a.mjs, is this exported"),
    "commits touching app/lib/a.mjs and exported",
  );
});

test("conditional (counterfactual): 'if X were deleted, what would break' compiles to the transitive reverse-dependency closure and answers correctly", () => {
  const graph = richGraph();
  assert.equal(
    applyConditionalFrames("if app/lib/a.mjs were deleted, what would break"),
    "which modules transitively import app/lib/a.mjs",
  );
  assert.match("if app/lib/a.mjs were deleted, what would break", COUNTERFACTUAL_RE);
  const r = ask(graph, "if app/lib/a.mjs were deleted, what would break");
  const clean = ask(graph, "which modules transitively import app/lib/a.mjs");
  assert.equal(r.content, clean.content);
  assert.equal(r.tmct_ask.miss, false);
});

test("conditional (counterfactual): 'was removed'/'might fail'/'could be affected' variants", () => {
  assert.equal(
    applyConditionalFrames("if app/lib/a.mjs was removed, what might fail"),
    "which modules transitively import app/lib/a.mjs",
  );
  assert.equal(
    applyConditionalFrames("if app/lib/a.mjs were deleted, what could be affected"),
    "which modules transitively import app/lib/a.mjs",
  );
});

test("conditional: an unrecognized kind/verb/qualifier is left UNMATCHED — an honest miss, never a guessed composition", () => {
  // "widget" isn't in the closed CONDITIONAL_KIND_PLURAL table
  assert.equal(applyConditionalFrames("if a widget imports X, is it tested"), "if a widget imports X, is it tested");
  // "shiny" isn't a recognized qualifier
  assert.equal(applyConditionalFrames("if a module imports X, is it shiny"), "if a module imports X, is it shiny");
  // a plain non-conditional question is untouched
  assert.equal(applyConditionalFrames("which modules import X"), "which modules import X");
});

test("politeness wrappers with an embedded question unwrap AND de-invert: 'could you tell me what a dog is' -> 'what is a dog'", () => {
  assert.equal(applyPreambleFrames("could you tell me what a dog is"), "what is a dog");
  assert.equal(applyPreambleFrames("tell me what a dog is"), "what is a dog");
  assert.equal(applyPreambleFrames("do you know what a dog is"), "what is a dog");
  assert.equal(applyPreambleFrames("i'd like to know what a dog is"), "what is a dog");
  assert.equal(applyPreambleFrames("i want to know what a guinea pig is"), "what is a guinea pig");
});

test("embedded-question de-inversion stands alone too: 'what a dog is' -> 'what is a dog', 'what dog means' -> 'what does dog mean'", () => {
  assert.equal(applyPreambleFrames("what a dog is"), "what is a dog");
  assert.equal(applyPreambleFrames("do you know what dog means"), "what does dog mean");
});

test("a leading connective is stripped from a bare relative-clause follow-up, so the utterance reads as its own bare form", () => {
  // The remainder names a thing instead of asking outright, so none of the
  // interrogative/auxiliary gates fire — without the relative-clause gate the
  // connective survives and the parser reads "and" as the subject.
  assert.equal(applyPreambleFrames("and the tests that cover it"), "the tests that cover it");
  assert.equal(applyPreambleFrames("so the module that imports http.mjs"), "the module that imports http.mjs");
  assert.equal(applyPreambleFrames("but the classes which extend Base"), "the classes which extend Base");
  assert.equal(applyPreambleFrames("and the author who touched it"), "the author who touched it");
});

test("the relative-clause strip leaves a mid-clause boolean branch and a bare noun remainder alone", () => {
  // "and are tested" is a set operator over the previous clause, not framing.
  assert.equal(applyPreambleFrames("and are tested"), "are tested");
  // no relative pronoun -> the connective is not framing, so it stays put
  assert.equal(applyPreambleFrames("and the payment class"), "and the payment class");
  // a determiner-less remainder is out of the closed shape
  assert.equal(applyPreambleFrames("and tests that cover it"), "and tests that cover it");
});

test("the know/want wrappers never unwrap a non-interrogative remainder, and long relative clauses are never re-inverted", () => {
  // small-talk stays small-talk
  assert.equal(applyPreambleFrames("do you know anything about movies"), "do you know anything about movies");
  // a >3-word subject is out of the closed de-inversion shape
  assert.equal(
    applyPreambleFrames("what the parser in the old branch is"),
    "what the parser in the old branch is",
  );
  // the direct question passes through unchanged (no rewrite loop)
  assert.equal(applyPreambleFrames("what is a dog"), "what is a dog");
});

test("datedTeachSuffix recognizes the three closed date forms and strips the suffix", () => {
  assert.deepEqual(
    datedTeachSuffix("the evening star's owner is edmund as of 2019"),
    { stripped: "the evening star's owner is edmund", observedAt: "2019-01-01T00:00:00.000Z", dateText: "2019" },
  );
  assert.deepEqual(
    datedTeachSuffix("the evening star's owner is edmund as of 2019-03-01"),
    { stripped: "the evening star's owner is edmund", observedAt: "2019-03-01T00:00:00.000Z", dateText: "2019-03-01" },
  );
  assert.deepEqual(
    datedTeachSuffix("the evening star's owner is edmund as of march 2019"),
    { stripped: "the evening star's owner is edmund", observedAt: "2019-03-01T00:00:00.000Z", dateText: "march 2019" },
  );
  // month + year only carries the year+month down to the 1st — the START of
  // the named period, never the middle or end.
  assert.equal(datedTeachSuffix("x is y as of december 2020").observedAt, "2020-12-01T00:00:00.000Z");
  // trailing punctuation is tolerated
  assert.equal(datedTeachSuffix("x is y as of 2019.").stripped, "x is y");
  assert.equal(datedTeachSuffix("x is y as of 2019!").stripped, "x is y");
});

test("datedTeachSuffix rejects every non-'as of' trigger and locative-ambiguous bare years", () => {
  assert.equal(datedTeachSuffix("x is y as at 2019"), null);
  assert.equal(datedTeachSuffix("x is y back in 2019"), null);
  assert.equal(datedTeachSuffix("the dog is in 2019"), null);
  // no content left once the suffix is stripped — nothing to teach
  assert.equal(datedTeachSuffix("as of 2019"), null);
  // no suffix at all
  assert.equal(datedTeachSuffix("x is y"), null);
});

test("datedTeachSuffix returns every parsed instant Date.parse-able, and every returned instant is midnight UTC", () => {
  for (const text of ["x is y as of 2019", "x is y as of 2019-07-15", "x is y as of july 2019"]) {
    const hit = datedTeachSuffix(text);
    assert.ok(Number.isFinite(Date.parse(hit.observedAt)), `${text} -> ${hit.observedAt} should be Date.parse-able`);
    assert.match(hit.observedAt, /T00:00:00\.000Z$/);
  }
});
