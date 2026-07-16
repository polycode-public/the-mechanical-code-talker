// Grammar-lane predicates. Session answers carry the always-on "Goal
// (inferred): …" trailer and sometimes a "Canonical: …" trailer; rows that
// need exact-text assertions compare the trailer-stripped body instead of
// baking the trailers into every expected string.
const CANONICAL_LINE_RE = /\n\nCanonical:[^\n]*$/;
const GOAL_LINE_RE = /\n\nGoal \(inferred\):[^\n]*$/;

export function answerBody(turn) {
  return String(turn?.answer ?? "").replace(CANONICAL_LINE_RE, "").replace(GOAL_LINE_RE, "");
}

/** The trailer-stripped answer equals `expected` exactly. */
export function bodyEquals(turn, expected) {
  return answerBody(turn) === String(expected);
}

/** The trailer-stripped answer matches `pattern` (a regex source string). */
export function bodyMatches(turn, pattern) {
  return new RegExp(pattern).test(answerBody(turn));
}

/** Every needle (string or array of strings) appears in the answer, case-insensitively. */
export function answerHasAll(turn, needles) {
  const text = String(turn?.answer ?? "").toLowerCase();
  const list = Array.isArray(needles) ? needles : [needles];
  return list.every((n) => text.includes(String(n).toLowerCase()));
}

/** No needle (string or array of strings) appears in the answer, case-insensitively. */
export function answerLacks(turn, needles) {
  const text = String(turn?.answer ?? "").toLowerCase();
  const list = Array.isArray(needles) ? needles : [needles];
  return list.every((n) => !text.includes(String(n).toLowerCase()));
}

/** Every pattern (regex source string or array of them) matches the answer. */
export function answerMatchesAll(turn, patterns) {
  const text = String(turn?.answer ?? "");
  const list = Array.isArray(patterns) ? patterns : [patterns];
  return list.every((p) => new RegExp(p).test(text));
}

/** No pattern (regex source string or array of them) matches the answer. */
export function answerMatchesNone(turn, patterns) {
  const text = String(turn?.answer ?? "");
  const list = Array.isArray(patterns) ? patterns : [patterns];
  return list.every((p) => !new RegExp(p).test(text));
}

/** The turn answered (its record's miss flag is false). */
export function notMiss(turn) {
  return turn?.record?.miss === false;
}

/** The turn is an honest miss (its record's miss flag is true). */
export function isMiss(turn) {
  return turn?.record?.miss === true;
}
