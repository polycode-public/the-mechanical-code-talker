// Build smoke: the two build entry points run end-to-end and their artefacts
// come out present, non-trivially sized, and (for the bundle) syntactically
// valid JS. These are the tripwires for source moves: a module that changes
// home without the build scripts following breaks here, not on deploy.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const runNpmScript = (script) =>
  execFileSync("npm", ["run", script], { cwd: repoRoot, encoding: "utf8", timeout: 300_000 });

const sizeOf = (rel) => {
  const abs = path.join(repoRoot, rel);
  assert.ok(existsSync(abs), `${rel} exists`);
  return statSync(abs).size;
};

test("demo:build produces the Pages demo artefacts", () => {
  runNpmScript("demo:build");
  assert.ok(sizeOf("public/demo-graph.json") > 10_000, "demo-graph.json is non-trivial");
  assert.ok(sizeOf("public/ledger.html") > 100_000, "ledger.html carries the inlined bundle");
  for (const engineFile of [
    "public/engine/src/ask.mjs",
    "public/engine/src/interpret/pipeline.mjs",
    "public/engine/src/grammar/lexicon-core.json",
  ]) {
    assert.ok(sizeOf(engineFile) > 0, `${engineFile} was copied`);
  }
});

test("build:ask-bundle rebuilds a parseable browser bundle", () => {
  runNpmScript("build:ask-bundle");
  const bundle = "src/memory-ask-browser.bundle.js";
  assert.ok(sizeOf(bundle) > 100_000, "the bundle is non-trivially sized");
  // node --check parses without executing — a truncated or mis-stubbed
  // bundle fails here instead of in a visitor's browser.
  execFileSync(process.execPath, ["--check", path.join(repoRoot, bundle)], { encoding: "utf8" });
});
