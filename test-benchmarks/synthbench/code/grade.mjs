// synthbench/code/grade.mjs — the DETERMINISTIC grading core for SYNTHBENCH-CODE.
//
// SYNTHBENCH-CODE grades one thing: can a bounded, no-LLM search produce a code
// artifact a REAL toolchain then verifies, refusing rather than mangling when a
// precondition fails. The levels are the SYN-0→SYN-8 rungs (this bench's own
// scale, unrelated to CHATBENCH/AGENTBENCH/INFBENCH ladders). This module is
// PURE: case lint, the four per-rung metrics, the honest gate, the ladder. The
// real execution (synthesis, sandboxed verification) lives in run.mjs + verify/;
// grade.mjs reads a computed outcome and never touches the network or a model.

import { parseJsonlRows, rollupBy, ladderGateBy } from "../../benchlib/bench.mjs";

// ---- the rungs (the SYN ladder — deterministic code synthesis, own scale) ----
// SYN-0 Observable single edit: add one stdout side effect to a fixture function,
//       verified by RUNNING it and reading the output.
// SYN-1 Expression from examples: synthesize a single-expression body from I/O
//       examples (PBE, closed grammars), held-out-checked.
// SYN-2 Template repair: flip a failing test with a mutation-template, green held,
//       mutation-testing-validated.
// SYN-3 Planned single transformation: one operator, preconditions machine-checked,
//       declared-vs-observed graph delta reconciled.
// SYN-4 Two-step planned refactor: rename + move, importers updated, suite green,
//       byte-deterministic, poisoned variant refused, one mid-plan drift caught.
// SYN-5 Multi-step with replanning: a tier-1 drift forces a replan from observed state.
// SYN-6 Capability from spec: synthesize a new capability, the spec's acceptance
//       tests the oracle.
// SYN-7 Self-source change: a planned transformation on tmct's own non-core source.
// SYN-8 Bootstrapping: regenerate a tmct subsystem from its own specs and tests.
export const RUNGS = Object.freeze(["SYN-0", "SYN-1", "SYN-2", "SYN-3", "SYN-4", "SYN-5", "SYN-6", "SYN-7", "SYN-8"]);

// The verified-completion floor of the rung gate. A synthesizer that refuses
// everything is never wrong and never useful, so a single number is gameable;
// the gate pairs verified-completion >= this floor with zero false-pass and
// perfect abstention.
export const COMPLETION_FLOOR = 0.5;

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// ---- case lint --------------------------------------------------------------

/** Parse cases.jsonl text into { cases, errors }. Errors are lint findings the
 *  smoke test enforces over the committed file. Only the planned-edit family
 *  (SYN-0's family) is validated in depth today; other families' cases are
 *  append-only additions a later cycle lints as it builds their verifier. */
export function parseCases(text) {
  return parseJsonlRows(text, (c, cases, errors) => {
    if (!RUNGS.includes(c.rung)) errors.push(`${c.id}: rung must be one of ${RUNGS.join("|")}`);
    if (typeof c.family !== "string" || !c.family) errors.push(`${c.id}: missing family`);
    if ("poisoned" in c && typeof c.poisoned !== "boolean") errors.push(`${c.id}: poisoned must be a boolean`);
    if (!isPlainObject(c.goal)) { errors.push(`${c.id}: missing goal`); }
    if (c.family === "planned-edit") lintPlannedEdit(c, errors);
    cases.push(c);
  });
}

// The planned-edit family covers more than one operator shape now (SYN-0's
// insert-observable-print, param-shaped targetModule/targetFunction/token;
// SYN-3's rename-entity, param-shaped entityId/newTitle) — lint dispatches on
// goal.operator to the shape that operator actually declares in the catalogue,
// after checking what every planned-edit case shares regardless of operator.
function lintPlannedEdit(c, errors) {
  const g = c.goal ?? {};
  if (typeof g.operator !== "string" || !g.operator) errors.push(`${c.id}: goal.operator must be a non-empty string`);
  if (!Array.isArray(c.catalogue) || !c.catalogue.length) errors.push(`${c.id}: catalogue must be a non-empty array of operator ids`);
  if (g.operator === "rename-entity") lintRenameGoal(c, g, errors);
  else lintInsertPrintGoal(c, g, errors);
}

