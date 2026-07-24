// The commit-filter lane registers into the session's discourse record: after
// "what changed before <sha>" the record holds the result SET (every member
// id, with count/op/pivot) and the pivot commit as a dated EVENT — the typed
// content the rendered sentence flattens away. Driven through runTurn against
// the committed mini-webapp example graph, read-only (no memoryDir, no
// session shell), so nothing on disk is touched.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { runTurn } from "../../src/services/chat.mjs";
import { emptyRecord } from "../../src/domain/discourse.mjs";

const GRAPH_FILE = join(new URL("../..", import.meta.url).pathname, "examples", "mini-webapp", ".tmct", "graph.json");

async function miniWebappGraph() {
  return parseEntities(JSON.parse(await readFile(GRAPH_FILE, "utf8")));
}

test("a commit-filter turn fills the discourse record with a set referent and the dated pivot event", async () => {
  const graph = await miniWebappGraph();
  const r = await runTurn("what changed before 1b2c3d4e5f60", {
    config: { graphFile: GRAPH_FILE }, graph, discourse: emptyRecord(),
  });
  assert.match(String(r.answer), /^7 commit\(s\) changed before 1b2c3d4e5f60:/);
  assert.ok(r.discourse, "the record rides the turn result");
  assert.equal(r.discourse.turn, 1, "the dispatched turn advanced the counter");
  assert.equal(r.discourse.referents.length, 2);
  const set = r.discourse.referents.find((x) => x.kind === "set");
  const event = r.discourse.referents.find((x) => x.kind === "event");
  assert.ok(set && event);
  assert.equal(set.class, "Commit");
  assert.equal(set.ids.length, 7, "the set carries every member id, not the rendered cap");
  assert.deepEqual({ count: set.attrs.count, op: set.attrs.op, pivot: set.attrs.pivot },
    { count: 7, op: "before", pivot: "commit:1b2c3d4e5f60" });
  assert.deepEqual(set.binds, ["those", "them", "these"], "a set answers only to plural forms");
  assert.equal(event.label, "1b2c3d4e5f60", "the pivot registers even though it is not a result");
  assert.deepEqual(event.ids, ["commit:1b2c3d4e5f60"]);
  assert.equal(event.attrs.date, "2026-05-24");
  assert.ok(event.binds.includes("that"), "the pivot answers to the singular forms");
  assert.deepEqual({ lane: set.from.lane, turn: set.from.turn }, { lane: "commitFilter", turn: 0 });
});

test("a non-registering turn advances the counter but leaves the standing referents alone", async () => {
  const graph = await miniWebappGraph();
  const first = await runTurn("what changed before 1b2c3d4e5f60", {
    config: { graphFile: GRAPH_FILE }, graph, discourse: emptyRecord(),
  });
  const second = await runTurn("which modules import http.mjs", {
    config: { graphFile: GRAPH_FILE }, graph, discourse: first.discourse, last: first.last,
  });
  assert.equal(second.discourse.turn, 2);
  assert.equal(second.discourse.referents.length, 2, "a listing lane does not register yet");
  assert.deepEqual(second.discourse.referents.map((x) => x.kind).sort(), ["event", "set"]);
});
