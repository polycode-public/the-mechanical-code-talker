#!/usr/bin/env node
// gen-spider-fly-world.mjs — writes corpus/worlds/src/spider-fly.jsonl, the
// hand-generated (not hand-authored) world source npm run gen:worlds-pack
// (scripts/build-worlds-pack.mjs) builds into the shipped pack, unmodified.
// The world's actual content — the grid, the web block, the seed taxonomy —
// is defined once in src/domain/spider-fly-world.mjs; this script only
// serializes it to disk, the same "generate, don't hand-author" posture
// Hanoi/river-crossing already take for their own board size (PLAN_SPIDER_FLY.md §3).
//
//   node scripts/gen-spider-fly-world.mjs
//   npm run gen:worlds-pack   # then builds the shard from this source
//
// --out <path> redirects the write (the estate freshness guard regenerates
// into a temp dir and compares, never touching the tracked file).

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { WORLD_NAME, worldFactRows, worldMetaRow, worldRuleRows } from "../src/domain/spider-fly-world.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outFlagIndex = process.argv.indexOf("--out");
const OUT_FILE = outFlagIndex !== -1 && process.argv[outFlagIndex + 1]
  ? process.argv[outFlagIndex + 1]
  : join(REPO_ROOT, "corpus", "worlds", "src", `${WORLD_NAME}.jsonl`);

const rows = [worldMetaRow(), ...worldFactRows(), ...worldRuleRows()];
writeFileSync(OUT_FILE, `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`);
console.log(`gen-spider-fly-world: wrote ${rows.length} rows -> ${OUT_FILE}`);
