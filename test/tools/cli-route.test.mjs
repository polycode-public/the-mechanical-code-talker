// The `tmct cli …` and `tmct init` wiring, driven through a real spawn of bin/tmct.mjs.
// What's under test is the binary's own argument and file plumbing, so a spawned child is
// the only thing that exercises it: which graph the route answers from, and whether an
// initialized repo carries its cold-tool catalog on disk.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { COLD_TOOLS } from "../../src/tools/definitions.mjs";

const BIN = fileURLToPath(new URL("../../bin/tmct.mjs", import.meta.url));
const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));

const runCli = (args, opts = {}) =>
  spawnSync(process.execPath, [BIN, ...args], {
    encoding: "utf8",
    ...opts,
    env: { ...process.env, TMCT_NO_SEED: "1", TMCT_GRAPH_FILE: "", ...(opts.env || {}) },
  });

/** A temp repo whose .tmct/graph.json is the shared fixture. */
async function repoWithFixtureGraph(prefix) {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(dir, ".tmct"), { recursive: true });
  await writeFile(join(dir, ".tmct", "graph.json"), await readFile(FIXTURE, "utf8"));
  return dir;
}

/** A temp repo whose .tmct/graph.json holds one module found in no other graph — so an
 *  answer built from the WRONG repo is recognisable rather than merely empty. */
async function repoWithDecoyGraph() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-decoy-"));
  await mkdir(join(dir, ".tmct"), { recursive: true });
  await writeFile(join(dir, ".tmct", "graph.json"), JSON.stringify({
    generated_at: "", classes: [], vocabulary: [], objectProperties: [], proseIndex: {},
    individuals: [{ id: "decoy", label: "decoy/only-here.mjs", class: "Module" }],
  }));
  return dir;
}

test("`cli <tool> --repo <dir>` answers from that repo's graph, not the cwd's", async () => {
  const target = await repoWithFixtureGraph("tmct-cli-repo-");
  const cwd = await repoWithDecoyGraph();
  try {
    const r = runCli(["cli", "tmct_architecture", "{}", "--repo", target], { cwd });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /app\/lib\/a\.mjs/, "the --repo graph's modules are the ones described");
    assert.doesNotMatch(r.stdout, /decoy\/only-here\.mjs/, "the cwd's graph must not leak into the answer");
  } finally {
    await rm(target, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

test("`cli <tool> --graph <path>` answers from that graph file, outranking the cwd", async () => {
  const cwd = await repoWithDecoyGraph();
  try {
    const r = runCli(["cli", "tmct_architecture", "{}", "--graph", FIXTURE], { cwd });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /app\/lib\/a\.mjs/);
    assert.doesNotMatch(r.stdout, /decoy\/only-here\.mjs/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("`cli <tool> --graph` outranks the payload's repo_path, matching the documented precedence", async () => {
  const decoy = await repoWithDecoyGraph();
  try {
    const r = runCli(["cli", "tmct_architecture", JSON.stringify({ repo_path: decoy }), "--graph", FIXTURE]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /app\/lib\/a\.mjs/);
    assert.doesNotMatch(r.stdout, /decoy\/only-here\.mjs/);
  } finally {
    await rm(decoy, { recursive: true, force: true });
  }
});

test("`cli <tool>` with no repo hint still reports an empty graph honestly, never a guess", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "tmct-cli-empty-"));
  try {
    const r = runCli(["cli", "tmct_architecture", "{}"], { cwd });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /is empty — no entities to answer from yet/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("`chat --repo`: a teach sentence about a code-graph entity grounds through the graph, not just the static lexicon", async () => {
  const dir = await repoWithFixtureGraph("tmct-cli-teach-");
  try {
    const r = runCli(["chat", "--repo", dir], {
      input: "/describe Widget\nevery Widget is a container\n/exit\n",
      env: { TMCT_NO_SEED: "1" },
    });
    assert.equal(r.status, 0, r.stderr);
    // the code graph already knows Widget as a Class before the teach turn
    assert.match(r.stdout, /Widget — Class/);
    // the teach turn now succeeds — the class-mint reads back with a real confirmation,
    // never the "I don't recognize … as words I know" honest-miss refusal
    assert.match(r.stdout, /noted — remembered: widget is a kind of container/);
    assert.doesNotMatch(r.stdout, /I don't recognize/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("`tmct init` writes the cold-tool catalog to <repo>/.tmct/TOOLS.md", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-init-catalog-"));
  try {
    const r = runCli(["init", "--repo", dir]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /cold-tool catalog: .*\.tmct\/TOOLS\.md/);
    const catalog = await readFile(join(dir, ".tmct", "TOOLS.md"), "utf8");
    assert.match(catalog, /# tmct cold-tool catalog/);
    for (const { name, example } of COLD_TOOLS) {
      assert.ok(
        catalog.includes(`node ${BIN} cli ${name} '${JSON.stringify(example)}'`),
        `${name}'s invocation should name this executable and run as written`,
      );
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
