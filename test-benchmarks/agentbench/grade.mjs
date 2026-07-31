// agentbench/grade.mjs — the DETERMINISTIC grading core for AGENTBENCH.
//
// AGENTBENCH is the SIBLING of chatbench, on a new axis: it grades the TOOL LOOP
// (driving tool calls), not the chat turn. Same versioned-naming + regression
// discipline; the levels are the TOOL-0→TOOL-8 tool-use RUNGS (a scale drawn from
// this bench's own domain, not CEFR), and — the one
// non-negotiable — a HALLUCINATED tool call is an AUTOMATIC FAIL. There is NO
// LLM judge here: grading is entirely deterministic (compare produced calls to
// expected + gate on the registry), which is the whole point (a deterministic
// router is measured by a deterministic ruler).
//
// This module is PURE (no I/O): case lint, the zero-hallucination gate, the
// per-case verdict, and the per-rung METRIC PAIR + ladder rollup. run.mjs wires
// it to the pluggable driver and the fixture.

import { isCapability } from "../../src/domain/router/registry.mjs";
import { hallucinationsIn } from "../../src/domain/router/call-validator.mjs";
import { parseJsonlRows, rollupBy, ladderGateBy } from "../benchlib/bench.mjs";

// ---- the rungs (the TOOL ladder — tool-use capability, this bench's own scale) ----
// TOOL-0 Direct dispatch: one obvious tool, args on a plate.
// TOOL-1 Tool selection: pick the right tool from a declared set, bind one entity.
// TOOL-2 Scope refusal: refuse cleanly when no declared tool fits or the entity
//        doesn't resolve (closed-world default-deny — carries the honest miss).
// TOOL-3 Sequential composition: a bounded multi-step recipe, thread one result
//        into the next call.
// TOOL-4 Conditional dispatch: branch on a result; retry.
// TOOL-5 Goal planning: compose a plan for a novel goal, closed-world.
// TOOL-6 Goal deduction: self-directed — deduce the goal, then plan it.
// TOOL-7 Recovery & replanning: a plan step fails (a tool returns empty/error)
//        and the driver observes the failure and replans a fallback rather than
//        terminating on the dead branch (expect.recover).
// TOOL-8 Composition under ambiguity: the goal/entity is underspecified, so the
//        driver enumerates the tied readings (expect.candidateResults, one
//        dispatched read per tied candidate) or refuses-with-a-nudge — never an
//        arbitrary pick, never a hallucinated call.
// TOOL-0..TOOL-2 are exercised by the seed set + stub driver; the goal driver
// clears the whole ladder, TOOL-0 through TOOL-8 (see agentbench/envelope.json's
// rungReached). TOOL-7's replanning branch lives in the planner's own method
// table; TOOL-8's tied-candidate composer lives at the resolver's binding seam
// (src/domain/router/{planner,resolver}.mjs).
export const RUNGS = Object.freeze(["TOOL-0", "TOOL-1", "TOOL-2", "TOOL-3", "TOOL-4", "TOOL-5", "TOOL-6", "TOOL-7", "TOOL-8"]);

/** The honest-gate completion floor: the gate is "0% hallucination AT ≥N%
 *  completion". A refuse-everything driver scores 0% hallucination but ~0%
 *  completion and so FAILS the gate — hallucination rate alone is gameable
 *  (coordinator refinement 1). Expressed as a fraction in (0,1]. */
export const COMPLETION_FLOOR = 0.5;

// ---- case lint (mirrors chatbench parseCases: schema, dup ids, referential) --

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Parse cases.jsonl text into { cases, errors }. Errors are lint findings the
 *  test enforces over the committed file (same discipline as chatbench).
 *  `knownLabels` (optional Set of fixture entity labels) turns on the REFERENTIAL
 *  lint of expect.result: every static composed-answer literal must name a real
 *  fixture entity, so a stale literal fails loudly at parse time — the exact
 *  discipline the expected-call lint already applies to call names. */
