// Lane runner for the corpus estate: each lane is a JSONL file in this
// directory, and runLane(laneName) emits one node:test subtest per row.
// Chat rows drive their turns through test/helpers/session.mjs (the same
// createSession path the shell uses); bench-smoke rows spawn a benchmark
// script and hand the finished process to a named predicate.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stringify as stringifyToml } from "smol-toml";
import { driveSessionTurns } from "../helpers/session.mjs";
import * as predicates from "./predicates.mjs";

const CORPUS_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(CORPUS_DIR, "..", "..");

/** A lane's predicate registry: the shared predicates.mjs exports, plus the
 *  lane's own predicates-<lane>.mjs when one exists (sharded lanes like
 *  games/openers share the lane family's module). */
export async function lanePredicates(laneName) {
  const family = laneName.split("/")[0];
  const laneFile = path.join(CORPUS_DIR, `predicates-${family}.mjs`);
  if (!existsSync(laneFile)) return { ...predicates };
  const laneModule = await import(pathToFileURL(laneFile).href);
  return { ...predicates, ...laneModule };
}

export const EXPECT_MODES = ["exact", "regex", "predicate", "same-as-turn"];
export const MEMORY_BACKENDS = ["file", "memory", "sqlite"];

/** Parse a lane's JSONL into row objects, with the offending line number in
 *  any parse error. */
export function readLaneRows(laneName) {
  const file = path.join(CORPUS_DIR, `${laneName}.jsonl`);
  const lines = readFileSync(file, "utf8").split("\n");
  const rows = [];
  for (const [i, line] of lines.entries()) {
    if (line.trim() === "") continue;
    try {
      rows.push(JSON.parse(line));
    } catch (e) {
      throw new Error(`${laneName}.jsonl line ${i + 1}: ${e.message}`);
    }
  }
  return rows;
}

const isNonEmptyString = (v) => typeof v === "string" && v.trim() !== "";

/** Validate one corpus row. Returns a list of problems, empty when the row is
 *  well formed. `predicateNames` defaults to the exports of predicates.mjs. */
