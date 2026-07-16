// createSession's graph-source precedence: the TMCT_GRAPH_FILE env var is
// honored by the chat surface, an explicit --repo beats it, and logs/memory
// always target the repo, never the graph file's directory. These read the
// session handle's config/repo fields, which corpus rows cannot see.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createSession, moduleCountOf } from "../../src/chat.mjs";
import { parseEntities } from "../../src/codegraph.mjs";
import { clearCache } from "../../src/source.mjs";
import * as source from "../../src/source.mjs";

const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));

test("createSession honors TMCT_GRAPH_FILE; memory stays the repo", async () => {
  clearCache();
  const alt = await mkdtemp(join(tmpdir(), "tmct-cfg-alt-"));
  const graphPath = join(alt, "custom-graph.json");
  await writeFile(graphPath, await readFile(FIXTURE, "utf8"));
  const cwd = await mkdtemp(join(tmpdir(), "tmct-cfg-cwd-"));
  try {
    const s = await createSession({ env: { TMCT_GRAPH_FILE: graphPath, TMCT_NO_SEED: "1" }, cwd, gitRoot: () => null });
    assert.equal(s.config.graphFile, graphPath, "the env graph is loaded");
    assert.equal(s.moduleCount, 8, "and it really loaded (8 fixture modules)");
    assert.equal(s.repo, cwd, "logs/memory still target the repo (cwd), not the graph's dir");
    await s.close();
  } finally {
    clearCache();
    await rm(alt, { recursive: true, force: true });
    await rm(cwd, { recursive: true, force: true });
  }
});

test("--repo takes precedence over TMCT_GRAPH_FILE", async () => {
  clearCache();
  const repo = await mkdtemp(join(tmpdir(), "tmct-cfg-repo-"));
  await mkdir(join(repo, ".tmct"), { recursive: true });
  await writeFile(join(repo, ".tmct", "graph.json"), await readFile(FIXTURE, "utf8"));
  try {
    const s = await createSession({ repoPath: repo, env: { TMCT_GRAPH_FILE: "/somewhere/else/graph.json", TMCT_NO_SEED: "1" } });
    assert.equal(s.config.graphFile, join(repo, ".tmct", "graph.json"), "--repo wins over the env var");
    await s.close();
  } finally {
    clearCache();
    await rm(repo, { recursive: true, force: true });
  }
});

test("moduleCountOf: null/empty graph counts 0, the populated fixture counts 8", async () => {
  clearCache();
  assert.equal(moduleCountOf(null), 0);
  assert.equal(moduleCountOf({ individuals: [] }), 0);
  assert.equal(moduleCountOf(parseEntities(await source.fetchEntities({ graphFile: FIXTURE }))), 8);
});