export function parseCases(text, { knownLabels = null } = {}) {
  return parseJsonlRows(text, (c, cases, errors, at) => {
    if (!RUNGS.includes(c.rung)) errors.push(`${c.id}: rung must be one of ${RUNGS.join("|")}`);
    if (!c.request || typeof c.request !== "string") errors.push(`${c.id}: missing request`);
    if (!Array.isArray(c.tools) || !c.tools.length) {
      errors.push(`${c.id}: tools must be a non-empty array of declared tool names`);
    } else {
      for (const t of c.tools) if (!isCapability(t)) errors.push(`${c.id}: tool "${t}" is not a declared capability`);
    }
    if (!isPlainObject(c.expect)) { errors.push(`${c.id}: missing expect`); return; }
    const e = c.expect;
    if (typeof e.terminates !== "boolean") errors.push(`${c.id}: expect.terminates must be a boolean`);
    if ("refuse" in e && typeof e.refuse !== "boolean") errors.push(`${c.id}: expect.refuse must be a boolean`);
    if ("proof" in e && typeof e.proof !== "boolean") errors.push(`${c.id}: expect.proof must be a boolean`);
    const refuse = e.refuse === true;
    if (!refuse) {
      if (!Array.isArray(e.calls) || !e.calls.length) {
        errors.push(`${c.id}: a non-refuse case needs expect.calls (a non-empty array)`);
      } else {
        e.calls.forEach((call, j) => {
          const cat = `${c.id} call ${j + 1}`;
          if (!isPlainObject(call) || typeof call.name !== "string") { errors.push(`${cat}: call needs a name`); return; }
          if (!(c.tools || []).includes(call.name)) errors.push(`${cat}: "${call.name}" not in the case's declared tools`);
          if ("input" in call && !isPlainObject(call.input)) errors.push(`${cat}: input must be an object`);
          // an expected call must itself be well-formed against the registry
          const h = hallucinationsIn(call, c.tools || []);
          for (const problem of h) errors.push(`${cat}: expected call is ${problem.reason} (${problem.detail})`);
        });
      }
    } else if (e.calls) {
      errors.push(`${c.id}: a refuse case must not also declare expect.calls`);
    }
    // expect.recover — the TOOL-7 marker: after the primary branch returns
    // empty/error, a named FALLBACK call must fire (the driver replans rather
    // than dying on the dead branch). Only on a non-refuse case (a recovery
    // composes a real plan); names a declared `after` tool and a declared
    // `fallback` tool; the case's expect.calls carries the full [primary, …,
    // fallback] sequence the recovering plan produces.
    if ("recover" in e) {
      if (refuse) errors.push(`${c.id}: expect.recover is a plan marker; a refuse case must not declare it`);
      else if (!isPlainObject(e.recover)) errors.push(`${c.id}: expect.recover must be an object naming { after, fallback }`);
      else {
        for (const slot of ["after", "fallback"]) {
          const name = e.recover[slot];
          if (typeof name !== "string" || !name) errors.push(`${c.id}: expect.recover.${slot} must name a tool`);
          else if (!(c.tools || []).includes(name)) errors.push(`${c.id}: expect.recover.${slot} "${name}" is not in the case's declared tools`);
        }
        if (!Array.isArray(e.calls) || !e.calls.length) errors.push(`${c.id}: a recovery case needs expect.calls (the [primary, …, fallback] sequence)`);
      }
    }
    // expect.candidateResults — the TOOL-8 marker: an ambiguous-refusal case
    // carries one dispatched read per TIED candidate (the enumerate-don't-pick
    // shape the skill blesses). Only on a refuse case; each candidate is itself a
    // well-formed call against the declared set.
    if ("candidateResults" in e) {
      if (!refuse) errors.push(`${c.id}: expect.candidateResults only annotates a refuse case (the ambiguous enumerate-or-refuse shape)`);
      else if (!Array.isArray(e.candidateResults) || !e.candidateResults.length) {
        errors.push(`${c.id}: expect.candidateResults must be a non-empty array of dispatched reads`);
      } else {
        e.candidateResults.forEach((call, j) => {
          const cat = `${c.id} candidate ${j + 1}`;
          if (!isPlainObject(call) || typeof call.name !== "string") { errors.push(`${cat}: candidate needs a name`); return; }
          if (!(c.tools || []).includes(call.name)) errors.push(`${cat}: "${call.name}" not in the case's declared tools`);
          if ("input" in call && !isPlainObject(call.input)) errors.push(`${cat}: input must be an object`);
          for (const problem of hallucinationsIn(call, c.tools || [])) errors.push(`${cat}: candidate call is ${problem.reason} (${problem.detail})`);
        });
      }
    }
    // expect.result — the STATIC composed-answer literal (0.8.1). A composition
    // case pins the TRUE end-to-end answer (e.g. the untested-∩-impact set) as a
    // literal array of entity labels; grade.mjs value-compares the driver's
    // composed answer to it (no re-derivation → no circularity). Lint it: an
    // array of non-empty strings, never on a refuse case, and — when a fixture is
    // supplied — every label referential.
    if ("result" in e) {
      if (refuse) errors.push(`${c.id}: a refuse case must not declare expect.result (nothing composes)`);
      if (!Array.isArray(e.result)) errors.push(`${c.id}: expect.result must be an array of entity labels`);
      else {
        e.result.forEach((label, j) => {
          if (typeof label !== "string" || !label.trim()) errors.push(`${c.id} result ${j + 1}: label must be a non-empty string`);
          else if (knownLabels && !knownLabels.has(label)) errors.push(`${c.id} result ${j + 1}: "${label}" is not a fixture entity (stale literal)`);
        });
      }
    }
    // floorExpect — a per-arm override: the resolver-floor arm is graded against
    // this instead of the shared expect. Supports exactly { refuse: true }: a
    // case whose plan needs the goal reasoner declares that the plannerless arm
    // correctly refuses, so the two arms stop disagreeing silently.
    if ("floorExpect" in c) {
      const keys = isPlainObject(c.floorExpect) ? Object.keys(c.floorExpect) : null;
      if (!keys || keys.length !== 1 || c.floorExpect.refuse !== true) {
        errors.push(`${c.id}: floorExpect supports only { refuse: true } — the floor arm either shares the expectation or declares the refusal`);
      }
    }
    cases.push(c);
  });
}

