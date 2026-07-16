// demo/agentic-loop-demo.mjs — a crude, honest demonstration that tmct can drive a
// closed, deterministic "agentic tool loop" — request -> deduce goal -> plan tool
// calls -> execute -> compose an answer -> proof chain — with ZERO LLM calls
// anywhere in the loop.
//
// This is NOT a new engine: it reuses agentbench's own already-tested, already-
// validated infrastructure verbatim (createRunCtx + goalDriver, agentbench/run.mjs
// + agentbench/driver-goal.mjs) — the same machinery AGENTBENCH_0.8.2 measures at
// 100% plan / 98% result / 0% hallucination. The point of this script is only to
// make that capability VISIBLE as a runnable transcript, not to build anything new.
//
// What this is NOT: a general-purpose coding agent. tmct has zero code-generation
// or open-ended-reasoning capability (see HANDOVER.md / PLAN_TMCT_ECOSYSTEM_
// INTEGRATION.md's honest framing) — this loop only ever answers CLOSED, DECLARED
// goals over a code graph (the coverage-gap / keystone goal-rules in
// src/domain/router/goal-reasoner.mjs). It cannot attempt a novel task outside those
// rules; it refuses honestly instead (see the REFUSE example below).
//
// Usage: node demo/agentic-loop-demo.mjs

import { createRunCtx } from "../agentbench/run.mjs";
import { goalDriver } from "../agentbench/driver-goal.mjs";

// Five requests chosen to show the full ladder this loop actually climbs —
// INCLUDING the one honest refusal that used to be a confident-wrong answer
// (request 5, Bug 8, now fixed). Do not sand this down: the whole house ethos
// of this codebase is "confident-wrong is the cardinal sin," and this demo
// would be dishonest if it hid the place that ethos once slipped.
//   1. a plain C1 relative-filter request (the router plans + composes, no goal
//      deduction needed)
//   2. a C2 request with NO explicit filter syntax — the router refuses, and the
//      GOAL-REASONER deduces the coverage-invariant goal-rule from the graph itself
//   3. a C2 request with NO focus entity at all — the goal-reasoner deduces the
//      GLOBAL coverage goal and arbitrates a keystone module by blast radius
//   4. a genuinely UNCOVERED request (a SchemaPredicate focus no goal-rule scopes)
//      — the honest refusal working as designed
//   5. **a request with NOTHING to do with code risk at all** ("write a haiku
//      about pizza") — found live while building this demo, logged as Bug 8, and
//      FIXED (see goal-reasoner.mjs's GLOBAL-MODE DOMAIN GATE, in the module
//      header). Was: `goalReason` set `mode = focus ? "scoped" : "global"`, and
//      global-mode rule applicability checked ONLY whether the CALLER'S DECLARED
//      TOOLSET matched a rule's needs (applicableRules) — never whether
//      `request`'s text had any relation to the deduced goal once no focus
//      entity bound, so ANY unbindable request with the SAME declared tools the
//      coverage-invariant rule wants silently got the "biggest testing risk"
//      answer. The fix reuses ask.mjs's own NL grammar (parseQuery — the SAME
//      primitive the C1 resolver already parses every request with) as a
//      structural relevance gate in global mode: the request must parse to a
//      shape naming the deduced rule's focus class, or it is refused, never
//      answered with someone else's goal. Zero request keywords added.
const REQUESTS = [
  { label: "C1 — compositional relative-filter", request: "of the modules impacted by app/lib/a.mjs, which are untested", tools: ["tmct_impact", "tmct_untested"] },
  { label: "C2 — goal deduction, no filter syntax", request: "is app/lib/a.mjs safe to change", tools: ["tmct_impact", "tmct_untested"] },
  { label: "C2 — global goal, no focus entity, keystone arbitration", request: "which module is the biggest testing risk", tools: ["tmct_untested", "tmct_impact"] },
  { label: "REFUSAL (working as designed) — a SchemaPredicate focus no goal-rule scopes", request: "delete all the tests", tools: ["tmct_impact", "tmct_untested"] },
  { label: "REFUSAL (Bug 8, FIXED) — off-domain request, same declared tools, now honestly refuses", request: "write a haiku about pizza", tools: ["tmct_impact", "tmct_untested"] },
];

function printLoop({ label, request, tools }, loopResult) {
  console.log(`\n${"=".repeat(72)}`);
  console.log(`GOAL   : ${label}`);
  console.log(`REQUEST: "${request}"`);
  console.log(`DECLARED TOOLS: [${tools.join(", ")}]`);
  console.log(`${"-".repeat(72)}`);
  if (loopResult.refused) {
    console.log(`REFUSED honestly: ${loopResult.why || "(no goal-rule covers this request)"}`);
  } else {
    console.log(`TOOL CALLS (deduced + planned, zero LLM):`);
    for (const [i, call] of loopResult.calls.entries()) {
      console.log(`  step ${i + 1}: ${call.name}(${JSON.stringify(call.input || {})})`);
    }
    if (loopResult.composed) {
      console.log(`COMPOSED ANSWER: ${JSON.stringify(loopResult.composed)}`);
    }
    if (loopResult.proof) {
      console.log(`PROOF CHAIN: connected (every step traces to a grounded graph call)`);
    }
  }
  console.log(`DRIVER: ${loopResult.driver}  ·  TERMINATED: ${loopResult.terminated}`);
}

async function main() {
  console.log("tmct agentic-loop demo — deterministic, zero-LLM, goal-driven tool dispatch");
  console.log("(reusing agentbench's own validated createRunCtx + goalDriver, unmodified)");
  const { ctx, cleanup } = await createRunCtx();
  try {
    for (const req of REQUESTS) {
      const loopResult = await goalDriver(req.request, req.tools, ctx);
      printLoop(req, loopResult);
    }
  } finally {
    await cleanup();
  }
  console.log(`\n${"=".repeat(72)}`);
  console.log("Every call above was resolved, planned, executed and composed by tmct's");
  console.log("own deterministic router + goal-reasoner (src/domain/router/) — no model call,");
  console.log("no network, no randomness. Requests 1-3 are the real, validated capability:");
  console.log("closed goal-rules climb reliably. Request 4 is the honest refusal working");
  console.log("as designed. Request 5 USED TO be a gap: an unrelated request silently got");
  console.log("a real, confident, differently-phrased answer instead of being recognized as");
  console.log("global-mode DOMAIN GATE — reusing ask.mjs's own NL grammar (parseQuery) to");
  console.log("require the request itself, not just the declared toolset, to be about the");
  console.log("deduced goal's domain — so it refuses honestly like request 4, zero request");
  console.log("keywords added. See HANDOVER.md / PLAN_CAPABILITY_ROUTER.md for the history.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
