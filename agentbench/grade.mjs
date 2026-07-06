// agentbench/grade.mjs — the DETERMINISTIC grading core for AGENTBENCH.
//
// AGENTBENCH is the SIBLING of chatbench, on a new axis: it grades the TOOL LOOP
// (driving tool calls), not the chat turn. Same versioned-naming + regression
// discipline; the levels are the A0→C2 AGENTIC RUNGS (not CEFR), and — the one
// non-negotiable — a HALLUCINATED tool call is an AUTOMATIC FAIL. There is NO
// LLM judge here: grading is entirely deterministic (compare produced calls to
// expected + gate on the registry), which is the whole point (a deterministic
// router is measured by a deterministic ruler).
//
// This module is PURE (no I/O): case lint, the zero-hallucination gate, the
// per-case verdict, and the per-rung METRIC PAIR + ladder rollup. run.mjs wires
// it to the pluggable driver and the fixture.

import { isCapability, argKeysOf, requiredArgsOf, preconditionsOf, PRECOND } from "../src/router/registry.mjs";

// ---- the rungs (the agentic ladder — analogue of chatbench's CEFR GRADES) ----
// A0 = single obvious tool, args on a plate. A1 = pick the right tool from a
// small declared set + bind one entity. A2 = negation / honest-refuse when the
// tool isn't in set or the entity doesn't resolve. B1 = a bounded multi-step
// recipe (thread one result into the next call). B2 = conditional / retry. C1 =
// compose a plan for a novel goal (closed-world). C2 = self-directed (goal
// deduction). Only A0/A1/A2 are exercised by the seed set + stub driver today;
// the higher rungs are declared so the ladder + regression frame exist up front.
export const RUNGS = Object.freeze(["A0", "A1", "A2", "B1", "B2", "C1", "C2"]);

/** The honest-gate completion floor: the gate is "0% hallucination AT ≥N%
 *  completion". A refuse-everything driver scores 0% hallucination but ~0%
 *  completion and so FAILS the gate — hallucination rate alone is gameable
 *  (coordinator refinement 1). Expressed as a fraction in (0,1]. */
export const COMPLETION_FLOOR = 0.5;

// ---- case lint (mirrors chatbench parseCases: schema, dup ids, referential) --

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** Parse cases.jsonl text into { cases, errors }. Errors are lint findings the
 *  test enforces over the committed file (same discipline as chatbench). */
export function parseCases(text) {
  const cases = [];
  const errors = [];
  const seen = new Set();
  const lines = String(text).split("\n").filter((l) => l.trim());
  lines.forEach((line, i) => {
    const at = `line ${i + 1}`;
    let c;
    try { c = JSON.parse(line); } catch (e) { errors.push(`${at}: invalid JSON — ${e.message}`); return; }
    if (!c.id || typeof c.id !== "string") { errors.push(`${at}: missing id`); return; }
    if (seen.has(c.id)) errors.push(`${at}: duplicate id ${c.id}`);
    seen.add(c.id);
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
    cases.push(c);
  });
  return { cases, errors };
}

// ---- the zero-hallucination gate (the AUTOMATIC-FAIL check) ------------------

/** Every way a single produced call can be a HALLUCINATION — the one thing a
 *  deterministic router must never do. Returns [] for a clean call, else a list
 *  of { reason, detail }:
 *    - "undeclared"  — name is not in the case's declared toolset
 *    - "unknown-tool"— name is not a registry capability at all
 *    - "unknown-arg" — an input key the capability does not accept
 *    - "missing-arg" — a required arg absent (and no any-present precond covers it)
 *  Any nonempty result = AUTOMATIC FAIL for the case. */
export function hallucinationsIn(call, declaredTools) {
  const problems = [];
  const name = call?.name;
  if (typeof name !== "string" || !name) return [{ reason: "unknown-tool", detail: "no tool name" }];
  if (!isCapability(name)) return [{ reason: "unknown-tool", detail: name }];
  if (!declaredTools.includes(name)) problems.push({ reason: "undeclared", detail: name });
  const input = call.input && typeof call.input === "object" ? call.input : {};
  const accepted = argKeysOf(name);
  for (const key of Object.keys(input)) {
    if (!accepted.has(key)) problems.push({ reason: "unknown-arg", detail: `${name}.${key}` });
  }
  // required-arg presence, honoring an any-present disjunction (search: query|kind)
  const anyGroups = preconditionsOf(name)
    .filter((p) => p.pred === PRECOND.anyPresent)
    .map((p) => p.params);
  const present = (k) => input[k] !== undefined && input[k] !== null && String(input[k]).trim() !== "";
  for (const req of requiredArgsOf(name)) {
    if (!present(req)) problems.push({ reason: "missing-arg", detail: `${name}.${req}` });
  }
  for (const group of anyGroups) {
    if (!group.some(present)) problems.push({ reason: "missing-arg", detail: `${name} needs one of ${group.join("|")}` });
  }
  return problems;
}

