// src/router/planner.mjs — Stage 3 of the capability router
// (PLAN_CAPABILITY_ROUTER.md): THE PLANNER. Compose a bounded, ordered plan of
// tool calls for a multi-step request, over the SAME operators Stage 1 resolves
// single-shot. Pure-JS POP/HTN + a Steel & Ho monitor-and-replan loop under a
// HARD budget — sound/complete INSIDE the declared operator model, honest-refuse
// (escalate) for novelty outside it. Deterministic, no-LLM, glass-box.
//
// THE MODEL, mapped to the literature:
//   - HTN decomposition (NONLIN/SHOP2): a compound request is decomposed into an
//     ORDERED list of sub-goals by declared METHODS — the sequencing connectives
//     ("... then ...", "... and then ...") and the two closed recipes we author:
//     the CONDITIONAL method ("if <check>, <action> [instead]") and the
//     RELATIVE-FILTER method ("of the <set> <rel> X, which are <Y>"). Each leaf
//     sub-goal is resolved by Stage 1 (resolveOne) — the primitive operator.
//   - POP causal links (partial-order planning): each step's proof records the
//     PRODUCER -> CONDITION -> CONSUMER link. An independent step's producer is
//     the grounded graph (graph-loaded); a THREADED step (one whose entity came
//     from a prior step via anaphora — "its subclasses", "describe it") records
//     the prior STEP as its producer. That link IS the proof chain (grade.mjs's
//     connectedness check reads it), never a flat ok-list. Least commitment: we
//     only order what the connectives actually order.
//   - Steel & Ho monitor-and-replan: after each call we read the tool_result;
//     a failed sub-goal (an unresolvable entity / an operator that errors) forces
//     an honest STOP (refuse/escalate) rather than pressing on with a broken
//     chain. Bounded depth + a hard step counter GUARANTEE termination — no
//     unbounded search can ever wedge the caller (the harness also caps us).
//

import { resolveOne, extractEntity } from "./resolver.mjs";

// Hard budget — the planner may emit at most this many steps; a request that
// decomposes to more is REFUSED (escalate) rather than searched. Guarantees
// termination independent of the harness backstop.
export const MAX_STEPS = 8;

const PRONOUN_RE = /\b(?:it|its|them|those|these|that|their)\b/i;

/** HTN decomposition — turn a request into an ORDERED list of leaf sub-goals.
 *  Returns { method, segments:[{ text, role, thread }] }:
 *    - role "check"  — a conditional antecedent (a test whose call still emits)
 *    - role "action" — a plain sub-goal
 *    - thread:true   — the segment carries an anaphor to bind from a prior step
 *  A single segment (no connective) means "not multi-step" (the driver hands
 *  those to resolveOne directly). Pure. */
export function decompose(request) {
  const raw = String(request || "").trim();

  // METHOD 1 — the CONDITIONAL recipe: "if <check>, <action> [instead]".
  const cond = raw.match(/^if\s+(.+?),\s*(.+?)(?:\s+instead)?$/i);
  if (cond) {
    return {
      method: "conditional",
      segments: [
        { text: cond[1].trim(), role: "check", thread: PRONOUN_RE.test(cond[1]) },
        { text: cond[2].trim(), role: "action", thread: PRONOUN_RE.test(cond[2]) },
      ],
    };
  }

  // METHOD 2 — the RELATIVE-FILTER recipe: "of the <set> <rel> X, which are <Y>".
  // Decomposes to [produce the <set> (the <rel> over X), filter it by <Y>].
  const rel = raw.match(/^of\s+the\s+(.+?),\s*which\s+(?:are\s+)?(.+?)$/i);
  if (rel) {
    return {
      method: "relative-filter",
      segments: [
        { text: rel[1].trim(), role: "action", thread: false },
        { text: `which are ${rel[2].trim()}`, role: "action", thread: true },
      ],
    };
  }

  // METHOD 3 — the MEMBER-FILTER recipe: "which/what methods|members of X …
  // (end up|eventually)? calling/reaching Y". A C1 surface-syntax recipe like the
  // conditional and relative-filter methods above (the C1 discipline: a closed,
  // authored shape — NOT the C2 goal-reasoner's deduction). Decomposes to
  // [enumerate members(X), filter by bounded transitive call-reach of Y]. The
  // second segment is the filter TARGET, role "member-filter": the DRIVER owns
  // the per-member callees hop + the reachability fold (driver-resolver.mjs) —
  // segment 2 is not a resolvable leaf sub-goal on its own.
  const mem = raw.match(
    /^(?:which|what)\s+(?:methods?|members?)\s+of\s+(.+?)\s+(?:(?:end\s+up|eventually)\s+)?(?:calls?|calling|reach(?:es|ing)?|invokes?|invoking)\s+(.+?)\s*\??$/i,
  );
  if (mem) {
    return {
      method: "member-filter",
      segments: [
        { text: `members ${mem[1].trim()}`, role: "action", thread: false },
        { text: mem[2].trim(), role: "member-filter", thread: true },
      ],
    };
  }

  // METHOD 4 — SEQUENCING: split on the ordered connectives. Least commitment:
  // we only split where a connective actually is.
  const parts = raw.split(/\s*(?:,\s*then\s+|,\s+and\s+then\s+|\s+and\s+then\s+|\s+then\s+|,\s+|\s+and\s+)\s*/i)
    .map((s) => s.replace(/^(?:then\s+|and\s+then\s+|and\s+|also\s+|check\s+|next\s+)/i, "").trim())
    .filter(Boolean);
  const segments = parts.map((text) => ({ text, role: "action", thread: PRONOUN_RE.test(text) }));
  return { method: segments.length > 1 ? "sequence" : "single", segments };
}

