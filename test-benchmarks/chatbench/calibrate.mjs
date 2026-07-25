// chatbench/calibrate.mjs — the down-tiering calibration driver (PLAN lever 3).
//
// Two dry, model-free steps and one paid step the COORDINATOR runs:
//   --select   picks the ~50-case calibration set from the graded pool
//              (deterministic, stratified per rubric family) and writes
//              chatbench/calibration.jsonl. Model-free.
//   [paid]     the coordinator grades that set TWICE — once at frontier tier,
//              once with the small model — via chatbench/judge.mjs --only, and
//              keeps both summary.json files. This module never makes that call.
//   --gate     reads the two summaries, computes per-family agreement, applies
//              the down-tier gate (chatbench/rubrics.mjs), and writes a
//              downtier.json a later judged cycle reads to pick the model per
//              family. Model-free.
//
// Usage:
//   node chatbench/calibrate.mjs --select [--pool <pool.jsonl>] [--per-family 5]
//     [--seed <n>] [--out chatbench/calibration.jsonl]
//   node chatbench/calibrate.mjs --gate --frontier <summary.json>
//     --small <summary.json> [--threshold 0.9] [--out chatbench/downtier.json]

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseFlags } from "../benchlib/bench.mjs";
import { parseCases } from "./run.mjs";
import {
  validateRubrics, familyIndex, rowFamily,
  selectCalibrationSet, agreementByFamily, gateDownTier, renderDownTierTable,
} from "./rubrics.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_POOL = join(HERE, "graded-pool.jsonl");
const RUBRICS_FILE = join(HERE, "rubrics.json");

function parseArgs(argv) {
  return parseFlags(argv, {
    defaults: { pool: DEFAULT_POOL, perFamily: 5, seed: 20260724, threshold: 0.9 },
    flags: {
      "--select": { key: "select", flag: true },
      "--gate": { key: "gate", flag: true },
      "--pool": { key: "pool" },
      "--per-family": { key: "perFamily", value: Number },
      "--seed": { key: "seed", value: Number },
      "--threshold": { key: "threshold", value: Number },
      "--frontier": { key: "frontier" },
      "--small": { key: "small" },
      "--out": { key: "out" },
    },
  });
}

async function loadRubricIndex() {
  const rubrics = JSON.parse(await readFile(RUBRICS_FILE, "utf8"));
  const errors = validateRubrics(rubrics);
  if (errors.length) throw new Error(`rubrics.json invalid:\n  - ${errors.join("\n  - ")}`);
  return { rubrics, index: familyIndex(rubrics) };
}

const summaryById = (summary) => new Map((summary.perCase ?? []).map((c) => [c.caseId, c]));

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const { index } = await loadRubricIndex();

  if (args.select) {
    const { cases, errors } = parseCases(await readFile(args.pool, "utf8"));
    if (errors.length) { console.error(`pool lint failed (${errors.length})`); return 2; }
    const set = selectCalibrationSet(cases, index, { perFamily: args.perFamily, seed: args.seed });
    const out = args.out ?? join(HERE, "calibration.jsonl");
    const lines = set.map((c) => JSON.stringify({
      id: c.id, grade: c.grade, construction: c.construction, family: rowFamily(c, index),
    }));
    await writeFile(out, lines.join("\n") + "\n");
    console.log(`calibration set: ${set.length} case(s) across the rubric families written to ${out}.`);
    console.log("NEXT (paid, coordinator): frontier-grade and small-grade this set, then run --gate over the two summaries.");
    return 0;
  }

  if (args.gate) {
    if (!args.frontier || !args.small) {
      console.error("chatbench/calibrate.mjs --gate needs --frontier <summary.json> and --small <summary.json>.");
      return 2;
    }
    const frontier = JSON.parse(await readFile(args.frontier, "utf8"));
    const small = JSON.parse(await readFile(args.small, "utf8"));
    const calibIds = new Set((frontier.perCase ?? []).map((c) => c.caseId));
    const calibCases = [...calibIds].map((id) => ({ caseId: id, construction: (frontier.perCase.find((c) => c.caseId === id) || {}).construction }));
    // the summaries do not carry construction; re-read it from the pool
    const { cases } = parseCases(await readFile(args.pool, "utf8"));
    const consById = new Map(cases.map((c) => [c.id, c.construction]));
    for (const c of calibCases) c.construction = consById.get(c.caseId) ?? c.construction;
    const agreement = agreementByFamily(calibCases, summaryById(frontier), summaryById(small), index, {});
    const gate = gateDownTier(agreement, { threshold: args.threshold });
    const out = args.out ?? join(HERE, "downtier.json");
    await writeFile(out, JSON.stringify({ threshold: args.threshold, agreement, gate }, null, 2) + "\n");
    console.log(renderDownTierTable(gate));
    console.log(`down-tier gate written to ${out}.`);
    return 0;
  }

  console.error("chatbench/calibrate.mjs: pass --select or --gate.");
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
