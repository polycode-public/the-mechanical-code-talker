// recognition-goals.test.mjs — the declared goal set a trace is recognized
// against, gathered from GOAL_RULES, the capability registry, a world pack's
// own objective markers, and taught action families. Pure, never invented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { declaredGoals } from "../../src/domain/router/recognize.mjs";
import { capabilities } from "../../src/domain/router/registry.mjs";
import { GOAL_RULES } from "../../src/domain/router/goal-reasoner.mjs";

test("every declared capability contributes one tool goal named for its add-effect topic", () => {
  const goals = declaredGoals({});
  const toolGoals = goals.filter((g) => g.source === "capability");
  assert.equal(toolGoals.length, capabilities().length);
  const impact = toolGoals.find((g) => g.id === "cap:impact");
  assert.ok(impact);
  assert.deepEqual(impact.plans, [["tmct_impact"]]);
  assert.equal(impact.goalState, null);
  assert.match(impact.provenance, /^capability tmct_impact — add-effect knows\(impact\)$/);
});

test("each maintenance invariant contributes a goal whose plan is its sub-goals backward-chained", () => {
  const goals = declaredGoals({});
  const invariants = goals.filter((g) => g.source === "goal-rules");
  assert.equal(invariants.length, GOAL_RULES.length);
  const coverage = invariants.find((g) => g.id === "goal:coverage-gap");
  assert.deepEqual(coverage.plans, [["tmct_impact", "tmct_untested"]]);
  const cochange = invariants.find((g) => g.id === "goal:cochange-risk");
  assert.deepEqual(cochange.plans, [["tmct_cochanges", "tmct_untested"]]);
});

test("a world objective marker contributes a carry goal with no plan and a goal state", () => {
  const worldRows = [{ subject: "letter", predicate: "mgx:is-objective", object: "true" }];
  const goals = declaredGoals({ worldRows });
  const carry = goals.find((g) => g.id === "world:carry-letter");
  assert.ok(carry);
  assert.equal(carry.source, "world");
  assert.deepEqual(carry.plans, []);
  assert.deepEqual(carry.goalState, { subject: "letter", predicate: "located-in", object: "player" });
});

test("a row whose objective marker is not the literal string true contributes no goal", () => {
  const worldRows = [{ subject: "ring", predicate: "mgx:is-objective", object: "false" }];
  const goals = declaredGoals({ worldRows });
  assert.equal(goals.filter((g) => g.source === "world").length, 0);
});

test("a taught action family contributes a goal named for its effect predicate", () => {
  const ruleRows = [
    { kind: "action-effect", name: "move", slots: { predicate: "rest-on", subjectRole: "subject", objectRole: "target" } },
  ];
  const goals = declaredGoals({ ruleRows });
  const taught = goals.find((g) => g.id === "taught:rest-on");
  assert.ok(taught);
  assert.equal(taught.source, "taught");
  assert.deepEqual(taught.plans, []);
  assert.deepEqual(taught.goalState, { predicate: "rest-on" });
  assert.match(taught.provenance, /taught action move — effect rest-on/);
});

test("two taught families sharing an effect predicate contribute one goal", () => {
  const ruleRows = [
    { kind: "action-effect", name: "move", slots: { predicate: "rest-on", subjectRole: "subject", objectRole: "target" } },
    { kind: "action-effect", name: "push", slots: { predicate: "rest-on", subjectRole: "subject", objectRole: "target" } },
  ];
  const goals = declaredGoals({ ruleRows });
  const taught = goals.filter((g) => g.id === "taught:rest-on");
  assert.equal(taught.length, 1);
  assert.match(taught[0].provenance, /taught action move/);
  assert.match(taught[0].provenance, /taught action push/);
});

test("a declared toolset that omits a plan's operator drops that goal from the set", () => {
  const full = declaredGoals({}, { tools: ["tmct_impact", "tmct_untested", "tmct_cochanges"] });
  assert.ok(full.some((g) => g.id === "goal:coverage-gap"));
  assert.ok(full.some((g) => g.id === "goal:cochange-risk"));
  const partial = declaredGoals({}, { tools: ["tmct_impact"] });
  assert.ok(!partial.some((g) => g.id === "goal:coverage-gap"));
  assert.ok(!partial.some((g) => g.id === "goal:cochange-risk"));
  assert.ok(partial.some((g) => g.id === "cap:impact"));
  assert.ok(!partial.some((g) => g.id === "cap:untested"));
});

test("a goal with no plan of its own survives every declared toolset, including an empty one", () => {
  const worldRows = [{ subject: "letter", predicate: "mgx:is-objective", object: "true" }];
  const ruleRows = [
    { kind: "action-effect", name: "move", slots: { predicate: "rest-on", subjectRole: "subject", objectRole: "target" } },
  ];
  const goals = declaredGoals({ worldRows, ruleRows }, { tools: [] });
  assert.ok(goals.some((g) => g.id === "world:carry-letter"));
  assert.ok(goals.some((g) => g.id === "taught:rest-on"));
});

test("the goal set is sorted by id, so two reads over the same declarations agree", () => {
  const worldRows = [{ subject: "letter", predicate: "mgx:is-objective", object: "true" }];
  const ruleRows = [
    { kind: "action-effect", name: "move", slots: { predicate: "rest-on", subjectRole: "subject", objectRole: "target" } },
  ];
  const first = declaredGoals({ worldRows, ruleRows });
  const second = declaredGoals({ worldRows, ruleRows });
  const ids = first.map((g) => g.id);
  assert.deepEqual(ids, [...ids].sort());
  assert.deepEqual(first, second);
});

test("a context with no world rows and no taught rules still enumerates the tool and invariant goals", () => {
  const goals = declaredGoals({});
  assert.equal(goals.length, capabilities().length + GOAL_RULES.length);
  assert.ok(goals.every((g) => g.source === "capability" || g.source === "goal-rules"));
});
