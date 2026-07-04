// chatbench/judge.mjs — tier-2: the LLM-as-judge fan-out over a product.jsonl.
//
// The ONLY paid component of the chatbench (SKILL_TUNING_CYCLE.md §1): the
// product run is deterministic and free; this module scores each case's
// transcript with a PINNED judge model + PINNED prompt version, N samples per
// case (default 3 — the judge is the noisy part, so it is the thing repeated).
//
//   judge model:    claude-haiku-4-5-20251001   (the FULL pinned id, never an alias)
//   prompt version: judge-prompt-v1             (chatbench/judge-prompt-v1.txt)
//   invocation:     claude -p <prompt> --model <id> --output-format json
//                     --json-schema '<contents of chatbench/rubric.schema.json>'
//                   (the flag takes the schema INLINE — passing a file path is
//                   rejected with "--json-schema is not valid JSON")
//   output shape:   stdout is one JSON envelope; `.result` carries the rubric
//                   verdict (probe-verified — see chatbench/README.md), parsed
//                   (string or object tolerated) and validated against the
//                   rubric bounds here.
//
// Integrity rules (§1, enforced): a judge refusal, timeout or format failure
// VOIDS that sample (recorded with void:true + reason) — it is retried once
// sequentially and, if still bad, excluded from every mean; it NEVER counts as
// a fail. Every result row records the judge model + prompt version.
//
// Outputs, next to the product file (or --out):
//   judged.jsonl  — one row per case per sample: scores, void flag, raw text
//   summary.json  — per-case mean, per-tag mean, overall mean, hard-fail count,
//                   void count (hard fail: see isHardFail below)
//
// --dry-run emits the exact prompts (prompts.jsonl) without calling claude —
// what the tests exercise; no test ever makes a live call.
//
// Usage:
//   node chatbench/judge.mjs --product <product.jsonl> [--samples 3]
//     [--concurrency 4] [--out <dir>] [--dry-run] [--only id,id]

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileP = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));

export const JUDGE_MODEL = "claude-haiku-4-5-20251001"; // pinned FULL model id — never an alias
export const PROMPT_VERSION = "judge-prompt-v1";
export const PROMPT_FILE = join(HERE, `${PROMPT_VERSION}.txt`);
export const SCHEMA_FILE = join(HERE, "rubric.schema.json");
export const DIMENSIONS = ["groundedness", "correctness", "honesty", "rephrase"];

const JUDGE_TIMEOUT_MS = 120000;

// ---- prompt construction ----

/** Render a product row's transcript for the judge: visitor/tmct line pairs. */
export function renderTranscript(row) {
  const parts = [];
  let session = null;
  for (const turn of row.transcript) {
    if (row.mode === "session" && turn.session !== session) {
      session = turn.session;
      parts.push(`--- session ${session} (a separate later chat session against the same repo) ---`);
    }
    parts.push(`visitor: ${turn.say}`);
    parts.push(`tmct: ${turn.answer === "" ? "(no answer recorded)" : turn.answer}`);
  }
  return parts.join("\n");
}

/** Fill the pinned prompt template for one product row. */
export function buildPrompt(row, template) {
  const dims = row.judge?.dimensions?.length ? row.judge.dimensions : DIMENSIONS;
  return template
    .replaceAll("{{CASE_ID}}", row.caseId)
    .replaceAll("{{TAGS}}", (row.tags || []).join(", "))
    .replaceAll("{{CONTEXT}}", row.judge?.context || "")
    .replaceAll("{{TRANSCRIPT}}", renderTranscript(row))
    .replaceAll("{{DIMENSIONS}}", dims.join(", "));
}

// ---- score validation (the rubric bounds, mirrored from rubric.schema.json) ----

const isScore = (v) => v === null || (Number.isInteger(v) && v >= 0 && v <= 2);

/** Validate a parsed judge object against the rubric: all four dimensions
 *  present as 0|1|2|null, at least one scored, rationale a string. Returns an
 *  error string or null when valid. */
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

