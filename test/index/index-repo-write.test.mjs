// The producer's WRITE path: indexRepository walks a real repo, writes
// <repo>/.tmct/graph.json, and the artifact reads back through the same provider
// seam (fetchEntities) the CLI's chat/serve/cli routes use — answering a real
// structural query end to end, with no hand-built graph anywhere.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { indexRepository } from "../../src/index/index-repo.mjs";
import { fetchEntities, clearCache } from "../../src/adapters/source.mjs";
import { loadConfig } from "../../src/adapters/config.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { createGraphService } from "../../src/adapters/providers/graph-service.mjs";
import { ask } from "../../src/domain/ask.mjs";
import { isHit } from "../../src/adapters/repository-interface.mjs";

async function makeRepo() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-index-"));
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "src", "core.mjs"),
    "export function coreFn() { return 1; }\nexport const LIMIT = 10;\n");
  await writeFile(join(dir, "src", "app.mjs"),
    "import { coreFn } from './core.mjs';\nexport function run() { return coreFn(); }\n");
  return dir;
}

test("indexRepository writes a graph.json the provider seam reads back into a real query hit", async () => {
  const dir = await makeRepo();
  try {
    const stats = await indexRepository(dir, { historyDepth: 0, generatedAt: "2026-01-01T00:00:00.000Z" });
    assert.equal(stats.modules, 2);
    assert.ok(stats.graphFile.endsWith(join(".tmct", "graph.json")));

    clearCache();
    const config = loadConfig({ TMCT_GRAPH_FILE: stats.graphFile }, dir);
    const payload = await fetchEntities(config);
    const svc = createGraphService(parseEntities(payload), { ask });

    const arch = await svc.architecture({});
    assert.ok(isHit(arch), "architecture answers over the produced graph");
    const resolved = await svc.resolve("coreFn");
    assert.ok(isHit(resolved), "resolve finds a produced top-level symbol by name");

    const importEdges = (payload.objectProperties.find((g) => g.predicate === "imports")?.examples || [])
      .map((e) => `${e.subjectLabel}->${e.objectLabel}`);
    assert.ok(importEdges.includes("src/app.mjs->src/core.mjs"), `got ${JSON.stringify(importEdges)}`);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("indexing the same source twice with a pinned timestamp is byte-identical", async () => {
  const dir = await makeRepo();
  try {
    await indexRepository(dir, { historyDepth: 0, generatedAt: "2026-01-01T00:00:00.000Z" });
    const first = await readFile(join(dir, ".tmct", "graph.json"), "utf8");
    await indexRepository(dir, { historyDepth: 0, generatedAt: "2026-01-01T00:00:00.000Z" });
    const second = await readFile(join(dir, ".tmct", "graph.json"), "utf8");
    assert.equal(first, second, "a deterministic producer emits a byte-stable artifact");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
