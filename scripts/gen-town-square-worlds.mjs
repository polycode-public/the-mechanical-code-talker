#!/usr/bin/env node
// gen-town-square-worlds.mjs — writes one corpus/worlds/src/<layout>.jsonl per
// shipped town-square layout, the generated (not hand-authored) world sources
// npm run gen:worlds-pack (scripts/build-worlds-pack.mjs) builds into the
// shipped pack, unmodified. The worlds' actual content — the grids, the prop
// tables, the seed taxonomy — is defined once in
// src/domain/town-square-world.mjs; this script only serializes it to disk.
//
//   node scripts/gen-town-square-worlds.mjs
//   npm run gen:worlds-pack   # then builds the shards from these sources
//
// --out <dir> redirects the writes (the estate freshness guard regenerates
// into a temp dir and compares, never touching the tracked files).

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  TOWN_SQUARE_LAYOUTS, WORLD_NAMES, worldFactRows, worldMetaRow, worldRuleRows,
} from "../src/domain/town-square-world.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** The serialized source for one layout: its meta row, every fact row, then
 *  its rule rows — one JSON object per line. Exported so the freshness guard
 *  compares strings without shelling out. */
export function worldSourceText(lay) {
  const rows = [worldMetaRow(lay), ...worldFactRows(lay), ...worldRuleRows(lay)];
  return `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;
}

export function writeTownSquareWorlds(outDir) {
  const written = [];
  for (const name of WORLD_NAMES) {
    const text = worldSourceText(TOWN_SQUARE_LAYOUTS[name]);
    const file = join(outDir, `${name}.jsonl`);
    writeFileSync(file, text);
    written.push({ name, file, rows: text.trimEnd().split("\n").length, bytes: Buffer.byteLength(text) });
  }
  return written;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  const outFlagIndex = process.argv.indexOf("--out");
  const outDir = outFlagIndex !== -1 && process.argv[outFlagIndex + 1]
    ? process.argv[outFlagIndex + 1]
    : join(REPO_ROOT, "corpus", "worlds", "src");
  for (const { name, file, rows, bytes } of writeTownSquareWorlds(outDir)) {
    console.log(`gen-town-square-worlds: ${name} — ${rows} rows, ${bytes} bytes -> ${file}`);
  }
}
