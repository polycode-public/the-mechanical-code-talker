// The graph-predicate precondition vocabulary and the operator catalogue: the
// Opdyke behavior-preservation checks over graph shape, and the grounders that
// turn a catalogue entry plus a goal-derived parameter pool into legal moves.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeGraphState, graphStateFromEntities, applyGraphEffects } from "../../src/domain/codeplan/graph-delta.mjs";
import {
  noNameCollisionInScope, moveIntroducesNoImportCycle, importsGraphHasCycle,
  hasSingleDefinition, noSelfRecursion, noInboundDependencies,
  preconditionsHold, GRAPH_PRECONDITIONS, callersOf, moduleDefining,
} from "../../src/domain/codeplan/graph-predicates.mjs";
import { CODE_OPERATORS, groundedOperators, codeGraphMoves } from "../../src/domain/codeplan/operators.mjs";

const REPO = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const FIXTURE_GRAPH = path.join(REPO, "examples", "tiny-webapp-src", ".tmct", "graph.json");
const fixtureState = () => graphStateFromEntities(JSON.parse(fs.readFileSync(FIXTURE_GRAPH, "utf8")));

// A hand-built two-module graph: module a defines f and g; module b imports a
// and its fn h calls a's f.
const twoModule = () => normalizeGraphState({
  entities: [
    { id: "mod:a", class: "Module", title: "a" },
    { id: "mod:b", class: "Module", title: "b" },
    { id: "fn:f", class: "Function", title: "f" },
    { id: "fn:g", class: "Function", title: "g" },
    { id: "fn:h", class: "Function", title: "h" },
  ],
  edges: [
    { subject: "mod:a", predicate: "defines", object: "fn:f" },
    { subject: "mod:a", predicate: "defines", object: "fn:g" },
    { subject: "mod:b", predicate: "defines", object: "fn:h" },
    { subject: "mod:b", predicate: "imports", object: "mod:a" },
    { subject: "fn:h", predicate: "callsSymbol", object: "fn:f" },
  ],
});

test("the catalogue's precondition tokens all resolve in the closed vocabulary", () => {
  for (const op of CODE_OPERATORS) {
    for (const name of op.preconditions) {
      assert.ok(GRAPH_PRECONDITIONS[name], `${op.name} names unknown precondition ${name}`);
    }
  }
});

test("noNameCollisionInScope: blocks a rename onto a sibling's title, allows a fresh one", () => {
  const s = twoModule();
  assert.equal(noNameCollisionInScope(s, { entityId: "fn:f", newTitle: "g" }), false);
  assert.equal(noNameCollisionInScope(s, { entityId: "fn:f", newTitle: "parseRow" }), true);
});

test("importsGraphHasCycle: an added back-edge that closes a loop is detected", () => {
  const s = twoModule(); // b imports a
  assert.equal(importsGraphHasCycle(s), false);
  assert.equal(importsGraphHasCycle(s, [{ subject: "mod:a", object: "mod:b" }]), true);
});

test("moveIntroducesNoImportCycle: safe target passes; a target that would loop back fails", () => {
  const s = normalizeGraphState({
    entities: [
      { id: "mod:a", class: "Module", title: "a" },
      { id: "mod:b", class: "Module", title: "b" },
      { id: "fn:f", class: "Function", title: "f" },
      { id: "fn:h", class: "Function", title: "h" },
    ],
    edges: [
      { subject: "mod:a", predicate: "defines", object: "fn:f" },
      { subject: "mod:b", predicate: "defines", object: "fn:h" },
      { subject: "mod:a", predicate: "imports", object: "mod:b" }, // a already imports b
      { subject: "fn:h", predicate: "callsSymbol", object: "fn:f" }, // h (in b) calls f
    ],
  });
  // Moving f into b: caller h is already in b, so no import is induced — safe.
  assert.equal(moveIntroducesNoImportCycle(s, { entityId: "fn:f", toModuleId: "mod:b" }), true);
});

test("moveIntroducesNoImportCycle: rejects a move whose induced import closes a cycle", () => {
  const s = normalizeGraphState({
    entities: [
      { id: "mod:a", class: "Module", title: "a" },
      { id: "mod:b", class: "Module", title: "b" },
      { id: "mod:c", class: "Module", title: "c" },
      { id: "fn:e", class: "Function", title: "e" },
      { id: "fn:h", class: "Function", title: "h" },
    ],
    edges: [
      { subject: "mod:c", predicate: "defines", object: "fn:e" },
      { subject: "mod:b", predicate: "defines", object: "fn:h" },
      { subject: "mod:a", predicate: "imports", object: "mod:b" }, // a already imports b
      { subject: "fn:h", predicate: "callsSymbol", object: "fn:e" }, // h (in b) calls e
    ],
  });
  // Moving e into a induces b→a (h's module must import e's new home), and a→b
  // already exists — that closes a cycle, so the precondition rejects it.
  assert.equal(moveIntroducesNoImportCycle(s, { entityId: "fn:e", toModuleId: "mod:a" }), false);
  // Moving e into b instead induces no import at all (h is already in b) — safe.
  assert.equal(moveIntroducesNoImportCycle(s, { entityId: "fn:e", toModuleId: "mod:b" }), true);
});

