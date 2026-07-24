// agentbench/generate-envelope.mjs — generates agentbench/envelope.json, the
// MACHINE-READABLE capability envelope: a small, stable summary of what the latest gate-PASS AGENTBENCH
// run actually PROVES tmct can be trusted for, so a downstream calibration (e.g.
// bedrock-meter's hand-set `TMCT_ENVELOPE` in router-ladder.mjs) has a real
// artifact to check itself against instead of drifting from tmct's measured
// capability every release.
//
// Deterministic like the rest of agentbench: no Date.now anywhere in the
// output. The stamp is BENCH_VERSION (package.json's version, read once at
// load — see run.mjs), so two runs over the same tree produce a byte-identical
// file, and a version bump auto-flows into the next generated envelope.
//
// What this does NOT do: fabricate a `maxContextTokens` number. AGENTBENCH is a
// deterministic call-plan/composition grader — it has no tokenizer and does no
// token accounting anywhere in run.mjs/grade.mjs, so there is nothing measured
// to report. Mirroring bedrock-meter's own hand-set 8000/16000 figures back into
// this file would silently launder a guess as a "measurement" — exactly the
// drift this envelope exists to prevent. The field is present (for schema
// stability / forward compat) but explicit: `measured:false`, value `null`.
//
// Usage: node agentbench/generate-envelope.mjs [--out agentbench/envelope.json]
//   [--cases agentbench/cases.jsonl] [--stamp <label>] [--concurrency <n>]

