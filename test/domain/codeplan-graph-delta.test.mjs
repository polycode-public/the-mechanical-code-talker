// The code-planning STATE and its closed effect vocabulary: applying a graph
// delta, the path-independent canonical state key, declared-vs-observed diffing,
// and reading a state out of a loaded graph payload.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ENTITY_CLASSES, EDGE_PREDICATES, EFFECT_OPS,
  emptyGraphState, normalizeGraphState, validateEffect,
  applyGraphEffect, applyGraphEffects, canonicalStateKey,
  effectKey, effectsEqual, diffGraphStates, graphStateFromEntities,
} from "../../src/domain/codeplan/graph-delta.mjs";
import { EDGE_KINDS } from "../../src/adapters/repository-interface.mjs";

const REPO = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const FIXTURE_GRAPH = path.join(REPO, "examples", "tiny-webapp-src", ".tmct", "graph.json");

// A tiny two-module state used across the apply/key tests.
const base = () => normalizeGraphState({
  entities: [
    { id: "mod:a.mjs", class: "Module", title: "a.mjs" },
    { id: "mod:b.mjs", class: "Module", title: "b.mjs" },
    { id: "fn:a.mjs#f", class: "Function", title: "f" },
  ],
  edges: [
    { subject: "mod:a.mjs", predicate: "defines", object: "fn:a.mjs#f" },
    { subject: "mod:b.mjs", predicate: "imports", object: "mod:a.mjs" },
  ],
});

test("the closed edge-predicate vocabulary stays in step with repository-interface EDGE_KINDS", () => {
  assert.deepEqual([...EDGE_PREDICATES].sort(), [...EDGE_KINDS].sort());
});

test("the effect vocabulary is exactly the five delta tokens", () => {
  assert.deepEqual([...EFFECT_OPS], ["add-entity", "del-entity", "add-edge", "del-edge", "retitle-entity"]);
  assert.ok(ENTITY_CLASSES.includes("Function") && ENTITY_CLASSES.includes("Module"));
});

test("validateEffect rejects an unknown op, an off-vocabulary class, and an off-vocabulary predicate", () => {
  assert.throws(() => validateEffect({ op: "mutate" }), /not in EFFECT_OPS/);
  assert.throws(() => validateEffect({ op: "add-entity", id: "x", class: "Widget" }), /not an ENTITY_CLASS/);
  assert.throws(() => validateEffect({ op: "add-edge", subject: "a", object: "b", predicate: "frobs" }), /not an EDGE_PREDICATE/);
});

test("normalizeGraphState sorts and de-duplicates entities and edges", () => {
  const s = normalizeGraphState({
    entities: [{ id: "z" , class: "Module", title: "z" }, { id: "a", class: "Module", title: "a" }, { id: "a", class: "Module", title: "a" }],
    edges: [{ subject: "b", predicate: "imports", object: "a" }, { subject: "b", predicate: "imports", object: "a" }],
  });
  assert.deepEqual(s.entities.map((e) => e.id), ["a", "z"]);
  assert.equal(s.edges.length, 1);
});

test("add-entity then add-edge builds the graph; the input state is never mutated", () => {
  const before = base();
  const s1 = applyGraphEffect(before, { op: "add-entity", id: "fn:b.mjs#g", class: "Function", title: "g" });
  const s2 = applyGraphEffect(s1, { op: "add-edge", subject: "mod:b.mjs", predicate: "defines", object: "fn:b.mjs#g" });
  assert.ok(s2.entities.some((e) => e.id === "fn:b.mjs#g"));
  assert.ok(s2.edges.some((r) => r.subject === "mod:b.mjs" && r.object === "fn:b.mjs#g"));
  assert.equal(before.entities.length, 3, "the original state was mutated");
});

test("retitle-entity keeps the id and changes only the title (the rename primitive)", () => {
  const s = applyGraphEffect(base(), { op: "retitle-entity", id: "fn:a.mjs#f", title: "parseRow" });
  const ent = s.entities.find((e) => e.id === "fn:a.mjs#f");
  assert.equal(ent.title, "parseRow");
});

