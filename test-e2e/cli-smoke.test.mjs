// Binary smoke: spawn bin/tmct.mjs as a real child and exercise the cli
// query/digest modes against a fixture graph. No server, no MCP. A spawned
// child has NON-TTY stdio, so the bare/chat invocations exercise the --plain
// (readline) path — which is exactly the shell the suite must pin down.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { TMCT_BIN as BIN } from "./helpers/cli-bin.mjs";

const FIXTURE = fileURLToPath(new URL("../test/fixtures/entities.fixture.json", import.meta.url));

/** A temp repo whose .tmct/graph.json is the test fixture — lets us exercise the cli
 *  query/digest modes without python+git (no real source files; the renderers tolerate
 *  missing files and just omit the file-backed sections). */
async function repoWithFixtureGraph() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-cli-"));
  await mkdir(join(dir, ".tmct"), { recursive: true });
  await writeFile(join(dir, ".tmct", "graph.json"), await readFile(FIXTURE, "utf8"));
  return dir;
}
const runCli = (...args) => spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8" });

test("bare invocation with non-TTY stdin reaches CHAT (the headline argv splice) and exits 0", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-bare-"));
  try {
    // `tmct` with piped stdin = the --plain readline shell in an empty dir: honest
    // empty-graph banner, a greeting turn, clean exit 0, .tmct/ created.
    // (TMCT_NO_SEED: the W3 seeded-bootstrap path has its own suite — wiring-seed.test.mjs)
    const bare = spawnSync(process.execPath, [BIN], {
      encoding: "utf8", input: "hi\n/exit\n", cwd: dir, env: { ...process.env, TMCT_NO_SEED: "1" },
    });
    assert.equal(bare.status, 0, bare.stderr);
    assert.match(bare.stdout, /no code graph loaded — starting empty/); // #3: 0-module orientation
    assert.match(bare.stdout, /Hi\. I'm tmct/, "the greeting leads with identity + a working capability, not an apology"); // #3
    assert.doesNotMatch(bare.stdout, /Ask me about this codebase/, "still doesn't over-promise structure-query capability"); // #3
    const names = await readdir(join(dir, ".tmct"));
    assert.ok(names.some((n) => /^session-.*\.md$/.test(n)), "the bare invocation wrote its session log");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
  // an unknown mode still gets the instructive usage line and exit 2
  const unknown = runCli("frobnicate");
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown invocation "frobnicate"/);
  assert.match(unknown.stderr, /Use `chat`, `memory`, `init`, `index`, `import`, `extract`, `extend --validate`, `syllogise`, `viz`, `digest`, `serve`, `plan`, `cli <tool> …`, or `cli digest …`/);
});

test("cli <toolName>: any tool routes to dispatchTool and prints its text result", async () => {
  const dir = await repoWithFixtureGraph();
  try {
    // architecture takes no symbol → exercises the generic tool-query path end-to-end
    const arch = runCli("cli", "tmct_architecture", JSON.stringify({ repo_path: dir }));
    assert.equal(arch.status, 0, arch.stderr);
    assert.match(arch.stdout, /Architecture/);
    assert.match(arch.stdout, /module\(s\)/);

    // a symbol tool too (tmct_describe of a module in the fixture)
    const desc = runCli("cli", "tmct_describe", JSON.stringify({ repo_path: dir, symbol: "app/lib/a.mjs" }));
    assert.equal(desc.status, 0, desc.stderr);
    assert.match(desc.stdout, /app\/lib\/a\.mjs/);

    // an unknown tool name is a clean non-zero exit, not a crash
    const bad = runCli("cli", "tmct_nope", JSON.stringify({ repo_path: dir }));
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
    assert.match(first, /^# tmct-digest tier=(NONE|TINY|MID|LARGE) topup=(true|false) modules=\d+$/, first);
    assert.match(first, /modules=1/);
    assert.match(res.stdout, /# Repository architecture/);
    assert.match(res.stdout, /# Context bundle: app\/lib\/a\.mjs/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli digest: primary gets a full bundle, secondaries are ranked + trimmed", async () => {
  const dir = await repoWithFixtureGraph();
  try {
    // primary app/lib/b.mjs + one secondary (app/lib/a.mjs, which b imports). `untuned` so the
    // long-exemplar primary tops up to MID (carrying the covering-tests tail) — the tuned default
    // now keeps module digests TINY (see the dedicated min/untuned tests below).
    const res = runCli("cli", "digest", JSON.stringify({ repo_path: dir, modules: ["app/lib/b.mjs", "app/lib/a.mjs"], untuned: true }));
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout.split("\n")[0], /^# tmct-digest tier=\w+ topup=(true|false) modules=2$/);
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

test("cli tmct_locate: emits ranked <relpath>\\t<score>, highest first", async () => {
  const dir = await repoWithFixtureGraph();
  try {
    const res = runCli("cli", "tmct_locate", JSON.stringify({ repo_path: dir, query: "fnAlpha" }));
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

test("cli digest min/untuned: default==untuned MID; min forces TINY", async () => {
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
    assert.match(headerOf(def.stdout), /^# tmct-digest tier=MID topup=true modules=1$/, headerOf(def.stdout));
    // min: leanest, always TINY + no top-up
    assert.match(headerOf(min.stdout), /^# tmct-digest tier=TINY topup=false modules=1$/, headerOf(min.stdout));
    // untuned: now a no-op for sizing → identical MID
    assert.match(headerOf(untuned.stdout), /^# tmct-digest tier=MID topup=true modules=1$/, headerOf(untuned.stdout));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