test("hasSingleDefinition and noSelfRecursion gate inline", () => {
  const s = twoModule();
  assert.equal(hasSingleDefinition(s, { entityId: "fn:f" }), true);
  assert.equal(noSelfRecursion(s, { entityId: "fn:f" }), true);
  const recursive = applyGraphEffects(s, [{ op: "add-edge", subject: "fn:f", predicate: "callsSymbol", object: "fn:f" }]);
  assert.equal(noSelfRecursion(recursive, { entityId: "fn:f" }), false);
});

test("noInboundDependencies: true only when nothing calls or imports the entity", () => {
  const s = twoModule();
  assert.equal(noInboundDependencies(s, { entityId: "fn:f" }), false); // h calls f
  assert.equal(noInboundDependencies(s, { entityId: "fn:g" }), true);
});

test("preconditionsHold throws on an unknown token", () => {
  assert.throws(() => preconditionsHold(["no-such-precond"], twoModule(), {}), /unknown graph precondition/);
});

test("callersOf and moduleDefining read the fixture graph's parseRow neighbourhood", () => {
  const s = fixtureState();
  assert.equal(moduleDefining(s, "fn:lib/parse.mjs#parseRow"), "mod:lib/parse.mjs");
  assert.deepEqual(callersOf(s, "fn:lib/parse.mjs#parseRow").sort(), ["fn:app.mjs#previewFirstRow", "fn:lib/store.mjs#loadRows"]);
});

test("groundRename emits one move per surviving candidate title, blocking collisions", () => {
  const rename = CODE_OPERATORS.find((op) => op.name === "rename");
  const s = twoModule();
  const moves = rename.ground(rename, s, { titles: ["g", "parseRow"] });
  // "g" collides for fn:f (sibling g) but not for fn:g itself (that's its own title, skipped),
  // and h/f/g can each take "parseRow" where no sibling holds it.
  assert.ok(moves.every((m) => m.effects[0].op === "retitle-entity"));
  assert.ok(moves.some((m) => m.binding.entityId === "fn:f" && m.binding.newTitle === "parseRow"));
  assert.ok(!moves.some((m) => m.binding.entityId === "fn:f" && m.binding.newTitle === "g"));
});

test("groundMove swaps the defines edge and adds the caller's induced import", () => {
  const move = CODE_OPERATORS.find((op) => op.name === "move");
  const s = normalizeGraphState({
    entities: [
      { id: "mod:a", class: "Module", title: "a" },
      { id: "mod:c", class: "Module", title: "c" },
      { id: "mod:b", class: "Module", title: "b" },
      { id: "fn:f", class: "Function", title: "f" },
      { id: "fn:h", class: "Function", title: "h" },
    ],
    edges: [
      { subject: "mod:a", predicate: "defines", object: "fn:f" },
      { subject: "mod:b", predicate: "defines", object: "fn:h" },
      { subject: "fn:h", predicate: "callsSymbol", object: "fn:f" },
    ],
  });
  const moves = move.ground(move, s, { moduleTargets: [{ id: "mod:c", title: "c" }] });
  const fMove = moves.find((m) => m.binding.entityId === "fn:f");
  assert.ok(fMove, "expected a move of f into c");
  assert.ok(fMove.effects.some((e) => e.op === "del-edge" && e.subject === "mod:a" && e.object === "fn:f"));
  assert.ok(fMove.effects.some((e) => e.op === "add-edge" && e.subject === "mod:c" && e.object === "fn:f" && e.predicate === "defines"));
  assert.ok(fMove.effects.some((e) => e.op === "add-edge" && e.subject === "mod:b" && e.object === "mod:c" && e.predicate === "imports"));
});

test("groundDeleteDead only offers goal-named, dependency-free entities", () => {
  const del = CODE_OPERATORS.find((op) => op.name === "delete-dead");
  const s = twoModule();
  assert.deepEqual(del.ground(del, s, { deleteTargets: ["fn:f"] }), []); // f is called, blocked
  const moves = del.ground(del, s, { deleteTargets: ["fn:g"] });
  assert.equal(moves.length, 1);
  assert.ok(moves[0].effects.some((e) => e.op === "del-entity" && e.id === "fn:g"));
});

test("codeGraphMoves is deterministic and prunes any move that would drop test coverage", () => {
  const s = normalizeGraphState({
    entities: [
      { id: "mod:a", class: "Module", title: "a" },
      { id: "mod:t", class: "Module", title: "t" },
      { id: "fn:g", class: "Function", title: "g" },
    ],
    edges: [
      { subject: "mod:a", predicate: "defines", object: "fn:g" },
      { subject: "mod:t", predicate: "tests", object: "mod:a" },
    ],
  });
  const context = { deleteTargets: ["fn:g"], titles: [], moduleTargets: [] };
  const first = codeGraphMoves(s, context);
  const second = codeGraphMoves(s, context);
  assert.deepEqual(first.map((m) => m.action.label), second.map((m) => m.action.label));
  // Deleting the whole covered module would drop coverage, but g is a function,
  // so its delete keeps mod:a (still covered) — the move survives.
  assert.ok(first.some((m) => m.action.name === "delete-dead"));
});

test("groundedOperators is the subset carrying a ground function", () => {
  const names = groundedOperators().map((op) => op.name).sort();
  assert.deepEqual(names, ["create-module", "delete-dead", "move", "rename"]);
});
