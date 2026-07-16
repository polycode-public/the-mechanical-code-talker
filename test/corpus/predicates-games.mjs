// Games-lane predicates, auto-merged with the shared registry by
// lanePredicates(). The lane replays scripted multi-turn conversations, so
// alongside the grammar lane's trailer-stripped body checks it needs the
// turn-record reads (miss/flow verdicts) and the "a miss must carry a nudge"
// discipline several playtest transcripts pin.
export {
  answerBody, bodyEquals, bodyMatches,
  answerHasAll, answerLacks, answerMatchesAll, answerMatchesNone,
} from "./predicates-grammar.mjs";
import { answerBody } from "./predicates-grammar.mjs";

/** The turn answered (its record's miss flag is false). */
export function notMiss(turn) {
  return turn?.record?.miss === false;
}

/** The turn is an honest miss (its record's miss flag is true). */
export function isMiss(turn) {
  return turn?.record?.miss === true;
}

/** The turn ended the session (a farewell's `end: true`). */
export function sessionEnded(turn) {
  return turn?.end === true;
}

/** The turn left the session open. */
export function sessionContinues(turn) {
  return !turn?.end;
}

/** Either no dead-end pattern matches, or the (trailer-stripped) answer
 *  carries more than the bare miss line — a nudge, a teach-offer, a receipt.
 *  `patterns` is a regex source string or an array of them. */
export function missNeverBare(turn, patterns) {
  const body = answerBody(turn);
  const list = Array.isArray(patterns) ? patterns : [patterns];
  if (!list.some((p) => new RegExp(p).test(body))) return true;
  return body.trim().split("\n").filter((l) => l.trim() !== "").length > 1;
}
