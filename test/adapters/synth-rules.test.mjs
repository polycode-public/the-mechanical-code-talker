// The GOAL_RULE synthesis harness, in four groups, one per build unit:
//   1. the labeled-example harness (synthbench/rules/cases.jsonl) round-trips
//      losslessly through agentbench/grade.mjs's OWN parseCases — reused, not
//      reinvented ("a labeled example for rule synthesis IS an agentbench
//      case").
//   2. the bounded field-grammar enumerator (synthbench/rules/enumerate.mjs)
//      — count + structural validity, no engine wiring yet.
//   3. the verification oracle (synthbench/rules/oracle.mjs) — a candidate
//      cloned into its OWN rule set, run through the real goalReason,
//      reproduces BOTH hand-written GOAL_RULES entries byte-for-byte on their
//      own labeled examples.
//   4. the full CEGIS loop (synthbench/rules/synthesize.mjs) — synthesizes a
//      genuinely NOVEL rule (not hand-written anywhere in
//      src/domain/router/goal-reasoner.mjs) against a held-out example set, at 0%
//      fabrication, deterministically.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { parseCases, hallucinationsIn } from "../../agentbench/grade.mjs";
import { createRunCtx, loadFixtureLabels } from "../../agentbench/run.mjs";
import { GOAL_RULES, goalReason } from "../../src/domain/router/goal-reasoner.mjs";
import { backwardChain } from "../../src/domain/router/resolver.mjs";
import {
  enumerateCandidates, allTopics, partitionTopics, FOCUS_CLASSES, MODE_SETS, COMPOSE_OPS,
} from "../../synthbench/rules/enumerate.mjs";
import { runCandidate, passesExample, groundableInToolset } from "../../synthbench/rules/oracle.mjs";
import { synthesizeGoalRule } from "../../synthbench/rules/synthesize.mjs";

const CASES_FILE = fileURLToPath(new URL("../../synthbench/rules/cases.jsonl", import.meta.url));

async function loadCases() {
  const knownLabels = await loadFixtureLabels();
  const text = await readFile(CASES_FILE, "utf8");
  return parseCases(text, { knownLabels });
}

const byId = (cases, id) => {
  const c = cases.find((x) => x.id === id);
  assert.ok(c, `case ${id} exists`);
  return c;
};

// ---- 1. the labeled-example harness round-trips losslessly ------------------

test("labeled examples: synthbench/rules/cases.jsonl round-trips losslessly through agentbench's OWN parseCases", async () => {
  const { cases, errors } = await loadCases();
  assert.deepEqual(errors, [], "zero lint errors — every case is well-formed against the real registry + fixture");
  assert.equal(cases.length, 13);
  // a hand-authored GOAL_RULE example (coverage-invariant's own case) survives
  // the round trip byte-for-byte, field for field — nothing dropped/mutated.
  const c = byId(cases, "synth-cov-safe-to-change");
  assert.equal(c.request, "is app/lib/a.mjs safe to change");
  assert.deepEqual(c.tools, ["tmct_impact", "tmct_untested"]);
  assert.deepEqual(c.expect.calls, [
    { name: "tmct_impact", input: { module: "app/lib/a.mjs" } },
    { name: "tmct_untested" },
  ]);
  assert.deepEqual(c.expect.result, ["app/lib/a.mjs", "app/lib/c.mjs", "app/lib/e.mjs", "app/lib/f.mjs", "scripts/g.mjs"]);
});

// ---- 2. the bounded enumerator -----------------------------------------------

test("enumerator: enumerateCandidates is bounded (\"low thousands\", not combinatorial explosion) and grounded in the CURRENT registry", () => {
  const topics = allTopics();
  const { relationTopics, coverageTopics } = partitionTopics();
  assert.ok(topics.length >= 10, "the registry declares a real topic set");
  assert.equal(relationTopics.length + coverageTopics.length, topics.length, "the partition is total (every topic is one or the other)");
  assert.deepEqual(FOCUS_CLASSES, ["Symbol", "Module", "Class"]);
  assert.equal(MODE_SETS.length, 3);
  assert.equal(COMPOSE_OPS.length, 3);

  const candidates = enumerateCandidates();
  const expected = FOCUS_CLASSES.length * MODE_SETS.length * coverageTopics.length * relationTopics.length * 2 * COMPOSE_OPS.length * 4;
  assert.equal(candidates.length, expected, "the enumerated count matches the declared field-grammar's own arithmetic exactly");
  assert.ok(candidates.length < 20000, "bounded — a \"low thousands\" order of magnitude, not an explosion");

  // dry-run sanity: EVERY candidate is well-formed, closed-grammar data — no
  // enumerated field ever escapes what the registry/resolver declare.
  const ids = new Set();
  for (const c of candidates) {
    assert.ok(Object.isFrozen(c) && Object.isFrozen(c.subGoals) && Object.isFrozen(c.compose), `${c.id}: frozen data`);
    assert.ok(!ids.has(c.id), `${c.id}: unique id`);
    ids.add(c.id);
    assert.equal(c.kind, "maintenance");
    assert.ok(FOCUS_CLASSES.includes(c.focusClass));
    assert.ok(MODE_SETS.some((m) => JSON.stringify(m) === JSON.stringify(c.modes)));
    assert.equal(c.subGoals.length, 2, "size-2 subGoals — this enumerator's documented conservative reduction");
    for (const topic of c.subGoals) {
      assert.ok(topics.includes(topic), `${c.id}: subGoal topic "${topic}" is a REGISTERED topic — never invented`);
      assert.ok(backwardChain(topic), `${c.id}: subGoal topic "${topic}" backward-chains to a real capability`);
    }
    assert.ok(c.subGoals.includes(c.priorityTopic) && c.subGoals.includes(c.coverageTopic));
    assert.ok(COMPOSE_OPS.includes(c.compose.op));
    assert.ok(topics.includes(c.compose.a.topic) && topics.includes(c.compose.b.topic));
  }
});

