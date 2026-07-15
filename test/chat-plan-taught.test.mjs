// The taught world-goal lane through the CHAT surface: a user teaches an
// action family in a real conversation, then a /plan turn selects the taught
// capability record, answers with the simulated (never dispatched) plan, and
// unregisters the record again before the turn ends. The router internals are
// covered by test/router-taught-plan.test.mjs; this file proves the wiring a
// chat user actually invokes.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { ingestSchemaDocs } from "../src/schema-docs.mjs";
import { isCapability } from "../src/router/registry.mjs";
import { runTurn } from "../src/chat.mjs";
import { loadGraph } from "../src/server.mjs";
import * as source from "../src/source.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));

const REPO = await mkdtemp(join(tmpdir(), "tmct-chat-plan-taught-"));
await mkdir(join(REPO, ".tmct"), { recursive: true });
await writeFile(
  join(REPO, ".tmct", "graph.json"),
  JSON.stringify(ingestSchemaDocs(JSON.parse(await readFile(FIXTURE, "utf8")))),
);
const CONFIG = { graphFile: join(REPO, ".tmct", "graph.json") };
const GRAPH = await loadGraph(CONFIG, source);
const MEMORY = await mkdtemp(join(tmpdir(), "tmct-chat-plan-taught-mem-"));

const TEACH = [
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

after(async () => {
  source.clearCache();
  await rm(REPO, { recursive: true, force: true });
  await rm(MEMORY, { recursive: true, force: true });
});

const turn = (line) => runTurn(line, {
  config: CONFIG, graph: GRAPH, memoryDir: MEMORY, sessionId: "chat-plan-taught",
});

test("a /plan world-goal turn consumes the taught action family and cleans the registry up again", async () => {
  for (const sentence of TEACH) {
    const r = await turn(sentence);
    assert.equal(r.record.via, "assert", `teach failed: "${sentence}" -> ${r.answer}`);
  }

  const planned = await turn("/plan make every disk rest on peg-c");
  assert.match(planned.answer, /driver: taught-0\.1\.0/);
  const steps = planned.answer.match(/taught:move onto/g) || [];
  assert.equal(steps.length, 7, `expected the 7-move optimum in the reply:\n${planned.answer}`);
  assert.match(planned.answer, /simulated/);
  assert.match(planned.answer, /never dispatched/);

  // The turn's own cleanup unregistered the taught record: nothing leaks into
  // the process-global registry between turns.
  assert.equal(isCapability("taught:move onto"), false);
});

test("a graph-query /plan turn over the same taught store still routes to the resolver lane", async () => {
  const r = await turn("/plan of the modules impacted by app/lib/a.mjs, which are untested");
  assert.match(r.answer, /driver: resolver-0\.8\.0/);
  assert.equal(isCapability("taught:move onto"), false);
});

test("/capabilities lists the taught action families read from the store, beside the built-in tools", async () => {
  const r = await turn("/capabilities");
  assert.match(r.answer, /read-only graph tools: .*tmct_impact/);
  assert.match(r.answer, /taught actions \(planned over, never dispatched\):/);
  assert.match(r.answer, /taught:move onto — subject: disk, target: disk\|peg/);
});

test("/capabilities with no taught actions says so honestly; /help advertises the command", async () => {
  const empty = await mkdtemp(join(tmpdir(), "tmct-chat-plan-taught-empty-"));
  try {
    const r = await runTurn("/capabilities", { config: CONFIG, graph: GRAPH, memoryDir: empty, sessionId: "caps-empty" });
    assert.match(r.answer, /taught actions: none yet/);
    assert.match(r.answer, /you can move a disk onto a peg/);
  } finally {
    await rm(empty, { recursive: true, force: true });
  }
  const help = await turn("/help");
  assert.match(help.answer, /\/capabilities\s+what \/plan can plan over/);
});

test("tmct plan --tools accepts a taught record name, validating after registration", () => {
  const BIN = fileURLToPath(new URL("../bin/tmct.mjs", import.meta.url));
  const args = [BIN, "plan", "make every disk rest on peg-c", "--repo", MEMORY, "--graph", join(REPO, ".tmct", "graph.json")];
  const ok = spawnSync(process.execPath, [...args, "--tools", "taught:move onto"], { encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr || ok.stdout);
  assert.match(ok.stdout, /driver: taught-0\.1\.0/);
  const bogus = spawnSync(process.execPath, [...args, "--tools", "taught:no such action"], { encoding: "utf8" });
  assert.equal(bogus.status, 2);
  assert.match(bogus.stderr, /unknown --tools name/);
  assert.match(bogus.stderr, /taught:move onto/, "the registered-capabilities hint includes the taught record");
});
