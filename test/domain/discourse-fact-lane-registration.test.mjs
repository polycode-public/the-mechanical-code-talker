// The dated-history fact lanes register the commit they resolved as a discourse
// `event` referent: "when was X last touched" and "who last touched X" both
// establish a dated point in history a later turn can bind and compare. The
// scope is deliberately those two shapes only — a plain "where"/"what" answer
// establishes no dated event and registers none. Driven through runTurn against
// the committed mini-webapp example graph, read-only.
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

async function drive(graph, queries) {
  const turns = [];
  let discourse = emptyRecord();
  let last = null;
  let focus = null;
  for (const query of queries) {
    const r = await runTurn(query, { config: { graphFile: GRAPH_FILE }, graph, discourse, last, focus });
    turns.push(r);
    discourse = r.discourse;
    last = r.last;
    focus = r.focus;
  }
  return turns;
}

test("a 'when was X last touched' answer registers the dated commit as an event referent", async () => {
  const graph = await miniWebappGraph();
  const [t0] = await drive(graph, ["when was logger.mjs last touched"]);
  const event = t0.discourse.referents.find((r) => r.kind === "event");
  assert.ok(event, "the when-answer registered an event referent");
  assert.equal(event.class, "Commit");
  assert.equal(event.label, "e5f6a1b2c3d4");
  assert.deepEqual(event.ids, ["commit:e5f6a1b2c3d4"]);
  assert.equal(event.attrs.date, "2026-05-15", "the date attribute is the ISO day the comparison lane reads");
  assert.equal(event.from.lane, "when");
  assert.ok(event.binds.includes("it") && event.binds.includes("that"), "an event answers to singular forms");
});

test("a 'who last touched X' answer registers the same dated event, under its own lane", async () => {
  const graph = await miniWebappGraph();
  const [t0] = await drive(graph, ["who last touched logger.mjs"]);
  const event = t0.discourse.referents.find((r) => r.kind === "event");
  assert.ok(event, "the who-last answer registered an event referent");
  assert.equal(event.class, "Commit");
  assert.deepEqual(event.ids, ["commit:e5f6a1b2c3d4"]);
  assert.equal(event.attrs.date, "2026-05-15");
  assert.equal(event.from.lane, "whoLast");
});

test("the registered event feeds a later temporal comparison across the turn boundary", async () => {
  const graph = await miniWebappGraph();
  const [, t1] = await drive(graph, [
    "when was store.mjs last touched",
    "was that before logger.mjs was touched",
  ]);
  assert.equal(t1.record.miss, false, "the comparison composed rather than missing");
  assert.match(String(t1.answer),
    /^No — 1b2c3d4e5f60 \(2026-05-24\) came after logger\.mjs was last touched \(e5f6a1b2c3d4, 2026-05-15\)\./,
    "the standalone when-answer's event bound 'that' and both dates are cited");
});

test("a plain 'where is X defined' answer establishes no dated event and registers none", async () => {
  const graph = await miniWebappGraph();
  const [t0] = await drive(graph, ["where is Controller defined"]);
  assert.match(String(t0.answer), /Controller is defined in/, "the where-answer answered");
  assert.equal(t0.discourse.referents.filter((r) => r.kind === "event").length, 0,
    "no event referent — the fact-lane registration is scoped to the dated-history shapes only");
});