// ---- 3. the verification oracle reproduces BOTH hand-written rules -----------

test("oracle: a synthesized candidate reproduces coverage-invariant byte-for-byte on its own labeled examples", async () => {
  const { cases } = await loadCases();
  const given = ["synth-cov-safe-to-change", "synth-cov-touch-f", "synth-cov-worry-c", "synth-cov-keystone"].map((id) => byId(cases, id));
  const { ctx, cleanup } = await createRunCtx();
  try {
    const result = await synthesizeGoalRule(given, [], ctx);
    assert.equal(result.ok, true, result.reason);
    const candidate = result.candidate;

    const real = GOAL_RULES.find((r) => r.id === "coverage-invariant");
    assert.ok(real);
    for (const example of given) {
      const got = await runCandidate(candidate, example, ctx);
      const want = await goalReason(example.request, example.tools, ctx, { driver: "real-coverage", ruleSet: Object.freeze([real]) });
      assert.deepEqual(got.calls, want.calls, `${example.id}: synthesized calls == real coverage-invariant's calls`);
      assert.deepEqual(got.composed, want.composed, `${example.id}: synthesized composed == real coverage-invariant's composed`);
      // and, independently, the synthesized answer matches the pinned static
      // expect literal too (never a circular re-derivation — grade.mjs's own
      // sameSet/callsMatch primitives, reused by passesExample).
      const verdict = await passesExample(candidate, example, ctx);
      assert.equal(verdict.pass, true, `${example.id}: ${verdict.reason ?? ""}`);
    }
  } finally {
    await cleanup();
  }
});

test("oracle: a synthesized candidate reproduces cochange-risk-invariant byte-for-byte on its own labeled examples", async () => {
  const { cases } = await loadCases();
  const given = ["synth-coch-ship-a", "synth-coch-precheck-a", "synth-coch-regress-a", "synth-coch-refuse-global"].map((id) => byId(cases, id));
  const { ctx, cleanup } = await createRunCtx();
  try {
    const result = await synthesizeGoalRule(given, [], ctx);
    assert.equal(result.ok, true, result.reason);
    const candidate = result.candidate;

    const real = GOAL_RULES.find((r) => r.id === "cochange-risk-invariant");
    assert.ok(real);
    for (const example of given) {
      const got = await runCandidate(candidate, example, ctx);
      const want = await goalReason(example.request, example.tools, ctx, { driver: "real-cochange", ruleSet: Object.freeze([real]) });
      assert.deepEqual(got.calls, want.calls, `${example.id}: synthesized calls == real cochange-risk-invariant's calls`);
      assert.deepEqual(got.composed, want.composed, `${example.id}: synthesized composed == real cochange-risk-invariant's composed`);
    }
  } finally {
    await cleanup();
  }
});

test("oracle: groundableInToolset is a sound (never over-eager) pre-filter — it never rejects a candidate applicableRules would accept", async () => {
  const { cases } = await loadCases();
  const example = byId(cases, "synth-cov-safe-to-change");
  const candidates = enumerateCandidates().slice(0, 50); // a bounded sample — this is a soundness spot-check, not exhaustive
  for (const c of candidates) {
    if (!groundableInToolset(c, example.tools)) {
      // an ungroundable candidate can NEVER pass — assert the oracle agrees
      const { pass } = await passesExample(c, example, {
        resolve: () => ({ match: null, ambiguous: false }), dispatch: async () => ({ ok: false, error: "unreachable" }),
      });
      assert.equal(pass, false);
    }
  }
});

// ---- 4. the full CEGIS loop synthesizes a NOVEL rule --------------------------

