// src/router/guardrail.mjs — the guardrail. Validate an
// EXTERNALLY-proposed `tool_use` against the registry's declared preconditions.
//
// Proves RESOLVABILITY (the tool is registered/declared, args are well-formed, every
// `resolves(param, as)` precondition binds to a real graph entity) — NOT antecedent
// correctness: a cross-turn mis-binding ("it" -> the wrong Commit) still resolves to a
// real entity and passes. "This symbol denotes something real and the call is
// well-formed", never "this is the right something".
//
// Pure over its inputs + ctx.resolve (the binding oracle). No network, no Date.now.

import { capabilityByName, preconditionsOf, PRECOND } from "./registry.mjs";
import { hallucinationsIn } from "./call-validator.mjs";

/** The same read-only breadth-first enrichment as resolver.mjs's `dispatchEachCandidate`:
 *  dispatching the SAME tool once per tied candidate is safe for `readOnly` capabilities
 *  (dispatch performs no writes). Returns `[{candidate, result}, ...]`, or
 *  undefined when there is no dispatcher to run it with. */
async function dispatchEachCandidate(pool, capName, arg, ctx) {
  if (!ctx.dispatch) return undefined;
  // Only readOnly capabilities may be dispatched here: the enrichment runs the
  // SAME tool once per tied candidate, which is only safe when dispatch
  // performs no writes. A registered world-mutating capability is planned
  // over, never dispatched.
  if (capabilityByName(capName)?.readOnly !== true) return undefined;
  const results = [];
  for (const c of pool) {
    const res = await ctx.dispatch(capName, { [arg]: c.label });
    results.push({ candidate: c.label, result: res });
  }
  return results;
}

/** Validate a proposed tool_use. Returns a glass-box verdict:
 *    { ok, tool, denied:[{reason,detail}], steps:[{pred,ok,...}], provenance, candidateResults? }
 *  ok=false with a default-deny/undeclared/unknown-arg/missing-arg denial is structural (no
 *  graph needed); an `unresolved` step is a binding rejection, and an ambiguous `resolves`
 *  term additionally carries `candidateResults` (the tool dispatched once per tied candidate)
 *  when `ctx.dispatch` is wired. `declaredNames=null` skips the declared-set check.
 *  `ctx.resolve(term)` is the resolveObject oracle; omit it for structural-only validation. */
export async function guard(toolUse, declaredNames = null, ctx = {}) {
  const name = toolUse?.name;
  const input = toolUse && typeof toolUse.input === "object" && toolUse.input ? toolUse.input : {};
  const denied = [];
  const steps = [];

  // Default-deny: unknown/unregistered tool is an automatic reject.
  const declaredList = declaredNames ? [...declaredNames] : null;
  const cap = capabilityByName(name);
  if (!cap) {
    denied.push({ reason: "default-deny", detail: `"${name ?? "(none)"}" is not a registered capability` });
    return { ok: false, tool: name ?? null, denied, steps, provenance: "registry default-deny" };
  }
  const structural = hallucinationsIn({ name, input }, declaredList ?? [name]);
  for (const p of structural) {
    // no declared set supplied => "undeclared" isn't a real denial (we synthesised [name]).
    if (!declaredList && p.reason === "undeclared") continue;
    denied.push(p);
  }

  // Precondition check — the STRIPS safety gate, step by step.
  let candidateResults;
  for (const pre of preconditionsOf(name)) {
    if (pre.pred === PRECOND.graphLoaded) {
      steps.push({ step: "precondition", pred: pre.pred, ok: true });
    } else if (pre.pred === PRECOND.anyPresent) {
      const ok = pre.params.some((k) => input[k] !== undefined && input[k] !== null && String(input[k]).trim() !== "");
      steps.push({ step: "precondition", pred: pre.pred, params: pre.params, ok });
      if (!ok) denied.push({ reason: "missing-arg", detail: `${name} needs one of ${pre.params.join("|")}` });
    } else if (pre.pred === PRECOND.resolves) {
      const term = input[pre.param];
      const present = term !== undefined && term !== null && String(term).trim() !== "";
      if (!present) {
        steps.push({ step: "precondition", pred: pre.pred, param: pre.param, value: null, ok: false });
        continue;
      }
      // No oracle wired: assert the arg is PRESENT only, not that it binds.
      if (!ctx.resolve) {
        steps.push({ step: "precondition", pred: pre.pred, param: pre.param, value: term, ok: true, note: "structural-only (no resolver wired)" });
        continue;
      }
      const r = ctx.resolve(String(term));
      const resolvedOk = Boolean(r && r.match && !r.ambiguous);
      steps.push({
        step: "precondition", pred: pre.pred, param: pre.param, value: term,
        ok: resolvedOk,
        ...(r && r.match ? { boundTo: r.match.label, boundClass: r.match.class ?? null, tier: r.tier ?? null } : {}),
        ...(r && r.ambiguous ? { ambiguous: true } : {}),
      });
      if (!resolvedOk) {
        denied.push({
          reason: "unresolved",
          detail: r && r.ambiguous
            ? `${name}.${pre.param}="${term}" is ambiguous (narrow it)`
            : `${name}.${pre.param}="${term}" resolves to no graph entity`,
        });
        if (r && r.ambiguous) {
          const pool = [r.match, ...(r.candidates || [])].slice(0, 4);
          const dispatched = await dispatchEachCandidate(pool, name, pre.param, ctx);
          if (dispatched) candidateResults = dispatched;
        }
      }
    }
  }

  const ok = denied.length === 0;
  return {
    ok, tool: name, denied, steps, provenance: ok ? "resolvable (NOT proven antecedent-correct)" : "denied",
    ...(candidateResults ? { candidateResults } : {}),
  };
}

/** Convenience boolean: does a proposed tool_use PASS the guardrail? */
export async function admits(toolUse, declaredNames = null, ctx = {}) {
  return (await guard(toolUse, declaredNames, ctx)).ok;
}
