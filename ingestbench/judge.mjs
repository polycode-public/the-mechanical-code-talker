// ingestbench/judge.mjs — the LLM-as-judge fan-out for the JUDGED ingest rungs
// (ING-8 meaning-preservation, ING-9 full-fidelity restatement). The ONLY paid
// component of the bench: ING-0..ING-7 are deterministic and free; this scores
// meaning-preservation where triple equality cannot reach, EVAL-SIDE ONLY —
// never the product path (SKILL §1). It mirrors chatbench/judge.mjs's contract
// (pinned model + pinned prompt, N samples, void-on-refusal, the same inline
// --json-schema claude CLI invocation) without importing it — chatbench/ owns
// its own files and this bench keeps its downward-only imports.
//
//   judge model:    claude-haiku-4-5-20251001   (the FULL pinned id, never an alias)
//   prompt version: ingest-judge-v1             (ingestbench/ingest-judge-v1.txt)
//   invocation:     claude -p <prompt> --model <id> --output-format json
//                     --json-schema '<contents of ingestbench/rubric.schema.json>'
//                   (the flag takes the schema INLINE — a file path is rejected)
//
// The judge answers meaning-preservation BOTH ways, one score each (0|1|2|null):
//   forward  — does every claim in the RESTATEMENT follow from the INPUT
//              (precision of meaning — no fact added the source doesn't support)?
//   backward — does every claim in the INPUT appear in the RESTATEMENT
//              (recall of meaning — nothing the source stated is lost)?
//
// Integrity: a judge refusal, timeout or format failure VOIDS that sample
// (recorded void:true + reason), retried once sequentially, then excluded from
// every mean — never counted as a fail. Every row pins the judge model + prompt
// version. --dry-run emits the exact prompts (prompts.jsonl) and makes NO judge
// calls — this is the only path the tests exercise.
//
// Usage:
//   node ingestbench/judge.mjs --product <judge-input.jsonl> [--samples 3]
//     [--concurrency 12] [--out <dir>] [--dry-run] [--only id,id]

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { pool, parseFlags } from "../benchlib/bench.mjs";
export { pool };

const execFileP = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));

export const JUDGE_MODEL = "claude-haiku-4-5-20251001"; // pinned FULL model id — never an alias
export const PROMPT_VERSION = "ingest-judge-v1";
export const PROMPT_FILE = join(HERE, `${PROMPT_VERSION}.txt`);
export const SCHEMA_FILE = join(HERE, "rubric.schema.json");
export const DIMENSIONS = ["forward", "backward"];
const JUDGE_TIMEOUT_MS = 120000;

// ---- prompt construction ----

/** Fill the pinned meaning-preservation prompt for one judge-input row. */
export function buildPrompt(row, template) {
  return template
    .replaceAll("{{CASE_ID}}", row.caseId)
    .replaceAll("{{TAGS}}", (row.tags || []).join(", "))
    .replaceAll("{{INPUT}}", row.input ?? "")
    .replaceAll("{{RESTATEMENT}}", row.restatement === "" ? "(nothing extracted)" : (row.restatement ?? ""));
}

// ---- score validation (the rubric bounds, mirrored from rubric.schema.json) ----

const isScore = (v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 2);

/** Validate a parsed judge object: both dimensions present as 0|1|2|null, at
 *  least one scored, rationale a string. Returns an error string or null. */
export function validateScores(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return "not an object";
  for (const d of DIMENSIONS) {
    if (!(d in obj)) return `missing dimension "${d}"`;
    if (!isScore(obj[d])) return `dimension "${d}" is not 0|1|2|null (got ${JSON.stringify(obj[d])})`;
  }
  if (DIMENSIONS.every((d) => obj[d] === null)) return "all dimensions null — nothing scored";
  if (typeof obj.rationale !== "string") return "missing rationale";
  return null;
}

/** Extract + validate the rubric object from claude's stdout envelope. Prefers
 *  `.structured_output` (present under --json-schema), falls back to parsing
 *  `.result`. Returns { scores, rationale } or { error }. */
export function parseJudgeOutput(stdout) {
  let envelope;
  try { envelope = JSON.parse(stdout); } catch (e) { return { error: `stdout is not JSON: ${e.message}` }; }
  if (envelope.is_error) return { error: `claude reported an error: ${String(envelope.result).slice(0, 200)}` };
  let result = envelope.structured_output ?? envelope.result;
  if (typeof result === "string") {
    try { result = JSON.parse(result); } catch { return { error: `result is not rubric JSON: ${result.slice(0, 200)}` }; }
  }
  const invalid = validateScores(result);
  if (invalid) return { error: `rubric validation failed: ${invalid}` };
  const scores = Object.fromEntries(DIMENSIONS.map((d) => [d, result[d]]));
  return { scores, rationale: result.rationale };
}

// ---- the live call (never reached under --dry-run or in tests) ----

async function callJudgeOnce(prompt, { model, schemaJson }) {
  try {
    const { stdout } = await execFileP(
      "claude",
      ["-p", prompt, "--model", model, "--output-format", "json", "--json-schema", schemaJson],
      { timeout: JUDGE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 },
    );
    return { stdout };
  } catch (e) {
    const stderr = String(e?.stderr || "").trim().slice(0, 300);
    return { error: `claude invocation failed: ${String(e?.code ?? "")} ${stderr || String(e?.message || e).slice(0, 300)}` };
  }
}

/** One sample = one judge call, retried ONCE sequentially on any failure; a
 *  second failure voids the sample (refusals/format failures are voided, never
 *  scored as fail). */
