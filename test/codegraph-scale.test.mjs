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

// ---- edgesOfKind memoization (perf lever, HANDOVER follow-up #8: latency/GC on
// monorepo-scale graphs, not a correctness fix) — per (graph, kind) via a WeakMap,
// mirroring qualCache's (ask.mjs) established per-graph-object caching convention. ----

test("edgesOfKind cache correctness: a 2nd call returns the SAME array (memoized, not recomputed) with byte-identical content", () => {
  const graph = {
    relations: [
      { prop: "mgx:importsNamespace", predicate: "imports namespace", edges: [{ s: "mod:a.mjs", o: "mod:b.mjs" }] },
      { prop: "mgx:callsCoarse", predicate: "calls coarse", edges: [{ s: "mod:x.mjs", o: "mod:y.mjs" }] },
    ],
  };
  const first = edgesOfKind(graph, "imports");
  const second = edgesOfKind(graph, "imports");
  assert.equal(first, second, "the 2nd call must return the exact same array reference, proving the cache fired");
  assert.deepEqual(second, [{ s: "mod:a.mjs", o: "mod:b.mjs" }]);
  // a different kind on the SAME graph gets its own cache entry, not a stale reuse
  const calls = edgesOfKind(graph, "calls");
  assert.notEqual(calls, first);
  assert.deepEqual(calls, [{ s: "mod:x.mjs", o: "mod:y.mjs" }]);
});

test("edgesOfKind cache correctness: two DISTINCT graph objects never share a cache entry (WeakMap keyed on graph identity)", () => {
  const mk = (s, o) => ({ relations: [{ prop: "mgx:importsNamespace", predicate: "imports namespace", edges: [{ s, o }] }] });
  const g1 = mk("mod:a.mjs", "mod:b.mjs");
  const g2 = mk("mod:c.mjs", "mod:d.mjs");
  const r1 = edgesOfKind(g1, "imports");
  const r2 = edgesOfKind(g2, "imports");
  assert.notEqual(r1, r2);
  assert.deepEqual(r1, [{ s: "mod:a.mjs", o: "mod:b.mjs" }]);
  assert.deepEqual(r2, [{ s: "mod:c.mjs", o: "mod:d.mjs" }]);
  // re-querying g1 still returns ITS OWN cached array, unaffected by g2's calls in between
  assert.equal(edgesOfKind(g1, "imports"), r1);
});

test("edgesOfKind perf-sanity: a 2nd call over a ~200k-edge group is dramatically faster than the 1st (cache hit vs. full scan)", () => {
  const N = 200_000;
  const edges = new Array(N);
  for (let i = 0; i < N; i++) edges[i] = { s: `mod:src/a${i}.mjs`, o: `mod:src/b${i}.mjs` };
  const graph = { relations: [{ prop: "mgx:importsNamespace", predicate: "imports namespace", edges }] };

  const t0 = performance.now();
  const first = edgesOfKind(graph, "imports");
  const firstMs = performance.now() - t0;

  const t1 = performance.now();
  const second = edgesOfKind(graph, "imports");
  const secondMs = performance.now() - t1;

  assert.equal(first, second, "the 2nd call is a cache hit, not a recompute");
  assert.equal(second.length, N);
  // the cache hit is an O(1) Map.get vs. the 1st call's O(relations) scan — assert it's
  // at least an order of magnitude faster (generous margin against CI/machine noise; a
  // real recompute of 200k edges is never this cheap on any machine this suite runs on).
  assert.ok(secondMs < firstMs / 5 || secondMs < 1,
    `2nd (cached) call should be far faster than the 1st (scan): 1st=${firstMs.toFixed(3)}ms 2nd=${secondMs.toFixed(3)}ms`);
});
