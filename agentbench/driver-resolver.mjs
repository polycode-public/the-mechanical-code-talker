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
// STAMP: every row is driver:"resolver-0.8.0" — the router baseline the shim-
// transport floor is measured against.

import { resolveOne } from "../src/router/resolver.mjs";
import { plan, isMultiStep } from "../src/router/planner.mjs";

export const DRIVER = "resolver-0.8.0";

/** The router-baseline driver. Single-call via the resolver; multi-step via the
 *  planner. Returns a graded loopResult. */
export async function resolverDriver(request, tools, ctx) {
  // MULTI-STEP -> the planner (HTN + POP + monitor). It labels its own rows.
  if (isMultiStep(request)) {
    return plan(request, tools, ctx, { driver: DRIVER });
  }

  // SINGLE-SHOT -> the resolver.
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
