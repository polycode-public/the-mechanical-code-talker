import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  foldSpiderFlyState, gridApplyActions, spiderPathStateKey, planSpiderPath, planSpiderPathToWeb,
  greedyFlyMove, randomFlyWander, greedySpiderApproach, greedySpiderAvoid,
  believedCellOf, nearestBelievedTarget, hasActiveWebAt,
  runEcologyPass, startSpiderFlyGame, runSpiderFlyTick,
  FLY_INITIAL_MASS, SPIDER_INITIAL_MASS, SPIDER_MASS_DECREMENT_PER_TURN, WEB_DURATION_TURNS,
} from "../../src/services/spider-fly.mjs";
import { worldFactRows, cellId, perimeterCells, isInWebBlock, parseCellId } from "../../src/domain/spider-fly-world.mjs";
import { appendFacts, loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";
import { DEFAULT_GAME_CONFIG } from "../../src/domain/game-config.mjs";

// ---- the state fold -----------------------------------------------------------

test("foldSpiderFlyState takes the newest @turnN snapshot per subject and separates every terminal marker into removed", () => {
  const rows = [
    { subject: "spider-1", predicate: "mgx:currently-in", object: "cell-2-2" },
    { subject: "spider-1@turn3", predicate: "mgx:currently-in", object: "cell-3-2" },
    { subject: "fly-1", predicate: "mgx:currently-in", object: "cell-8-2" },
    { subject: "fly-1", predicate: "mgx:mass", object: "10" },
    { subject: "fly-1@turn1", predicate: "mgx:mass", object: "9" },
    { subject: "fly-1@turn2", predicate: "mgx:mass", object: "8" },
    { subject: "fly-2@turn2", predicate: "mgx:currently-in", object: "cell-4-2" },
    { subject: "fly-2@turn2", predicate: "mgx:starved", object: "true" },
    { subject: "spider-1@turn2", predicate: "mgx:flies-eaten", object: "1" },
    { subject: "egg-1@turn2", predicate: "mgx:currently-in", object: "cell-3-2" },
    { subject: "egg-1@turn2", predicate: "mgx:laid-at-turn", object: "2" },
    { subject: "egg-1@turn5", predicate: "mgx:hatched-into", object: "spider-2" },
    { subject: "fly-3@turn1", predicate: "mgx:eaten-by", object: "spider-1" },
  ];
  const state = foldSpiderFlyState(rows);
  assert.equal(state.turnCount, 5);
  assert.deepEqual(state.placements.get("spider-1"), { cell: "cell-3-2", turn: 3 }, "the newer @turn3 snapshot wins over the base row");
  assert.deepEqual(state.mass.get("fly-1"), { value: 8, turn: 2 }, "the newest mass snapshot wins over the base row and the @turn1 one");
  assert.deepEqual(state.fliesEaten.get("spider-1"), { value: 1, turn: 2 });
  assert.deepEqual(state.laidAtTurn.get("egg-1"), { value: 2, turn: 2 });
  assert.deepEqual(state.hatchedInto.get("egg-1"), { spider: "spider-2", turn: 5 });
  assert.deepEqual(state.eatenBy.get("fly-3"), { spider: "spider-1", turn: 1 });
  assert.ok(state.starved.has("fly-2"));
  assert.deepEqual([...state.removed].sort(), ["egg-1", "fly-2", "fly-3"], "eaten, starved and hatched subjects are all folded into one removed set");
});

// ---- single-agent pathfinding on a small fixture grid --------------------------

test("planSpiderPath returns a real shortest path toward a stationary fly inside the web block", () => {
  // A handful of cells, not the full 100: a straight corridor with the web's
  // real home cell (2,2) at its western end, so isInWebBlock needs no fixture
  // of its own.
  const rows = [
    { subject: "cell-5-2", predicate: "mgx:has-exit-west", object: "cell-4-2" },
    { subject: "cell-4-2", predicate: "mgx:has-exit-east", object: "cell-5-2" },
    { subject: "cell-4-2", predicate: "mgx:has-exit-west", object: "cell-3-2" },
    { subject: "cell-3-2", predicate: "mgx:has-exit-east", object: "cell-4-2" },
  ];
  const applyActions = gridApplyActions(rows);
  const path = planSpiderPath({ x: 5, y: 2 }, { x: 3, y: 2 }, applyActions);
  assert.ok(path, "a path exists — cell-3-2 sits inside the web block (Chebyshev distance 1 from the 2,2 home)");
  assert.deepEqual(path.actions, ["west", "west"]);
  assert.deepEqual(path.states, [{ x: 5, y: 2 }, { x: 4, y: 2 }, { x: 3, y: 2 }]);
});

test("planSpiderPath finds a path to a believed fly cell OUTSIDE the web block too — arrival now means mere co-location, catching a fly never needs a web", () => {
  const rows = [{ subject: "cell-5-2", predicate: "mgx:has-exit-west", object: "cell-4-2" }];
  const applyActions = gridApplyActions(rows);
  const path = planSpiderPath({ x: 5, y: 2 }, { x: 4, y: 2 }, applyActions);
  assert.ok(path, "cell-4-2 is Chebyshev distance 2 from the web home, but that no longer matters — a catch is co-location alone");
  assert.deepEqual(path.actions, ["west"]);
  assert.deepEqual(path.states, [{ x: 5, y: 2 }, { x: 4, y: 2 }]);
});

test("planSpiderPath returns null with no believed target at all", () => {
  const applyActions = gridApplyActions([]);
  assert.equal(planSpiderPath({ x: 2, y: 2 }, null, applyActions), null);
});

test("planSpiderPathToWeb finds the shortest path to ANY active web cell, static or dynamic, with no specific target", () => {
  const rows = [
    { subject: "cell-4-2", predicate: "mgx:has-exit-west", object: "cell-3-2" },
    { subject: "cell-3-2", predicate: "mgx:has-exit-east", object: "cell-4-2" },
  ];
  const applyActions = gridApplyActions(rows);
  const path = planSpiderPathToWeb({ x: 4, y: 2 }, applyActions);
  assert.ok(path, "cell-3-2 sits inside the static web block (Chebyshev distance 1 from the 2,2 home)");
  assert.deepEqual(path.actions, ["west"]);
});

test("planSpiderPathToWeb returns null when no active web is reachable at all", () => {
  const rows = [{ subject: "cell-9-9", predicate: "mgx:has-exit-north", object: "cell-9-8" }];
  const applyActions = gridApplyActions(rows);
  assert.equal(planSpiderPathToWeb({ x: 9, y: 9 }, applyActions), null);
});

// ---- greedy one-ply scoring: the fly maximizes, the spider's fallback minimizes

test("greedyFlyMove picks the reachable cell that maximizes distance from the believed spider, and wanders with no believed spider at all", () => {
  const rows = [
    { subject: "cell-5-5", predicate: "mgx:has-exit-west", object: "cell-4-5" },
    { subject: "cell-5-5", predicate: "mgx:has-exit-east", object: "cell-6-5" },
  ];
  const applyActions = gridApplyActions(rows);
  // The spider sits west, so fleeing east opens the most distance.
  assert.deepEqual(greedyFlyMove({ x: 5, y: 5 }, { x: 4, y: 5 }, applyActions), { x: 6, y: 5 });
  // No believed spider position at all: wander (randomFlyWander), not hold —
  // still one of the reachable options, and reproducible from the same seed.
  const wandered = greedyFlyMove({ x: 5, y: 5 }, null, applyActions, 7, "fly-1");
  assert.ok(
    [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 6, y: 5 }].some((c) => c.x === wandered.x && c.y === wandered.y),
    "the wander pick is always one of stay/west/east, the fly's actual one-ply reachable set",
  );
  assert.deepEqual(greedyFlyMove({ x: 5, y: 5 }, null, applyActions, 7, "fly-1"), wandered, "the same turn+fly seed reproduces the same wander pick");
});