/** The case an arm is actually graded against: a declared `floorExpect`
 *  replaces the shared expectation on the resolver-floor driver only. The
 *  effective expectation inherits `terminates` — a declared refusal must still
 *  terminate. Every other arm (goal, stub, shim) grades the shared expect. */
export function effectiveCaseFor(caseDef, driverName) {
  if (!caseDef.floorExpect || typeof driverName !== "string" || !driverName.startsWith("resolver-")) return caseDef;
  return { ...caseDef, expect: { terminates: caseDef.expect.terminates, ...caseDef.floorExpect } };
}

// ---- the zero-hallucination gate (the AUTOMATIC-FAIL check) ------------------
// hallucinationsIn / isCallWellFormed LIVE in the product router now
// (src/domain/router/call-validator.mjs) — the bench imports the product, never the
// other way round. Re-exported here so every existing bench import keeps working.

export { hallucinationsIn, isCallWellFormed } from "../../src/domain/router/call-validator.mjs";

// ---- expected-vs-produced call matching -------------------------------------

/** A produced call MATCHES an expected one iff same name AND every key the
 *  expected input pins is present with the same (stringified, trimmed) value.
 *  Expected input is a LOWER BOUND — the produced call may carry extra optional
 *  keys (e.g. a search that also set `kind`), but must honor every pinned slot. */
export function callMatches(expected, actual) {
  if (!actual || expected.name !== actual.name) return false;
  const want = expected.input ?? {};
  const got = actual.input ?? {};
  for (const k of Object.keys(want)) {
    if (String(got[k] ?? "").trim() !== String(want[k] ?? "").trim()) return false;
  }
  return true;
}

/** Ordered match: the produced call SEQUENCE satisfies the expected sequence
 *  (same length, positionally matching). Multi-step rungs (B1+) lean on order. */
export function callsMatch(expectedCalls, actualCalls) {
  if (expectedCalls.length !== actualCalls.length) return false;
  return expectedCalls.every((e, i) => callMatches(e, actualCalls[i]));
}

