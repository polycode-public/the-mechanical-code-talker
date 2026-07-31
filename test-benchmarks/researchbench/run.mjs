// researchbench/run.mjs — the RESEARCHBENCH runner (SKILL_BENCHMARK_RESEARCH.md).
//
// Replays each case's `research <seed>` + `research next` walk through the
// REAL lane (src/services/research.mjs's researchTurn/researchSnapshot),
// stubbing every fetch through the lane's own provider seam
// (registerResearchProvider, src/adapters/corpus/wikipedia-live.mjs) against a
// frozen stub wiki graph (researchbench/fixture/graph.json) — no live wiki, no
// LLM, no judge, no network anywhere in this loop.
//
// Grades the TRAVERSAL only (ordering, hub-avoidance, recall@budget) —
// per-article fact fidelity is SKILL_BENCHMARK_INGEST.md's job, so `ingest`
// here is a deliberate no-op stub, never a real memory write.
//
// Usage:
//   node researchbench/run.mjs --ladder --stamp <version>
//   node researchbench/run.mjs --rung RES-3
//   node researchbench/run.mjs --only res-volcano-queue

import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { researchTurn, researchSnapshot, RESEARCH_DEFAULTS } from "../../src/services/research.mjs";
import { registerResearchProvider, getResearchProvider } from "../../src/adapters/corpus/wikipedia-live.mjs";
import { setDefaultNlpAdapter } from "../../src/domain/interpret/nlp-registry.mjs";
import { nlpAdapter } from "../../src/adapters/ask-nlp.mjs";
import { loadGraph, createFixtureResearchProvider } from "./fixture/provider.mjs";
import { parseCases, gradeWalk, rollup, ladderGate, renderRollup, RUNGS } from "./grade.mjs";
import { parseFlags } from "../benchlib/bench.mjs";

// The same process-default lemma/POS adapter chat.mjs/server.mjs/services/index.mjs
// register at load time — the lane's relevanceOrder tiering only has a POS signal
// to work with when this is wired up, exactly as it is in every real run.
setDefaultNlpAdapter(nlpAdapter);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(dirname(HERE));
export const DEFAULT_CASES = join(HERE, "cases.jsonl");
export const BENCH_VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

function buildStartLine(caseDef) {
  let line = `research ${caseDef.seed}`;
  if (caseDef.k != null) line += ` depth ${caseDef.k}`;
  if (caseDef.fanoutLimit != null) line += ` limit ${caseDef.fanoutLimit}`;
  return line;
}

/** Drive one case's walk through the REAL lane against the fixture provider,
 *  registered through the lane's own seam for the duration of this case (then
 *  restored) — the same seam test-e2e/pages-ledger-research.test.mjs stubs.
 *  Returns {afterStart, final}, both researchSnapshot() shapes: `afterStart`
 *  is the queue right after the depth-0 fetch (RES-1's "queued in document
 *  order" check), `final` is the snapshot after driving the case's `budget`
 *  worth of "research next" steps. */
async function driveCase(caseDef, graph) {
  registerResearchProvider(createFixtureResearchProvider(graph));
  try {
    const holder = { state: null };
    const ctx = {
      holder, memoryDir: "researchbench-ephemeral", lexicon: null,
      provider: getResearchProvider(),
      config: RESEARCH_DEFAULTS, planActive: false, pagerActive: false, notify: null,
      // Traversal-only: never scores fact fidelity, so ingest is a pure
      // no-op — no memory store is ever touched by a graded run.
      ingest: async () => 0,
    };
    await researchTurn(buildStartLine(caseDef), ctx);
    const afterStart = researchSnapshot(holder.state) ?? { pending: [], done: [], skipped: [] };
    const budget = caseDef.budget || 0;
    for (let i = 0; i < budget; i += 1) {
      if (!holder.state || !holder.state.pending.length) break;
      await researchTurn("research next", ctx);
    }
    const final = researchSnapshot(holder.state) ?? afterStart;
    return { afterStart, final };
  } finally {
    registerResearchProvider(null);
  }
}

