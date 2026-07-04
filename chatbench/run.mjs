// chatbench/run.mjs — the deterministic chatbench product runner (tier 1).
//
// Replays every case in chatbench/cases.jsonl through the REAL product:
//   - mode "turns": the pure runTurn() with the committed fixture graph loaded
//     ONCE and passed per turn, threading focus/last from turn N into N+1
//     exactly as runChat's loop does. runTurn performs no writes, and the
//     config's graphFile points at the read-only fixture, so a turns-mode run
//     touches no filesystem state at all.
//   - mode "session": the FULL runChat() with injected input/output streams in
//     a fresh temp dir per case (the scripted-session pattern in
//     test/chat.test.mjs) — session side-effects (sidecar, graph fold-in,
//     memory) happen INSIDE the temp dir, which is removed afterwards. A case
//     may span several sessions (turn.session = 1, 2, …) to measure recall.
//
// Tier-1 expectations (deterministic, evaluated here — the LLM judge is tier 2,
// chatbench/judge.mjs): miss flag, answer regex/substring, answered/resolved id
// membership, post-turn focus label, session end. A turn marked
// expect.baselineFail:true documents a KNOWN current miss: its checks are
// evaluated and recorded but never fail the case; if they all pass, the case is
// flagged `improvedBaselineTurns` (a lever fixed a documented weakness).
//
// Determinism: the run stamp comes from the CLI (--stamp <label>), never from
// Date.now — two runs over the same tree and stamp produce byte-identical rows
// except the informational timingMs field. Exit code: 1 on tier-1 regressions
// vs --compare <prior product.jsonl> (a previously-passing case now failing),
// or on runner errors; 0 otherwise.
//
// Usage:
//   node chatbench/run.mjs --stamp <label> [--cases chatbench/cases.jsonl]
//     [--out chatbench/results/raw/run-<stamp>] [--compare <prior product.jsonl>]
//     [--only <caseId,caseId,...>]

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PassThrough, Readable } from "node:stream";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
export const FIXTURE = join(ROOT, "test", "fixtures", "entities.fixture.json");
export const DEFAULT_CASES = join(HERE, "cases.jsonl");

export const TAGS = [
  "graph-query", "conversational", "honesty-miss", "typo-fuzzy", "noise",
  "ambiguity", "multi-turn-focus", "memory-recall", "bootstrap-empty",
];
export const EXPECT_KEYS = [
  "miss", "answerMatch", "answerNotMatch", "answeredIdsInclude",
  "resolvedIdsInclude", "focusLabel", "end", "baselineFail",
];
export const JUDGE_DIMENSIONS = ["groundedness", "correctness", "honesty", "rephrase"];
const MODES = ["turns", "session"];
const GRAPHS = ["fixture", "empty"];

/** The graph context the judge scores groundedness against — a faithful prose
 *  summary of test/fixtures/entities.fixture.json (kept in sync by hand; the
 *  case set is pinned to this fixture). */
export const FIXTURE_CONTEXT = [
  "The graph under discussion (a small fixture codebase) holds exactly these facts:",
  "- Modules (8): app/lib/a.mjs, app/lib/b.mjs, app/lib/c.mjs, app/functions/d/handler.mjs, app/lib/e.mjs, app/lib/f.mjs, scripts/g.mjs, app/unit-tests/b.test.mjs.",
  "- Classes (3): Base; Widget extends Base; Button extends Widget. Widget has method render (app/lib/b.mjs:5-9) and attribute name.",
  "- Function fnAlpha is defined in app/lib/a.mjs at line 12. The method Widget.render calls fnAlpha (a symbol-level calls edge).",
  "- imports: b.mjs->a.mjs, c.mjs->a.mjs, d/handler.mjs->b.mjs, d/handler.mjs->c.mjs, e.mjs->a.mjs, e.mjs->f.mjs, f.mjs->e.mjs.",
  "- module-level calls: scripts/g.mjs -> app/lib/a.mjs (no module-level calls edge targets fnAlpha itself).",
  "- tests: app/unit-tests/b.test.mjs covers app/lib/b.mjs and app/functions/d/handler.mjs.",
  "- One commit: abc1234 by Ada Lovelace on 2026-06-28, message \"Render the widget with full mode\", touching app/lib/a.mjs and Widget.render.",
  "- Nothing else exists: no zebra.mjs, no nonExistentFn, no other commits.",
  "- Like every real tmct graph artifact, it also documents its OWN vocabulary (schema classes like Module/Class/Function and predicates like imports/calls), so questions about what a term means are answerable from the graph.",
].join("\n");

