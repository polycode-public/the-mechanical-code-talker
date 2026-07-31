// synthbench-code smoke test — proves the SYNTHBENCH-CODE runner executes its
// smallest rung (SYN-0) end to end and writes a well-formed result. Covers the
// harness deterministically: the case set lints clean, the runner synthesizes +
// verifies through the real sandbox, and the graded rows carry the four-metric
// verdict the gate reads. Kept to SYN-0 (subprocess sandbox, sub-second).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { parseCases, RUNGS, rollup, ladderGate } from "../../test-benchmarks/synthbench/code/grade.mjs";
import { runSynthbenchCode, DEFAULT_CASES } from "../../test-benchmarks/synthbench/code/run.mjs";

const CASES_TEXT = await readFile(fileURLToPath(new URL("../../test-benchmarks/synthbench/code/cases.jsonl", import.meta.url)), "utf8");

test("cases.jsonl lints clean and every case sits on a known SYN rung", () => {
  const { cases, errors } = parseCases(CASES_TEXT);
  assert.deepEqual(errors, [], `lint errors: ${errors.join("; ")}`);
  assert.ok(cases.length >= 2, "expected at least one positive and one poisoned SYN-0 case");
  for (const c of cases) assert.ok(RUNGS.includes(c.rung), `${c.id}: rung ${c.rung} is unknown`);
  assert.ok(cases.some((c) => c.poisoned === true), "expected a poisoned (abstention) case");
  assert.ok(cases.some((c) => c.poisoned !== true), "expected a non-poisoned (synthesis) case");
});

test("the runner clears the SYN-0 rung end to end: real edit, real verification, honest refusal", async () => {
  const { cases } = parseCases(CASES_TEXT);
  const syn0 = cases.filter((c) => c.rung === "SYN-0");
  const { rows, rolled, ladder } = await runSynthbenchCode(syn0, { stamp: "smoke", ladder: true });

  // every row is a well-formed graded result
  for (const r of rows) {
    assert.equal(typeof r.caseId, "string");
    assert.equal(r.rung, "SYN-0");
    assert.ok(r.outcome && r.verdict, `${r.caseId} missing outcome/verdict`);
    assert.equal(typeof r.verdict.pass, "boolean");
  }

  // a non-poisoned case produced a verified artifact; a poisoned case refused
  const positive = rows.find((r) => !r.poisoned);
  assert.equal(positive.verdict.verifiedComplete, true, "a positive SYN-0 case must verify-complete");
  assert.equal(positive.outcome.byteDeterministic, true, "the synthesized edit must be byte-deterministic");
  const poisoned = rows.find((r) => r.poisoned);
  assert.equal(poisoned.outcome.abstained, true, "a poisoned SYN-0 case must refuse, never mangle");
  assert.equal(poisoned.verdict.pass, true, "a clean refusal on a poisoned case is a pass");

  // the SYN-0 rung passes the honest gate: zero false-pass, full abstention,
  // verified-completion over the floor
  const cell = rolled.byRung["SYN-0"];
  assert.equal(cell.falsePassRate, 0, "the automatic-fail line: zero false-pass");
  assert.equal(cell.abstentionCorrectness, 1, "every poisoned case must refuse correctly");
  assert.ok(cell.verifiedCompletion >= 0.5, "verified-completion must clear the floor");
  assert.equal(cell.gatePass, true, "SYN-0 must pass the rung gate");
  assert.equal(ladder.gatedAt, null, "SYN-0 does not gate itself");
});

test("the runner clears the SYN-3 rung end to end: real rename, real re-index, honest collision refusal", async () => {
  const { cases } = parseCases(CASES_TEXT);
  const syn3 = cases.filter((c) => c.rung === "SYN-3");
  const { rows, rolled, ladder } = await runSynthbenchCode(syn3, { stamp: "smoke", ladder: true });

  for (const r of rows) {
    assert.equal(typeof r.caseId, "string");
    assert.equal(r.rung, "SYN-3");
    assert.ok(r.outcome && r.verdict, `${r.caseId} missing outcome/verdict`);
    assert.equal(typeof r.verdict.pass, "boolean");
  }

  // a non-poisoned rename produced a verified, byte-deterministic artifact
  // whose declared graph-delta reconciles against the re-indexed observation
  const positive = rows.find((r) => !r.poisoned);
  assert.equal(positive.verdict.verifiedComplete, true, "a positive SYN-3 case must verify-complete");
  assert.equal(positive.outcome.tiers["graph-delta"].ok, true, "the declared retitle must reconcile against the re-indexed graph");
  assert.equal(positive.outcome.byteDeterministic, true, "the synthesized edit must be byte-deterministic");

  // a name-collision poisoned case refuses rather than emitting a mangled rename
  const poisoned = rows.find((r) => r.poisoned === true);
  assert.equal(poisoned.outcome.abstained, true, "a poisoned SYN-3 case must refuse, never mangle");
  assert.match(poisoned.outcome.refusalReason, /no-name-collision/, "the collision case must name the failed precondition");
  assert.equal(poisoned.verdict.pass, true, "a clean refusal on a poisoned case is a pass");

  const cell = rolled.byRung["SYN-3"];
  assert.equal(cell.falsePassRate, 0, "the automatic-fail line: zero false-pass");
  assert.equal(cell.abstentionCorrectness, 1, "every poisoned case must refuse correctly");
  assert.ok(cell.verifiedCompletion >= 0.5, "verified-completion must clear the floor");
  assert.equal(cell.gatePass, true, "SYN-3 must pass the rung gate");
  assert.equal(ladder.gatedAt, null, "SYN-3 does not gate itself");
});

test("rollup and ladder are pure over the graded rows", () => {
  const rows = [
    { rung: "SYN-0", poisoned: false, verdict: { pass: true, abstentionCorrect: true, synthesisComplete: true, verifiedComplete: true, falsePass: false } },
    { rung: "SYN-0", poisoned: true, verdict: { pass: true, abstentionCorrect: true, synthesisComplete: false, verifiedComplete: false, falsePass: false } },
  ];
  const rolled = rollup(rows);
  assert.equal(rolled.byRung["SYN-0"].gatePass, true);
  const ladder = ladderGate(rolled);
  assert.equal(ladder.gatedAt, null);
});
