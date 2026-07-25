// agentbench/driver-resolver.mjs — THE ROUTER BASELINE driver (Stage 1 + Stage 3
// wired behind the AGENTBENCH seam driver(request, tools, ctx) => loopResult).
//
// This is NOT a floor: it is the real capability router. A SINGLE-shot request
// goes through the RESOLVER (src/domain/router/resolver.mjs — command register -> NL
// parse -> imperative frame -> backward chaining -> resolveObject binding); a
// MULTI-step request goes through the PLANNER (src/domain/router/planner.mjs — HTN
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

import { resolveOne } from "../../src/domain/router/resolver.mjs";
import { plan, isMultiStep, decompose, MAX_STEPS } from "../../src/domain/router/planner.mjs";
import { intersect, fallbackIfEmpty, guardIfEmpty, memberIndividuals, membersReaching } from "./results.mjs";

export const DRIVER = "resolver-0.8.0";

const refuse = (why) => ({ calls: [], refused: true, terminated: true, proof: [], driver: DRIVER, why });

// The member grains a call-reachability hop applies to (a class also `contains`
// Attributes — no call edges, no callees hop).
const CALLABLE_MEMBER_CLASSES = new Set(["Method", "Function"]);

/** Execute the MEMBER-FILTER method ("which methods of X end up calling Y") —
 *  the per-member hop the single-shot resolver cannot emit. Step 1 grounds
 *  members(X) via resolveOne (grounded call 1); then, per CALLABLE member
 *  (sorted, bounded by the planner's MAX_STEPS budget), one tmct_callees hop —
 *  each an appended, grounded call. The fold is membersReaching (the bounded
 *  transitive callsSymbol closure), computed over the graph, never parsed from
 *  text. The proof chain stays a connected POP chain: step 1 is rooted at the
 *  grounded graph; every hop's producer is step-1 (the member list it consumed).
 *  Honest refuses: no tmct_callees in the declared set (the hop cannot be
 *  grounded), an unbindable filter target, an over-budget member list. */
async function memberFilterDrive(request, tools, ctx, segments) {
  const [setSeg, filterSeg] = segments;
  if (!tools.includes("tmct_callees")) {
    return refuse("the member-filter reachability hop needs tmct_callees, which is not in the declared toolset — refusing the hop rather than guessing the fold");
  }
  // the filter TARGET must bind to exactly one graph entity (the resolves oracle).
  const t = ctx.resolve ? ctx.resolve(String(filterSeg.text)) : null;
  if (!t || !t.match || t.ambiguous) {
    return refuse(`the member-filter target "${filterSeg.text}" does not bind to one graph entity (honest miss)`);
  }
  const target = t.match;

  // step 1 — the grounded member enumeration ("members <X>") via the resolver.
  const r1 = await resolveOne(setSeg.text, tools, ctx, { execute: true });
  if (r1.refused) return refuse(`sub-goal 1 ("${setSeg.text}") did not resolve: ${r1.reason}`);
  const classInd = r1.resolved;
  if (!classInd) return refuse(`sub-goal 1 ("${setSeg.text}") grounded no class entity to enumerate`);

  const calls = [r1.selected];
  const proof = [{ step: "causal-link", producer: "graph", condition: classInd.label, consumer: `step-1:${r1.selected.name}`, role: "action", ok: true }];
  for (const s of r1.proof) proof.push({ ...s, ofStep: 1 });
  const why = [
    `HTN method: member-filter — enumerate members(${classInd.label}), hop tmct_callees per callable member, fold by bounded transitive reach of ${target.label}`,
    ...(r1.why || []).map((w) => `[1] ${w}`),
  ];

  // the per-member hop: callable members only, sorted, bounded by the plan budget.
  const members = memberIndividuals(ctx.graph, classInd)
    .filter((m) => CALLABLE_MEMBER_CLASSES.has(m.class))
    .sort((a, b) => String(a.label).localeCompare(String(b.label)));
  if (1 + members.length > MAX_STEPS) {
    return refuse(`member-filter needs ${1 + members.length} steps (> budget ${MAX_STEPS}) — escalate`);
  }
  for (let i = 0; i < members.length; i += 1) {
    const m = members[i];
    const res = await ctx.dispatch("tmct_callees", { symbol: m.label });
    if (!res.ok) return refuse(`the callees hop for ${m.label} did not ground: ${res.error}`);
    calls.push({ name: "tmct_callees", input: { symbol: m.label } });
    proof.push({ step: "causal-link", producer: "step-1", condition: m.label, consumer: `step-${i + 2}:tmct_callees`, role: "member-filter", ok: true });
    why.push(`[${i + 2}] callees hop over ${m.label} (a member step 1 produced)`);
  }

  const composed = membersReaching(ctx.graph, classInd, target.label);
  return {
    calls, refused: false, terminated: true, proof, driver: DRIVER, why, composed,
    observed: `plan(member-filter): ${calls.map((c) => c.name).join(" -> ")} => {${composed.join(", ")}}`,
  };
}

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
  // MEMBER-FILTER -> the per-member hop (the planner's leaf resolver cannot
  // resolve the filter segment alone; the driver owns the hop + the fold).
  const d = decompose(request);
  if (d.method === "member-filter") return memberFilterDrive(request, tools, ctx, d.segments);

  // MULTI-STEP -> the planner (HTN + POP + monitor). It labels its own rows.
  if (isMultiStep(request)) {
    const loop = await plan(request, tools, ctx, { driver: DRIVER });
    if (loop.refused) return loop;
    // EXECUTE + FOLD the plan into a composed answer (inside the timeout guard).
    const composed = await composeResult(request, loop.calls, ctx);
    return composed === null ? loop : { ...loop, composed };
  }

  // SINGLE-SHOT -> the resolver. No fold to compute: a single grounded call IS
  // its own answer, so its composed answer is the call's own STRUCTURED result
  // set, read back through ctx.dispatch (read-only, deterministic, inside the
  // timeout guard — the same re-dispatch composeResult does for folds). A case
  // that pins expect.result on a single-shot plan grades against exactly this.
  const r = await resolveOne(request, tools, ctx, { execute: true });
  if (r.refused) {
    return {
      calls: [], refused: true, terminated: true, proof: [], driver: DRIVER, why: r.reason,
      // the tied-candidate composer's answer: one dispatched read per tied
      // candidate, riding the refusal rather than an arbitrary pick.
      ...(r.candidateCalls ? { candidateResults: r.candidateCalls } : {}),
    };
  }
  const res = await ctx.dispatch(r.selected.name, r.selected.input || {});
  return {
    calls: [r.selected],
    refused: false,
    terminated: true,
    proof: r.proof,
    driver: DRIVER,
    why: r.why,
    observed: r.observed,
    ...(res.ok && Array.isArray(res.result) ? { composed: res.result } : {}),
  };
}