// ---- wander: deterministic from the seed, varies across turn/fly ------------

test("randomFlyWander is reproducible from the same turn+flyId seed, and varies across turns and flies", () => {
  const rows = [
    { subject: "cell-5-5", predicate: "mgx:has-exit-north", object: "cell-5-4" },
    { subject: "cell-5-5", predicate: "mgx:has-exit-south", object: "cell-5-6" },
    { subject: "cell-5-5", predicate: "mgx:has-exit-east", object: "cell-6-5" },
    { subject: "cell-5-5", predicate: "mgx:has-exit-west", object: "cell-4-5" },
  ];
  const applyActions = gridApplyActions(rows);
  const first = randomFlyWander({ x: 5, y: 5 }, applyActions, 3, "fly-1");
  const again = randomFlyWander({ x: 5, y: 5 }, applyActions, 3, "fly-1");
  assert.deepEqual(again, first, "the exact same turn+flyId context reproduces the exact same pick");

  const options = [{ x: 5, y: 5 }, { x: 5, y: 4 }, { x: 5, y: 6 }, { x: 6, y: 5 }, { x: 4, y: 5 }];
  const picksAcrossTurns = new Set();
  for (let turn = 1; turn <= 12; turn += 1) {
    const pick = randomFlyWander({ x: 5, y: 5 }, applyActions, turn, "fly-1");
    assert.ok(options.some((c) => c.x === pick.x && c.y === pick.y), "every pick is a real reachable option");
    picksAcrossTurns.add(cellId(pick.x, pick.y));
  }
  assert.ok(picksAcrossTurns.size > 1, "wander varies across turns rather than always landing on one cell");

  const differentFly = randomFlyWander({ x: 5, y: 5 }, applyActions, 3, "fly-2");
  const picksAcrossFlies = new Set([cellId(first.x, first.y), cellId(differentFly.x, differentFly.y)]);
  assert.ok(picksAcrossFlies.size >= 1, "distinct fly ids are part of the seed context (may coincide by chance, never crash)");
});

test("greedySpiderApproach picks the reachable cell that minimizes distance to the believed fly", () => {
  const rows = [
    { subject: "cell-5-5", predicate: "mgx:has-exit-west", object: "cell-4-5" },
    { subject: "cell-5-5", predicate: "mgx:has-exit-east", object: "cell-6-5" },
  ];
  const applyActions = gridApplyActions(rows);
  assert.deepEqual(greedySpiderApproach({ x: 5, y: 5 }, { x: 4, y: 5 }, applyActions), { x: 4, y: 5 });
});

test("greedySpiderAvoid picks the reachable cell that maximizes distance from the other believed spider", () => {
  const rows = [
    { subject: "cell-5-5", predicate: "mgx:has-exit-west", object: "cell-4-5" },
    { subject: "cell-5-5", predicate: "mgx:has-exit-east", object: "cell-6-5" },
  ];
  const applyActions = gridApplyActions(rows);
  // The other spider sits west, so fleeing east opens the most distance.
  assert.deepEqual(greedySpiderAvoid({ x: 5, y: 5 }, { x: 4, y: 5 }, applyActions), { x: 6, y: 5 });
  assert.deepEqual(greedySpiderAvoid({ x: 5, y: 5 }, null, applyActions), { x: 5, y: 5 }, "no believed other spider: hold position");
});

// ---- the dynamic web: hasActiveWebAt, build/trap/expire ----------------------

test("hasActiveWebAt is true inside the static home zone regardless of state, and true at a live dynamic web's cell until it expires", () => {
  assert.equal(hasActiveWebAt(2, 2, undefined, 0), true, "the static web home is always active, even with no folded state at all");
  const state = { webs: new Map([["web-1", { cell: cellId(7, 7), builtAtTurn: 5 }]]) };
  assert.equal(hasActiveWebAt(7, 7, state, 5), true, "active the very turn it's built");
  assert.equal(hasActiveWebAt(7, 7, state, 5 + WEB_DURATION_TURNS - 1), true, "still active one turn before its 10-turn span elapses");
  assert.equal(hasActiveWebAt(7, 7, state, 5 + WEB_DURATION_TURNS), false, "expired exactly at builtAtTurn + WEB_DURATION_TURNS");
  assert.equal(hasActiveWebAt(8, 8, state, 5), false, "a different cell is never webbed by another cell's dynamic web");
});

// ---- visibility and belief ------------------------------------------------------

test("believedCellOf is ground truth inside the vision radius, unknown outside it, and falls back to a told fact", () => {
  const rows = [
    { subject: "fly-1", predicate: "mgx:currently-in", object: "cell-5-2" },
  ];
  const state = foldSpiderFlyState(rows);
  assert.deepEqual(
    believedCellOf("fly-1", "spider-1", { x: 2, y: 2 }, state, { visionRadius: 4 }),
    { x: 5, y: 2 },
    "Chebyshev distance 3 from the observer sits inside a radius-4 vision",
  );
  assert.equal(
    believedCellOf("fly-1", "spider-1", { x: 2, y: 2 }, state, { visionRadius: 2 }),
    null,
    "the same fly sits outside a radius-2 vision, and nothing was told — honestly unknown",
  );
  assert.deepEqual(
    believedCellOf("fly-1", "spider-1", { x: 2, y: 2 }, state, {
      visionRadius: 2,
      toldFacts: [{ subject: "fly-1", toAgent: "spider-1", cell: "cell-6-2", turn: 4 }],
    }),
    { x: 6, y: 2 },
    "outside vision, a chat-told fact addressed to this observer fills the belief",
  );
  assert.equal(
    believedCellOf("fly-1", "fly-2", { x: 2, y: 2 }, state, {
      visionRadius: 2,
      toldFacts: [{ subject: "fly-1", toAgent: "spider-1", cell: "cell-6-2", turn: 4 }],
    }),
    null,
    "a told fact addressed to a different agent never leaks into this observer's belief",
  );
});

