// The river-crossing domain (wolf/goat/cabbage): a taught game whose rules
// need two families beyond hanoi/crates — a co-travel effect (the farmer
// rides every crossing) and the "may not be with … without …" co-location
// constraint. The classic optimum is 7 crossings, and from the pinned opening
// position exactly one move is legal (ferry the goat) — every other crossing
// leaves a forbidden pair alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TMCT_BIN as BIN } from "./helpers/cli-bin.mjs";

const env = { ...process.env, TMCT_NO_SEED: "1" };
const runCli = (cwd, ...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", cwd, env });

const STATE =
  "wolf-1 stands on bank-east. goat-1 stands on bank-east. " +
  "cabbage-1 stands on bank-east. farmer-1 stands on bank-east. ";

test("river.txt scaffolds, imports clean, and the constraint prunes the opening to one legal move", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-river-"));
  try {
    assert.equal(runCli(dir, "init").status, 0);
    const shipped = await readFile(join(dir, ".tmct", "imports", "games", "river.txt"), "utf8");
    assert.match(shipped, /may not be with the goat without the farmer\./);
    assert.match(shipped, /makes the farmer stand on the target\./);

    const imp = runCli(dir, "import", "--file", ".tmct/imports/games/river.txt");
    assert.equal(imp.status, 0, imp.stderr + imp.stdout);
    assert.match(imp.stdout, /0 declined/);

    const legal = runCli(dir, "chat", "--plain", "--prompt", STATE + "what moves are legal now?");
    assert.equal(legal.status, 0, legal.stderr);
    assert.match(legal.stdout, /1 legal move from here:/);
    assert.match(legal.stdout, /1\. ferry goat-1 onto bank-west/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("river solves at the classic 7-crossing optimum, goat first and goat last", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-river-solve-"));
  try {
    assert.equal(runCli(dir, "init").status, 0);
    const imp = runCli(dir, "import", "--file", ".tmct/imports/games/river.txt");
    assert.equal(imp.status, 0, imp.stderr + imp.stdout);
    assert.match(imp.stdout, /0 declined/);

    const solve = runCli(dir, "chat", "--plain", "--prompt",
      STATE + "the goal is that every passenger stands on bank-west. solve it.");
    assert.equal(solve.status, 0, solve.stderr);
    assert.match(solve.stdout, /plan found — 7 moves \(shortest\)/);
    assert.match(solve.stdout, /1\. ferry goat-1 onto bank-west/);
    assert.match(solve.stdout, /7\. ferry goat-1 onto bank-west/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
