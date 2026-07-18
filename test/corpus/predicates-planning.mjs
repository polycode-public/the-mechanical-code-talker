// Planning-lane predicates. Solve turns return the machine-readable plan on
// the turn itself (turn.plan), so plan-validity checks read structured fields
// instead of re-parsing the rendered answer.
export { answerLineMatches, answerNoLineMatches, answerLacks } from "./predicates-inference.mjs";
export { notMiss, isMiss } from "./predicates-games.mjs";

/** turn.plan matches the given spec; only the keys the spec provides are
 *  checked. Supported keys: actions/states/stepGoals (lengths), goalText,
 *  goalSpecs (count), firstStepGoal (regex source), renderHints (exact
 *  object), orderingLength, membersClass (domain.classMembers[class] is an
 *  array). */
export function planContract(turn, spec = {}) {
  const plan = turn?.plan;
  if (!plan) return false;
  if (spec.actions !== undefined && plan.actions?.length !== spec.actions) return false;
  if (spec.states !== undefined && plan.states?.length !== spec.states) return false;
  if (spec.stepGoals !== undefined && plan.stepGoals?.length !== spec.stepGoals) return false;
  if (spec.goalText !== undefined && plan.goal?.text !== spec.goalText) return false;
  if (spec.goalSpecs !== undefined && plan.goal?.specs?.length !== spec.goalSpecs) return false;
  if (spec.firstStepGoal !== undefined && !new RegExp(spec.firstStepGoal).test(String(plan.stepGoals?.[0] ?? ""))) return false;
  if (spec.renderHints !== undefined && JSON.stringify(plan.domain?.renderHints) !== JSON.stringify(spec.renderHints)) return false;
  if (spec.orderingLength !== undefined && plan.domain?.ordering?.length !== spec.orderingLength) return false;
  if (spec.membersClass !== undefined && !Array.isArray(plan.domain?.classMembers?.[spec.membersClass])) return false;
  return true;
}

/** The turn's sidecar record carries no canonical restatement. */
export function recordCanonicalAbsent(turn) {
  return (turn?.record?.canonical ?? null) === null;
}

/** The pattern occurs in the answer exactly `count` times. */
export function answerCountMatches(turn, { pattern, count }) {
  const found = String(turn?.answer ?? "").match(new RegExp(pattern, "g")) || [];
  return found.length === count;
}
