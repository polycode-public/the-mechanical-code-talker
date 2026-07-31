// operators.mjs — the code-transformation operator catalogue: each entry one
// taught-action family, slot for slot (PLAN_CODE.md §3.2). A signature (the
// graph shape it applies to), preconditions (named graph predicates from
// graph-predicates.mjs), a declared effect (a graph delta from graph-delta.mjs),
// and the standing constraint that every currently-covered test stays covered.
//
// The catalogue is DATA — authored and reviewed like any rule base, not engine
// code. A grounded operator supplies `ground(state, context)`, which enumerates
// its legal moves over a state given a goal-derived parameter pool; the entries
// still pending a grounder carry their signature/precondition metadata so the
// catalogue reads complete. No I/O.
//
// An entity id here is a STABLE node identity, independent of the module that
// currently defines it — a move swaps the `defines` edge and leaves the id
// alone, the way a graph rewrite renames a node's neighbourhood, not the node.
// The language adaptor (§3.4) maps that stable identity onto concrete paths.

import { applyGraphEffects, canonicalStateKey } from "./graph-delta.mjs";
import {
  moduleDefining, callersOf, importsInducedByMove, preconditionsHold,
} from "./graph-predicates.mjs";

const asSet = (classes) => new Set(Array.isArray(classes) ? classes : [classes]);
const titleOf = (state, id) => state.entities.find((e) => e.id === id)?.title;
const classOf = (state, id) => state.entities.find((e) => e.id === id)?.class;
const hasEntity = (state, id) => state.entities.some((e) => e.id === id);

const signatureMatches = (state, entityId, signature) => {
  const cls = classOf(state, entityId);
  return cls != null && asSet(signature.subjectClass).has(cls);
};

// ---- grounders ---------------------------------------------------------------

/** rename: retitle an entity in place. One move per (entity matching the
 *  signature) × (candidate title in the pool) that survives the no-collision
 *  precondition. */
function groundRename(operator, state, context) {
  const out = [];
  const titles = context?.titles || [];
  for (const ent of state.entities) {
    if (!signatureMatches(state, ent.id, operator.signature)) continue;
    for (const newTitle of titles) {
      if (newTitle === ent.title) continue;
      const binding = { entityId: ent.id, newTitle };
      if (!preconditionsHold(operator.preconditions, state, binding)) continue;
      out.push({
        name: operator.name,
        binding,
        effects: [{ op: "retitle-entity", id: ent.id, title: newTitle }],
        label: `rename ${ent.title} to ${newTitle}`,
      });
    }
  }
  return out;
}

/** create-module: add a Module the plan will move a symbol into. One move per
 *  target-module descriptor in the pool not already present. */
function groundCreateModule(operator, state, context) {
  const out = [];
  for (const target of context?.moduleTargets || []) {
    if (!target?.id || hasEntity(state, target.id)) continue;
    out.push({
      name: operator.name,
      binding: { moduleId: target.id },
      effects: [{ op: "add-entity", id: target.id, class: "Module", title: target.title || target.id }],
      label: `create module ${target.title || target.id}`,
    });
  }
  return out;
}

/** move: hand an entity to a different module — swap its `defines` edge and add
 *  the import edges every call site now needs — without creating an import
 *  cycle. */
function groundMove(operator, state, context) {
  const out = [];
  const targets = (context?.moduleTargets || []).map((t) => t.id);
  for (const ent of state.entities) {
    if (!signatureMatches(state, ent.id, operator.signature)) continue;
    const from = moduleDefining(state, ent.id);
    if (!from) continue;
    for (const toModuleId of targets) {
      if (toModuleId === from || !hasEntity(state, toModuleId)) continue;
      const binding = { entityId: ent.id, toModuleId };
      if (!preconditionsHold(operator.preconditions, state, binding)) continue;
      const effects = [
        { op: "del-edge", subject: from, predicate: "defines", object: ent.id },
        { op: "add-edge", subject: toModuleId, predicate: "defines", object: ent.id },
        ...importsInducedByMove(state, binding).map((r) => ({ op: "add-edge", ...r })),
      ];
      out.push({
        name: operator.name,
        binding,
        effects,
        label: `move ${ent.title} to ${titleOf(state, toModuleId)}`,
      });
    }
  }
  return out;
}

/** delete-dead: remove an entity nothing depends on — drop its `defines` edge,
 *  then the entity. Only entities the goal names as delete targets are offered. */