test("apply throws on a duplicate add, a delete of an absent thing, an edge onto a missing endpoint, and a del-entity with a live edge", () => {
  const s = base();
  assert.throws(() => applyGraphEffect(s, { op: "add-entity", id: "fn:a.mjs#f", class: "Function", title: "f" }), /already exists/);
  assert.throws(() => applyGraphEffect(s, { op: "del-entity", id: "fn:nope" }), /does not exist/);
  assert.throws(() => applyGraphEffect(s, { op: "add-edge", subject: "mod:a.mjs", predicate: "imports", object: "mod:ghost" }), /is not an entity/);
  assert.throws(() => applyGraphEffect(s, { op: "del-entity", id: "fn:a.mjs#f" }), /incident edges/);
});

test("del-entity succeeds once its incident edges are removed first (a complete declared delta)", () => {
  const s = applyGraphEffects(base(), [
    { op: "del-edge", subject: "mod:a.mjs", predicate: "defines", object: "fn:a.mjs#f" },
    { op: "del-entity", id: "fn:a.mjs#f" },
  ]);
  assert.ok(!s.entities.some((e) => e.id === "fn:a.mjs#f"));
});

test("canonicalStateKey is path-independent: two orderings of independent steps reach one key", () => {
  const addG = { op: "add-entity", id: "fn:b.mjs#g", class: "Function", title: "g" };
  const retitle = { op: "retitle-entity", id: "fn:a.mjs#f", title: "parseRow" };
  const orderA = applyGraphEffects(base(), [addG, retitle]);
  const orderB = applyGraphEffects(base(), [retitle, addG]);
  assert.equal(canonicalStateKey(orderA), canonicalStateKey(orderB));
});

test("canonicalStateKey separates genuinely different graphs", () => {
  const one = applyGraphEffect(base(), { op: "retitle-entity", id: "fn:a.mjs#f", title: "parseRow" });
  assert.notEqual(canonicalStateKey(one), canonicalStateKey(base()));
});

test("diffGraphStates reports the observed delta; effectsEqual matches it to the declared one order-free", () => {
  const declared = [
    { op: "add-entity", id: "fn:b.mjs#g", class: "Function", title: "g" },
    { op: "add-edge", subject: "mod:b.mjs", predicate: "defines", object: "fn:b.mjs#g" },
  ];
  const after = applyGraphEffects(base(), declared);
  const observed = diffGraphStates(base(), after);
  assert.ok(effectsEqual(declared, observed), "declared delta should equal the observed diff");
  // A drift (an extra edge the operator did not declare) is caught.
  const drifted = applyGraphEffect(after, { op: "add-edge", subject: "mod:a.mjs", predicate: "imports", object: "mod:b.mjs" });
  assert.ok(!effectsEqual(declared, diffGraphStates(base(), drifted)));
});

test("effectKey canonicalizes each token so an unordered comparison is stable", () => {
  assert.equal(effectKey({ op: "del-entity", id: "x" }), effectKey({ op: "del-entity", id: "x" }));
  assert.notEqual(effectKey({ op: "del-entity", id: "x" }), effectKey({ op: "del-entity", id: "y" }));
});

test("graphStateFromEntities reads the committed tiny-webapp fixture graph, skipping schema meta-entities", () => {
  const payload = JSON.parse(fs.readFileSync(FIXTURE_GRAPH, "utf8"));
  const state = graphStateFromEntities(payload);
  // No schema:* meta-entity leaks in; every entity carries a known class.
  assert.ok(state.entities.every((e) => !e.id.startsWith("schema:")));
  assert.ok(state.entities.some((e) => e.id === "fn:lib/parse.mjs#parseRow" && e.title === "parseRow"));
  // parseRow has exactly two inbound callsSymbol edges (its two call sites).
  const callers = state.edges.filter((r) => r.predicate === "callsSymbol" && r.object === "fn:lib/parse.mjs#parseRow");
  assert.deepEqual(callers.map((r) => r.subject).sort(), ["fn:app.mjs#previewFirstRow", "fn:lib/store.mjs#loadRows"]);
  // Every edge endpoint resolves to a real entity (no dangling edges).
  const ids = new Set(state.entities.map((e) => e.id));
  assert.ok(state.edges.every((r) => ids.has(r.subject) && ids.has(r.object)));
});

test("emptyGraphState is a normal, empty state", () => {
  assert.deepEqual(emptyGraphState(), { entities: [], edges: [] });
  assert.equal(canonicalStateKey(emptyGraphState()), "");
});
