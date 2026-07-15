// ask-class-display.test.mjs — classDisplayName: a class enum rendered as
// prose words wherever ask.mjs must name the enum itself rather than a
// curated PLURAL_FORMS noun. "GlobalVariable" was leaking into traversal
// receipts verbatim, glued into one word; it must render "global variable".
// Byte-exact unit checks plus an end-to-end receipt check through ask() on a
// real buildEntities/parseEntities graph.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildEntities } from "../src/graph-build.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import { ingestSchemaDocs } from "../src/schema-docs.mjs";
import { ask, classDisplayName } from "../src/ask.mjs";

test("classDisplayName splits a camel-case enum into lowercase words, byte-exact", () => {
  assert.equal(classDisplayName("GlobalVariable"), "global variable");
  assert.equal(classDisplayName("Module"), "module");
  assert.equal(classDisplayName("Class"), "class");
  assert.equal(classDisplayName("SchemaPredicate"), "schema predicate");
});

test("classDisplayName leaves nothing behind on empty input", () => {
  assert.equal(classDisplayName(""), "");
  assert.equal(classDisplayName(null), "");
});

const MODULES = [
  { path: "src/config.mjs", dotted: "src.config", imports: [], calls: [],
    defines: [{ name: "MAX_RETRIES", kind: "global", lineno: 1, decorators: [] }] },
  { path: "src/user.mjs", dotted: "src.user", imports: [], calls: [],
    defines: [{ name: "User", kind: "class", lineno: 1, decorators: [] }] },
  // a real inherits edge, so the inherits kind's object class (Class) is
  // derivable and the wrong-grain check below actually fires.
  { path: "src/admin.mjs", dotted: "src.admin", imports: ["src.user"], calls: [],
    defines: [{ name: "Admin", kind: "class", lineno: 1, decorators: [], bases: ["User"] }] },
];

function buildGraph() {
  const entities = buildEntities(MODULES, [], {});
  ingestSchemaDocs(entities);
  return parseEntities(entities);
}

test("a wrong-grain receipt names 'global variable', never the raw GlobalVariable enum", () => {
  const graph = buildGraph();
  // MAX_RETRIES resolves to a GlobalVariable, but an inherits question needs a
  // Class — the honest wrong-grain miss whose receipt used to glue the enum.
  const r = ask(graph, "which classes inherit from MAX_RETRIES");
  assert.equal(r.tmct_ask.miss, true);
  assert.match(r.tmct_ask.traversal, /resolved to global variable MAX_RETRIES/);
  assert.doesNotMatch(r.tmct_ask.traversal, /GlobalVariable/);
  assert.doesNotMatch(r.content, /GlobalVariable/);
});