export const EMPTY_CONTEXT =
  "The graph under discussion is EMPTY (a fresh repo with no index): zero entities, zero edges. " +
  "Every structural answer must therefore be an honest empty/miss; any named entity would be invented.";

// ---- case loading + lint ----

/** Parse cases.jsonl text into { cases, errors }. Errors are lint findings
 *  (schema violations, duplicate ids, bad tags/expect keys) — the same checks
 *  test/chatbench.test.mjs enforces over the committed file. */
export function parseCases(text) {
  const cases = [];
  const errors = [];
  const seen = new Set();
  const lines = String(text).split("\n").filter((l) => l.trim());
  lines.forEach((line, i) => {
    const at = `line ${i + 1}`;
    let c;
    try { c = JSON.parse(line); } catch (e) { errors.push(`${at}: invalid JSON — ${e.message}`); return; }
    if (!c.id || typeof c.id !== "string") { errors.push(`${at}: missing id`); return; }
    if (seen.has(c.id)) errors.push(`${at}: duplicate id ${c.id}`);
    seen.add(c.id);
    if (!Array.isArray(c.tags) || !c.tags.length) errors.push(`${c.id}: tags must be a non-empty array`);
    for (const tag of c.tags || []) if (!TAGS.includes(tag)) errors.push(`${c.id}: unknown tag "${tag}"`);
    if (!MODES.includes(c.mode)) errors.push(`${c.id}: mode must be one of ${MODES.join("|")}`);
    if (c.mode === "session" && !GRAPHS.includes(c.graph)) errors.push(`${c.id}: session case needs graph: ${GRAPHS.join("|")}`);
    if (c.mode === "turns" && c.graph) errors.push(`${c.id}: graph is a session-mode field`);
    if (!Array.isArray(c.turns) || !c.turns.length) { errors.push(`${c.id}: turns must be a non-empty array`); return; }
    let lastSession = 1;
    c.turns.forEach((turn, j) => {
      const tat = `${c.id} turn ${j + 1}`;
      if (!turn.say || typeof turn.say !== "string") errors.push(`${tat}: missing say`);
      if (c.mode === "session") {
        const s = turn.session ?? 1;
        if (!Number.isInteger(s) || s < 1) errors.push(`${tat}: session must be a positive integer`);
        if (s < lastSession) errors.push(`${tat}: session numbers must be non-decreasing`);
        lastSession = Math.max(lastSession, s);
      } else if (turn.session) {
        errors.push(`${tat}: session is a session-mode field`);
      }
      if (turn.expect) {
        for (const k of Object.keys(turn.expect)) {
          if (!EXPECT_KEYS.includes(k)) errors.push(`${tat}: unknown expect key "${k}"`);
        }
        if (c.mode === "session" && ("focusLabel" in turn.expect || "end" in turn.expect)) {
          errors.push(`${tat}: focusLabel/end are turns-mode expectations (session mode reads the sidecar, which has neither)`);
        }
      }
    });
    if (c.judge) {
      if (!Array.isArray(c.judge.dimensions) || !c.judge.dimensions.length) {
        errors.push(`${c.id}: judge.dimensions must be a non-empty array`);
      } else {
        for (const d of c.judge.dimensions) if (!JUDGE_DIMENSIONS.includes(d)) errors.push(`${c.id}: unknown judge dimension "${d}"`);
      }
    }
    cases.push(c);
  });
  return { cases, errors };
}

// ---- tier-1 evaluation ----

const toArray = (v) => (Array.isArray(v) ? v : [v]);

/** Evaluate one turn's expectations against its outcome
 *  ({ answer, miss, resolvedIds, answeredIds, focusLabel?, end? }).
 *  Returns [{ key, pass, expected, actual }] — one entry per declared check
 *  (baselineFail is a marker, not a check). */
