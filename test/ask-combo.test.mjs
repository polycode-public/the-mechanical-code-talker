// ask-combo.test.mjs — Cycle-5 INTERPRETER levers: the B1 COMBO cells that scored 0
// in cycle 004 (composition), grain-aware counting, and the traversal-miss voice nit.
// Driven END-TO-END against the committed fixture (test/fixtures/entities.fixture.json)
// so every assertion exercises the real parseQuery -> resolveObject -> traverse -> render
// pipeline WITH the contextId (focus) / prev (previous answer) that the chat surface
// threads for a discourse-reference follow-up.
//
// LEVER 1 — COMPOSITION: negation/complement + passive frames now compose UNDER
//   pronoun-binding (contextId) and discourse reference (prev). "which classes don't
//   inherit from it", "what doesn't it import", "how many of those are tested",
//   "count them" all resolve the pronoun/prior-set BEFORE the negation/count frame.
// LEVER 3 — GRAIN-AWARE COUNT: "how many commits touched <symbol>" counts at symbol
//   grain (touchesSymbol), not the module-coarse scan that returned a false 0.
// VOICE NIT — the reverse zero-hit reads "No <plural> found that directly <verb> X",
//   dropping the redundant "whose module" while keeping the traversal receipt.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEntities } from "../src/codegraph.mjs";
import { nlpAdapter } from "../src/adapters/ask-nlp.mjs";
import { parseQuery, ask } from "../src/ask.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const graph = parseEntities(JSON.parse(readFileSync(FIXTURE, "utf8")));
const nlp = nlpAdapter();
const idOf = (label) => graph.individuals.find((i) => i.label === label).id;
const runAsk = (q, opts = {}) => ask(graph, q, { nlp, ...opts });
const labels = (r) => r.tmct_ask.matches.map((m) => m.label).sort();

// ============================================================================
// LEVER 1 — B1 COMBO composition (pronoun-binding / discourse reference)
// ============================================================================

test("pron+neg: 'which modules don't import it' resolves 'it' via focus THEN complements", () => {
  // it = a.mjs; importers of a.mjs are b, c, e → the complement is everyone else.
  assert.deepEqual(labels(runAsk("which modules don't import it", { contextId: idOf("app/lib/a.mjs") })),
    ["app/functions/d/handler.mjs", "app/lib/a.mjs", "app/lib/f.mjs", "app/unit-tests/b.test.mjs", "scripts/g.mjs"]);
});

test("pron+neg (class): 'which classes don't inherit from it' with focus = Base → Base, Button", () => {
  assert.deepEqual(labels(runAsk("which classes don't inherit from it", { contextId: idOf("Base") })),
    ["Base", "Button"]);
});

test("pron+neg (forward): 'what doesn't it import' = the import universe MINUS what it imports", () => {
  const p = parseQuery("what doesn't it import", { nlp });
  assert.equal(p.node, "forwardComplement");
  assert.equal(p.kind, "imports");
  // it = e.mjs; the complement is every module e.mjs does NOT import.
  const imported = new Set(labels(runAsk("what does app/lib/e.mjs import")));
  const complement = labels(runAsk("what doesn't it import", { contextId: idOf("app/lib/e.mjs") }));
  assert.ok(complement.length > 0, "a real complement, not empty");
  assert.ok(complement.every((m) => !imported.has(m)), "no imported module leaks into the complement");
  assert.ok(complement.every((m) => graph.byId.get(idOf(m)).class === "Module"), "the universe is bounded to Module grain");
});

test("forward-negation REGRESSION: the affirmative 'what does X import' is untouched", () => {
  assert.deepEqual(labels(runAsk("what does app/lib/e.mjs import")), ["app/lib/a.mjs", "app/lib/f.mjs"]);
  // and a focus-less pronoun never guesses — an honest blank, not a fabricated set.
  assert.equal(runAsk("what doesn't it import").tmct_ask.miss, true);
});

