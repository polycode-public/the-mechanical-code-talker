#!/usr/bin/env node
// Prints every test/**/*.test.mjs path except the five whose own tests cross
// 20s (test:slow's list, kept in sync with this one by hand — both are short
// and reviewed together). CI splits the `unit` job on this output so a push
// isn't gated on synthbench/generated-artifacts/readme/bench-smoke/inference
// wall-clock.
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(fileURLToPath(import.meta.url), "..", "..");

const SLOW_TEST_FILES = new Set([
  "test/bench/synthbench-code.test.mjs",
  "test/estate/generated-artifacts.test.mjs",
  "test/readme/readme.test.mjs",
  "test/corpus/bench-smoke.test.mjs",
  "test/corpus/inference.test.mjs",
]);

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (entry.name.endsWith(".test.mjs")) files.push(full);
  }
  return files;
}

const all = walk(join(REPO, "test")).map((f) => relative(REPO, f)).sort();
const kept = all.filter((f) => !SLOW_TEST_FILES.has(f));
process.stdout.write(kept.join(" "));
