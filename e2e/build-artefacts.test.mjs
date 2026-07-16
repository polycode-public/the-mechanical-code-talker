// Build smoke: the two build entry points run end-to-end and their artefacts
// come out present, non-trivially sized, and (for the bundle) syntactically
// valid JS. These are the tripwires for source moves: a module that changes
// home without the build scripts following breaks here, not on deploy.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..");
const runNpmScript = (script, env = {}) =>
  execFileSync("npm", ["run", script], {
    cwd: repoRoot, env: { ...process.env, ...env }, encoding: "utf8", timeout: 300_000,
  });

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
    "public/engine/src/domain/ask.mjs",
    "public/engine/src/domain/interpret/pipeline.mjs",
    "public/engine/src/domain/grammar/lexicon-core.json",
  ]) {
    assert.ok(sizeOf(engineFile) > 0, `${engineFile} was copied`);
  }
});

// The build goes to a temp directory of our own. Other e2e files read the
// committed bundle, and node runs e2e files concurrently, so rebuilding over
// the shared path would have this test racing their reads.
test("build:ask-bundle rebuilds a parseable browser bundle", () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "tmct-ask-bundle-"));
  runNpmScript("build:ask-bundle", { TMCT_ASK_BUNDLE_OUT: outDir });
  const bundle = path.join(outDir, "surfaces", "memory-ask-browser.bundle.js");
  assert.ok(existsSync(bundle), "the bundle was written");
  assert.ok(statSync(bundle).size > 100_000, "the bundle is non-trivially sized");
  // node --check parses without executing — a truncated or mis-stubbed
  // bundle fails here instead of in a visitor's browser.
  execFileSync(process.execPath, ["--check", bundle], { encoding: "utf8" });
});

// The Pages build script's rendered page, in depth: public/ledger.html must
// carry the embedded ledger payload and the inlined memory-ask bundle — the
// page the homepage hero iframes. This runs the same script as demo:build
// above; it lives in this file so the two runs (and the build:ask-bundle
// rewrite of the bundle the page inlines) stay sequential — node runs the
// tests in one file in order, but runs separate e2e files concurrently, and
// they all write or read the same repo-level artefacts.
test("build-demo-site writes a public/ledger.html with the ledger payload and a live chat dock", async () => {
  const SCRIPT = path.join(repoRoot, "scripts", "build-demo-site.mjs");
  const res = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8" });
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /wrote .*ledger\.html \(chat dock enabled\)/);

  const html = await readFile(path.join(repoRoot, "public", "ledger.html"), "utf8");
  const m = /const LEDGER = (.*);/.exec(html);
  assert.ok(m, "the page embeds const LEDGER");
  const ledger = JSON.parse(m[1]);
  assert.ok(ledger.rows.length > 0, "the demo payload renders real fact rows");
  assert.ok(ledger.rows.some((r) => r.s === "disk-1" || r.o === "disk-1"), "the hanoi-3 demo facts are present");
  assert.match(html, /tmctMemoryAsk/);
  assert.match(html, /id="chatform"/);
  assert.ok(!html.includes("chat unavailable"), "the dock renders enabled, not the disabled note");
});
