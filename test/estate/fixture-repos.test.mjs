// The corpus-lane fixture repos commit a pre-built graph.json each (rows read
// them through a real createSession). This regenerates every one from its
// committed module spec through the real graph builder and asserts the
// committed JSON still matches — a fixture can never silently drift from what
// buildEntities()+ingestSchemaDocs() actually produce today.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildEntities } from "../../src/graph-build.mjs";
import { ingestSchemaDocs } from "../../src/schema-docs.mjs";
import { FIXTURE_REPO_MODULES } from "../fixtures/repos/modules.mjs";

const REPOS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "repos");

test("every generated fixture repo's graph.json matches a fresh buildEntities run over its module spec", () => {
  for (const [name, modules] of Object.entries(FIXTURE_REPO_MODULES)) {
    const rebuilt = buildEntities(modules, [], {});
    ingestSchemaDocs(rebuilt);
    const committed = JSON.parse(readFileSync(path.join(REPOS_DIR, name, "graph.json"), "utf8"));
    assert.deepEqual(committed, JSON.parse(JSON.stringify(rebuilt)), `fixture repo "${name}" drifted from buildEntities output`);
  }
});

test("every fixture repo directory carries a tmct.toml whose graph_file resolves to a committed graph", () => {
  for (const name of Object.keys(FIXTURE_REPO_MODULES)) {
    const toml = readFileSync(path.join(REPOS_DIR, name, "tmct.toml"), "utf8");
    const m = /graph_file\s*=\s*"([^"]+)"/.exec(toml);
    assert.ok(m, `${name}/tmct.toml declares graph_file`);
    assert.ok(existsSync(path.resolve(REPOS_DIR, name, m[1])), `${name}: graph_file target exists`);
  }
  // the two reference repos point at fixtures committed elsewhere
  for (const name of ["entities", "camelcase"]) {
    const toml = readFileSync(path.join(REPOS_DIR, name, "tmct.toml"), "utf8");
    const m = /graph_file\s*=\s*"([^"]+)"/.exec(toml);
    assert.ok(m && existsSync(path.resolve(REPOS_DIR, name, m[1])), `${name}: graph_file target exists`);
  }
});
