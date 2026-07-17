// infbench/run.mjs — the fused generate->run->grade->write INFBENCH runner
// (sibling of agentbench/run.mjs; PLAN_INFERENCE_TESTING.md §2.1/§2.4/§4
// stage 0's "one npm run infbench chaining generate-cases.mjs then run.mjs").
//
// Replays every case in infbench/cases.jsonl through BOTH drive points:
//   - kernel: src/domain/syllogise.mjs's pure deriveSubClassClosure (no I/O) — see
//     infbench/grade.mjs's kernelVerdict.
//   - chat: the REAL runChat() in a fresh temp dir per case, scripting every
//     premise sentence as a chat turn (teaching it into memory via the SAME
//     ACE-assert lane a real session uses) followed by the query turn — the
//     thin mirror-cell PLAN_INFERENCE_TESTING.md §2.1 calls for, catching
//     wiring gaps between the kernel and the mouth.
//
// No LLM, no network — grading is entirely deterministic (infbench/grade.mjs).
//
// Determinism: chat.mjs's own session/provenance strings embed a fresh uuidv7
// + wall-clock ISO timestamp per turn (ace:chat:<uuid>@<ts>); the SAME scrub
// chatbench/run.mjs applies (VOLATILE_PROVENANCE) folds them to a stable
// placeholder before a row is recorded, so two runs over the same cases
// produce byte-identical product rows. `--replay` runs the whole pipeline
// twice and byte-compares them (the determinism check PLAN_INFERENCE_TESTING.md
// §2.1 calls for).
//
// Usage:
//   node infbench/run.mjs [--cases infbench/cases.jsonl] [--stamp <label>]
//     [--out infbench/results/raw/run-<stamp>] [--only <id,id,…>]
//     [--concurrency <n>] [--replay]

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough, Readable } from "node:stream";

import { parseCases, gradeKernelRow, gradeChatRow, rollup, ladderGate, renderRollup, ceilingCapabilities } from "./grade.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
export const DEFAULT_CASES = join(HERE, "cases.jsonl");
export const BENCH_VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

// Bounded fan-out width (mirrors agentbench's DEFAULT_CONCURRENCY): each lane
// spins up its OWN throwaway temp dir + a full runChat() session, so this is
// heavier per-item than agentbench's stateless dispatchTool — kept modest.
export const DEFAULT_CONCURRENCY = 6;

/** Run `worker(item)` over items with bounded concurrency, preserving order
 *  (results[i] by index — copied from agentbench/chatbench's pool()). */
export async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) || 1 }, lane));
  return results;
}

const VOLATILE_PROVENANCE = /ace:chat:[0-9a-f-]{36}@\d{4}-\d{2}-\d{2}T[0-9:.]+Z/gi;

function sink() {
  const out = new PassThrough();
  out.setEncoding("utf8");
  out.resume();
  return out;
}

/** Drive one case's CHAT arm: a fresh temp dir, every premise sentence
 *  scripted as a chat turn (the SAME ACE-assert lane a real session uses,
 *  chat.mjs's assertTurn — gated on memoryDir, which runChat always
 *  supplies), then the query turn. A `graph` on the case (the A2 graph-bridge
 *  variant) is materialized to .tmct/graph.json BEFORE the session starts, so
 *  the codegraph individuals/inherits edges it needs are already in place —
 *  exactly runAgentbench/chatbench's fixture-seeding discipline.
 *  Returns { answer, miss, error? } for the query turn. */
