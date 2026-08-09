// scripts/claims/claim-syllogist.mjs — measures the EL classifier and DL
// tableau's practical impact on the chat surface. Replays the INF-7 and INF-8
// corpus rows (the nested-existential E1/E2 and the more complex DL shapes)
// through the shipped engine, counts how many verdicts moved from "unproven"
// to "yes" — the measurable claim the plan makes.
//
// The plan names this phase 6 work: showing that phases 2 (EL wiring) and 4
// (SHOIQ) deliver a real, counted improvement on the chat surface.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runInfbench } from "../../test-benchmarks/infbench/run.mjs";
import { parseCases } from "../../test-benchmarks/infbench/grade.mjs";
import { writeClaim, defaultHardware } from "./lib.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CASES_FILE = join(ROOT, "test-benchmarks", "infbench", "cases.jsonl");

async function loadInf7Inf8Cases() {
  const text = await readFile(CASES_FILE, "utf8");
  const { cases } = parseCases(text);
  // Filter to INF-7 and INF-8 only
  return cases.filter((c) => c.band === "INF-7" || c.band === "INF-8");
}

async function measure() {
  const cases = await loadInf7Inf8Cases();

  if (cases.length === 0) {
    throw new Error("no INF-7 or INF-8 cases found in cases.jsonl");
  }

  // Tally the "before" verdicts from the committed case expectations
  const beforeVerdicts = new Map();
  for (const c of cases) {
    const verdict = c.expect.verdict;
    beforeVerdicts.set(verdict, (beforeVerdicts.get(verdict) ?? 0) + 1);
  }

  // Run the cases through infbench's chat arm to get actual verdicts
  const { chat } = await runInfbench(cases, { concurrency: 6 });

  // Tally the "after" verdicts from the actual chat runs
  const afterVerdicts = new Map();
  let budgetExhaustedCount = 0;
  for (const row of chat.rows) {
    const verdict = row.observed;
    afterVerdicts.set(verdict, (afterVerdicts.get(verdict) ?? 0) + 1);
    if (row.budgetExhausted) {
      budgetExhaustedCount += 1;
    }
  }

  // The metric: how many questions moved from "unproven" to "yes"?
  // This is a direct way to measure whether the plan's stated capability (proving E1/E2)
  // actually materializes in the chat surface.
  const beforeYes = beforeVerdicts.get("yes") ?? 0;
  const afterYes = afterVerdicts.get("yes") ?? 0;
  const delta = afterYes - beforeYes;

  return {
    cases: cases.length,
    beforeYes,
    afterYes,
    delta,
    budgetExhaustedCount,
    beforeVerdicts: Object.fromEntries(beforeVerdicts),
    afterVerdicts: Object.fromEntries(afterVerdicts),
  };
}

async function main() {
  const {
    cases,
    beforeYes,
    afterYes,
    delta,
    budgetExhaustedCount,
    beforeVerdicts,
    afterVerdicts,
  } = await measure();

  const record = writeClaim("syllogist", {
    hardware: defaultHardware(),
    pack: "shipped",
    before: beforeYes,
    after: afterYes,
    delta,
    unit: "question shapes proved",
    marginKind: "rate", // delta should not go backwards
    sources: [
      "scripts/claims/claim-syllogist.mjs",
      "test-benchmarks/infbench/cases.jsonl",
      "test-benchmarks/infbench/envelope.json",
    ],
    detail: {
      cases,
      budgetExhausted: budgetExhaustedCount,
      beforeVerdicts,
      afterVerdicts,
    },
  });

  console.log(`claim:syllogist: ${beforeYes} → ${afterYes} (delta: +${delta} question shapes proved)`);
  console.log(`  cases: ${cases} (INF-7/INF-8)`);
  console.log(`  budget-exhausted: ${budgetExhaustedCount}`);
  console.log(`  before: ${JSON.stringify(beforeVerdicts)}`);
  console.log(`  after: ${JSON.stringify(afterVerdicts)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
