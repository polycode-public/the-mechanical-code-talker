// test/goal-reasoner.test.mjs — Stage 5, the closed-world C2 goal-reasoner
// (src/router/goal-reasoner.mjs + agentbench/driver-goal.mjs).
//
// Two groups:
//   1. UNIT — the declared goal model + the pure meta-loop primitives (goal
//      backward-chaining, meta-level threat derivation, BDI drop conditions,
//      the mechanical termination bounds) in isolation.
//   2. E2E — the goal driver over the real fixture: genuine goal-DEDUCTION
//      composes the coverage-gap set (safe-to-change family) and the keystone
//      (global ranking), HELD-OUT phrasings decompose via the SAME goal-rule,
//      the open-world seam REFUSES rather than invents a goal, C1 pass-through is
//      untouched, and the whole thing is bounded, deterministic, 0% hallucination.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  GOAL_RULES, MAX_TICKS, backwardChainGoal, applicableRules, threatsAmong, dropCondition, goalReason,
} from "../src/router/goal-reasoner.mjs";
import { goalDriver } from "../agentbench/driver-goal.mjs";
import { cochangesLabels, untestedModules, intersect } from "../agentbench/results.mjs";
import { capabilities } from "../src/router/registry.mjs";
import { createRunCtx, runAgentbench, BENCH_VERSION, loadFixtureLabels } from "../agentbench/run.mjs";
import { parseCases, hallucinationsIn } from "../agentbench/grade.mjs";
import { resolverDriver } from "../agentbench/driver-resolver.mjs";

const CASES_FILE = fileURLToPath(new URL("../agentbench/cases.jsonl", import.meta.url));

// ---- 1. UNIT: the declared goal model + meta-loop primitives -----------------

test("goal model: GOAL_RULES is a declared, frozen maintenance-invariant set (rule-general fields)", () => {
  assert.ok(Array.isArray(GOAL_RULES) && GOAL_RULES.length >= 2, "0.8.2: at least two declared goal-rules (C2 is rule-general)");
  for (const r of GOAL_RULES) {
    assert.equal(typeof r.id, "string");
    assert.equal(r.kind, "maintenance");
    assert.ok(Array.isArray(r.subGoals) && r.subGoals.length, `${r.id} declares epistemic sub-goals`);
    assert.equal(typeof r.achieves, "string", `${r.id} declares a meta-goal topic`);
    // the 0.8.2 rule-general fields: nothing about a rule lives in code any more
    assert.equal(typeof r.focusClass, "string", `${r.id} declares the focus entity class`);
    assert.ok(Array.isArray(r.modes) && r.modes.every((m) => ["scoped", "global"].includes(m)), `${r.id} declares its modes`);
    assert.ok(r.compose && r.compose.op === "intersect" && r.compose.a && r.compose.b, `${r.id} declares a compose spec`);
    assert.ok(r.compose.a.topic && r.compose.b.topic, `${r.id} compose sides name gathered topics`);
    assert.ok(Object.isFrozen(r) && Object.isFrozen(r.compose), `${r.id} is frozen data (declared, not mutable)`);
  }
  // both scoped sub-goal lists + arbitration keys stay inside the declared sub-goals
  for (const r of GOAL_RULES) {
    assert.ok(r.subGoals.includes(r.priorityTopic) && r.subGoals.includes(r.coverageTopic), `${r.id} arbitration keys are declared sub-goals`);
  }
});

test("backwardChainGoal: a meta-goal topic chains to the declared goal-rule that achieves it", () => {
  const r = backwardChainGoal("coverage-gap");
  assert.ok(r && r.id === "coverage-invariant", "coverage-gap => coverage-invariant");
  const c = backwardChainGoal("cochange-risk");
  assert.ok(c && c.id === "cochange-risk-invariant", "cochange-risk => cochange-risk-invariant (the second declared rule)");
  assert.equal(backwardChainGoal("no-such-topic"), null, "an unachievable topic chains to nothing (honest null)");
});