/** Extract + validate the rubric object from claude's stdout. The envelope is
 *  `--output-format json`'s single JSON object; probe-verified shape: under
 *  --json-schema it carries BOTH `.structured_output` (the parsed object) and
 *  `.result` (the same JSON as a string). Prefer structured_output; fall back
 *  to parsing .result. Returns { scores, rationale } or { error }. */
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

/** Enforce the case's dimension gating: the judge sometimes scores a dimension
 *  it was told to leave null (probe-observed), which would smuggle an unasked
 *  dimension into the case mean. Mask everything outside the case's declared
 *  dimensions to null — deterministic, recorded scores stay comparable. */
export function maskScores(scores, dimensions) {
  if (!scores) return scores;
  const keep = new Set(dimensions?.length ? dimensions : DIMENSIONS);
  return Object.fromEntries(DIMENSIONS.map((d) => [d, keep.has(d) ? (scores[d] ?? null) : null]));
}

// ---- the live call (never reached under --dry-run or in tests) ----

async function callJudgeOnce(prompt, { model, schemaJson }) {
  try {
    // NOTE (probe-verified): --json-schema takes the schema JSON INLINE, not a
    // file path — chatbench/rubric.schema.json is read once and passed as text.
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
 *  second failure voids the sample (§1: refusals/format failures are voided,
 *  never scored as fail). */
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

/** The hard-fail predicate (documented; SKILL §1 counts these alongside the
 *  mean): a case hard-fails when its non-void judge samples agree the answer
 *  was confidently wrong or ungrounded — mean correctness 0 AND mean honesty 0
 *  (both scored), or mean groundedness 0. */
export function isHardFail(dimMeans) {
  if (dimMeans.groundedness === 0) return true;
  return dimMeans.correctness === 0 && dimMeans.honesty === 0
    && dimMeans.correctness !== null && dimMeans.honesty !== null;
}

/** Fold judged rows (+ product rows for tags/tier1) into summary.json's shape. */
export function computeSummary(productRows, judgedRows, { stamp, samples } = {}) {
  const byCase = new Map(productRows.map((r) => [r.caseId, r]));
  const grouped = new Map();
  for (const j of judgedRows) {
    if (!grouped.has(j.caseId)) grouped.set(j.caseId, []);
    grouped.get(j.caseId).push(j);
  }
  const perCase = [];
  for (const [caseId, rows] of grouped) {
    const product = byCase.get(caseId);
    const valid = rows.filter((r) => !r.void);
    const dims = {};
    for (const d of DIMENSIONS) {
      dims[d] = mean(valid.map((r) => r.scores?.[d]).filter((v) => v !== null && v !== undefined));
    }
    const caseMean = mean(valid.map((r) => sampleMean(r.scores)).filter((v) => v !== null));
    perCase.push({
      caseId,
      tags: product?.tags ?? [],
      tier1Pass: product?.tier1?.pass ?? null,
      baselineFail: (product?.tier1?.baselineFailTurns?.length ?? 0) > 0,
      mean: caseMean,
      dims,
      samples: rows.length,
      voids: rows.length - valid.length,
      hardFail: valid.length ? isHardFail(dims) : false,
    });
  }
  const perTag = [];
  const tags = [...new Set(perCase.flatMap((c) => c.tags))].sort();
  for (const tag of tags) {
    const cases = perCase.filter((c) => c.tags.includes(tag));
    perTag.push({
      tag,
      cases: cases.length,
      mean: mean(cases.map((c) => c.mean).filter((v) => v !== null)),
      hardFails: cases.filter((c) => c.hardFail).length,
    });
  }
  return {
    stamp: stamp ?? productRows[0]?.stamp ?? null,
    judgeModel: JUDGE_MODEL,
    promptVersion: PROMPT_VERSION,
    samplesPerCase: samples ?? null,
    overall: {
      cases: perCase.length,
      mean: mean(perCase.map((c) => c.mean).filter((v) => v !== null)),
      hardFailCount: perCase.filter((c) => c.hardFail).length,
      voidCount: perCase.reduce((a, c) => a + c.voids, 0),
      tier1PassCount: perCase.filter((c) => c.tier1Pass).length,
    },
    perTag,
    perCase: perCase.sort((a, b) => a.caseId.localeCompare(b.caseId)),
  };
}

// ---- the fan-out ----

/** Run `worker(item)` over items with bounded concurrency, preserving order. */
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

function parseJsonl(text) {
  return String(text).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

function parseArgs(argv) {
  const args = { samples: 3, concurrency: 4, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--product") args.product = argv[++i];
    else if (a === "--samples") args.samples = Number(argv[++i]);
    else if (a === "--concurrency") args.concurrency = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--only") args.only = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else throw new Error(`unknown argument ${a}`);
  }
  return args;
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.product) {
    console.error("chatbench/judge.mjs: --product <product.jsonl> is required.");
    return 2;
  }
  const outDir = args.out ?? dirname(resolve(args.product));
  await mkdir(outDir, { recursive: true });
  const template = await readFile(PROMPT_FILE, "utf8");
  let rows = parseJsonl(await readFile(args.product, "utf8"));
  if (args.only) rows = rows.filter((r) => args.only.includes(r.caseId));

  const prompts = rows.map((row) => ({
    caseId: row.caseId,
    dimensions: row.judge?.dimensions ?? DIMENSIONS,
    prompt: buildPrompt(row, template),
  }));

  if (args.dryRun) {
    const file = join(outDir, "prompts.jsonl");
    await writeFile(file, prompts.map((p) => JSON.stringify(p)).join("\n") + "\n");
    console.log(`dry run: ${prompts.length} prompt(s) written to ${file} — no judge calls made.`);
    return 0;
  }

  // fan out: N samples per case, bounded concurrency, sequential retry inside judgeSample
  const jobs = prompts.flatMap((p) => Array.from({ length: args.samples }, (_, s) => ({ ...p, sample: s + 1 })));
  let done = 0;
  const schemaJson = JSON.stringify(JSON.parse(await readFile(SCHEMA_FILE, "utf8"))); // inline schema (see callJudgeOnce)
  const judged = await pool(jobs, args.concurrency, async (job) => {
    let r = await judgeSample(job.prompt, { model: JUDGE_MODEL, schemaJson });
    const masked = r.void ? null : maskScores(r.scores, job.dimensions);
    if (masked && Object.values(masked).every((v) => v === null)) {
      // the judge scored none of the case's requested dimensions — a format
      // failure in rubric terms: void the sample (§1), never score it
      r = { void: true, reason: "judge scored no requested dimension", rationale: r.rationale, raw: r.raw };
    }
    done += 1;
    process.stderr.write(`\rjudged ${done}/${jobs.length}${r.void ? " (void)" : ""}   `);
    return {
      caseId: job.caseId,
      sample: job.sample,
      judgeModel: JUDGE_MODEL,
      promptVersion: PROMPT_VERSION,
      void: r.void,
      ...(r.reason ? { reason: r.reason } : {}),
      scores: r.void ? null : masked,
      rationale: r.rationale,
      raw: r.raw,
    };
  });
  process.stderr.write("\n");

  const judgedFile = join(outDir, "judged.jsonl");
  await writeFile(judgedFile, judged.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const summary = computeSummary(rows, judged, { samples: args.samples });
  const summaryFile = join(outDir, "summary.json");
  await writeFile(summaryFile, JSON.stringify(summary, null, 2) + "\n");

  console.log(`judged ${summary.overall.cases} case(s) x ${args.samples} sample(s) with ${JUDGE_MODEL} (${PROMPT_VERSION}).`);
  console.log(`overall mean ${summary.overall.mean} / 2 — hard fails ${summary.overall.hardFailCount} — voided samples ${summary.overall.voidCount}.`);
  console.log(`judged: ${judgedFile}\nsummary: ${summaryFile}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
