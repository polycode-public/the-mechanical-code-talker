// src/router/call-validator.mjs — pure registry validators shared by the
// product router (resolver / guardrail / goal-reasoner) + the bench grader
// (agentbench/grade.mjs re-exports these). Depends ONLY on registry.mjs — no
// bench code — so the product←bench dependency stays inverted: the bench
// imports the product, never the other way round. No I/O, no Date.now, no LLM.

import { isCapability, argKeysOf, requiredArgsOf, preconditionsOf, PRECOND } from "./registry.mjs";

/** Every way a single produced call can be a HALLUCINATION — the one thing a
 *  deterministic router must never do. Returns [] for a clean call, else a list
 *  of { reason, detail }:
 *    - "undeclared"  — name is not in the case's declared toolset
 *    - "unknown-tool"— name is not a registry capability at all
 *    - "unknown-arg" — an input key the capability does not accept
 *    - "missing-arg" — a required arg absent (and no any-present precond covers it)
 *  Any nonempty result = AUTOMATIC FAIL for the case. */
export function hallucinationsIn(call, declaredTools) {
  const problems = [];
  const name = call?.name;
  if (typeof name !== "string" || !name) return [{ reason: "unknown-tool", detail: "no tool name" }];
  if (!isCapability(name)) return [{ reason: "unknown-tool", detail: name }];
  if (!declaredTools.includes(name)) problems.push({ reason: "undeclared", detail: name });
  const input = call.input && typeof call.input === "object" ? call.input : {};
  const accepted = argKeysOf(name);
  for (const key of Object.keys(input)) {
    if (!accepted.has(key)) problems.push({ reason: "unknown-arg", detail: `${name}.${key}` });
  }
  // required-arg presence, honoring an any-present disjunction (search: query|kind)
  const anyGroups = preconditionsOf(name)
    .filter((p) => p.pred === PRECOND.anyPresent)
    .map((p) => p.params);
  const present = (k) => input[k] !== undefined && input[k] !== null && String(input[k]).trim() !== "";
  for (const req of requiredArgsOf(name)) {
    if (!present(req)) problems.push({ reason: "missing-arg", detail: `${name}.${req}` });
  }
  for (const group of anyGroups) {
    if (!group.some(present)) problems.push({ reason: "missing-arg", detail: `${name} needs one of ${group.join("|")}` });
  }
  return problems;
}

/** True iff a produced call is dispatchable-shaped (no hallucination). */
export function isCallWellFormed(call, declaredTools) {
  return hallucinationsIn(call, declaredTools).length === 0;
}
