// The generated world sources under corpus/worlds/src/ are committed, and the
// modules they are generated from are not the same file. So a knob moved in
// game-config.mjs, a prop moved in a layout table, or a taxonomy edit lands in
// the engine immediately and in the shipped world only when somebody remembers
// to re-run the generator. Until then the pack ships a world that lies about
// itself: "the goblin has a vision radius of 3 cells by default" against an
// engine running 4.
//
// This guard regenerates each source into a temp directory and diffs. It never
// writes to the tracked file — both generators take --out for exactly this.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WORLD_NAMES } from "../../src/domain/town-square-world.mjs";
import { WORLD_NAME as SPIDER_FLY_WORLD } from "../../src/domain/spider-fly-world.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const SRC_DIR = path.join(REPO_ROOT, "corpus", "worlds", "src");

const committed = (world) => readFileSync(path.join(SRC_DIR, `${world}.jsonl`), "utf8");

function regenerate(script, args) {
  const out = mkdtempSync(path.join(tmpdir(), "tmct-world-fresh-"));
  try {
    execFileSync("node", [path.join("scripts", script), ...args(out)], { cwd: REPO_ROOT, stdio: "pipe" });
    return { dir: out, read: (world) => readFileSync(path.join(out, `${world}.jsonl`), "utf8") };
  } finally {
    process.on("exit", () => rmSync(out, { recursive: true, force: true }));
  }
}

test("the committed spider-fly world source is what its generator produces today", () => {
  const world = SPIDER_FLY_WORLD;
  const fresh = regenerate("gen-spider-fly-world.mjs", (out) => ["--out", path.join(out, `${world}.jsonl`)]);
  assert.equal(
    fresh.read(world),
    committed(world),
    `corpus/worlds/src/${world}.jsonl is stale — run \`node scripts/gen-spider-fly-world.mjs && npm run gen:worlds-pack\` and commit the source`,
  );
});

test("every committed town-square world source is what its generator produces today", () => {
  const fresh = regenerate("gen-town-square-worlds.mjs", (out) => ["--out", out]);
  for (const world of WORLD_NAMES) {
    assert.equal(
      fresh.read(world),
      committed(world),
      `corpus/worlds/src/${world}.jsonl is stale — run \`node scripts/gen-town-square-worlds.mjs && npm run gen:worlds-pack\` and commit the source`,
    );
  }
});
