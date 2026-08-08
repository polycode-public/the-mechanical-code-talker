import test from "node:test";
import assert from "node:assert/strict";

import {
  AGENT_TRAIT_PREDICATES, AGENT_TRAIT_MULTI, classChainOf,
  traitValueOf, traitValuesOf, traitOriginOf, agentTraitsOf,
  classFactRowsFor, instanceFactsFrom,
} from "../../src/domain/agent-traits.mjs";
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

// A small goblin/fox world: goblin subclasses creature, evades fox, eats
// crumb and morsel; fox subclasses canine, pursues goblin.
const WORLD_ROWS = [
  fact("goblin", "rdfs:subClassOf", "creature"),
  fact("goblin", "mgx:display-name", "goblin"),
  fact("goblin", "mgx:hasMass", "8"),
  fact("goblin", "mgx:mass-drain-per-turn", "0.06"),
  fact("goblin", "mgx:vision-radius", "3"),
  fact("goblin", "mgx:evades", "fox"),
  fact("goblin", "mgx:consumes", "crumb"),
  fact("goblin", "mgx:consumes", "morsel"),
  fact("fox", "rdfs:subClassOf", "canine"),
  fact("fox", "mgx:pursues", "goblin"),
  fact("fox", "mgx:is-predator", "true"),
  fact("goblin-1", "rdf:type", "goblin"),
];

test("classChainOf walks rdf:type then rdfs:subClassOf, nearest first, opening on the subject itself", () => {
  const chain = classChainOf(WORLD_ROWS, "goblin-1");
  assert.deepEqual(chain, ["goblin-1", "goblin", "creature"]);
});

test("classChainOf stops at a cycle rather than looping forever", () => {
  const cyclic = [fact("a", "rdfs:subClassOf", "b"), fact("b", "rdfs:subClassOf", "a")];
  assert.deepEqual(classChainOf(cyclic, "a"), ["a", "b"]);
});

test("the chain walk finds a class trait for an instance that declares none of its own", () => {
  assert.equal(traitValueOf(WORLD_ROWS, "goblin-1", "mgx:hasMass"), "8");
  assert.equal(traitValueOf(WORLD_ROWS, "goblin-1", "mgx:mass-drain-per-turn"), "0.06");
  assert.deepEqual(traitValuesOf(WORLD_ROWS, "goblin-1", "mgx:consumes"), ["crumb", "morsel"]);
});

test("an instance's own row overrides its class's single-valued trait", () => {
  const rows = [...WORLD_ROWS, fact("goblin-1", "mgx:hasMass", "12")];
  assert.equal(traitValueOf(rows, "goblin-1", "mgx:hasMass"), "12");
  // the class itself is untouched
  assert.equal(traitValueOf(rows, "goblin", "mgx:hasMass"), "8");
});

test("a multi-valued instance row replaces the class's set rather than adding to it", () => {
  const rows = [...WORLD_ROWS, fact("goblin-1", "mgx:evades", "farmer")];
  assert.deepEqual(traitValuesOf(rows, "goblin-1", "mgx:evades"), ["farmer"]);
  assert.deepEqual(traitValuesOf(rows, "goblin", "mgx:evades"), ["fox"]);
});

test("an undeclared trait reads null or an empty list, never a JS-side default", () => {
  const bare = [fact("slug", "rdf:type", "slug")];
  assert.equal(traitValueOf(bare, "slug-1", "mgx:mass-drain-per-turn"), null);
  assert.deepEqual(traitValuesOf(bare, "slug-1", "mgx:evades"), []);
  const traits = agentTraitsOf([fact("slug-1", "rdf:type", "slug")], "slug-1");
  assert.equal(traits.mass, null);
  assert.equal(traits.massDrainPerTurn, null);
  assert.equal(traits.visionRadius, null);
  assert.equal(traits.displayName, null);
  assert.equal(traits.model, null);
  assert.equal(traits.isPredator, false);
  assert.deepEqual(traits.pursues, []);
  assert.deepEqual(traits.evades, []);
  assert.deepEqual(traits.consumes, []);
  assert.deepEqual(traits.guards, []);
});

test("traitOriginOf names the class a trait came from, or \"instance\" when the subject declares its own", () => {
  assert.equal(traitOriginOf(WORLD_ROWS, "goblin-1", "mgx:hasMass"), "goblin");
  assert.equal(traitOriginOf(WORLD_ROWS, "goblin-1", "mgx:model"), null);
  const withOverride = [...WORLD_ROWS, fact("goblin-1", "mgx:hasMass", "12")];
  assert.equal(traitOriginOf(withOverride, "goblin-1", "mgx:hasMass"), "instance");
});