export function evaluateExpect(expect, outcome) {
  const checks = [];
  const add = (key, pass, expected, actual) => checks.push({ key, pass, expected, actual });
  if (!expect) return checks;
  if ("miss" in expect) add("miss", outcome.miss === expect.miss, expect.miss, outcome.miss);
  for (const re of toArray(expect.answerMatch ?? [])) {
    add("answerMatch", new RegExp(re).test(outcome.answer ?? ""), re, String(outcome.answer ?? "").slice(0, 200));
  }
  for (const re of toArray(expect.answerNotMatch ?? [])) {
    add("answerNotMatch", !new RegExp(re).test(outcome.answer ?? ""), `not ${re}`, String(outcome.answer ?? "").slice(0, 200));
  }
  for (const id of expect.answeredIdsInclude ?? []) {
    add("answeredIdsInclude", (outcome.answeredIds ?? []).includes(id), id, outcome.answeredIds ?? []);
  }
  for (const id of expect.resolvedIdsInclude ?? []) {
    add("resolvedIdsInclude", (outcome.resolvedIds ?? []).includes(id), id, outcome.resolvedIds ?? []);
  }
  if ("focusLabel" in expect) add("focusLabel", outcome.focusLabel === expect.focusLabel, expect.focusLabel, outcome.focusLabel ?? null);
  if ("end" in expect) add("end", Boolean(outcome.end) === expect.end, expect.end, Boolean(outcome.end));
  return checks;
}

/** Fold per-turn checks into the case's tier-1 verdict. baselineFail turns
 *  never fail the case; a baselineFail turn whose checks ALL pass is an
 *  improvement (flagged, still not a failure). */
export function summarizeTier1(turnEvals) {
  const failing = [];
  const baselineFailTurns = [];
  const improvedBaselineTurns = [];
  let checksTotal = 0;
  turnEvals.forEach(({ checks, baselineFail }, i) => {
    checksTotal += checks.length;
    if (baselineFail) {
      baselineFailTurns.push(i);
      if (checks.length && checks.every((ch) => ch.pass)) improvedBaselineTurns.push(i);
      return;
    }
    for (const ch of checks) if (!ch.pass) failing.push({ turn: i, ...ch });
  });
  return {
    pass: failing.length === 0,
    checksTotal,
    checksFailed: failing.length,
    failing,
    baselineFailTurns,
    improvedBaselineTurns,
  };
}

// ---- product execution ----

/** Run a turns-mode case through the pure runTurn, threading focus/last the
 *  way runChat's loop does. `deps` = { runTurn, config, graph }. */
export async function runTurnsCase(caseDef, deps) {
  const { runTurn, config, graph } = deps;
  let focus = null;
  let last = null;
  const transcript = [];
  const turnEvals = [];
  for (const turn of caseDef.turns) {
    const r = await runTurn(turn.say, { config, graph, focus, last });
    focus = r.focus ?? null;
    last = r.last ?? last;
    const outcome = {
      answer: r.answer,
      miss: r.record?.miss ?? null,
      resolvedIds: r.record?.resolvedIds ?? [],
      answeredIds: r.record?.answeredIds ?? [],
      focusLabel: focus?.label ?? null,
      end: Boolean(r.end),
    };
    transcript.push({
      say: turn.say,
      answer: r.answer,
      miss: outcome.miss,
      resolvedIds: outcome.resolvedIds,
      answeredIds: outcome.answeredIds,
      ...(r.record?.command ? { command: r.record.command } : {}),
      focusLabel: outcome.focusLabel,
      ...(outcome.end ? { end: true } : {}),
      ...(turn.expect ? { expect: turn.expect } : {}),
    });
    turnEvals.push({ checks: evaluateExpect(turn.expect, outcome), baselineFail: Boolean(turn.expect?.baselineFail) });
    if (outcome.end) break; // a farewell ends the case's session, like runChat
  }
  return { transcript, turnEvals };
}

function sink() {
  const out = new PassThrough();
  out.setEncoding("utf8");
  out.resume(); // discard — the per-turn answers are read back from the session log
  return out;
}

/** Run a session-mode case through the FULL runChat in a fresh temp dir:
 *  graph "fixture" seeds .tmct/graph.json from the committed fixture; "empty"
 *  starts bare (the bootstrap path). Turns grouped by turn.session run as
 *  separate scripted sessions in the SAME dir, so session N+1 sees whatever
 *  session N folded in (graph Session individuals, memory) — the recall
 *  measurement. Answers and records are read back from the session log +
 *  structured sidecar (sessions.mjs), matched to turns by order. */
