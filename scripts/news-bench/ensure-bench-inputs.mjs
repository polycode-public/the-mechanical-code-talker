#!/usr/bin/env node
// scripts/news-bench/ensure-bench-inputs.mjs — the four gitignored build
// artifacts a news-bench run needs (worlds pack, sprite facts, ask bundle,
// chat seed), built only when missing or stale (their committed generator
// inputs are newer than what's on disk). A fresh worktree pays for all four
// from scratch once; every run after that is a no-op stat check.
//
// --from <path> copies each artifact from another checkout's already-built
// copy instead of regenerating it — the coordinator hands a worktree the
// main checkout's path so its setup drops from minutes to seconds. An
// artifact --from doesn't have (or that's itself missing there) falls back
// to building it locally, same as running with no --from at all.
//
// A copy, always — never a hard link. The staleness check below is a plain
// mtime comparison against this worktree's OWN committed sources, and a
// fresh worktree checkout stamps every one of those "now"; a hard-linked
// artifact would keep the SOURCE checkout's (older) build time and read as
// stale on the very next check, rebuilding for no reason. Copying and then
// stamping the copy's own mtime to "now" makes the sync itself the thing
// that establishes freshness, independent of when the --from checkout last
// built it.
//
//   node scripts/news-bench/ensure-bench-inputs.mjs
//   node scripts/news-bench/ensure-bench-inputs.mjs --from /path/to/main/checkout
import {
  existsSync, statSync, readdirSync, mkdirSync, copyFileSync, utimesSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function newestMtimeMs(paths) {
  let newest = 0;
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const stat = statSync(path);
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path)) newest = Math.max(newest, newestMtimeMs([join(path, entry)]));
    } else {
      newest = Math.max(newest, stat.mtimeMs);
    }
  }
  return newest;
}

function copyPath(from, to) {
  const stat = statSync(from);
  if (stat.isDirectory()) {
    mkdirSync(to, { recursive: true });
    for (const entry of readdirSync(from)) copyPath(join(from, entry), join(to, entry));
    return;
  }
  mkdirSync(dirname(to), { recursive: true });
  copyFileSync(from, to);
}

function stampFreshNow(path) {
  const now = new Date();
  const stat = statSync(path);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path)) stampFreshNow(join(path, entry));
    return;
  }
  utimesSync(path, now, now);
}

/** One artifact: `targets` are the absolute paths that must all exist for it
 *  to count as present; `freshnessTarget` is the one target whose mtime is
 *  compared against `sources`' newest mtime to decide staleness;
 *  `sources` are the committed inputs a rebuild would read; `build` runs the
 *  real generator. */
