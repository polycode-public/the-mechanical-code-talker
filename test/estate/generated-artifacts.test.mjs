// The repo commits build outputs and then ships them: `npm publish` packs the
// committed file, and the Pages job inlines it into the deployed ledger page
// without rebuilding. So a committed artifact that has fallen behind its source
// is what real users get, and nothing else notices — the bundle's own e2e tests
// pass on a stale build, because a stale build still exists, still evaluates and
// still answers. This rebuilds and compares.
//
// Rebuilding into a temp dir keeps the tracked file untouched, so a failure here
// reports drift rather than quietly papering over it, and names the command that
// fixes it.
//
// Only mechanically-generated files belong here. The other committed JSON under
// src/ (answer-variants.json, grammar/lexicon-core.json) is hand-curated — its
// scripts audit or add to it and cannot reproduce it, so there is nothing to
// compare against and no guard to write.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const sha = (buf) => createHash("sha256").update(buf).digest("hex");

// The ACE variants generator reads Open English WordNet from a checkout outside
// this repo (scripts/lib/wordnet-synonyms.mjs, TMCT_WORDNET_SRC or the default
// below). Where that checkout is absent the generator cannot run at all, so
// there is no "today's output" to compare the committed artifact against and
// the drift guard has nothing to say — it is skipped rather than failed, which
// is the difference between "this artifact is stale" and "this machine can't
// regenerate it". The guard keeps its teeth wherever WordNet is present, which
// is the same machine the artifact is regenerated and committed on.
const wordnetYamlDir = path.join(
  process.env.TMCT_WORDNET_SRC || path.join(homedir(), "projects", "globalwordnet", "english-wordnet"),
  "src",
  "yaml",
);
const missingWordnet = existsSync(wordnetYamlDir)
  ? false
  : `Open English WordNet not found at ${wordnetYamlDir} — the variants generator can't run here. `
    + "Set TMCT_WORDNET_SRC to a checkout to enable this drift guard.";