/** True iff a produced call is dispatchable-shaped (no hallucination). */
export function isCallWellFormed(call, declaredTools) {
  return hallucinationsIn(call, declaredTools).length === 0;
}

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
    if (refusedCleanly) completed = true;
    else reasons.push("expected an honest refusal; driver produced a call instead");
  } else {
    const expectedCalls = caseDef.expect.calls || [];
    if (callsMatch(expectedCalls, calls)) completed = true;
    else reasons.push(`produced calls do not match expected (${describeCalls(calls)} vs ${describeCalls(expectedCalls)})`);
  }

  // 5. proof chain when required
  if (caseDef.expect.proof === true) {
    const proof = Array.isArray(loopResult?.proof) ? loopResult.proof : [];
    const valid = proof.length > 0 && proof.every((s) => s.ok !== false);
    if (!valid) reasons.push("expected a valid proof chain (present, all precondition steps ok)");
  }

  const pass = hallucinated.length === 0 &&
    (!caseDef.expect.terminates || terminated) &&
    completed &&
    reasons.length === 0;
  return { pass, hallucinated, completed, reasons };
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
  const byRung = {};
  for (const rung of RUNGS) {
    const of = rows.filter((r) => r.rung === rung);
    if (of.length) byRung[rung] = tallyOne(of);
  }
  return { byRung, overall: tallyOne(rows) };
}

function tallyOne(rows) {
  const total = rows.length;
  const passed = rows.filter((r) => r.verdict.pass).length;
  const completed = rows.filter((r) => r.verdict.completed).length;
  const hallucinated = rows.filter((r) => r.verdict.hallucinated.length > 0).length;
  const completion = total ? completed / total : 0;
  const hallucinationRate = total ? hallucinated / total : 0;
  return {
    total, passed, completed, hallucinated,
    completion, hallucinationRate,
    // the honest gate: no hallucination AND enough completion to prove it isn't
    // a refuse-everything degenerate.
    gatePass: hallucinationRate === 0 && completion >= COMPLETION_FLOOR,
  };
}

/** Ladder gating (mirrors chatbench's runGradedDraw --ladder): rungs run
 *  A0→C2; the FIRST rung that does not pass the honest gate GATES every rung
 *  above it, which is reported as skipped-with-a-receipt. Returns
 *  { order, gatedAt, receipts:[{rung, reason}] } over a completed rollup. */
export function ladderGate(rolled) {
  const receipts = [];
  let gatedAt = null;
  for (const rung of RUNGS) {
    const cell = rolled.byRung[rung];
    if (!cell) continue;
    if (gatedAt) { receipts.push({ rung, reason: `gated by ${gatedAt}` }); continue; }
    if (!cell.gatePass) {
      gatedAt = cell.hallucinationRate > 0
        ? `${rung} hallucination ${(cell.hallucinationRate * 100).toFixed(0)}%`
        : `${rung} completion ${(cell.completion * 100).toFixed(0)}% < ${(COMPLETION_FLOOR * 100).toFixed(0)}%`;
    }
  }
  return { order: RUNGS.filter((r) => rolled.byRung[r]), gatedAt, receipts };
}

/** Human-readable metric-pair table for the console. */
export function renderRollup(rolled) {
  const lines = ["rung   n  pass  completion  halluc  gate"];
  for (const rung of RUNGS) {
    const c = rolled.byRung[rung];
    if (!c) continue;
    lines.push(
      `${rung.padEnd(5)} ${String(c.total).padStart(2)}  ${String(c.passed).padStart(4)}  ` +
      `${(c.completion * 100).toFixed(0).padStart(9)}%  ${(c.hallucinationRate * 100).toFixed(0).padStart(5)}%  ` +
      `${c.gatePass ? "PASS" : "----"}`,
    );
  }
  const o = rolled.overall;
  lines.push(
    `${"all".padEnd(5)} ${String(o.total).padStart(2)}  ${String(o.passed).padStart(4)}  ` +
    `${(o.completion * 100).toFixed(0).padStart(9)}%  ${(o.hallucinationRate * 100).toFixed(0).padStart(5)}%  ` +
    `${o.gatePass ? "PASS" : "----"}`,
  );
  return lines.join("\n");
}