const ARTIFACTS = [
  {
    name: "worlds pack",
    targets: [
      join(ROOT, "corpus", "worlds", "manifest.json"),
      join(ROOT, "corpus", "worlds", "index.json.gz"),
      join(ROOT, "corpus", "worlds", "shards"),
    ],
    freshnessTarget: join(ROOT, "corpus", "worlds", "manifest.json"),
    sources: [join(ROOT, "corpus", "worlds", "src")],
    build: () => execFileSync("node", ["scripts/ensure-worlds-pack.mjs"], { cwd: ROOT, stdio: "inherit" }),
  },
  {
    name: "sprite facts",
    targets: [join(ROOT, "corpus", "sprites", "src", "sprite-facts.jsonl")],
    freshnessTarget: join(ROOT, "corpus", "sprites", "src", "sprite-facts.jsonl"),
    sources: [join(ROOT, "data", "sprites"), join(ROOT, "data", "sprites-large")],
    build: () => execFileSync("node", ["scripts/ensure-sprite-facts.mjs"], { cwd: ROOT, stdio: "inherit" }),
  },
  {
    name: "ask bundle",
    targets: [join(ROOT, "src", "surfaces", "web", "memory-ask-browser.bundle.js")],
    freshnessTarget: join(ROOT, "src", "surfaces", "web", "memory-ask-browser.bundle.js"),
    // The bundle links nearly all of chat.mjs's own import graph (see the
    // builder's own doc comment) — a conservative "any .mjs under src/
    // changed" staleness check costs a few hundred stat calls and never
    // under-detects, which matters more here than the cheap over-rebuild it
    // occasionally causes for an unrelated src/ edit.
    sources: [join(ROOT, "src")],
    sourceExtensions: [".mjs"],
    excludeFromSources: [join(ROOT, "src", "surfaces", "web", "memory-ask-browser.bundle.js")],
    build: () => execFileSync("node", ["scripts/build-ask-bundle.mjs"], { cwd: ROOT, stdio: "inherit" }),
  },
  {
    name: "chat seed",
    targets: [join(ROOT, "public", "chat-seed.json")],
    freshnessTarget: join(ROOT, "public", "chat-seed.json"),
    sources: [
      join(ROOT, "scripts", "build-chat-seed.mjs"),
      join(ROOT, "package.json"),
      join(ROOT, "src", "services", "extensions.mjs"),
      join(ROOT, "src", "adapters", "corpus"),
      join(ROOT, "corpus"),
    ],
    // The other three artifacts are themselves gitignored build output that
    // happens to live under corpus/ — not a committed input the chat-seed
    // generator was told to react to, so a fresh worlds-pack/sprite-facts
    // build must never itself count as "chat seed went stale".
    excludeFromSources: [
      join(ROOT, "corpus", "worlds", "manifest.json"),
      join(ROOT, "corpus", "worlds", "index.json.gz"),
      join(ROOT, "corpus", "worlds", "shards"),
      join(ROOT, "corpus", "sprites", "src", "sprite-facts.jsonl"),
    ],
    build: () => execFileSync("node", ["scripts/build-chat-seed.mjs"], { cwd: ROOT, stdio: "inherit" }),
  },
];

function collectSourceFiles(root, { extensions = null, exclude = [] } = {}) {
  if (exclude.some((ex) => root === ex)) return [];
  if (!existsSync(root)) return [];
  const stat = statSync(root);
  if (!stat.isDirectory()) return extensions && !extensions.some((ext) => root.endsWith(ext)) ? [] : [root];
  const out = [];
  for (const entry of readdirSync(root)) out.push(...collectSourceFiles(join(root, entry), { extensions, exclude }));
  return out;
}

function isStale(artifact) {
  if (!artifact.targets.every(existsSync)) return true;
  const sourceFiles = artifact.sources.flatMap((root) => collectSourceFiles(root, {
    extensions: artifact.sourceExtensions ?? null,
    exclude: artifact.excludeFromSources ?? [],
  }));
  return newestMtimeMs(sourceFiles) > statSync(artifact.freshnessTarget).mtimeMs;
}

function copyFromRoot(artifact, fromRoot) {
  const fromPaths = artifact.targets.map((target) => join(fromRoot, relative(ROOT, target)));
  if (!fromPaths.every(existsSync)) return false;
  for (let i = 0; i < artifact.targets.length; i += 1) {
    copyPath(fromPaths[i], artifact.targets[i]);
    stampFreshNow(artifact.targets[i]);
  }
  return true;
}

export async function ensureBenchInputs({ from = null } = {}) {
  const results = [];
  for (const artifact of ARTIFACTS) {
    if (!isStale(artifact)) {
      results.push({ name: artifact.name, action: "up to date" });
      continue;
    }
    if (from && copyFromRoot(artifact, from)) {
      results.push({ name: artifact.name, action: `copied from ${from}` });
      continue;
    }
    artifact.build();
    results.push({ name: artifact.name, action: "built" });
  }
  return results;
}

function parseArgs(argv) {
  const out = { from: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--from") out.from = argv[i + 1] ?? null;
    else if (arg.startsWith("--from=")) out.from = arg.slice("--from=".length);
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const from = args.from ? resolve(process.cwd(), args.from) : null;
  if (from && !existsSync(from)) throw new Error(`ensure-bench-inputs: --from path does not exist: ${from}`);
  const results = await ensureBenchInputs({ from });
  for (const r of results) process.stdout.write(`${r.name}: ${r.action}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((err) => {
    console.error(`news-bench: ensure-bench-inputs failed: ${err?.stack ?? err}`);
    process.exitCode = 1;
  });
}
