// ask-negation-passive.test.mjs — the two headline Phase-5 parser levers
// (archive/PLAN_CYCLE_4.md, "Cycle 5 — B1 negation" and "Cycle 6 — reversible-passive"),
// driven END-TO-END against the committed fixture graph (test/fixtures/
// entities.fixture.json) so the assertions exercise the real
// parseQuery -> resolveObject -> traverse -> render pipeline, not a mock.
//
// LEVER 1 — B1 NEGATION (set complement): "which X do not <verb> Y" computes
//   allOfClass(kind) DIFFERENCE (the positive result set). The three mandatory
//   regression guards are pinned: (1) an empty complement stays an HONEST miss and
//   never re-trips the literal-'not' trap; (2) the bounded universe — a complement
//   over the non-enumerable "changes" pseudo-type is REFUSED honestly; (3) active-
//   voice/positive queries are byte-identical to before.
// LEVER 2 — REVERSIBLE-PASSIVE (direction swap): a passive auxiliary + an agent-
//   marking "by" flips subject/object roles. The active-voice guard is pinned:
//   "which modules import X" keeps its reverse direction, and an active "by" that is
//   part of a verb phrase ("touched by commit") never trips the passive detector.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseEntities } from "../src/codegraph.mjs";
import { nlpAdapter } from "../src/ask-nlp.mjs";
import { parseQuery, ask } from "../src/ask.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const graph = parseEntities(JSON.parse(readFileSync(FIXTURE, "utf8")));
const nlp = nlpAdapter();
const labels = (r) => r.tmct_ask.matches.map((m) => m.label).sort();
const runAsk = (q) => ask(graph, q, { nlp });

// ============================================================================
// LEVER 1 — B1 NEGATION (set complement)
// ============================================================================

test("negation HIT: 'which modules do not import a.mjs' = all modules MINUS the importers", () => {
  const p = parseQuery("which modules do not import app/lib/a.mjs", { nlp });
  assert.equal(p.node, "boolean", "a set-negation compiles to a boolean-difference AST");
  assert.equal(p.entityType, "Module");
  assert.equal(p.atoms[0].op, "seed");
  assert.equal(p.atoms[0].ast.node, "allOfClass", "the seed is the bounded universe of the kind");
  assert.equal(p.atoms[1].op, "difference");
  // importers of a.mjs are b, c, e — everything else is the complement.
  assert.deepEqual(labels(runAsk("which modules do not import a.mjs")),
    ["app/functions/d/handler.mjs", "app/lib/a.mjs", "app/lib/f.mjs", "app/unit-tests/b.test.mjs", "scripts/g.mjs"]);
});

test("negation HIT: the contracted 'don't' and the gerund 'not importing' phrasings agree", () => {
  const complement = ["app/functions/d/handler.mjs", "app/lib/a.mjs", "app/lib/f.mjs", "app/unit-tests/b.test.mjs", "scripts/g.mjs"];
  assert.deepEqual(labels(runAsk("modules not importing a.mjs")), complement);
  // "which classes don't inherit from Base" — Base's only subclass is Widget.
  assert.deepEqual(labels(runAsk("which classes don't inherit from Base")), ["Base", "Button"]);
  // "classes that do not inherit from Base" — the relative-pronoun phrasing.
  assert.deepEqual(labels(runAsk("classes that do not inherit from Base")), ["Base", "Button"]);
});

test("negation HIT: the complement composes under a count ('how many X are not tested')", () => {
  // tested modules are b.mjs and handler.mjs (2); 8 modules total → 6 untested.
  assert.match(runAsk("how many modules are not tested").content, /^6 modules\.$/);
  // Widget is the only tested class (in the tested module b.mjs) → Base, Button untested.
  assert.match(runAsk("how many classes are not tested").content, /^2 classes\.$/);
});

test("negation HIT: existential negation ('do not import/define anything') = subjects with no such edge", () => {
  assert.deepEqual(labels(runAsk("which modules do not import anything")),
    ["app/lib/a.mjs", "app/unit-tests/b.test.mjs", "scripts/g.mjs"]);
});

