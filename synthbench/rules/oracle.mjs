// synthbench/rules/oracle.mjs — PLAN_CODE_PLANNING.md Track 1, Stage 3 (§1.4/§6): the
// VERIFICATION ORACLE. Needs no sandbox at all (§5: "the candidate is DATA,
// not code, run by the SAME trusted engine already shipped") — a candidate
// GOAL_RULE is inserted into a CLONED rule array and run through the real,
// unmodified src/domain/router/goal-reasoner.mjs `goalReason` (the one additive,
// backward-compatible change this track makes to that module: an optional
// `ruleSet` override, defaulted to the real GOAL_RULES for every other
// caller). This mirrors agentbench/driver-goal.mjs's own in-process call —
// proof by existing precedent that grading a candidate rule this way is
// already how this repo works (§1 of the plan).
//
// Grading reuses agentbench/grade.mjs's OWN comparison primitives
// (callsMatch, sameSet, hallucinationsIn) — the plan's own "share tooling"
// instruction (§6: "a labeled example for rule synthesis IS an agentbench
// case, so the two artifacts can share tooling"). No composition function is
// imported to CHECK the candidate's answer — only value-compared to the
// example's own static `expect` literal, the same zero-fabrication posture
// grade.mjs's gradeCase already documents.

import { goalReason } from "../../src/domain/router/goal-reasoner.mjs";
import { callsMatch, sameSet, hallucinationsIn } from "../../agentbench/grade.mjs";
import { backwardChain } from "../../src/domain/router/resolver.mjs";

/** Run ONE candidate rule against ONE labeled example (agentbench case shape:
 *  `{request, tools, expect:{calls?, result?, refuse?}}`) through the REAL
 *  goalReason, with a rule set holding ONLY this candidate — never the real,
 *  shipped GOAL_RULES, so a candidate can never accidentally borrow a
 *  hand-written rule's coverage. Pure pass-through; never throws on a bad
 *  candidate (goalReason itself refuses honestly on anything ungroundable). */
export async function runCandidate(candidate, example, ctx, { driver = "synth-oracle" } = {}) {
  return goalReason(example.request, example.tools, ctx, { driver, ruleSet: Object.freeze([candidate]) });
}

/** Cheap, SYNCHRONOUS pre-filter (no dispatch/graph I/O at all): true iff
 *  BOTH of the candidate's subGoal topics backward-chain to a capability that
 *  is actually IN the example's declared toolset — the exact same
 *  "groundability screen" applicableRules applies (goal-reasoner.mjs:135-155),
 *  computed here WITHOUT running the meta-loop. Lets synthesize.mjs narrow
 *  thousands of candidates down before paying for a single real dispatch
 *  call — a performance discipline, not a new selection rule (a candidate
 *  that fails this can never pass applicableRules either). */
export function groundableInToolset(candidate, declaredTools) {
  const declared = new Set(declaredTools);
  return candidate.subGoals.every((topic) => {
    const cap = backwardChain(topic);
    return Boolean(cap && declared.has(cap.name));
  });
}

/** A candidate PASSES an example iff (1) it hallucinates no call, (2) its
 *  refuse/calls outcome matches expect.refuse / expect.calls exactly (the
 *  same ordered callsMatch grade.mjs's gradeCase uses), and (3), when the
 *  example pins expect.result, the produced composed set value-equals it
 *  exactly (sameSet — order/duplication-insensitive, matching gradeCase's
 *  own result axis). Never partial credit — a candidate either reproduces the
 *  labeled example or it does not. */
export async function passesExample(candidate, example, ctx) {
  const loopResult = await runCandidate(candidate, example, ctx);
  const declared = example.tools;
  for (const call of loopResult.calls || []) {
    if (hallucinationsIn(call, declared).length) return { pass: false, reason: "hallucinated call" };
  }
  if (example.expect.refuse === true) {
    const ok = loopResult.refused === true && (loopResult.calls || []).length === 0;
    return ok ? { pass: true } : { pass: false, reason: "expected an honest refusal" };
  }
  if (loopResult.refused) return { pass: false, reason: `refused: ${loopResult.why}` };
  const expectedCalls = example.expect.calls || [];
  if (!callsMatch(expectedCalls, loopResult.calls || [])) {
    return { pass: false, reason: "produced calls do not match expect.calls" };
  }
  if (Array.isArray(example.expect.result)) {
    const composed = Array.isArray(loopResult.composed) ? loopResult.composed : null;
    if (composed === null || !sameSet(composed, example.expect.result)) {
      return { pass: false, reason: "composed result does not match expect.result" };
    }
  }
  return { pass: true };
}