test("applicableRules: pure selection — unique by toolset, none at the open-world seam, multiple = ambiguous", () => {
  const focus = { class: "Module", label: "app/lib/a.mjs" };
  // UNIQUE: each toolset grounds exactly one rule's sub-goals
  assert.deepEqual(applicableRules(["tmct_impact", "tmct_untested"], focus, "scoped").map((r) => r.id),
    ["coverage-invariant"], "impact+untested grounds only the coverage-invariant");
  assert.deepEqual(applicableRules(["tmct_cochanges", "tmct_untested"], focus, "scoped").map((r) => r.id),
    ["cochange-risk-invariant"], "cochanges+untested grounds only the cochange rule");
  // NONE: an insufficient toolset, or a mode the rule does not declare
  assert.deepEqual(applicableRules(["tmct_impact"], focus, "scoped"), [], "a missing sub-goal capability disqualifies");
  assert.deepEqual(applicableRules([], focus, "scoped"), [], "an empty toolset grounds nothing");
  assert.deepEqual(applicableRules(["tmct_cochanges", "tmct_untested"], null, "global"), [],
    "the cochange rule is scoped-only (entity-scoped sub-goals): no global reading");
  // GLOBAL: only the coverage rule declares it
  assert.deepEqual(applicableRules(["tmct_impact", "tmct_untested"], null, "global").map((r) => r.id), ["coverage-invariant"]);
  // MULTIPLE: a toolset grounding both rules for a Module focus is AMBIGUOUS
  const both = applicableRules(["tmct_impact", "tmct_untested", "tmct_cochanges"], focus, "scoped");
  assert.equal(both.length, 2, "both rules apply — the caller must refuse, never pick one");
  // focusClass screen: a non-Module focus matches neither rule in scoped mode
  assert.deepEqual(applicableRules(["tmct_impact", "tmct_untested", "tmct_cochanges"], { class: "Method", label: "Widget.render" }, "scoped"), []);
});

test("threatsAmong: meta-level POP threats are PROVABLY empty over the read-only registry", () => {
  // every capability has an empty delete-list (queries mutate nothing), so no
  // first step can clobber another live goal — DERIVED from the registry, not assumed.
  for (const cap of capabilities()) {
    assert.deepEqual(threatsAmong(cap.name, []), [], `${cap.name} threatens nothing (empty delete-list)`);
  }
});

test("dropCondition: BDI commitment holds until achieved / lapsed (persistence, not thrash)", () => {
  const observed = new Map();
  const intention = { topic: "impact", key: "impact:app/lib/a.mjs" };
  const focus = { class: "Module", label: "app/lib/a.mjs" };
  // not yet gathered, focus intact -> KEEP the commitment (null)
  assert.equal(dropCondition(intention, observed, "scoped", focus, "Module"), null);
  // fact gathered -> ACHIEVED
  observed.set("impact:app/lib/a.mjs", ["x"]);
  assert.equal(dropCondition(intention, observed, "scoped", focus, "Module"), "achieved");
  // focus lapsed (no longer of the SELECTED RULE's declared focusClass) -> LAPSED
  assert.equal(dropCondition({ topic: "impact", key: "k" }, new Map(), "scoped", { class: "Method" }, "Module"), "lapsed");
  // the class literal comes from the rule, not the function: a Method-scoped rule keeps a Method focus
  assert.equal(dropCondition({ topic: "impact", key: "k" }, new Map(), "scoped", { class: "Method" }, "Method"), null);
});

test("MAX_TICKS: the meta-loop carries a hard OUTER-tick budget (mechanical termination)", () => {
  assert.equal(typeof MAX_TICKS, "number");
  assert.ok(MAX_TICKS >= 1 && MAX_TICKS < 1e6, "a finite hard bound, mirroring the planner's MAX_STEPS");
});

// ---- 2. E2E: genuine goal-deduction over the fixture ------------------------

test("goal-reasoner e2e: 'safe to change' DEDUCES the coverage-gap (no request literal steers it)", async () => {
  const { ctx, cleanup } = await createRunCtx();
  try {
    const r = await goalDriver("is app/lib/a.mjs safe to change", ["tmct_impact", "tmct_untested"], ctx);
    assert.equal(r.refused, false);
    assert.equal(r.driver, "goal-0.8.1", "the resolver refused; the C2 goal-reasoner handled it");
    // the plan the goal-rule deduced: impact(focus) then the untested coverage scan
    assert.deepEqual(r.calls, [
      { name: "tmct_impact", input: { module: "app/lib/a.mjs" } },
      { name: "tmct_untested", input: {} },
    ]);
    // the composed answer: untested ∩ ({a} ∪ impact(a)) — the change's untested footprint
    assert.deepEqual(r.composed, ["app/lib/a.mjs", "app/lib/c.mjs", "app/lib/e.mjs", "app/lib/f.mjs", "scripts/g.mjs"]);
    // the why CITES the declared goal-rule by backward-chain (glass-box provenance)
    assert.ok(r.why.some((w) => /backward-chain.*coverage-invariant/.test(w)), "why cites the goal-rule");
  } finally {
    await cleanup();
  }
});

