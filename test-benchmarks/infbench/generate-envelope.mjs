// infbench/generate-envelope.mjs — generates infbench/envelope.json, INFBENCH's
// sibling of agentbench/envelope.json: a small, stable, MACHINE-READABLE summary
// of what the latest run actually PROVES tmct's classical-logic competence
// covers, so scripts/agi-scales-aggregate.mjs (and any other downstream reader)
// has a real artifact to check itself against instead of re-deriving the number
// from a results directory.
//
// Deterministic like agentbench's generator: no Date.now anywhere in the
// output, and no tmct version embedded in it either — a reader who needs
// that reads package.json directly, so this file never goes stale just
// because the version bumped with nothing about infbench's own behavior
// actually changing. `stamp` defaults to BENCH_VERSION (package.json's
// version, read once at load — see run.mjs) but is just a run label, not a
// drift-checked claim; two runs over the same tree still produce a
// byte-identical file for a given stamp.
//
// TWO ARMS, both reported: INFBENCH drives every case through a `kernel` arm
// (src/domain/syllogise.mjs's pure provers, blind to chat.mjs) and a `chat` arm
// (a real runChat transcript) — see infbench/grade.mjs's file header and
// infbench/run.mjs's runInfbench, whose return shape is `{rows, kernel, chat}`.
// The two arms measure different things (a kernel pass proves the prover is
// correct over premises it was handed directly; a chat pass proves the whole
// mouth-to-kernel wire is intact), so this envelope keeps them apart under
// `capability.kernel`/`capability.chat` rather than collapsing to one number —
// a reader should always know which arm a figure came from.
//
// What this does NOT do: report a `maxContextTokens`-shaped field at all, not
// even as an honest `null`. AGENTBENCH's envelope keeps that field (measured:
// false) because bedrock-meter's calibration expects the key to exist even
// when unmeasured. Nothing analogous exists for INFBENCH to measure or for any
// downstream reader to expect, so the field is omitted outright rather than
// manufacturing a placeholder for a dimension INFBENCH could never report.
//
// Usage: node infbench/generate-envelope.mjs [--out infbench/envelope.json]
//   [--cases infbench/cases.jsonl] [--stamp <label>] [--concurrency <n>]

import { writeFile, mkdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { BANDS, parseCases, ceilingCapabilities } from "./grade.mjs";
import { runInfbench, BENCH_VERSION, DEFAULT_CASES, DEFAULT_CONCURRENCY } from "./run.mjs";
import { parseFlags } from "../benchlib/bench.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_OUT = join(HERE, "envelope.json");

// The schema is intentionally small and stable — additive-only going forward.
export const SCHEMA_VERSION = 1;

/** The highest band with an UNBROKEN gate-PASS chain from INF-1 (mirrors
 *  agentbench/generate-envelope.mjs's highestGatePassRung, recomputed directly
 *  off rolled.byBand rather than a string parse of ladder.gatedAt). Returns
 *  null if even INF-1 fails the gate (or INF-1 has no rows at all). */
export function highestGatePassBand(rolled) {
  let reached = null;
  for (const band of BANDS) {
    const cell = rolled.byBand[band];
    if (!cell) continue;
    if (!cell.gatePass) break;
    reached = band;
  }
  return reached;
}

/** Build one arm's slice of the envelope (pure over that arm's own
 *  {rows, rolled, ladder}, as produced by runInfbench). */
function buildArm(arm) {
  const bandReached = highestGatePassBand(arm.rolled);
  const byBand = {};
  for (const band of BANDS) {
    const cell = arm.rolled.byBand[band];
    if (cell) {
      byBand[band] = {
        n: cell.total,
        completion: cell.completion,
        fabricationRate: cell.fabricationRate,
        gatePass: cell.gatePass,
        // A ceiling-graded row's expected verdict is the engine's declared
        // floor ("unproven"), not the classical answer — see grade.mjs's
        // tallyOne comment. Reported so a 100% band made entirely of
        // ceiling-graded passes doesn't read as full capability.
        ceilingGraded: cell.ceilingGraded,
        ceilingGradedPassed: cell.ceilingGradedPassed,
      };
    }
  }
  return {
    ladder: { bandReached, gatedAt: arm.ladder.gatedAt },
    // fabricationZero mirrors agentbench's toolsOk/structuredOk booleans: the
    // honest-gate signal (0% fabrication) at the overall level, before any
    // completion-floor consideration.
    fabricationZero: arm.rolled.overall.fabricationRate === 0,
    gatePass: arm.rolled.overall.gatePass,
    metrics: {
      overall: {
        n: arm.rolled.overall.total,
        completion: arm.rolled.overall.completion,
        fabricationRate: arm.rolled.overall.fabricationRate,
        gatePass: arm.rolled.overall.gatePass,
      },
      byBand,
    },
    ceilingCapabilities: ceilingCapabilities(arm.rows),
  };
}

/** Build the envelope object (pure over a completed INFBENCH run — no I/O). */
export function buildEnvelope({ result, stamp, cases }) {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedFrom: {
      stamp,
      caseCount: cases.length,
    },
    bands: BANDS,
    capability: {
      kernel: buildArm(result.kernel),
      chat: buildArm(result.chat),
    },
    notes: [
      "Two arms, always reported separately: kernel (src/domain/syllogise.mjs's pure provers over a case's own premises, blind to chat.mjs) and chat (a real runChat transcript, driven through the same ACE-assert lane a session uses) — see infbench/grade.mjs's file header. A number under capability.kernel says nothing about the mouth-to-kernel wire; a number under capability.chat says nothing about the prover in isolation. Never average them.",
      "bandReached is the highest INF-1..INF-8 band with an unbroken gate-PASS chain from INF-1 (0% fabrication AT >= 50% completion, infbench/grade.mjs COMPLETION_FLOOR) for that arm — see infbench/grade.mjs's ladderGate()/tallyOne() and this file's highestGatePassBand().",
      "ceilingGraded/ceilingGradedPassed count rows whose expected verdict is the engine's declared honest floor ('unproven'), not the classical answer — a band's pass rate can look higher than its actual capability if these aren't read alongside it. See infbench/grade.mjs's tallyOne()/ceilingCapabilities().",
      "There is no maxContextTokens-shaped field here at all (not even a null placeholder): INFBENCH has no tokenizer and does no token accounting anywhere in run.mjs/grade.mjs, so there is nothing analogous for it to measure or omit-honestly.",
      "Regenerate with `node infbench/generate-envelope.mjs` after any INFBENCH-affecting change; the output is deterministic (no Date.now) so a clean re-run over an unchanged tree is byte-identical.",
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
    console.error("infbench/generate-envelope.mjs: --stamp must be a filesystem-safe label (ids never come from Date.now).");
    return 2;
  }

  const { cases, errors } = parseCases(await readFile(args.cases, "utf8"));
  if (errors.length) {
    console.error(`cases lint failed (${errors.length}):`);
    for (const e of errors) console.error(`  - ${e}`);
    return 2;
  }

  const result = await runInfbench(cases, { concurrency: args.concurrency });
  const envelope = buildEnvelope({ result, stamp: args.stamp, cases });

  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify(envelope, null, 2) + "\n");

  console.log(`infbench envelope written: ${args.out} (tmct ${BENCH_VERSION})`);
  console.log(`  kernel.bandReached=${envelope.capability.kernel.ladder.bandReached} ` +
    `chat.bandReached=${envelope.capability.chat.ladder.bandReached}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