export async function runSessionCase(caseDef, deps) {
  const { runChat, parseSessionJsonl, parseSessionLog, turnKey, graphJson } = deps;
  const dir = await mkdtemp(join(tmpdir(), `tmct-chatbench-${caseDef.id.replace(/[^A-Za-z0-9-]/g, "_")}-`));
  try {
    if ((caseDef.graph ?? "fixture") === "fixture") {
      await mkdir(join(dir, ".tmct"), { recursive: true });
      await writeFile(join(dir, ".tmct", "graph.json"), graphJson);
    }
    // group turns by session number, preserving order
    const bySession = new Map();
    for (const turn of caseDef.turns) {
      const s = turn.session ?? 1;
      if (!bySession.has(s)) bySession.set(s, []);
      bySession.get(s).push(turn);
    }
    const transcript = [];
    const turnEvals = [];
    for (const [sessionNo, turns] of bySession) {
      const lines = [...turns.map((t) => t.say), "/exit"].map((l) => l + "\n");
      const { logFile, sidecarFile } = await runChat({
        repoPath: dir,
        input: Readable.from(lines),
        output: sink(),
        env: { NO_COLOR: "1" }, // no inherited env: telemetry stays off, output undecorated
      });
      const rec = parseSessionJsonl(await readFile(sidecarFile, "utf8"));
      const answers = parseSessionLog(await readFile(logFile, "utf8"));
      const records = rec?.turns ?? [];
      turns.forEach((turn, i) => {
        const record = records[i];
        const matched = record && record.query === turn.say;
        // Scrub the per-run temp dir out of answers (e.g. the empty-graph
        // bootstrap message names the graph path) so rows stay deterministic.
        const answer = matched
          ? (answers.get(turnKey(record.ts, record.query)) ?? "").replaceAll(dir, "<repo>")
          : "";
        const outcome = matched
          ? { answer, miss: record.miss, resolvedIds: record.resolvedIds, answeredIds: record.answeredIds }
          : { answer: "", miss: null, resolvedIds: [], answeredIds: [] };
        transcript.push({
          session: sessionNo,
          say: turn.say,
          answer,
          miss: outcome.miss,
          resolvedIds: outcome.resolvedIds,
          answeredIds: outcome.answeredIds,
          ...(record?.command ? { command: record.command } : {}),
          ...(turn.expect ? { expect: turn.expect } : {}),
        });
        const checks = evaluateExpect(turn.expect, outcome);
        if (!matched) checks.push({ key: "turnRecorded", pass: false, expected: turn.say, actual: record?.query ?? "(no record)" });
        turnEvals.push({ checks, baselineFail: Boolean(turn.expect?.baselineFail) });
      });
    }
    return { transcript, turnEvals };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Run one case (either mode) into a product row. */
export async function runCase(caseDef, deps) {
  const t0 = process.hrtime.bigint();
  const { transcript, turnEvals } = caseDef.mode === "session"
    ? await runSessionCase(caseDef, deps)
    : await runTurnsCase(caseDef, deps);
  const tier1 = summarizeTier1(turnEvals);
  const timingMs = Number((process.hrtime.bigint() - t0) / 1000000n);
  const baseContext = caseDef.mode === "session" && caseDef.graph === "empty" ? EMPTY_CONTEXT : FIXTURE_CONTEXT;
  return {
    caseId: caseDef.id,
    tags: caseDef.tags,
    mode: caseDef.mode,
    ...(caseDef.graph ? { graph: caseDef.graph } : {}),
    stamp: deps.stamp,
    judge: {
      dimensions: caseDef.judge?.dimensions ?? JUDGE_DIMENSIONS,
      context: caseDef.judge?.context ? `${baseContext}\n\nCase note: ${caseDef.judge.context}` : baseContext,
    },
    transcript,
    tier1,
    timingMs,
  };
}

/** Compare this run's rows to a prior product.jsonl's: a regression is a case
 *  that PASSED tier-1 before and fails now (SKILL §1's decision rule input). */
export function compareProducts(priorRows, currentRows) {
  const prior = new Map(priorRows.map((r) => [r.caseId, r]));
  const regressions = [];
  const newCases = [];
  for (const row of currentRows) {
    const before = prior.get(row.caseId);
    if (!before) { newCases.push(row.caseId); continue; }
    if (before.tier1?.pass && !row.tier1?.pass) regressions.push(row.caseId);
  }
  return { regressions, newCases };
}

export function parseJsonl(text) {
  return String(text).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

function parseArgs(argv) {
  const args = { cases: DEFAULT_CASES };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--stamp") args.stamp = argv[++i];
    else if (a === "--cases") args.cases = argv[++i];
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--compare") args.compare = argv[++i];
    else if (a === "--only") args.only = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.stamp || !/^[A-Za-z0-9._-]+$/.test(args.stamp)) {
    console.error("chatbench/run.mjs: --stamp <label> is required (a filesystem-safe label; ids never come from Date.now).");
    return 2;
  }
  const outDir = args.out ?? join(HERE, "results", "raw", `run-${args.stamp}`);

  // Lazy product imports (the same modules the CLI uses).
  const { runTurn, runChat } = await import(join(ROOT, "src", "chat.mjs"));
  const { parseEntities } = await import(join(ROOT, "src", "codegraph.mjs"));
  const { ingestSchemaDocs } = await import(join(ROOT, "src", "schema-docs.mjs"));
  const { parseSessionJsonl, parseSessionLog, turnKey } = await import(join(ROOT, "src", "sessions.mjs"));

  const { cases, errors } = parseCases(await readFile(args.cases, "utf8"));
  if (errors.length) {
    console.error(`cases lint failed (${errors.length}):`);
    for (const e of errors) console.error(`  - ${e}`);
    return 2;
  }
  const selected = args.only ? cases.filter((c) => args.only.includes(c.id)) : cases;
  if (args.only && selected.length !== args.only.length) {
    console.error(`--only names unknown case ids: ${args.only.filter((id) => !cases.some((c) => c.id === id)).join(", ")}`);
    return 2;
  }

  // The runner's fixture pipeline mirrors a REAL graph writer's: raw payload ->
  // ingestSchemaDocs() -> the artifact (a real graph.json always carries the
  // schema-doc individuals — test/ask.test.mjs's buildGraph plays the same
  // trick). The ingested payload is materialized ONCE to a throwaway file so
  // the dispatchTool path (which re-reads config.graphFile per ask) sees the
  // same graph the pre-parsed `graph` object holds; runTurn never writes to it.
  const graphJson = JSON.stringify(ingestSchemaDocs(JSON.parse(await readFile(FIXTURE, "utf8"))));
  const graphDir = await mkdtemp(join(tmpdir(), "tmct-chatbench-graph-"));
  const graphFile = join(graphDir, "graph.json");
  await writeFile(graphFile, graphJson);
  const config = { graphFile };
  const graph = parseEntities(JSON.parse(graphJson));
  const deps = { runTurn, runChat, parseSessionJsonl, parseSessionLog, turnKey, config, graph, graphJson, stamp: args.stamp };

  const rows = [];
  try {
    for (const caseDef of selected) rows.push(await runCase(caseDef, deps)); // sequential: session cases share tmpdir space, and product runs are ms-cheap
  } finally {
    await rm(graphDir, { recursive: true, force: true });
  }

  await mkdir(outDir, { recursive: true });
  const productFile = join(outDir, "product.jsonl");
  await writeFile(productFile, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");

  const passed = rows.filter((r) => r.tier1.pass).length;
  const baseline = rows.filter((r) => r.tier1.baselineFailTurns.length).length;
  const improved = rows.filter((r) => r.tier1.improvedBaselineTurns.length);
  console.log(`chatbench run ${args.stamp}: ${rows.length} case(s) — tier-1 pass ${passed}/${rows.length} (${baseline} carry baselineFail turns).`);
  if (improved.length) console.log(`baseline improvements (documented weaknesses now passing): ${improved.map((r) => r.caseId).join(", ")}`);
  for (const r of rows.filter((x) => !x.tier1.pass)) {
    console.log(`  FAIL ${r.caseId}: ${r.tier1.failing.map((f) => `turn ${f.turn + 1} ${f.key} (expected ${JSON.stringify(f.expected)})`).join("; ")}`);
  }
  console.log(`product: ${productFile}`);

  if (args.compare) {
    const prior = parseJsonl(await readFile(args.compare, "utf8"));
    const { regressions, newCases } = compareProducts(prior, rows);
    if (newCases.length) console.log(`new cases since compare base: ${newCases.join(", ")}`);
    if (regressions.length) {
      console.error(`TIER-1 REGRESSIONS vs ${args.compare}: ${regressions.join(", ")}`);
      return 1;
    }
    console.log("no tier-1 regressions vs compare base.");
  }
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