export async function judgeSample(prompt, opts, call = callJudgeOnce) {
  let lastError = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const r = await call(prompt, opts);
    if (r.error) { lastError = r.error; continue; }
    const parsed = parseJudgeOutput(r.stdout);
    if (parsed.error) { lastError = parsed.error; continue; }
    return { void: false, scores: parsed.scores, rationale: parsed.rationale, raw: r.stdout.slice(0, 4000) };
  }
  return { void: true, reason: lastError, scores: null, rationale: null, raw: null };
}

// ---- aggregation ----

const round3 = (n) => Math.round(n * 1000) / 1000;
const mean = (xs) => (xs.length ? round3(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** Per-sample case score: the mean over the dimensions that were scored. */
export function sampleMean(scores) {
  return mean(DIMENSIONS.map((d) => scores?.[d]).filter((v) => v !== null && v !== undefined));
}

/** Fold judged rows (+ judge-input rows for tags) into summary.json's shape. */
export function computeSummary(inputRows, judgedRows, { stamp, samples } = {}) {
  const byCase = new Map(inputRows.map((r) => [r.caseId, r]));
  const grouped = new Map();
  for (const j of judgedRows) {
    if (!grouped.has(j.caseId)) grouped.set(j.caseId, []);
    grouped.get(j.caseId).push(j);
  }
  const perCase = [];
  for (const [caseId, rows] of grouped) {
    const input = byCase.get(caseId);
    const valid = rows.filter((r) => !r.void);
    const dims = {};
    for (const d of DIMENSIONS) dims[d] = mean(valid.map((r) => r.scores?.[d]).filter((v) => v !== null && v !== undefined));
    perCase.push({
      caseId,
      rung: input?.rung ?? null,
      tags: input?.tags ?? [],
      mean: mean(valid.map((r) => sampleMean(r.scores)).filter((v) => v !== null)),
      dims,
      samples: rows.length,
      voids: rows.length - valid.length,
    });
  }
  return {
    stamp: stamp ?? inputRows[0]?.stamp ?? null,
    judgeModel: JUDGE_MODEL,
    promptVersion: PROMPT_VERSION,
    samplesPerCase: samples ?? null,
    overall: {
      cases: perCase.length,
      mean: mean(perCase.map((c) => c.mean).filter((v) => v !== null)),
      voidCount: perCase.reduce((a, c) => a + c.voids, 0),
    },
    perCase: perCase.sort((a, b) => a.caseId.localeCompare(b.caseId)),
  };
}

// ---- the fan-out ----

function parseJsonl(text) {
  return String(text).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

function parseArgs(argv) {
  return parseFlags(argv, {
    defaults: { samples: 3, concurrency: 12, dryRun: false },
    flags: {
      "--product": { key: "product" },
      "--samples": { key: "samples", value: Number },
      "--concurrency": { key: "concurrency", value: Number },
      "--out": { key: "out" },
      "--dry-run": { key: "dryRun", flag: true },
      "--only": { key: "only", value: (v) => v.split(",").map((s) => s.trim()).filter(Boolean) },
    },
  });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.product) {
    console.error("ingestbench/judge.mjs: --product <judge-input.jsonl> is required.");
    return 2;
  }
  const outDir = args.out ?? dirname(resolve(args.product));
  await mkdir(outDir, { recursive: true });
  const template = await readFile(PROMPT_FILE, "utf8");
  let rows = parseJsonl(await readFile(args.product, "utf8"));
  if (args.only) rows = rows.filter((r) => args.only.includes(r.caseId));

  const prompts = rows.map((row) => ({ caseId: row.caseId, rung: row.rung, prompt: buildPrompt(row, template) }));

  if (args.dryRun) {
    const file = join(outDir, "prompts.jsonl");
    await writeFile(file, `${prompts.map((p) => JSON.stringify(p)).join("\n")}\n`);
    console.log(`dry run: ${prompts.length} prompt(s) written to ${file} — no judge calls made.`);
    return 0;
  }

  const jobs = prompts.flatMap((p) => Array.from({ length: args.samples }, (_, s) => ({ ...p, sample: s + 1 })));
  let done = 0;
  const schemaJson = JSON.stringify(JSON.parse(await readFile(SCHEMA_FILE, "utf8"))); // inline schema (see callJudgeOnce)
  const judged = await pool(jobs, args.concurrency, async (job) => {
    const r = await judgeSample(job.prompt, { model: JUDGE_MODEL, schemaJson });
    done += 1;
    process.stderr.write(`\rjudged ${done}/${jobs.length}${r.void ? " (void)" : ""}   `);
    return {
      caseId: job.caseId,
      sample: job.sample,
      judgeModel: JUDGE_MODEL,
      promptVersion: PROMPT_VERSION,
      void: r.void,
      ...(r.reason ? { reason: r.reason } : {}),
      scores: r.void ? null : r.scores,
      rationale: r.rationale,
      raw: r.raw,
    };
  });
  process.stderr.write("\n");

  const judgedFile = join(outDir, "judged.jsonl");
  await writeFile(judgedFile, `${judged.map((r) => JSON.stringify(r)).join("\n")}\n`);
  const summary = computeSummary(rows, judged, { samples: args.samples });
  const summaryFile = join(outDir, "summary.json");
  await writeFile(summaryFile, `${JSON.stringify(summary, null, 2)}\n`);

  console.log(`judged ${summary.overall.cases} case(s) x ${args.samples} sample(s) with ${JUDGE_MODEL} (${PROMPT_VERSION}).`);
  console.log(`overall mean ${summary.overall.mean} / 2 — voided samples ${summary.overall.voidCount}.`);
  console.log(`judged: ${judgedFile}\nsummary: ${summaryFile}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
