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
import { shimDriver } from "./driver-shim.mjs";
import { resolverDriver } from "./driver-resolver.mjs";
import { capabilityByName } from "../src/router/registry.mjs";
import { resolveObject } from "../src/ask.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import { resultSetOf } from "./results.mjs";
import { ingestSchemaDocs } from "../src/schema-docs.mjs";

// The pluggable drivers, selectable with --driver. `stub` is the STUB-DRIVER
// FLOOR (default); `shim` is the SHIM-TRANSPORT interface floor (server-http.mjs
// selectTool, reused in-process); `resolver` is the ROUTER BASELINE (Stage 1 +
// Stage 3 — the resolver/planner, driver:"resolver-0.8.0"), NOT a floor.
export const DRIVERS = Object.freeze({ stub: stubDriver, shim: shimDriver, resolver: resolverDriver });

// A HARD wall-clock backstop on ONE driver call (coordinator reinforcement 1):
// the planner's POP/HTN loop has its own MAX_STEPS budget, but a bug that never
// grounds a sub-goal could still hang the single `await driver(...)` — and
// runAgentbench is called from test/agentbench.test.mjs, so a wedge would hang
// the whole ~848-test suite with no failure. This bound turns an overrun into a
// deterministic FAIL on `terminates:true` instead. The timeout only ever fires
// on a real hang (a bug); in normal operation it never triggers, so recorded
// output stays byte-identical (no Date.now enters any row).
export const DRIVER_TIMEOUT_MS = 20000;

// Drivers whose rows are a FLOOR, not the router baseline — the runner prints a
// caveat banner for each so the real engine is never measured against a
// mislabeled anchor (coordinator note 2, extended to shim-transport).
const FLOOR_CAVEAT = Object.freeze({
  "stub-floor": "the STUB-DRIVER FLOOR — a dumb keyword matcher, not the router baseline.",
  "shim-transport": "the SHIM-TRANSPORT interface floor (server-http.mjs routing) — the transport/serialization layer, NOT the routing brain. The real anchor is the resolver/planner driver, swapped in later behind driver(request,tools,ctx).",
});

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
export const DEFAULT_CASES = join(HERE, "cases.jsonl");
export const FIXTURE = join(ROOT, "test", "fixtures", "entities.fixture.json");

// The bench version tracks package.json (read once at load — deterministic per
// run, no Date.now). Artifacts stamp this; a version bump auto-flows here so the
// grading record never drifts from the release it measures.
export const BENCH_VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

/** The set of every entity LABEL in the ingested fixture — the referential
 *  authority for the expect.result lint (a static composed-answer literal must
 *  name only real fixture entities, so a stale literal fails loudly at parse
 *  time, exactly like the expected-call lint). Pure read; no Date.now. */
export async function loadFixtureLabels() {
  const graph = parseEntities(ingestSchemaDocs(JSON.parse(await readFile(FIXTURE, "utf8"))));
  return new Set(graph.individuals.map((i) => String(i.label)));
}

/** Build the run context the driver receives. Materializes the ingested fixture
 *  to a throwaway .tmct/graph.json (mirroring chatbench's createRunnerDeps and a
 *  real graph writer's pipeline) so the REAL dispatchTool can resolve entities.
 *  Returns { ctx, cleanup } — the caller MUST await cleanup(). */
