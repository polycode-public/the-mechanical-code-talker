// graph-merge.test.mjs — src/adapters/graph-merge.mjs's mergeEntityPayloads: the
// multi-graph merge used ONLY by source.mjs's fetchEntities when a config
// carries more than one graph file. Covers the no-collision (ids pass through
// untouched) and the collision (Option A: only the colliding ids are
// prefixed) cases, plus proseIndex union and bootstrap/generated_at handling.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeEntityPayloads } from "../src/adapters/graph-merge.mjs";

const ind = (id, extra = {}) => ({ id, label: id, class: "Module", derived_from: [], mentions: [], ...extra });

test("no collision: ids, classes, vocabulary, objectProperties all pass through untouched (concatenated)", () => {
  const a = {
    generated_at: "2026-01-01T00:00:00Z",
    classes: [{ name: "Module", count: 1 }],
    vocabulary: ["alpha"],
    objectProperties: [{ predicate: "imports", count: 1, examples: [{ subject: "mod:a.py", object: "mod:b.py" }] }],
    individuals: [ind("mod:a.py"), ind("mod:b.py")],
    proseIndex: { alpha: ["mod:a.py"] },
  };
  const b = {
    generated_at: "2026-02-01T00:00:00Z",
    classes: [{ name: "Module", count: 1 }],
    vocabulary: ["beta"],
    objectProperties: [{ predicate: "imports", count: 1, examples: [{ subject: "mod:c.py", object: "mod:d.py" }] }],
    individuals: [ind("mod:c.py"), ind("mod:d.py")],
    proseIndex: { beta: ["mod:c.py"] },
  };
  const merged = mergeEntityPayloads([{ file: "a.json", payload: a }, { file: "b.json", payload: b }]);
  assert.deepEqual(merged.individuals.map((i) => i.id), ["mod:a.py", "mod:b.py", "mod:c.py", "mod:d.py"]);
  assert.equal(merged.classes.length, 2);
  assert.deepEqual(merged.vocabulary, ["alpha", "beta"]);
  assert.equal(merged.objectProperties.length, 2);
  assert.deepEqual(merged.objectProperties[0].examples[0], { subject: "mod:a.py", object: "mod:b.py" });
  assert.deepEqual(merged.objectProperties[1].examples[0], { subject: "mod:c.py", object: "mod:d.py" });
  assert.deepEqual(merged.proseIndex, { alpha: ["mod:a.py"], beta: ["mod:c.py"] });
  assert.equal(merged.generated_at, "2026-02-01T00:00:00Z", "latest generated_at wins");
});

test("collision: the SAME id in two payloads is prefixed with the graph name in BOTH, references updated too", () => {
  const a = {
    individuals: [ind("mod:foo.py", { mentions: [{ id: "mod:foo.py", count: 2 }] })],
    objectProperties: [{ predicate: "imports", count: 1, examples: [{ subject: "mod:foo.py", object: "mod:foo.py" }] }],
    proseIndex: { foo: ["mod:foo.py"] },
  };
  const b = {
    individuals: [ind("mod:foo.py")],
    proseIndex: { foo: ["mod:foo.py"] },
  };
  const merged = mergeEntityPayloads([
    { file: "a.json", payload: a, name: "backend" },
    { file: "b.json", payload: b, name: "frontend" },
  ]);
  assert.deepEqual(merged.individuals.map((i) => i.id), ["backend/mod:foo.py", "frontend/mod:foo.py"]);
  assert.deepEqual(merged.individuals[0].mentions, [{ id: "backend/mod:foo.py", count: 2 }]);
  assert.deepEqual(merged.objectProperties[0].examples[0], { subject: "backend/mod:foo.py", object: "backend/mod:foo.py" });
  assert.deepEqual(merged.proseIndex.foo, ["backend/mod:foo.py", "frontend/mod:foo.py"]);
});

test("collision: unnamed entries fall back to the array index as the graph name", () => {
  const a = { individuals: [ind("mod:foo.py")] };
  const b = { individuals: [ind("mod:foo.py")] };
  const merged = mergeEntityPayloads([{ file: "a.json", payload: a }, { file: "b.json", payload: b }]);
  assert.deepEqual(merged.individuals.map((i) => i.id), ["0/mod:foo.py", "1/mod:foo.py"]);
});

test("collision only affects the ACTUALLY colliding id — a sibling non-colliding id in the same payload is untouched", () => {
  const a = { individuals: [ind("mod:shared.py"), ind("mod:unique-a.py")] };
  const b = { individuals: [ind("mod:shared.py"), ind("mod:unique-b.py")] };
  const merged = mergeEntityPayloads([
    { file: "a.json", payload: a, name: "g0" },
    { file: "b.json", payload: b, name: "g1" },
  ]);
  const ids = merged.individuals.map((i) => i.id);
  assert.deepEqual(ids, ["g0/mod:shared.py", "mod:unique-a.py", "g1/mod:shared.py", "mod:unique-b.py"]);
});

test("proseIndex union: the same word from two graphs merges its id arrays (no duplicates)", () => {
  const a = { individuals: [ind("mod:a.py")], proseIndex: { logger: ["mod:a.py"] } };
  const b = { individuals: [ind("mod:b.py")], proseIndex: { logger: ["mod:b.py"] } };
  const merged = mergeEntityPayloads([{ file: "a.json", payload: a }, { file: "b.json", payload: b }]);
  assert.deepEqual(merged.proseIndex.logger, ["mod:a.py", "mod:b.py"]);
});

test("bootstrap: true only when EVERY merged payload is a bootstrap (empty) payload", () => {
  const bootstrapPayload = { bootstrap: true, individuals: [] };
  const realPayload = { individuals: [ind("mod:a.py")] };
  const allBootstrap = mergeEntityPayloads([{ file: "a.json", payload: bootstrapPayload }, { file: "b.json", payload: bootstrapPayload }]);
  assert.equal(allBootstrap.bootstrap, true);
  const mixed = mergeEntityPayloads([{ file: "a.json", payload: bootstrapPayload }, { file: "b.json", payload: realPayload }]);
  assert.equal(mixed.bootstrap, undefined);
});

test("derived_from provenance refs (git:/turn:) never accidentally collide with individual ids", () => {
  const a = { individuals: [ind("mod:a.py", { derived_from: ["git:abc123"] })] };
  const b = { individuals: [ind("mod:b.py")] };
  const merged = mergeEntityPayloads([{ file: "a.json", payload: a }, { file: "b.json", payload: b }]);
  assert.deepEqual(merged.individuals[0].derived_from, ["git:abc123"]);
});
