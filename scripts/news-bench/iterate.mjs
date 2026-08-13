#!/usr/bin/env node
// scripts/news-bench/iterate.mjs — the loop's mechanical front half
// in one command: capture
// today's fixtures, run the bench over the loop's standing measurement (the
// 5 most recent hacker-news articles plus the 5 most recent nyt-world
// articles, single pass, xl seed — the same shape as a news.html press),
// and print the score-table delta against the newest committed report,
// noting when the two aren't directly comparable. Design and apply stay
// with whoever reads this output; this script only polls, measures and
// shares.
//
//   node scripts/news-bench/iterate.mjs --label=<iteration>
import { execFileSync } from "node:child_process";

import {
  runBench, writeReport, newestCommittedReport, provenanceComparable,
} from "./run.mjs";
import { ROOT } from "./fixtures.mjs";

const DEFAULT_SOURCES = ["hacker-news", "nyt-world"];
const DEFAULT_TAKE = 5;

function parseArgs(argv) {
  const out = {
    label: null, sources: DEFAULT_SOURCES, take: DEFAULT_TAKE, seed: "xl",
  };
  for (const arg of argv) {
    if (arg.startsWith("--label=")) out.label = arg.slice("--label=".length);
    else if (arg.startsWith("--sources=")) out.sources = arg.slice("--sources=".length).split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg.startsWith("--take=")) out.take = Number.parseInt(arg.slice("--take=".length), 10);
    else if (arg.startsWith("--seed=")) out.seed = arg.slice("--seed=".length);
  }
  return out;
}

function captureTodaysFixtures(sourceIds) {
  execFileSync(
    "node",
    ["scripts/news-bench/capture-fixtures.mjs", `--sources=${sourceIds.join(",")}`],
    { cwd: ROOT, stdio: "inherit" },
  );
}

// The representative numeric leaves the score-table delta reports — the
// same headline figures each markdown report section already leads with.
const SCORE_FIELDS = [
  ["admission rate", (r) => r.metrics.admissionRate.aggregate.rate, "pct"],
  ["grounded-term proportion", (r) => r.metrics.groundedTermProportion.aggregate.microAverage, "pct"],
  ["de-dupe ratio", (r) => r.metrics.dedupeRatio.ratio, "num"],
  ["entity fact survival", (r) => r.metrics.entityPreservation.factSurvivalRate, "pct"],
  ["entity paragraph survival", (r) => r.metrics.entityPreservation.paragraphSurvivalRate, "pct"],
  ["noisy-hub-relation rate", (r) => r.metrics.noisyHubRelationRate.rate, "pct"],
  ["repeated-sentence rate", (r) => r.metrics.paragraphShape.repeatedSentenceRate, "pct"],
  ["\"Around it\" repeat rate", (r) => r.metrics.paragraphShape.aroundItRepeatRate, "pct"],
  ["ranked-term noise", (r) => r.metrics.rankedTermNoise.rate, "pct"],
  ["feed document bytes", (r) => r.metrics.size.feedDocumentBytes, "num"],
];

function fmt(kind, value) {
  if (typeof value !== "number") return "n/a";
  if (kind === "pct") return `${(value * 100).toFixed(2)}%`;
  return Number.isInteger(value) ? String(value) : value.toFixed(3);
}

function fmtDelta(kind, delta) {
  if (typeof delta !== "number") return "n/a";
  const sign = delta >= 0 ? "+" : "";
  if (kind === "pct") return `${sign}${(delta * 100).toFixed(2)}pp`;
  return `${sign}${Number.isInteger(delta) ? delta : delta.toFixed(3)}`;
}

export function renderScoreTableDelta(current, previous) {
  const lines = ["| metric | previous | current | delta |", "| --- | --: | --: | --: |"];
  for (const [name, get, kind] of SCORE_FIELDS) {
    const currentValue = get(current);
    const previousValue = previous ? get(previous) : null;
    const delta = typeof currentValue === "number" && typeof previousValue === "number"
      ? currentValue - previousValue : null;
    lines.push(`| ${name} | ${fmt(kind, previousValue)} | ${fmt(kind, currentValue)} | ${fmtDelta(kind, delta)} |`);
  }
  return lines.join("\n");
}

export async function iterate({
  label, sources = DEFAULT_SOURCES, take = DEFAULT_TAKE, seed = "xl", skipCapture = false,
} = {}) {
  if (!label) throw new Error("news-bench: iterate needs a --label=<iteration>");
  if (!skipCapture) captureTodaysFixtures(sources);

  const report = await runBench({
    seed, sourceIds: sources, take, doubleIngest: false,
  });
  const runDate = new Date().toISOString().slice(0, 10);
  const paths = writeReport(report, { runDate, label });

  const prev = newestCommittedReport(paths.jsonPath);
  const comparison = prev ? provenanceComparable(report.provenance, prev.report.provenance) : null;
  const table = renderScoreTableDelta(report, prev?.report ?? null);

  return {
    report, paths, previous: prev, comparison, table,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.label) throw new Error("news-bench: iterate.mjs needs --label=<iteration>");
  process.stdout.write(`iterate: capturing today's fixtures for ${args.sources.join(", ")}...\n`);
  process.stdout.write(`iterate: running the bench (seed=${args.seed}, take=${args.take ?? "all"}, single pass)...\n`);
  const { paths, previous, comparison, table } = await iterate(args);
  process.stdout.write(`wrote ${paths.jsonPath}\nwrote ${paths.mdPath}\nwrote ${paths.articlesPath}\n\n`);
  if (!previous) {
    process.stdout.write("no previous committed report to compare against — this is the first.\n\n");
  } else if (!comparison.comparable) {
    process.stdout.write(`provenance: not directly comparable to ${previous.path} — ${comparison.reason}\n\n`);
  }
  process.stdout.write(`${table}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => {
    console.error(`news-bench: iterate failed: ${err?.stack ?? err}`);
    process.exitCode = 1;
  });
}