export function validateRow(row, predicateNames = Object.keys(predicates)) {
  const problems = [];
  const flag = (msg) => problems.push(msg);
  if (typeof row !== "object" || row === null || Array.isArray(row)) return ["row is not an object"];
  if (!isNonEmptyString(row.id)) flag("id: required non-empty string");
  if (!isNonEmptyString(row.key)) flag("key: required non-empty string");
  if (row.note !== undefined && typeof row.note !== "string") flag("note: must be a string");
  if (row.skip !== undefined && typeof row.skip !== "boolean" && typeof row.skip !== "string") {
    flag("skip: must be a boolean or a reason string");
  }

  const predicateKnown = (name) => {
    if (!isNonEmptyString(name)) return false;
    return predicateNames.includes(name);
  };

  if (row.run !== undefined) {
    if (row.turns !== undefined || row.expect !== undefined) flag("run: mutually exclusive with turns/expect");
    if (typeof row.run !== "object" || row.run === null) return [...problems, "run: must be an object"];
    if (!isNonEmptyString(row.run.script)) flag("run.script: required non-empty string");
    if (row.run.args !== undefined && (!Array.isArray(row.run.args) || !row.run.args.every((a) => typeof a === "string"))) {
      flag("run.args: must be an array of strings");
    }
    if (row.run.prep !== undefined) {
      if (!Array.isArray(row.run.prep)) {
        flag("run.prep: must be an array of {script, args} steps");
      } else {
        for (const [i, step] of row.run.prep.entries()) {
          if (typeof step !== "object" || step === null || !isNonEmptyString(step.script)) {
            flag(`run.prep[${i}].script: required non-empty string`);
            continue;
          }
          if (step.args !== undefined && (!Array.isArray(step.args) || !step.args.every((a) => typeof a === "string"))) {
            flag(`run.prep[${i}].args: must be an array of strings`);
          }
        }
      }
    }
    if (!predicateKnown(row.run.predicate)) flag(`run.predicate: must name an export of predicates.mjs, got ${JSON.stringify(row.run.predicate)}`);
    return problems;
  }

  if (!Array.isArray(row.turns) || row.turns.length === 0 || !row.turns.every(isNonEmptyString)) {
    flag("turns: required non-empty array of non-empty strings");
  }
  if (!Array.isArray(row.expect) || row.expect.length === 0) {
    flag("expect: required non-empty array");
  } else {
    for (const [i, exp] of row.expect.entries()) {
      const at = `expect[${i}]`;
      if (typeof exp !== "object" || exp === null) { flag(`${at}: must be an object`); continue; }
      if (!Number.isInteger(exp.turn) || exp.turn < 0 || (Array.isArray(row.turns) && exp.turn >= row.turns.length)) {
        flag(`${at}.turn: must be an index into turns`);
      }
      if (!EXPECT_MODES.includes(exp.mode)) flag(`${at}.mode: must be one of ${EXPECT_MODES.join("|")}`);
      if (exp.mode === "predicate") {
        const name = typeof exp.value === "string" ? exp.value : exp.value?.name;
        if (!predicateKnown(name)) flag(`${at}.value: must name an export of predicates.mjs, got ${JSON.stringify(name)}`);
      } else if (exp.mode === "same-as-turn") {
        if (!Number.isInteger(exp.value) || exp.value < 0 || (Array.isArray(row.turns) && exp.value >= row.turns.length)) {
          flag(`${at}.value: must be an index into turns`);
        }
      } else if (!isNonEmptyString(exp.value)) {
        flag(`${at}.value: required non-empty string`);
      }
      if (exp.template !== undefined && !isNonEmptyString(exp.template)) flag(`${at}.template: must be a non-empty string`);
      if (exp.justification !== undefined && !isNonEmptyString(exp.justification)) flag(`${at}.justification: must be a non-empty string`);
    }
  }

  if (row.setup !== undefined) {
    const s = row.setup;
    if (typeof s !== "object" || s === null) {
      flag("setup: must be an object");
    } else {
      if (s.fixture !== undefined && !isNonEmptyString(s.fixture)) flag("setup.fixture: must be a non-empty string");
      if (s.teach !== undefined && (!Array.isArray(s.teach) || !s.teach.every(isNonEmptyString))) {
        flag("setup.teach: must be an array of non-empty strings");
      }
      if (s.config !== undefined && typeof s.config !== "string" && (typeof s.config !== "object" || s.config === null)) {
        flag("setup.config: must be a TOML string or a plain object");
      }
      if (s.memoryBackend !== undefined && !MEMORY_BACKENDS.includes(s.memoryBackend)) {
        flag(`setup.memoryBackend: must be one of ${MEMORY_BACKENDS.join("|")}`);
      }
      if (s.seed !== undefined && typeof s.seed !== "boolean") flag("setup.seed: must be a boolean");
      if (s.env !== undefined && (typeof s.env !== "object" || s.env === null || Array.isArray(s.env)
        || !Object.values(s.env).every((v) => typeof v === "string"))) {
        flag("setup.env: must be an object of string values");
      }
      if (s.facts !== undefined) {
        if (!Array.isArray(s.facts) || !s.facts.every((f) => f && typeof f === "object"
          && isNonEmptyString(f.subject) && isNonEmptyString(f.predicate) && isNonEmptyString(f.object))) {
          flag("setup.facts: must be an array of {subject, predicate, object[, provenance]} objects");
        }
        if (s.fixture !== undefined) flag("setup.facts: not usable with a fixture — an ephemeral fixture session gets a fresh memory dir the preload cannot reach");
      }
    }
  }
  return problems;
}

function fixturePath(fixture) {
  const asGiven = path.resolve(REPO_ROOT, fixture);
  if (existsSync(asGiven)) return asGiven;
  return path.resolve(REPO_ROOT, "test", "fixtures", fixture);
}

function assertExpectation(exp, turn, rowId, preds = predicates, allTurns = []) {
  assert.ok(turn, `row ${rowId}: no turn at index ${exp.turn}`);
  const answer = String(turn.answer ?? "");
  if (exp.mode === "exact") {
    assert.equal(answer, exp.value);
  } else if (exp.mode === "same-as-turn") {
    const other = allTurns[exp.value];
    assert.ok(other, `row ${rowId}: no turn at index ${exp.value}`);
    assert.equal(answer, String(other.answer ?? ""), `row ${rowId}: turn ${exp.turn} answer differs from turn ${exp.value}`);
  } else if (exp.mode === "regex") {
    assert.match(answer, new RegExp(exp.value));
  } else {
    const { name, arg } = typeof exp.value === "string" ? { name: exp.value, arg: undefined } : exp.value;
    const fn = preds[name];
    assert.equal(typeof fn, "function", `row ${rowId}: unknown predicate ${name}`);
    assert.ok(fn(turn, arg), `row ${rowId}: predicate ${name} rejected turn ${exp.turn}: ${answer}`);
  }
  if (exp.template !== undefined) {
    const template = turn.template ?? turn.templateId ?? turn.record?.template ?? turn.record?.templateId ?? turn.record?.via;
    assert.equal(template, exp.template, `row ${rowId}: template of turn ${exp.turn}`);
  }
  if (exp.justification !== undefined) {
    const raw = turn.justification ?? turn.record?.justification;
    const j = typeof raw === "string" ? raw : JSON.stringify(raw ?? "");
    assert.match(j, new RegExp(exp.justification), `row ${rowId}: justification of turn ${exp.turn}`);
  }
}

