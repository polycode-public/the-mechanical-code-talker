// synthbench/code/run.mjs — the SYNTHBENCH-CODE ladder driver. Replays every
// case in synthbench/code/cases.jsonl through the DETERMINISTIC synthesizer,
// verifies each artifact through the REAL sandbox, and grades the SYN-0→SYN-8
// rungs. No LLM, no network — synthesis is bounded and grading is pure.
//
// Determinism: NO Date.now() in recorded output — the run stamp comes from
// --stamp (default the bench version, read once from package.json at load). Each
// case is synthesized TWICE and the edit bytes compared, so a non-deterministic
// transformation is caught as the verification failure it is.
//
// Usage:
//   node synthbench/code/run.mjs [--stamp <label>] [--ladder]
//     [--rung SYN-0|…|SYN-8] [--only id,id] [--cases <path>] [--out <dir>]
//     [--concurrency <n>]   (default 4 — each lane spawns subprocesses)

import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { pool, parseFlags } from "../../benchlib/bench.mjs";
import { parseCases, gradeCase, rollup, ladderGate, renderRollup, RUNGS, COMPLETION_FLOOR } from "./grade.mjs";
import { synthesizePlannedEdit, synthesizeRename } from "./synth.mjs";
import { verifyPlannedEdit } from "./verify/tiers.mjs";
import { graphStateFromEntities } from "../../src/domain/codeplan/graph-delta.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
export const DEFAULT_CASES = join(HERE, "cases.jsonl");
export const BENCH_VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;
export const DEFAULT_CONCURRENCY = 4;

// A rung with no cases is a not-yet-built ceiling marker, named honestly rather
// than scored. SYN-0 is the first (and today only) built rung; the rest are
// designed in PLAN_CODE.md and land at the honest-miss floor until built.
const CEILING_MARKER = "no capability built yet — lands at the honest-miss floor as a ceiling marker";

const readModuleFrom = (fixtureRoot) => (relModule) => {
  const p = join(fixtureRoot, relModule);
  if (!existsSync(p)) return null;
  return readFileSync(p, "utf8");
};

/** The fixture's committed pre-edit code graph, as graph-delta.mjs state —
 *  what a rename's preconditions check against. */
const loadFixtureGraphState = (fixtureRoot) =>
  graphStateFromEntities(JSON.parse(readFileSync(join(fixtureRoot, ".tmct", "graph.json"), "utf8")));

/** Synthesize + verify one case into a graded row (deterministic). Only the
 *  planned-edit family has a verifier today; a case of any other family is a
 *  hard configuration error, not a silent skip (the plan owns building its
 *  verifier before its cases land). Within planned-edit, the case's own
 *  goal.operator selects the synthesizer — rename-entity (SYN-3) checks its
 *  preconditions against the fixture's code graph, every other operator
 *  (SYN-0's insert-observable-print) against the parsed source alone. */
export async function runCase(caseDef, stamp) {
  if (caseDef.family !== "planned-edit") {
    throw new Error(`case ${caseDef.id}: no verifier built for family '${caseDef.family}' — build it before adding its cases (PLAN_CODE.md owns the build)`);
  }
  const fixtureRoot = join(ROOT, caseDef.fixture);
  const readModule = readModuleFrom(fixtureRoot);

  const synthesize = caseDef.goal?.operator === "rename-entity"
    ? () => synthesizeRename(caseDef, readModule, loadFixtureGraphState(fixtureRoot))
    : () => synthesizePlannedEdit(caseDef, readModule);

  const synth = synthesize();
  const synthAgain = synthesize();
  const byteDeterministic = JSON.stringify(synth.edits ?? null) === JSON.stringify(synthAgain.edits ?? null);

  let outcome;
  if (synth.abstained) {
    outcome = { abstained: true, refusalReason: synth.refusalReason, tier0Ok: false, verifiedComplete: false, byteDeterministic, tiers: {} };
  } else {
    const v = await verifyPlannedEdit(caseDef, synth, fixtureRoot);
    outcome = {
      abstained: false,
      refusalReason: null,
      tier0Ok: v.tiers.parse ? v.tiers.parse.ok : true,
      verifiedComplete: v.verifiedComplete,
      byteDeterministic,
      tiers: v.tiers,
    };
  }
  const verdict = gradeCase(caseDef, outcome);
  return {
    caseId: caseDef.id, rung: caseDef.rung, family: caseDef.family,
    poisoned: caseDef.poisoned === true, stamp, version: BENCH_VERSION,
    goal: caseDef.goal, outcome, verdict,
  };
}

