// scripts/bench-receipts.mjs — measures query latency and asset size against
// the built demo site and writes test-benchmarks/receipts/receipts.json, the
// committed source the receipts page (PLAN_RECEIPTS.md's R2) renders every
// figure from. Run after `npm run demo:build`; this script never rebuilds
// the site itself.
//
// The graph is loaded through the exact pipeline chat.html's browser session
// uses (src/surfaces/web/chat-browser-entry.mjs's createChatSession): the
// built public/chat-seed.json payload applied to an in-memory store, then
// projected through memoryFactGraphPayload(readFactRows(...)) into the graph
// ask() traverses. No hand-copied fixture graph.
//
// The 100 queries are a fixed list, not sampled at run time: each is "what
// is <term>" over a term drawn from corpus/wordnet/wordnet-xl.jsonl (every
// distinct surface term, taken at a fixed stride across the file so the
// sample spans the alphabet), so re-running this script never changes which
// questions get asked.

import { existsSync, readdirSync, statSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { execFileSync } from "node:child_process";
import { cpus } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { shortCommit } from "../src/domain/version-stamp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const SITE = join(ROOT, "public");
const OUT_PATH = join(ROOT, "test-benchmarks", "receipts", "receipts.json");

const QUERY_TERMS = [
  "a", "adrenalectomy", "aluminum", "anovulation", "arizonan", "auricular vein",
  "bar", "belt", "block", "boy friday", "bur reed", "can", "cat's-ear",
  "change taste", "chromium", "clubhouse", "commute", "cooperation",
  "crape fern", "cyanuric acid", "defense information systems agency",
  "dicer", "dog laurel", "earth color", "endive", "europeanize", "falter",
  "finisher", "footwear", "fuse", "ghanian", "grass widower", "halloween",
  "hemosiderosis", "horse chestnut", "hypopigmentation", "individual",
  "iron", "kai apple", "lady", "lemon grass", "lobster worker", "maidenhair",
  "mastoiditis", "mexican sunflower", "mombin", "myasthenia", "neuritis",
  "nurser", "optics", "pain unit", "patriot's day", "phase change",
  "planner", "popcorn ball", "price-to-earnings ratio", "pudendal vein",
  "rambler", "relative humidity", "ribbon", "sacral vein", "scavenger",
  "senatorship", "short's aster", "skullcap", "song", "spokeswoman",
  "stiffening", "sudanese monetary unit", "synchronize", "telepathist",
  "thug", "trade", "truth", "unit", "veal cordon bleu", "vulgarian",
  "westland pine", "wood swallow", "zircon", "annoy", "benefactor",
  "card game", "compass point", "dasyurid marsupial", "dispute", "equine",
  "flexion", "green snake", "image", "lack", "mathematical process",
  "neonate", "payment", "presuppose", "reflection", "scratch", "specify",
  "tact", "unpleasant person",
];

const QUERIES = QUERY_TERMS.map((term) => `what is ${term}`);

async function loadSeededGraph() {
  const seedPath = join(SITE, "chat-seed.json");
  if (!existsSync(seedPath)) {
    throw new Error(`bench-receipts: ${seedPath} is missing — run \`npm run demo:build\` first`);
  }
  const seedPayload = JSON.parse(await readFile(seedPath, "utf8"));

  const { createInMemoryStore, applySeedPayload, readFactRows, loadMemory } =
    await import(join(ROOT, "src", "adapters", "memory", "core.mjs"));
  const { memoryFactGraphPayload } = await import(join(ROOT, "src", "domain", "memory-facts.mjs"));
  const { parseEntities } = await import(join(ROOT, "src", "domain", "codegraph.mjs"));

  const handle = createInMemoryStore();
  applySeedPayload(handle, seedPayload);
  const rows = readFactRows(await loadMemory(handle));
  const graph = parseEntities(memoryFactGraphPayload(rows));

  return { graph, seedPayload, seedPath };
}

function percentile(sortedValues, p) {
  const rank = Math.min(sortedValues.length - 1, Math.ceil((p / 100) * sortedValues.length) - 1);
  return sortedValues[Math.max(0, rank)];
}

function measureLatency(graph, ask) {
  const durations = [];
  for (const query of QUERIES) {
    const start = performance.now();
    ask(graph, query);
    durations.push(performance.now() - start);
  }
  const sorted = [...durations].sort((a, b) => a - b);
  return {
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p99: percentile(sorted, 99),
    max: sorted[sorted.length - 1],
    n: sorted.length,
  };
}

function readPageFigures() {
  const entries = readdirSync(SITE, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".html"))
    .map((e) => e.name)
    .sort();
  return entries.map((name) => {
    const rawPath = join(SITE, name);
    const brPath = `${rawPath}.br`;
    if (!existsSync(brPath)) {
      throw new Error(`bench-receipts: ${brPath} is missing — the demo build's precompression pass must run (TMCT_DEMO_PRECOMPRESS must not be 0)`);
    }
    return {
      slug: name.replace(/\.html$/, ""),
      bytesRaw: statSync(rawPath).size,
      bytesWire: statSync(brPath).size,
    };
  });
}

function resolveCommit() {
  const ciSha = process.env.CI_COMMIT_SHA;
  if (ciSha) return shortCommit(ciSha);
  try {
    const sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    return shortCommit(sha);
  } catch {
    return "";
  }
}

function hostInfo() {
  const list = cpus();
  return { model: list[0]?.model ?? "unknown", cores: list.length };
}

export async function main() {
  const { graph, seedPayload, seedPath } = await loadSeededGraph();
  const { ask } = await import(join(ROOT, "src", "domain", "ask.mjs"));

  const latencyMs = measureLatency(graph, ask);

  const facts = seedPayload.individuals.filter((i) => i.class === "Fact").length;
  const individuals = seedPayload.individuals.length;
  const bytesRaw = statSync(seedPath).size;
  const brPath = `${seedPath}.br`;
  if (!existsSync(brPath)) {
    throw new Error(`bench-receipts: ${brPath} is missing — the demo build's precompression pass must run (TMCT_DEMO_PRECOMPRESS must not be 0)`);
  }
  const bytesBrotli = statSync(brPath).size;

  const receipts = {
    generatedAt: new Date().toISOString(),
    commit: resolveCommit(),
    latencyMs,
    graph: { facts, individuals, bytesRaw, bytesBrotli },
    pages: readPageFigures(),
    host: hostInfo(),
  };

  await mkdir(dirname(OUT_PATH), { recursive: true });
  await writeFile(OUT_PATH, `${JSON.stringify(receipts, null, 2)}\n`);
  console.log(`wrote ${OUT_PATH}`);
  console.log(`  latency: p50=${latencyMs.p50.toFixed(2)}ms p90=${latencyMs.p90.toFixed(2)}ms p99=${latencyMs.p99.toFixed(2)}ms max=${latencyMs.max.toFixed(2)}ms n=${latencyMs.n}`);
  console.log(`  graph: ${facts} facts, ${individuals} individuals, ${(bytesRaw / 1024 / 1024).toFixed(1)} MB raw, ${(bytesBrotli / 1024 / 1024).toFixed(1)} MB brotli`);
  console.log(`  pages: ${receipts.pages.length}`);
  return receipts;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
