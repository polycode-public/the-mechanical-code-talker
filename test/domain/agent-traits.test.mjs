import test from "node:test";
import assert from "node:assert/strict";

import { appendFacts, createInMemoryStore, loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";

const fact = (subject, predicate, object) => ({ subject, predicate, object });

test("every trait predicate stores and reads back through appendFacts/readFactRows", async () => {
  const store = createInMemoryStore();
  const rows = [
    fact("wolf", "mgx:pursues", "goat"),
    fact("wolf", "mgx:evades", "farmer"),
    fact("wolf", "mgx:consumes", "goat"),
    fact("wolf", "mgx:vision-radius", "3"),
    fact("wolf", "mgx:display-name", "wolf"),
    fact("wolf", "mgx:model", "wolf"),
    fact("wolf", "mgx:hasMass", "20"),
    fact("wolf", "mgx:mass-drain-per-turn", "0.08"),
    fact("wolf", "mgx:is-predator", "true"),
    fact("farmer", "mgx:guards", "wolf"),
  ].map((f) => ({ ...f, provenance: "world:test" }));
  await appendFacts(store, rows);
  const read = readFactRows(await loadMemory(store));
  for (const { subject, predicate, object } of rows) {
    assert.ok(read.some((r) => r.subject === subject && r.predicate === predicate && r.object === object),
      `${subject} ${predicate} ${object} did not read back`);
  }
});

test("a repeated mgx:pursues row for a second target reads back as two rows", async () => {
  const store = createInMemoryStore();
  await appendFacts(store, [
    fact("fox", "mgx:pursues", "goblin"),
    fact("fox", "mgx:pursues", "morsel"),
  ].map((f) => ({ ...f, provenance: "world:test" })));
  const read = readFactRows(await loadMemory(store)).filter((r) => r.subject === "fox" && r.predicate === "mgx:pursues");
  assert.equal(read.length, 2);
  assert.deepEqual(read.map((r) => r.object).sort(), ["goblin", "morsel"]);
});

test("a number object stored as a string reads back as the same string", async () => {
  const store = createInMemoryStore();
  await appendFacts(store, [fact("goblin", "mgx:hasMass", "3")].map((f) => ({ ...f, provenance: "world:test" })));
  const read = readFactRows(await loadMemory(store)).find((r) => r.subject === "goblin" && r.predicate === "mgx:hasMass");
  assert.equal(read.object, "3");
  assert.equal(typeof read.object, "string");
});
