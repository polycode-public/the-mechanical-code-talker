// src/router/guardrail.mjs — Stage 4 of the capability router
// (PLAN_CAPABILITY_ROUTER.md): THE GUARDRAIL. Validate an EXTERNALLY-proposed
// `tool_use` (e.g. an LLM's chosen call in the hybrid fast-path) against the
// registry's declared preconditions, and DEFAULT-DENY anything outside the
// declared, registered envelope. This is the precondition-checking half of the
// STRIPS model: a call fires only when its preconditions are provably satisfied.
//
// WHAT IT PROVES — and what it deliberately does NOT.
//   The guardrail proves RESOLVABILITY: the tool exists in the registry, it was
//   declared, every arg-key is one the operator accepts, every required arg is
//   present, and every `resolves(param, as)` precondition binds to a real graph
//   entity (delegated to resolveObject — the same oracle Stage 1 uses).
//
//   It does NOT prove ANTECEDENT-CORRECTNESS. A cross-turn mis-binding — "it" ->
//   the wrong Commit, say — produces a call whose symbol STILL resolves to a real
//   entity, so it PASSES the guardrail. T. A gate that leaned on Stage 4 for antecedent correctness would be
//   trusting the wrong layer. The guardrail's contract is narrow and honest:
//   "this symbol denotes SOMETHING real and the call is well-formed", never "this
//   is the RIGHT something".
//
// DEFAULT-DENY: a tool name that is not a registered capability is denied outright
// (identical to a hallucinated/invented tool). The intentionally-unregistered
// unbounded tools (tmct_snippet/tmct_context*) are therefore denied here too — the
// registry is the whole trust boundary.
//
// Pure over its inputs + ctx.resolve (the binding oracle). No network, no Date.now.

import { capabilityByName, preconditionsOf, PRECOND } from "./registry.mjs";
import { hallucinationsIn } from "./call-validator.mjs";

/** PLAN_BREADTH_FIRST_NLU.md §4 — the same read-only breadth-first enrichment as
 *  resolver.mjs's `dispatchEachCandidate`: every registered capability is
 *  `readOnly:true` with an empty delete-list, so dispatching the SAME tool once
 *  per tied candidate is safe. Returns `[{candidate, result}, ...]`, or
 *  undefined when there is no dispatcher to run it with. */
async function dispatchEachCandidate(pool, capName, arg, ctx) {
  if (!ctx.dispatch) return undefined;
  const results = [];
  for (const c of pool) {
    const res = await ctx.dispatch(capName, { [arg]: c.label });
    results.push({ candidate: c.label, result: res });
  }
  return results;
}

/** Validate a proposed tool_use. Returns a glass-box verdict:
 *    { ok, tool, denied:[{reason,detail}], steps:[{pred,ok,...}], provenance, candidateResults? }
 *  - ok=false with a `default-deny`/`undeclared`/`unknown-arg`/`missing-arg`
 *    denial is a STRUCTURAL rejection (no graph needed).
 *  - ok=false with an `unresolved` step is a BINDING rejection (a `resolves`
 *    precondition whose term matched no entity, or matched ambiguously). An
 *    ambiguous `resolves` term stays a denial (never a guess at which candidate
 *    is "the" one) but, when `ctx.dispatch` is wired, ADDITIONALLY carries a
 *    top-level `candidateResults`: the SAME tool dispatched once per tied
 *    candidate (PLAN_BREADTH_FIRST_NLU.md §4 — mirrors resolver.mjs's
 *    resolveOne on the exact same ambiguity shape).
 *  - ok=true means the call is RESOLVABLE + well-formed (NOT proven antecedent-
 *    correct — see the file header).
 *  `declaredNames` may be null to skip the declared-set check (validate against
 *  the registry alone); pass it to also enforce the case/session toolset.
 *  `ctx.resolve(term)` is the resolveObject oracle; omit it to skip binding proof
 *  (structural-only validation). Async only because an ambiguous `resolves` term
 *  may dispatch each candidate via `ctx.dispatch`. */
export async function guard(toolUse, declaredNames = null, ctx = {}) {
  const name = toolUse?.name;
  const input = toolUse && typeof toolUse.input === "object" && toolUse.input ? toolUse.input : {};
  const denied = [];
  const steps = [];

  // 1. DEFAULT-DENY — unknown/unregistered tool is an automatic reject. Reuse the
  //    grader's hallucination check as the single source of truth for structural
  //    well-formedness (unknown-tool / undeclared / unknown-arg / missing-arg).
  const declaredList = declaredNames ? [...declaredNames] : null;
  const cap = capabilityByName(name);
  if (!cap) {
    denied.push({ reason: "default-deny", detail: `"${name ?? "(none)"}" is not a registered capability` });
    return { ok: false, tool: name ?? null, denied, steps, provenance: "registry default-deny" };
  }
  // structural well-formedness against the registry (and the declared set when
  // given — an undeclared-but-registered tool is still a policy denial).
  const structural = hallucinationsIn({ name, input }, declaredList ?? [name]);
  for (const p of structural) {
    // when no declared set is supplied, an "undeclared" finding is not a real
    // denial (we synthesised [name] as the set) — filter it out.
    if (!declaredList && p.reason === "undeclared") continue;
    denied.push(p);
  }

  // 2. PRECONDITION CHECK — the STRIPS safety gate, step by step (the proof).
  let candidateResults;
  for (const pre of preconditionsOf(name)) {
    if (pre.pred === PRECOND.graphLoaded) {
      // graph presence is the harness's responsibility; if a resolver is wired we
      // treat graph-loaded as satisfied (resolveObject would throw without one).
      steps.push({ step: "precondition", pred: pre.pred, ok: true });
    } else if (pre.pred === PRECOND.anyPresent) {
      const ok = pre.params.some((k) => input[k] !== undefined && input[k] !== null && String(input[k]).trim() !== "");
      steps.push({ step: "precondition", pred: pre.pred, params: pre.params, ok });
      if (!ok) denied.push({ reason: "missing-arg", detail: `${name} needs one of ${pre.params.join("|")}` });
    } else if (pre.pred === PRECOND.resolves) {
      const term = input[pre.param];
      const present = term !== undefined && term !== null && String(term).trim() !== "";
      if (!present) {
        // a missing required arg is already flagged structurally; record the step.
        steps.push({ step: "precondition", pred: pre.pred, param: pre.param, value: null, ok: false });
        continue;
      }
      // DELEGATE to resolveObject (the binding oracle). No oracle wired → we can
      // only assert the arg is PRESENT, not that it binds (structural mode).
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
