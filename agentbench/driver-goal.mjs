// agentbench/driver-goal.mjs — THE STAGE-5 GOAL-REASONER driver, wired behind the
// AGENTBENCH seam driver(request, tools, ctx) => loopResult.
//
// It is the C2 layer ON TOP of the C1 router: the RFC's reduction is "C2 = C1 + a
// goal-deduction step", so this driver is exactly that composition —
//
//   1. try C1 first (the resolver/planner via resolverDriver). If it routes the
//      request (single-shot or a multi-step plan), that answer stands — the
//      goal-reasoner adds nothing to a request the C1 layer already grounds.
//   2. on a C1 REFUSAL (the escalation seam), hand the request to the
//      goal-reasoner (src/domain/router/goal-reasoner.mjs). It DEDUCES the active goals
//      from the declared goal model over the graph, runs the hard-bounded BDI
//      meta-loop, and either COMPOSES an answer (the coverage-gap set / the
//      keystone module) or REFUSES honestly at the open-world goal-generation
//      seam. It NEVER invents a goal, exactly as C1 never invents a call.
//
// The whole meta-loop (deduce -> plan -> execute -> compose) runs INSIDE this
// driver() call — i.e. inside runCase's Promise.race timeout guard — so the
// 0.8.0 backstop still covers it: a runaway meta-loop records a non-terminating
// loopResult (an automatic FAIL on terminates:true) rather than hanging the
// suite. grade.mjs value-compares the produced `composed` to the STATIC
// expect.result literal (it imports no composition fn — no circular re-derivation).
//
// STAMP: a C1-handled row keeps driver:"resolver-0.8.0"; a C2 goal-reasoned row
// is driver:"goal-0.8.1", so the rollup shows which layer answered each rung.

import { resolverDriver } from "./driver-resolver.mjs";
import { goalReason } from "../src/domain/router/goal-reasoner.mjs";

export const DRIVER = "goal-0.8.1";

/** The goal-reasoner driver: C1 first, then escalate a C1 refusal to the
 *  closed-world C2 goal-reasoner. Returns a graded loopResult. */
export async function goalDriver(request, tools, ctx) {
  // 1. C1 — the resolver/planner. If it grounds the request, that answer stands.
  const c1 = await resolverDriver(request, tools, ctx);
  // A C1 refusal already carrying candidateResults (the tied-candidate
  // composer's enumerate-or-refuse answer) is TERMINAL too — escalating it
  // would trade a complete "both tied readings, dispatched" answer for
  // whatever the goal-reasoner makes of the same refusal (typically a plainer
  // refuse with no candidates at all).
  if (!c1.refused || c1.candidateResults) return c1;

  // 2. C1 refused — escalate to the C2 goal-reasoner (deduce goals -> meta-loop).
  //    A genuine goal-deduction composes an answer; an uncovered novel goal is an
  //    honest refuse (the open-world seam), never an invented goal.
  return goalReason(request, tools, ctx, { driver: DRIVER });
}