import { writeFile, mkdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { RUNGS, parseCases, rollup, ladderGate } from "./grade.mjs";
import { goalDriver } from "./driver-goal.mjs";
import { runAgentbench, BENCH_VERSION, DEFAULT_CASES, DEFAULT_CONCURRENCY, loadFixtureLabels } from "./run.mjs";
import { parseFlags } from "../benchlib/bench.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
export const DEFAULT_OUT = join(HERE, "envelope.json");

// The schema is intentionally small and stable — additive-only going forward.
export const SCHEMA_VERSION = 1;

/** Hallucination REASON taxonomy (src/domain/router/call-validator.mjs) split into the
 *  two capability axes bedrock-meter's TMCT_ENVELOPE names:
 *    - "undeclared"/"unknown-tool"  -> a TOOLS-boundary violation (toolsOk)
 *    - "unknown-arg"/"missing-arg"  -> a SCHEMA/shape violation (structuredOk)
 *  A rung with zero rows in either bucket keeps the corresponding flag true. */
const TOOLS_BOUNDARY_REASONS = new Set(["undeclared", "unknown-tool"]);
const SCHEMA_SHAPE_REASONS = new Set(["unknown-arg", "missing-arg"]);

function reasonsOf(rows) {
  const reasons = new Set();
  for (const r of rows) {
    for (const h of r.verdict.hallucinated) {
      for (const p of h.problems) reasons.add(p.reason);
    }
  }
  return reasons;
}

/** The highest rung with an UNBROKEN gate-PASS chain from TOOL-0 (mirrors
 *  ladderGate's "first ungated rung gates the rest" — recomputed directly off
 *  rolled.byRung so this stays a pure function of the rollup, not a string
 *  parse of ladder.gatedAt). Returns null if even TOOL-0 fails the gate (or
 *  TOOL-0 has no rows at all). */
export function highestGatePassRung(rolled) {
  let reached = null;
  for (const rung of RUNGS) {
    const cell = rolled.byRung[rung];
    if (!cell) continue;
    if (!cell.gatePass) break;
    reached = rung;
  }
  return reached;
}

/** Build the envelope object (pure over a completed AGENTBENCH run — no I/O). */
export function buildEnvelope({ rows, rolled, ladder, stamp, cases }) {
  const drivers = [...new Set(rows.map((r) => r.driver))].sort();
  const seenReasons = reasonsOf(rows);
  const toolsOk = ![...seenReasons].some((r) => TOOLS_BOUNDARY_REASONS.has(r));
  const structuredOk = ![...seenReasons].some((r) => SCHEMA_SHAPE_REASONS.has(r));
  const rungReached = highestGatePassRung(rolled);

  const byRung = {};
  for (const rung of RUNGS) {
    const cell = rolled.byRung[rung];
    if (cell) {
      byRung[rung] = {
        n: cell.total,
        planCompletion: cell.completion,
        resultCompletion: cell.resultCompletion,
        hallucinationRate: cell.hallucinationRate,
        gatePass: cell.gatePass,
      };
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedFrom: {
      agentbenchVersion: BENCH_VERSION,
      drivers,
      stamp,
      caseCount: cases.length,
    },
    ladder: {
      rungs: RUNGS,
      rungReached,
      gatedAt: ladder.gatedAt,
    },
    capability: {
      // NOT measured anywhere in AGENTBENCH (no tokenizer, no token accounting
      // in run.mjs/grade.mjs) — left honestly null rather than mirroring a
      // downstream consumer's hand-set number. See the file header.
      maxContextTokens: null,
      maxContextTokensMeasured: false,
      structuredOk,
      toolsOk,
    },
    metrics: {
      overall: {
        planCompletion: rolled.overall.completion,
        resultCompletion: rolled.overall.resultCompletion,
        hallucinationRate: rolled.overall.hallucinationRate,
        gatePass: rolled.overall.gatePass,
      },
      byRung,
    },
    notes: [
      "rungReached is the highest TOOL-0..TOOL-8 rung with an unbroken gate-PASS chain from TOOL-0 (0% hallucination AT >=50% completion, agentbench/grade.mjs COMPLETION_FLOOR) — see agentbench/grade.mjs ladderGate()/highestGatePassRung().",
      "toolsOk is false iff any produced call across the run named an undeclared or unknown-registry tool (the 'declared tools only, refuse otherwise' invariant). structuredOk is false iff any produced call had an unknown or missing argument against its declared schema. Both derive from src/domain/router/call-validator.mjs's hallucination taxonomy, not a hand-set guess.",
      "maxContextTokens is not measured by AGENTBENCH today; it is intentionally left null rather than copying a downstream calibration's hand-set figure (that copy is exactly the drift this envelope exists to prevent).",
      "Regenerate with `node agentbench/generate-envelope.mjs` after any AGENTBENCH-affecting change; the output is deterministic (no Date.now) so a clean re-run over an unchanged tree is byte-identical.",
    ],
  };
}

function parseArgs(argv) {
  return parseFlags(argv, {
    defaults: { out: DEFAULT_OUT, cases: DEFAULT_CASES, stamp: BENCH_VERSION, concurrency: DEFAULT_CONCURRENCY },
    flags: {
      "--out": { key: "out", value: resolve },
      "--cases": { key: "cases" },
      "--stamp": { key: "stamp" },
      "--concurrency": { key: "concurrency", value: Number },
    },
  });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!/^[A-Za-z0-9._-]+$/.test(args.stamp)) {
    console.error("agentbench/generate-envelope.mjs: --stamp must be a filesystem-safe label (ids never come from Date.now).");
    return 2;
  }

  const knownLabels = await loadFixtureLabels();
  const { cases, errors } = parseCases(await readFile(args.cases, "utf8"), { knownLabels });
  if (errors.length) {
    console.error(`cases lint failed (${errors.length}):`);
    for (const e of errors) console.error(`  - ${e}`);
    return 2;
  }

  // The goal driver (Stage 5) is the real anchor — C1 first, escalated to the
  // closed-world C2 goal-reasoner on a C1 refusal — NOT a floor driver, so this
  // is the envelope's honest ceiling (see run.mjs's FLOOR_CAVEAT).
  const { rows, rolled, ladder } = await runAgentbench(cases, {
    driver: goalDriver,
    stamp: args.stamp,
    ladder: true,
    concurrency: args.concurrency,
  });

  const envelope = buildEnvelope({ rows, rolled, ladder, stamp: args.stamp, cases });

  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify(envelope, null, 2) + "\n");

  console.log(`agentbench envelope written: ${args.out}`);
  console.log(`  agentbenchVersion=${envelope.generatedFrom.agentbenchVersion} rungReached=${envelope.ladder.rungReached} ` +
    `structuredOk=${envelope.capability.structuredOk} toolsOk=${envelope.capability.toolsOk} ` +
    `maxContextTokens=${envelope.capability.maxContextTokens}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
