// scripts/agi-scales-aggregate.mjs — mechanically emit the AGI-scales row from
// the other benches' committed envelopes/results (PLAN lever 7).
//
// SKILL_BENCHMARK_AGI_SCALES.md grades tmct on eight scalar scales, each held
// from an ENTRY RUNG tmct passes today up to a described rung above. Several
// entry rungs are facts a sibling bench already records — above all abstention
// calibration (every bench's zero-fabrication gate) and goal-origination
// distance (AGENTBENCH's reached ladder rung). This script reads the sibling
// benches' MACHINE-READABLE artifacts (agentbench/envelope.json today; infbench /
// chatbench envelopes when they exist) and emits the per-scale row mechanically,
// so an AGI-scales cycle pastes measured readings rather than re-deriving them.
//
// It NEVER fabricates a rung. A scale reads a SCALAR only when a bench artifact
// actually produced the number; every other scale reads "entry rung held,
// assessment only" — the honest label SKILL_BENCHMARK_AGI_SCALES.md §1 requires.
// The eight-scale code assessment stays a per-major-version frontier task, by
// design; this only mechanises the entry-rung readings that are already on record.
//
// Usage:
//   node scripts/agi-scales-aggregate.mjs [--agentbench <envelope.json>]
//     [--out <agi-scales-row.json>]   (defaults: agentbench/envelope.json; stdout)

import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseFlags } from "../benchlib/bench.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = dirname(HERE);

/** Map an AGENTBENCH reached ladder rung to the goal-origination notch
 *  SKILL_BENCHMARK_AGI_SCALES.md names (TOOL-6 deduced-and-reached = notch 2;
 *  TOOL-9 inferred-and-horizon = notch 3). A rung between reads at the lower
 *  notch it has cleared. Null rung → no measured notch. */
export function goalNotchFromRung(rung) {
  if (!rung) return null;
  const n = Number(String(rung).replace(/^TOOL-/, ""));
  if (!Number.isFinite(n)) return null;
  if (n >= 9) return { notch: 3, label: "notch 3 of 4 — a goal inferred from an observed trace (TOOL-9)" };
  if (n >= 6) return { notch: 2, label: "notch 2 of 4 — declared goals plus deduced maintenance goals (TOOL-6)" };
  return { notch: 1, label: "notch 1 of 4 — declared goals only" };
}

// The eight scales, with the entry-rung text and source SKILL_BENCHMARK_AGI_SCALES.md
// records. `derive` (optional) pulls a MEASURED reading from the supplied bench
// artifacts; absent or returning null, the scale reads assessment-only.
const SCALES = [
  {
    key: "abstention-calibration",
    entryRung: "fabrication 0% at ≥50% coverage on the graded pools",
    source: "every bench's zero-fabrication gate (INFBENCH, AGENTBENCH, CHATBENCH)",
    derive: ({ agentbench }) => {
      const m = agentbench?.metrics?.overall;
      if (!m || m.hallucinationRate == null) return null;
      const cov = m.planCompletion ?? m.resultCompletion ?? null;
      if (m.hallucinationRate !== 0 || cov == null || cov < 0.5) return null;
      return `fabrication 0% at ${(cov * 100).toFixed(0)}% completion on AGENTBENCH (gate-pass), the fixed-risk point`;
    },
  },
  {
    key: "goal-origination-distance",
    entryRung: "notch 2 of 4: declared goals plus deduced maintenance goals",
    source: "SKILL_BENCHMARK_AGENT.md TOOL-6 (reached), TOOL-9 (horizon)",
    derive: ({ agentbench }) => {
      const notch = goalNotchFromRung(agentbench?.ladder?.rungReached);
      return notch ? `${notch.label}; AGENTBENCH rungReached=${agentbench.ladder.rungReached}` : null;
    },
  },
  { key: "transfer-breadth", entryRung: "three plan-lane domains (hanoi, river crossing, crates) acquired with zero engine changes", source: "on record in the plan lanes" },
  { key: "other-minds-depth", entryRung: "depth 1: spider-fly beliefs including taught false beliefs", source: "SKILL_BENCHMARK_CONVERSATION.md FLOW-8" },
  { key: "temporal-causal-depth", entryRung: "ordered snapshots plus last-touch temporal reads", source: "SKILL_BENCHMARK_INFERENCE.md INF-10, frozen compositional row 19" },
  { key: "knowledge-scale-tolerance", entryRung: "the shipped seed bands (~93k triples) answer with 0% fabrication", source: "on record in the seed bands" },
  { key: "stability-plasticity", entryRung: "append-only teach with prior answers byte-stable within a session, regression-pinned across the corpus lanes", source: "on record in the corpus lanes" },
  { key: "loop-closure", entryRung: "autoplay completes perceive → decide → act → verify to a stall or a win honestly", source: "on record in autoplay" },
];

/** Build the AGI-scales row (pure over the supplied bench artifacts + version).
 *  Each scale reads a measured scalar when its `derive` produced one, else
 *  "entry rung held, assessment only". No scalar is ever invented. */
export function buildAgiRow({ agentbench = null, version = null } = {}) {
  const artifacts = { agentbench };
  const scales = SCALES.map((s) => {
    const measuredReading = s.derive ? s.derive(artifacts) : null;
    return {
      scale: s.key,
      entryRung: s.entryRung,
      source: s.source,
      measured: measuredReading != null,
      reading: measuredReading != null ? measuredReading : "entry rung held, assessment only",
    };
  });
  return {
    benchmark: "AGI_SCALES",
    version,
    generatedFrom: {
      agentbench: agentbench?.generatedFrom?.agentbenchVersion ?? null,
    },
    measuredCount: scales.filter((s) => s.measured).length,
    scales,
  };
}

/** Render the row as the per-scale bullet block a BENCHMARK_AGI_<version>.md
 *  cycle pastes (matches SKILL_BENCHMARK_AGI_SCALES.md's "Per-scale reading"). */
export function renderAgiRow(row) {
  const lines = [
    `# AGI-scales row — ${row.version ?? "(unversioned)"} (${row.measuredCount}/${row.scales.length} scales read a scalar)`,
    "",
  ];
  for (const s of row.scales) {
    const tag = s.measured ? "**scalar**" : "assessment only";
    lines.push(`- **${s.scale}** — entry rung: ${s.entryRung}. ${tag}: ${s.reading}. Source: ${s.source}.`);
  }
  return lines.join("\n");
}

async function fileExists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function readJsonIfPresent(path) {
  if (!path || !(await fileExists(path))) return null;
  try { return JSON.parse(await readFile(path, "utf8")); } catch { return null; }
}

function parseArgs(argv) {
  return parseFlags(argv, {
    defaults: { agentbench: join(ROOT, "agentbench", "envelope.json") },
    flags: {
      "--agentbench": { key: "agentbench" },
      "--out": { key: "out" },
    },
  });
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const agentbench = await readJsonIfPresent(args.agentbench);
  let version = null;
  try { version = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8")).version; } catch { /* unversioned */ }

  const row = buildAgiRow({ agentbench, version });
  const json = JSON.stringify(row, null, 2) + "\n";
  if (args.out) {
    await writeFile(args.out, json);
    console.log(`AGI-scales row written to ${args.out} (${row.measuredCount}/${row.scales.length} scalar).`);
  } else {
    process.stdout.write(json);
  }
  console.error(renderAgiRow(row));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
