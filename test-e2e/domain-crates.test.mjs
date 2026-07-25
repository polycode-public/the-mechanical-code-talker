// The crates domain: a second taught game solved with zero interpreter
// changes — no comparator anywhere, and the goal is a two-sentence
// conjunction. Optimal is 2 moves for the pinned start (crate-a is buried
// under crate-c, so move one must clear it; hand-verified: no 1-move
// solution satisfies both goals).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/tmct.mjs", import.meta.url));
const env = { ...process.env, TMCT_NO_SEED: "1" };
const runCli = (cwd, ...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", cwd, env });

test("crates.txt scaffolds, imports clean, and a multi-goal conjunction solves at the pinned optimum", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-crates-"));
  try {
    assert.equal(runCli(dir, "init").status, 0);
    const shipped = await readFile(join(dir, ".tmct", "imports", "games", "crates.txt"), "utf8");
    assert.match(shipped, /you can stack a crate onto a pallet\./);
    assert.doesNotMatch(shipped, /smaller than/);

    const imp = runCli(dir, "import", "--file", ".tmct/imports/games/crates.txt");
    assert.equal(imp.status, 0, imp.stderr + imp.stdout);
    assert.match(imp.stdout, /0 declined/);

    const solve = runCli(dir, "chat", "--plain", "--prompt",
      "crate-c rests on crate-a. crate-a rests on pallet-1. crate-b rests on pallet-2. " +
      "the goal is that crate-a rests on crate-b. the goal is that crate-b rests on pallet-2. solve it.");
    assert.equal(solve.status, 0, solve.stderr);
    assert.match(solve.stdout, /plan found — 2 moves/);
    assert.match(solve.stdout, /1\. stack crate-/);
    assert.match(solve.stdout, /2\. stack crate-a onto /);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