/** Programmatic entry (unit-testable): grade a set of cases. Cases fan out
 *  through pool() at `concurrency` lanes; rows are written by index, so row
 *  order (and product.jsonl bytes) is identical to the sequential loop. */
export async function runSynthbenchCode(cases, { stamp = BENCH_VERSION, ladder = false, concurrency = DEFAULT_CONCURRENCY } = {}) {
  const rows = await pool(cases, concurrency, (caseDef) => runCase(caseDef, stamp));
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
    },
  });
}

/** The raw output dir for a stamp: run-<stamp>, or run-<stamp>_00N when a prior
 *  run of the same stamp is already snapshotted (snapshot-before-overwrite). */
function nextRawDir(baseOut, stamp) {
  const base = join(baseOut, `run-${stamp}`);
  if (!existsSync(base)) return base;
  for (let n = 1; n < 1000; n += 1) {
    const candidate = join(baseOut, `run-${stamp}_${String(n).padStart(3, "0")}`);
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error(`too many snapshots for stamp ${stamp}`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!/^[A-Za-z0-9._-]+$/.test(args.stamp)) {
    console.error("synthbench/code/run.mjs: --stamp must be a filesystem-safe label (ids never come from Date.now).");
    return 2;
  }
  if (args.rung && !RUNGS.includes(args.rung)) { console.error(`--rung must be one of ${RUNGS.join("|")}`); return 2; }
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) { console.error("--concurrency must be a positive integer"); return 2; }

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

  const { rows, rolled, ladder } = await runSynthbenchCode(selected, { stamp: args.stamp, ladder: args.ladder, concurrency: args.concurrency });

  const outDir = args.out ?? nextRawDir(join(HERE, "results", "raw"), args.stamp);
  await mkdir(outDir, { recursive: true });
  const productFile = join(outDir, "product.jsonl");
  await writeFile(productFile, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

  console.log(`synthbench-code run ${args.stamp} (version ${BENCH_VERSION}) — ${rows.length} case(s)`);
  console.log("\nfour metrics per rung (gate = 0 false-pass AND 100% abstention AND >=50% verified-completion):");
  console.log(renderRollup(rolled));

  const fails = rows.filter((r) => !r.verdict.pass);
  if (fails.length) {
    console.log(`\nnon-passing cases (${fails.length}):`);
    for (const r of fails) console.log(`  FAIL ${r.caseId} [${r.rung}]: ${r.verdict.reasons.join("; ")}`);
  }

  if (ladder) {
    console.log("\nladder (rungs ascend; first un-gated rung gates the rest):");
    const builtRungs = ladder.order.length ? ladder.order.join(" → ") : "(none)";
    console.log(`  built: ${builtRungs}${ladder.gatedAt ? `  — gated at ${ladder.gatedAt}` : "  — every built rung passes the gate"}`);
    for (const rcpt of ladder.receipts) console.log(`  rung ${rcpt.rung} skipped: ${rcpt.reason}`);
    const unbuilt = RUNGS.filter((r) => !rolled.byRung[r]);
    for (const rung of unbuilt) console.log(`  rung ${rung}: ${CEILING_MARKER}`);
  }

  console.log(`\nproduct: ${productFile}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}

export { COMPLETION_FLOOR };
