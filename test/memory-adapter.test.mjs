// The provider adapter seam (ROADMAP item 14, docs/adapter-contract.md):
// registerProvider() feeds the engine without any file, the default file
// loader survives a provider round-trip, and the write-ownership boundary
// holds — provider payloads are read-only input, memory goes to .tmct/memory/.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchEntities, registerProvider, clearCache, emptyEntities } from "../src/source.mjs";
import { parseEntities, resolveSymbol } from "../src/codegraph.mjs";
import { ToolError } from "../src/config.mjs";

/** A tiny in-memory provider payload in the contract's entities shape. */
function providerPayload() {
  return {
    generated_at: "2026-07-04T00:00:00.000Z",
    classes: [{ name: "Module", count: 2, sample: ["pkg/alpha.py", "pkg/beta.py"] }],
    vocabulary: [{ prop: "mgx:importsNamespace", predicate: "imports" }],
    objectProperties: [{ predicate: "imports", prop: "mgx:importsNamespace", count: 1,
      examples: [{ subject: "mod:pkg/beta.py", object: "mod:pkg/alpha.py", subjectLabel: "pkg/beta.py", objectLabel: "pkg/alpha.py" }] }],
    individuals: [
      { id: "mod:pkg/alpha.py", label: "pkg/alpha.py", class: "Module", derived_from: [], mentions: [], attributes: [] },
      { id: "mod:pkg/beta.py", label: "pkg/beta.py", class: "Module", derived_from: [], mentions: [], attributes: [] },
    ],
    proseIndex: { alpha: ["mod:pkg/alpha.py"] },
  };
}

test("registerProvider: a custom loader feeds the engine — no file on disk anywhere", async (t) => {
  const calls = [];
  const prev = registerProvider((config) => {
    calls.push(config.graphFile);
    return providerPayload();
  });
  t.after(() => { registerProvider(prev); clearCache(); });

  const config = { graphFile: "/nowhere/at/all/graph.json" }; // would be ENOENT-bootstrap without the provider
  const payload = await fetchEntities(config);
  assert.equal(payload.bootstrap, undefined, "the provider answered, not the bootstrap");
  assert.deepEqual(calls, [config.graphFile], "the provider receives the config");

  // the payload runs the ACTUAL engine loader + a real query primitive
  const graph = parseEntities(payload);
  assert.equal(graph.byId.size, 2);
  assert.equal(graph.relations[0].predicate, "imports");
  assert.deepEqual(graph.proseIndex, { alpha: ["mod:pkg/alpha.py"] }, "proseIndex passes through byte-identical");
  const hit = resolveSymbol(graph, "pkg/alpha.py");
  assert.equal(hit.match.id, "mod:pkg/alpha.py", "symbol resolution works over provider-fed data");

  // provider results are never cached: a live provider is consulted every fetch
  await fetchEntities(config);
  assert.equal(calls.length, 2);
});

test("registerProvider: async providers work; failures and junk results become clean ToolErrors", async (t) => {
  const prev = registerProvider(async () => providerPayload());
  t.after(() => { registerProvider(prev); clearCache(); });
  assert.equal((await fetchEntities({ graphFile: "x" })).individuals.length, 2, "async provider awaited");

  registerProvider(() => { throw new Error("index server down"); });
  await assert.rejects(() => fetchEntities({ graphFile: "x" }),
    (e) => e instanceof ToolError && /graph provider failed \(index server down\)/.test(e.message));

  registerProvider(() => "not a payload");
  await assert.rejects(() => fetchEntities({ graphFile: "x" }),
    (e) => e instanceof ToolError && /returned no entities payload/.test(e.message));

  assert.throws(() => registerProvider("nope"), /expects a function/);
});

test("registerProvider(null): restores the default file loader (bootstrap-empty on a missing artifact)", async (t) => {
  const prev = registerProvider(() => providerPayload());
  t.after(() => { registerProvider(prev); clearCache(); });
  const custom = registerProvider(null);
  assert.equal(typeof custom, "function", "the previous provider is handed back for wrappers to restore");

  const payload = await fetchEntities({ graphFile: "/nowhere/at/all/graph.json" });
  assert.equal(payload.bootstrap, true, "back on the default loader: ENOENT → bootstrap payload");
  assert.deepEqual(payload.individuals, []);
});

test("write-ownership boundary: the engine never mutates a provider's payload arrays into new shapes", async (t) => {
  // parseEntities + a query must leave the provider's payload structurally intact —
  // tmct treats provider data as read-only input (docs/adapter-contract.md §5).
  const payload = providerPayload();
  const before = JSON.stringify(payload);
  const prev = registerProvider(() => payload);
  t.after(() => { registerProvider(prev); clearCache(); });
  const graph = parseEntities(await fetchEntities({ graphFile: "x" }));
  resolveSymbol(graph, "alpha");
  assert.equal(JSON.stringify(payload), before, "read-only: no field added, dropped or reordered");
  assert.equal(emptyEntities().bootstrap, true, "and the bootstrap payload stays provider-shaped");
});
