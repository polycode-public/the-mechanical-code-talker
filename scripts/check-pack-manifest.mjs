#!/usr/bin/env node
// Compare the file list `npm pack --dry-run --json` would publish against the
// committed expected manifest (test/estate/pack-manifest.json, sorted paths).
// No stray file ships, no expected file goes missing. The comparison itself is
// src/domain/pack-manifest.mjs; the pipe is the shell's job, so this reads the
// pack JSON off stdin.
//
//   npm pack --dry-run --json | node scripts/check-pack-manifest.mjs
//
// Exits 1 on any difference and prints it; 0 when the lists match. When a
// difference is intentional (a file deliberately added to or removed from the
// package), regenerate the manifest and commit it with the change.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { packedPaths, comparePackManifest } from "../src/domain/pack-manifest.mjs";

export { packedPaths, comparePackManifest };

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MANIFEST_FILE = path.join(REPO_ROOT, "test", "estate", "pack-manifest.json");

async function main() {
  const stdin = fs.readFileSync(0, "utf8");
  const actual = packedPaths(stdin);
  const expected = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
  const { missing, unexpected } = comparePackManifest(actual, expected);
  if (missing.length === 0 && unexpected.length === 0) {
    console.log(`pack contents match the manifest (${actual.length} files).`);
    return 0;
  }
  if (missing.length) {
    console.error(`missing from the pack (${missing.length}) — in the manifest but would not ship:`);
    for (const p of missing) console.error(`  - ${p}`);
  }
  if (unexpected.length) {
    console.error(`unexpected in the pack (${unexpected.length}) — would ship but not in the manifest:`);
    for (const p of unexpected) console.error(`  + ${p}`);
  }
  console.error(`if intentional: regenerate with npm pack --dry-run --json, update ${path.relative(REPO_ROOT, MANIFEST_FILE)}, and commit it with the change.`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main();
}
