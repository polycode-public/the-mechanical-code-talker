// src/domain/router/planner.mjs — the planner. Compose a bounded, ordered plan of tool calls for
// a multi-step request, over the SAME operators resolver.mjs resolves single-shot. HTN
// decomposition into leaf sub-goals (each resolved by resolver.mjs),
// with a POP causal-link proof chain (a threaded step's producer is the prior step; an
// independent step's is the grounded graph). Monitored: a failed sub-goal stops the plan
// honestly rather than pressing on. Bounded by MAX_STEPS. Deterministic, no-LLM, glass-box.

import { resolveOne, extractEntity } from "./resolver.mjs";

// Hard budget — a request decomposing to more steps is refused rather than searched.
export const MAX_STEPS = 8;

const PRONOUN_RE = /\b(?:it|its|them|those|these|that|their)\b/i;

// The RECOVER method's check clause must itself name an EMPTY outcome (none/
// nothing/no/not any/empty) — a closed, curated cue list, not a general "any if
// clause is a guard" reading. This is what keeps METHOD 1b narrow: "X, and if Y,
// Z instead" without an emptiness cue in Y falls through to plain sequencing
// unchanged, exactly as it did before this method existed.
const RECOVER_EMPTY_CUE_RE = /\bnone\b|\bnothing\b|\bno\b|\bnot\s+any\b|\bempty\b/i;

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

  // METHOD 1b — the RECOVER recipe: "<primary>, and if <the primary came up
  // empty>, <fallback> [instead]". Unlike METHOD 1 (which always dispatches
  // both sides and folds the answer), the check clause here names no separate
  // call at all — it is read as an emptiness GUARD on the primary's own
  // result, observed at execution rather than dispatched. Requires an
  // emptiness cue in the check clause, so an ordinary "X, and if Y, Z instead"
  // whose Y doesn't name an empty outcome keeps falling through to plain
  // sequencing (METHOD 4), unchanged from before this method existed.
  const recover = raw.match(/^(.+?),\s*(?:and\s+)?if\s+(.+?),\s*(.+?)(?:\s+instead)?$/i);
  if (recover && RECOVER_EMPTY_CUE_RE.test(recover[2])) {
    return {
      method: "recover",
      segments: [
        { text: recover[1].trim(), role: "action", thread: false },
        { text: recover[3].trim(), role: "action", thread: PRONOUN_RE.test(recover[3]) },
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

  // METHOD 3 — the MEMBER-FILTER recipe: "which/what methods|members of X … calling/
  // reaching Y". Decomposes to [enumerate members(X), filter by transitive call-reach of Y];
  // segment 2 (role "member-filter") is not a resolvable leaf on its own — the driver owns
  // the per-member callees hop + reachability fold.
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
 *    { calls, refused, terminated, proof, why, driver, observed, recovered? }
 *  with a POP causal-link proof chain. Each step is monitored; a failed sub-goal stops the
 *  plan honestly. Bounded by MAX_STEPS. A `recover` method OBSERVES its primary step's
 *  own structured result before deciding the fallback: `recovered:true` marks a plan
 *  whose fallback fired because the primary came up empty; a non-empty primary stops the
 *  plan after just that one call (the fallback is never dispatched) and carries no
 *  `recovered` key at all.
 *
 *  ctx: { dispatch(name,input)->{ok,text,resolved?,result?}, resolve(term)->resolveObject } */
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
  let recovered = false;

  for (let i = 0; i < segments.length; i += 1) {
    if (steps >= MAX_STEPS) return refuse("step budget exhausted mid-plan — escalate", driver);
    steps += 1;
    const seg = segments[i];
    let text = seg.thread ? bindAnaphor(seg.text, lastEntity) : seg.text;
    if (seg.role === "check") text = rewriteCheck(text, lastEntity);

    const r = await resolveOne(text, declaredNames, ctx, { execute: true });
    if (r.refused) {
      return {
        ...refuse(`sub-goal ${i + 1} ("${text}") did not resolve: ${r.reason}`, driver),
        ...(r.candidateCalls ? { candidateResults: r.candidateCalls } : {}),
      };
    }

    calls.push(r.selected);
    // Causal link: producer is the prior step when this step threaded an anaphor from it,
    // otherwise the grounded graph.
    const producer = seg.thread && i > 0 ? `step-${i}` : "graph";
    const boundLabel = r.resolved?.label ?? Object.values(r.selected.input || {})[0] ?? null;
    proof.push({ step: "causal-link", producer, condition: boundLabel, consumer: `step-${i + 1}:${r.selected.name}`, role: seg.role, ok: true });
    for (const s of r.proof) proof.push({ ...s, ofStep: i + 1 });

    if (r.resolved?.label) lastEntity = r.resolved.label;
    why.push(...(r.why || []).map((w) => `[${i + 1}] ${w}`));

    // RECOVER's guard: OBSERVE the primary's own structured result (a fresh,
    // read-only re-dispatch — the same idiom composeResult uses to fold a
    // threaded plan) before deciding the fallback. A non-empty primary already
    // answered the request, so the loop stops here — the fallback is never
    // dispatched, closing the bug this method exists to fix (the primary used
    // to double-emit because the guard was never actually observed). An empty
    // primary marks the plan `recovered` and lets the fallback segment run.
    if (method === "recover" && i === 0) {
      const res = await ctx.dispatch(r.selected.name, r.selected.input || {});
      const primaryEmpty = res.ok && Array.isArray(res.result) && res.result.length === 0;
      why.push(`[guard] observed ${r.selected.name} => ${primaryEmpty ? "empty — recovering with the fallback" : "non-empty — the primary already answers this; no fallback dispatched"}`);
      if (!primaryEmpty) break;
      recovered = true;
    }
  }

  return {
    calls,
    refused: false,
    terminated: true,
    proof,
    driver,
    why,
    ...(recovered ? { recovered: true } : {}),
    observed: `plan(${method}): ${calls.map((c) => c.name).join(" -> ")}`,
  };
}