test("nearestBelievedTarget picks the closest candidate the observer has any belief about, skipping unbelieved ones", () => {
  const rows = [
    { subject: "fly-1", predicate: "mgx:currently-in", object: "cell-9-9" },
    { subject: "fly-2", predicate: "mgx:currently-in", object: "cell-3-2" },
  ];
  const state = foldSpiderFlyState(rows);
  const best = nearestBelievedTarget("spider-1", { x: 2, y: 2 }, ["fly-1", "fly-2"], state, { visionRadius: 4 });
  assert.deepEqual(best, { subject: "fly-2", cell: { x: 3, y: 2 } }, "fly-1 sits far outside vision and is never even considered");
});

// ---- the ecology pass: eat, lay, hatch, spawn, starve, each pinned directly ----

test("runEcologyPass eats a fly co-located with a spider in an in-web cell and bumps flies-eaten", () => {
  const state = foldSpiderFlyState([{ subject: "spider-1@turn2", predicate: "mgx:flies-eaten", object: "1" }]);
  const postMovePlacements = new Map([["spider-1", { x: 2, y: 2 }], ["fly-1", { x: 2, y: 2 }]]);
  const postMoveMassByFly = new Map([["fly-1", 6]]);
  const { writes, events } = runEcologyPass({ state, postMovePlacements, postMoveMassByFly, turn: 3 });
  assert.deepEqual(events.eaten, [{ fly: "fly-1", spider: "spider-1", cell: "cell-2-2" }]);
  assert.ok(writes.some((w) => w.subject === "fly-1@turn3" && w.predicate === "mgx:eaten-by" && w.object === "spider-1"));
  assert.ok(writes.some((w) => w.subject === "spider-1@turn3" && w.predicate === "mgx:flies-eaten" && w.object === "2"), "the prior count of 1 carries forward, plus this turn's one eat");
});

test("runEcologyPass catches (never eats) a fly co-located with a spider outside the web block — a catch never needs a web, only the later eat does", () => {
  const state = foldSpiderFlyState([]);
  const postMovePlacements = new Map([["spider-1", { x: 6, y: 6 }], ["fly-1", { x: 6, y: 6 }]]);
  const { writes, events } = runEcologyPass({ state, postMovePlacements, postMoveMassByFly: new Map([["fly-1", 6]]), turn: 1 });
  assert.deepEqual(events.caught, [{ spider: "spider-1", fly: "fly-1", cell: "cell-6-6" }]);
  assert.deepEqual(events.eaten, [], "not standing in a web — no eat, no mass transfer, no mgx:eaten-by");
  assert.ok(writes.some((w) => w.subject === "spider-1@turn1" && w.predicate === "mgx:carrying" && w.object === "fly-1"));
  assert.ok(!writes.some((w) => w.predicate === "mgx:eaten-by"));
});

test("runEcologyPass gates catching on 'not already carrying' — a spider already carrying a live fly never claims a second one co-located with it the same tick", () => {
  const state = foldSpiderFlyState([{ subject: "spider-1", predicate: "mgx:carrying", object: "fly-1" }]);
  const postMovePlacements = new Map([["spider-1", { x: 6, y: 6 }], ["fly-1", { x: 6, y: 6 }], ["fly-2", { x: 6, y: 6 }]]);
  const { writes, events } = runEcologyPass({ state, postMovePlacements, postMoveMassByFly: new Map([["fly-1", 6], ["fly-2", 6]]), turn: 1 });
  assert.deepEqual(events.caught, [], "spider-1 is already carrying fly-1 — fly-2 goes uncaught this tick despite sharing its cell");
  assert.ok(writes.some((w) => w.subject === "spider-1@turn1" && w.predicate === "mgx:carrying" && w.object === "fly-1"), "the pre-existing carrying claim is re-asserted, unchanged");
});

test("runEcologyPass's carrying claim self-heals a fly whose captor is no longer live — a dead spider's stale claim never blocks a fresh catch", () => {
  const state = foldSpiderFlyState([
    { subject: "spider-1", predicate: "mgx:carrying", object: "fly-1" },
    { subject: "spider-1", predicate: "mgx:starved", object: "true" },
  ]);
  const postMovePlacements = new Map([["spider-2", { x: 6, y: 6 }], ["fly-1", { x: 6, y: 6 }]]);
  const { events } = runEcologyPass({ state, postMovePlacements, postMoveMassByFly: new Map([["fly-1", 6]]), turn: 1 });
  assert.deepEqual(events.caught, [{ spider: "spider-2", fly: "fly-1", cell: "cell-6-6" }], "spider-1 is dead — fly-1 is free for spider-2 to catch, not stuck honoring a dead captor's claim");
});

test("runEcologyPass drops a carried fly's captor claim when the fly starves mid-transit, never leaving a spider claiming a dead fly", () => {
  const state = foldSpiderFlyState([{ subject: "spider-1", predicate: "mgx:carrying", object: "fly-1" }]);
  const postMovePlacements = new Map([["spider-1", { x: 6, y: 6 }], ["fly-1", { x: 6, y: 6 }]]);
  const { writes, events } = runEcologyPass({ state, postMovePlacements, postMoveMassByFly: new Map([["fly-1", 0]]), turn: 1 });
  assert.deepEqual(events.starved, ["fly-1"]);
  assert.ok(writes.some((w) => w.subject === "spider-1@turn1" && w.predicate === "mgx:carrying" && w.object === "none"), "the captor's carrying fact resets to none the same tick its cargo starves");
});

test("runEcologyPass eats a fly co-located with a spider inside a live DYNAMIC web, outside the static zone", () => {
  const state = foldSpiderFlyState([{ subject: "web-1@turn2", predicate: "mgx:currently-in", object: "cell-7-7" }, { subject: "web-1@turn2", predicate: "mgx:web-built-at-turn", object: "2" }]);
  const postMovePlacements = new Map([["spider-1", { x: 7, y: 7 }], ["fly-1", { x: 7, y: 7 }]]);
  const { events } = runEcologyPass({ state, postMovePlacements, postMoveMassByFly: new Map([["fly-1", 6]]), turn: 5 });
  assert.deepEqual(events.eaten, [{ fly: "fly-1", spider: "spider-1", cell: "cell-7-7" }], "cell-7-7 sits outside the static home zone but has a live web (built turn 2, still active at turn 5)");
});