test("disc+count: 'how many of those [are tested]' counts the PRIOR answer set", () => {
  const prev = runAsk("which modules import app/lib/a.mjs").tmct_ask.matches.map((m) => m.id); // b, c, e
  assert.match(runAsk("how many of those", { prev }).content, /^3 /);
  // exactly one of {b,c,e} is tested (b.mjs) → 1.
  assert.match(runAsk("how many of those are tested", { prev }).content, /^1 /);
});

test("disc+count: bare 'count them' / 'count those' / 'list them' are anaphora over prev", () => {
  const prev = runAsk("which classes inherit from Base").tmct_ask.matches.map((m) => m.id); // Widget
  assert.match(runAsk("count them", { prev }).content, /^1 /);
  assert.match(runAsk("count those", { prev }).content, /^1 /);
  assert.match(runAsk("list them", { prev }).content, /Widget/);
  // no prev → the honest "needs a previous answer" miss, never a guess.
  assert.equal(runAsk("count them").tmct_ask.miss, true);
});

// ============================================================================
// LEVER 3 — grain-aware counting (commits × symbol/module grain)
// ============================================================================

test("count+temp grain: 'how many commits touched <symbol>' counts at SYMBOL grain", () => {
  // Widget.render carries a touchesSymbol edge from abc1234 → 1, not the false 0 the
  // module-coarse scan used to return.
  assert.match(runAsk("how many commits touched Widget.render").content, /^1 commit\.$/);
  assert.deepEqual(labels(runAsk("which commits touched Widget.render")), ["abc1234"]);
});

test("count+temp grain: 'how many commits touched <module>' stays at MODULE grain", () => {
  assert.match(runAsk("how many commits touched app/lib/a.mjs").content, /^1 commit\.$/);
  // a symbol with no touchesSymbol edge is an honest 0, not a module-grain false hit.
  assert.match(runAsk("how many commits touched fnAlpha").content, /^0 commits\.$/);
});

test("grain FIX: null-entityType 'what calls <fn>' reads the callsSymbol grain (Widget.render → fnAlpha)", () => {
  // CORRECTNESS FIX (cycle W2P): a bare "what calls fnAlpha" now reads the fn/method-precise
  // callsSymbol edge when its RESOLVED OBJECT is a fine symbol — not only when a fine SUBJECT
  // grain was named. Widget.render --callsSymbol--> fnAlpha is a real caller the old module-
  // coarse `calls` scan silently ignored (BEFORE: traversal "calls edges where object =
  // fnAlpha", miss:true). The honest answer names it.
  const r = runAsk("i was wondering what calls fnAlpha");
  assert.equal(r.tmct_ask.traversal, "callsSymbol edges where object = fnAlpha");
  assert.equal(r.tmct_ask.miss, false);
  assert.match(r.content, /Widget\.render/);
});

// ============================================================================
// 0.8.2 WS1 — forward call union (symbol-grain subject scans coarse+sibling)
// ============================================================================

test("forward union: 'what does Widget.render call' reads calls+callsSymbol (fn->fn), names fnAlpha", () => {
  // BEFORE: kind "calls" scanned only the module-coarse edges, whose subjects are
  // modules — a Method subject answered "no calls edges" while the reverse worked.
  const r = runAsk("what does Widget.render call");
  assert.equal(r.tmct_ask.miss, false);
  assert.equal(r.tmct_ask.traversal, "calls+callsSymbol edges where subject = Widget.render",
    "the receipt names what was actually scanned");
  assert.deepEqual(labels(r), ["fnAlpha"]);
});

test("forward union: a MODULE subject is byte-stable (modules never carry callsSymbol)", () => {
  const r = runAsk("what does scripts/g.mjs call");
  assert.equal(r.content, "app/lib/a.mjs.");
  assert.equal(r.tmct_ask.traversal, "calls edges where subject = scripts/g.mjs",
    "coarse-only scan and receipt, exactly as before");
});

