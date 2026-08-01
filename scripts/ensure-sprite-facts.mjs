#!/usr/bin/env node
// scripts/ensure-sprite-facts.mjs — build corpus/sprites/src/sprite-facts.jsonl
// once if it isn't there yet, then get out of the way. It's gitignored build
// output (scripts/gen-sprite-facts.mjs), not committed, and was the ONLY
// tracked path anywhere under corpus/sprites/ — so a fresh clone or worktree
// has no corpus/sprites/ directory at all until this runs once, which breaks
// test/estate/corpus-licences.test.mjs (corpus/LICENSES.json's own entry for
// corpus/sprites/) and test/estate/pack.test.mjs (the real npm pack it does),
// neither of which has anything to do with sprite content itself. Idempotent
// and cheap; near-instant once the file exists.
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_FILE = join(ROOT, "corpus", "sprites", "src", "sprite-facts.jsonl");

if (!existsSync(OUT_FILE)) {
  execFileSync("node", ["scripts/gen-sprite-facts.mjs"], { cwd: ROOT, stdio: "inherit" });
}