// ---- GUARD 1: honest-empty stays honest (never invents a member, never re-trips the
// literal-'not' trap). "which functions are not exported" is a TRUE empty result. ----
test("negation GUARD 1: an empty complement is an HONEST miss, never the literal-'not' trap", () => {
  const r = runAsk("which functions are not exported");
  assert.equal(r.tmct_ask.miss, true, "an empty set complement stays an honest miss");
  assert.doesNotMatch(r.content, /matching "not"/, "the 'not' is consumed — it must never leak into an object term");
  assert.doesNotMatch(r.content, /couldn't resolve one of the terms/);
  assert.match(r.content, /nothing in the index matches that/);
});

// ---- GUARD 2: bounded universe only. The "Change" pseudo-type is a wildcard, not an
// enumerable stored class, so a complement over "changes" must be REFUSED honestly. ----
test("negation GUARD 2: a complement over the non-enumerable 'changes' pseudo-type is refused honestly", () => {
  const r = runAsk("which changes do not touch abc1234");
  assert.equal(r.tmct_ask.miss, true);
  assert.match(r.content, /isn't an enumerable kind/, "the ill-defined universe is refused, not answered over an empty set");
  // it must NOT silently answer over an empty universe (no fabricated members).
  assert.equal(r.tmct_ask.matches.length, 0);
});

// ---- GUARD 3: active-voice / positive queries are unchanged. ----
test("negation GUARD 3: the positive query is untouched (no negation marker → no complement)", () => {
  const p = parseQuery("which modules import a.mjs", { nlp });
  assert.equal(p.node, undefined, "a positive query stays a simple clause, never a boolean complement");
  assert.equal(p.shape, "reverse");
  assert.deepEqual(labels(runAsk("which modules import a.mjs")), ["app/lib/b.mjs", "app/lib/c.mjs", "app/lib/e.mjs"]);
});

// ============================================================================
// LEVER 2 — REVERSIBLE-PASSIVE (direction swap)
// ============================================================================

test("passive HIT: 'which modules are imported by e.mjs' flips reverse→forward (the agent's imports)", () => {
  const p = parseQuery("which modules are imported by app/lib/e.mjs", { nlp });
  assert.equal(p.shape, "forward", "an agent-marked passive flips the shape to forward");
  assert.equal(p.kind, "imports");
  assert.equal(p.object, "app/lib/e.mjs", "the agent (after 'by') becomes the traversal object");
  // e.mjs imports a.mjs and f.mjs.
  assert.deepEqual(labels(runAsk("which modules are imported by app/lib/e.mjs")), ["app/lib/a.mjs", "app/lib/f.mjs"]);
});

test("passive HIT: 'tested/called by <agent>' answer over the agent's own edges", () => {
  // b.test.mjs tests b.mjs and handler.mjs.
  assert.deepEqual(labels(runAsk("which modules are tested by app/unit-tests/b.test.mjs")),
    ["app/functions/d/handler.mjs", "app/lib/b.mjs"]);
  // scripts/g.mjs calls a.mjs.
  assert.deepEqual(labels(runAsk("which modules are called by scripts/g.mjs")), ["app/lib/a.mjs"]);
  // participle whose kind has no standalone active verb here ("defined") still flips.
  assert.deepEqual(labels(runAsk("which symbols are defined by app/lib/a.mjs")), ["fnAlpha"]);
});

test("passive HIT: a QUESTIONED agent ('by which classes' / stranded 'by') stays reverse over the patient", () => {
  // "Base is inherited by which classes" — the agent is questioned → reverse over Base.
  const p = parseQuery("Base is inherited by which classes", { nlp });
  assert.equal(p.shape, "reverse");
  assert.equal(p.object, "Base");
  assert.deepEqual(labels(runAsk("Base is inherited by which classes")), ["Widget"]);
  // "X is imported by which modules" — patient named, agent questioned → reverse (importers).
  assert.deepEqual(labels(runAsk("app/lib/a.mjs is imported by which modules")),
    ["app/lib/b.mjs", "app/lib/c.mjs", "app/lib/e.mjs"]);
});

// ---- REGRESSION GUARD: active-voice queries keep their direction; a "by" that is part
// of a verb phrase or filler never trips the passive detector. ----
test("passive GUARD: active 'which modules import X' keeps its reverse direction", () => {
  const p = parseQuery("which modules import a.mjs", { nlp });
  assert.equal(p.shape, "reverse", "no passive auxiliary + agent 'by' → no flip");
  assert.deepEqual(labels(runAsk("which modules import a.mjs")), ["app/lib/b.mjs", "app/lib/c.mjs", "app/lib/e.mjs"]);
});

test("passive GUARD: an active-verb 'by' ('touched by commit') is NOT a reversible passive", () => {
  // "touched by" is a single touches verb — its "by" is consumed, so the passive
  // detector never fires; this stays the commit-subject reading ("what did X touch").
  const r = runAsk("what was touched by commit abc1234");
  assert.equal(r.tmct_ask.miss, false);
  assert.match(r.content, /commit abc1234 touched/);
});

// ---- determinism ----
test("determinism: the negation + passive parses/answers are identical across repeated calls", () => {
  assert.deepEqual(runAsk("which modules do not import a.mjs"), runAsk("which modules do not import a.mjs"));
  assert.deepEqual(runAsk("which modules are tested by app/unit-tests/b.test.mjs"),
    runAsk("which modules are tested by app/unit-tests/b.test.mjs"));
});
