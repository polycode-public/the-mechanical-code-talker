// The listing and filter lanes register a plural (set) referent into the
// session's discourse record, and a set survives a count so a later "which of
// those …" still binds it — the count no longer erases the chain. Driven
// through runTurn against the committed mini-webapp example graph, read-only
// (no memoryDir, no session shell), so nothing on disk is touched.
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

/** Thread runTurn's record/last/focus turn to turn, exactly as the session
 *  shell does, so a scripted drill-down resolves the way a real conversation
 *  would. */
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

test("a plain relation listing fills the record with a class-typed set referent", async () => {
  const graph = await miniWebappGraph();
  const [t0] = await drive(graph, ["which modules import http.mjs"]);
  const set = t0.discourse.referents.find((x) => x.kind === "set");
  assert.ok(set, "the listing registered a set referent");
  assert.equal(set.class, "Module");
  assert.equal(set.ids.length, 3, "the set carries every listed member id");
  assert.equal(set.attrs.count, 3);
  assert.deepEqual(set.binds, ["those", "them", "these"], "a set answers only to plural forms");
});

test("a set survives a count turn so the next turn still binds it", async () => {
  const graph = await miniWebappGraph();
  const [, t1, t2] = await drive(graph, [
    "which modules import http.mjs",
    "how many of those are tested",
    "which of those are modules",
  ]);
  assert.match(String(t1.answer), /^1 module\./, "the count answered over the surviving set");
  const set = t1.discourse.referents.find((x) => x.kind === "set" && x.class === "Module");
  assert.ok(set && set.ids.length === 3, "the count left the module set standing, uncounted");
  assert.equal(t2.record.miss, false, "the third hop bound the set rather than degrading to the no-antecedent miss");
  assert.doesNotMatch(String(t2.answer), /needs a previous answer to refer to/);
  assert.ok(/base\.mjs/.test(String(t2.answer)) && /tasks\.mjs/.test(String(t2.answer)),
    "the third hop answered over the module set for real");
});

test("a narrowing registers its own set, so the chain survives a later count too", async () => {
  const graph = await miniWebappGraph();
  const [, t1, , t3] = await drive(graph, [
    "which modules import http.mjs",
    "which of those are tested",
    "how many of those are tested",
    "which of those are tested",
  ]);
  assert.match(String(t1.answer), /^src\/handlers\/tasks\.mjs\./, "the first narrowing answered");
  const narrowed = t1.discourse.referents.find((x) => x.kind === "set" && x.from.lane === "anaphora");
  assert.ok(narrowed && narrowed.ids.length === 1, "the narrowing registered its own one-member set");
  assert.equal(t3.record.miss, false, "the fourth hop bound the surviving set past the count");
  assert.match(String(t3.answer), /^src\/handlers\/tasks\.mjs\./);
});

test("a plural follow-up with no prior answer still misses honestly", async () => {
  const graph = await miniWebappGraph();
  const [t0] = await drive(graph, ["which of those are functions"]);
  assert.equal(t0.record.miss, true, "nothing to refer to is an honest miss");
  assert.match(String(t0.answer), /needs a previous answer to refer to/,
    "the fallback never manufactures a referent from an empty record");
});
