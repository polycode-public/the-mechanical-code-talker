// Unit tests for src/config.mjs — loadConfig's graphFile resolution.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isAbsolute, join } from "node:path";
import { loadConfig, DEFAULT_GRAPH_REL } from "../src/config.mjs";

test("loadConfig: default graphFile (no env var) is absolute, joined onto cwd", () => {
  const cfg = loadConfig({}, "/some/repo");
  assert.equal(cfg.graphFile, join("/some/repo", DEFAULT_GRAPH_REL));
  assert.ok(isAbsolute(cfg.graphFile));
});

test("loadConfig: an ABSOLUTE TMCT_GRAPH_FILE is used verbatim", () => {
  const cfg = loadConfig({ TMCT_GRAPH_FILE: "/abs/path/graph.json" }, "/some/repo");
  assert.equal(cfg.graphFile, "/abs/path/graph.json");
});

test("loadConfig: a RELATIVE TMCT_GRAPH_FILE is resolved against cwd, not used verbatim", () => {
  // Regression: a relative TMCT_GRAPH_FILE used to be returned as-is, so every downstream
  // repoRoot (dirname(dirname(config.graphFile))) stayed relative too — which made
  // src/source-slice.mjs's path-traversal guard reject every legitimate read (resolve()
  // is always absolute, so a relative repoRoot could never equal/be-a-prefix-of it).
  const cfg = loadConfig({ TMCT_GRAPH_FILE: "myrepo/.tmct/graph.json" }, "/some/cwd");
  assert.equal(cfg.graphFile, join("/some/cwd", "myrepo/.tmct/graph.json"));
  assert.ok(isAbsolute(cfg.graphFile));
});

test("loadConfig: a blank/whitespace-only TMCT_GRAPH_FILE falls back to the default", () => {
  const cfg = loadConfig({ TMCT_GRAPH_FILE: "   " }, "/some/repo");
  assert.equal(cfg.graphFile, join("/some/repo", DEFAULT_GRAPH_REL));
});
