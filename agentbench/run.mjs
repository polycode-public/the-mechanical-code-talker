// agentbench/run.mjs — the DETERMINISTIC AGENTBENCH runner (sibling of
// chatbench/run.mjs). Replays every case in agentbench/cases.jsonl through a
// PLUGGABLE "agent under test" and grades the tool loop on the A0→C2 agentic
// rungs. No LLM, no network — grading is entirely deterministic (grade.mjs).
//
// The agent-under-test is a SEAM: a function (request, tools, ctx) => loopResult
// (see agentbench/driver-stub.mjs). Today the default is the STUB driver (its
// results are the "stub-driver FLOOR", stamped driver:"stub-floor"); the
// coordinator swaps in the real resolver/planner/shim driver later behind this
// exact signature via runAgentbench({ driver }).
//
// Determinism: NO Date.now() in recorded output — the run stamp comes from
// --stamp (default the bench version, read once from package.json at load). Two
// runs over the same tree + stamp produce byte-identical rows.
//
// Usage:
//   node agentbench/run.mjs [--stamp <label>] [--cases agentbench/cases.jsonl]
//     [--out agentbench/results/raw/run-<stamp>] [--rung <A0|A1|…|C2>]
//     [--ladder] [--only <id,id,…>]

import { mkdir, readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseCases, gradeCase, rollup, ladderGate, renderRollup, RUNGS } from "./grade.mjs";
import { stubDriver } from "./driver-stub.mjs";
import { capabilityByName } from "../src/router/registry.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
export const DEFAULT_CASES = join(HERE, "cases.jsonl");
export const FIXTURE = join(ROOT, "test", "fixtures", "entities.fixture.json");

// The bench version tracks package.json (read once at load — deterministic per
// run, no Date.now). Artifacts stamp this; a version bump auto-flows here so the
// grading record never drifts from the release it measures.
export const BENCH_VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

/** Build the run context the driver receives. Materializes the ingested fixture
 *  to a throwaway .tmct/graph.json (mirroring chatbench's createRunnerDeps and a
 *  real graph writer's pipeline) so the REAL dispatchTool can resolve entities.
 *  Returns { ctx, cleanup } — the caller MUST await cleanup(). */
export async function createRunCtx() {
  const { dispatchTool } = await import(join(ROOT, "src", "server.mjs"));
  const { ingestSchemaDocs } = await import(join(ROOT, "src", "schema-docs.mjs"));
  const { ToolError } = await import(join(ROOT, "src", "config.mjs"));

  const graphJson = JSON.stringify(ingestSchemaDocs(JSON.parse(await readFile(FIXTURE, "utf8"))));
  const dir = await mkdtemp(join(tmpdir(), "tmct-agentbench-"));
  await mkdir(join(dir, ".tmct"), { recursive: true });
  const graphFile = join(dir, ".tmct", "graph.json");
  await writeFile(graphFile, graphJson);
  const config = { graphFile };

  // dispatch(): the driver's window onto the REAL tool layer. Returns
  // { ok:true, text } on success, { ok:false, error } on a ToolError (an
  // unresolvable entity / honest miss — NOT a crash).
  const dispatch = async (name, input) => {
    try {
      const text = await dispatchTool(name, input, { config });
      return { ok: true, text };
    } catch (e) {
      if (e instanceof ToolError) return { ok: false, error: e.message };
      throw e; // a real bug, not an honest miss — surface it
    }
  };

  const ctx = { dispatch, capabilityByName, config };
  return { ctx, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** Run one case through the driver → a graded product row (deterministic). */
export async function runCase(caseDef, driver, ctx, stamp) {
  const loopResult = await driver(caseDef.request, caseDef.tools, ctx);
  const verdict = gradeCase(caseDef, loopResult);
  return {
    caseId: caseDef.id,
    rung: caseDef.rung,
    request: caseDef.request,
    tools: caseDef.tools,
    driver: loopResult?.driver ?? "unknown",
    stamp,
    version: BENCH_VERSION,
    expect: caseDef.expect,
    produced: {
      calls: loopResult?.calls ?? [],
      refused: Boolean(loopResult?.refused),
      terminated: Boolean(loopResult?.terminated),
      proof: loopResult?.proof ?? [],
      ...(loopResult?.why ? { why: loopResult.why } : {}),
      ...(loopResult?.observed ? { observed: loopResult.observed } : {}),
    },
    verdict,
  };
}

/** Programmatic entry (unit-testable): grade a set of cases with a given driver.
 *  Returns { rows, rolled, ladder }. `driver` defaults to the stub floor. */
export async function runAgentbench(cases, { driver = stubDriver, stamp = BENCH_VERSION, ladder = false } = {}) {
  const { ctx, cleanup } = await createRunCtx();
  try {
    const rows = [];
    for (const caseDef of cases) rows.push(await runCase(caseDef, driver, ctx, stamp));
    const rolled = rollup(rows);
    return { rows, rolled, ladder: ladder ? ladderGate(rolled) : null };
  } finally {
    await cleanup();
  }
}

function parseArgs(argv) {
  const args = { cases: DEFAULT_CASES, stamp: BENCH_VERSION };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--stamp") args.stamp = argv[++i];
    else if (a === "--cases") args.cases = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--rung") args.rung = argv[++i].toUpperCase();
    else if (a === "--ladder") args.ladder = true;
    else if (a === "--only") args.only = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!/^[A-Za-z0-9._-]+$/.test(args.stamp)) {
    console.error("agentbench/run.mjs: --stamp must be a filesystem-safe label (ids never come from Date.now).");
    return 2;
  }
  if (args.rung && !RUNGS.includes(args.rung)) {
    console.error(`--rung must be one of ${RUNGS.join("|")}`);
    return 2;
  }

  const { cases, errors } = parseCases(await readFile(args.cases, "utf8"));
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

  const { rows, rolled, ladder } = await runAgentbench(selected, { stamp: args.stamp, ladder: args.ladder });

  const outDir = args.out ?? join(HERE, "results", "raw", `run-${args.stamp}`);
  await mkdir(outDir, { recursive: true });
  const productFile = join(outDir, "product.jsonl");
  await writeFile(productFile, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const drivers = [...new Set(rows.map((r) => r.driver))];
  console.log(`agentbench run ${args.stamp} (version ${BENCH_VERSION}) — ${rows.length} case(s), driver: ${drivers.join(",")}`);
  if (drivers.includes("stub-floor")) {
    console.log("NOTE: these are the STUB-DRIVER FLOOR — not the router baseline. The real resolver/planner is swapped in later behind driver(request,tools,ctx).");
  }
  console.log("\nmetric pair per rung (gate = 0% hallucination AT ≥50% completion):");
  console.log(renderRollup(rolled));

  const fails = rows.filter((r) => !r.verdict.pass);
  if (fails.length) {
    console.log(`\nnon-passing cases (${fails.length}):`);
    for (const r of fails) console.log(`  ${r.verdict.hallucinated.length ? "HALLUC" : "FAIL  "} ${r.caseId} [${r.rung}]: ${r.verdict.reasons.join("; ")}`);
  }

  if (ladder) {
    console.log("\nladder (rungs ascend; first un-gated rung gates the rest):");
    console.log(`  order: ${ladder.order.join(" → ")}${ladder.gatedAt ? `  — gated at ${ladder.gatedAt}` : "  — all rungs pass the gate"}`);
    for (const rcpt of ladder.receipts) console.log(`  rung ${rcpt.rung} skipped: ${rcpt.reason}`);
  }

  console.log(`\nproduct: ${productFile}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
