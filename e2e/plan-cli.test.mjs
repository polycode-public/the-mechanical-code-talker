// The `tmct plan` CLI subcommand, driven through the real binary: a composed
// answer in both output modes, honest non-zero misses without a stack trace,
// --tools validation for built-in and taught capability names.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ingestSchemaDocs } from "../src/tools/schema-docs.mjs";
import { runTurn } from "../src/services/chat.mjs";
import { clearCache } from "../src/adapters/source.mjs";

const BIN = fileURLToPath(new URL("../bin/tmct.mjs", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../test/fixtures/entities.fixture.json", import.meta.url));

async function materializeFixtureRepo() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-plan-cli-"));
  await mkdir(join(dir, ".tmct"), { recursive: true });
  const ingested = ingestSchemaDocs(JSON.parse(await readFile(FIXTURE, "utf8")));
  await writeFile(join(dir, ".tmct", "graph.json"), JSON.stringify(ingested));
  return dir;
}

const REPO = await materializeFixtureRepo();
after(async () => {
  clearCache();
  await rm(REPO, { recursive: true, force: true });
});

// The known-good composed answer agentbench/cases.jsonl pins for this exact
// fixture + request (ab-c1-untested-in-impact).
const KNOWN_INTERSECT = ["app/lib/c.mjs", "app/lib/e.mjs", "app/lib/f.mjs", "scripts/g.mjs"];

test("`tmct plan --json` produces the real composed answer for a real domain", () => {
  const proc = spawnSync(process.execPath, [
    BIN, "plan", "of the modules impacted by app/lib/a.mjs, which are untested",
    "--repo", REPO, "--json",
  ], { encoding: "utf8" });
  assert.equal(proc.status, 0, proc.stderr);
  const parsed = JSON.parse(proc.stdout);
  assert.equal(parsed.refused, false);
  assert.deepEqual(parsed.composed, KNOWN_INTERSECT);
});

test("`tmct plan` prints a human-readable report with the composed answer", () => {
  const proc = spawnSync(process.execPath, [
    BIN, "plan", "of the modules impacted by app/lib/a.mjs, which are untested",
    "--repo", REPO,
  ], { encoding: "utf8" });
  assert.equal(proc.status, 0, proc.stderr);
  assert.match(proc.stdout, /driver: resolver-0\.8\.0/);
  assert.match(proc.stdout, /composed answer \(4\): app\/lib\/c\.mjs, app\/lib\/e\.mjs, app\/lib\/f\.mjs, scripts\/g\.mjs/);
});

test("`tmct plan` on an unresolvable entity exits non-zero with an honest \"no plan found\", never a crash", () => {
  const proc = spawnSync(process.execPath, [
    BIN, "plan", "who calls zzzNoSuchSymbolzzz",
    "--repo", REPO,
  ], { encoding: "utf8" });
  assert.equal(proc.status, 1);
  assert.match(proc.stdout, /no plan found —/);
  assert.doesNotMatch(proc.stderr, /Error|at Object|at async/); // no stack trace leaked
});

test("`tmct plan --tools` rejects an unknown capability name before touching the graph", () => {
  const proc = spawnSync(process.execPath, [
    BIN, "plan", "describe Widget",
    "--repo", REPO, "--tools", "tmct_not_a_real_tool",
  ], { encoding: "utf8" });
  assert.equal(proc.status, 2);
  assert.match(proc.stderr, /unknown --tools name/);
});

test("`tmct plan --tools` accepts a taught record name, validating after registration", async () => {
  const memory = await mkdtemp(join(tmpdir(), "tmct-plan-cli-mem-"));
  const teach = [
    "remember that disk-1 is a disk.",
    "remember that disk-2 is a disk.",
    "remember that disk-3 is a disk.",
    "remember that peg-a is a peg.",
    "remember that peg-b is a peg.",
    "remember that peg-c is a peg.",
    "disk-1 is smaller than disk-2",
    "disk-1 is smaller than disk-3",
    "disk-2 is smaller than disk-3",
    "you can move a disk onto a peg.",
    "you can move a disk onto a disk.",
    "to move a disk onto a target, nothing may rest on the disk.",
    "to move a disk onto a target, nothing may rest on the target.",
    "to move a disk onto a disk, the disk must be smaller than the target.",
    "moving a disk onto a target makes the disk rest on the target.",
    "disk-1 rests on disk-2.",
    "disk-2 rests on disk-3.",
    "disk-3 rests on peg-a.",
  ];
  try {
    for (const sentence of teach) {
      const r = await runTurn(sentence, { config: {}, memoryDir: memory, sessionId: "plan-cli-taught" });
      assert.equal(r.record.via, "assert", `teach failed: "${sentence}" -> ${r.answer}`);
    }
    const args = [BIN, "plan", "make every disk rest on peg-c", "--repo", memory, "--graph", join(REPO, ".tmct", "graph.json")];
    const ok = spawnSync(process.execPath, [...args, "--tools", "taught:move onto"], { encoding: "utf8" });
    assert.equal(ok.status, 0, ok.stderr || ok.stdout);
    assert.match(ok.stdout, /driver: taught-0\.1\.0/);
    const bogus = spawnSync(process.execPath, [...args, "--tools", "taught:no such action"], { encoding: "utf8" });
    assert.equal(bogus.status, 2);
    assert.match(bogus.stderr, /unknown --tools name/);
    assert.match(bogus.stderr, /taught:move onto/, "the registered-capabilities hint includes the taught record");
  } finally {
    await rm(memory, { recursive: true, force: true });
  }
});
