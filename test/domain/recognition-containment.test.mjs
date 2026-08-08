// recognition-containment.test.mjs — the trace-vs-goal containment test and
// its three outcomes: exactly one survivor is recognized, two or more refuse
// and list, none survives is the reject class. No fourth outcome.
import { test } from "node:test";
import assert from "node:assert/strict";
import { declaredGoals, fitsPlan, recognizeGoal } from "../../src/domain/router/recognize.mjs";

test("a trace whose operators are a subsequence of one plan fits that goal", () => {
  assert.equal(fitsPlan([{ op: "a" }, { op: "c" }], ["a", "b", "c"]), true);
});

test("a trace carrying an operator the plan omits excludes the goal", () => {
  assert.equal(fitsPlan([{ op: "a" }, { op: "z" }], ["a", "b", "c"]), false);
});

test("a trace in an order the plan does not admit excludes the goal", () => {
  assert.equal(fitsPlan([{ op: "c" }, { op: "a" }], ["a", "b", "c"]), false);
});

test("exactly one surviving goal is recognized, with the fitting plan as its proof", () => {
  const trace = [{ op: "a" }, { op: "b" }];
  const goals = [
    { id: "goal:only", label: "the only fit", plans: [["a", "b"]] },
    { id: "goal:other", label: "excluded by an extra step", plans: [["a"]] },
  ];
  const r = recognizeGoal(trace, goals);
  assert.equal(r.goal.id, "goal:only");
  assert.equal(r.reject, false);
  assert.equal(r.ambiguous, null);
  assert.equal(r.proof[0].step, "goal-fit");
  assert.deepEqual(r.proof[0].plan, ["a", "b"]);
});

test("two surviving goals refuse and list both, and never pick the newer one", () => {
  const trace = [{ op: "a" }, { op: "b" }];
  const goals = [
    { id: "goal:established", label: "an established plan", plans: [["a", "b"]] },
    { id: "goal:just-added", label: "a goal that joined the set later", plans: [["a", "b"]] },
  ];
  const r = recognizeGoal(trace, goals);
  assert.equal(r.goal, null);
  assert.equal(r.reject, false);
  assert.deepEqual(r.ambiguous.map((g) => g.id), ["goal:established", "goal:just-added"]);
  assert.match(r.why, /fits 2 declared goals/);
});

test("a trace that survives no goal returns the reject class rather than a nearest fit", () => {
  const trace = [{ op: "x" }];
  const goals = [
    { id: "goal:a", label: "a", plans: [["a", "b"]] },
    { id: "goal:c", label: "c", plans: [["c"]] },
  ];
  const r = recognizeGoal(trace, goals);
  assert.equal(r.goal, null);
  assert.equal(r.reject, true);
  assert.equal(r.ambiguous, null);
  assert.deepEqual(r.proof, []);
});

test("an empty trace rejects, naming that nothing was observed", () => {
  const r = recognizeGoal([], [{ id: "goal:a", label: "a", plans: [["a"]] }]);
  assert.equal(r.reject, true);
  assert.equal(r.goal, null);
  assert.equal(r.why, "no steps observed yet — there is nothing to recognize");
});

test("a goal with no plans and no expand hook is excluded rather than guessed at", () => {
  const trace = [{ op: "located-in", args: { object: "player" } }];
  const goals = [{
    id: "world:carry-letter", label: "carry the letter", plans: [],
    goalState: { subject: "letter", predicate: "located-in", object: "player" },
  }];
  const r = recognizeGoal(trace, goals);
  assert.equal(r.goal, null);
  assert.equal(r.reject, true);
  assert.equal(r.why, "the trace fits none of the 1 declared goals — it is off the declared model, which is a reject, not a nearest fit");
});

test("the recognition proof chains from the graph through each observed step", () => {
  const trace = [
    { op: "tmct_impact", args: { module: "app/lib/a.mjs" } },
    { op: "tmct_untested", args: {} },
  ];
  const goals = declaredGoals({}, { tools: ["tmct_impact", "tmct_untested"] });
  const r = recognizeGoal(trace, goals);
  assert.equal(r.goal.id, "goal:coverage-gap");
  assert.deepEqual(r.proof, [
    { step: "goal-fit", goal: "goal:coverage-gap", plan: ["tmct_impact", "tmct_untested"], ok: true },
    { step: "causal-link", producer: "graph", condition: "app/lib/a.mjs", consumer: "step-1:tmct_impact", role: "recognition", ok: true },
    { step: "causal-link", producer: "step-1", condition: "impact", consumer: "step-2:tmct_untested", role: "recognition", ok: true },
  ]);
});

test("the same trace recognized twice returns the same goal, proof and why", () => {
  const trace = [
    { op: "tmct_impact", args: { module: "app/lib/a.mjs" } },
    { op: "tmct_untested", args: {} },
  ];
  const r1 = recognizeGoal(trace, declaredGoals({}, { tools: ["tmct_impact", "tmct_untested"] }));
  const r2 = recognizeGoal(trace, declaredGoals({}, { tools: ["tmct_impact", "tmct_untested"] }));
  assert.deepEqual(r1, r2);
});