test("the committed ask bundle is what its source builds today", () => {
  const rel = "surfaces/web/memory-ask-browser.bundle.js";
  const committed = path.join(repoRoot, "src", rel);
  const out = mkdtempSync(path.join(tmpdir(), "tmct-bundle-freshness-"));
  try {
    execFileSync("node", [path.join(repoRoot, "scripts", "build-ask-bundle.mjs")], {
      cwd: repoRoot,
      env: { ...process.env, TMCT_ASK_BUNDLE_OUT: out },
      stdio: "pipe",
    });
    assert.equal(
      sha(readFileSync(path.join(out, rel))),
      sha(readFileSync(committed)),
      `src/${rel} has drifted from its source — run \`npm run build:ask-bundle\` and commit the result.\n`
        + "It is packed by npm publish and inlined into the deployed ledger page as-is, so a stale "
        + "commit ships stale code to real users.",
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("the committed real-word collision table is what its generator produces today", () => {
  const rel = "domain/real-word-collisions.json";
  const out = mkdtempSync(path.join(tmpdir(), "tmct-collisions-freshness-"));
  try {
    execFileSync("node", [
      path.join(repoRoot, "scripts", "generate-real-word-collisions.mjs"),
      "--out", path.join(out, "real-word-collisions.json"),
    ], { cwd: repoRoot, stdio: "pipe" });
    assert.equal(
      sha(readFileSync(path.join(out, "real-word-collisions.json"))),
      sha(readFileSync(path.join(repoRoot, "src", rel))),
      `src/${rel} has drifted from its generator — run \`node scripts/generate-real-word-collisions.mjs\` `
        + "and commit the result.\nThe table is the fuzzy repair tier's precision gate: it lists the real "
        + "English words the tier would otherwise rewrite onto a graph verb. Add a verb to the vocabulary and "
        + "the table it attracts changes, so a stale commit silently repairs real words again.",
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

// The INFBENCH ladder is drawn from the lexicon at a fixed seed, so it is a
// function of the lexicon, not a hand-written corpus: add one word and all 219
// cases redraw at the same seed. `npm run infbench` regenerates before it runs,
// which means a drifted commit is never what the bench actually measured — the
// numbers in a write-up would describe cases nobody can read back. A redraw is
// legitimate; this makes it announce itself instead of arriving as a surprise
// diff underneath a benchmark result.
test("the committed infbench cases are what their generator produces today", () => {
  const out = mkdtempSync(path.join(tmpdir(), "tmct-infbench-cases-freshness-"));
  try {
    execFileSync("node", [
      path.join(repoRoot, "test-benchmarks", "infbench", "generate-cases.mjs"),
      "--out", path.join(out, "cases.jsonl"),
    ], { cwd: repoRoot, stdio: "pipe" });
    assert.equal(
      sha(readFileSync(path.join(out, "cases.jsonl"))),
      sha(readFileSync(path.join(repoRoot, "test-benchmarks", "infbench", "cases.jsonl"))),
      "test-benchmarks/infbench/cases.jsonl has drifted from its generator — run `node test-benchmarks/infbench/generate-cases.mjs` and "
        + "commit the result.\nThe ladder is drawn from src/domain/grammar/lexicon-core.json at DEFAULT_SEED, "
        + "so a lexicon change redraws every case. `npm run infbench` regenerates before it runs, so a stale "
        + "commit is not the case set the last run graded.",
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

// The envelope is the only artifact here that stamps the package version into
// its own body (generatedFrom.agentbenchVersion/stamp both come from
// BENCH_VERSION, which test-benchmarks/agentbench/run.mjs reads out of package.json). So a
// version bump alone drifts it, with no AGENTBENCH change at all — and it drifts
// in the direction that matters, because the envelope exists for a downstream
// calibration to check itself against and a stale stamp tells that consumer it
// is reading a measurement of a release it is not.
test("the committed agentbench envelope is what its generator produces today", () => {
  const out = mkdtempSync(path.join(tmpdir(), "tmct-envelope-freshness-"));
  try {
    execFileSync("node", [
      path.join(repoRoot, "test-benchmarks", "agentbench", "generate-envelope.mjs"),
      "--out", path.join(out, "envelope.json"),
    ], { cwd: repoRoot, stdio: "pipe" });
    assert.equal(
      sha(readFileSync(path.join(out, "envelope.json"))),
      sha(readFileSync(path.join(repoRoot, "test-benchmarks", "agentbench", "envelope.json"))),
      "test-benchmarks/agentbench/envelope.json has drifted from its generator — run `node test-benchmarks/agentbench/generate-envelope.mjs` "
        + "and commit the result.\nIt reports the capability a gate-PASS run proves, stamped with the package "
        + "version, so a stale commit hands a downstream calibration the wrong release's measurement.",
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("the committed agentbench envelope stamps the version the package ships", () => {
  const envelope = JSON.parse(readFileSync(path.join(repoRoot, "test-benchmarks", "agentbench", "envelope.json"), "utf8"));
  const { version } = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  assert.equal(envelope.generatedFrom.agentbenchVersion, version);
  assert.equal(envelope.generatedFrom.stamp, version);
});

// Same drift risk as the agentbench envelope above, and the same fix: INFBENCH
// drives every case through a real runChat transcript, so this is slower than
// the other guards here but still a pure re-run over the committed cases file.
test("the committed infbench envelope is what its generator produces today", () => {
  const out = mkdtempSync(path.join(tmpdir(), "tmct-infbench-envelope-freshness-"));
  try {
    execFileSync("node", [
      path.join(repoRoot, "test-benchmarks", "infbench", "generate-envelope.mjs"),
      "--out", path.join(out, "envelope.json"),
    ], { cwd: repoRoot, stdio: "pipe" });
    assert.equal(
      sha(readFileSync(path.join(out, "envelope.json"))),
      sha(readFileSync(path.join(repoRoot, "test-benchmarks", "infbench", "envelope.json"))),
      "test-benchmarks/infbench/envelope.json has drifted from its generator — run `node test-benchmarks/infbench/generate-envelope.mjs` "
        + "and commit the result.\nIt reports the capability the latest INFBENCH run proves for both the kernel "
        + "and chat arms, stamped with the package version, so a stale commit hands a downstream reader the "
        + "wrong release's measurement.",
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("the committed infbench envelope stamps the version the package ships", () => {
  const envelope = JSON.parse(readFileSync(path.join(repoRoot, "test-benchmarks", "infbench", "envelope.json"), "utf8"));
  const { version } = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  assert.equal(envelope.generatedFrom.infbenchVersion, version);
  assert.equal(envelope.generatedFrom.stamp, version);
});

// The sprite-facts corpus is a function of data/sprites/ and
// data/sprites-large/: add a template, a parameter or a material value and
// the rows change. The committed file is what sprites.html's chat dock is
// seeded from at build time, so a stale commit answers catalog questions
// from templates that no longer exist.
test("the committed sprite-facts corpus is what its generator produces today", () => {
  const out = mkdtempSync(path.join(tmpdir(), "tmct-sprite-facts-freshness-"));
  try {
    execFileSync("node", [
      path.join(repoRoot, "scripts", "gen-sprite-facts.mjs"),
      "--out", path.join(out, "sprite-facts.jsonl"),
    ], { cwd: repoRoot, stdio: "pipe" });
    assert.equal(
      sha(readFileSync(path.join(out, "sprite-facts.jsonl"))),
      sha(readFileSync(path.join(repoRoot, "corpus", "sprites", "src", "sprite-facts.jsonl"))),
      "corpus/sprites/src/sprite-facts.jsonl has drifted from data/sprites*/ — run "
        + "`node scripts/gen-sprite-facts.mjs` and commit the result.",
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("the committed ACE surface variants are what their generator produces today", { skip: missingWordnet }, () => {
  const out = mkdtempSync(path.join(tmpdir(), "tmct-variants-freshness-"));
  try {
    execFileSync("node", [
      path.join(repoRoot, "scripts", "generate-template-variants.mjs"),
      "--out", path.join(out, "ace-surface-variants.jsonl"),
    ], { cwd: repoRoot, stdio: "pipe" });
    // The generator writes its manifest beside whatever --out names, so both land here.
    for (const name of ["ace-surface-variants.jsonl", "manifest.json"]) {
      assert.equal(
        sha(readFileSync(path.join(out, name))),
        sha(readFileSync(path.join(repoRoot, "corpus", "generated", name))),
        `corpus/generated/${name} has drifted from its generator — run `
          + "`node scripts/generate-template-variants.mjs` and commit the result.",
      );
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

// The spider-fly world source is generated (never hand-edited): its rows come
// from src/domain/spider-fly-world.mjs's own constants and the shipped
// game-config defaults, so a knob change that skips regeneration would ship a
// board whose askable facts quote numbers the engine no longer runs.
test("the committed spider-fly world source is what its generator produces today", () => {
  const out = mkdtempSync(path.join(tmpdir(), "tmct-spider-fly-world-freshness-"));
  try {
    execFileSync("node", [
      path.join(repoRoot, "scripts", "gen-spider-fly-world.mjs"),
      "--out", path.join(out, "spider-fly.jsonl"),
    ], { cwd: repoRoot, stdio: "pipe" });
    assert.equal(
      sha(readFileSync(path.join(out, "spider-fly.jsonl"))),
      sha(readFileSync(path.join(repoRoot, "corpus", "worlds", "src", "spider-fly.jsonl"))),
      "corpus/worlds/src/spider-fly.jsonl has drifted from spider-fly-world.mjs — run "
        + "`node scripts/gen-spider-fly-world.mjs && npm run gen:worlds-pack` and commit the result.",
    );
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

// The shipped worlds-pack shards are gzipped copies of the src files; a src
// edit that skips `npm run gen:worlds-pack` would leave the CLI loading a
// board the src no longer describes.
test("each committed worlds-pack shard decompresses to exactly its committed src file", async () => {
  const { gunzipSync } = await import("node:zlib");
  const srcDir = path.join(repoRoot, "corpus", "worlds", "src");
  const { readdirSync } = await import("node:fs");
  const worlds = readdirSync(srcDir).filter((f) => f.endsWith(".jsonl"));
  assert.ok(worlds.length >= 2, "the pack ships at least the two known worlds");
  for (const file of worlds) {
    const shard = path.join(repoRoot, "corpus", "worlds", "shards", `${file}.gz`);
    assert.equal(
      gunzipSync(readFileSync(shard)).toString("utf8"),
      readFileSync(path.join(srcDir, file), "utf8"),
      `corpus/worlds/shards/${file}.gz has drifted from src/${file} — run \`npm run gen:worlds-pack\` and commit the result.`,
    );
  }
});
