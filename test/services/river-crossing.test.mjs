// The shipped river-crossing world compiled through the same taught-action
// interpreter the chat lane already runs (data/games/river.txt), but with the
// "may not be left alone with" constraint derived from the world's own
// mgx:consumes/mgx:guards rows (constraintsFromDrives) rather than authored a
// second time as a rule row. The world source carries no action-constraint
// row at all — this file is the proof that the derived one is enough.
import { test } from "node:test";
import assert from "node:assert/strict";

import { compileDomain, stateFromFacts, stateKeyFor, movesFromRules, compileGoal } from "../../src/domain/domain.mjs";
import { findActionPath } from "../../src/domain/planning.mjs";
import { constraintsFromDrives } from "../../src/domain/agent-traits.mjs";
import { loadWorld, worldsPackDir } from "../../src/adapters/corpus/worlds-pack.mjs";

const FERRY_ACTION = "ferry onto";

/** The world's own action-signature/effect rows, plus the constraint rows
 *  `constraintsFromDrives` derives from whatever facts are handed in — the
 *  same merge a live page would run on every edit. */
function ruleRowsFor(facts, worldRules) {
  const authored = worldRules.map((r) => ({ name: r.name, kind: r.ruleKind, slots: r.slots }));
  const derived = constraintsFromDrives(facts).map((slots) => ({ name: FERRY_ACTION, kind: "action-constraint", slots }));
  return [...authored, ...derived];
}

function riverWorld() {
  const world = loadWorld(worldsPackDir(), "river-crossing");
  assert.ok(world, "the river-crossing world ships in the pack");
  return world;
}

function riverDomain(facts, worldRules) {
  return compileDomain(facts, ruleRowsFor(facts, worldRules));
}

function solve(facts, worldRules) {
  const domain = riverDomain(facts, worldRules);
  const start = stateFromFacts(facts, domain);
  const isGoal = compileGoal(
    [{ universal: true, term: "passenger", predicate: "currently-in", object: "bank-west" }],
    domain,
  );
  const result = findActionPath(start, isGoal, (s) => movesFromRules(s, domain), { maxDepth: 50, stateKey: stateKeyFor });
  return { domain, start, result };
}

test("the packed river world compiles to a domain carrying the ferry action and two derived constraints", () => {
  const world = riverWorld();
  const domain = riverDomain(world.facts, world.rules);
  const ferry = domain.actions.find((a) => a.name === FERRY_ACTION);
  assert.ok(ferry, "the ferry onto action compiles");
  assert.deepEqual(
    ferry.constraints.map((c) => `${c.left}/${c.right}/${c.guard}`).sort(),
    ["fox/goat/farmer", "goat/cabbage/farmer"],
  );
});

test("the opening state has exactly one legal move: ferry goat-1 onto bank-west", () => {
  const world = riverWorld();
  const { domain, start } = solve(world.facts, world.rules);
  assert.deepEqual(movesFromRules(start, domain).map((m) => m.action.label), ["ferry goat-1 onto bank-west"]);
});

test("findActionPath crosses the river in the classic optimum of 7 moves", () => {
  const world = riverWorld();
  const { result } = solve(world.facts, world.rules);
  assert.ok(result, "a crossing plan exists");
  assert.equal(result.actions.length, 7, "the classic optimum");
});

test("retracting the fox's appetite for the goat widens the search and shortens the plan", () => {
  const world = riverWorld();
  const facts = world.facts.filter((r) => !(r.subject === "fox" && r.predicate === "mgx:consumes" && r.object === "goat"));
  const { result } = solve(facts, world.rules);
  assert.ok(result, "a crossing plan still exists");
  assert.ok(result.actions.length < 7, `expected fewer than 7 moves, got ${result.actions.length}`);
});

test("giving the fox a second appetite the farmer cannot cover reports the honest miss, never a shortened plan", () => {
  const world = riverWorld();
  const facts = [...world.facts, { subject: "fox", predicate: "mgx:consumes", object: "cabbage" }];
  const { domain, start } = solve(facts, world.rules);
  assert.deepEqual(movesFromRules(start, domain), [], "every pair is now mutually exclusive, so nothing may move first");
  const { result } = solve(facts, world.rules);
  assert.equal(result, null, "no crossing sequence survives three mutually exclusive pairs guarded by one farmer");
});
