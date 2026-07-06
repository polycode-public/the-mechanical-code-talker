// agentbench/driver-resolver.mjs — THE ROUTER BASELINE driver (Stage 1 + Stage 3
// wired behind the AGENTBENCH seam driver(request, tools, ctx) => loopResult).
//
// This is NOT a floor: it is the real capability router. A SINGLE-shot request
// goes through the RESOLVER (src/router/resolver.mjs — command register -> NL
// parse -> imperative frame -> backward chaining -> resolveObject binding); a
// MULTI-step request goes through the PLANNER (src/router/planner.mjs — HTN
// decomposition + POP causal-link proof + Steel & Ho monitor-and-replan under a
// hard budget). Both refuse honestly (never a hallucinated / ungrounded call) —
// the router's non-negotiable, inherited from the resolver + planner.
//
// 0.8.1 — RESULT COMPOSITION. AGENTBENCH_0.8.0 graded the call-PLAN, not the
// executed composed answer (its own caveat). This driver now EXECUTES the plan and
// FOLDS the threaded step-results into ONE composed answer, picking the fold
// operator from the router's OWN HTN method (relative-filter -> intersect;
// conditional -> fallback/guard). The composition runs INSIDE driver() — i.e.
// inside runCase's Promise.race timeout guard — so a plan that never grounds can
// never hang the caller (the 0.8.0 backstop still wraps us). grade.mjs then
// value-compares `composed` to the STATIC expect.result literal (it imports no
// composition fn — no circular re-derivation).
//
// STAMP: every row is driver:"resolver-0.8.0" — the router baseline the shim-
// transport floor is measured against.

import { resolveOne } from "../src/router/resolver.mjs";
import { plan, isMultiStep, decompose } from "../src/router/planner.mjs";
import { intersect, fallbackIfEmpty, guardIfEmpty } from "./results.mjs";

export const DRIVER = "resolver-0.8.0";

/** Fold a multi-step plan's EXECUTED, threaded step results into one composed
 *  answer, choosing the operator from the router's HTN method. Re-dispatches each
 *  produced call through ctx.dispatch to read its STRUCTURED result set (`result`)
 *  — deterministic, read-only, and inside the driver's own timeout guard.
 *    - relative-filter ("of the <set>, which are <Y>")  -> set INTERSECTION
 *    - conditional "... <action> instead"               -> FALLBACK-if-empty
 *    - conditional "if <check>, <action>"               -> GUARD-if-empty
 *    - sequence (independent "... then ...")            -> no single composed set
 *  Returns a label array, or null when the method composes nothing (sequence). */
async function composeResult(request, calls, ctx) {
  const { method } = decompose(request);
  if (method !== "relative-filter" && method !== "conditional") return null;
  if (calls.length < 2) return null; // a relaxed/short plan cannot fold — result stays unmet

  const sets = [];
  for (const c of calls) {
    const res = await ctx.dispatch(c.name, c.input || {});
    sets.push(res.ok && Array.isArray(res.result) ? res.result : []);
  }

  if (method === "relative-filter") return intersect(sets[0], sets[1]);
  // conditional: "instead" is the FALLBACK recipe (take the alternative when the
  // guard set is empty); a bare "if <check>, <action>" is the GUARD recipe (the
  // action fires only when the guard set is empty).
  return /\binstead\b/i.test(request) ? fallbackIfEmpty(sets[0], sets[1]) : guardIfEmpty(sets[0], sets[1]);
}

/** The router-baseline driver. Single-call via the resolver; multi-step via the
 *  planner, then RESULT composition. Returns a graded loopResult. */
export async function resolverDriver(request, tools, ctx) {
  // MULTI-STEP -> the planner (HTN + POP + monitor). It labels its own rows.
  if (isMultiStep(request)) {
    const loop = await plan(request, tools, ctx, { driver: DRIVER });
    if (loop.refused) return loop;
    // EXECUTE + FOLD the plan into a composed answer (inside the timeout guard).
    const composed = await composeResult(request, loop.calls, ctx);
    return composed === null ? loop : { ...loop, composed };
  }

  // SINGLE-SHOT -> the resolver. No fold: a single grounded call IS its own
  // answer (result-graded cases here are those whose TRUE answer needs a
  // multi-step fold the single shot does not emit — they stay result-unmet,
  // which is the honest plan-vs-result gap the split exists to show).
  const r = await resolveOne(request, tools, ctx, { execute: true });
  if (r.refused) {
    return { calls: [], refused: true, terminated: true, proof: [], driver: DRIVER, why: r.reason };
  }
  return {
    calls: [r.selected],
    refused: false,
    terminated: true,
    proof: r.proof,
    driver: DRIVER,
    why: r.why,
    observed: r.observed,
  };
}
