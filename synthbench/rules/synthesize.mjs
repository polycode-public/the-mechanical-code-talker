// synthbench/rules/synthesize.mjs — PLAN_CODE.md Track 1, Stage 4 (§1.4/§6):
// the CEGIS refinement loop. Narrows enumerate.mjs's bounded candidate set
// down to the ones that reproduce EVERY given labeled example exactly (each
// failing example is a genuine counter-example that prunes every candidate
// whose subGoals/compose combination cannot reproduce it — textbook CEGIS,
// PLAN_CODE.md §1.4), then confirms the deterministic survivor against a
// held-out example set never used during the narrowing itself (the direct
// mitigation for the overfitting risk PLAN_CODE.md §7 names).
//
// DETERMINISM (the operator's own requirement, restated): enumerateCandidates()
// walks fixed, frozen arrays in a fixed nested-loop order, so its output order
// never varies; every given example prunes that SAME ordered list in place
// (Array#filter preserves order); the tie-break among behaviorally-equivalent
// survivors (e.g. two compose orientations that happen to fold to the same
// VALUE — intersect is commutative — are indistinguishable by any labeled
// example, since examples only pin calls+composed, never the internal `why`
// text) is "first survivor in that fixed order" — never a heuristic score,
// never Math.random. Re-running synthesizeGoalRule on the same inputs always
// narrows to the same candidate and the same trace, byte-for-byte.

import { enumerateCandidates } from "./enumerate.mjs";
import { passesExample, groundableInToolset } from "./oracle.mjs";

/** Deterministic CEGIS synthesis. `given`/`heldOut` are agentbench-case-shaped
 *  labeled examples (PLAN_CODE.md §1.3: `{id, tools, request, expect}`).
 *  Returns:
 *    { ok:true,  candidate, survivorCount, trace }         — synthesis succeeded
 *    { ok:false, reason, trace, candidate? }                — honest miss:
 *      either no candidate in the grammar reproduces the GIVEN set at all, or
 *      the (otherwise unique) survivor fails a HELD-OUT example — the classic
 *      "overfits the given examples" failure mode, caught and refused rather
 *      than silently shipped (never trust the candidate past what it has
 *      actually proven against). `trace` records the survivor count after
 *      each given example, for a human audit of HOW the search narrowed. */
export async function synthesizeGoalRule(given, heldOut, ctx, { candidates } = {}) {
  if (!given || !given.length) throw new Error("synthesizeGoalRule needs at least one given labeled example");

  let survivors = candidates ?? enumerateCandidates();
  const trace = [];

  for (const example of given) {
    // cheap synchronous pre-filter FIRST (no dispatch calls at all for a
    // candidate that could never ground in this example's declared toolset —
    // a performance discipline, see oracle.mjs's groundableInToolset), THEN
    // the real, expensive per-example check via the trusted engine.
    const groundable = survivors.filter((c) => groundableInToolset(c, example.tools));
    const next = [];
    for (const c of groundable) {
      const { pass } = await passesExample(c, example, ctx);
      if (pass) next.push(c);
    }
    trace.push({ exampleId: example.id, before: survivors.length, groundable: groundable.length, after: next.length });
    survivors = next;
    if (!survivors.length) {
      return { ok: false, reason: `no candidate in the grammar reproduces given example "${example.id}"`, trace };
    }
  }

  // deterministic tie-break: the first survivor in the FIXED enumeration
  // order (never a scoring heuristic — see the module docblock).
  const candidate = survivors[0];

  for (const example of heldOut || []) {
    const { pass, reason } = await passesExample(candidate, example, ctx);
    if (!pass) {
      return { ok: false, reason: `held-out example "${example.id}" failed: ${reason} — overfits the given set`, candidate, trace };
    }
  }

  return { ok: true, candidate, survivorCount: survivors.length, trace };
}