test("agentTraitsOf resolves a full trait set for an instance from its class chain", () => {
  const traits = agentTraitsOf(WORLD_ROWS, "goblin-1");
  assert.equal(traits.subject, "goblin-1");
  assert.deepEqual(traits.classes, ["goblin", "creature"]);
  assert.equal(traits.displayName, "goblin");
  assert.equal(traits.mass, 8);
  assert.equal(traits.massDrainPerTurn, 0.06);
  assert.equal(traits.visionRadius, 3);
  assert.equal(traits.isPredator, false);
  assert.deepEqual(traits.evades, ["fox"]);
  assert.deepEqual(traits.consumes, ["crumb", "morsel"]);
});

test("classFactRowsFor returns a class's own rows only, sorted by predicate then object, never an ancestor's", () => {
  const rows = classFactRowsFor(WORLD_ROWS, "goblin");
  assert.deepEqual(rows, [
    fact("goblin", "mgx:consumes", "crumb"),
    fact("goblin", "mgx:consumes", "morsel"),
    fact("goblin", "mgx:display-name", "goblin"),
    fact("goblin", "mgx:evades", "fox"),
    fact("goblin", "mgx:hasMass", "8"),
    fact("goblin", "mgx:mass-drain-per-turn", "0.06"),
    fact("goblin", "mgx:vision-radius", "3"),
  ]);
  // the chain's ancestor (creature) declares nothing, so its rows stay empty
  assert.deepEqual(classFactRowsFor(WORLD_ROWS, "creature"), []);
});

test("instanceFactsFrom produces a sorted row list including rdf:type", () => {
  const spawned = instanceFactsFrom(WORLD_ROWS, "goblin", "goblin-2");
  assert.ok(spawned.some((r) => r.subject === "goblin-2" && r.predicate === "rdf:type" && r.object === "goblin"));
  assert.ok(spawned.every((r) => r.subject === "goblin-2"));
  const sorted = [...spawned].sort((a, b) => (a.predicate === b.predicate
    ? (a.object < b.object ? -1 : a.object > b.object ? 1 : 0)
    : (a.predicate < b.predicate ? -1 : 1)));
  assert.deepEqual(spawned, sorted);
  // every declared class trait is copied, and nothing undeclared is invented
  assert.ok(spawned.some((r) => r.predicate === "mgx:hasMass" && r.object === "8"));
  assert.ok(spawned.some((r) => r.predicate === "mgx:evades" && r.object === "fox"));
  assert.ok(spawned.some((r) => r.predicate === "mgx:consumes" && r.object === "crumb"));
  assert.ok(spawned.some((r) => r.predicate === "mgx:consumes" && r.object === "morsel"));
  assert.ok(!spawned.some((r) => r.predicate === "mgx:model"));
  assert.ok(!spawned.some((r) => r.predicate === "mgx:is-predator"));
});

test("instanceFactsFrom is deterministic: two calls over the same rows produce identical lists", () => {
  const a = instanceFactsFrom(WORLD_ROWS, "goblin", "goblin-3");
  const b = instanceFactsFrom(WORLD_ROWS, "goblin", "goblin-3");
  assert.deepEqual(a, b);
});

test("appending the same spawn list twice through appendFacts leaves the row count unchanged", async () => {
  const store = createInMemoryStore();
  const worldWithProvenance = WORLD_ROWS.map((f) => ({ ...f, provenance: "world:test" }));
  await appendFacts(store, worldWithProvenance);
  const spawned = instanceFactsFrom(readFactRows(await loadMemory(store)), "goblin", "goblin-4");

  await appendFacts(store, spawned);
  const afterFirst = readFactRows(await loadMemory(store)).filter((r) => r.subject === "goblin-4");
  assert.equal(afterFirst.length, spawned.length);

  await appendFacts(store, spawned);
  const afterSecond = readFactRows(await loadMemory(store)).filter((r) => r.subject === "goblin-4");
  assert.equal(afterSecond.length, spawned.length);
});

test("agentTraitsOf is a pure function of the row set: two shuffled orders yield an identical result", () => {
  const shuffled = [...WORLD_ROWS].reverse();
  const forward = agentTraitsOf(WORLD_ROWS, "goblin-1");
  const backward = agentTraitsOf(shuffled, "goblin-1");
  assert.deepEqual(forward, backward);
});

test("classChainOf agrees regardless of row order", () => {
  const forward = classChainOf(WORLD_ROWS, "goblin-1");
  const backward = classChainOf([...WORLD_ROWS].reverse(), "goblin-1");
  assert.deepEqual(forward, backward);
});

test("AGENT_TRAIT_MULTI names exactly the multi-valued predicates in AGENT_TRAIT_PREDICATES", () => {
  for (const predicate of AGENT_TRAIT_MULTI) assert.ok(AGENT_TRAIT_PREDICATES.includes(predicate));
  const singleValued = AGENT_TRAIT_PREDICATES.filter((p) => !AGENT_TRAIT_MULTI.has(p));
  assert.deepEqual(singleValued.sort(), [
    "mgx:display-name", "mgx:hasMass", "mgx:is-predator", "mgx:mass-drain-per-turn", "mgx:model", "mgx:vision-radius",
  ]);
});