test("goal-reasoner e2e: HELD-OUT phrasings decompose via the SAME goal-rule (graded blind)", async () => {
  const { ctx, cleanup } = await createRunCtx();
  try {
    // a distinct surface form, a different focus module -> the SAME coverage-invariant
    const f = await goalDriver("how risky is it to touch app/lib/f.mjs", ["tmct_impact", "tmct_untested"], ctx);
    assert.equal(f.refused, false);
    assert.deepEqual(f.composed, ["app/lib/e.mjs", "app/lib/f.mjs"]);

    const c = await goalDriver("should I be worried about changing app/lib/c.mjs", ["tmct_impact", "tmct_untested"], ctx);
    assert.equal(c.refused, false);
    assert.deepEqual(c.composed, ["app/lib/c.mjs"], "c's only dependent is tested -> singleton gap");
  } finally {
    await cleanup();
  }
});

// ---- 0.8.2: the SECOND declared goal-rule (cochange-risk-invariant) ----------

test("cochangesLabels: mirrors renderCochanges edge-for-edge (SYMMETRIC read of the cochange edge)", async () => {
  const { ctx, cleanup } = await createRunCtx();
  try {
    const g = ctx.graph;
    const bind = (t) => ctx.resolve(t).match;
    // fixture truth: the only cochange edges are a→b (×3) and a→c (×2).
    assert.deepEqual(cochangesLabels(g, bind("app/lib/a.mjs")), ["app/lib/b.mjs", "app/lib/c.mjs"], "cochanges(a) = {b, c}");
    // the render reads the edge SYMMETRICALLY (subject OR object) — so b and c
    // each couple back to a even though the fixture edges point a→{b,c} only.
    assert.deepEqual(cochangesLabels(g, bind("app/lib/b.mjs")), ["app/lib/a.mjs"], "cochanges(b) = {a} (reverse direction)");
    assert.deepEqual(cochangesLabels(g, bind("app/lib/c.mjs")), ["app/lib/a.mjs"], "cochanges(c) = {a} (reverse direction)");
    // a module with no coupling edges has the empty set (a real answer)
    assert.deepEqual(cochangesLabels(g, bind("app/lib/e.mjs")), []);
    // and the invariant's hand-derived truth: cochanges(a) ∩ untested = {c} (b is tested)
    assert.deepEqual(intersect(cochangesLabels(g, bind("app/lib/a.mjs")), untestedModules(g)), ["app/lib/c.mjs"]);
  } finally {
    await cleanup();
  }
});

test("goal-reasoner e2e: the SECOND rule — change-coupling phrasings deduce cochange-risk via toolset applicability", async () => {
  const { ctx, cleanup } = await createRunCtx();
  try {
    const tools = ["tmct_cochanges", "tmct_untested"];
    for (const request of [
      "what tends to break when I ship app/lib/a.mjs",
      "what else should I double-check before shipping app/lib/a.mjs",
      "what usually regresses alongside app/lib/a.mjs",
    ]) {
      const r = await goalDriver(request, tools, ctx);
      assert.equal(r.refused, false, `${request}: the goal-reasoner composes`);
      assert.equal(r.driver, "goal-0.8.1", `${request}: C1 refused; C2 handled it`);
      assert.deepEqual(r.calls, [
        { name: "tmct_cochanges", input: { symbol: "app/lib/a.mjs" } },
        { name: "tmct_untested", input: {} },
      ], `${request}: the rule's sub-goals in declared order`);
      assert.deepEqual(r.composed, ["app/lib/c.mjs"], `${request}: cochanges(a) ∩ untested`);
      assert.ok(r.why.some((w) => /backward-chain.*cochange-risk-invariant/.test(w)), `${request}: why cites the declared rule`);
    }
  } finally {
    await cleanup();
  }
});

test("goal-reasoner e2e: LEAKAGE GUARD — every new C2 phrasing REFUSES under the C1 resolver (no request keyword carries it)", async () => {
  const { ctx, cleanup } = await createRunCtx();
  try {
    const tools = ["tmct_cochanges", "tmct_untested"];
    for (const [request, declared] of [
      ["what tends to break when I ship app/lib/a.mjs", tools],
      ["what else should I double-check before shipping app/lib/a.mjs", tools],
      ["what usually regresses alongside app/lib/a.mjs", tools],
      ["what usually regresses together in this codebase", tools],
      ["what else should I double-check before shipping app/lib/f.mjs", ["tmct_impact", "tmct_untested", "tmct_cochanges"]],
    ]) {
      const r = await resolverDriver(request, declared, ctx);
      assert.equal(r.refused, true, `${request}: C1 must refuse (the phrasing is genuinely held out)`);
      assert.deepEqual(r.calls, [], `${request}: C1 emits nothing`);
    }
  } finally {
    await cleanup();
  }
});

