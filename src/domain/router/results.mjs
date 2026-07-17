// src/domain/router/results.mjs — the RESULT-EXECUTION layer for the capability router.
//
// Grading (and the live `tmct plan` surface) needs more than a call PLAN — it
// needs the executed, COMPOSED answer: an "of the modules impacted by X, which
// are untested" request passes by emitting tmct_impact then tmct_untested IN
// ORDER, but the actual set-intersection still has to be computed and checked.
// This module supplies that, in two halves, both PURE over the parsed graph
// (no I/O, no Date.now, no LLM):
//
//   1. resultSetOf(graph, name, input, resolvedInd) — the STRUCTURED RESULT of a
//      single grounded call: the SET of entity LABELS the query produces (the
//      impacted modules, the untested modules, the callers, the members, …),
//      computed from the SAME codegraph primitives dispatchTool renders as text.
//      A driver threads this onto ctx.dispatch's return (`result`) — the
//      structured payload a composer reads. It is the machine-checkable twin of
//      the human text a tool_result carries.
//
//   2. the COMPOSITION OPERATORS — intersect / fallback-if-empty / guard-if-empty
//      (set-algebra.mjs) — the small set-algebra a multi-step plan needs to fold
//      its threaded step results into ONE composed answer. A driver picks the
//      operator from the router's OWN HTN method (relative-filter -> intersect;
//      conditional -> fallback/guard).
//
// Why recompute here rather than parse the rendered text: the text is capped and
// human-formatted (renderImpact caps lists "for brevity"); the label SET is the
// honest, uncapped truth the composition needs. These extractors mirror the
// dispatchTool render* functions edge-for-edge.

import { impactClosure, edgesOfKind, siteOf } from "../codegraph.mjs";
import { uniqSort } from "./set-algebra.mjs";
import { isTestPath } from "../module-paths.mjs";

/** The module id an individual belongs to — a Module is itself; a fine symbol maps
 *  through its site span (`mod:<path>`), else an `fn:<path>#name` id. Mirrors the
 *  private codegraph.moduleIdOf so tests_for/history resolve to the same key
 *  dispatchTool uses. Null if unmappable. */
