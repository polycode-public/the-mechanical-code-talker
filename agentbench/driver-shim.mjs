// agentbench/driver-shim.mjs — the SHIM-TRANSPORT "agent under test".
//
// This is the REAL router-of-today wired behind the AGENTBENCH seam
// (driver(request, tools, ctx) => loopResult, see driver-stub.mjs). It reuses
// the HTTP shim's DETERMINISTIC tool selection — `selectTool` from
// src/server-http.mjs, the exact routing `respondToMessages` calls to emit a
// tool_use — IN-PROCESS (no socket, no network), executes the chosen call via
// the real dispatchTool (ctx.dispatch), and closes the loop on the tool_result.
//
//   1. selectTool(request, declaredNames) — the shim's routing decision. It
//      emits a call ONLY for an explicit COMMANDS verb ("describe X", "callers X",
//      "untested", …) that is declared by the caller, or for tmct_ask when
//      declared. AGENTBENCH cases can only declare REGISTRY capabilities (never
//      tmct_ask), so a free-NL request that is not in the command register maps
//      to NOTHING → the shim answers in text → here that is an honest REFUSE.
//   2. structural self-check — the same zero-hallucination gate the grader uses
//      (hallucinationsIn). The shim never reaches outside the declared set, so it
//      structurally CANNOT hallucinate; the check is a belt-and-braces invariant.
//   3. EXECUTE via ctx.dispatch: a ToolError (unresolvable entity) is an honest
//      miss → REFUSE (never emit a call the graph can't ground); success → emit
//      the call + a proof chain and terminate (the loop closes on the tool_result).
//
// STAMP: every row is driver:"shim-transport". This is the TRANSPORT / INTERFACE
// FLOOR, NOT the router baseline: the shim is the common-interface serialization
// layer, not the routing brain. The real anchor is the resolver/planner driver
// (built next). Its one PROVEN property here is the router's non-negotiable: it
// holds 0% hallucination — it refuses / answers-in-text rather than emit an
// ungrounded call — while completion on NL cases stays low until the resolver lands.

import { hallucinationsIn } from "./grade.mjs";
import { selectTool } from "../src/server-http.mjs";
import { preconditionsOf, effectsOf, PRECOND } from "../src/domain/router/registry.mjs";

const DRIVER = "shim-transport";

/** Build the glass-box proof chain from a capability's preconditions + effect,
 *  given dispatch SUCCEEDED (so `resolves` steps are ok). Mirrors the stub's
 *  proofFor — the receipt the grader validates when a case sets expect.proof. */
function proofFor(tool, input) {
  const steps = [];
  for (const pre of preconditionsOf(tool)) {
    if (pre.pred === PRECOND.graphLoaded) steps.push({ step: "precondition", pred: pre.pred, ok: true });
    else if (pre.pred === PRECOND.resolves) steps.push({ step: "precondition", pred: pre.pred, param: pre.param, value: input[pre.param] ?? null, ok: true });
    else if (pre.pred === PRECOND.anyPresent) steps.push({ step: "precondition", pred: pre.pred, params: pre.params, ok: pre.params.some((k) => input[k]) });
  }
  for (const eff of effectsOf(tool).add) steps.push({ step: "effect", pred: eff.pred, topic: eff.topic, of: eff.of });
  return steps;
}

const refuse = (why) => ({ calls: [], refused: true, terminated: true, proof: [], driver: DRIVER, why });

/** The shim-transport driver. See file header for the seam contract. */
export async function shimDriver(request, tools, ctx) {
  const declaredNames = new Set(tools);

  // 1. the shim's routing decision (server-http.mjs selectTool). No mapped,
  //    declared, dispatch-backed tool → the shim would answer in text → REFUSE.
  const sel = selectTool(request, declaredNames);
  if (!sel) return refuse("shim mapped the request to a text answer (no declared command-register tool)");

  const call = { name: sel.name, input: sel.input || {} };

  // 2. structural self-check — the same gate the grader enforces. The shim never
  //    reaches outside `tools`, so this must never trip; if it did, refuse rather
  //    than emit (the router's non-negotiable: never a hallucinated call).
  if (hallucinationsIn(call, tools).length) return refuse("selected call did not validate against the registry");

  // 3. execute through the REAL dispatchTool. A ToolError = unresolvable entity =
  //    honest miss → REFUSE (do NOT emit a call the graph can't ground). The loop
  //    closes on this tool_result (the shim relays it as an end_turn text answer).
  const res = await ctx.dispatch(call.name, call.input);
  if (!res.ok) return refuse(`unresolvable: ${res.error}`);

  return {
    calls: [call],
    refused: false,
    terminated: true,
    proof: proofFor(call.name, call.input),
    driver: DRIVER,
    // the actual dispatch output, for transcript provenance (not graded).
    observed: String(res.text ?? "").slice(0, 240),
  };
}
