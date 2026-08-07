// idxbench/run.mjs — the IDXBENCH runner.
//
// Indexes committed fixture repos through the REAL producer
// (src/index/index-repo.mjs's extractRepo/assembleEntities/indexRepository —
// zero model calls, CPU-bound static parsing + git only) and grades the
// produced graph against a gold entity/edge set authored from the fixture
// SOURCE (idxbench/grade.mjs). No LLM, no judge, no network — two runs over
// the same tree and stamp produce byte-identical `product.jsonl`.
//
// Every structural case runs read-only (extractRepo/assembleEntities never
// write to disk) so a committed example fixture's own .tmct/graph.json is
// never touched. The two rungs that DO need a write path (IDX-6's
// determinism check, which calls indexRepository) run against a throwaway
// temp COPY of the fixture, never the fixture itself.
//
// Usage:
//   node idxbench/run.mjs --ladder --stamp <version>
//   node idxbench/run.mjs --rung IDX-2
//   node idxbench/run.mjs --only idx0-js-graph,idx1-js-repo

import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { extractRepo, assembleEntities, indexRepository } from "../../src/index/index-repo.mjs";
import { REGISTRY } from "../../src/index/registry.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { createGraphService } from "../../src/adapters/providers/graph-service.mjs";
import { ask } from "../../src/domain/ask.mjs";
import {
  parseCases, gradeEntities, gradeEdges, gradeHistoryEdges,
  answerQuestion, questionPasses, rollup, ladderGate, renderRollup, RUNGS,
} from "./grade.mjs";
import { parseFlags } from "../benchlib/bench.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = dirname(dirname(HERE));
export const DEFAULT_CASES = join(HERE, "cases.jsonl");
export const BENCH_VERSION = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).version;

const FIXED_GENERATED_AT = "2026-01-01T00:00:00.000Z"; // pinned — never Date.now() in a scored run
const resolveRepoPath = (repo) => (repo.startsWith("/") ? repo : join(ROOT, repo));

// ---- the conformance gate: runConformance() against the produced graph, ---
// ---- via a REAL child `node --test` process over conformance-runner.mjs ---
// A real subprocess, not node:test's in-process run() API: idxbench's own
// smoke test (test/bench/idxbench.test.mjs) calls runIdxbench() from INSIDE a
// `node --test` run, and node:test silently skips a nested run() call in that
// situation ("run() is being called recursively... skipping running files") —
// which would make the conformance gate a silent no-op exactly when a test
// checks that it works. A child process sidesteps that entirely, the same
// NODE_TEST_CONTEXT-stripping trick test/index/example-fixtures.test.mjs
// already uses for its own spawned `node --test` child.
const conformanceCache = new Map();
// FORCE_COLOR is dropped rather than overridden to "0": Node's own colour decision
// treats any FORCE_COLOR key as a forced-on signal regardless of its value and then
// ignores NO_COLOR outright, so the key has to be absent, not falsy. NO_COLOR is then
// added because a caller's real terminal session can otherwise hand this spawned
// `node --test` child colour and break the anchored ^ℹ pass/fail regexes below that
// parse its captured stdout — silently, since the status-code fallback masks it.
const CHILD_ENV = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k !== "NODE_TEST_CONTEXT" && k !== "FORCE_COLOR")),
  NO_COLOR: "1",
};

