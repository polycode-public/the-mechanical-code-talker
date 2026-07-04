// Binary smoke: spawn bin/cli.mjs as a real stdio child and complete an MCP
// initialize + tools/list exchange with the SDK's own client. Listing tools
// touches no graph artifact, so no index is needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const BIN = fileURLToPath(new URL("../bin/cli.mjs", import.meta.url));
const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));

/** A temp repo whose .seonix/graph.json is the test fixture — lets us exercise the cli
 *  query/digest modes without python+git (no real source files; the renderers tolerate
 *  missing files and just omit the file-backed sections). */
async function repoWithFixtureGraph() {
  const dir = await mkdtemp(join(tmpdir(), "seonix-cli-"));
  await mkdir(join(dir, ".seonix"), { recursive: true });
  await writeFile(join(dir, ".seonix", "graph.json"), await readFile(FIXTURE, "utf8"));
  return dir;
}
const runCli = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8" });

test("stdio binary starts, initializes, and lists every tool", async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [BIN] });
  const client = new Client({ name: "smoke-client", version: "0.0.0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    // Roster is owned by server.mjs (another agent) and evolving — assert the stable
    // invariants, not the exact list: the binary boots, speaks MCP, and advertises a
    // non-empty set of seonix_* tools including the always-present entry point.
    assert.ok(names.length >= 1, "server lists at least one tool");
    assert.ok(names.every((n) => n.startsWith("seonix_")), `all tools are seonix_*: ${names.join(", ")}`);
    assert.ok(names.includes("seonix_context"), "seonix_context is always present");
    assert.equal(client.getServerVersion()?.name, "seonix");
  } finally {
    await client.close();
  }
});

test("cli <toolName>: any tool routes to dispatchTool and prints its text result", async () => {
  const dir = await repoWithFixtureGraph();
  try {
    // architecture takes no symbol → exercises the generic tool-query path end-to-end
    const arch = runCli("cli", "seonix_architecture", JSON.stringify({ repo_path: dir }));
    assert.equal(arch.status, 0, arch.stderr);
    assert.match(arch.stdout, /Architecture/);
    assert.match(arch.stdout, /module\(s\)/);

    // a symbol tool too (seonix_describe of a module in the fixture)
    const desc = runCli("cli", "seonix_describe", JSON.stringify({ repo_path: dir, symbol: "app/lib/a.mjs" }));
    assert.equal(desc.status, 0, desc.stderr);
    assert.match(desc.stdout, /app\/lib\/a\.mjs/);

    // an unknown tool name is a clean non-zero exit, not a crash
    const bad = runCli("cli", "seonix_nope", JSON.stringify({ repo_path: dir }));
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /unknown tool/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli digest: machine header line first, then architecture map + per-module bundles", async () => {
  const dir = await repoWithFixtureGraph();
  try {
    const res = runCli("cli", "digest", JSON.stringify({ repo_path: dir, modules: ["app/lib/a.mjs"] }));
    assert.equal(res.status, 0, res.stderr);
    // HARD CONTRACT: the very first line is the machine-readable header the rig greps.
    const first = res.stdout.split("\n")[0];
    assert.match(first, /^# seonix-digest tier=(NONE|TINY|MID|LARGE) topup=(true|false) modules=\d+$/, first);
    assert.match(first, /modules=1/);
    assert.match(res.stdout, /# Repository architecture/);
    assert.match(res.stdout, /# Context bundle: app\/lib\/a\.mjs/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli digest (B2): primary gets a full bundle, secondaries are ranked + trimmed", async () => {
  const dir = await repoWithFixtureGraph();
  try {
    // primary app/lib/b.mjs + one secondary (app/lib/a.mjs, which b imports). `untuned` so the
    // long-exemplar primary tops up to MID (carrying the covering-tests tail) — the tuned default
    // now keeps module digests TINY (see the dedicated min/untuned tests below).
    const res = runCli("cli", "digest", JSON.stringify({ repo_path: dir, modules: ["app/lib/b.mjs", "app/lib/a.mjs"], untuned: true }));
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout.split("\n")[0], /^# seonix-digest tier=\w+ topup=(true|false) modules=2$/);
    // the secondary module is marked trimmed
    assert.match(res.stdout, /# Context bundle: app\/lib\/a\.mjs \(secondary, trimmed\)/);
    // the primary (b) carries the full tail (covering tests); the trimmed secondary section does NOT
    const secStart = res.stdout.indexOf("# Context bundle: app/lib/a.mjs");
    const primarySection = res.stdout.slice(0, secStart);
    const secondarySection = res.stdout.slice(secStart);
    assert.match(primarySection, /covering tests:/);
    assert.doesNotMatch(secondarySection, /covering tests:/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli seonix_locate (TUNING #3): emits ranked <relpath>\\t<score>, highest first", async () => {
  const dir = await repoWithFixtureGraph();
  try {
    const res = runCli("cli", "seonix_locate", JSON.stringify({ repo_path: dir, query: "fnAlpha" }));
    assert.equal(res.status, 0, res.stderr);
    const lines = res.stdout.trim().split("\n").filter(Boolean);
    assert.ok(lines.length >= 1, "at least one ranked line");
    // every line is `<path>\t<score>` with a numeric score, descending
    let prev = Infinity;
    for (const ln of lines) {
      const parts = ln.split("\t");
      assert.equal(parts.length, 2, `path\\tscore: ${ln}`);
      const score = Number(parts[1]);
      assert.ok(Number.isFinite(score), `numeric score: ${ln}`);
      assert.ok(score <= prev, `descending: ${ln}`);
      prev = score;
    }
    // rank-1 is the module defining fnAlpha
    assert.match(lines[0].split("\t")[0], /a\.mjs$/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli digest min/untuned (B012: tuning #1 reverted): default==untuned MID; min forces TINY", async () => {
  const dir = await repoWithFixtureGraph();
  try {
    const headerOf = (out) => out.split("\n")[0];
    // b.mjs has a long exemplar (Widget, 30 LOC) and no symbol anchor. B012 reverted tuning #1, so
    // the default now escalates to MID (== the B010 digest, == untuned); `min` stays leanest TINY.
    const mod = JSON.stringify(["app/lib/b.mjs"]);
    const def = runCli("cli", "digest", `{"repo_path":${JSON.stringify(dir)},"modules":${mod}}`);
    const min = runCli("cli", "digest", `{"repo_path":${JSON.stringify(dir)},"modules":${mod},"min":true}`);
    const untuned = runCli("cli", "digest", `{"repo_path":${JSON.stringify(dir)},"modules":${mod},"untuned":true}`);
    assert.equal(def.status, 0, def.stderr);
    assert.equal(min.status, 0, min.stderr);
    assert.equal(untuned.status, 0, untuned.stderr);
    // reverted default: long exemplar escalates to MID + top-up
    assert.match(headerOf(def.stdout), /^# seonix-digest tier=MID topup=true modules=1$/, headerOf(def.stdout));
    // min: leanest, always TINY + no top-up
    assert.match(headerOf(min.stdout), /^# seonix-digest tier=TINY topup=false modules=1$/, headerOf(min.stdout));
    // untuned: now a no-op for sizing → identical MID
    assert.match(headerOf(untuned.stdout), /^# seonix-digest tier=MID topup=true modules=1$/, headerOf(untuned.stdout));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