function lintInsertPrintGoal(c, g, errors) {
  for (const k of ["targetModule", "targetFunction"]) {
    if (typeof g[k] !== "string" || !g[k]) errors.push(`${c.id}: goal.${k} must be a non-empty string`);
  }
  if (!c.poisoned) {
    if (typeof g.token !== "string" || !g.token) errors.push(`${c.id}: a non-poisoned planned-edit needs goal.token`);
    const tiers = c.expect?.tiers;
    if (!Array.isArray(tiers) || !tiers.length) errors.push(`${c.id}: a non-poisoned case needs expect.tiers (a non-empty array)`);
    const se = g.sideEffect;
    if (tiers && tiers.includes("side-effect")) {
      if (!isPlainObject(se) || !isPlainObject(se.run)) errors.push(`${c.id}: a side-effect tier needs goal.sideEffect.run { module, export, args }`);
      else {
        if (typeof se.run.module !== "string") errors.push(`${c.id}: goal.sideEffect.run.module must be a string`);
        if (typeof se.run.export !== "string") errors.push(`${c.id}: goal.sideEffect.run.export must be a string`);
        if (se.contains !== g.token) errors.push(`${c.id}: goal.sideEffect.contains must equal goal.token (the observable the edit emits)`);
      }
    }
  }
}

function lintRenameGoal(c, g, errors) {
  if (typeof g.entityId !== "string" || !g.entityId) errors.push(`${c.id}: goal.entityId must be a non-empty string`);
  if (typeof g.newTitle !== "string" || !g.newTitle) errors.push(`${c.id}: goal.newTitle must be a non-empty string`);
  if (!c.poisoned) {
    const tiers = c.expect?.tiers;
    if (!Array.isArray(tiers) || !tiers.length) errors.push(`${c.id}: a non-poisoned case needs expect.tiers (a non-empty array)`);
  }
}

// ---- per-case verdict -------------------------------------------------------

/** Grade one case against its computed outcome. The outcome (assembled in
 *  run.mjs from synth + verify) has the shape:
 *    { abstained, refusalReason,
 *      tier0Ok,            // the artifact cleared tier 0 (it parses)
 *      verifiedComplete,   // the full declared tier stack passed
 *      byteDeterministic } // same fixture + goal → byte-identical edits
 *  Deterministic rules:
 *   - poisoned case: PASS iff it ABSTAINED (a clean refusal, no artifact).
 *     A poisoned case that emits an artifact is an abstention failure (the
 *     product's central promise), never scored pass.
 *   - non-poisoned case: synthesis-complete iff it produced an artifact clearing
 *     tier 0; verified-complete iff the full tier stack passed AND the edit is
 *     byte-deterministic (overfit folds into verification). PASS = verified.
 *   - false-pass: scored pass whose artifact did NOT actually survive
 *     verification — the automatic-fail line; must be 0.
 *  Returns { pass, abstentionCorrect, synthesisComplete, verifiedComplete, falsePass, reasons }. */
export function gradeCase(caseDef, outcome) {
  const reasons = [];
  const poisoned = caseDef.poisoned === true;

  if (poisoned) {
    const abstained = outcome.abstained === true;
    if (!abstained) reasons.push("expected a clean refusal (a precondition must fail), but the synthesizer emitted an artifact");
    return {
      pass: abstained, abstentionCorrect: abstained,
      synthesisComplete: false, verifiedComplete: false, falsePass: false, reasons,
    };
  }

  if (outcome.abstained === true) {
    reasons.push(`expected an artifact, but the synthesizer refused: ${outcome.refusalReason ?? "no reason given"}`);
    return { pass: false, abstentionCorrect: true, synthesisComplete: false, verifiedComplete: false, falsePass: false, reasons };
  }

  const synthesisComplete = outcome.tier0Ok === true;
  const reallyVerified = outcome.verifiedComplete === true && outcome.byteDeterministic === true;
  if (!synthesisComplete) reasons.push("artifact did not clear tier 0 (it does not parse)");
  else if (!outcome.verifiedComplete) reasons.push("artifact did not pass the full verification tier stack");
  else if (!outcome.byteDeterministic) reasons.push("artifact is not byte-deterministic on re-run (overfit is a verification failure)");

  const pass = reallyVerified;
  const falsePass = pass && !reallyVerified; // structurally 0; computed to catch a grading bug
  return { pass, abstentionCorrect: true, synthesisComplete, verifiedComplete: reallyVerified, falsePass, reasons };
}