/** True iff the request is multi-step (the planner owns it); else the driver
 *  routes it to the single-shot resolver. */
export function isMultiStep(request) {
  return decompose(request).segments.length > 1;
}

/** Substitute a bound anaphor: replace a bare pronoun with the prior step's
 *  entity label so the leaf resolver can bind it ("its subclasses" + Widget ->
 *  "Widget subclasses"; "describe it" + fnAlpha -> "describe fnAlpha"). */
function bindAnaphor(text, lastEntity) {
  if (!lastEntity) return text;
  return text.replace(PRONOUN_RE, lastEntity);
}

/** A conditional ANTECEDENT that tests a SPECIFIC entity's coverage ("X has no
 *  tests", "fnAlpha is untested") is the CHECK operator tmct_tests_for over that
 *  entity — NOT the no-arg tmct_untested (which lists the whole codebase). Rewrite
 *  it to the terse "tests <entity>" command form so the leaf resolver binds the
 *  entity. A check with no coverage predicate is left untouched. */
function rewriteCheck(text, lastEntity) {
  if (!/\b(?:untested|tested|no\s+tests?|has\s+no\s+tests?|tests?|coverage|covered)\b/i.test(text)) return text;
  const entity = extractEntity(text) || lastEntity;
  return entity ? `tests ${entity}` : text;
}

const refuse = (why, driver) => ({ calls: [], refused: true, terminated: true, proof: [], driver, why });

/** Plan + execute a multi-step request. Returns a loopResult
 *    { calls, refused, terminated, proof, why, driver, observed }
 *  with a POP causal-link proof chain. Steel & Ho: each step is monitored; a
 *  failed sub-goal STOPS the plan honestly (refuse/escalate). Bounded by
 *  MAX_STEPS + a hard step counter. `driver` labels the row.
 *
 *  ctx: { dispatch(name,input)->{ok,text,resolved?}, resolve(term)->resolveObject } */
export async function plan(request, declaredNames, ctx, { driver = "resolver-0.8.0" } = {}) {
  const { method, segments } = decompose(request);
  if (segments.length > MAX_STEPS) {
    return refuse(`plan would need ${segments.length} steps (> budget ${MAX_STEPS}) — escalate`, driver);
  }

  const calls = [];
  const proof = [];
  const why = [`HTN method: ${method} — ${segments.length} sub-goal(s)`];
  let lastEntity = null; // the most-recent bound entity label (for anaphora threading)
  let steps = 0;

  for (let i = 0; i < segments.length; i += 1) {
    if (steps >= MAX_STEPS) return refuse("step budget exhausted mid-plan — escalate", driver);
    steps += 1;
    const seg = segments[i];
    let text = seg.thread ? bindAnaphor(seg.text, lastEntity) : seg.text;
    if (seg.role === "check") text = rewriteCheck(text, lastEntity);

    const r = await resolveOne(text, declaredNames, ctx, { execute: true });
    if (r.refused) {
      // Steel & Ho: an unresolvable sub-goal breaks the causal chain — STOP
      // honestly (escalate), never emit a partial/guessed plan.
      return refuse(`sub-goal ${i + 1} ("${text}") did not resolve: ${r.reason}`, driver);
    }

    calls.push(r.selected);
    // POP causal link: the producer is the prior step when this step THREADED an
    // anaphor from it; otherwise the grounded graph. Its condition is the arg the
    // step needed. This is the "why step i" edge, not a flat ok.
    const producer = seg.thread && i > 0 ? `step-${i}` : "graph";
    const boundLabel = r.resolved?.label ?? Object.values(r.selected.input || {})[0] ?? null;
    proof.push({ step: "causal-link", producer, condition: boundLabel, consumer: `step-${i + 1}:${r.selected.name}`, role: seg.role, ok: true });
    for (const s of r.proof) proof.push({ ...s, ofStep: i + 1 });

    if (r.resolved?.label) lastEntity = r.resolved.label;
    why.push(...(r.why || []).map((w) => `[${i + 1}] ${w}`));
  }

  return {
    calls,
    refused: false,
    terminated: true,
    proof,
    driver,
    why,
    observed: `plan(${method}): ${calls.map((c) => c.name).join(" -> ")}`,
  };
}