test("goal-reasoner e2e: SCOPED-ONLY + AMBIGUITY seams both refuse honestly", async () => {
  const { ctx, cleanup } = await createRunCtx();
  try {
    // no focus binds and the cochange rule declares no global mode; coverage
    // cannot ground impact in this toolset -> 0 applicable -> open-world refuse.
    const global = await goalDriver("what usually regresses together in this codebase", ["tmct_cochanges", "tmct_untested"], ctx);
    assert.equal(global.refused, true);
    assert.deepEqual(global.calls, []);
    assert.match(String(global.why), /open-world.*escalate/);

    // a toolset grounding BOTH rules for a Module focus -> ambiguous meta-goal refuse.
    const ambiguous = await goalDriver("what else should I double-check before shipping app/lib/f.mjs", ["tmct_impact", "tmct_untested", "tmct_cochanges"], ctx);
    assert.equal(ambiguous.refused, true);
    assert.deepEqual(ambiguous.calls, []);
    assert.match(String(ambiguous.why), /ambiguous meta-goal.*coverage-invariant.*cochange-risk-invariant/);
  } finally {
    await cleanup();
  }
});

test("goal driver e2e: the C1 relative-filter over the cochange grain composes at C1 (not the goal-reasoner)", async () => {
  const { ctx, cleanup } = await createRunCtx();
  try {
    const r = await goalDriver("of the modules change-coupled with app/lib/a.mjs, which are untested", ["tmct_cochanges", "tmct_untested"], ctx);
    assert.equal(r.driver, "resolver-0.8.0", "the planner's relative-filter frame carries it — C2 adds nothing");
    assert.deepEqual(r.composed, ["app/lib/c.mjs"]);
  } finally {
    await cleanup();
  }
});

test("goal-reasoner e2e: GLOBAL keystone — no focus => rank the coverage violations by blast radius", async () => {
  const { ctx, cleanup } = await createRunCtx();
  try {
    const r = await goalDriver("which module is the biggest testing risk", ["tmct_untested", "tmct_impact"], ctx);
    assert.equal(r.refused, false);
    assert.equal(r.driver, "goal-0.8.1");
    // GDA expansion: untested first, then impact-of-each (deterministic order)
    assert.equal(r.calls[0].name, "tmct_untested");
    assert.ok(r.calls.slice(1).every((c) => c.name === "tmct_impact"), "the expansion is impact-of-each-untested");
    // keystone arbitration: argmax |impact| = app/lib/a.mjs (weight 6)
    assert.deepEqual(r.composed, ["app/lib/a.mjs"]);
    assert.ok(r.why.some((w) => /keystone/.test(w)));
  } finally {
    await cleanup();
  }
});

test("goal-reasoner e2e: the OPEN-WORLD seam REFUSES rather than invent a goal", async () => {
  const { ctx, cleanup } = await createRunCtx();
  try {
    // a Method focus: the declared coverage-invariant is Module-scoped, so no rule
    // covers it — the honest escalation, never a fabricated goal.
    const r = await goalDriver("is Widget.render safe to change", ["tmct_impact", "tmct_untested", "tmct_describe"], ctx);
    assert.equal(r.refused, true);
    assert.deepEqual(r.calls, []);
    assert.match(String(r.why), /open-world|escalate/);
  } finally {
    await cleanup();
  }
});

test("goal-reasoner e2e: a sub-goal not in the declared toolset ESCALATES (never a hallucinated call)", async () => {
  const { ctx, cleanup } = await createRunCtx();
  try {
    // focus is a Module but the coverage scan tool is not declared -> honest refuse
    const r = await goalDriver("is app/lib/a.mjs safe to change", ["tmct_impact"], ctx);
    assert.equal(r.refused, true);
    assert.deepEqual(r.calls, []);
  } finally {
    await cleanup();
  }
});

