// Templates-lane predicates, auto-merged with the shared registry by
// lanePredicates(). The lane pins rendered wording, so alongside the shared
// positive checks it needs the negative forms (a template must NOT bleed
// into a neighbouring shape), the session-end signal a farewell carries,
// trailer-stripped exact-wording compares, and the record's miss verdict
// (an honest decline keeps miss:true even when its wording is friendly).
export { answerBody, bodyEquals, bodyMatches, answerHasAll, answerMatchesAll, answerMatchesNone } from "./predicates-grammar.mjs";
export { notMiss, isMiss } from "./predicates-games.mjs";

/** The turn's answer does NOT contain `needle`, case-insensitively. */
export function answerLacks(turn, needle) {
  const text = String(turn?.answer ?? "");
  return !text.toLowerCase().includes(String(needle).toLowerCase());
}

/** The turn's answer does NOT match the given regex source. */
export function answerDoesNotMatch(turn, source) {
  return !new RegExp(source).test(String(turn?.answer ?? ""));
}

/** The turn ended the session (a farewell's `end: true`). */
export function sessionEnded(turn) {
  return turn?.end === true;
}

/** The turn left the session open (a thanks never ends it). */
export function sessionContinues(turn) {
  return !turn?.end;
}
