// router-drive.test.mjs — the capability router's product-facing INVOCATION
// surface: src/router/drive.mjs (buildCapabilityPlanCtx/runCapabilityPlan), the
// `tmct plan` CLI subcommand, and chat's `/plan` command. Unlike
// test/router-resolver.test.mjs (which drives the pure Stage 1-5 machinery
// directly), this file proves the WIRING a real user actually invokes: a real
// on-disk graph, the real dispatchTool, the real CLI binary, and a real chat
// turn — all the way to a correct composed answer or an honest refuse.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable, PassThrough } from "node:stream";

import { ingestSchemaDocs } from "../src/schema-docs.mjs";
import { buildCapabilityPlanCtx, runCapabilityPlan, declaredCapabilityNames } from "../src/router/drive.mjs";
import { runChat } from "../src/chat.mjs";

const BIN = fileURLToPath(new URL("../bin/tmct.mjs", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));

// The known-good composed answers agentbench/cases.jsonl already pins for this
// exact fixture + request (ab-c1-untested-in-impact / ab-c2-what-to-test) — the
// SAME ground truth the router's own benchmark grades against, not a
// hand-derived-here truth this file invents on its own.
const KNOWN_INTERSECT = ["app/lib/c.mjs", "app/lib/e.mjs", "app/lib/f.mjs", "scripts/g.mjs"];
const KNOWN_KEYSTONE = ["app/lib/a.mjs"];

async function materializeFixtureRepo() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-router-drive-"));
  await mkdir(join(dir, ".tmct"), { recursive: true });
  const ingested = ingestSchemaDocs(JSON.parse(await readFile(FIXTURE, "utf8")));
  await writeFile(join(dir, ".tmct", "graph.json"), JSON.stringify(ingested));
  return dir;
}

const REPO = await materializeFixtureRepo();
after(() => rm(REPO, { recursive: true, force: true }));

// ---- 1. the library surface: buildCapabilityPlanCtx + runCapabilityPlan ------

test("runCapabilityPlan: a relative-filter request composes the real intersect answer", async () => {
  const ctx = await buildCapabilityPlanCtx({ config: { graphFile: join(REPO, ".tmct", "graph.json") } });
  const tools = declaredCapabilityNames();
  assert.ok(tools.includes("tmct_impact") && tools.includes("tmct_untested"));

  const result = await runCapabilityPlan("of the modules impacted by app/lib/a.mjs, which are untested", tools, ctx);
  assert.equal(result.refused, false);
  assert.equal(result.driver, "resolver-0.8.0");
  assert.deepEqual(result.calls.map((c) => c.name), ["tmct_impact", "tmct_untested"]);
  assert.deepEqual(result.composed, KNOWN_INTERSECT);
});

test("runCapabilityPlan: an ungrounded C1 request escalates to the goal-reasoner's keystone answer", async () => {
  const ctx = await buildCapabilityPlanCtx({ config: { graphFile: join(REPO, ".tmct", "graph.json") } });
  const tools = declaredCapabilityNames();

  const result = await runCapabilityPlan("what most needs a test in this codebase", tools, ctx);
  assert.equal(result.refused, false);
  assert.equal(result.driver, "goal-0.8.1");
  assert.deepEqual(result.composed, KNOWN_KEYSTONE);
});

test("runCapabilityPlan: an unresolvable entity is an honest refuse, never a crash or a guess", async () => {
  const ctx = await buildCapabilityPlanCtx({ config: { graphFile: join(REPO, ".tmct", "graph.json") } });
  const tools = declaredCapabilityNames();

  const result = await runCapabilityPlan("who calls zzzNoSuchSymbolzzz", tools, ctx);
  assert.equal(result.refused, true);
  assert.equal(result.terminated, true);
  assert.equal(result.calls.length, 0);
  assert.equal(result.composed ?? null, null); // goal-reasoner's refuse() sets composed:null; the resolver leaves it undefined — either way, no answer
  // both C1 (the direct resolver) and C2 (the goal-reasoner) declined — the
  // driver carries BOTH reasons, not just the last one.
  assert.ok(result.why, "carries a why for the final (C2) refusal");
  assert.ok(result.c1Why, "carries the C1 resolver's own refusal reason too");
});