test("goal driver: C1-routable requests are UNTOUCHED (goal-reasoner adds nothing to what C1 grounds)", async () => {
  const { ctx, cleanup } = await createRunCtx();
  try {
    // a single-shot the resolver grounds -> the C1 answer stands, resolver-labeled
    const one = await goalDriver("describe Widget", ["tmct_describe"], ctx);
    assert.equal(one.driver, "resolver-0.8.0");
    assert.deepEqual(one.calls, [{ name: "tmct_describe", input: { symbol: "Widget" } }]);
    // a C1 relative-filter the planner composes -> unchanged, still resolver-labeled
    const fold = await goalDriver("of the modules impacted by app/lib/a.mjs, which are untested", ["tmct_impact", "tmct_untested"], ctx);
    assert.equal(fold.driver, "resolver-0.8.0");
    assert.deepEqual(fold.composed, ["app/lib/c.mjs", "app/lib/e.mjs", "app/lib/f.mjs", "scripts/g.mjs"]);
  } finally {
    await cleanup();
  }
});

test("goal driver e2e: Stage 5 moves C2 result-completion OFF the floor at 0% hallucination", async () => {
  const knownLabels = await loadFixtureLabels();
  const { cases } = parseCases(await readFile(CASES_FILE, "utf8"), { knownLabels });
  const goal = await runAgentbench(cases, { driver: goalDriver, stamp: BENCH_VERSION });
  const base = await runAgentbench(cases, { driver: resolverDriver, stamp: BENCH_VERSION });

  // the non-negotiable holds on both axes, on every rung
  assert.equal(goal.rolled.overall.hallucinationRate, 0, "0% hallucination — the router's floor, preserved by Stage 5");

  // the WIN: the goal-reasoner un-gates C2 and lifts its result-completion far off
  // the C1-only floor (goal-deduction is genuinely doing work). 0.8.2 counts: C2
  // is 11 cases (6 coverage-era + 3 cochange composes + 2 seam refusals); the goal
  // driver composes/refuses 10 of 11 on the result axis (what-to-test stays the
  // honest miss), so the floor is deliberately raised 0.8 -> 0.9 with the wave.
  assert.ok(goal.rolled.byRung.C2.completion > base.rolled.byRung.C2.completion, "C2 plan-completion climbs under Stage 5");
  assert.ok(goal.rolled.byRung.C2.resultCompletion > base.rolled.byRung.C2.resultCompletion, "C2 result-completion climbs under Stage 5");
  assert.ok(goal.rolled.byRung.C2.resultCompletion >= 0.9, `C2 result-completion is high (${(goal.rolled.byRung.C2.resultCompletion * 100).toFixed(0)}%)`);
  assert.ok(goal.rolled.byRung.C2.gatePass, "C2 passes the honest gate under Stage 5");

  // HONESTY: what-to-test stays result-incomplete (the resolver answers it relaxed;
  // ranking a resolver-answered request would need a request keyword we refuse to
  // add) — the boundary is kept red, not faked.
  const wtt = goal.rows.find((r) => r.caseId === "ab-c2-what-to-test");
  assert.ok(wtt.verdict.completed && !wtt.verdict.resultCompleted, "what-to-test stays honestly result-incomplete");

  // every produced call is well-formed against its declared set (belt-and-braces)
  for (const r of goal.rows) {
    for (const call of r.produced.calls) {
      assert.deepEqual(hallucinationsIn(call, r.tools), [], `${r.caseId}: ${call.name} well-formed`);
    }
  }
});

test("goal driver e2e: deterministic + bounded — two runs are byte-identical, all terminate", async () => {
  const knownLabels = await loadFixtureLabels();
  const { cases } = parseCases(await readFile(CASES_FILE, "utf8"), { knownLabels });
  const a = await runAgentbench(cases, { driver: goalDriver, stamp: BENCH_VERSION });
  const b = await runAgentbench(cases, { driver: goalDriver, stamp: BENCH_VERSION });
  assert.equal(JSON.stringify(a.rows), JSON.stringify(b.rows), "byte-identical (no Date.now, deterministic order)");
  for (const r of a.rows) assert.equal(r.produced.terminated, true, `${r.caseId} terminated (bounded meta-loop)`);
});

test("goalReason: an empty declared toolset escalates cleanly (no crash, honest refuse)", async () => {
  const { ctx, cleanup } = await createRunCtx();
  try {
    const r = await goalReason("is app/lib/a.mjs safe to change", [], ctx, { driver: "goal-0.8.1" });
    assert.equal(r.refused, true);
    assert.deepEqual(r.calls, []);
    assert.equal(r.terminated, true);
  } finally {
    await cleanup();
  }
});
