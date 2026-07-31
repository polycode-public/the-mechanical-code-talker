// chatbench/distill.mjs — the tier-promotion driver (PLAN lever 2).
//
// Free, model-free, deterministic. Compares two cycles' product+summary output,
// proposes a distilled matcher (matchers.mjs) for every case that is a stable
// pass in both AND distils to a matcher tighter than the judge, and writes the
// proposals for review. Nothing here is committed automatically — the coordinator
// reviews the proposals (they are literal escaped-token requirements lifted from
// the actual answer text, so review is "does this token set look like the real
// grounded essentials", not a judgment call about correctness) before running
// `--commit` to fold them into `promoted.json`, the file `judge.mjs --promoted`
// reads to skip judging a case whose promoted matcher still passes.
//
// Usage:
//   node chatbench/distill.mjs --propose --cycle-a <dir> --cycle-b <dir> [--out proposals.json]
//     Each <dir> must contain product.jsonl + summary.json (chatbench/run.mjs +
//     chatbench/judge.mjs output, e.g. results/raw/run-<stamp>/).
//   node chatbench/distill.mjs --commit --proposals proposals.json [--promoted chatbench/promoted.json]
//     Folds reviewed proposals into the committed promoted set (additive —
//     existing promotions for other caseIds are kept).

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseFlags } from "../benchlib/bench.mjs";
import { answerHash } from "./verdict-cache.mjs";
import { cycleReadings, proposePromotions } from "./matchers.mjs";

function parseJsonl(text) {
  return String(text).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PROMOTED = join(HERE, "promoted.json");

function parseArgs(argv) {
  return parseFlags(argv, {
    defaults: {},
    flags: {
      "--propose": { key: "propose", flag: true },
      "--commit": { key: "commit", flag: true },
      "--cycle-a": { key: "cycleA" },
      "--cycle-b": { key: "cycleB" },
      "--out": { key: "out" },
      "--proposals": { key: "proposals" },
      "--promoted": { key: "promoted" },
    },
  });
}

async function loadCycle(dir) {
  const product = parseJsonl(await readFile(join(dir, "product.jsonl"), "utf8"));
  const summary = JSON.parse(await readFile(join(dir, "summary.json"), "utf8"));
  const judged = parseJsonl(await readFile(join(dir, "judged.jsonl"), "utf8"));
  return { product, summary, judged };
}

// A promoted case skips the judge on future cycles as long as its matcher still
// passes. What it needs to CONTRIBUTE to the mean/hard-fail rollup without a
// fresh judge call is real historical judged samples, not fabricated scores —
// so the proposal carries cycle B's actual judged.jsonl rows for that caseId
// (the cycle the promotion was distilled from), reused verbatim on a future
// cycle exactly the way the verdict cache reuses a hash-matched prior verdict,
// just keyed on matcher-validity instead of byte-identity.
export async function propose({ cycleA, cycleB }) {
  const a = await loadCycle(cycleA);
  const b = await loadCycle(cycleB);
  const readingsA = cycleReadings(a.summary, a.product, answerHash);
  const readingsB = cycleReadings(b.summary, b.product, answerHash);
  const proposals = proposePromotions(readingsA, readingsB);
  const judgedById = new Map();
  for (const row of b.judged) {
    if (!judgedById.has(row.caseId)) judgedById.set(row.caseId, []);
    judgedById.get(row.caseId).push(row);
  }
  for (const p of proposals) p.referenceJudged = judgedById.get(p.caseId) ?? [];
  return proposals;
}

export async function loadPromoted(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return {};
  }
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);

  if (args.propose) {
    if (!args.cycleA || !args.cycleB) {
      console.error("chatbench/distill.mjs --propose needs --cycle-a <dir> and --cycle-b <dir>.");
      return 2;
    }
    const proposals = await propose({ cycleA: resolve(args.cycleA), cycleB: resolve(args.cycleB) });
    const out = args.out ?? join(HERE, "distill-proposals.json");
    await writeFile(out, JSON.stringify(proposals, null, 2) + "\n");
    console.log(`${proposals.length} stable-pass, tight-matcher promotion proposal(s) written to ${out}.`);
    console.log("Review the token sets, then run --commit to fold approved proposals into promoted.json.");
    return 0;
  }

  if (args.commit) {
    if (!args.proposals) {
      console.error("chatbench/distill.mjs --commit needs --proposals <file>.");
      return 2;
    }
    const proposals = JSON.parse(await readFile(args.proposals, "utf8"));
    const promotedPath = args.promoted ?? DEFAULT_PROMOTED;
    const promoted = await loadPromoted(promotedPath);
    for (const p of proposals) {
      promoted[p.caseId] = { matcher: p.matcher, answerHash: p.answerHash, referenceJudged: p.referenceJudged ?? [] };
    }
    await writeFile(promotedPath, JSON.stringify(promoted, null, 2) + "\n");
    console.log(`${proposals.length} proposal(s) committed to ${promotedPath} (${Object.keys(promoted).length} total promoted case(s)).`);
    return 0;
  }

  console.error("chatbench/distill.mjs: pass --propose or --commit.");
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