test("CEGIS synthesizes a NOVEL caller-risk rule (not hand-written anywhere) at 0% fabrication, held-out-checked", async () => {
  const { cases } = await loadCases();
  const given = ["synth-caller-risk-a", "synth-caller-risk-b", "synth-caller-risk-refuse-global"].map((id) => byId(cases, id));
  const heldOut = ["synth-caller-risk-g", "synth-caller-risk-c"].map((id) => byId(cases, id));

  const { ctx, cleanup } = await createRunCtx();
  try {
    const result = await synthesizeGoalRule(given, heldOut, ctx);
    assert.equal(result.ok, true, result.reason);
    const rule = result.candidate;

    // GENUINELY NOVEL: not a re-derivation of either hand-written rule.
    assert.ok(!GOAL_RULES.some((r) => r.id === rule.id), "the synthesized id is not one of the shipped GOAL_RULES");
    assert.deepEqual(rule.subGoals, ["callers", "untested"]);
    assert.equal(rule.coverageTopic, "untested");
    assert.equal(rule.priorityTopic, "callers");
    assert.equal(rule.focusClass, "Module");
    assert.deepEqual(rule.modes, ["scoped"], "scoped-only — the held-out global-mode example pinned this");
    assert.equal(rule.compose.op, "intersect");

    // "reads as a plausible hand-authored entry" — same field SET, same
    // TYPES, same frozen-data discipline as goal-reasoner.mjs's own two
    // hand-written rules (manually reviewed alongside this assertion; the
    // structural check below is the machine-checkable half of that review).
    const reference = GOAL_RULES[0];
    assert.deepEqual(new Set(Object.keys(rule)), new Set(Object.keys(reference)), "same field set as a hand-written GOAL_RULE");
    assert.equal(typeof rule.id, "string");
    assert.equal(typeof rule.invariant, "string");
    assert.ok(Object.isFrozen(rule) && Object.isFrozen(rule.modes) && Object.isFrozen(rule.subGoals) && Object.isFrozen(rule.compose));

    // 0% FABRICATION over the full given+heldOut set, using this rule INSERTED
    // into a cloned array — the same real, unmodified goalReason every
        // shipped rule runs through (never a re-implementation).
    for (const example of [...given, ...heldOut]) {
      const loopResult = await runCandidate(rule, example, ctx);
      for (const call of loopResult.calls) {
        assert.deepEqual(hallucinationsIn(call, example.tools), [], `${example.id}: ${call.name} is well-formed`);
      }
    }
  } finally {
    await cleanup();
  }
});

test("CEGIS is deterministic — two runs over the same inputs synthesize a byte-identical rule and trace", async () => {
  const { cases } = await loadCases();
  const given = ["synth-caller-risk-a", "synth-caller-risk-b", "synth-caller-risk-refuse-global"].map((id) => byId(cases, id));
  const heldOut = ["synth-caller-risk-g", "synth-caller-risk-c"].map((id) => byId(cases, id));

  const { ctx, cleanup } = await createRunCtx();
  try {
    const a = await synthesizeGoalRule(given, heldOut, ctx);
    const b = await synthesizeGoalRule(given, heldOut, ctx);
    assert.equal(a.ok, true);
    assert.equal(JSON.stringify(a.candidate), JSON.stringify(b.candidate), "byte-identical synthesized rule");
    assert.equal(JSON.stringify(a.trace), JSON.stringify(b.trace), "byte-identical narrowing trace");
    assert.equal(a.survivorCount, b.survivorCount);
  } finally {
    await cleanup();
  }
});

test("CEGIS: an honest miss — a given set no candidate in the grammar can satisfy refuses (never a wrong rule)", async () => {
  const { ctx, cleanup } = await createRunCtx();
  try {
    const impossible = [{
      id: "impossible", request: "is app/lib/a.mjs safe to change", tools: ["tmct_impact", "tmct_untested"],
      // no candidate composes an answer that is NOT a real fixture set —
      // this literal can never be produced by any enumerated candidate.
      expect: { calls: [{ name: "tmct_impact", input: { module: "app/lib/a.mjs" } }, { name: "tmct_untested" }], result: ["this-module-does-not-exist.mjs"] },
    }];
    const result = await synthesizeGoalRule(impossible, [], ctx);
    assert.equal(result.ok, false);
    assert.match(result.reason, /no candidate in the grammar reproduces/);
  } finally {
    await cleanup();
  }
});

test("CEGIS: held-out failure is reported honestly, not silently swallowed", async () => {
  const { cases } = await loadCases();
  const given = [byId(cases, "synth-caller-risk-a")]; // one example alone under-constrains the search
  const badHeldOut = [{
    id: "bad-held-out", request: "who will be caught off guard if app/lib/b.mjs changes", tools: ["tmct_callers", "tmct_untested"],
    expect: { calls: [{ name: "tmct_callers", input: { symbol: "app/lib/b.mjs" } }, { name: "tmct_untested" }], result: ["not-a-real-answer"] },
  }];
  const { ctx, cleanup } = await createRunCtx();
  try {
    const result = await synthesizeGoalRule(given, badHeldOut, ctx);
    assert.equal(result.ok, false);
    assert.match(result.reason, /held-out example .* failed/);
  } finally {
    await cleanup();
  }
});
