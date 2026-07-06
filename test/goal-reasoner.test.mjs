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
  GOAL_RULES, MAX_TICKS, backwardChainGoal, threatsAmong, dropCondition, goalReason,
} from "../src/router/goal-reasoner.mjs";
import { goalDriver } from "../agentbench/driver-goal.mjs";
import { capabilities } from "../src/router/registry.mjs";
import { createRunCtx, runAgentbench, BENCH_VERSION, loadFixtureLabels } from "../agentbench/run.mjs";
import { parseCases, hallucinationsIn } from "../agentbench/grade.mjs";
import { resolverDriver } from "../agentbench/driver-resolver.mjs";

const CASES_FILE = fileURLToPath(new URL("../agentbench/cases.jsonl", import.meta.url));

// ---- 1. UNIT: the declared goal model + meta-loop primitives -----------------

test("goal model: GOAL_RULES is a declared, frozen maintenance-invariant set", () => {
  assert.ok(Array.isArray(GOAL_RULES) && GOAL_RULES.length >= 1);
  for (const r of GOAL_RULES) {
    assert.equal(typeof r.id, "string");
    assert.equal(r.kind, "maintenance");
    assert.ok(Array.isArray(r.subGoals) && r.subGoals.length, `${r.id} declares epistemic sub-goals`);
    assert.equal(typeof r.achieves, "string", `${r.id} declares a meta-goal topic`);
    assert.ok(Object.isFrozen(r), `${r.id} is frozen data (declared, not mutable)`);
  }
});

test("backwardChainGoal: a meta-goal topic chains to the declared goal-rule that achieves it", () => {
  const r = backwardChainGoal("coverage-gap");
  assert.ok(r && r.id === "coverage-invariant", "coverage-gap => coverage-invariant");
  assert.equal(backwardChainGoal("no-such-topic"), null, "an unachievable topic chains to nothing (honest null)");
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
  assert.equal(dropCondition(intention, observed, "scoped", focus), null);
  // fact gathered -> ACHIEVED
  observed.set("impact:app/lib/a.mjs", ["x"]);
  assert.equal(dropCondition(intention, observed, "scoped", focus), "achieved");
  // focus lapsed (no longer a Module) -> LAPSED
  assert.equal(dropCondition({ topic: "impact", key: "k" }, new Map(), "scoped", { class: "Method" }), "lapsed");
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
  // the C1-only floor (goal-deduction is genuinely doing work).
  assert.ok(goal.rolled.byRung.C2.completion > base.rolled.byRung.C2.completion, "C2 plan-completion climbs under Stage 5");
  assert.ok(goal.rolled.byRung.C2.resultCompletion > base.rolled.byRung.C2.resultCompletion, "C2 result-completion climbs under Stage 5");
  assert.ok(goal.rolled.byRung.C2.resultCompletion >= 0.8, `C2 result-completion is high (${(goal.rolled.byRung.C2.resultCompletion * 100).toFixed(0)}%)`);
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
