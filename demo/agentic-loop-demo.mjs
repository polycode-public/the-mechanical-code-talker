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
// src/router/goal-reasoner.mjs). It cannot attempt a novel task outside those
// rules; it refuses honestly instead (see the REFUSE example below).
//
// Usage: node demo/agentic-loop-demo.mjs

import { createRunCtx } from "../agentbench/run.mjs";
import { goalDriver } from "../agentbench/driver-goal.mjs";

// Five requests chosen to show the full ladder this loop actually climbs — AND an
// honest, freshly-found gap in it (request 5). Do not sand this down: the whole
// house ethos of this codebase is "confident-wrong is the cardinal sin," and this
// demo would be dishonest if it hid the one place that ethos currently slips.
//   1. a plain C1 relative-filter request (the router plans + composes, no goal
//      deduction needed)
//   2. a C2 request with NO explicit filter syntax — the router refuses, and the
//      GOAL-REASONER deduces the coverage-invariant goal-rule from the graph itself
//   3. a C2 request with NO focus entity at all — the goal-reasoner deduces the
//      GLOBAL coverage goal and arbitrates a keystone module by blast radius
//   4. a genuinely UNCOVERED request (a SchemaPredicate focus no goal-rule scopes)
//      — the honest refusal working as designed
//   5. **a request with NOTHING to do with code risk at all** ("write a haiku
//      about pizza") — found live while building this demo. `goalReason`
//      (src/router/goal-reasoner.mjs:226) sets `mode = focus ? "scoped" :
//      "global"`; global-mode rule applicability only checks whether the
//      CALLER'S DECLARED TOOLSET matches a rule's needs (applicableRules) — it
//      never checks whether `request`'s text has any relation to the deduced
//      goal at all once no focus entity binds. So ANY unbindable request, with
//      the SAME declared tools the coverage-invariant rule wants, silently gets
//      the "biggest testing risk" answer — a confident answer to a DIFFERENT
//      question than the one asked, not a refusal. This is real and reachable:
//      a Messages-API-style caller that declares its tool catalog once per
//      session (the normal pattern) would hit this on every off-topic turn.
const REQUESTS = [
  { label: "C1 — compositional relative-filter", request: "of the modules impacted by app/lib/a.mjs, which are untested", tools: ["tmct_impact", "tmct_untested"] },
  { label: "C2 — goal deduction, no filter syntax", request: "is app/lib/a.mjs safe to change", tools: ["tmct_impact", "tmct_untested"] },
  { label: "C2 — global goal, no focus entity, keystone arbitration", request: "which module is the biggest testing risk", tools: ["tmct_untested", "tmct_impact"] },
  { label: "REFUSAL (working as designed) — a SchemaPredicate focus no goal-rule scopes", request: "delete all the tests", tools: ["tmct_impact", "tmct_untested"] },
  { label: "*** GAP, NOT A REFUSAL *** — unrelated request, same declared tools, silently answered", request: "write a haiku about pizza", tools: ["tmct_impact", "tmct_untested"] },
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
  console.log("own deterministic router + goal-reasoner (src/router/) — no model call,");
  console.log("no network, no randomness. Requests 1-3 are the real, validated capability:");
  console.log("closed goal-rules climb reliably. Request 4 is the honest refusal working");
  console.log("as designed. Request 5 is NOT a refusal — it's a gap: an unrelated request");
  console.log("silently got a real, confident, differently-phrased answer instead of being");
  console.log("recognized as out of scope. Root cause: global-mode goal deduction");
  console.log("(src/router/goal-reasoner.mjs:226) gates only on the CALLER'S DECLARED");
  console.log("TOOLSET, never on whether the request text relates to the deduced goal at");
  console.log("all, once no focus entity binds. Logged in HANDOVER.md as a follow-up.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