// ---- the per-case verdict ---------------------------------------------------

/** Grade one case against a driver's loopResult:
 *    loopResult = { calls: [{name, input}], refused: bool, terminated: bool,
 *                   proof?: [ {ok:bool, ...} ] }
 *  Deterministic PASS rules:
 *    1. ZERO hallucinated calls (any → AUTOMATIC FAIL, regardless of anything else).
 *    2. The loop TERMINATED (expect.terminates).
 *    3. REFUSE case (expect.refuse): PASS iff the driver refused and made no call
 *       — "refusing-when-unsure = PASS at the honest-miss level".
 *    4. Otherwise the produced calls MATCH expect.calls (name + pinned input).
 *    5. When expect.proof, a non-empty proof chain with all precondition steps ok.
 *  Returns { pass, hallucinated:[], completed:bool, reasons:[] }.
 *  `completed` = the expected work was produced (drives the COMPLETION metric);
 *  a correct refusal counts as completed (it is the correct outcome for that case). */
export function gradeCase(caseDef, loopResult) {
  const reasons = [];
  const calls = Array.isArray(loopResult?.calls) ? loopResult.calls : [];
  const declared = caseDef.tools || [];

  // 1. zero-hallucination gate — the automatic fail, checked first + always.
  const hallucinated = [];
  for (const call of calls) {
    const h = hallucinationsIn(call, declared);
    if (h.length) hallucinated.push({ call, problems: h });
  }
  if (hallucinated.length) {
    reasons.push(`hallucinated ${hallucinated.length} call(s): ` +
      hallucinated.map((x) => `${x.call?.name}[${x.problems.map((p) => p.reason).join(",")}]`).join("; "));
  }

  // 2. termination
  const terminated = loopResult?.terminated === true;
  if (caseDef.expect.terminates && !terminated) reasons.push("loop did not terminate");

  // 3 / 4. outcome match
  let completed = false;
  if (caseDef.expect.refuse === true) {
    const refusedCleanly = loopResult?.refused === true && calls.length === 0;
    // TOOL-8: an ambiguous case must ALSO enumerate the tied candidates (one
    // dispatched read each) — a bare refusal that drops the candidates, or an
    // arbitrary pick, is not the enumerate-or-refuse behavior the rung tests.
    let candidatesOk = true;
    if (Array.isArray(caseDef.expect.candidateResults)) {
      const produced = Array.isArray(loopResult?.candidateResults) ? loopResult.candidateResults : null;
      candidatesOk = produced !== null && sameCandidates(produced, caseDef.expect.candidateResults);
      if (!candidatesOk) {
        reasons.push(produced === null
          ? "expected an ambiguous refusal carrying candidateResults (one dispatched read per tied candidate); none produced"
          : `produced candidate set ${describeCalls(produced)} != expected ${describeCalls(caseDef.expect.candidateResults)}`);
      }
    }
    if (refusedCleanly && candidatesOk) completed = true;
    else if (!refusedCleanly) reasons.push("expected an honest refusal; driver produced a call instead");
  } else {
    const expectedCalls = caseDef.expect.calls || [];
    const callsOk = callsMatch(expectedCalls, calls);
    if (!callsOk) reasons.push(`produced calls do not match expected (${describeCalls(calls)} vs ${describeCalls(expectedCalls)})`);
    // TOOL-7: a recovery case must SIGNAL the replan — the fallback fired
    // because the driver observed the primary branch return empty/error, not
    // as an unconditional second step. loopResult.recovered is that signal.
    let recoverOk = true;
    if (caseDef.expect.recover) {
      recoverOk = loopResult?.recovered === true;
      if (!recoverOk) reasons.push("expected a recovery (a fallback branch fired after the primary returned empty/error), but the driver did not signal one");
    }
    if (callsOk && recoverOk) completed = true;
  }

  // 5. proof chain when required — CONNECTEDNESS, not a flat ok-list. A proof is
  //    valid iff it is non-empty, every step is ok (extra keys tolerated), AND —
  //    when it carries POP causal-links (the planner's producer->condition->
  //    consumer edges) — those links CONNECT the goal back to a grounded fact.
  //    Single-call proofs (precondition + effect steps, no causal-links) stay
  //    valid under the every-ok check (lenient for existing stub/shim/resolver
  //    rows), so this only ADDS a check for multi-step causal chains.
  if (caseDef.expect.proof === true) {
    const proof = Array.isArray(loopResult?.proof) ? loopResult.proof : [];
    const valid = proof.length > 0 && proof.every((s) => s.ok !== false) && proofConnected(proof);
    if (!valid) reasons.push("expected a valid proof chain (present, all steps ok, causal chain connected to grounded facts)");
  }

  // 6. RESULT completion — the NEW axis (0.8.1). AGENTBENCH_0.8.0 graded the
  //    call-PLAN; this grades the EXECUTED, COMPOSED answer. A COMPOSITION case
  //    pins expect.result (the true end-to-end set); result-correct iff the
  //    driver's produced composed answer VALUE-EQUALS that static literal (as a
  //    set), with zero hallucination and termination. grade.mjs imports NO
  //    composition function — it only compares the driver's `composed` field to
  //    the literal, so the check is not the code testing itself. A case WITHOUT
  //    expect.result has nothing to compose: its result axis mirrors plan
  //    completion (a single grounded call / a correct refusal IS its own answer).
  //    resultReasons are separate so the plan verdict (`pass`) is untouched — the
  //    plan-vs-result SPLIT is the whole point.
  const resultReasons = [];
  let resultCompleted;
  if (Array.isArray(caseDef.expect.result)) {
    const composed = Array.isArray(loopResult?.composed) ? loopResult.composed : null;
    const ok = hallucinated.length === 0 &&
      (!caseDef.expect.terminates || terminated) &&
      composed !== null &&
      sameSet(composed, caseDef.expect.result);
    resultCompleted = ok;
    if (!ok) {
      resultReasons.push(composed === null
        ? "no composed result produced (the plan did not execute+fold to an answer)"
        : `composed result ${describeSet(composed)} != expected ${describeSet(caseDef.expect.result)}`);
    }
  } else {
    resultCompleted = completed; // nothing to compose — the plan outcome IS the answer
  }

  const pass = hallucinated.length === 0 &&
    (!caseDef.expect.terminates || terminated) &&
    completed &&
    reasons.length === 0;
  return { pass, hallucinated, completed, resultCompleted, reasons, resultReasons };
}

