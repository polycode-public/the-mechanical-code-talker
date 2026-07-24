// The JS/TS producer proves the seam end to end: real .mjs source off disk →
// extractRepo → buildEntities (via assembleEntities) → parseEntities →
// createGraphService PASSES the full Repository-Interface conformance kit, with
// no change to the interface itself. Both a graph-only and a source-capable
// provider are run, the latter reading real bodies over the real line spans the
// extractor emitted.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { extractRepo, assembleEntities } from "../../src/index/index-repo.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { createGraphService } from "../../src/adapters/providers/graph-service.mjs";
import { ask } from "../../src/domain/ask.mjs";
import { runConformance } from "../../src/tools/conformance.mjs";

const REPO = fileURLToPath(new URL("../fixtures/js-repo", import.meta.url));

// historyDepth:0 keeps the fixture git-independent (it ships as plain files, not a
// checkout) — the seam this proves is parsing → assembly → interface, not git.
const raw = await extractRepo(REPO, { historyDepth: 0 });
const entities = assembleEntities({ modules: raw.modules, generatedAt: "2026-01-01T00:00:00.000Z" });

// The conformance kit, run against a graph produced from real source. This is the
// Phase-1 exit criterion.
runConformance("js-produced-graph", () => createGraphService(parseEntities(entities), { ask }));
runConformance("js-produced-graph-source-capable", () =>
  createGraphService(parseEntities(entities), { sourceAccess: true, repoRoot: REPO, readFile, ask }));

const modByPath = new Map(raw.modules.map((m) => [m.path, m]));
const edgesFor = (predicate) =>
  (entities.objectProperties.find((g) => g.predicate === predicate)?.examples || []);

test("the extractor reads every source module off disk with a path-style dotted name", () => {
  const paths = raw.modules.map((m) => m.path).sort();
  assert.deepEqual(paths, ["src/base.mjs", "src/graph.mjs", "src/widget.mjs", "test/widget.test.mjs"]);
  assert.equal(modByPath.get("src/widget.mjs").dotted, "src/widget");
});

test("ESM import specifiers resolve to internal module import edges", () => {
  const imports = edgesFor("imports").map((e) => `${e.subjectLabel}->${e.objectLabel}`);
  assert.ok(imports.includes("src/widget.mjs->src/base.mjs"), "widget imports base");
  assert.ok(imports.includes("src/widget.mjs->src/graph.mjs"), "widget imports graph");
});

test("a test module's import lands on the tests-coverage relation, not imports", () => {
  const tests = edgesFor("tests").map((e) => `${e.subjectLabel}->${e.objectLabel}`);
  assert.ok(tests.includes("test/widget.test.mjs->src/widget.mjs"));
});

test("class heritage resolves to an internal inherits edge when the base is imported and unique", () => {
  const inherits = edgesFor("inherits").map((e) => `${e.subjectLabel}->${e.objectLabel}`);
  assert.ok(inherits.some((s) => s === "Widget->Base"), `got ${JSON.stringify(inherits)}`);
});

test("a unique-named callee resolves to a symbol-granular call edge", () => {
  const calls = edgesFor("callsSymbol").map((e) => `${e.subjectLabel}->${e.objectLabel}`);
  assert.ok(calls.includes("Widget.render->parseNode"), `got ${JSON.stringify(calls)}`);
});

test("real bodies are readable through a source-capable service over the emitted line spans", async () => {
  const svc = createGraphService(parseEntities(entities), { sourceAccess: true, repoRoot: REPO, readFile, ask });
  const parseNodeId = entities.individuals.find((i) => i.label === "parseNode")?.id;
  assert.ok(parseNodeId, "parseNode individual exists");
  const r = await svc.snippet(parseNodeId);
  assert.equal(r.ok, true, "snippet is a hit, not NO_SOURCE");
  assert.match(r.value.body, /function parseNode\(node, depth = 0\)/);
});
