#!/usr/bin/env node
// Two checks over the file list `npm pack --dry-run --json` would publish.
// First, it matches the committed expected manifest (test/estate/
// pack-manifest.json, sorted paths): no stray file ships, no expected file goes
// missing. Second, every import the packed tree reaches lands on another packed
// file, so the tarball actually loads in a consumer's install. The comparison
// and the walk both live in src/domain/pack-manifest.mjs; the pipe is the
// shell's job, so this reads the pack JSON off stdin.
//
//   npm pack --dry-run --json | node scripts/check-pack-manifest.mjs
//
// Exits 1 on any difference and prints it; 0 when both checks pass. When a
// file-list difference is intentional (a file deliberately added to or removed
// from the package), regenerate the manifest and commit it with the change.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { packedPaths, comparePackManifest, unshippedImports, packageEntryPaths } from "../src/domain/pack-manifest.mjs";

export { packedPaths, comparePackManifest };

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const MANIFEST_FILE = path.join(REPO_ROOT, "test", "estate", "pack-manifest.json");

/** Print every import the packed tree reaches that would not be in the tarball.
 *  Returns the number found. */
function reportUnshippedImports(actual) {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  const broken = unshippedImports({
    packedPaths: actual,
    entryPaths: packageEntryPaths(pkg),
    readSource: (rel) => {
      try {
        return fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
      } catch {
        return null;
      }
    },
  });
  if (broken.length === 0) return 0;
  console.error(`imports that would not resolve in the tarball (${broken.length}):`);
  for (const { from, specifier, target } of broken) console.error(`  ${from} imports ${specifier} -> ${target}, which does not ship`);
  console.error("ship the target (drop its ! entry from package.json files), or stop importing it from a shipped module.");
  return broken.length;
}

async function main() {
  const stdin = fs.readFileSync(0, "utf8");
  const actual = packedPaths(stdin);
  const expected = JSON.parse(fs.readFileSync(MANIFEST_FILE, "utf8"));
  const { missing, unexpected } = comparePackManifest(actual, expected);
  const unresolvable = reportUnshippedImports(actual);
  if (missing.length === 0 && unexpected.length === 0) {
    if (unresolvable > 0) return 1;
    console.log(`pack contents match the manifest (${actual.length} files), and every import in the shipped tree resolves.`);
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
