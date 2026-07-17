// `tmct import --file` + the `tmct init` importable-starters scaffold: a fresh
// repo can teach itself the shipped hanoi-3 game definition and any declined
// sentence fails the import loudly (exit 1, sentence named). Spawned as a real
// child so the whole flag path, report, and exit code are what an operator sees.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const BIN = fileURLToPath(new URL("../bin/tmct.mjs", import.meta.url));
const env = { ...process.env, TMCT_NO_SEED: "1" };
const runCli = (cwd, ...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", cwd, env });

test("init scaffolds .tmct/imports and import --file teaches every hanoi-3 sentence (exit 0)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-import-file-"));
  try {
    const init = runCli(dir, "init");
    assert.equal(init.status, 0, init.stderr);
    await access(join(dir, ".tmct", "imports", "games", "hanoi-3.txt"));
    await access(join(dir, ".tmct", "imports", "README.txt"));

    const imp = runCli(dir, "import", "--file", ".tmct/imports/games/hanoi-3.txt");
    assert.equal(imp.status, 0, imp.stderr + imp.stdout);
    // 19 teachable sentences after sentence-splitting the compound lines;
    // the 23 comment lines are skipped, never declined.
    assert.match(imp.stdout, /19 sentence\(s\), 23 comment line\(s\) skipped/);
    assert.match(imp.stdout, /19 taught, 0 declined/);
    assert.match(imp.stdout, /taught — you can move a disk onto a peg\./);
    assert.doesNotMatch(imp.stdout, /DECLINED/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a definition file with an unteachable sentence exits 1 and names the sentence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-import-bogus-"));
  try {
    assert.equal(runCli(dir, "init").status, 0);
    const bogus = join(dir, "bogus.txt");
    await writeFile(bogus, "# a comment survives\na disk is a kind of game piece.\ncolorless green ideas sleep furiously in the whatsit.\n");
    const imp = runCli(dir, "import", "--file", "bogus.txt");
    assert.equal(imp.status, 1, "a declined sentence must fail the import");
    assert.match(imp.stdout, /DECLINED — colorless green ideas sleep furiously in the whatsit\./);
    assert.match(imp.stdout, /1 taught, 1 declined/);
    assert.match(imp.stdout, /fix the declined sentence\(s\) and re-import/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("re-init never duplicates the scaffold; re-import is idempotent (exit 0 both times)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-import-idem-"));
  try {
    assert.equal(runCli(dir, "init").status, 0);
    const again = runCli(dir, "init");
    assert.equal(again.status, 0, again.stderr);
    const first = runCli(dir, "import", "--file", ".tmct/imports/games/hanoi-3.txt");
    assert.equal(first.status, 0, first.stderr + first.stdout);
    const second = runCli(dir, "import", "--file", ".tmct/imports/games/hanoi-3.txt");
    assert.equal(second.status, 0, second.stderr + second.stdout);
    assert.match(second.stdout, /19 taught, 0 declined/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
