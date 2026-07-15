// Named predicates that corpus rows can reference by name (mode: "predicate")
// instead of an exact string or a regex. Each takes the turn result (or, for
// bench-smoke rows, the finished process result) plus the row's argument, and
// returns truthy on pass.

/** The turn's answer (or a process result's stdout) contains `needle`,
 *  case-insensitively. */
export function answerIncludes(result, needle) {
  const text = String(result?.answer ?? result?.stdout ?? "");
  return text.toLowerCase().includes(String(needle).toLowerCase());
}