/** Set equality over two label arrays (order/duplication-insensitive) — the
 *  value-level comparison the result axis uses. */
export function sameSet(a, b) {
  const as = new Set(a.map(String));
  const bs = new Set(b.map(String));
  if (as.size !== bs.size) return false;
  for (const x of as) if (!bs.has(x)) return false;
  return true;
}

const describeSet = (xs) => (xs.length ? `{${[...xs].map(String).sort().join(", ")}}` : "∅");

/** Canonical key for one dispatched read ({name, input}) — name plus its pinned
 *  input slots, sorted, so two candidate sets compare order-insensitively. */
const candidateKey = (c) => {
  const input = c?.input ?? {};
  const slots = Object.keys(input).sort().map((k) => `${k}=${String(input[k])}`);
  return `${c?.name}(${slots.join(",")})`;
};

/** Set equality over two candidate-read arrays (the TOOL-8 tied-candidate
 *  comparator): same {name,input} multiset, order-insensitive. */
export function sameCandidates(a, b) {
  const as = new Set((a || []).map(candidateKey));
  const bs = new Set((b || []).map(candidateKey));
  if (as.size !== bs.size) return false;
  for (const x of as) if (!bs.has(x)) return false;
  return true;
}

/** CONNECTEDNESS of a POP proof: when a proof carries `causal-link` steps
 *  (producer -> condition -> consumer), the chain must be GROUNDED — at least one
 *  link is rooted at the graph, every link is ok, and every producer is either the
 *  grounded graph or an earlier plan step (never a dangling reference). A proof
 *  with NO causal-links (a single-call precondition/effect receipt) is connected
 *  by definition (nothing to chain) — kept lenient so existing rows still pass. */
