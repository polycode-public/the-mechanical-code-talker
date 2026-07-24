// The Python backend proves the registry is multi-language: extract_ast.py runs
// as a subprocess (stdlib ast, zero npm dependency), emits the same module
// contract the in-process JS/TS extractor does, and its graph passes the
// Repository-Interface conformance kit. Skips when no python3 is available.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { extractRepo, assembleEntities } from "../../src/index/index-repo.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { createGraphService } from "../../src/adapters/providers/graph-service.mjs";
import { ask } from "../../src/domain/ask.mjs";
import { runConformance } from "../../src/tools/conformance.mjs";

const PYTHON = process.env.TMCT_PYTHON || "python3";
const hasPython = spawnSync(PYTHON, ["--version"]).status === 0;
const REPO = fileURLToPath(new URL("../fixtures/py-repo", import.meta.url));

if (hasPython) {
  const raw = await extractRepo(REPO, { historyDepth: 0 });
  const entities = assembleEntities({ modules: raw.modules, generatedAt: "2026-01-01T00:00:00.000Z" });

  runConformance("python-produced-graph", () => createGraphService(parseEntities(entities), { ask }));

  const edgesFor = (predicate) =>
    (entities.objectProperties.find((g) => g.predicate === predicate)?.examples || [])
      .map((e) => `${e.subjectLabel}->${e.objectLabel}`);

  test("the python backend reads every .py module in the repo", () => {
    const paths = raw.modules.map((m) => m.path).sort();
    assert.deepEqual(paths, ["pkg/__init__.py", "pkg/app.py", "pkg/core.py", "pkg/test_app.py"]);
  });

  test("a relative from-import resolves to an internal module import edge", () => {
    assert.ok(edgesFor("imports").includes("pkg/app.py->pkg/core.py"), `got ${JSON.stringify(edgesFor("imports"))}`);
  });

  test("a test_*.py module lands on the tests-coverage relation", () => {
    assert.ok(edgesFor("tests").includes("pkg/test_app.py->pkg/app.py"));
  });

  test("class inheritance across modules resolves to an internal inherits edge", () => {
    assert.ok(edgesFor("inherits").includes("App->Base"), `got ${JSON.stringify(edgesFor("inherits"))}`);
  });

  test("a unique-named callee resolves to a symbol-granular call edge", () => {
    assert.ok(edgesFor("callsSymbol").includes("App.run->core_fn"), `got ${JSON.stringify(edgesFor("callsSymbol"))}`);
  });
} else {
  test("python backend tests skipped — no python3 interpreter available", { skip: true }, () => {});
}
