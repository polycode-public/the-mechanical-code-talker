// agentbench/results.mjs — the RESULT-EXECUTION layer (AGENTBENCH 0.8.1).
//
// AGENTBENCH_0.8.0 graded the call-PLAN + its causal proof, NOT the executed
// COMPOSED result (its own mandatory caveat): `ab-c1-untested-in-impact` passed
// by emitting tmct_impact then tmct_untested IN ORDER; the actual set-intersection
// ("which impacted modules are untested") was never computed or checked. This
// module retires that caveat. It has two halves, both PURE over the parsed graph
// (no I/O, no Date.now, no LLM):
//
//   1. resultSetOf(graph, name, input, resolvedInd) — the STRUCTURED RESULT of a
//      single grounded call: the SET of entity LABELS the query produces (the
//      impacted modules, the untested modules, the callers, the members, …),
//      computed from the SAME codegraph primitives dispatchTool renders as text.
//      run.mjs threads this onto ctx.dispatch's return (`result`) — the structured
//      payload the composer reads. It is the machine-checkable twin of the human
//      text a tool_result carries.
//
//   2. the COMPOSITION OPERATORS — intersect / fallback-if-empty / guard-if-empty —
//      the small set-algebra a multi-step plan needs to fold its threaded step
//      results into ONE composed answer. The resolver DRIVER (driver-resolver.mjs)
//      picks the operator from the router's OWN HTN method (relative-filter ->
//      intersect; conditional -> fallback/guard) and applies it; grade.mjs never
//      imports these (it only value-compares the driver's composed answer to the
//      STATIC expect.result literal — no circular re-derivation).
//
// Why recompute here rather than parse the rendered text: the text is capped and
// human-formatted (renderImpact caps lists "for brevity"); the label SET is the
// honest, uncapped truth the composition needs. These extractors mirror the
// dispatchTool render* functions edge-for-edge on the fixture (the unit test pins
// each set against a hand-derived fixture truth).

import { impactClosure, edgesOfKind, siteOf } from "../src/codegraph.mjs";
import { uniqSort } from "../src/router/set-algebra.mjs";

// A test-path label, mirroring codegraph.mjs's private isTestLabel (untested view).
const isTestLabel = (s) =>
  /(^|\/)tests?\//.test(s) || /(^|\/)test_[^/]*\.py$/.test(s) || /\.tests(\.|$)/.test(s);

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
        && !isTestLabel(String(i.label).toLowerCase())
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
export function calleesLabels(graph, ind) {
  if (CALL_SYMBOL_CLASSES.has(ind.class)) {
    return uniqSort(edgesOfKind(graph, "callsSymbol").filter((e) => e.subject === ind.id).map((e) => e.objectLabel || e.object));
  }
  const modId = moduleIdOf(graph, ind);
  if (!modId) return [];
  return uniqSort(edgesOfKind(graph, "calls").filter((e) => e.subject === modId).map((e) => e.objectLabel || e.object));
}

/** Subclasses (transitive) of a class (mirrors renderSubclasses closure). */
export function subclassesLabels(graph, ind) {
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
 *  a hit whether the module is the edge's subject OR its object — so with the
 *  fixture's a→b and a→c edges, cochanges(a) = {b, c} AND cochanges(b) = {a}.
 *  The render caps at 20 for brevity; this is the uncapped honest label SET). */
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
export function exportsLabels(graph, ind) {
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
// PURE set-algebra over the threaded step result-sets. The DRIVER selects one by
// the router's HTN method; grade.mjs never imports these. They LIVE in the
// product router now (src/router/set-algebra.mjs) — the bench imports the
// product, never the other way round. Re-exported here (uniqSort included) so
// every existing bench import keeps working.

export { uniqSort, intersect, fallbackIfEmpty, guardIfEmpty } from "../src/router/set-algebra.mjs";