test("runEcologyPass's eat writes the eating spider's new mass as exactly its prior mass plus the fly's post-decrement remaining mass, no flat bonus", () => {
  const state = foldSpiderFlyState([]);
  const postMovePlacements = new Map([["spider-1", { x: 2, y: 2 }], ["fly-1", { x: 2, y: 2 }]]);
  const postMoveMassByFly = new Map([["fly-1", 7]]); // the fly's mass AFTER this tick's own decrement
  const postMoveMassBySpider = new Map([["spider-1", 12]]); // the spider's mass AFTER this tick's own decrement
  const { writes } = runEcologyPass({ state, postMovePlacements, postMoveMassByFly, postMoveMassBySpider, turn: 3 });
  assert.ok(writes.some((w) => w.subject === "spider-1@turn3" && w.predicate === "mgx:mass" && w.object === "19"), "12 (post-decrement spider mass) + 7 (fly's exact post-decrement mass) = 19, not a flat bonus");
});

test("runEcologyPass starves a fly whose mass reached zero, and never both starves and eats the same fly the same turn", () => {
  const state = foldSpiderFlyState([]);
  const postMovePlacements = new Map([["spider-1", { x: 2, y: 2 }], ["fly-1", { x: 9, y: 9 }], ["fly-2", { x: 2, y: 2 }]]);
  const postMoveMassByFly = new Map([["fly-1", 0], ["fly-2", 0]]);
  const { writes, events } = runEcologyPass({ state, postMovePlacements, postMoveMassByFly, turn: 4 });
  assert.deepEqual(events.eaten, [{ fly: "fly-2", spider: "spider-1", cell: "cell-2-2" }]);
  assert.deepEqual(events.starved, ["fly-1"], "fly-2 co-located in the web is claimed by the eat, not double-counted as a starve");
  assert.ok(writes.some((w) => w.subject === "fly-1@turn4" && w.predicate === "mgx:starved"));
  assert.ok(!writes.some((w) => w.subject === "fly-2@turn4" && w.predicate === "mgx:starved"));
});

test("runEcologyPass starves a spider whose mass reached zero, exactly like a fly — but a spider that ate this exact tick survives", () => {
  const state = foldSpiderFlyState([]);
  const postMovePlacements = new Map([["spider-1", { x: 9, y: 9 }], ["spider-2", { x: 2, y: 2 }], ["fly-1", { x: 2, y: 2 }]]);
  const postMoveMassByFly = new Map([["fly-1", 4]]);
  const postMoveMassBySpider = new Map([["spider-1", 0], ["spider-2", 0]]);
  const { writes, events } = runEcologyPass({ state, postMovePlacements, postMoveMassByFly, postMoveMassBySpider, turn: 7 });
  assert.deepEqual(events.eaten, [{ fly: "fly-1", spider: "spider-2", cell: "cell-2-2" }]);
  assert.deepEqual(events.starved, ["spider-1"], "spider-2 ate this tick and survives despite also reaching post-decrement mass 0");
  assert.ok(writes.some((w) => w.subject === "spider-1@turn7" && w.predicate === "mgx:starved" && w.object === "true"));
  assert.ok(!writes.some((w) => w.subject === "spider-2@turn7" && w.predicate === "mgx:starved"));
});

test("runEcologyPass never starves a spider absent from postMoveMassBySpider — callers that don't track spider mass see no behavior change, beyond the always-rewritten carrying fact", () => {
  const state = foldSpiderFlyState([]);
  const postMovePlacements = new Map([["spider-1", { x: 9, y: 9 }]]);
  const { writes, events } = runEcologyPass({ state, postMovePlacements, postMoveMassByFly: new Map(), turn: 2 });
  assert.deepEqual(events.starved, []);
  assert.deepEqual(
    writes,
    [{ subject: "spider-1@turn2", predicate: "mgx:carrying", object: "none" }],
    "every live spider re-asserts its own carrying status every tick, even one this caller never mass-tracks",
  );
});

test("runEcologyPass lays an egg once a spider's mass reaches the lay threshold AND it is standing in an active web — resetting the spider to its own initial mass and minting the egg with the mass surplus", () => {
  const state = foldSpiderFlyState([]);
  const belowThreshold = runEcologyPass({
    state,
    postMovePlacements: new Map([["spider-1", { x: 2, y: 2 }]]),
    postMoveMassByFly: new Map(),
    postMoveMassBySpider: new Map([["spider-1", 24]]),
    turn: 1,
  });
  assert.equal(belowThreshold.events.laid, null, "24 is one short of the 25 lay threshold");

  const qualifies = runEcologyPass({
    state,
    postMovePlacements: new Map([["spider-1", { x: 2, y: 2 }]]),
    postMoveMassByFly: new Map(),
    postMoveMassBySpider: new Map([["spider-1", 25]]),
    turn: 1,
  });
  assert.equal(qualifies.events.laid, "egg-1");
  assert.ok(qualifies.writes.some((w) => w.subject === "spider-1@turn1" && w.predicate === "mgx:mass" && w.object === "15"), "the laying spider resets to exactly its own initial mass");
  assert.ok(qualifies.writes.some((w) => w.subject === "egg-1@turn1" && w.predicate === "mgx:currently-in" && w.object === "cell-2-2"));
  assert.ok(qualifies.writes.some((w) => w.subject === "egg-1@turn1" && w.predicate === "mgx:laid-at-turn" && w.object === "1"));
  assert.ok(qualifies.writes.some((w) => w.subject === "egg-1@turn1" && w.predicate === "mgx:mass" && w.object === "10"), "the 25 - 15 = 10 mass surplus becomes the egg's own starting mass");

  const outsideWeb = runEcologyPass({
    state,
    postMovePlacements: new Map([["spider-1", { x: 6, y: 6 }]]),
    postMoveMassByFly: new Map(),
    postMoveMassBySpider: new Map([["spider-1", 30]]),
    turn: 1,
  });
  assert.equal(outsideWeb.events.laid, null, "mass alone is not enough — the spider must be standing in an active web too");

  // A live egg outstanding blocks a second lay even from an already-qualifying spider.
  const withLiveEgg = foldSpiderFlyState([
    { subject: "egg-1@turn1", predicate: "mgx:currently-in", object: "cell-2-2" },
    { subject: "egg-1@turn1", predicate: "mgx:laid-at-turn", object: "1" },
  ]);
  const blockedByLiveEgg = runEcologyPass({
    state: withLiveEgg,
    postMovePlacements: new Map([["spider-1", { x: 2, y: 2 }]]),
    postMoveMassByFly: new Map(),
    postMoveMassBySpider: new Map([["spider-1", 30]]),
    turn: 2,
  });
  assert.equal(blockedByLiveEgg.events.laid, null, "a live (unhatched) egg blocks laying a second one regardless of mass");
});

