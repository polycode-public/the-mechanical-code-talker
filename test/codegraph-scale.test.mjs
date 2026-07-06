// Scale regression (0.8.2 WS4 hotfix): edgesOfKind must not blow the call stack on
// graph-sized relation groups. Live report from a 27,770-module repo: "list modules
// in <dir>" → "Maximum call stack size exceeded", caused by `out.push(...g.edges)` —
// argument spread materialises every element as a call argument and overflows past
// ~100k elements. The fix is a plain-loop append; this test pins it with a synthetic
// in-memory graph (construction only — no fixture file, no disk).
import { test } from "node:test";
import assert from "node:assert/strict";
import { edgesOfKind } from "../src/codegraph.mjs";

test("edgesOfKind survives a single relation group of ~200k edges (no spread stack overflow)", () => {
  const N = 200_000;
  const edges = new Array(N);
  for (let i = 0; i < N; i++) edges[i] = { s: `mod:src/a${i}.mjs`, o: `mod:src/b${i}.mjs` };
  const graph = {
    relations: [
      { prop: "mgx:importsNamespace", predicate: "imports namespace", edges },
      // a second, differently-classified group proves the kind filter still applies
      { prop: "mgx:callsCoarse", predicate: "calls coarse", edges: [{ s: "mod:x.mjs", o: "mod:y.mjs" }] },
    ],
  };
  let out;
  assert.doesNotThrow(() => { out = edgesOfKind(graph, "imports"); });
  assert.equal(out.length, N);
  assert.deepEqual(out[0], edges[0]);
  assert.deepEqual(out[N - 1], edges[N - 1]);
  assert.equal(edgesOfKind(graph, "calls").length, 1);
});
