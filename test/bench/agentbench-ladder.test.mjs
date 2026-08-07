// agentbench full-ladder pin — the goal driver (Stage-5 C1+C2 reasoner) driven
// over the whole committed case set, TOOL-0 through TOOL-8, asserted clean on
// every rung. Sibling of agentbench.test.mjs, which covers the substrate and
// individual drivers piecemeal; this file is the single always-run receipt
// that the shipped router clears the full ladder, not just its authored floor.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { RUNGS, parseCases, rollup, ladderGate } from "../../test-benchmarks/agentbench/grade.mjs";
import { goalDriver } from "../../test-benchmarks/agentbench/driver-goal.mjs";
import { runAgentbench, createRunCtx, loadFixtureLabels } from "../../test-benchmarks/agentbench/run.mjs";

const CASES_FILE = fileURLToPath(new URL("../../test-benchmarks/agentbench/cases.jsonl", import.meta.url));

const SHARED = await createRunCtx();
after(() => SHARED.cleanup());

test("agentbench: the goal driver clears every rung TOOL-0..TOOL-8 of the committed ladder at 0% hallucination", async () => {
  const knownLabels = await loadFixtureLabels();
  const { cases, errors } = parseCases(await readFile(CASES_FILE, "utf8"), { knownLabels });
  assert.deepEqual(errors, []);

  const { rolled } = await runAgentbench(cases, { driver: goalDriver, ctx: SHARED.ctx });

  for (const rung of RUNGS) {
    const cell = rolled.byRung[rung];
    assert.ok(cell, `${rung}: no rows reached this rung`);
    assert.equal(cell.gatePass, true, `${rung}: gate must pass`);
    assert.equal(cell.hallucinationRate, 0, `${rung}: hallucination rate must be zero`);
    assert.equal(cell.completion, 1, `${rung}: plan completion must be total`);
    assert.equal(cell.resultCompletion, 1, `${rung}: result completion must be total`);
  }

  const gate = ladderGate(rolled);
  assert.equal(gate.gatedAt, null, "the goal driver clears the full ladder — nothing gates it");
});
