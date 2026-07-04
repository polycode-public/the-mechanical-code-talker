// temporal P3 tests — keyboard graph-nav's pure neighbour lookup and ghost-branch
// merge shape on the temporal graph. Pure functions, no I/O; the generated browser
// page inlines this exact source, so these tests ARE the page's logic tests (P1
// convention). Git-repo-backed tests (gitCommitParents, the live-poll route) live
// in browser-p3.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { neighborsOf } from "../src/temporal.mjs";
import { buildTemporalGraph } from "../src/browser.mjs";

// a -> b -> c, and a -> c directly (so 'a' has two distinct out-neighbours,
// 'c' has two distinct in-neighbours); a touchesSymbol edge must never surface.
const TG = {
  nodes: [{ id: "a" }, { id: "b" }, { id: "c" }],
  edges: [
    { src: "a", dst: "b", kind: "calls" },
    { src: "b", dst: "c", kind: "calls" },
    { src: "a", dst: "c", kind: "imports" },
    { src: "commit:x", dst: "a", kind: "touchesSymbol" },
  ],
};

test("neighborsOf: out-direction is sorted, deduped, excludes touchesSymbol", () => {
  assert.deepEqual(neighborsOf(TG, "a", "out"), ["b", "c"]);
});

test("neighborsOf: in-direction, and touchesSymbol never leaks in either direction", () => {
  assert.deepEqual(neighborsOf(TG, "c", "in"), ["a", "b"]);
  assert.deepEqual(neighborsOf(TG, "a", "in"), []); // only a touchesSymbol edge points at 'a'
});

test("neighborsOf: no self-loops, empty graph, unknown node all return []", () => {
  const selfLoop = { nodes: [{ id: "a" }], edges: [{ src: "a", dst: "a", kind: "calls" }] };
  assert.deepEqual(neighborsOf(selfLoop, "a", "out"), []);
  assert.deepEqual(neighborsOf({ nodes: [], edges: [] }, "a", "out"), []);
  assert.deepEqual(neighborsOf(TG, "nope", "out"), []);
});

// ---- ghost-branch merges (P3 build-time shape) --------------------------------

const MERGE_RAW = {
  individuals: [
    { id: "mod:m.py", label: "m.py", class: "Module", attributes: [] },
    { id: "commit:root", label: "root", class: "Commit",
      attributes: [{ key: "author", value: "ada" }, { key: "date", value: "2026-01-01" }, { key: "message", value: "root" }] },
    { id: "commit:feature", label: "feature", class: "Commit",
      attributes: [{ key: "author", value: "ada" }, { key: "date", value: "2026-01-02" }, { key: "message", value: "feature work" }] },
    { id: "commit:merge", label: "merge", class: "Commit",
      attributes: [{ key: "author", value: "ada" }, { key: "date", value: "2026-01-03" }, { key: "message", value: "Merge branch feature" }] },
  ],
  objectProperties: [
    { prop: "mgx:touchessymbol", examples: [{ subject: "commit:root", object: "mod:m.py" }] },
  ],
};

test("buildTemporalGraph: a merge commit's TRACKED parents become jump-able ordinals", () => {
  const order = ["root", "feature", "merge"];
  const parentsBySha = new Map([
    ["feature", ["root"]],
    ["merge", ["feature", "root"]], // both parents tracked
  ]);
  const tg = buildTemporalGraph(MERGE_RAW, order, { parentsBySha });
  const [root, feature, merge] = tg.commits;
  assert.equal(root.merge, false);
  assert.deepEqual(root.parentIdx, []);
  assert.equal(feature.merge, false); // one parent — not a merge
  assert.deepEqual(feature.parentIdx, [0]);
  assert.equal(merge.merge, true);
  assert.deepEqual(merge.parentIdx.sort(), [0, 1]);
  assert.equal(merge.ghostParents, 0);
});

test("buildTemporalGraph: an UNTRACKED parent counts as a ghost, not a broken reference", () => {
  const order = ["root", "merge"]; // 'feature' never touched a tracked symbol — absent from order
  const parentsBySha = new Map([["merge", ["root", "feature-untracked-sha"]]]);
  const tg = buildTemporalGraph(MERGE_RAW, order, { parentsBySha });
  const merge = tg.commits.find((c) => c.sha === "merge");
  assert.equal(merge.merge, true); // 1 tracked + 1 ghost = 2 parents, still a merge
  assert.deepEqual(merge.parentIdx, [0]);
  assert.equal(merge.ghostParents, 1);
});

test("buildTemporalGraph: no parentsBySha (old call shape) — every commit is merge:false", () => {
  const tg = buildTemporalGraph(MERGE_RAW, ["root", "feature", "merge"]);
  for (const c of tg.commits) {
    assert.equal(c.merge, false);
    assert.deepEqual(c.parentIdx, []);
    assert.equal(c.ghostParents, 0);
  }
});
