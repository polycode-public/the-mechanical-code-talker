// scripts/claims/claim-determinism.mjs — runs the whole chatbench graded
// pool twice, each from a fresh in-memory store seeded the way
// test-benchmarks/chatbench/run.mjs itself seeds one (createRunnerDeps), and
// checks every case's transcript comes back byte-for-byte identical.
import { readFile } from "node:fs/promises";
import { writeClaim } from "./lib.mjs";
import { DEFAULT_POOL, parseCases, createRunnerDeps, runCasesOrdered } from "../../test-benchmarks/chatbench/run.mjs";

const RELATIVE_POOL = "test-benchmarks/chatbench/graded-pool.jsonl";

// timingMs is wall-clock and explicitly excluded from determinism/row-equality
// checks (run.mjs's own docstring) — every other transcript field is the
// replay's own output, so serializing the transcript array alone is the
// byte-for-byte comparison the case actually asks for.
function transcriptText(row) {
  return row.transcript.map((turn) => JSON.stringify(turn)).join("\n");
}

async function runPoolOnce(cases, stamp) {
  const { deps, cleanup } = await createRunnerDeps(stamp);
  try {
    return await runCasesOrdered(cases, deps);
  } finally {
    await cleanup();
  }
}

function firstDivergence(textA, textB) {
  const linesA = textA.split("\n");
  const linesB = textB.split("\n");
  let i = 0;
  while (i < linesA.length && i < linesB.length && linesA[i] === linesB[i]) i += 1;
  return { line: i + 1, runA: linesA[i] ?? "(run A ended)", runB: linesB[i] ?? "(run B ended)" };
}

async function main() {
  const text = await readFile(DEFAULT_POOL, "utf8");
  const { cases, errors } = parseCases(text);
  if (errors.length) throw new Error(`graded pool lint failed:\n${errors.map((e) => `  - ${e}`).join("\n")}`);

  const t0 = performance.now();
  const runA = await runPoolOnce(cases, "claim-determinism-a");
  const runB = await runPoolOnce(cases, "claim-determinism-b");
  const runtimeMs = Math.round(performance.now() - t0);

  const byIdB = new Map(runB.map((row) => [row.caseId, row]));
  const failures = [];
  let identical = 0;
  for (const rowA of runA) {
    const rowB = byIdB.get(rowA.caseId);
    if (!rowB) {
      failures.push({ caseId: rowA.caseId, why: "missing from the second run" });
      continue;
    }
    const textA = transcriptText(rowA);
    const textB = transcriptText(rowB);
    if (textA === textB) {
      identical += 1;
      continue;
    }
    const { line, runA: lineA, runB: lineB } = firstDivergence(textA, textB);
    failures.push({ caseId: rowA.caseId, why: `runs diverge at transcript line ${line}`, runA: lineA, runB: lineB });
  }

  const total = runA.length;
  const detail = { total, runtimeMs };
  if (failures.length) detail.failures = failures;

  writeClaim("determinism", {
    value: identical,
    unit: "cases",
    threshold: { direction: "min", value: total },
    sources: [RELATIVE_POOL],
    detail,
  });

  console.log(`claim:determinism — ${identical}/${total} cases identical across two fresh-seeded runs (${runtimeMs}ms).`);
  if (failures.length) {
    console.log(`${failures.length} counterexample(s):`);
    for (const f of failures) console.log(`  ${f.caseId}: ${f.why}`);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
