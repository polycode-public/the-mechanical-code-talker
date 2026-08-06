// Neutrality-lane predicates (test/corpus/neutrality.jsonl): the domain-
// silence checks the bare-install and active-pack probes both need.

/** No needle (string or array of strings) appears in the answer, case-insensitively. */
export function answerLacks(turn, needles) {
  const text = String(turn?.answer ?? "").toLowerCase();
  const list = Array.isArray(needles) ? needles : [needles];
  return list.every((n) => !text.includes(String(n).toLowerCase()));
}

/** The turn is an honest miss (its record's miss flag is true). */
export function isMiss(turn) {
  return turn?.record?.miss === true;
}