test("forward union: a fine subject with NO sibling edges is still the honest empty", () => {
  const r = runAsk("what does fnAlpha call"); // fnAlpha calls nothing recorded
  assert.equal(r.tmct_ask.miss, true);
  assert.equal(r.tmct_ask.traversal, "calls+callsSymbol edges where subject = fnAlpha");
});

// ============================================================================
// 0.8.2 WS1 — fine-grain family fallback (Function<->Method on an empty exact class)
// ============================================================================

test("family fallback: 'which functions call fnAlpha' widens to the Method caller Widget.render", () => {
  // The only recorded caller is class Method; the exact Function filter used to
  // return the false empty (the standing gq-functions-call-fnalpha baselineFail).
  const r = runAsk("which functions call fnAlpha");
  assert.equal(r.tmct_ask.miss, false);
  assert.match(r.content, /Widget\.render/);
  assert.equal(r.tmct_ask.traversal,
    "callsSymbol edges where object = fnAlpha, widened to Method subjects (no Function recorded)",
    "the widening is noted in the traversal");
});

test("family fallback is FALLBACK-ONLY: the exact-class answer is byte-identical when non-empty", () => {
  // entityType Method matches the caller directly — no widening, no note.
  const r = runAsk("which methods call fnAlpha");
  assert.equal(r.content, "in app/lib/b.mjs there is function Widget.render().");
  assert.equal(r.tmct_ask.traversal, "callsSymbol edges where object = fnAlpha");
  // and the null-entityType path (no class filter at all) is untouched too.
  const bare = runAsk("i was wondering what calls fnAlpha");
  assert.equal(bare.tmct_ask.traversal, "callsSymbol edges where object = fnAlpha");
  assert.match(bare.content, /Widget\.render/);
});

test("family fallback: a truly-uncalled symbol keeps the honest empty (no sibling subjects either)", () => {
  const r = runAsk("which functions call Widget.render");
  assert.equal(r.tmct_ask.miss, true);
  assert.equal(r.tmct_ask.traversal, "callsSymbol edges where object = Widget.render",
    "no widening note when there was nothing to widen to");
});

// ============================================================================
// 0.8.2 WS1 — meta-lookup fallback to real entities
// ============================================================================

test("meta fallback: 'what is a Widget' answers with the code-graph Class one-liner, not the vocabulary miss", () => {
  const r = runAsk("what is a Widget");
  assert.equal(r.tmct_ask.miss, false);
  assert.equal(r.content,
    'Widget is a class in this codebase, located in app/lib/b.mjs — try "describe Widget" or "which classes inherit from Widget".');
});

test("meta fallback: the label match is exact case-insensitive ('what is a widget' hits Widget)", () => {
  const r = runAsk("what is a widget");
  assert.equal(r.tmct_ask.miss, false);
  assert.match(r.content, /^Widget is a class in this codebase/);
});

test("meta fallback: a both-miss term keeps the current honest vocabulary miss", () => {
  const r = runAsk("what is a doohickey");
  assert.equal(r.tmct_ask.miss, true);
  assert.match(r.content, /"doohickey" isn't a term in this graph's own vocabulary/);
});

// ============================================================================
// VOICE NIT — the reverse zero-hit reads naturally
// ============================================================================

test("reverse zero-hit: honest empty with the traditional phrasing; the receipt rides the envelope", () => {
  // (A cycle-5 voice-nit rephrasing was reverted — the frozen v1 cases.jsonl pins the
  // "whose module directly <verb>s X" wording, and the case set is sacred mid-arc.
  // 0.8.2 WS1: the " (traversal: …)" tail left the prose; the receipt still flows on
  // tmct_ask.traversal → chat's detail, so why/verbose re-renders surface it.)
  const r = runAsk("which modules test app/lib/f.mjs"); // nothing tests f.mjs → honest empty
  assert.match(r.content, /No modules found whose module directly tests app\/lib\/f\.mjs\./);
  assert.doesNotMatch(r.content, /\(traversal:/, "the prose is plain words now");
  assert.equal(r.tmct_ask.traversal, "tests edges where object = app/lib/f.mjs", "receipt kept on the envelope for the why-path");
});
