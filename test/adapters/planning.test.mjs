// planning.test.mjs — proves `findActionPath` (src/planning.mjs), the
// domain-agnostic on-demand-successor generalization of `findIsaChain`'s
// bounded rooted BFS. The toy domains here are deliberately tiny — a handful
// of hand-authored positions on a small fixed graph, not a stack-of-disks
// state space — just enough to prove the mechanism (on-demand successor
// generation, cycle-safe bounded BFS, real path-not-just-boolean return).
import test from "node:test";
import assert from "node:assert/strict";
import { findActionPath, findReachableSet } from "../../src/planning.mjs";

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

// ---------------------------------------------------------------------------
// findReachableSet — the goal-less sibling: unlike
// `findActionPath` above, there is no goal at all — every state reachable
// from the start, within budget, is a result. Toy domain built specifically
// to exercise a genuine SAME-LENGTH multi-path convergence (C is reachable
// from S via both A and B, at the same depth) on top of a real cycle
// (A can loop back to S), so the dedup proof isn't just "a cycle didn't
// hang" but "a node reached two different ways is reported exactly once."
//
//   S --> A --> C --> D
//   S --> B --> C          (B's route to C converges with A's, same depth)
//   A --> S                (cycle back to the start)
const REACH_GRAPH = {
  S: [{ to: "A", action: "S->A" }, { to: "B", action: "S->B" }],
  A: [{ to: "C", action: "A->C" }, { to: "S", action: "A->S" }],
  B: [{ to: "C", action: "B->C" }],
  C: [{ to: "D", action: "C->D" }],
  D: [],
  ISOLATED: [],
};
const applyReachActions = (state) => (REACH_GRAPH[state] || []).map(({ to, action }) => ({ action, nextState: to }));

test("findReachableSet: toy graph — every reachable node within budget is returned, each with a correct path", () => {
  const result = findReachableSet("S", applyReachActions, { maxDepth: 10 });
  const byNode = new Map(result.map((r) => [r.node, r.path]));
  assert.deepEqual([...byNode.keys()].sort(), ["A", "B", "C", "D"], "start state itself must not be in the result");
  assert.deepEqual(byNode.get("A"), { actions: ["S->A"], states: ["S", "A"] });
  assert.deepEqual(byNode.get("B"), { actions: ["S->B"], states: ["S", "B"] });
  // C is reachable via both A and B at the same depth (2 hops) — the shorter/
  // first-discovered route (via A, since A precedes B in S's own action list)
  // must be the one recorded, not a mix, not both.
  assert.deepEqual(byNode.get("C"), { actions: ["S->A", "A->C"], states: ["S", "A", "C"] });
  assert.deepEqual(byNode.get("D"), { actions: ["S->A", "A->C", "C->D"], states: ["S", "A", "C", "D"] });
});

test("findReachableSet: cycle-safety + same-length multi-path convergence — terminates, no double-counting", () => {
  const result = findReachableSet("S", applyReachActions, { maxDepth: 10 });
  // Exactly one entry per node — the A->S cycle and the A/B->C convergence
  // must not produce duplicate or repeated entries for the same node.
  const nodes = result.map((r) => r.node);
  assert.deepEqual(nodes.slice().sort(), ["A", "B", "C", "D"].slice().sort());
  assert.equal(new Set(nodes).size, nodes.length, "no node should appear more than once");
  assert.ok(!nodes.includes("S"), "the cycle back to S must not resurrect the start state as a result");
});

test("findReachableSet: budget exhaustion — nodes beyond maxDepth are excluded, nodes at exactly maxDepth are included", () => {
  const result = findReachableSet("S", applyReachActions, { maxDepth: 2 });
  const nodes = result.map((r) => r.node).sort();
  // D is 3 hops away (S->A->C->D) — strictly beyond a budget of 2, must be excluded.
  assert.deepEqual(nodes, ["A", "B", "C"]);
  assert.ok(!nodes.includes("D"), "a node reachable only beyond maxDepth must be excluded, not silently included");
});

test("findReachableSet: an isolated start state with no outgoing actions returns an empty array, not null/undefined/an error", () => {
  const result = findReachableSet("ISOLATED", applyReachActions, { maxDepth: 5 });
  assert.deepEqual(result, []);
  assert.ok(Array.isArray(result));
});

test("findReachableSet: findActionPath itself is completely unaffected by the new sibling function", () => {
  // Rerun a representative slice of findActionPath's own assertions against
  // the shared REACH_GRAPH domain and the original GRAPH domain, to confirm
  // introducing `findReachableSet` (and the shared `seedFrontier` helper)
  // changed nothing about findActionPath's own behavior.
  const result = findActionPath("S", isGoalG, applyGraphActions, { maxDepth: 5 });
  assert.deepEqual(result.actions, ["S->M1", "M1->M2", "M2->G"]);
  assert.deepEqual(result.states, ["S", "M1", "M2", "G"]);
  assert.equal(findActionPath("S", (s) => s === "nowhere", applyGraphActions, { maxDepth: 10 }), null);
});