// RES-7 (need-directed research) and RES-8 (self-assessed coverage) are named
// research horizons (SKILL_BENCHMARK_RESEARCH.md §3): no lane capability
// answers them yet, so these never reach the lane at all — a ceiling marker,
// not a floor-miss, exactly as the skill doc's own rung table frames them.
function isCeilingRung(rung) {
  return rung === "RES-7" || rung === "RES-8";
}

async function runCase(caseDef, graph) {
  if (isCeilingRung(caseDef.rung)) {
    return { id: caseDef.id, rung: caseDef.rung, seed: caseDef.seed, measured: false, ceiling: true };
  }
  const { afterStart, final } = await driveCase(caseDef, graph);
  const graded = gradeWalk(caseDef, { afterStart, final, graph });
  return { id: caseDef.id, rung: caseDef.rung, seed: caseDef.seed, ...graded };
}

export async function runResearchbench(cases, graph = loadGraph()) {
  const rows = [];
  for (const c of cases) rows.push(await runCase(c, graph));
  return { rows, rolled: rollup(rows), ladder: ladderGate(rollup(rows)) };
}

// ---- CLI --------------------------------------------------------------------

function parseArgs(argv) {
  return parseFlags(argv, {
    defaults: { cases: DEFAULT_CASES, stamp: BENCH_VERSION },
    flags: {
      "--stamp": { key: "stamp" },
      "--cases": { key: "cases" },
      "--out": { key: "out" },
      "--rung": { key: "rung" },
      "--only": { key: "only", value: (v) => v.split(",").map((s) => s.trim()).filter(Boolean) },
      "--ladder": { key: "ladder", flag: true },
    },
  });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!/^[A-Za-z0-9._-]+$/.test(args.stamp)) {
    console.error("researchbench/run.mjs: --stamp must be a filesystem-safe label.");
    return 2;
  }
  if (args.rung && !RUNGS.includes(args.rung)) {
    console.error(`researchbench/run.mjs: --rung must be one of ${RUNGS.join("|")}`);
    return 2;
  }

  let casesText;
  try { casesText = await readFile(args.cases, "utf8"); }
  catch { console.error(`researchbench/run.mjs: cases file not found: ${args.cases}`); return 2; }

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

  const graph = loadGraph();
  const result = await runResearchbench(selected, graph);

  const outDir = args.out ?? join(HERE, "results", "raw", `run-${args.stamp}`);
  await mkdir(outDir, { recursive: true });
  const productFile = join(outDir, "product.jsonl");
  await writeFile(productFile, `${result.rows.map((r) => JSON.stringify(r)).join("\n")}\n`);

  console.log(`\nresearchbench run ${args.stamp} (version ${BENCH_VERSION}) — ${selected.length} case(s)`);
  console.log("gate = recall@budget >= 50% always; hub-avoidance >= 80% / ordering >= 80% where the rung tests them; zero invented traversal.");
  console.log(renderRollup(result.rolled));

  const ceilingRows = result.rows.filter((r) => r.ceiling);
  for (const r of ceilingRows) console.log(`  ${r.rung} ${r.id}: ceiling marker — no lane capability yet (research horizon, see SKILL_BENCHMARK_RESEARCH.md §3)`);

  if (args.ladder) {
    console.log(`\nladder: ${result.ladder.order.join(" -> ")}${result.ladder.gatedAt ? `  — gated at ${result.ladder.gatedAt}` : "  — every measured rung passes the gate"}`);
    for (const r of result.ladder.receipts) console.log(`  rung ${r.rung} skipped: ${r.reason}`);
  }

  const inventedRows = result.rows.filter((r) => r.invented);
  if (inventedRows.length) {
    console.log(`\ninvented-traversal failures (${inventedRows.length}):`);
    for (const r of inventedRows) console.log(`  ${r.id}`);
  }

  console.log(`\nproduct: ${productFile}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
