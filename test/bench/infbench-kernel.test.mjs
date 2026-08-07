// infbench kernel-arm ladder pin — the pure closure/prover driven directly
// over every committed case that declares "kernel" in its arms, INF-1 through
// INF-5, asserted clean on every band. Sibling of infbench.test.mjs, which
// covers the grading core's rules piecemeal on hand-built rows; this file is
// the always-run receipt that the kernel clears its own declared domain over
// the committed case set.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { BANDS, parseCases, gradeKernelRow, rollup, ladderGate } from "../../test-benchmarks/infbench/grade.mjs";

const CASES_FILE = fileURLToPath(new URL("../../test-benchmarks/infbench/cases.jsonl", import.meta.url));
const KERNEL_BANDS = ["INF-1", "INF-2", "INF-3", "INF-4", "INF-5"];

test("infbench: the kernel arm clears every band it declares (INF-1..INF-5) at 0% fabrication", async () => {
  const { cases, errors } = parseCases(await readFile(CASES_FILE, "utf8"));
  assert.deepEqual(errors, []);

  const kernelCases = cases.filter((c) => c.arms.includes("kernel"));
  assert.ok(kernelCases.length > 0, "the committed set carries kernel-arm cases");

  const rows = kernelCases.map((c) => ({ band: c.band, ...gradeKernelRow(c) }));
  for (const row of rows) assert.ok(row.observed != null, "every kernel-arm case is inside the kernel's declared domain");

  const rolled = rollup(rows);
  for (const band of KERNEL_BANDS) {
    const cell = rolled.byBand[band];
    assert.ok(cell, `${band}: no kernel rows reached this band`);
    assert.equal(cell.gatePass, true, `${band}: gate must pass`);
    assert.equal(cell.completion, 1, `${band}: completion must be total`);
    assert.equal(cell.fabricationRate, 0, `${band}: fabrication rate must be zero`);
  }
  for (const band of BANDS) {
    if (!KERNEL_BANDS.includes(band)) assert.ok(!rolled.byBand[band], `${band}: outside the kernel's declared domain`);
  }

  const gate = ladderGate(rolled);
  assert.equal(gate.gatedAt, null, "the kernel arm clears every band it reaches — nothing gates it");
});