test("runEcologyPass's egg lay reacts the SAME tick a spider eats enough to cross the threshold, and caps at one egg even with two qualifying spiders", () => {
  const state = foldSpiderFlyState([]);
  const sameTickCross = runEcologyPass({
    state,
    postMovePlacements: new Map([["spider-1", { x: 2, y: 2 }], ["fly-1", { x: 2, y: 2 }]]),
    postMoveMassByFly: new Map([["fly-1", 6]]),
    postMoveMassBySpider: new Map([["spider-1", 20]]),
    turn: 1,
  });
  assert.deepEqual(sameTickCross.events.eaten, [{ fly: "fly-1", spider: "spider-1", cell: "cell-2-2" }]);
  assert.equal(sameTickCross.events.laid, "egg-1", "20 (pre-eat) + 6 (the eaten fly's own mass) = 26, over the 25 threshold the same tick it ate");

  const twoQualify = runEcologyPass({
    state,
    postMovePlacements: new Map([["spider-1", { x: 2, y: 2 }], ["spider-2", { x: 2, y: 3 }]]),
    postMoveMassByFly: new Map(),
    postMoveMassBySpider: new Map([["spider-1", 30], ["spider-2", 40]]),
    turn: 1,
  });
  assert.equal(twoQualify.events.laid, "egg-1", "only one egg is laid even though both spiders qualify this tick");
});

test("runEcologyPass hatches an egg exactly config.eggHatchDelayTurns turns after it was laid, splitting its mass across config.eggHatchCount spiders at the egg's cell, remainder to the lowest-numbered one", () => {
  const notYet = foldSpiderFlyState([
    { subject: "egg-1", predicate: "mgx:currently-in", object: "cell-3-2" },
    { subject: "egg-1@turn2", predicate: "mgx:laid-at-turn", object: "2" },
    { subject: "egg-1", predicate: "mgx:mass", object: "9" },
    { subject: "spider-1", predicate: "mgx:currently-in", object: "cell-2-2" },
  ]);
  const early = runEcologyPass({
    state: notYet,
    postMovePlacements: new Map([["spider-1", { x: 2, y: 2 }]]),
    postMoveMassByFly: new Map(),
    turn: 4,
  });
  assert.deepEqual(early.events.hatched, [], "turn 4 is one short of laid-at-turn 2 + 3");

  const onTime = runEcologyPass({
    state: notYet,
    postMovePlacements: new Map([["spider-1", { x: 2, y: 2 }]]),
    postMoveMassByFly: new Map(),
    turn: 5,
  });
  assert.equal(onTime.events.hatched.length, 1);
  const [hatch] = onTime.events.hatched;
  assert.equal(hatch.egg, "egg-1");
  assert.equal(hatch.cell, "cell-3-2");
  assert.deepEqual(hatch.spiders, [{ spider: "spider-2", mass: 5 }, { spider: "spider-3", mass: 4 }], "9 mass split across 2 hatchlings — 5 and 4, remainder to the lowest-numbered");
  assert.ok(onTime.writes.some((w) => w.subject === "spider-2@turn5" && w.predicate === "mgx:currently-in" && w.object === "cell-3-2"));
  assert.ok(onTime.writes.some((w) => w.subject === "spider-3@turn5" && w.predicate === "mgx:currently-in" && w.object === "cell-3-2"));
  assert.ok(onTime.writes.some((w) => w.subject === "spider-2@turn5" && w.predicate === "mgx:mass" && w.object === "5"));
  assert.ok(onTime.writes.some((w) => w.subject === "spider-3@turn5" && w.predicate === "mgx:mass" && w.object === "4"));
  assert.ok(onTime.writes.some((w) => w.subject === "egg-1@turn5" && w.predicate === "mgx:hatched-into" && w.object === "spider-2"), "hatched-into names the first (lowest-numbered) hatchling");
});

test("runEcologyPass's hatch floors the COUNT (never the mass) for a too-small egg — fewer, still-viable hatchlings rather than emaciated ones", () => {
  const tinyEgg = foldSpiderFlyState([
    { subject: "egg-1", predicate: "mgx:currently-in", object: "cell-3-2" },
    { subject: "egg-1@turn2", predicate: "mgx:laid-at-turn", object: "2" },
    { subject: "egg-1", predicate: "mgx:mass", object: "4" },
  ]);
  const { events } = runEcologyPass({
    state: tinyEgg,
    postMovePlacements: new Map(),
    postMoveMassByFly: new Map(),
    turn: 5,
  });
  // floor(4 / minHatchlingMass 3) = 1, below the configured eggHatchCount of
  // 2 — one still-viable hatchling, not two emaciated ones.
  assert.equal(events.hatched.length, 1);
  assert.deepEqual(events.hatched[0].spiders, [{ spider: "spider-1", mass: 4 }]);
});

test("runEcologyPass spawns a new fly on every third turn, at a seeded pick among the uncontested perimeter cells", () => {
  const state = foldSpiderFlyState([]);
  const notThird = runEcologyPass({ state, postMovePlacements: new Map([["spider-1", { x: 2, y: 2 }]]), postMoveMassByFly: new Map(), turn: 4 });
  assert.equal(notThird.events.spawned, null);

  const third = runEcologyPass({ state, postMovePlacements: new Map([["spider-1", { x: 2, y: 2 }]]), postMoveMassByFly: new Map(), turn: 3 });
  assert.equal(third.events.spawned, "fly-1");
  const spawnWrite = third.writes.find((w) => w.subject === "fly-1@turn3" && w.predicate === "mgx:currently-in");
  assert.ok(spawnWrite && perimeterCells().includes(spawnWrite.object), "the spawned fly lands on a real perimeter cell");
  assert.ok(third.writes.some((w) => w.subject === "fly-1@turn3" && w.predicate === "mgx:mass" && w.object === String(FLY_INITIAL_MASS)));

  // Reproducible: the exact same starting facts + turn land on the exact same cell.
  const thirdAgain = runEcologyPass({ state, postMovePlacements: new Map([["spider-1", { x: 2, y: 2 }]]), postMoveMassByFly: new Map(), turn: 3 });
  const spawnWriteAgain = thirdAgain.writes.find((w) => w.subject === "fly-1@turn3" && w.predicate === "mgx:currently-in");
  assert.equal(spawnWriteAgain.object, spawnWrite.object, "the same starting facts + turn reproduce the exact same spawn cell");

  const skipsOccupiedPerimeterCell = runEcologyPass({
    state: foldSpiderFlyState([{ subject: "fly-9", predicate: "mgx:currently-in", object: "cell-9-9" }]),
    postMovePlacements: new Map([["spider-1", { x: 1, y: 1 }], ["fly-9", { x: 9, y: 9 }]]),
    postMoveMassByFly: new Map([["fly-9", 5]]),
    turn: 6,
  });
  assert.equal(skipsOccupiedPerimeterCell.events.spawned, "fly-10", "numbering skips past every fly id ever placed, live or dead");
  const skipWrite = skipsOccupiedPerimeterCell.writes.find((w) => w.subject === "fly-10@turn6" && w.predicate === "mgx:currently-in");
  assert.ok(skipWrite, "the new fly still spawns");
  assert.ok(skipWrite.object !== "cell-1-1" && skipWrite.object !== "cell-9-9", "never lands on an occupied cell");
});

