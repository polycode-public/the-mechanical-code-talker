// Inference-lane predicates. Answers are multi-line (list answers, citation
// receipts, the Goal/Canonical trailers), and JS RegExp offers no inline
// multiline flag for the row's plain "regex" mode — these predicates cover
// the line-anchored and negative assertions rows need beyond a bare regex.
// Teach/read rows also assert the turn record's honest hit/miss verdict.
export { notMiss, isMiss } from "./predicates-games.mjs";
export { recordCanonicalAbsent } from "./predicates-planning.mjs";

/** Some line of the answer matches the pattern (multiline ^-anchor stand-in). */
export function answerLineMatches(result, pattern) {
  const re = new RegExp(String(pattern));
  return String(result?.answer ?? "").split("\n").some((line) => re.test(line));
}

/** No line of the answer matches the pattern. */
export function answerNoLineMatches(result, pattern) {
  return !answerLineMatches(result, pattern);
}

/** The whole answer does NOT match the pattern. */
export function answerLacks(result, pattern) {
  return !new RegExp(String(pattern)).test(String(result?.answer ?? ""));
}