export async function driveChat(caseDef) {
  const { runChat } = await import(join(ROOT, "src", "services", "chat.mjs"));
  const { ingestSchemaDocs } = await import(join(ROOT, "src", "tools", "schema-docs.mjs"));
  const { parseSessionJsonl, parseSessionLog, turnKey } = await import(join(ROOT, "src", "services", "sessions.mjs"));

  const dir = await mkdtemp(join(tmpdir(), `tmct-infbench-${caseDef.id.replace(/[^A-Za-z0-9-]/g, "_")}-`));
  try {
    if (caseDef.graph) {
      await mkdir(join(dir, ".tmct"), { recursive: true });
      const ingested = ingestSchemaDocs({ generated_at: "", prefixes: {}, classes: [], ...caseDef.graph });
      await writeFile(join(dir, ".tmct", "graph.json"), JSON.stringify(ingested));
    }
    const lines = [...caseDef.premises, caseDef.query, "/exit"].map((l) => `${l}\n`);
    const { logFile, sidecarFile } = await runChat({
      repoPath: dir, input: Readable.from(lines), output: sink(), env: { NO_COLOR: "1" },
    });
    const rec = parseSessionJsonl(await readFile(sidecarFile, "utf8"));
    const answers = parseSessionLog(await readFile(logFile, "utf8"));
    const turns = rec?.turns ?? [];
    const queryIdx = caseDef.premises.length; // the query turn is right after every premise turn
    const record = turns[queryIdx];
    if (!record || record.query !== caseDef.query) {
      return { answer: "", miss: null, error: `query turn not recorded (got ${turns.length} turn(s))` };
    }
    const raw = answers.get(turnKey(record.ts, record.query)) ?? "";
    const answer = raw.replaceAll(dir, "<repo>").replace(VOLATILE_PROVENANCE, "ace:chat:<session>@<ts>");
    return { answer, miss: record.miss };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Run one case through both drive points -> 1 or 2 graded rows (kernel row
 *  only when caseDef.arms declares "kernel"; chat row always). */
export async function runCase(caseDef) {
  const rows = [];
  const kernel = gradeKernelRow(caseDef);
  if (kernel) {
    rows.push({
      caseId: caseDef.id, band: caseDef.band, template: caseDef.template, variant: caseDef.variant,
      arm: "kernel", checkType: caseDef.checkType, expect: caseDef.expect,
      ...(caseDef.ceiling ? { ceiling: caseDef.ceiling } : {}), ...kernel,
    });
  }
  const outcome = await driveChat(caseDef);
  const chat = gradeChatRow(caseDef, outcome);
  rows.push({
    caseId: caseDef.id, band: caseDef.band, template: caseDef.template, variant: caseDef.variant,
    arm: "chat", checkType: caseDef.checkType, expect: caseDef.expect,
    ...(caseDef.ceiling ? { ceiling: caseDef.ceiling } : {}), ...chat,
    answer: outcome.answer, miss: outcome.miss, ...(outcome.error ? { error: outcome.error } : {}),
  });
  return rows;
}

/** Programmatic entry (unit-testable): grade a set of cases across both
 *  drive points. Returns { rows, kernel: {rows,rolled,ladder}, chat: {…} }.
 *  Cases fan out through pool() at `concurrency` lanes, rows written BY INDEX
 *  (case order — byte-identical to the sequential loop). */
export async function runInfbench(cases, { concurrency = DEFAULT_CONCURRENCY } = {}) {
  const grouped = await pool(cases, concurrency, (c) => runCase(c));
  const rows = grouped.flat();
  const kernelRows = rows.filter((r) => r.arm === "kernel");
  const chatRows = rows.filter((r) => r.arm === "chat");
  const kernelRolled = rollup(kernelRows);
  const chatRolled = rollup(chatRows);
  return {
    rows,
    kernel: { rows: kernelRows, rolled: kernelRolled, ladder: ladderGate(kernelRolled) },
    chat: { rows: chatRows, rolled: chatRolled, ladder: ladderGate(chatRolled) },
  };
}

function parseArgs(argv) {
  const args = { cases: DEFAULT_CASES, stamp: BENCH_VERSION, concurrency: DEFAULT_CONCURRENCY };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--stamp") args.stamp = argv[++i];
    else if (a === "--cases") args.cases = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--concurrency") args.concurrency = Number(argv[++i]);
    else if (a === "--only") args.only = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--replay") args.replay = true;
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

function printArm(label, arm) {
  console.log(`\n${label} arm:`);
  console.log(renderRollup(arm.rolled, label));
  console.log(`  ladder: ${arm.ladder.order.join(" -> ")}${arm.ladder.gatedAt ? `  — gated at ${arm.ladder.gatedAt}` : "  — all bands pass the gate"}`);
  for (const r of arm.ladder.receipts) console.log(`    band ${r.band} skipped: ${r.reason}`);
  const ceilings = ceilingCapabilities(arm.rows);
  if (Object.keys(ceilings).length) {
    console.log("  ceiling/pass = passes whose expected verdict is the engine's declared floor, not the classical answer.");
    console.log("  Those rows measure the floor holding; the capability that would lift each one:");
    for (const [band, capabilities] of Object.entries(ceilings)) {
      const cell = arm.rolled.byBand[band];
      console.log(`    ${band}: ${cell.ceilingGradedPassed} of ${cell.passed} passes — lifts with ${capabilities.join("; ")}`);
    }
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!/^[A-Za-z0-9._-]+$/.test(args.stamp)) {
    console.error("infbench/run.mjs: --stamp must be a filesystem-safe label (ids never come from Date.now).");
    return 2;
  }
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) {
    console.error("--concurrency must be a positive integer");
    return 2;
  }

  let casesText;
  try { casesText = await readFile(args.cases, "utf8"); }
  catch { console.error(`infbench/run.mjs: cases file not found: ${args.cases} — run 'node infbench/generate-cases.mjs' first`); return 2; }

  const { cases, errors } = parseCases(casesText);
  if (errors.length) {
    console.error(`cases lint failed (${errors.length}):`);
    for (const e of errors) console.error(`  - ${e}`);
    return 2;
  }

  let selected = cases;
  if (args.only) {
    const known = new Set(cases.map((c) => c.id));
    const unknown = args.only.filter((id) => !known.has(id));
    if (unknown.length) { console.error(`--only names unknown case ids: ${unknown.join(", ")}`); return 2; }
    selected = selected.filter((c) => args.only.includes(c.id));
  }
  if (!selected.length) { console.error("no cases selected."); return 2; }

  let result;
  if (args.replay) {
    const a = await runInfbench(selected, { concurrency: args.concurrency });
    const b = await runInfbench(selected, { concurrency: args.concurrency });
    if (JSON.stringify(a.rows) !== JSON.stringify(b.rows)) {
      console.error("infbench/run.mjs --replay: rows are NOT byte-identical across 2 runs — determinism check FAILED");
      return 1;
    }
    console.log("infbench/run.mjs --replay: byte-identical across 2 runs — determinism check PASSED");
    result = a;
  } else {
    result = await runInfbench(selected, { concurrency: args.concurrency });
  }

  const outDir = args.out ?? join(HERE, "results", "raw", `run-${args.stamp}`);
  await mkdir(outDir, { recursive: true });
  const productFile = join(outDir, "product.jsonl");
  await writeFile(productFile, `${result.rows.map((r) => JSON.stringify(r)).join("\n")}\n`);

  console.log(`\ninfbench run ${args.stamp} (version ${BENCH_VERSION}) — ${selected.length} case(s), 2 drive points (kernel + chat)`);
  console.log("gate = 0% fabrication AT >= 50% completion; first band failing the gate gates every band above it.");
  printArm("kernel", result.kernel);
  printArm("chat", result.chat);

  const fails = result.rows.filter((r) => !r.pass);
  if (fails.length) {
    console.log(`\nnon-passing rows (${fails.length}):`);
    for (const r of fails) console.log(`  ${r.fabricated ? "FABRIC" : "FAIL  "} ${r.caseId} [${r.band}/${r.arm}]: expected ${JSON.stringify(r.expect.verdict ?? r.expect.mentions)}, observed ${r.observed}`);
  }

  console.log(`\nproduct: ${productFile}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