function groundDeleteDead(operator, state, context) {
  const out = [];
  for (const entityId of context?.deleteTargets || []) {
    if (!hasEntity(state, entityId)) continue;
    if (!signatureMatches(state, entityId, operator.signature)) continue;
    const binding = { entityId };
    if (!preconditionsHold(operator.preconditions, state, binding)) continue;
    const from = moduleDefining(state, entityId);
    const effects = [
      ...(from ? [{ op: "del-edge", subject: from, predicate: "defines", object: entityId }] : []),
      { op: "del-entity", id: entityId },
    ];
    out.push({ name: operator.name, binding, effects, label: `delete ${titleOf(state, entityId)}` });
  }
  return out;
}

// ---- the catalogue -----------------------------------------------------------

const SYMBOL = ["Function", "Method"];

/** The starting operator catalogue: the refactoring literature's settled core
 *  (Opdyke 1992; Fowler 1999). Grounded entries carry a `ground` function; the
 *  rest declare their signature and preconditions and await one. */
export const CODE_OPERATORS = Object.freeze([
  {
    name: "rename",
    summary: "retitle an entity in place; every call site keeps resolving by id",
    signature: { subjectClass: SYMBOL },
    preconditions: ["no-name-collision"],
    ground: groundRename,
  },
  {
    name: "create-module",
    summary: "add a Module a later move can hand a symbol into",
    signature: { subjectClass: "Module" },
    preconditions: [],
    ground: groundCreateModule,
  },
  {
    name: "move",
    summary: "hand an entity to another module, adding the imports its callers need",
    signature: { subjectClass: SYMBOL },
    preconditions: ["move-introduces-no-import-cycle"],
    ground: groundMove,
  },
  {
    name: "delete-dead",
    summary: "remove an entity with no inbound dependency edges",
    signature: { subjectClass: SYMBOL },
    preconditions: ["no-inbound-dependencies"],
    ground: groundDeleteDead,
  },
  {
    name: "inline",
    summary: "replace calls with the single definition's body; the definition then deletes",
    signature: { subjectClass: SYMBOL },
    preconditions: ["single-definition", "no-self-recursion"],
  },
  {
    name: "extract-function",
    summary: "lift a fragment into its own function, its call taking the fragment's place",
    signature: { subjectClass: SYMBOL },
    preconditions: ["no-name-collision"],
  },
  {
    name: "add-parameter",
    summary: "add a parameter with a default; update every call site",
    signature: { subjectClass: SYMBOL },
    preconditions: [],
  },
  {
    name: "wrap",
    summary: "put a guard or decorator around a call boundary",
    signature: { subjectClass: SYMBOL },
    preconditions: [],
  },
  {
    name: "split-module",
    summary: "divide a module's definitions across two, importers re-pointed",
    signature: { subjectClass: "Module" },
    preconditions: [],
  },
  {
    name: "apply-semantic-patch",
    summary: "a taught pattern→replacement pair promoted to a first-class operator (comby/ast-grep-shaped)",
    signature: { subjectClass: SYMBOL },
    preconditions: [],
  },
]);

/** The grounded subset — operators a planner can currently enumerate moves for. */
export const groundedOperators = (catalogue = CODE_OPERATORS) => catalogue.filter((op) => typeof op.ground === "function");

// A move may not drop a test-coverage edge, nor delete a module something still
// covers — the standing "every currently-covered test stays covered" constraint,
// applied to every grounded move regardless of which operator produced it.
const preservesCoverage = (state, move) => {
  const nextState = applyGraphEffects(state, move.effects);
  const covered = new Set(state.edges.filter((r) => r.predicate === "tests").map((r) => r.object));
  const stillCovered = new Set(nextState.edges.filter((r) => r.predicate === "tests").map((r) => r.object));
  for (const id of covered) if (!stillCovered.has(id)) return false;
  return true;
};

/**
 * Every legal grounded move from `state`, given the goal-derived `context`
 * parameter pool, as `{ action, nextState }` pairs — the `applyActions`
 * findActionPath consumes. Deterministic: operators are walked in catalogue
 * order and each grounder is order-stable. The coverage constraint prunes any
 * move that would drop test coverage.
 */
export function codeGraphMoves(state, context, { catalogue = CODE_OPERATORS } = {}) {
  const out = [];
  const seen = new Set([canonicalStateKey(state)]);
  for (const op of groundedOperators(catalogue)) {
    for (const move of op.ground(op, state, context)) {
      if (!preservesCoverage(state, move)) continue;
      const nextState = applyGraphEffects(state, move.effects);
      const key = canonicalStateKey(nextState);
      if (seen.has(key)) continue; // a no-op or a duplicate successor
      seen.add(key);
      out.push({ action: move, nextState });
    }
  }
  return out;
}