function moduleIdOf(graph, ind) {
  if ((ind?.class || "") === "Module") return ind.id;
  const site = siteOf(ind);
  if (site) return `mod:${site.path}`;
  const m = String(ind?.id || "").match(/^fn:(.+)#/);
  return m ? `mod:${m[1]}` : null;
}

// ---- per-tool structured result sets (label sets), mirroring render* ----------

/** Source modules with no covering test module (mirrors renderUntested). */
export function untestedModules(graph) {
  const covered = new Set();
  const testModules = new Set();
  for (const e of edgesOfKind(graph, "tests")) { covered.add(e.object); testModules.add(e.subject); }
  return uniqSort(
    graph.individuals
      .filter((i) => (i.class || "") === "Module"
        && !testModules.has(i.id)
        && !isTestPath(String(i.label).toLowerCase())
        && !covered.has(i.id))
      .map((i) => i.label),
  );
}

/** The reverse impact closure of a module — every transitive dependent's label
 *  (mirrors renderImpact/impactClosure, uncapped). */
export function impactLabels(graph, ind) {
  const labels = [];
  for (const level of impactClosure(graph, ind)) for (const dep of level) labels.push(dep.label);
  return uniqSort(labels);
}

/** The test modules covering a symbol's module (mirrors renderTestsFor). [] = untested. */
export function testsForLabels(graph, ind) {
  const modId = moduleIdOf(graph, ind);
  if (!modId) return [];
  return uniqSort(edgesOfKind(graph, "tests").filter((e) => e.object === modId).map((e) => e.subjectLabel || e.subject));
}

/** The methods/attributes of a class (mirrors renderMembers — the `contains` edge). */
export function membersLabels(graph, ind) {
  return uniqSort(edgesOfKind(graph, "contains").filter((e) => e.subject === ind.id).map((e) => e.objectLabel || e.object));
}

const CALL_SYMBOL_CLASSES = new Set(["Function", "Method"]);

/** The member INDIVIDUALS of a class — the contains-edge object IDS mapped
 *  through a by-id index of graph.individuals to the FULL individuals (dotted
 *  labels like Widget.render, real classes like Method/Attribute). This is the
 *  GRAIN FIX the member-filter hop needs: the contains edge's objectLabel is the
 *  short member name ("render"), but the call graph (callsSymbol) and the
 *  tmct_callees arg both speak the individual's own dotted label — so we index
 *  to the individual and read ITS label, never string-concatenate one. */
export function memberIndividuals(graph, classInd) {
  const byId = new Map(graph.individuals.map((i) => [i.id, i]));
  return edgesOfKind(graph, "contains")
    .filter((e) => e.subject === classInd.id)
    .map((e) => byId.get(e.object))
    .filter(Boolean);
}

/** Members of a class (Method|Function grain only) whose BOUNDED transitive
 *  callsSymbol closure reaches the target label — the member-filter fold
 *  ("which methods of X end up calling Y"). Depth-bounded BFS over the fine
 *  call graph (maxDepth mirrors the planner/subclasses bound); an unknown
 *  target composes ∅ (an honest empty answer, never a guess). */
export function membersReaching(graph, classInd, targetLabel, maxDepth = 8) {
  const target = graph.individuals.find((i) => String(i.label) === String(targetLabel));
  if (!target) return [];
  const out = new Map();
  for (const e of edgesOfKind(graph, "callsSymbol")) {
    if (!out.has(e.subject)) out.set(e.subject, []);
    out.get(e.subject).push(e.object);
  }
  const reaches = (startId) => {
    const visited = new Set([startId]);
    let frontier = [startId];
    for (let depth = 1; depth <= maxDepth && frontier.length; depth += 1) {
      const next = [];
      for (const id of frontier) {
        for (const o of out.get(id) || []) {
          if (o === target.id) return true;
          if (!visited.has(o)) { visited.add(o); next.push(o); }
        }
      }
      frontier = next;
    }
    return false;
  };
  return uniqSort(
    memberIndividuals(graph, classInd)
      .filter((m) => CALL_SYMBOL_CLASSES.has(m.class))
      .filter((m) => reaches(m.id))
      .map((m) => m.label),
  );
}

/** Callers of a symbol (mirrors renderCallers — callsSymbol for fine symbols,
 *  else module-coarse calls). */
export function callersLabels(graph, ind) {
  if (CALL_SYMBOL_CLASSES.has(ind.class)) {
    return uniqSort(edgesOfKind(graph, "callsSymbol").filter((e) => e.object === ind.id).map((e) => e.subjectLabel || e.subject));
  }
  const modId = moduleIdOf(graph, ind);
  if (!modId) return [];
  return uniqSort(edgesOfKind(graph, "calls").filter((e) => e.object === modId).map((e) => e.subjectLabel || e.subject));
}

/** Callees of a symbol (mirrors renderCallees). */
function calleesLabels(graph, ind) {
  if (CALL_SYMBOL_CLASSES.has(ind.class)) {
    return uniqSort(edgesOfKind(graph, "callsSymbol").filter((e) => e.subject === ind.id).map((e) => e.objectLabel || e.object));
  }
  const modId = moduleIdOf(graph, ind);
  if (!modId) return [];
  return uniqSort(edgesOfKind(graph, "calls").filter((e) => e.subject === modId).map((e) => e.objectLabel || e.object));
}

/** Subclasses (transitive) of a class (mirrors renderSubclasses closure). */
function subclassesLabels(graph, ind) {
  const inherits = edgesOfKind(graph, "inherits");
  const childrenOf = new Map();
  for (const e of inherits) {
    if (!childrenOf.has(e.object)) childrenOf.set(e.object, []);
    childrenOf.get(e.object).push({ id: e.subject, label: e.subjectLabel || e.subject });
  }
  const labels = [];
  const visited = new Set([ind.id]);
  let frontier = [ind.id];
  for (let depth = 1; depth <= 8 && frontier.length; depth += 1) {
    const next = [];
    for (const id of frontier) {
      for (const c of childrenOf.get(id) || []) {
        if (visited.has(c.id)) continue;
        visited.add(c.id);
        labels.push(c.label);
        next.push(c.id);
      }
    }
    frontier = next;
  }
  return uniqSort(labels);
}

/** Modules change-coupled with a symbol's module (mirrors renderCochanges /
 *  cochangeNeighbours EDGE-FOR-EDGE: the `cochange` edge is read SYMMETRICALLY —
 *  a hit whether the module is the edge's subject OR its object). The render
 *  caps at 20 for brevity; this is the uncapped honest label SET). */
export function cochangesLabels(graph, ind) {
  const modId = moduleIdOf(graph, ind);
  if (!modId) return [];
  const labels = [];
  for (const e of edgesOfKind(graph, "cochange")) {
    if (e.subject === modId) labels.push(e.objectLabel || e.object);
    else if (e.object === modId) labels.push(e.subjectLabel || e.subject);
  }
  return uniqSort(labels);
}

/** A module's public exports (mirrors renderExports — the `reexports` edge). */
function exportsLabels(graph, ind) {
  const modId = moduleIdOf(graph, ind);
  if (!modId) return [];
  return uniqSort(edgesOfKind(graph, "reexports").filter((e) => e.subject === modId).map((e) => e.objectLabel || e.object));
}

/** The STRUCTURED RESULT SET of one grounded call — the label set the query
 *  produces, for the composer to thread. `resolvedInd` is the bound entity
 *  (ctx.dispatch's `resolved`); a no-arg tool (untested) ignores it. A tool with
 *  no set semantics returns the bound entity itself as a singleton (describe /
 *  signature — "the thing looked up"). Never throws: an unbindable call already
 *  refused upstream, so this is only reached on a grounded call. */
export function resultSetOf(graph, name, _input, resolvedInd) {
  switch (name) {
    case "tmct_untested": return untestedModules(graph);
    case "tmct_impact": return resolvedInd ? impactLabels(graph, resolvedInd) : [];
    case "tmct_tests_for": return resolvedInd ? testsForLabels(graph, resolvedInd) : [];
    case "tmct_members": return resolvedInd ? membersLabels(graph, resolvedInd) : [];
    case "tmct_callers": return resolvedInd ? callersLabels(graph, resolvedInd) : [];
    case "tmct_callees": return resolvedInd ? calleesLabels(graph, resolvedInd) : [];
    case "tmct_subclasses": return resolvedInd ? subclassesLabels(graph, resolvedInd) : [];
    case "tmct_cochanges": return resolvedInd ? cochangesLabels(graph, resolvedInd) : [];
    case "tmct_exports": return resolvedInd ? exportsLabels(graph, resolvedInd) : [];
    default: return resolvedInd ? [resolvedInd.label] : [];
  }
}

// ---- the composition operators (the multi-step fold) -------------------------
// Re-exported here (uniqSort included) so a caller can get both halves from one
// module; they LIVE in set-algebra.mjs.
export { uniqSort, intersect, fallbackIfEmpty, guardIfEmpty } from "./set-algebra.mjs";