async function checkConformance(entities, repoRoot) {
  const tmp = await mkdtemp(join(tmpdir(), "idxbench-conformance-"));
  try {
    const graphFile = join(tmp, "graph.json");
    await writeFile(graphFile, JSON.stringify(entities));
    const env = { ...CHILD_ENV, IDXBENCH_CONFORMANCE_GRAPH: graphFile, IDXBENCH_CONFORMANCE_REPO: repoRoot };
    let stdout = "";
    let status = 0;
    try {
      stdout = execFileSync(
        process.execPath,
        ["--disable-warning=ExperimentalWarning", "--test", join(HERE, "conformance-runner.mjs")],
        { env, encoding: "utf8" },
      );
    } catch (e) {
      stdout = e.stdout || "";
      status = typeof e.status === "number" ? e.status : 1;
    }
    const pass = Number(stdout.match(/^ℹ pass (\d+)$/m)?.[1] ?? 0);
    const fail = Number(stdout.match(/^ℹ fail (\d+)$/m)?.[1] ?? (status === 0 ? 0 : 1));
    const failures = [...stdout.matchAll(/^✖ (.+) \(\d/gm)].map((m) => m[1]);
    return { ok: status === 0 && fail === 0, pass, fail, failures };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

async function getConformance(repoPath, entities) {
  if (conformanceCache.has(repoPath)) return conformanceCache.get(repoPath);
  const result = await checkConformance(entities, repoPath);
  conformanceCache.set(repoPath, result);
  return result;
}

// ---- structural cases: IDX-0/1/2/3/5(measured)/8/9 -------------------------

async function loadStructural(repoPath, { historyDepth } = {}) {
  const raw = await extractRepo(repoPath, { historyDepth });
  const entities = assembleEntities({
    modules: raw.modules, commits: raw.commits, symbolHistory: raw.symbolHistory, generatedAt: FIXED_GENERATED_AT,
  });
  return entities;
}

async function runStructuralCase(caseDef) {
  const repoPath = resolveRepoPath(caseDef.repo);
  // The committed fixtures have no nested .git of their own (they live inside
  // this repo's tree), so history is unreachable regardless; historyDepth:0
  // makes that explicit instead of relying on the absent-.git side effect.
  const entities = await loadStructural(repoPath, { historyDepth: 0 });
  const conformance = await getConformance(repoPath, entities);
  const row = { id: caseDef.id, rung: caseDef.rung, repo: caseDef.repo, conformance };

  const scopeModules = caseDef.scope?.modules;
  if (caseDef.gold?.entities) row.entities = gradeEntities(entities.individuals, caseDef.gold.entities, scopeModules);
  if (caseDef.gold?.edges) {
    row.edges = {};
    for (const [predicate, pairs] of Object.entries(caseDef.gold.edges)) {
      const examples = entities.objectProperties.find((o) => o.predicate === predicate)?.examples || [];
      row.edges[predicate] = gradeEdges(examples, pairs, scopeModules);
    }
  }
  if (caseDef.questions?.length) {
    const svc = createGraphService(parseEntities(entities), { sourceAccess: true, repoRoot: repoPath, readFile, ask });
    row.qa = [];
    for (const { q, expect } of caseDef.questions) {
      const { observed } = await answerQuestion(svc, q);
      row.qa.push({ q, pass: questionPasses(expect, observed, { repoRoot: repoPath }) });
    }
  }
  return row;
}

// ---- IDX-5: an absent language is UNMEASURED, never wrong ------------------

function runLanguageParityCase(caseDef) {
  if (caseDef.language && !REGISTRY[caseDef.language]) {
    return { id: caseDef.id, rung: caseDef.rung, language: caseDef.language, measured: false };
  }
  return runStructuralCase(caseDef);
}

// ---- IDX-6: deterministic re-index, against a throwaway temp COPY ---------

async function runDeterminismCase(caseDef) {
  const repoPath = resolveRepoPath(caseDef.repo);
  const tmp = await mkdtemp(join(tmpdir(), "idxbench-determinism-"));
  try {
    await cp(repoPath, tmp, { recursive: true, filter: (src) => !src.split(sep).includes(".tmct") });
    await indexRepository(tmp, { historyDepth: 0, generatedAt: FIXED_GENERATED_AT });
    const first = await readFile(join(tmp, ".tmct", "graph.json"), "utf8");
    await indexRepository(tmp, { historyDepth: 0, generatedAt: FIXED_GENERATED_AT });
    const second = await readFile(join(tmp, ".tmct", "graph.json"), "utf8");
    return { id: caseDef.id, rung: caseDef.rung, repo: caseDef.repo, determinism: first === second };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// ---- IDX-7: history/touches edges, over a synthetic git repo built from ---
// ---- the case's own pinned commit script (no committed nested .git; a ----
// ---- commit sha is a real git hash, so gold never predicts one — only the -
// ---- SHAPE of which commit touched what, graded by gradeHistoryEdges) -----

function gitEnvFor(step) {
  return {
    GIT_AUTHOR_NAME: "idxbench", GIT_AUTHOR_EMAIL: "idxbench@example.invalid",
    GIT_COMMITTER_NAME: "idxbench", GIT_COMMITTER_EMAIL: "idxbench@example.invalid",
    GIT_AUTHOR_DATE: step.authorDate, GIT_COMMITTER_DATE: step.authorDate,
  };
}

function git(cwd, args, extraEnv = {}) {
  execFileSync("git", args, { cwd, env: { ...process.env, ...extraEnv }, stdio: "pipe" });
}

async function runHistoryCase(caseDef) {
  const tmp = await mkdtemp(join(tmpdir(), "idxbench-history-"));
  try {
    git(tmp, ["init", "-q", "-b", "main"]);
    git(tmp, ["config", "user.name", "idxbench"]);
    git(tmp, ["config", "user.email", "idxbench@example.invalid"]);
    // A throwaway, per-run synthetic repo — never the operator's own commits —
    // so a local gpg-signing default can't make the harness flaky in a
    // headless CI environment with no key configured.
    git(tmp, ["config", "commit.gpgsign", "false"]);
    for (const step of caseDef.commits) {
      for (const [relPath, content] of Object.entries(step.files)) {
        const filePath = join(tmp, relPath);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, content);
      }
      git(tmp, ["add", "-A"]);
      git(tmp, ["commit", "-q", "-m", step.message], gitEnvFor(step));
    }

    const entities = await loadStructural(tmp); // no historyDepth override — reads the fresh commits just made
    const conformance = await getConformance(tmp, entities);
    const historyEdges = gradeHistoryEdges(entities, caseDef.gold);

    const noHistoryEntities = await loadStructural(tmp, { historyDepth: 0 });
    const noHistoryTouches = noHistoryEntities.objectProperties.find((o) => o.predicate === "touches").examples.length;
    const noHistoryTouchesSymbol = noHistoryEntities.objectProperties.find((o) => o.predicate === "touchesSymbol").examples.length;
    const noHistoryClean = noHistoryTouches === 0 && noHistoryTouchesSymbol === 0;

    return {
      id: caseDef.id, rung: caseDef.rung, repo: "synthetic-git",
      edges: { historyEdges },
      conformance,
      extraChecks: [{ name: "no-history control is clean (--no-history equivalent)", ok: noHistoryClean }],
    };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// ---- dispatch ---------------------------------------------------------------

async function runCase(caseDef) {
  if (caseDef.rung === "IDX-5") return runLanguageParityCase(caseDef);
  if (caseDef.rung === "IDX-6") return runDeterminismCase(caseDef);
  if (caseDef.rung === "IDX-7") return runHistoryCase(caseDef);
  return runStructuralCase(caseDef);
}

export async function runIdxbench(cases) {
  const rows = [];
  // Sequential, deliberately: the conformance gate passes state to node:test's
  // run() through process.env (see checkConformance) — concurrent cases would
  // race on it. Every case here is CPU-bound and small, so serial is still fast.
  for (const c of cases) rows.push(await runCase(c));
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
    console.error("idxbench/run.mjs: --stamp must be a filesystem-safe label.");
    return 2;
  }
  if (args.rung && !RUNGS.includes(args.rung)) {
    console.error(`idxbench/run.mjs: --rung must be one of ${RUNGS.join("|")}`);
    return 2;
  }

  let casesText;
  try { casesText = await readFile(args.cases, "utf8"); }
  catch { console.error(`idxbench/run.mjs: cases file not found: ${args.cases}`); return 2; }

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

  const result = await runIdxbench(selected);

  const outDir = args.out ?? join(HERE, "results", "raw", `run-${args.stamp}`);
  await mkdir(outDir, { recursive: true });
  const productFile = join(outDir, "product.jsonl");
  await writeFile(productFile, `${result.rows.map((r) => JSON.stringify(r)).join("\n")}\n`);

  console.log(`\nidxbench run ${args.stamp} (version ${BENCH_VERSION}) — ${selected.length} case(s)`);
  console.log("gate = zero fabrication AT recall >= 50% (IDX-4/IDX-6 hold at 100%, no floor), every canonical Q&A exact.");
  console.log(renderRollup(result.rolled));

  const unmeasuredRows = result.rows.filter((r) => r.measured === false);
  for (const r of unmeasuredRows) console.log(`  ${r.rung} ${r.language}: unmeasured (no registered backend) — absent, not wrong`);

  if (args.ladder) {
    console.log(`\nladder: ${result.ladder.order.join(" -> ")}${result.ladder.gatedAt ? `  — gated at ${result.ladder.gatedAt}` : "  — every measured rung passes the gate"}`);
    for (const r of result.ladder.receipts) console.log(`  rung ${r.rung} skipped: ${r.reason}`);
  }

  const qaFails = result.rows.flatMap((r) => (r.qa || []).filter((q) => !q.pass).map((q) => ({ id: r.id, q: q.q })));
  if (qaFails.length) {
    console.log(`\nQ&A misses (${qaFails.length}):`);
    for (const f of qaFails) console.log(`  ${f.id}: "${f.q}"`);
  }
  const conformanceFails = result.rows.filter((r) => r.conformance && !r.conformance.ok);
  if (conformanceFails.length) {
    console.log(`\nconformance-kit failures (${conformanceFails.length}):`);
    for (const r of conformanceFails) console.log(`  ${r.id} (${r.repo}): ${r.conformance.failures.join(", ")}`);
  }

  console.log(`\nproduct: ${productFile}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
