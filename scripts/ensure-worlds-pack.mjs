#!/usr/bin/env node
// scripts/ensure-worlds-pack.mjs — build the worlds pack once if it isn't
// there yet, then get out of the way. corpus/worlds/{index.json.gz,
// manifest.json,shards/} are gitignored build output (scripts/build-
// worlds-pack.mjs), not committed, but the games/adventure and
// games/spider-fly chat lanes read the real pack at runtime — including in
// test:fast's sampled row and test:unit's full lane files. A fresh clone, a
// fresh sub-agent worktree, or `npm ci` alone would otherwise fail those
// lanes with an honest "no worlds pack here" miss instead of the world's real
// opening line, for a reason that has nothing to do with whatever the test
// run is actually checking. Idempotent and cheap (~140ms) when it does have
// to build; near-instant once corpus/worlds/manifest.json exists.
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, "corpus", "worlds", "manifest.json");

if (!existsSync(MANIFEST)) {
  execFileSync("node", ["scripts/build-worlds-pack.mjs"], { cwd: ROOT, stdio: "inherit" });
}
