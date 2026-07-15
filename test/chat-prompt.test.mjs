// `tmct chat --prompt "<text>"` — the one-shot surface: each sentence of the
// prompt runs as its own turn (state teaches first, the trigger last) and the
// final turn's answer prints to stdout. Spawned as a real child against a repo
// that imported the scaffolded hanoi-3 definition, so this pins the whole
// worked-example flow an operator runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/tmct.mjs", import.meta.url));
const env = { ...process.env, TMCT_NO_SEED: "1" };
const runCli = (cwd, ...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", cwd, env });

async function repoWithHanoi() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-prompt-"));
  assert.equal(runCli(dir, "init").status, 0);
  const imp = runCli(dir, "import", "--file", ".tmct/imports/games/hanoi-3.txt");
  assert.equal(imp.status, 0, imp.stderr + imp.stdout);
  return dir;
}

test("--prompt: state + goal + 'solve it' answers the 7 optimal moves and exits 0", async () => {
  const dir = await repoWithHanoi();
  try {
    const solve = runCli(dir, "chat", "--plain", "--prompt",
      "disk-1 rests on disk-2. disk-2 rests on disk-3. disk-3 rests on peg-a. the goal is that every disk rests on peg-c. solve it.");
    assert.equal(solve.status, 0, solve.stderr);
    assert.match(solve.stdout, /plan found — 7 moves/);
    assert.match(solve.stdout, /1\. move disk-1 onto peg-c/);
    assert.match(solve.stdout, /7\. move disk-1 onto disk-2/);
    assert.match(solve.stdout, /Goal \(inferred\):/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("--prompt: an unanswerable question still exits 0 with the honest miss", async () => {
  const dir = await repoWithHanoi();
  try {
    const miss = runCli(dir, "chat", "--plain", "--prompt", "what is a zorble");
    assert.equal(miss.status, 0, miss.stderr);
    assert.match(miss.stdout, /I don't know "zorble" yet/, "the honest-miss voice with its teach offer");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
