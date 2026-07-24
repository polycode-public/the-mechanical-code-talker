// ingestbench/run.mjs — the DETERMINISTIC INGESTBENCH runner (sibling of
// infbench/run.mjs and agentbench/run.mjs). Replays every case in
// ingestbench/cases.jsonl through the SHIPPED ingest seam — ingestText
// (src/services/extract-facts.mjs) — reads back the stored triples, folds them
// to canonical form, and grades fidelity on the ING-0..ING-9 ladder. No LLM, no
// network for the deterministic rungs (ING-0..ING-7); the judged rungs
// (ING-8/ING-9) get a judge product row, scored by ingestbench/judge.mjs.
//
// Determinism: ingestText is deterministic and its returned triples carry no
// wall-clock/uuid, so two runs over the same cases + version produce
// byte-identical product rows. `--replay` runs the whole pipeline twice and
// byte-compares (the determinism check the sibling benches also carry).
//
// The bench imports DOWNWARD from src/ only; src/ never imports from here
// (`grep -r ingestbench src/` must stay empty — SKILL §1).
//
// Usage:
//   node ingestbench/run.mjs --ladder --stamp <version>
//   node ingestbench/run.mjs [--cases <file>] [--stamp <label>] [--out <dir>]
//     [--rung <ING-0|…|ING-9>] [--ladder] [--only <id,id,…>]
//     [--concurrency <n>] [--replay] [--judge-dry-run]

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseCases, gradeDeterministicCase, pendingJudgeRow, restateDocument,
  rollup, ladderGate, renderRollup, ceilingCapabilities, RUNGS,
} from "./grade.mjs";
import { pool, parseFlags } from "../benchlib/bench.mjs";
export { pool };

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
export const DEFAULT_CASES = join(HERE, "cases.jsonl");
export const BENCH_VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
// ingestText spins up its own ephemeral scratch memory dir per call and does a
// bounded wink parse — modest per-item, so keep the fan-out narrow.
export const DEFAULT_CONCURRENCY = 6;

/** Run one case's ingest arm: ground `input` through the SHIPPED ingestText seam
 *  (optimistic tier ON, so the fuzzy extraction rules the ladder measures —
 *  compound-modifier spans, partitive discipline, cross-clause reads — are
 *  exercised), collect the stored triples ([...strict, ...optimistic], deduped),
 *  and grade. Judged cases get a restatement + a judge-pending row instead. */
export async function runCase(caseDef) {
  const { ingestText } = await import(join(ROOT, "src", "services", "extract-facts.mjs"));
  const result = await ingestText(caseDef.input, { optimistic: true });
  const seen = new Set();
  const stored = [];
  for (const f of [...result.extracted, ...result.optimistic]) {
    const key = `${f.subject}\0${f.predicate}\0${f.object}`;
    if (seen.has(key)) continue;
    seen.add(key);
    stored.push({ subject: f.subject, predicate: f.predicate, object: f.object });
  }
  if (caseDef.grade === "judged") {
    return pendingJudgeRow(caseDef, stored, restateDocument(stored));
  }
  return gradeDeterministicCase(caseDef, stored);
}

/** Programmatic entry (unit-testable): grade a set of cases. Cases fan out
 *  through pool() at `concurrency` lanes, rows written BY INDEX (case order —
 *  byte-identical to a sequential loop). Returns { rows, rolled, ladder }. */
export async function runIngestbench(cases, { concurrency = DEFAULT_CONCURRENCY, ladder = false } = {}) {
  const rows = await pool(cases, concurrency, (c) => runCase(c));
  const rolled = rollup(rows);
  return { rows, rolled, ladder: ladder ? ladderGate(rolled) : null };
}

