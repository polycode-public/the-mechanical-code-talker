// Frozen must-flow regressions for the 3.0.3 chat surfaces a persona sweep
// judged FLOW: architecture/overview routing, the code-index query family
// (members, importers, definition, caller anaphora, count, honest-empty), the
// module and vocabulary digest read-back with its source line, and the
// cross-turn temporal comparison threaded through a live session. Every probe
// runs runTurn against the committed mini-webapp graph, read-only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../src/services/chat.mjs";
import { parseEntities } from "../src/domain/codegraph.mjs";
import { emptyRecord } from "../src/domain/discourse.mjs";

const GRAPH_FILE = fileURLToPath(new URL("../examples/mini-webapp/.tmct/graph.json", import.meta.url));
const graph = parseEntities(JSON.parse(readFileSync(GRAPH_FILE, "utf8")));
const config = { graphFile: GRAPH_FILE };
const ask = (line, extra = {}) => runTurn(line, { config, graph, ...extra });

// ---- architecture routing ----

test("\"what is the architecture of this codebase\" routes to the architecture overview, not the identity card", async () => {
  const r = await ask("what is the architecture of this codebase");
  assert.match(r.answer, /Architecture: 12 module\(s\) in 5 package\(s\)/);
  assert.match(r.answer, /hub modules/i);
  assert.doesNotMatch(r.answer, /deterministic, offline code-graph assistant/i);
  assert.equal(r.record.miss, false);
});

test("\"what are the packages here\" enumerates the directories grouping the modules", async () => {
  const r = await ask("what are the packages here");
  assert.match(r.answer, /src\/core/);
  assert.match(r.answer, /src\/handlers/);
  assert.match(r.answer, /src\/server/);
  assert.doesNotMatch(r.answer, /means the same as/i);
  assert.equal(r.record.miss, false);
});

test("\"list the packages\" and \"show me the packages\" enumerate the same set", async () => {
  const listed = await ask("list the packages");
  const shown = await ask("show me the packages");
  assert.match(listed.answer, /src\/core/);
  assert.equal(shown.answer, listed.answer);
});

test("\"how many packages are there\" agrees with the count the architecture map reports", async () => {
  const r = await ask("how many packages are there");
  assert.match(r.answer, /^5 packages\./);
  const arch = await ask("what is the architecture of this codebase");
  assert.match(arch.answer, /in 5 package\(s\)/);
});

test("an unlistable kind names packages among the kinds it can list", async () => {
  const r = await ask("list widgets");
  assert.match(r.answer, /isn't a listable kind/);
  assert.match(r.answer, /packages/);
});

// ---- code-index query family ----

test("\"which modules are in src/core\" lists the three core modules", async () => {
  const r = await ask("which modules are in src/core");
  assert.match(r.answer, /src\/core\/model\.mjs/);
  assert.match(r.answer, /src\/core\/store\.mjs/);
  assert.match(r.answer, /src\/core\/validate\.mjs/);
  assert.equal(r.record.miss, false);
});

test("\"what functions are in tasks.mjs\" enumerates the module's members", async () => {
  const r = await ask("what functions are in tasks.mjs");
  assert.match(r.answer, /listTasks/);
  assert.match(r.answer, /createTask/);
  assert.equal(r.record.miss, false);
});

test("\"what modules import model.mjs\" names all four importers", async () => {
  const r = await ask("what modules import model.mjs");
  assert.match(r.answer, /store\.mjs/);
  assert.match(r.answer, /validate\.mjs/);
  assert.match(r.answer, /tasks\.mjs/);
  assert.match(r.answer, /users\.mjs/);
  assert.equal(r.record.miss, false);
});

test("\"where is loadStore defined\" answers the file and line range", async () => {
  const r = await ask("where is loadStore defined");
  assert.match(r.answer, /loadStore\(\) is defined in src\/core\/store\.mjs at lines 9-15/);
  assert.equal(r.record.miss, false);
});

test("\"what calls it\" resolves the anaphor to the just-located function and names its caller", async () => {
  const first = await ask("where is loadStore defined");
  const r = await ask("what calls it", { focus: first.focus, last: first.last });
  assert.match(r.answer, /listTasks/);
  assert.match(r.answer, /tasks\.mjs/);
  assert.equal(r.record.miss, false);
});

test("\"what does TaskController contain\" gives an honest-empty with a reason, not a bare wall", async () => {
  const r = await ask("what does TaskController contain");
  assert.match(r.answer, /no contains edges in the index/i);
  assert.doesNotMatch(r.answer, /couldn't parse this as a graph question/i);
});

test("\"how many modules are there\" answers the count directly", async () => {
  const r = await ask("how many modules are there");
  assert.match(r.answer, /12 modules/);
  assert.equal(r.record.miss, false);
});

// ---- digest term read-back ----

test("\"what is model.mjs\" reads the module digest back with its structure summary", async () => {
  const r = await ask("what is model.mjs");
  assert.match(r.answer, /src\/core\/model\.mjs is a module/);
  assert.match(r.answer, /defines 7/);
  assert.match(r.answer, /covered by 2 test modules/);
  assert.equal(r.record.miss, false);
});

test("\"what does validate.mjs do\" reads the module digest with its defined functions", async () => {
  const r = await ask("what does validate.mjs do");
  assert.match(r.answer, /src\/core\/validate\.mjs is a module/);
  assert.match(r.answer, /validateTask, validateUser/);
  assert.equal(r.record.miss, false);
});

test("a vocabulary term read-back cites its source (in-session, after a prior vocabulary turn opens the child pack)", async () => {
  const memoryDir = mkdtempSync(join(tmpdir(), "tmct-chatflow-vocab-"));
  await runTurn("what is a cache", { config, graph, memoryDir });
  const r = await runTurn("what is a queue", { config, graph, memoryDir });
  assert.match(r.answer, /queue/);
  assert.match(r.answer, /source: child:conceptnet:queue/);
  assert.equal(r.record.miss, false);
});

// ---- cross-turn temporal comparison threaded through a live session ----

test("a commit-filter pivot then two temporal follow-ups compare dates with both sides cited", async () => {
  const t1 = await ask("what changed before 1b2c3d4e5f60", { discourse: emptyRecord() });
  assert.match(t1.answer, /7 commit\(s\) changed before 1b2c3d4e5f60/);

  const t2 = await ask("was that before logger.mjs was touched",
    { discourse: t1.discourse, focus: t1.focus, last: t1.last });
  assert.match(t2.answer,
    /^No — 1b2c3d4e5f60 \(2026-05-24\) came after logger\.mjs was last touched \(e5f6a1b2c3d4, 2026-05-15\)\./);

  const t3 = await ask("was it after store.mjs was touched",
    { discourse: t2.discourse, focus: t2.focus, last: t2.last });
  assert.match(t3.answer,
    /^No — 1b2c3d4e5f60 \(2026-05-24\) landed on the same day as store\.mjs was last touched \(1b2c3d4e5f60, 2026-05-24\)\./);
});
