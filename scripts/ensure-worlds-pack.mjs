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
//
// It checks freshness, not just existence. A checkout that has already built
// the pack once — the working copy anyone has run a test tier in — would
// otherwise keep serving a stale pack after a new world lands in
// corpus/worlds/src/, and the new world simply wouldn't be there. That reads
// as a lane bug rather than a build one, and it reproduces for nobody with a
// clean clone, so it is exactly the kind of thing to rule out here.
import { existsSync, readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(ROOT, "corpus", "worlds", "manifest.json");
const SOURCE_DIR = join(ROOT, "corpus", "worlds", "src");

function newestSourceMtimeMs() {
  if (!existsSync(SOURCE_DIR)) return 0;
  return readdirSync(SOURCE_DIR)
    .filter((name) => name.endsWith(".jsonl"))
    .reduce((newest, name) => Math.max(newest, statSync(join(SOURCE_DIR, name)).mtimeMs), 0);
}

if (!existsSync(MANIFEST) || statSync(MANIFEST).mtimeMs < newestSourceMtimeMs()) {
  execFileSync("node", ["scripts/build-worlds-pack.mjs"], { cwd: ROOT, stdio: "inherit" });
}