export function proofConnected(proof) {
  const links = proof.filter((s) => s && s.step === "causal-link");
  if (!links.length) return true; // single-call receipt — nothing to connect
  let rooted = false;
  for (const l of links) {
    if (l.ok === false) return false;
    const p = String(l.producer ?? "");
    if (p === "graph") { rooted = true; continue; }
    if (!/^step-\d+$/.test(p)) return false; // producer must be the graph or a real prior step
  }
  return rooted; // the chain must ultimately touch a grounded fact
}

const describeCalls = (calls) =>
  calls.length ? calls.map((c) => `${c.name}(${JSON.stringify(c.input ?? {})})`).join(" → ") : "«none»";

// ---- per-rung METRIC PAIR + ladder rollup -----------------------------------

/** Fold graded rows into the per-rung METRIC PAIR the coordinator requires:
 *    - completion (coverage): fraction of cases whose expected outcome was
 *      correctly produced (the right call(s), or a correct refusal).
 *    - hallucination: fraction of cases with ANY out-of-set / unbindable call.
 *  The honest GATE is "0% hallucination AT ≥COMPLETION_FLOOR completion" — a
 *  refuse-everything driver hits 0% hallucination but fails on completion.
 *  Returns { byRung: {A0:{...}}, overall:{...} }. */
export function rollup(rows) {
  const { byTier, overall } = rollupBy(rows, RUNGS, (r) => r.rung, tallyOne);
  return { byRung: byTier, overall };
}

function tallyOne(rows) {
  const total = rows.length;
  const passed = rows.filter((r) => r.verdict.pass).length;
  const completed = rows.filter((r) => r.verdict.completed).length;
  const resultCompleted = rows.filter((r) => r.verdict.resultCompleted).length;
  const hallucinated = rows.filter((r) => r.verdict.hallucinated.length > 0).length;
  const completion = total ? completed / total : 0;
  const resultCompletion = total ? resultCompleted / total : 0;
  const hallucinationRate = total ? hallucinated / total : 0;
  return {
    total, passed, completed, resultCompleted, hallucinated,
    completion, resultCompletion, hallucinationRate,
    // the honest gate: no hallucination AND enough call-plan completion to prove
    // it isn't a refuse-everything degenerate. The gate stays on PLAN completion
    // (unchanged from 0.8.0); result-completion is reported ALONGSIDE, never
    // silently folded into the gate — composing an answer is strictly harder than
    // emitting the plan, and conflating them would hide that.
    gatePass: hallucinationRate === 0 && completion >= COMPLETION_FLOOR,
  };
}

/** Ladder gating (mirrors chatbench's runGradedDraw --ladder): rungs run
 *  A0→C2; the FIRST rung that does not pass the honest gate GATES every rung
 *  above it, which is reported as skipped-with-a-receipt. Returns
 *  { order, gatedAt, receipts:[{rung, reason}] } over a completed rollup. */
export function ladderGate(rolled) {
  return ladderGateBy(rolled.byRung, {
    tiers: RUNGS,
    tierKey: "rung",
    rateOf: (c) => c.hallucinationRate,
    rateLabel: "hallucination",
    floor: COMPLETION_FLOOR,
  });
}

/** Human-readable metric-pair table for the console. Shows BOTH completion axes:
 *  plan-completion (the call-plan, gated) and result-completion (the executed,
 *  composed answer) — the honest plan-vs-result split. */
export function renderRollup(rolled) {
  const row = (label, c) =>
    `${label.padEnd(5)} ${String(c.total).padStart(2)}  ${String(c.passed).padStart(4)}  ` +
    `${(c.completion * 100).toFixed(0).padStart(9)}%  ${(c.resultCompletion * 100).toFixed(0).padStart(11)}%  ` +
    `${(c.hallucinationRate * 100).toFixed(0).padStart(5)}%  ${c.gatePass ? "PASS" : "----"}`;
  const lines = ["rung   n  pass  plan-compl  result-compl  halluc  gate"];
  for (const rung of RUNGS) {
    const c = rolled.byRung[rung];
    if (c) lines.push(row(rung, c));
  }
  lines.push(row("all", rolled.overall));
  return lines.join("\n");
}