function parseArgs(argv) {
  return parseFlags(argv, {
    defaults: { cases: DEFAULT_CASES, stamp: BENCH_VERSION, concurrency: DEFAULT_CONCURRENCY },
    flags: {
      "--stamp": { key: "stamp" },
      "--cases": { key: "cases" },
      "--out": { key: "out" },
      "--rung": { key: "rung", value: (v) => v.toUpperCase() },
      "--ladder": { key: "ladder", flag: true },
      "--only": { key: "only", value: (v) => v.split(",").map((s) => s.trim()).filter(Boolean) },
      "--concurrency": { key: "concurrency", value: Number },
      "--replay": { key: "replay", flag: true },
      "--judge-dry-run": { key: "judgeDryRun", flag: true },
    },
  });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!/^[A-Za-z0-9._-]+$/.test(args.stamp)) {
    console.error("ingestbench/run.mjs: --stamp must be a filesystem-safe label (ids never come from Date.now).");
    return 2;
  }
  if (args.rung && !RUNGS.includes(args.rung)) {
    console.error(`--rung must be one of ${RUNGS.join("|")}`);
    return 2;
  }
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) {
    console.error("--concurrency must be a positive integer");
    return 2;
  }

  let casesText;
  try { casesText = await readFile(args.cases, "utf8"); }
  catch { console.error(`ingestbench/run.mjs: cases file not found: ${args.cases}`); return 2; }

  const { cases, errors } = parseCases(casesText);
  if (errors.length) {
    console.error(`cases lint failed (${errors.length}):`);
    for (const e of errors) console.error(`  - ${e}`);
    return 2;
  }

  let selected = cases;
  if (args.rung) selected = selected.filter((c) => c.rung === args.rung);
  if (args.only) {
    const known = new Set(cases.map((c) => c.id));
    const unknown = args.only.filter((id) => !known.has(id));
    if (unknown.length) { console.error(`--only names unknown case ids: ${unknown.join(", ")}`); return 2; }
    selected = selected.filter((c) => args.only.includes(c.id));
  }
  if (!selected.length) { console.error("no cases selected."); return 2; }

  let result;
  if (args.replay) {
    const a = await runIngestbench(selected, { concurrency: args.concurrency, ladder: args.ladder });
    const b = await runIngestbench(selected, { concurrency: args.concurrency, ladder: args.ladder });
    if (JSON.stringify(a.rows) !== JSON.stringify(b.rows)) {
      console.error("ingestbench/run.mjs --replay: rows are NOT byte-identical across 2 runs — determinism check FAILED");
      return 1;
    }
    console.log("ingestbench/run.mjs --replay: byte-identical across 2 runs — determinism check PASSED");
    result = a;
  } else {
    result = await runIngestbench(selected, { concurrency: args.concurrency, ladder: args.ladder });
  }

  const outDir = args.out ?? join(HERE, "results", "raw", `run-${args.stamp}`);
  await mkdir(outDir, { recursive: true });
  const productFile = join(outDir, "product.jsonl");
  await writeFile(productFile, `${result.rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
  // The judge's input: one row per judged case (input + deterministic
  // restatement), consumed by ingestbench/judge.mjs (ING-8/ING-9).
  const judgeRows = selected
    .filter((c) => c.grade === "judged")
    .map((c) => {
      const row = result.rows.find((r) => r.caseId === c.id);
      return { caseId: c.id, rung: c.rung, tags: c.tags, input: c.input, restatement: row?.restatement ?? "", ...(c.ceiling ? { ceiling: c.ceiling } : {}) };
    });
  const judgeInputFile = join(outDir, "judge-input.jsonl");
  if (judgeRows.length) await writeFile(judgeInputFile, `${judgeRows.map((r) => JSON.stringify(r)).join("\n")}\n`);

  console.log(`\ningestbench run ${args.stamp} (version ${BENCH_VERSION}) — ${selected.length} case(s)`);
  console.log("gate = 0 wrong facts AT >= 50% recall of the rung's expected statements; first rung failing gates every rung above it.");
  console.log(renderRollup(result.rolled));

  const ceilings = ceilingCapabilities(result.rows);
  if (Object.keys(ceilings).length) {
    console.log("\nceiling/pass = passes graded against a declared horizon, not a shipped capability. The capability that would lift each rung:");
    for (const [rung, caps] of Object.entries(ceilings)) console.log(`  ${rung}: ${caps.join("; ")}`);
  }

  const wrong = result.rows.filter((r) => r.wrongCount > 0);
  if (wrong.length) {
    console.log(`\nWRONG FACTS (${wrong.length} case(s) — the automatic-fail line):`);
    for (const r of wrong) {
      for (const w of r.wrong) console.log(`  ${w.class.toUpperCase()} ${r.caseId} [${r.rung}]: ${w.triple.subject} ${w.triple.predicate} ${w.triple.object}`);
    }
  }
  const shortfall = result.rows.filter((r) => !r.judgePending && !r.pass && r.wrongCount === 0);
  if (shortfall.length) {
    console.log(`\nrecall short of the floor (${shortfall.length} — the honest-miss side, never worse than a wrong fact):`);
    for (const r of shortfall) console.log(`  MISS ${r.caseId} [${r.rung}]: recall ${(r.recall * 100).toFixed(0)}%, ${r.missed.length} missed-useful`);
  }

  if (result.ladder) {
    console.log("\nladder (rungs ascend; first un-gated rung failing the gate gates the rest):");
    console.log(`  order: ${result.ladder.order.join(" -> ")}${result.ladder.gatedAt ? `  — gated at ${result.ladder.gatedAt}` : "  — all rungs pass the gate"}`);
    for (const rcpt of result.ladder.receipts) console.log(`  rung ${rcpt.rung} skipped: ${rcpt.reason}`);
  }

  if (judgeRows.length) {
    console.log(`\n${judgeRows.length} judged case(s) written to ${judgeInputFile} — score with: node ingestbench/judge.mjs --product ${judgeInputFile}`);
    if (args.judgeDryRun) {
      const { main: judgeMain } = await import("./judge.mjs");
      console.log("\n--judge-dry-run: emitting judge prompts (NO judge calls):");
      await judgeMain(["--product", judgeInputFile, "--dry-run", "--out", outDir]);
    }
  }

  console.log(`\nproduct: ${productFile}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
