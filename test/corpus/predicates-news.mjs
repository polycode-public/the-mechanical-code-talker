// News lane predicates: the lane's own additions beside predicates.mjs's
// shared exports (run-lane.mjs's lanePredicates merges both).

/** True when this turn wrote no new fact rows — the honest-decline check for
 *  a `/news` turn that reports rather than grounds (e.g. polling with no
 *  sources enabled). */
export function writesNoFacts(result) {
  return Array.isArray(result?.factsTouched) && result.factsTouched.length === 0;
}

/** The whole answer does NOT mention `pattern` — the negative-cache check: a
 *  term parked inside its TTL never resurfaces in a later enrich cycle's
 *  report, not even as a fresh miss. */
export function answerLacks(result, pattern) {
  return !new RegExp(String(pattern)).test(String(result?.answer ?? ""));
}