export async function createRunCtx() {
  const { dispatchTool } = await import(join(ROOT, "src", "server.mjs"));
  const { ingestSchemaDocs } = await import(join(ROOT, "src", "schema-docs.mjs"));
  const { ToolError } = await import(join(ROOT, "src", "config.mjs"));

  const ingested = ingestSchemaDocs(JSON.parse(await readFile(FIXTURE, "utf8")));
  const graphJson = JSON.stringify(ingested);
  const dir = await mkdtemp(join(tmpdir(), "tmct-agentbench-"));
  await mkdir(join(dir, ".tmct"), { recursive: true });
  const graphFile = join(dir, ".tmct", "graph.json");
  await writeFile(graphFile, graphJson);
  const config = { graphFile };

  // The parsed graph, loaded ONCE, so the resolver/planner can BIND entities
  // (resolveObject — the binding oracle) with the same graph dispatchTool reads.
  const graph = parseEntities(ingested);

  // resolve(): the driver's binding oracle. Delegates to resolveObject (ask.mjs)
  // — the resolver's `resolves(param, as)` precondition maps to exactly this.
  const resolve = (term) => resolveObject(graph, term);

  // dispatch(): the driver's window onto the REAL tool layer. Returns
  // { ok:true, text, resolved } on success (resolved = the STRUCTURED payload —
  // the graph entity the call bound, so the planner can thread step-i's result
  // into step-i+1's args), { ok:false, error } on a ToolError (an unresolvable
  // entity / honest miss — NOT a crash). Back-compat: the stub/shim drivers read
  // only `text`, so the extra `resolved` key is inert for them.
  const dispatch = async (name, input) => {
    try {
      const text = await dispatchTool(name, input, { config });
      // the primary bound arg (symbol/module/class) -> its resolved entity, for
      // result-threading. A no-arg tool (untested/arch) has no bound entity.
      const primary = input && (input.symbol ?? input.module ?? input.class ?? input.query);
      const resolved = primary ? resolve(String(primary)).match : null;
      // the STRUCTURED result SET (label set) the query produced — the machine-
      // checkable twin of `text` that the multi-step COMPOSER folds (0.8.1). This
      // is the structured payload the resolver driver threads to compute the
      // composed answer grade.mjs value-compares to expect.result.
      const result = resultSetOf(graph, name, input, resolved);
      return { ok: true, text, resolved, result };
    } catch (e) {
      if (e instanceof ToolError) return { ok: false, error: e.message };
      throw e; // a real bug, not an honest miss — surface it
    }
  };

  const ctx = { dispatch, resolve, graph, capabilityByName, config };
  return { ctx, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** Run one case through the driver → a graded product row (deterministic). The
 *  driver call is BOUNDED (DRIVER_TIMEOUT_MS): a runaway planner records a
 *  non-terminating loopResult (an automatic FAIL on `terminates:true`) instead of
 *  hanging the caller — critically, the ~848-test suite that calls runAgentbench.
 *  The timeout fires only on a real hang, so normal runs are byte-identical. */
export async function runCase(caseDef, driver, ctx, stamp) {
  let timer;
  const guard = new Promise((resolve) => {
    timer = setTimeout(
      () => resolve({ calls: [], refused: false, terminated: false, proof: [], driver: "timeout", why: `driver exceeded ${DRIVER_TIMEOUT_MS}ms — bounded to prevent a suite hang` }),
      DRIVER_TIMEOUT_MS,
    );
  });
  let loopResult;
  try {
    loopResult = await Promise.race([driver(caseDef.request, caseDef.tools, ctx), guard]);
  } finally {
    clearTimeout(timer);
  }
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
      // the EXECUTED, COMPOSED answer (0.8.1) — the folded result set the grader
      // value-compares to expect.result. Recorded for transcript provenance; an
      // empty array is a real answer (∅), so guard on !== undefined not truthiness.
      ...(loopResult?.composed !== undefined ? { composed: loopResult.composed } : {}),
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
  const args = { cases: DEFAULT_CASES, stamp: BENCH_VERSION, driver: "stub" };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--stamp") args.stamp = argv[++i];
    else if (a === "--cases") args.cases = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--rung") args.rung = argv[++i].toUpperCase();
    else if (a === "--ladder") args.ladder = true;
    else if (a === "--driver") args.driver = argv[++i];
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
  if (!DRIVERS[args.driver]) {
    console.error(`--driver must be one of ${Object.keys(DRIVERS).join("|")}`);
    return 2;
  }

  const knownLabels = await loadFixtureLabels();
  const { cases, errors } = parseCases(await readFile(args.cases, "utf8"), { knownLabels });
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

  const { rows, rolled, ladder } = await runAgentbench(selected, { driver: DRIVERS[args.driver], stamp: args.stamp, ladder: args.ladder });

  const outDir = args.out ?? join(HERE, "results", "raw", `run-${args.stamp}`);
  await mkdir(outDir, { recursive: true });
  const productFile = join(outDir, "product.jsonl");
  await writeFile(productFile, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const drivers = [...new Set(rows.map((r) => r.driver))];
  console.log(`agentbench run ${args.stamp} (version ${BENCH_VERSION}) — ${rows.length} case(s), driver: ${drivers.join(",")}`);
  for (const d of drivers) {
    if (FLOOR_CAVEAT[d]) console.log(`NOTE: driver "${d}" rows are ${FLOOR_CAVEAT[d]}`);
  }
  console.log("\nmetric pair per rung (gate = 0% hallucination AT ≥50% completion):");
  console.log(renderRollup(rolled));

  const fails = rows.filter((r) => !r.verdict.pass);
  if (fails.length) {
    console.log(`\nnon-passing cases (${fails.length}):`);
    for (const r of fails) console.log(`  ${r.verdict.hallucinated.length ? "HALLUC" : "FAIL  "} ${r.caseId} [${r.rung}]: ${r.verdict.reasons.join("; ")}`);
  }

  // the PLAN-vs-RESULT split, made loud: cases that PASS the call-plan but whose
  // EXECUTED composed answer is still wrong (composing is strictly harder than
  // routing — the honest delta this release measures).
  const resultGap = rows.filter((r) => r.verdict.pass && !r.verdict.resultCompleted);
  if (resultGap.length) {
    console.log(`\nplan-correct but RESULT-incomplete (${resultGap.length}) — the honest composing gap:`);
    for (const r of resultGap) console.log(`  RESULT ${r.caseId} [${r.rung}]: ${r.verdict.resultReasons.join("; ")}`);
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
