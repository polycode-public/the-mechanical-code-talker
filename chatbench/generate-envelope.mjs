// chatbench/generate-envelope.mjs — generates chatbench/envelope.json, a small,
// stable, MACHINE-READABLE summary of what the latest GRADED chatbench run
// actually proves, matching agentbench/envelope.json's and infbench/envelope.json's
// role: a real artifact scripts/agi-scales-aggregate.mjs (or any other
// downstream reader) can check itself against.
//
// CHATBENCH has no rung-gated capability ladder to mirror (it is LLM-judge
// scored, not deterministically graded against a pinned literal like
// AGENTBENCH/INFBENCH), so this is a genuine new shape rather than a port —
// see the field-by-field notes this generator writes into its own output.
//
// THIS GENERATOR MAKES ZERO MODEL CALLS. It is a pure read+reshape over TWO
// already-computed files from a prior chatbench/judge.mjs run:
//   --product <product.jsonl>  (chatbench/run.mjs's deterministic output — free,
//                                no LLM involved, safe to regenerate any time)
//   --summary <summary.json>   (chatbench/judge.mjs's computeSummary output —
//                                requires having already PAID for a live judge
//                                pass; this generator never triggers one)
// Regenerating this envelope after a NEW judged run still requires that prior
// live judge pass to have happened — a real, unavoidable, one-time-per-release
// cost that belongs to `node chatbench/judge.mjs`, not to this file. This file
// only reshapes what a completed run already wrote to disk.
//
// tier1PassRate is read straight from --product alone (every case the run
// touched, judged or not) because tier1 is deterministic and judge-free; the
// other three fields are read from --summary and therefore only cover the
// subset of cases that run actually judged. Keeping the two apart in the
// output means a reader can tell which half of the number is free to
// regenerate and which half was paid for — see buildEnvelope's own notes.
//
// Usage: node chatbench/generate-envelope.mjs --summary <summary.json>
//   --product <product.jsonl> [--out chatbench/envelope.json] [--stamp <label>]

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseFlags } from "../benchlib/bench.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);
export const DEFAULT_OUT = join(HERE, "envelope.json");

// The schema is intentionally small and stable — additive-only going forward.
export const SCHEMA_VERSION = 1;

function parseJsonl(text) {
  return String(text).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

/** Build the envelope object (pure over an already-graded run's own product
 *  rows + summary — no I/O, no model call). */
export function buildEnvelope({ productRows, summary, stamp, chatbenchVersion }) {
  const caseCount = productRows.length;
  const tier1PassCount = productRows.filter((r) => r.tier1?.pass).length;
  const tier1PassRate = caseCount ? tier1PassCount / caseCount : null;

  const judgedCaseCount = summary?.overall?.cases ?? 0;
  const hardFailRate = judgedCaseCount ? summary.overall.hardFailCount / judgedCaseCount : null;
  const meanScore = summary?.overall?.mean ?? null;
  const samplesPerCase = summary?.samplesPerCase ?? null;
  const voidDenominator = judgedCaseCount && samplesPerCase ? judgedCaseCount * samplesPerCase : 0;
  const voidRate = voidDenominator ? summary.overall.voidCount / voidDenominator : null;

  return {
    schemaVersion: SCHEMA_VERSION,
    generatedFrom: {
      chatbenchVersion,
      stamp,
      judgeModel: summary?.judgeModel ?? null,
      promptVersion: summary?.promptVersion ?? null,
      caseCount,
      judgedCaseCount,
      samplesPerCase,
    },
    capability: {
      tier1PassRate,
      hardFailRate,
      meanScore,
      voidRate,
    },
    notes: [
      "tier1PassRate is DETERMINISTIC and judge-free: tier1PassCount/caseCount, read from --product's own tier1.pass field over every case the run touched, whether or not that case was ever judged. Free to regenerate any time a fresh product.jsonl exists.",
      "hardFailRate, meanScore and voidRate are JUDGE-DERIVED: computed only over judgedCaseCount, the subset --summary actually graded (a delta-judged run judges only the changed cases and inherits the rest — chatbench/judge.mjs's --cache — so judgedCaseCount can be smaller than caseCount). Regenerating these three after a new judged run requires that prior live judge pass, a real one-time-per-release cost this generator does not add — see the file header.",
      "hardFailRate is CHATBENCH's honesty-adjacent zero-fabrication analogue: hardFailCount/judgedCaseCount, where a hard fail is the judge agreeing the transcript was confidently wrong or ungrounded (chatbench/judge.mjs's isHardFail: mean correctness 0 AND mean honesty 0, or mean groundedness 0).",
      "meanScore is the judge's 0-2 rubric mean across groundedness/correctness/honesty/rephrase, over non-void samples only (chatbench/judge.mjs's computeSummary).",
      "voidRate is judge-call failures (refusal, timeout, or format failure — retried once, then voided, NEVER scored as a fail) over judgedCaseCount*samplesPerCase, reported honestly here rather than silently dropped from meanScore.",
      "There is deliberately no ladder/rung field here: CHATBENCH's own --ladder flag (chatbench/README.md) orders CEFR grade bands by judge-call reliability, a scheduling knob for the judge fan-out — it is not a gated capability ladder with a 'rung reached' in the sense AGENTBENCH's TOOL-0..TOOL-8 or INFBENCH's INF-1..INF-8 are, so there is no equivalent scalar to report.",
      "This generator makes zero model calls — it only reads an already-computed --summary/--product pair. Regenerate with `node chatbench/generate-envelope.mjs --summary <path> --product <path>` after any new `node chatbench/judge.mjs` run.",
    ],
  };
}

function parseArgs(argv) {
  return parseFlags(argv, {
    defaults: { out: DEFAULT_OUT },
    flags: {
      "--out": { key: "out", value: resolve },
      "--summary": { key: "summary" },
      "--product": { key: "product" },
      "--stamp": { key: "stamp" },
    },
  });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.summary || !args.product) {
    console.error("chatbench/generate-envelope.mjs: --summary <summary.json> and --product <product.jsonl> are both required (an already-graded run's own outputs — this generator makes no model calls).");
    return 2;
  }

  let productRows;
  let summary;
  try {
    productRows = parseJsonl(await readFile(args.product, "utf8"));
  } catch (e) {
    console.error(`chatbench/generate-envelope.mjs: could not read --product ${args.product}: ${e.message}`);
    return 2;
  }
  try {
    summary = JSON.parse(await readFile(args.summary, "utf8"));
  } catch (e) {
    console.error(`chatbench/generate-envelope.mjs: could not read --summary ${args.summary}: ${e.message}`);
    return 2;
  }

  let chatbenchVersion = null;
  try { chatbenchVersion = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")).version; } catch { /* unversioned */ }

  const stamp = args.stamp ?? summary.stamp ?? productRows[0]?.stamp ?? null;
  const envelope = buildEnvelope({ productRows, summary, stamp, chatbenchVersion });

  await mkdir(dirname(args.out), { recursive: true });
  await writeFile(args.out, JSON.stringify(envelope, null, 2) + "\n");

  console.log(`chatbench envelope written: ${args.out}`);
  console.log(`  chatbenchVersion=${envelope.generatedFrom.chatbenchVersion} tier1PassRate=${envelope.capability.tier1PassRate} ` +
    `hardFailRate=${envelope.capability.hardFailRate} meanScore=${envelope.capability.meanScore} voidRate=${envelope.capability.voidRate}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