test("runCapabilityPlan: a request over the budget is refused, not silently truncated", async () => {
  const ctx = await buildCapabilityPlanCtx({ config: { graphFile: join(REPO, ".tmct", "graph.json") } });
  const tools = declaredCapabilityNames();
  const nineSteps = Array.from({ length: 9 }, (_, i) => `describe app/lib/${String.fromCharCode(97 + (i % 6))}.mjs`).join(" and then ");
  const result = await runCapabilityPlan(nineSteps, tools, ctx);
  assert.equal(result.refused, true);
});

// ---- 2. the real CLI binary: `tmct plan` -------------------------------------

test("CLI: `tmct plan --json` produces the real composed answer for a real domain", () => {
  const proc = spawnSync(process.execPath, [
    BIN, "plan", "of the modules impacted by app/lib/a.mjs, which are untested",
    "--repo", REPO, "--json",
  ], { encoding: "utf8" });
  assert.equal(proc.status, 0, proc.stderr);
  const parsed = JSON.parse(proc.stdout);
  assert.equal(parsed.refused, false);
  assert.deepEqual(parsed.composed, KNOWN_INTERSECT);
});

test("CLI: `tmct plan` prints a human-readable report with the composed answer", () => {
  const proc = spawnSync(process.execPath, [
    BIN, "plan", "of the modules impacted by app/lib/a.mjs, which are untested",
    "--repo", REPO,
  ], { encoding: "utf8" });
  assert.equal(proc.status, 0, proc.stderr);
  assert.match(proc.stdout, /driver: resolver-0\.8\.0/);
  assert.match(proc.stdout, /composed answer \(4\): app\/lib\/c\.mjs, app\/lib\/e\.mjs, app\/lib\/f\.mjs, scripts\/g\.mjs/);
});

test("CLI: `tmct plan` on an unresolvable entity exits non-zero with an honest \"no plan found\", never a crash", () => {
  const proc = spawnSync(process.execPath, [
    BIN, "plan", "who calls zzzNoSuchSymbolzzz",
    "--repo", REPO,
  ], { encoding: "utf8" });
  assert.equal(proc.status, 1);
  assert.match(proc.stdout, /no plan found —/);
  assert.doesNotMatch(proc.stderr, /Error|at Object|at async/); // no stack trace leaked
});

test("CLI: `tmct plan --tools` rejects an unknown capability name before touching the graph", () => {
  const proc = spawnSync(process.execPath, [
    BIN, "plan", "describe Widget",
    "--repo", REPO, "--tools", "tmct_not_a_real_tool",
  ], { encoding: "utf8" });
  assert.equal(proc.status, 2);
  assert.match(proc.stderr, /unknown --tools name/);
});

// ---- 3. the chat `/plan` command ---------------------------------------------

async function chatTurn(repoPath, lines) {
  const out = new PassThrough();
  let transcript = "";
  out.on("data", (chunk) => { transcript += chunk; });
  await runChat({ repoPath, ephemeral: true, input: Readable.from([...lines, "/exit\n"].map((l) => `${l}\n`)), output: out });
  return transcript;
}

test("chat: /plan composes the real intersect answer over the loaded session graph", async () => {
  const transcript = await chatTurn(REPO, ["/plan of the modules impacted by app/lib/a.mjs, which are untested"]);
  assert.match(transcript, /driver: resolver-0\.8\.0/);
  assert.match(transcript, /composed answer \(4\): app\/lib\/c\.mjs, app\/lib\/e\.mjs, app\/lib\/f\.mjs, scripts\/g\.mjs/);
});

test("chat: /plan on an unresolvable entity answers an honest miss, not a crash", async () => {
  const transcript = await chatTurn(REPO, ["/plan who calls zzzNoSuchSymbolzzz"]);
  assert.match(transcript, /no plan found —/);
});

test("chat: /plan with no request names what it needs", async () => {
  const transcript = await chatTurn(REPO, ["/plan"]);
  assert.match(transcript, /\/plan needs a request/);
});