export async function runChatRow(row, preds = predicates) {
  const setup = row.setup ?? {};
  const scratchDir = await mkdtemp(path.join(tmpdir(), "tmct-corpus-"));
  try {
    const sessionOpts = {
      repoPath: setup.fixture ? fixturePath(setup.fixture) : scratchDir,
      env: { ...(setup.seed ? {} : { TMCT_NO_SEED: "1" }), ...(setup.env ?? {}) },
      ...(setup.fixture ? { ephemeral: true } : {}),
      ...(setup.memoryBackend ? { memoryBackend: setup.memoryBackend } : {}),
    };
    if (setup.config !== undefined) {
      const toml = typeof setup.config === "string" ? setup.config : stringifyToml(setup.config);
      const configPath = path.join(scratchDir, "tmct.toml");
      await writeFile(configPath, toml);
      sessionOpts.configPath = configPath;
    }
    // Pre-write memory facts the chat surface has no teach phrasing for
    // (corpus-import predicates like mgx:relatedTo) straight into the scratch
    // repo's store, before the session opens over it.
    if (setup.facts?.length) {
      const { appendFacts } = await import("../../src/adapters/memory/core.mjs");
      await appendFacts(sessionOpts.repoPath, setup.facts);
    }
    const teach = setup.teach ?? [];
    const turns = await driveSessionTurns(sessionOpts, [...teach, ...row.turns]);
    const scripted = turns.slice(teach.length);
    for (const exp of row.expect) assertExpectation(exp, scripted[exp.turn], row.id, preds, scripted);
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
}

// Bench rows get a per-row scratch directory; "{SCRATCH}" in any argument
// expands to it, so a row can direct a benchmark's --out (and any generated
// inputs) away from the repo. The predicate sees it as result.scratchDir.
async function runBenchRow(row, preds = predicates) {
  const { script, args = [], prep = [], predicate, arg } = row.run;
  const fn = preds[predicate];
  assert.equal(typeof fn, "function", `row ${row.id}: unknown predicate ${predicate}`);
  const scratchDir = await mkdtemp(path.join(tmpdir(), "tmct-bench-"));
  const fill = (a) => a.replaceAll("{SCRATCH}", scratchDir);
  const runScript = (scriptPath, scriptArgs) => new Promise((resolveRun) => {
    execFile(
      process.execPath,
      [path.resolve(REPO_ROOT, scriptPath), ...scriptArgs.map(fill)],
      { cwd: REPO_ROOT, encoding: "utf8" },
      (error, stdout, stderr) => resolveRun({ code: error ? (error.code ?? 1) : 0, stdout, stderr }),
    );
  });
  try {
    for (const step of prep) {
      const r = await runScript(step.script, step.args ?? []);
      assert.equal(r.code, 0, `row ${row.id}: prep step ${step.script} exited ${r.code}\n${r.stderr}`);
    }
    const result = await runScript(script, args);
    result.scratchDir = scratchDir;
    assert.ok(fn(result, arg), `row ${row.id}: predicate ${predicate} rejected ${script} (exit ${result.code})\n${result.stderr}`);
  } finally {
    await rm(scratchDir, { recursive: true, force: true });
  }
}

/** Register one node:test per lane, with a subtest per row named by row id. */
export function runLane(laneName) {
  const rows = readLaneRows(laneName);
  test(`corpus lane ${laneName}`, async (t) => {
    const preds = await lanePredicates(laneName);
    for (const [i, row] of rows.entries()) {
      await t.test(row.id ?? `row ${i + 1}`, { skip: row.skip ?? false }, async () => {
        const problems = validateRow(row, Object.keys(preds));
        assert.deepEqual(problems, [], `row schema problems:\n${problems.join("\n")}`);
        if (row.run) await runBenchRow(row, preds);
        else await runChatRow(row, preds);
      });
    }
  });
}
