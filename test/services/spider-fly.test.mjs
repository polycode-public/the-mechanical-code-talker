import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  foldSpiderFlyState, gridApplyActions, spiderPathStateKey, planSpiderPath,
  greedyFlyMove, greedySpiderApproach, believedCellOf, nearestBelievedTarget,
  runEcologyPass, startSpiderFlyGame, runSpiderFlyTick,
  FLY_INITIAL_MASS,
} from "../../src/services/spider-fly.mjs";
import { worldFactRows } from "../../src/domain/spider-fly-world.mjs";
import { appendFacts, loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";

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

test("planSpiderPath returns null when the believed fly cell sits outside the web block", () => {
  const rows = [{ subject: "cell-5-2", predicate: "mgx:has-exit-west", object: "cell-4-2" }];
  const applyActions = gridApplyActions(rows);
  const path = planSpiderPath({ x: 5, y: 2 }, { x: 4, y: 2 }, applyActions);
  assert.equal(path, null, "cell-4-2 is Chebyshev distance 2 from the web home — never a satisfiable goal");
});

test("planSpiderPath returns null with no believed target at all", () => {
  const applyActions = gridApplyActions([]);
  assert.equal(planSpiderPath({ x: 2, y: 2 }, null, applyActions), null);
});

// ---- greedy one-ply scoring: the fly maximizes, the spider's fallback minimizes

test("greedyFlyMove picks the reachable cell that maximizes distance from the believed spider, favoring staying put on a tie", () => {
  const rows = [
    { subject: "cell-5-5", predicate: "mgx:has-exit-west", object: "cell-4-5" },
    { subject: "cell-5-5", predicate: "mgx:has-exit-east", object: "cell-6-5" },
  ];
  const applyActions = gridApplyActions(rows);
  // The spider sits west, so fleeing east opens the most distance.
  assert.deepEqual(greedyFlyMove({ x: 5, y: 5 }, { x: 4, y: 5 }, applyActions), { x: 6, y: 5 });
  // No believed spider position at all: hold position.
  assert.deepEqual(greedyFlyMove({ x: 5, y: 5 }, null, applyActions), { x: 5, y: 5 });
});

test("greedySpiderApproach picks the reachable cell that minimizes distance to the believed fly", () => {
  const rows = [
    { subject: "cell-5-5", predicate: "mgx:has-exit-west", object: "cell-4-5" },
    { subject: "cell-5-5", predicate: "mgx:has-exit-east", object: "cell-6-5" },
  ];
  const applyActions = gridApplyActions(rows);
  assert.deepEqual(greedySpiderApproach({ x: 5, y: 5 }, { x: 4, y: 5 }, applyActions), { x: 4, y: 5 });
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

test("runEcologyPass never eats a fly co-located with a spider outside the web block", () => {
  const state = foldSpiderFlyState([]);
  const postMovePlacements = new Map([["spider-1", { x: 6, y: 6 }], ["fly-1", { x: 6, y: 6 }]]);
  const { writes, events } = runEcologyPass({ state, postMovePlacements, postMoveMassByFly: new Map([["fly-1", 6]]), turn: 1 });
  assert.deepEqual(events.eaten, []);
  assert.deepEqual(writes, []);
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

test("runEcologyPass lays an egg on the first eat at game start, then needs two more before the next", () => {
  const noEggYet = foldSpiderFlyState([]);
  const firstEat = runEcologyPass({
    state: noEggYet,
    postMovePlacements: new Map([["spider-1", { x: 2, y: 2 }], ["fly-1", { x: 2, y: 2 }]]),
    postMoveMassByFly: new Map([["fly-1", 5]]),
    turn: 1,
  });
  assert.equal(firstEat.events.laid, "egg-1", "the very first eat at game start lays the first egg");
  assert.ok(firstEat.writes.some((w) => w.subject === "egg-1@turn1" && w.predicate === "mgx:currently-in" && w.object === "cell-2-2"));
  assert.ok(firstEat.writes.some((w) => w.subject === "egg-1@turn1" && w.predicate === "mgx:laid-at-turn" && w.object === "1"));

  // A live egg outstanding blocks a second lay even on a fresh eat.
  const withLiveEgg = foldSpiderFlyState([
    { subject: "egg-1@turn1", predicate: "mgx:currently-in", object: "cell-2-2" },
    { subject: "egg-1@turn1", predicate: "mgx:laid-at-turn", object: "1" },
  ]);
  const blockedByLiveEgg = runEcologyPass({
    state: withLiveEgg,
    postMovePlacements: new Map([["spider-1", { x: 2, y: 2 }], ["fly-2", { x: 2, y: 2 }]]),
    postMoveMassByFly: new Map([["fly-2", 5]]),
    turn: 2,
  });
  assert.equal(blockedByLiveEgg.events.laid, null, "a live (unhatched) egg blocks laying a second one");

  // Once egg-1 has hatched, a single further eat is not enough — it takes two.
  const afterHatch = foldSpiderFlyState([
    { subject: "egg-1@turn1", predicate: "mgx:currently-in", object: "cell-2-2" },
    { subject: "egg-1@turn1", predicate: "mgx:laid-at-turn", object: "1" },
    { subject: "egg-1@turn4", predicate: "mgx:hatched-into", object: "spider-2" },
  ]);
  const oneMoreEat = runEcologyPass({
    state: afterHatch,
    postMovePlacements: new Map([["spider-1", { x: 2, y: 2 }], ["fly-3", { x: 2, y: 2 }]]),
    postMoveMassByFly: new Map([["fly-3", 5]]),
    turn: 5,
  });
  assert.equal(oneMoreEat.events.laid, null, "one eat since the last egg is not the required two");

  const twoMoreEats = runEcologyPass({
    state: foldSpiderFlyState([
      { subject: "egg-1@turn1", predicate: "mgx:currently-in", object: "cell-2-2" },
      { subject: "egg-1@turn1", predicate: "mgx:laid-at-turn", object: "1" },
      { subject: "egg-1@turn4", predicate: "mgx:hatched-into", object: "spider-2" },
      { subject: "fly-3@turn5", predicate: "mgx:eaten-by", object: "spider-1" },
      { subject: "fly-3", predicate: "mgx:currently-in", object: "cell-9-9" },
    ]),
    postMovePlacements: new Map([["spider-1", { x: 2, y: 2 }], ["fly-4", { x: 2, y: 2 }]]),
    postMoveMassByFly: new Map([["fly-4", 5]]),
    turn: 6,
  });
  assert.equal(twoMoreEats.events.laid, "egg-2", "the second eat since the last egg lays the next one, numbered past egg-1");
});

test("runEcologyPass hatches an egg exactly three turns after it was laid, into a new spider at the egg's cell", () => {
  const notYet = foldSpiderFlyState([
    { subject: "egg-1", predicate: "mgx:currently-in", object: "cell-3-2" },
    { subject: "egg-1@turn2", predicate: "mgx:laid-at-turn", object: "2" },
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
  assert.deepEqual(onTime.events.hatched, [{ egg: "egg-1", spider: "spider-2", cell: "cell-3-2" }]);
  assert.ok(onTime.writes.some((w) => w.subject === "spider-2@turn5" && w.predicate === "mgx:currently-in" && w.object === "cell-3-2"));
  assert.ok(onTime.writes.some((w) => w.subject === "egg-1@turn5" && w.predicate === "mgx:hatched-into" && w.object === "spider-2"));
});

test("runEcologyPass spawns a new fly on every third turn, at the first uncontested perimeter cell", () => {
  const state = foldSpiderFlyState([]);
  const notThird = runEcologyPass({ state, postMovePlacements: new Map([["spider-1", { x: 2, y: 2 }]]), postMoveMassByFly: new Map(), turn: 4 });
  assert.equal(notThird.events.spawned, null);

  const third = runEcologyPass({ state, postMovePlacements: new Map([["spider-1", { x: 2, y: 2 }]]), postMoveMassByFly: new Map(), turn: 3 });
  assert.equal(third.events.spawned, "fly-1");
  assert.ok(third.writes.some((w) => w.subject === "fly-1@turn3" && w.predicate === "mgx:currently-in" && w.object === "cell-1-1"));
  assert.ok(third.writes.some((w) => w.subject === "fly-1@turn3" && w.predicate === "mgx:mass" && w.object === String(FLY_INITIAL_MASS)));

  const skipsOccupiedPerimeterCell = runEcologyPass({
    state: foldSpiderFlyState([{ subject: "fly-9", predicate: "mgx:currently-in", object: "cell-9-9" }]),
    postMovePlacements: new Map([["spider-1", { x: 1, y: 1 }], ["fly-9", { x: 9, y: 9 }]]),
    postMoveMassByFly: new Map([["fly-9", 5]]),
    turn: 6,
  });
  assert.equal(skipsOccupiedPerimeterCell.events.spawned, "fly-10", "numbering skips past every fly id ever placed, live or dead");
  assert.ok(skipsOccupiedPerimeterCell.writes.some((w) => w.subject === "fly-10@turn6" && w.object === "cell-2-1"), "cell-1-1 is occupied by the spider, so the next perimeter cell is chosen");
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
    // Two flies already eaten in the store's history (turns 1 and 2) — the
    // lay condition ("no live egg, two eats since the last one, or the
    // first at game start") is already satisfied before this tick runs.
    await appendFacts(dir, [
      { subject: "spider-1", predicate: "mgx:currently-in", object: "cell-2-2" },
      { subject: "fly-1", predicate: "mgx:currently-in", object: "cell-9-9" },
      { subject: "fly-2", predicate: "mgx:currently-in", object: "cell-9-1" },
      { subject: "fly-1@turn1", predicate: "mgx:eaten-by", object: "spider-1" },
      { subject: "fly-2@turn2", predicate: "mgx:eaten-by", object: "spider-1" },
    ].map((f) => ({ ...f, provenance: "world:spider-fly" })));

    const tick3 = await runSpiderFlyTick(dir); // turn 3: lays egg-1, and spawns (3 % 3 === 0)
    assert.equal(tick3.turn, 3);
    assert.equal(tick3.ecology.laid, "egg-1");
    assert.ok(tick3.ecology.spawned, "turn 3 is also a spawn turn");

    await runSpiderFlyTick(dir); // turn 4
    await runSpiderFlyTick(dir); // turn 5
    await runSpiderFlyTick(dir); // turn 6: egg-1 (laid turn 3) hatches

    const rows = readFactRows(await loadMemory(dir));
    const has = (subject, predicate, object) => rows.some((r) => r.subject === subject && r.predicate === predicate && r.object === object);
    assert.ok(has("egg-1@turn3", "mgx:currently-in", "cell-2-2"), "the egg is laid at the eating spider's cell");
    assert.ok(has("egg-1@turn3", "mgx:laid-at-turn", "3"));
    assert.ok(has("spider-2@turn6", "mgx:currently-in", "cell-2-2"), "the hatch mints a new spider at the egg's cell, three turns after laying");
    assert.ok(has("egg-1@turn6", "mgx:hatched-into", "spider-2"));
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
