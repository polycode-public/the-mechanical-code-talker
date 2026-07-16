// src/domain/router/set-algebra.mjs — the COMPOSITION OPERATORS: pure set-algebra a
// multi-step plan needs to fold its threaded step result-sets into ONE composed
// answer. Shared by the product router (goal-reasoner's relative-filter fold)
// and the bench result-execution layer (agentbench/results.mjs re-exports
// these) — the bench imports the product, never the other way round. The
// resolver DRIVER picks the operator from the router's OWN HTN method
// (relative-filter -> intersect; conditional -> fallback/guard) and applies it;
// grade.mjs never imports these (it only value-compares the driver's composed
// answer to the STATIC expect.result literal — no circular re-derivation).
// No I/O, no Date.now, no LLM.

/** Dedupe + locale-stable sort — the canonical label-set normal form. */
export const uniqSort = (xs) => [...new Set(xs)].sort((a, b) => String(a).localeCompare(String(b)));

/** a ∩ b — the relative-filter fold ("of the <set>, which are <Y>"). */
export function intersect(a = [], b = []) {
  const bs = new Set(b);
  return uniqSort([...new Set(a)].filter((x) => bs.has(x)));
}

/** if a is empty -> b, else a — the conditional "… <action> instead" recipe
 *  ("if X has no tests, list what covers Y instead"). */
export function fallbackIfEmpty(a = [], b = []) {
  return uniqSort(a.length ? a : b);
}

/** if a is empty -> b, else ∅ — the guarded conditional ("if X is untested,
 *  <action> it"): the action's result fires ONLY when the guard set is empty. */
export function guardIfEmpty(a = [], b = []) {
  return uniqSort(a.length ? [] : b);
}
