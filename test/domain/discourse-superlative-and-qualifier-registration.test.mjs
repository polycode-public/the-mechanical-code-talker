// The superlative and qualifier lanes register what their answer established
// into the session's discourse record: a lone superlative winner as an entity
// plus its score as a measure, a metric tie as a set plus the measure, a
// qualifier check's resolved subject as an entity (whatever the yes/no answer),
// and a qualifier listing as a set. Driven through runTurn against the
// committed mini-webapp example graph, read-only (no memoryDir), so nothing on
// disk is touched.
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

test("a lone superlative winner registers as an entity, its score as a measure", async () => {
  const graph = await miniWebappGraph();
  const [t0] = await drive(graph, ["which module has the most imports"]);
  const refs = t0.discourse.referents;
  const entity = refs.find((r) => r.kind === "entity");
  assert.ok(entity, "the winner registered as an entity referent");
  assert.equal(entity.class, "Module");
  assert.equal(entity.label, "src/handlers/tasks.mjs");
  assert.deepEqual(entity.ids, ["mod:src/handlers/tasks.mjs"]);
  const measure = refs.find((r) => r.kind === "measure");
  assert.ok(measure, "the score registered as a measure referent");
  assert.equal(measure.label, "5 imports");
  assert.equal(measure.class, null, "a measure carries no class");
  assert.deepEqual(measure.ids, [], "a measure carries no ids");
  assert.equal(measure.attrs.metric, 5);
  assert.ok(entity.binds.includes("it") && entity.binds.includes("that"), "the winner answers to singular forms");
  assert.ok(measure.binds.includes("it") && measure.binds.includes("that"), "the score answers to singular forms too");
});

test("a metric tie registers a set of the tied winners in place of a single entity, plus the measure", async () => {
  const graph = await miniWebappGraph();
  const [t0] = await drive(graph, ["which class has the fewest methods"]);
  const refs = t0.discourse.referents;
  assert.equal(refs.filter((r) => r.kind === "entity").length, 0, "no lone entity when the metric ties");
  const set = refs.find((r) => r.kind === "set");
  assert.ok(set, "the tied winners registered as a set referent");
  assert.equal(set.class, "Class");
  assert.ok(set.ids.length >= 2, "the set carries every tied member id");
  assert.deepEqual(set.binds, ["those", "them", "these"], "a set answers only to plural forms");
  const measure = refs.find((r) => r.kind === "measure");
  assert.ok(measure && measure.attrs.metric === 0, "the tied score is still a measure referent");
});

test("a qualifier check registers its resolved subject whether the answer is yes or no", async () => {
  const graph = await miniWebappGraph();
  const [affirmative] = await drive(graph, ["is Controller.handle public"]);
  assert.match(String(affirmative.answer), /^Yes/, "the check held");
  const yesEntity = affirmative.discourse.referents.find((r) => r.kind === "entity");
  assert.ok(yesEntity && yesEntity.label === "Controller.handle" && yesEntity.class === "Method",
    "an affirmative check registers the subject");

  const [negative] = await drive(graph, ["is Controller abstract"]);
  assert.match(String(negative.answer), /^No/, "the check did not hold");
  const noEntity = negative.discourse.referents.find((r) => r.kind === "entity");
  assert.ok(noEntity && noEntity.label === "Controller" && noEntity.class === "Class",
    "a negative check still registers the subject — the entity is bindable either way");
});

test("a qualifier listing registers its result as a set referent under its own lane", async () => {
  const graph = await miniWebappGraph();
  const [t0] = await drive(graph, ["which modules are tested"]);
  const set = t0.discourse.referents.find((r) => r.kind === "set");
  assert.ok(set, "the listing registered a set referent");
  assert.equal(set.class, "Module");
  assert.equal(set.from.lane, "qualifierListing");
  assert.equal(set.ids.length, 3);
  assert.equal(set.attrs.count, 3);
  assert.deepEqual(set.binds, ["those", "them", "these"]);
});
