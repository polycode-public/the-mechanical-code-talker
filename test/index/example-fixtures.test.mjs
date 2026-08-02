// The two small example codebases under examples/ — tiny-webapp-src (JS/TS) and
// tiny-lib-py (Python) — exist for two future uses: indexing demos, and
// PLAN_CODE_PLANNING.md Track 5's first milestone (a planned rename-then-move refactor of
// tiny-webapp-src's parseRow, verified by the fixture's own test suite). This
// proves both index cleanly today, that the graph sees parseRow's exact two call
// sites the milestone depends on, and that each fixture's own test suite passes
// standalone. The Python half skips gracefully when python3 is absent, the same
// pattern test/index/python-extractor.test.mjs uses.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { extractRepo, assembleEntities } from "../../src/index/index-repo.mjs";

const WEBAPP_REPO = fileURLToPath(new URL("../../examples/tiny-webapp-src/", import.meta.url));
const PYLIB_REPO = fileURLToPath(new URL("../../examples/tiny-lib-py/", import.meta.url));
const PYTHON = process.env.TMCT_PYTHON || "python3";
const hasPython = spawnSync(PYTHON, ["--version"]).status === 0;

// NODE_TEST_CONTEXT is set on this file's own process by the outer `node --test`
// run; a plain `node --test` spawned as a subprocess without stripping it treats
// itself as a recursive test run and silently skips everything it was asked to
// run — so a spawned test-suite child never inherits this env var.
//
// FORCE_COLOR is dropped rather than overridden to "0": Node's own colour
// decision treats any FORCE_COLOR key as a forced-on signal regardless of its
// value and then ignores NO_COLOR outright, so the key has to be absent, not
// falsy. NO_COLOR is then added because a caller's real terminal session (or
// npm forwarding its own colour choice into a lifecycle script) can otherwise
// hand the fixture's own test runner colour and break the anchored regexes
// below that assert against its captured stdout.
const CHILD_ENV = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k !== "NODE_TEST_CONTEXT" && k !== "FORCE_COLOR")),
  NO_COLOR: "1",
};

const edgesFor = (entities, predicate) =>
  (entities.objectProperties.find((g) => g.predicate === predicate)?.examples || [])
    .map((e) => `${e.subjectLabel}->${e.objectLabel}`);

// --- tiny-webapp-src (JS/TS backend) ---------------------------------------

const webappRaw = await extractRepo(WEBAPP_REPO, { historyDepth: 0 });
const webappEntities = assembleEntities({ modules: webappRaw.modules, generatedAt: "2026-01-01T00:00:00.000Z" });

test("the JS/TS backend indexes every module in tiny-webapp-src", () => {
  const paths = webappRaw.modules.map((m) => m.path).sort();
  assert.deepEqual(paths, [
    "app.mjs",
    "lib/parse.mjs",
    "lib/render.mjs",
    "lib/store.mjs",
    "test/app.test.mjs",
    "test/parse.test.mjs",
    "test/render.test.mjs",
    "test/store.test.mjs",
    "util/format.mjs",
  ]);
});

test("parseRow's two call sites, in two different modules, resolve as symbol-granular call edges", () => {
  const calls = edgesFor(webappEntities, "callsSymbol");
  const callersOfParseRow = calls.filter((e) => e.endsWith("->parseRow"));
  assert.deepEqual(callersOfParseRow.sort(), ["loadRows->parseRow", "previewFirstRow->parseRow"]);
});

test("cross-module structure: imports, coarse calls, and test coverage all resolve", () => {
  const imports = edgesFor(webappEntities, "imports");
  assert.ok(imports.includes("lib/store.mjs->lib/parse.mjs"), "store imports parse");
  assert.ok(imports.includes("lib/render.mjs->util/format.mjs"), "render imports format");
  const tests = edgesFor(webappEntities, "tests");
  assert.ok(tests.includes("test/store.test.mjs->lib/store.mjs"));
  assert.ok(tests.includes("test/app.test.mjs->app.mjs"));
});

test("tiny-webapp-src's own test suite passes standalone", () => {
  const testFiles = readdirSync(join(WEBAPP_REPO, "test"))
    .filter((f) => f.endsWith(".test.mjs"))
    .sort();
  assert.ok(testFiles.length > 0, "the fixture ships at least one test file");
  const result = spawnSync(process.execPath, ["--test", ...testFiles.map((f) => `test/${f}`)],
    { cwd: WEBAPP_REPO, encoding: "utf8", env: CHILD_ENV });
  assert.equal(result.status, 0, `node --test exited ${result.status}\n${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /^ℹ fail 0$/m, `expected zero failures\n${result.stdout}`);
});

// --- tiny-lib-py (Python backend) -------------------------------------------

if (hasPython) {
  const pylibRaw = await extractRepo(PYLIB_REPO, { historyDepth: 0 });
  const pylibEntities = assembleEntities({ modules: pylibRaw.modules, generatedAt: "2026-01-01T00:00:00.000Z" });

  test("the Python backend indexes every module in tiny-lib-py", () => {
    const paths = pylibRaw.modules.map((m) => m.path).sort();
    assert.deepEqual(paths, [
      "pkg/__init__.py",
      "pkg/core.py",
      "pkg/inventory.py",
      "pkg/report.py",
      "pkg/test_core.py",
      "pkg/test_inventory.py",
    ]);
  });

  test("cross-module imports and test coverage resolve for the Python fixture", () => {
    const imports = edgesFor(pylibEntities, "imports");
    assert.ok(imports.includes("pkg/inventory.py->pkg/core.py"), "inventory imports core");
    assert.ok(imports.includes("pkg/report.py->pkg/inventory.py"), "report imports inventory");
    const tests = edgesFor(pylibEntities, "tests");
    assert.ok(tests.includes("pkg/test_core.py->pkg/core.py"));
    assert.ok(tests.includes("pkg/test_inventory.py->pkg/inventory.py"));
  });

  test("tiny-lib-py's own unittest suite passes standalone", () => {
    const result = spawnSync(PYTHON, ["-m", "unittest", "discover"], { cwd: PYLIB_REPO, encoding: "utf8", env: CHILD_ENV });
    assert.equal(result.status, 0, `python3 -m unittest discover exited ${result.status}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stderr, /^OK$/m, `expected a clean unittest run\n${result.stderr}`);
  });
} else {
  test("tiny-lib-py assertions skipped — no python3 interpreter available", { skip: true }, () => {});
}