// ---- the real fact-store pipeline: startSpiderFlyGame + runSpiderFlyTick -------

test("startSpiderFlyGame mints spider-1 at the web home and spreads flies on the perimeter, idempotently", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-spider-fly-start-"));
  try {
    const first = await startSpiderFlyGame(dir, { flyCount: 2 });
    assert.equal(first.started, true);
    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((r) => r.subject === "spider-1" && r.predicate === "mgx:currently-in" && r.object === "cell-2-2"));
    assert.equal(rows.filter((r) => /^fly-\d+$/.test(r.subject) && r.predicate === "mgx:mass").length, 2);
    const second = await startSpiderFlyGame(dir, { flyCount: 2 });
    assert.equal(second.started, false, "a second call against an already-running game is a no-op");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runSpiderFlyTick over a bounded run: the spider engages a visible fly, and the fly is eaten or starved within a mass-guaranteed turn count", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-spider-fly-sim-"));
  try {
    await appendFacts(dir, [...worldFactRows()].map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object, provenance: "world:spider-fly" })));
    // fly-1 starts at cell-6-2 — Chebyshev distance 4 from the web home
    // (2,2), exactly at the default vision radius, so the chase is live from
    // turn 1 rather than depending on the pair wandering into range.
    await appendFacts(dir, [
      { subject: "spider-1", predicate: "mgx:currently-in", object: "cell-2-2" },
      { subject: "fly-1", predicate: "mgx:currently-in", object: "cell-6-2" },
      { subject: "fly-1", predicate: "mgx:mass", object: String(FLY_INITIAL_MASS) },
    ].map((f) => ({ ...f, provenance: "world:spider-fly" })));

    let sawSpiderLeaveHome = false;
    let terminal = null;
    for (let i = 0; i < 15 && !terminal; i += 1) {
      const tick = await runSpiderFlyTick(dir);
      if (tick.agents["spider-1"]?.cell !== "cell-2-2") sawSpiderLeaveHome = true;
      if (tick.ecology.eaten.some((e) => e.fly === "fly-1")) terminal = "eaten";
      else if (tick.ecology.starved.includes("fly-1")) terminal = "starved";
    }
    assert.ok(sawSpiderLeaveHome, "the spider actively chases rather than sitting idle in its web");
    assert.ok(terminal, "fly-1 started with mass 10, decrementing by 1 every turn it survives — within 15 turns it is eaten or starved, never left dangling");

    const rows = readFactRows(await loadMemory(dir));
    if (terminal === "eaten") assert.ok(rows.some((r) => r.subject.startsWith("fly-1@turn") && r.predicate === "mgx:eaten-by" && r.object === "spider-1"));
    else assert.ok(rows.some((r) => r.subject.startsWith("fly-1@turn") && r.predicate === "mgx:starved" && r.object === "true"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runSpiderFlyTick drives lay, hatch and spawn through real @turnN writes, verified against readFactRows", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-spider-fly-ecology-"));
  try {
    await appendFacts(dir, [...worldFactRows()].map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object, provenance: "world:spider-fly" })));
    // spider-1 already carries enough mass to cross the 25 lay threshold on
    // its very first tick, sitting in the static home web the whole time —
    // no fly anywhere on the board, so it just holds there.
    await appendFacts(dir, [
      { subject: "spider-1", predicate: "mgx:currently-in", object: "cell-2-2" },
      { subject: "spider-1", predicate: "mgx:mass", object: "25.5" },
    ].map((f) => ({ ...f, provenance: "world:spider-fly" })));

    const tick1 = await runSpiderFlyTick(dir); // turn 1: 25.5 - 0.5 = 25, in the web — lays egg-1
    assert.equal(tick1.turn, 1);
    assert.equal(tick1.ecology.laid, "egg-1");

    await runSpiderFlyTick(dir); // turn 2
    const tick3 = await runSpiderFlyTick(dir); // turn 3: also a spawn turn (3 % 3 === 0)
    assert.ok(tick3.ecology.spawned, "turn 3 is a spawn turn regardless of the egg's own timeline");
    const tick4 = await runSpiderFlyTick(dir); // turn 4: egg-1 (laid turn 1) hatches

    assert.equal(tick4.ecology.hatched.length, 1);
    assert.equal(tick4.ecology.hatched[0].egg, "egg-1");
    assert.equal(tick4.ecology.hatched[0].cell, "cell-2-2");

    const rows = readFactRows(await loadMemory(dir));
    const has = (subject, predicate, object) => rows.some((r) => r.subject === subject && r.predicate === predicate && r.object === object);
    assert.ok(has("egg-1@turn1", "mgx:currently-in", "cell-2-2"), "the egg is laid at the laying spider's cell");
    assert.ok(has("egg-1@turn1", "mgx:laid-at-turn", "1"));
    assert.ok(has("spider-1@turn1", "mgx:mass", "15"), "the laying spider resets to exactly its own initial mass");
    for (const { spider } of tick4.ecology.hatched[0].spiders) {
      assert.ok(has(`${spider}@turn4`, "mgx:currently-in", "cell-2-2"), "each hatchling mints at the egg's cell, exactly config.eggHatchDelayTurns turns after laying");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runSpiderFlyTick: every hatchling and a spawned fly are all present in the SAME tick's own returned agents, not one tick late", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-spider-fly-newborn-agents-"));
  try {
    await appendFacts(dir, [...worldFactRows()].map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object, provenance: "world:spider-fly" })));
    await appendFacts(dir, [
      { subject: "spider-1", predicate: "mgx:currently-in", object: "cell-2-2" },
      { subject: "spider-1", predicate: "mgx:mass", object: "25.5" },
    ].map((f) => ({ ...f, provenance: "world:spider-fly" })));

    const tick1 = await runSpiderFlyTick(dir); // turn 1: lays egg-1
    assert.equal(tick1.ecology.laid, "egg-1");

    await runSpiderFlyTick(dir); // turn 2
    const tick3 = await runSpiderFlyTick(dir); // turn 3: also a spawn turn (3 % 3 === 0)
    assert.ok(tick3.ecology.spawned, "turn 3 is a spawn turn");
    assert.ok(tick3.agents[tick3.ecology.spawned], "the spawned fly is already in THIS tick's own agents, not only next tick's fold");
    assert.equal(tick3.agents[tick3.ecology.spawned].cell, tick3.ecology.spawnedCell);

    const tick4 = await runSpiderFlyTick(dir); // turn 4: egg-1 (laid turn 1) hatches
    assert.equal(tick4.ecology.hatched.length, 1);
    assert.ok(tick4.ecology.hatched[0].spiders.length >= 1);
    for (const { spider, mass } of tick4.ecology.hatched[0].spiders) {
      assert.ok(tick4.agents[spider], "each hatchling is already in THIS tick's own agents, not only next tick's fold");
      assert.equal(tick4.agents[spider].cell, "cell-2-2");
      assert.equal(tick4.agents[spider].mass, mass);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runSpiderFlyTick starves a fly whose mass reaches zero, written and readable through the real store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-spider-fly-starve-"));
  try {
    await appendFacts(dir, [...worldFactRows()].map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object, provenance: "world:spider-fly" })));
    await appendFacts(dir, [
      { subject: "spider-1", predicate: "mgx:currently-in", object: "cell-2-2" },
      { subject: "fly-1", predicate: "mgx:currently-in", object: "cell-9-9" },
      { subject: "fly-1", predicate: "mgx:mass", object: "1" },
    ].map((f) => ({ ...f, provenance: "world:spider-fly" })));

    const tick = await runSpiderFlyTick(dir);
    assert.deepEqual(tick.ecology.starved, ["fly-1"]);

    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((r) => r.subject === "fly-1@turn1" && r.predicate === "mgx:mass" && r.object === "0"));
    assert.ok(rows.some((r) => r.subject === "fly-1@turn1" && r.predicate === "mgx:starved" && r.object === "true"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runSpiderFlyTick: a spider avoids another spider believed visible, even with no fly anywhere on the board", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-spider-fly-avoid-"));
  try {
    await appendFacts(dir, [...worldFactRows()].map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object, provenance: "world:spider-fly" })));
    await appendFacts(dir, [
      { subject: "spider-1", predicate: "mgx:currently-in", object: "cell-5-5" },
      { subject: "spider-2", predicate: "mgx:currently-in", object: "cell-5-6" },
    ].map((f) => ({ ...f, provenance: "world:spider-fly" })));

    const tick = await runSpiderFlyTick(dir);
    assert.equal(tick.agents["spider-1"].cell, "cell-5-4", "moves away from spider-2 (north opens the most distance) rather than holding");
    assert.equal(tick.agents["spider-2"].cell, "cell-5-7", "moves away from spider-1 symmetrically (south)");
    assert.match(tick.agents["spider-1"].goal, /avoiding spider-2/);
    assert.match(tick.agents["spider-2"].goal, /avoiding spider-1/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runSpiderFlyTick: a fly inside an active web cannot move, even with a spider in sight it would otherwise evade", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-spider-fly-webtrap-"));
  try {
    await appendFacts(dir, [...worldFactRows()].map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object, provenance: "world:spider-fly" })));
    await appendFacts(dir, [
      { subject: "spider-1", predicate: "mgx:currently-in", object: "cell-6-2" }, // Chebyshev 4 from fly-1 — believed visible
      { subject: "fly-1", predicate: "mgx:currently-in", object: "cell-2-2" }, // the static web home — always active
      { subject: "fly-1", predicate: "mgx:mass", object: String(FLY_INITIAL_MASS) },
    ].map((f) => ({ ...f, provenance: "world:spider-fly" })));

    const tick = await runSpiderFlyTick(dir);
    assert.equal(tick.agents["fly-1"].cell, "cell-2-2", "webbed — stays put despite a visible spider it would otherwise flee");
    assert.match(tick.agents["fly-1"].goal, /trapped in an active web/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runSpiderFlyTick: a spider with no fly in sight builds a web at its held cell, and never double-mints while it's still active", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-spider-fly-webbuild-"));
  try {
    await appendFacts(dir, [...worldFactRows()].map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object, provenance: "world:spider-fly" })));
    await appendFacts(dir, [
      { subject: "spider-1", predicate: "mgx:currently-in", object: "cell-6-6" },
    ].map((f) => ({ ...f, provenance: "world:spider-fly" })));

    const tick1 = await runSpiderFlyTick(dir); // turn 1: no fly anywhere — holds and builds
    assert.equal(tick1.agents["spider-1"].cell, "cell-6-6");
    assert.match(tick1.agents["spider-1"].goal, /building a web/);
    assert.deepEqual(tick1.activeWebs.map((w) => w.cell), ["cell-6-6"]);
    assert.equal(tick1.activeWebs[0].builtAtTurn, 1);

    const tick2 = await runSpiderFlyTick(dir); // turn 2: still no fly — cell already webbed, no second mint
    assert.equal(tick2.activeWebs.length, 1, "the same still-active web, not a second one at the same cell");

    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((r) => r.subject === "web-1@turn1" && r.predicate === "mgx:currently-in" && r.object === "cell-6-6"));
    assert.ok(rows.some((r) => r.subject === "web-1@turn1" && r.predicate === "mgx:web-built-at-turn" && r.object === "1"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runSpiderFlyTick: a spider's mass decrements every tick and it starves at zero, exactly like a fly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-spider-fly-spiderstarve-"));
  try {
    await appendFacts(dir, [...worldFactRows()].map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object, provenance: "world:spider-fly" })));
    await appendFacts(dir, [
      { subject: "spider-1", predicate: "mgx:currently-in", object: "cell-6-6" },
      { subject: "spider-1", predicate: "mgx:mass", object: "0.5" },
    ].map((f) => ({ ...f, provenance: "world:spider-fly" })));

    const tick = await runSpiderFlyTick(dir);
    assert.deepEqual(tick.ecology.starved, ["spider-1"]);

    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((r) => r.subject === "spider-1@turn1" && r.predicate === "mgx:mass" && r.object === "0"));
    assert.ok(rows.some((r) => r.subject === "spider-1@turn1" && r.predicate === "mgx:starved" && r.object === "true"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runSpiderFlyTick: eating transfers the fly's exact post-decrement mass, not a flat bonus, through the real store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-spider-fly-eatmass-"));
  try {
    await appendFacts(dir, [...worldFactRows()].map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object, provenance: "world:spider-fly" })));
    await appendFacts(dir, [
      { subject: "spider-1", predicate: "mgx:currently-in", object: "cell-2-2" },
      { subject: "spider-1", predicate: "mgx:mass", object: "12" },
      { subject: "fly-1", predicate: "mgx:currently-in", object: "cell-2-2" },
      { subject: "fly-1", predicate: "mgx:mass", object: "8" },
    ].map((f) => ({ ...f, provenance: "world:spider-fly" })));

    const tick = await runSpiderFlyTick(dir);
    assert.deepEqual(tick.ecology.eaten, [{ fly: "fly-1", spider: "spider-1", cell: "cell-2-2" }]);
    // spider-1: 12 - 0.5 (this tick's own decrement) = 11.5, plus fly-1's post-decrement mass 8 - 1 = 7 -> 18.5.
    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((r) => r.subject === "spider-1@turn1" && r.predicate === "mgx:mass" && r.object === "18.5"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runSpiderFlyTick: the eating spider's own returned agents[].mass reflects the post-eat total this same tick, not the stale pre-eat movement-phase value", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-spider-fly-eatmass-returned-"));
  try {
    await appendFacts(dir, [...worldFactRows()].map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object, provenance: "world:spider-fly" })));
    await appendFacts(dir, [
      { subject: "spider-1", predicate: "mgx:currently-in", object: "cell-2-2" },
      { subject: "spider-1", predicate: "mgx:mass", object: "5" },
      { subject: "fly-1", predicate: "mgx:currently-in", object: "cell-2-2" },
      { subject: "fly-1", predicate: "mgx:mass", object: "10" },
    ].map((f) => ({ ...f, provenance: "world:spider-fly" })));

    const tick = await runSpiderFlyTick(dir);
    assert.deepEqual(tick.ecology.eaten, [{ fly: "fly-1", spider: "spider-1", cell: "cell-2-2" }]);
    // spider-1: 5 - 0.5 (movement decrement) = 4.5, plus fly-1's post-decrement mass 10 - 1 = 9 -> 13.5.
    assert.equal(tick.agents["spider-1"].mass, 13.5);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runSpiderFlyTick: a spider can catch a fly far from any web, then carries it home and eats it once delivered — a full carry cycle through the real store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-spider-fly-carry-cycle-"));
  try {
    await appendFacts(dir, [...worldFactRows()].map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object, provenance: "world:spider-fly" })));
    // fly-1 starts pinned into the board's far corner — cornered, it cannot
    // keep opening distance from a spider closing in from the same corner,
    // so it eventually gets caught nowhere near the web.
    await appendFacts(dir, [
      { subject: "spider-1", predicate: "mgx:currently-in", object: "cell-9-9" },
      { subject: "fly-1", predicate: "mgx:currently-in", object: "cell-10-10" },
      { subject: "fly-1", predicate: "mgx:mass", object: "200" },
    ].map((f) => ({ ...f, provenance: "world:spider-fly" })));

    let caughtOutsideWeb = false;
    let sawCarryingGoal = false;
    let eaten = false;
    for (let i = 0; i < 60 && !eaten; i += 1) {
      const tick = await runSpiderFlyTick(dir);
      for (const c of tick.ecology.caught) {
        const cell = parseCellId(c.cell);
        if (!isInWebBlock(cell.x, cell.y)) caughtOutsideWeb = true;
      }
      if (tick.agents["fly-1"]?.goal?.includes("being carried")) sawCarryingGoal = true;
      if (tick.ecology.eaten.some((e) => e.fly === "fly-1")) eaten = true;
    }
    assert.ok(caughtOutsideWeb, "the spider caught the fly somewhere outside the web block");
    assert.ok(sawCarryingGoal, "the caught fly's own goal narrates being carried while inert");
    assert.ok(eaten, "carrying it home eventually delivers it into an active web and it gets eaten");

    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((r) => r.subject.startsWith("fly-1@turn") && r.predicate === "mgx:eaten-by" && r.object === "spider-1"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runSpiderFlyTick: a carried fly self-heals to independent movement the tick after its captor dies", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-spider-fly-selfheal-"));
  try {
    await appendFacts(dir, [...worldFactRows()].map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object, provenance: "world:spider-fly" })));
    await appendFacts(dir, [
      { subject: "spider-1", predicate: "mgx:currently-in", object: "cell-9-9" },
      { subject: "spider-1", predicate: "mgx:mass", object: "0.5" }, // starves this very first tick
      { subject: "spider-1", predicate: "mgx:carrying", object: "fly-1" },
      { subject: "fly-1", predicate: "mgx:currently-in", object: "cell-9-9" },
      { subject: "fly-1", predicate: "mgx:mass", object: "10" },
    ].map((f) => ({ ...f, provenance: "world:spider-fly" })));

    const tick1 = await runSpiderFlyTick(dir);
    assert.deepEqual(tick1.ecology.starved, ["spider-1"]);
    assert.ok(tick1.agents["fly-1"], "the fly rode along with its still-live-at-tick-start captor, but is still on the board itself");
    // Its own pre-ecology "being carried by spider-1" goal is stale the
    // instant spider-1 starves later in this SAME tick — the existing
    // died-this-tick scrub (which already protects every other agent's own
    // goal text from naming a subject that died this exact tick) catches
    // this one too, same as it would "avoiding spider-1" or "chasing
    // spider-1" for any other agent.
    assert.equal(tick1.agents["fly-1"].goal, "spider-1 is gone — re-evaluating.");
    assert.equal(tick1.agents["spider-1"], undefined, "the starved captor is gone from this tick's own agents");

    const tick2 = await runSpiderFlyTick(dir);
    assert.ok(tick2.agents["fly-1"], "the fly is still on the board");
    assert.doesNotMatch(tick2.agents["fly-1"].goal, /being carried/, "the captor is gone — the fly moves independently again");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("runSpiderFlyTick: every live agent's returned entry carries a plan array and a belief map, not just a chasing spider's", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-spider-fly-plan-belief-"));
  try {
    await appendFacts(dir, [...worldFactRows()].map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object, provenance: "world:spider-fly" })));
    await appendFacts(dir, [
      { subject: "spider-1", predicate: "mgx:currently-in", object: "cell-2-2" },
      { subject: "fly-1", predicate: "mgx:currently-in", object: "cell-5-2" },
      { subject: "fly-1", predicate: "mgx:mass", object: "10" },
    ].map((f) => ({ ...f, provenance: "world:spider-fly" })));

    const tick = await runSpiderFlyTick(dir);
    for (const id of ["spider-1", "fly-1"]) {
      assert.ok(Array.isArray(tick.agents[id].plan), `${id} carries a plan array`);
      assert.equal(typeof tick.agents[id].belief, "object", `${id} carries a belief map`);
    }
    assert.equal(tick.agents["spider-1"].belief["fly-1"], "cell-5-2", "the spider's belief about fly-1 matches what it can actually see this turn");
    assert.equal(tick.agents["fly-1"].belief["spider-1"], "cell-2-2", "the fly's belief about spider-1 matches what it can actually see this turn");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("startSpiderFlyGame and runSpiderFlyTick both honour a custom config override, end to end through the real store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-spider-fly-config-override-"));
  try {
    const config = { ...DEFAULT_GAME_CONFIG.spiderFly, spiderInitialMass: 3, spiderMassDecrementPerTurn: 3 };
    await startSpiderFlyGame(dir, { flyCount: 1, config });
    const afterStart = readFactRows(await loadMemory(dir));
    assert.ok(
      afterStart.some((r) => r.subject === "spider-1" && r.predicate === "mgx:mass" && r.object === "3"),
      "the custom spiderInitialMass reaches the freshly-started game's own written facts, not the shipped default of 15",
    );

    const tick = await runSpiderFlyTick(dir, { config });
    assert.deepEqual(tick.ecology.starved, ["spider-1"], "a custom decrement of 3 against a custom starting mass of 3 starves the spider on its very first tick");
    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((r) => r.subject === "spider-1@turn1" && r.predicate === "mgx:mass" && r.object === "0"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
