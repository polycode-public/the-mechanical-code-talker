// planning.test.mjs — proves `findActionPath` (src/planning.mjs), the
// domain-agnostic on-demand-successor generalization of `findIsaChain`'s
// bounded rooted BFS (see PLAN_HANOI.md's Phase 2 write-up for the design
// context). The toy domains here are deliberately much smaller than Towers
// of Hanoi — a handful of hand-authored positions on a small fixed graph, not
// a stack-of-disks state space — just enough to prove the mechanism (on-
// demand successor generation, cycle-safe bounded BFS, real path-not-just-
// boolean return) before anything Hanoi-scale is attempted.
import test from "node:test";
import assert from "node:assert/strict";
import { findActionPath } from "../src/planning.mjs";

// ---- Toy domain 1: a small fixed graph with two dead-end branches and a ---
// ---- cycle, requiring a genuine 3-hop discovery to reach the goal. -------
//
//   S --> M1 --> M2 --> G      (the only route to the goal: 3 hops)
//   S --> X                    (a dead end)
//   M1 --> S                   (cycle back to the start)
//   M2 --> M1                  (cycle back one step)
const GRAPH = {
  S: [{ to: "M1", action: "S->M1" }, { to: "X", action: "S->X" }],
  M1: [{ to: "M2", action: "M1->M2" }, { to: "S", action: "M1->S" }],
  M2: [{ to: "G", action: "M2->G" }, { to: "M1", action: "M2->M1" }],
  X: [],
  G: [],
};
const applyGraphActions = (state) => (GRAPH[state] || []).map(({ to, action }) => ({ action, nextState: to }));
const isGoalG = (state) => state === "G";

test("findActionPath: toy graph — a 3-hop path through discovered intermediates is found, shortest-first", () => {
  const result = findActionPath("S", isGoalG, applyGraphActions, { maxDepth: 5 });
  assert.ok(result, "expected a path to be found");
  assert.deepEqual(result.actions, ["S->M1", "M1->M2", "M2->G"]);
  assert.deepEqual(result.states, ["S", "M1", "M2", "G"]);
});

test("findActionPath: no path exists at all → null (honest miss, never a guess)", () => {
  const isGoalUnreachable = (state) => state === "nowhere";
  assert.equal(findActionPath("S", isGoalUnreachable, applyGraphActions, { maxDepth: 10 }), null);
});

test("findActionPath: budget exhaustion — a real path exists but is longer than maxDepth → null, not truncated", () => {
  // The only route to G is 3 hops (S->M1->M2->G); a budget of 2 must miss it
  // honestly, not return a partial/truncated path.
  assert.equal(findActionPath("S", isGoalG, applyGraphActions, { maxDepth: 2 }), null);
  // And the boundary itself (exactly 3) must succeed — no off-by-one.
  const result = findActionPath("S", isGoalG, applyGraphActions, { maxDepth: 3 });
  assert.ok(result);
  assert.deepEqual(result.actions, ["S->M1", "M1->M2", "M2->G"]);
});

test("findActionPath: a start state already satisfying the goal returns an empty-action path immediately", () => {
  const result = findActionPath("G", isGoalG, applyGraphActions, { maxDepth: 5 });
  assert.deepEqual(result, { actions: [], states: ["G"] });
});

// ---- Toy domain 2: a two-state cycle sitting directly on the shortest ----
// ---- route to the goal — proves the `seen`-set cycle guard doesn't just --
// ---- avoid infinite looping but still finds the CORRECT shortest path. --
//
//   P <--> Q --> Goal     (P and Q can reach each other; Q also reaches Goal)
const CYCLE_GRAPH = {
  P: [{ to: "Q", action: "P->Q" }],
  Q: [{ to: "P", action: "Q->P" }, { to: "Goal", action: "Q->Goal" }],
  Goal: [],
};
const applyCycleActions = (state) => (CYCLE_GRAPH[state] || []).map(({ to, action }) => ({ action, nextState: to }));
const isGoalReached = (state) => state === "Goal";

test("findActionPath: cycle-safety — a two-state cycle on the route to the goal does not loop forever, and the correct shortest path is still returned", () => {
  const result = findActionPath("P", isGoalReached, applyCycleActions, { maxDepth: 5 });
  assert.ok(result, "search must terminate and find the path through the cycle, not hang");
  assert.deepEqual(result.actions, ["P->Q", "Q->Goal"]);
  assert.deepEqual(result.states, ["P", "Q", "Goal"]);
});

test("findActionPath: cycle-safety — a cycle with NO reachable goal still terminates and returns null, not hang", () => {
  const isGoalNever = (state) => state === "unreachable";
  const result = findActionPath("P", isGoalNever, applyCycleActions, { maxDepth: 25 });
  assert.equal(result, null);
});
