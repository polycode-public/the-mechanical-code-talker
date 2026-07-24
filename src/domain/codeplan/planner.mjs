// planner.mjs — bounded BFS to a graph-predicate goal (PLAN_CODE.md §3.3). The
// goal is a set of predicates over graph shape, the same species as
// domain.mjs's compileGoal specs: "entity X is titled parseRow; X lives in
// module M; every former call site imports M." findActionPath searches operator
// applications (operators.mjs's codeGraphMoves) over projected graph snapshots,
// keyed by the path-independent canonicalStateKey, shortest plan first, honest
// miss on exhaustion. No new search engine, no I/O.

import { findActionPath } from "../planning.mjs";
import { canonicalStateKey } from "./graph-delta.mjs";
import { moduleDefining } from "./graph-predicates.mjs";
import { CODE_OPERATORS, codeGraphMoves } from "./operators.mjs";

const str = (value) => String(value ?? "");

const titleOf = (state, id) => state.entities.find((e) => e.id === id)?.title;
const hasEntity = (state, id) => state.entities.some((e) => e.id === id);
const hasEdge = (state, { subject, predicate, object }) =>
  state.edges.some((r) => r.subject === subject && r.predicate === predicate && r.object === object);

/** The closed goal-predicate vocabulary: one checker per `kind`, each a pure
 *  boolean over a state. A goal spec outside this set is a programming error. */
export const GOAL_PREDICATES = Object.freeze({
  "entity-titled": (state, g) => titleOf(state, g.id) === str(g.title),
  "entity-in-module": (state, g) => moduleDefining(state, g.id) === str(g.moduleId),
  "entity-absent": (state, g) => !hasEntity(state, g.id),
  "edge-present": (state, g) => hasEdge(state, { subject: str(g.subject), predicate: str(g.predicate), object: str(g.object) }),
  "edge-absent": (state, g) => !hasEdge(state, { subject: str(g.subject), predicate: str(g.predicate), object: str(g.object) }),
});

/** Compile goal specs into a single state predicate — the conjunction of every
 *  spec's checker. Throws on an unknown `kind`. */
export function compileCodeGoal(goalSpecs) {
  const specs = goalSpecs || [];
  for (const g of specs) {
    if (!GOAL_PREDICATES[str(g.kind)]) throw new Error(`unknown goal predicate kind ${JSON.stringify(str(g.kind))}`);
  }
  return function isGoal(state) {
    return specs.every((g) => GOAL_PREDICATES[str(g.kind)](state, g));
  };
}

/** Derive the grounders' parameter pool from the goal (operators.mjs's
 *  `context`): rename titles from entity-titled specs, move/create-module target
 *  modules from entity-in-module specs, delete targets from entity-absent specs.
 *  A goal-directed pool keeps operator enumeration bounded — the planner only
 *  proposes renames/moves the goal actually calls for. A target module carries a
 *  title (spec `moduleTitle`, else its id with the `mod:` prefix stripped) so
 *  create-module can mint it. */
export function deriveContext(goalSpecs) {
  const titles = new Set();
  const moduleTargets = new Map();
  const deleteTargets = new Set();
  for (const g of goalSpecs || []) {
    if (g.kind === "entity-titled") titles.add(str(g.title));
    else if (g.kind === "entity-in-module") {
      const id = str(g.moduleId);
      if (!moduleTargets.has(id)) moduleTargets.set(id, { id, title: str(g.moduleTitle) || id.replace(/^mod:/, "") });
    } else if (g.kind === "entity-absent") deleteTargets.add(str(g.id));
  }
  return { titles: [...titles], moduleTargets: [...moduleTargets.values()], deleteTargets: [...deleteTargets] };
}

/**
 * Plan a code change: search catalogue-operator applications from `startState`
 * to a state satisfying `goalSpecs`. Returns `{ actions, states, plan }` — the
 * ordered moves, the snapshots between them, and a per-step receipt (operator,
 * binding, declared effect) — or `null` on an honest miss (no plan within
 * `maxDepth`). Deterministic: the same fixture, catalogue and goal always yield
 * the same plan.
 */
export function planCodeChange(startState, goalSpecs, { catalogue = CODE_OPERATORS, maxDepth = 12 } = {}) {
  const isGoal = compileCodeGoal(goalSpecs);
  const context = deriveContext(goalSpecs);
  const applyActions = (state) => codeGraphMoves(state, context, { catalogue });
  const found = findActionPath(startState, isGoal, applyActions, { maxDepth, stateKey: canonicalStateKey });
  if (!found) return null;
  const plan = found.actions.map((action, i) => ({
    operator: action.name,
    binding: action.binding,
    effects: action.effects,
    label: action.label,
    before: found.states[i],
    after: found.states[i + 1],
  }));
  return { actions: found.actions, states: found.states, plan };
}
