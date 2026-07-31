// Build smoke: the two build entry points run end-to-end and their artefacts
// come out present, non-trivially sized, and (for the bundle) syntactically
// valid JS. These are the tripwires for source moves: a module that changes
// home without the build scripts following breaks here, not on deploy.
//
// A full demo:build plus a persona-size-large corpus chain elsewhere in
// e2e/heavy/ are what makes this tier heavy rather than per-push — see
// e2e/heavy's own rules:changes gate in .gitlab-ci.yml and `npm run
// test:e2e:heavy`.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const runNpmScript = (script, env = {}) =>
  execFileSync("npm", ["run", script], {
    cwd: repoRoot, env: { ...process.env, ...env }, encoding: "utf8", timeout: 300_000,
  });

const sizeOf = (rel) => {
  const abs = path.join(repoRoot, rel);
  assert.ok(existsSync(abs), `${rel} exists`);
  return statSync(abs).size;
};

// Read by the ledger-page test below, once demo:build has actually run —
// node runs the tests in one file in order, so this is set by the time it's read.
let demoBuildOutput;

test("demo:build produces the Pages demo artefacts", async () => {
  demoBuildOutput = runNpmScript("demo:build");
  assert.ok(sizeOf("public/demo-graph.json") > 10_000, "demo-graph.json is non-trivial");
  assert.ok(sizeOf("public/ledger.html") > 100_000, "ledger.html carries the inlined bundle");
  for (const engineFile of [
    "public/engine/src/domain/ask.mjs",
    "public/engine/src/domain/interpret/pipeline.mjs",
    "public/engine/src/domain/grammar/lexicon-core.json",
  ]) {
    assert.ok(sizeOf(engineFile) > 0, `${engineFile} was copied`);
  }

  // The shared first-party wink asset: one ESM bundle carrying wink-nlp AND
  // its English model, which is why anything much under ~3.5 MB means the
  // model got dropped.
  assert.ok(sizeOf("public/vendor/wink.js") > 2_000_000, "vendor/wink.js carries the whole wink-nlp + model pair");

  // Precompressed siblings next to every sizable text asset — what GitLab
  // Pages serves as content-encoding when the deployment honours them.
  for (const asset of ["public/vendor/wink.js", "public/chat-seed.json", "public/chat.html"]) {
    const gz = sizeOf(`${asset}.gz`);
    const br = sizeOf(`${asset}.br`);
    assert.ok(gz > 0 && gz < sizeOf(asset), `${asset}.gz exists and is smaller than the original`);
    assert.ok(br > 0 && br < sizeOf(asset), `${asset}.br exists and is smaller than the original`);
  }

  // The service worker, stamped with the shipping version so a release rolls
  // the precache name and evicts the previous release's entries.
  const { version } = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  const sw = await readFile(path.join(repoRoot, "public", "tmct-sw.js"), "utf8");
  assert.ok(sw.includes(`tmct-precache-v${version}`), "tmct-sw.js carries the package version in its cache name");
  assert.match(sw, /vendor\/wink\.js/, "the service worker precaches the wink vendor asset");
});

// The build goes to a temp directory of our own. Other e2e files read the
// committed bundle, and node runs e2e files concurrently, so rebuilding over
// the shared path would have this test racing their reads.
test("build:ask-bundle rebuilds a parseable browser bundle", () => {
  const outDir = mkdtempSync(path.join(tmpdir(), "tmct-ask-bundle-"));
  runNpmScript("build:ask-bundle", { TMCT_ASK_BUNDLE_OUT: outDir });
  const bundle = path.join(outDir, "surfaces", "web", "memory-ask-browser.bundle.js");
  assert.ok(existsSync(bundle), "the bundle was written");
  assert.ok(statSync(bundle).size > 100_000, "the bundle is non-trivially sized");
  // node --check parses without executing — a truncated or mis-stubbed
  // bundle fails here instead of in a visitor's browser.
  execFileSync(process.execPath, ["--check", bundle], { encoding: "utf8" });
});

// The Pages build script's rendered page, in depth: public/ledger.html must
// carry the embedded ledger payload and the inlined memory-ask bundle — the
// page the homepage hero iframes. Reads the output of the demo:build test
// above rather than running scripts/build-demo-site.mjs a second time — both
// tests already ran the same build; the assertions here just look closer at
// what it wrote.
test("build-demo-site writes a public/ledger.html with the ledger payload and a live chat dock", async () => {
  assert.match(demoBuildOutput, /wrote .*ledger\.html \(chat dock enabled\)/);

  const html = await readFile(path.join(repoRoot, "public", "ledger.html"), "utf8");
  // LEDGER embeds as "let" (a post-teach re-render reassigns it wholesale —
  // see ledger-viz.mjs's inline script), not "const" as before this feature.
  const m = /(?:const|let) LEDGER = (.*);/.exec(html);
  assert.ok(m, "the page embeds LEDGER");
  const ledger = JSON.parse(m[1]);
  assert.ok(ledger.rows.length > 0, "the demo payload renders real fact rows");
  assert.ok(ledger.rows.some((r) => r.s === "disk-1" || r.o === "disk-1"), "the hanoi-3 demo facts are present");
  assert.match(html, /no session is open on this page yet/, "the memory-ask bundle is inlined");
  assert.match(html, /id="chatform"/);
  assert.ok(!html.includes("chat unavailable"), "the dock renders enabled, not the disabled note");
  // The live teach-capable bundle is a demo-site-only addition (never shipped
  // by the CLI's own `tmct viz`) — confirm the site build actually offers it.
  assert.match(html, /<script src="\.\/ledger-browser\.bundle\.js">/, "the live teach bundle is linked");
  assert.ok(
    existsSync(path.join(repoRoot, "public", "ledger-browser.bundle.js")),
    "the live teach bundle was actually built alongside the page",
  );
});
