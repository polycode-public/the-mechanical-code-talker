// The planner over graph-predicate goals: a real multi-step refactor found over
// the committed tiny-webapp fixture graph, the plan's per-step receipt, and the
// honest miss when a goal's precondition can never be met within the catalogue.
// The fixture graph is read immutably (graphStateFromEntities builds a fresh
// state) and never written.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { graphStateFromEntities, normalizeGraphState } from "../../src/domain/codeplan/graph-delta.mjs";
import { moduleDefining } from "../../src/domain/codeplan/graph-predicates.mjs";
import {
  compileCodeGoal, deriveContext, planCodeChange, GOAL_PREDICATES,
} from "../../src/domain/codeplan/planner.mjs";

const REPO = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const FIXTURE_GRAPH = path.join(REPO, "examples", "tiny-webapp-src", ".tmct", "graph.json");
const fixtureState = () => graphStateFromEntities(JSON.parse(fs.readFileSync(FIXTURE_GRAPH, "utf8")));

const PARSE_ROW = "fn:lib/parse.mjs#parseRow";
const NEW_MODULE = "mod:lib/parse-row.mjs";

test("compileCodeGoal ANDs its specs and throws on an unknown kind", () => {
  const isGoal = compileCodeGoal([{ kind: "entity-titled", id: PARSE_ROW, title: "parseRow" }]);
  assert.equal(isGoal(fixtureState()), true);
  assert.equal(compileCodeGoal([{ kind: "entity-titled", id: PARSE_ROW, title: "parseCsvRow" }])(fixtureState()), false);
  assert.throws(() => compileCodeGoal([{ kind: "no-such-goal" }]), /unknown goal predicate/);
});

test("deriveContext pulls the parameter pool from the goal", () => {
  const ctx = deriveContext([
    { kind: "entity-titled", id: PARSE_ROW, title: "parseCsvRow" },
    { kind: "entity-in-module", id: PARSE_ROW, moduleId: NEW_MODULE },
    { kind: "entity-absent", id: "fn:x" },
  ]);
  assert.deepEqual(ctx.titles, ["parseCsvRow"]);
  assert.deepEqual(ctx.moduleTargets, [{ id: NEW_MODULE, title: "lib/parse-row.mjs" }]);
  assert.deepEqual(ctx.deleteTargets, ["fn:x"]);
});

test("planCodeChange finds a rename-then-move refactor of parseRow over the fixture graph", () => {
  const goal = [
    { kind: "entity-titled", id: PARSE_ROW, title: "parseCsvRow" },
    { kind: "entity-in-module", id: PARSE_ROW, moduleId: NEW_MODULE },
    // every former call site's module imports the new home
    { kind: "edge-present", subject: "mod:app.mjs", predicate: "imports", object: NEW_MODULE },
    { kind: "edge-present", subject: "mod:lib/store.mjs", predicate: "imports", object: NEW_MODULE },
  ];
  const result = planCodeChange(fixtureState(), goal);
  assert.ok(result, "expected a plan");
  // create-module, rename and move — three steps in some order.
  const ops = result.actions.map((a) => a.name).sort();
  assert.deepEqual(ops, ["create-module", "move", "rename"]);
  // The final state actually satisfies the goal.
  const final = result.states[result.states.length - 1];
  assert.equal(moduleDefining(final, PARSE_ROW), NEW_MODULE);
  assert.equal(final.entities.find((e) => e.id === PARSE_ROW).title, "parseCsvRow");
  // The per-step receipt carries each operator's declared effect.
  assert.ok(result.plan.every((step) => Array.isArray(step.effects) && step.effects.length > 0));
  assert.ok(result.plan.some((step) => step.operator === "move" && step.effects.some((e) => e.op === "add-edge" && e.predicate === "imports")));
});

test("planCodeChange is byte-deterministic: the same fixture, catalogue and goal re-run to the same plan", () => {
  const goal = [
    { kind: "entity-titled", id: PARSE_ROW, title: "parseCsvRow" },
    { kind: "entity-in-module", id: PARSE_ROW, moduleId: NEW_MODULE },
  ];
  const a = planCodeChange(fixtureState(), goal);
  const b = planCodeChange(fixtureState(), goal);
  assert.deepEqual(a.actions, b.actions);
  assert.deepEqual(a.states, b.states);
});

test("planCodeChange returns a single rename step when that alone meets the goal", () => {
  const result = planCodeChange(fixtureState(), [{ kind: "entity-titled", id: PARSE_ROW, title: "parseCsvRow" }]);
  assert.ok(result);
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].name, "rename");
});

test("honest miss: a rename onto a locked-in sibling collision with no escape route returns null", () => {
  // isBlank is a sibling of parseRow in lib/parse.mjs, so the rename collides;
  // the goal offers no target module, so parseRow cannot move out first, and
  // no catalogue operator resolves it — an honest miss, never a guess.
  const result = planCodeChange(fixtureState(), [{ kind: "entity-titled", id: PARSE_ROW, title: "isBlank" }]);
  assert.equal(result, null);
});

test("honest miss: deleting an entity that is still called cannot be reached", () => {
  // parseRow has two live call sites and no operator removes a callsSymbol edge,
  // so delete-dead's precondition can never hold.
  const result = planCodeChange(fixtureState(), [{ kind: "entity-absent", id: PARSE_ROW }]);
  assert.equal(result, null);
});

test("delete-dead plans when the entity is genuinely dead", () => {
  // A lone uncalled function is deletable in one step.
  const s = normalizeGraphState({
    entities: [
      { id: "mod:a", class: "Module", title: "a" },
      { id: "fn:dead", class: "Function", title: "dead" },
    ],
    edges: [{ subject: "mod:a", predicate: "defines", object: "fn:dead" }],
  });
  const result = planCodeChange(s, [{ kind: "entity-absent", id: "fn:dead" }]);
  assert.ok(result);
  assert.equal(result.actions.length, 1);
  assert.equal(result.actions[0].name, "delete-dead");
});

test("the goal-predicate vocabulary is the closed set the planner checks", () => {
  assert.deepEqual(
    Object.keys(GOAL_PREDICATES).sort(),
    ["edge-absent", "edge-present", "entity-absent", "entity-in-module", "entity-titled"],
  );
});