// ---- per-rung metrics + ladder ----------------------------------------------

/** Fold graded rows into { byRung, overall } with the four metrics the skill
 *  requires per rung: synthesis-completion, verified-completion,
 *  abstention-correctness, false-pass rate — plus the honest gate. */
export function rollup(rows) {
  const { byTier, overall } = rollupBy(rows, RUNGS, (r) => r.rung, tallyOne);
  return { byRung: byTier, overall };
}

function tallyOne(rows) {
  const total = rows.length;
  const nonPoisoned = rows.filter((r) => r.poisoned !== true);
  const poisoned = rows.filter((r) => r.poisoned === true);
  const synthesised = nonPoisoned.filter((r) => r.verdict.synthesisComplete).length;
  const verified = nonPoisoned.filter((r) => r.verdict.verifiedComplete).length;
  const abstainedCorrect = poisoned.filter((r) => r.verdict.abstentionCorrect).length;
  const falsePass = rows.filter((r) => r.verdict.falsePass).length;
  const passed = rows.filter((r) => r.verdict.pass).length;

  const synthesisCompletion = nonPoisoned.length ? synthesised / nonPoisoned.length : 0;
  const verifiedCompletion = nonPoisoned.length ? verified / nonPoisoned.length : 0;
  const abstentionCorrectness = poisoned.length ? abstainedCorrect / poisoned.length : 1;
  const falsePassRate = total ? falsePass / total : 0;
  const gatePass = falsePassRate === 0 && abstentionCorrectness === 1 && verifiedCompletion >= COMPLETION_FLOOR;
  return {
    total, passed, poisoned: poisoned.length,
    synthesisCompletion, verifiedCompletion, abstentionCorrectness, falsePassRate,
    // `completion` aliases verified-completion so the shared ladder helper's
    // "completion N% < floor%" receipt reads against the gated metric.
    completion: verifiedCompletion, hallucinationRate: falsePassRate, gatePass,
  };
}

/** Ladder gating: rungs run SYN-0→SYN-8; the FIRST rung that fails the gate
 *  gates every rung above it, reported skipped-with-a-receipt. A rung with no
 *  cases is a not-yet-built ceiling marker — reported separately in run.mjs,
 *  never read as a pass or a fail. Returns { order, gatedAt, receipts }. */
export function ladderGate(rolled) {
  return ladderGateBy(rolled.byRung, {
    tiers: RUNGS,
    tierKey: "rung",
    rateOf: (c) => c.falsePassRate,
    rateLabel: "false-pass",
    floor: COMPLETION_FLOOR,
  });
}

/** Human-readable metric table for the console. */
export function renderRollup(rolled) {
  const pct = (x) => `${(x * 100).toFixed(0)}%`;
  const row = (label, c) =>
    `${label.padEnd(6)} ${String(c.total).padStart(2)}  ${String(c.passed).padStart(4)}  ` +
    `${pct(c.synthesisCompletion).padStart(10)}  ${pct(c.verifiedCompletion).padStart(9)}  ` +
    `${pct(c.abstentionCorrectness).padStart(7)}  ${pct(c.falsePassRate).padStart(6)}  ${c.gatePass ? "PASS" : "----"}`;
  const lines = ["rung    n  pass  synth-compl  ver-compl  abst-ok  fpass  gate"];
  for (const rung of RUNGS) {
    const c = rolled.byRung[rung];
    if (c) lines.push(row(rung, c));
  }
  lines.push(row("all", rolled.overall));
  return lines.join("\n");
}
