// The spider-and-fly cast running on the shared predator/prey engine. Every
// helper this game used to own — the fold, the path search, the greedy scoring,
// the ecology pass — is the engine's now and is unit-tested in
// predator-prey.test.mjs. What is left here is what only this cast can show:
// that carrying, webs and egg-laying really switch on for it, and that a real
// run through the real store behaves the way the board's own rules describe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  beliefSnapshotFor, foldSpiderFlyState, runSpiderFlyTick, spiderFlyBoard, startSpiderFlyGame,
} from "../../src/services/spider-fly-turn.mjs";
import { believedCellOf, nearestBelievedTarget } from "../../src/domain/agent-belief.mjs";
import {
  worldFactRows, cellId, isInWebBlock, parseCellId, SPIDER_FLY_LAYOUT, SPIDER_FLY_ROLES,
  spiderFlyEngineConfig,
} from "../../src/domain/spider-fly-world.mjs";
import { perimeterCells } from "../../src/domain/town-square-world.mjs";
import { appendFacts, loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";
import { DEFAULT_GAME_CONFIG } from "../../src/domain/game-config.mjs";
import { EXPRESSION_PALETTE } from "../../src/domain/sprite-expressions.mjs";

const KNOBS = DEFAULT_GAME_CONFIG.spiderFly;
const FLY_INITIAL_MASS = KNOBS.flyInitialMass;

const eventsOfType = (tick, type) => tick.ecology.filter((e) => e.type === type);
const eatenFlies = (tick) => eventsOfType(tick, "eat-agent").map((e) => e.prey);
const starvedIds = (tick) => eventsOfType(tick, "starve").map((e) => e.agent);
const laidEgg = (tick) => eventsOfType(tick, "lay-egg")[0]?.egg ?? null;
const spawnedFly = (tick) => eventsOfType(tick, "spawn-prey")[0] ?? null;

async function boardWith(facts, label) {
  const dir = await mkdtemp(join(tmpdir(), `tmct-spider-fly-${label}-`));
  await appendFacts(dir, [...worldFactRows()]
    .map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object, provenance: "world:spider-fly" })));
  if (facts.length) await appendFacts(dir, facts.map((f) => ({ ...f, provenance: "world:spider-fly" })));
  return dir;
}

const place = (id, cell) => ({ subject: id, predicate: "mgx:currently-in", object: cell });
const weigh = (id, mass) => ({ subject: id, predicate: "mgx:hasMass", object: String(mass) });

// ---- the cast's own bindings ------------------------------------------------------

test("the cast names spiders and flies as the two roles, with nothing inert on the board", () => {
  assert.deepEqual(SPIDER_FLY_ROLES, {
    predator: { role: "predator", kind: "spider", idPrefix: "spider" },
    prey: { role: "prey", kind: "fly", idPrefix: "fly" },
    food: null,
  });
  assert.equal(SPIDER_FLY_LAYOUT.gridSize, 10);
  assert.deepEqual(SPIDER_FLY_LAYOUT.props, [], "nothing on this board blocks movement");
  assert.equal(SPIDER_FLY_LAYOUT.webHomeCell, "cell-2-2");
  assert.equal(SPIDER_FLY_LAYOUT.staticWebAt(2, 2), true);
  assert.equal(SPIDER_FLY_LAYOUT.staticWebAt(6, 6), false);
});

test("the engine config restates the species-keyed knobs by role, and switches this cast's three mechanics on", () => {
  const engine = spiderFlyEngineConfig();
  assert.equal(engine.predatorInitialMass, KNOBS.spiderInitialMass);
  assert.equal(engine.predatorMassDecrementPerTurn, KNOBS.spiderMassDecrementPerTurn);
  assert.equal(engine.predatorVisionRadius, KNOBS.spiderVisionRadius);
  assert.equal(engine.preyInitialMass, KNOBS.flyInitialMass);
  assert.equal(engine.preyMassDecrementPerTurn, KNOBS.flyMassDecrementPerTurn);
  assert.equal(engine.preySpawnIntervalTurns, KNOBS.flySpawnIntervalTurns);
  assert.equal(engine.carryPreyToWeb, true);
  assert.equal(engine.buildWebs, true);
  assert.equal(engine.layEggs, true);
  assert.equal(engine.maxPreyPopulation, undefined, "flies arrive uncapped on this board");
  assert.equal(engine.foodSpawnIntervalTurns, undefined, "and no food ever spawns on it");

  const overridden = spiderFlyEngineConfig({ spiderVisionRadius: 9 });
  assert.equal(overridden.predatorVisionRadius, 9);
  assert.equal(overridden.preyVisionRadius, KNOBS.flyVisionRadius, "an unset sibling keeps the shipped default");
});

// ---- the state fold ---------------------------------------------------------------

test("the fold takes the newest snapshot per subject and separates every terminal marker into removed", () => {
  const rows = [
    place("spider-1", "cell-2-2"),
    { subject: "spider-1@turn3", predicate: "mgx:currently-in", object: "cell-3-2" },
    place("fly-1", "cell-8-2"),
    weigh("fly-1", 10),
    { subject: "fly-1@turn1", predicate: "mgx:hasMass", object: "9" },
    { subject: "fly-1@turn2", predicate: "mgx:hasMass", object: "8" },
    { subject: "fly-2@turn2", predicate: "mgx:currently-in", object: "cell-4-2" },
    { subject: "fly-2@turn2", predicate: "mgx:starved", object: "true" },
    { subject: "spider-1@turn2", predicate: "mgx:prey-eaten", object: "1" },
    { subject: "spider-1@turn2", predicate: "mgx:carrying", object: "fly-4" },
    { subject: "egg-1@turn2", predicate: "mgx:currently-in", object: "cell-3-2" },
    { subject: "egg-1@turn2", predicate: "mgx:laid-at-turn", object: "2" },
    { subject: "egg-1@turn5", predicate: "mgx:hatched-into", object: "spider-2" },
    { subject: "fly-3@turn1", predicate: "mgx:eaten-by", object: "spider-1" },
    { subject: "web-1@turn4", predicate: "mgx:currently-in", object: "cell-7-7" },
    { subject: "web-1@turn4", predicate: "mgx:web-built-at-turn", object: "4" },
  ];
  const state = foldSpiderFlyState(rows);
  assert.equal(state.turnCount, 5);
  assert.deepEqual(state.placements.get("spider-1"), { cell: "cell-3-2", turn: 3, epoch: 0 }, "the newer snapshot wins over the base row");
  assert.deepEqual(state.mass.get("fly-1"), { value: 8, turn: 2, epoch: 0 }, "the newest mass snapshot wins over the base row and the turn-1 one");
  assert.deepEqual(state.preyEaten.get("spider-1"), { value: 1, turn: 2, epoch: 0 });
  assert.deepEqual(state.carrying.get("spider-1"), { prey: "fly-4", turn: 2, epoch: 0 });
  assert.deepEqual(state.laidAtTurn.get("egg-1"), { value: 2, turn: 2, epoch: 0 });
  assert.deepEqual(state.hatchedInto.get("egg-1"), { into: "spider-2", turn: 5, epoch: 0 });
  assert.deepEqual(state.webs.get("web-1"), { cell: "cell-7-7", builtAtTurn: 4 });
  assert.ok(state.starved.has("fly-2"));
  assert.deepEqual([...state.removed].sort(), ["egg-1", "fly-2", "fly-3"], "eaten, starved and hatched subjects are all folded into one removed set");
});

test("a carrying claim released with \"none\" is dropped, and an older row can never put it back", () => {
  const dropped = foldSpiderFlyState([
    { subject: "spider-1@turn1", predicate: "mgx:carrying", object: "fly-1" },
    { subject: "spider-1@turn2", predicate: "mgx:carrying", object: "none" },
  ]);
  assert.equal(dropped.carrying.has("spider-1"), false);

  const outOfOrder = foldSpiderFlyState([
    { subject: "spider-1@turn2", predicate: "mgx:carrying", object: "none" },
    { subject: "spider-1@turn1", predicate: "mgx:carrying", object: "fly-1" },
  ]);
  assert.equal(outOfOrder.carrying.has("spider-1"), false, "arrival order never decides which claim stands");
});

test("the static world rows alone fold to an empty live-game state — structural facts never read as agents", () => {
  const state = foldSpiderFlyState([...worldFactRows()]);
  assert.equal(state.placements.size, 0, "no world row places an agent");
  assert.equal(state.mass.size, 0, "no world row carries a live mass");
});

// ---- visibility and belief ---------------------------------------------------------

test("believedCellOf is ground truth inside the vision radius, unknown outside it, and falls back to a told fact", () => {
  const state = foldSpiderFlyState([place("fly-1", "cell-5-2")]);
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

test("beliefSnapshotFor maps every other candidate to its believed cell or null, skipping the observer's own id", () => {
  const state = foldSpiderFlyState([place("fly-1", "cell-5-2"), place("fly-2", "cell-8-8")]);
  const snapshot = beliefSnapshotFor("spider-1", { x: 2, y: 2 }, ["spider-1", "fly-1", "fly-2"], state, { visionRadius: 4 });
  assert.deepEqual(snapshot, { "fly-1": "cell-5-2", "fly-2": null }, "fly-1 sits inside vision, fly-2 outside it and untold");
  assert.ok(!("spider-1" in snapshot), "the observer never appears in its own belief snapshot");
});

test("nearestBelievedTarget picks the closest candidate the observer has any belief about, skipping unbelieved ones", () => {
  const state = foldSpiderFlyState([place("fly-1", "cell-9-9"), place("fly-2", "cell-3-2")]);
  const best = nearestBelievedTarget("spider-1", { x: 2, y: 2 }, ["fly-1", "fly-2"], state, { visionRadius: 4 });
  assert.deepEqual(best, { subject: "fly-2", cell: { x: 3, y: 2 } }, "fly-1 sits far outside vision and is never even considered");
});

// ---- bootstrap ----------------------------------------------------------------------

test("startSpiderFlyGame mints spider-1 at the web home and spreads flies on the perimeter, idempotently", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-spider-fly-start-"));
  try {
    const first = await startSpiderFlyGame(dir, { flyCount: 2 });
    assert.equal(first.started, true);
    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((r) => r.subject === "spider-1@turn0" && r.predicate === "mgx:currently-in" && r.object === "cell-2-2"));
    const flyCells = rows
      .filter((r) => /^fly-\d+@turn0$/.test(r.subject) && r.predicate === "mgx:currently-in")
      .map((r) => r.object);
    assert.equal(flyCells.length, 2);
    assert.equal(new Set(flyCells).size, 2, "two flies never start on the same cell");
    for (const cell of flyCells) assert.ok(perimeterCells(SPIDER_FLY_LAYOUT).includes(cell), cell);
    assert.equal(rows.filter((r) => /^fly-\d+@turn0$/.test(r.subject) && r.predicate === "mgx:hasMass").length, 2);

    const second = await startSpiderFlyGame(dir, { flyCount: 2 });
    assert.equal(second.started, false, "a second call against an already-running game is a no-op");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("startSpiderFlyGame puts a starting mood on record for every agent it mints", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-spider-fly-start-mood-"));
  try {
    await startSpiderFlyGame(dir, { flyCount: 2 });
    const rows = readFactRows(await loadMemory(dir));
    assert.deepEqual(
      rows.filter((r) => r.predicate === "mgx:feels").map((r) => `${r.subject}=${r.object}`).sort(),
      ["fly-1@turn0=calm", "fly-2@turn0=calm", "spider-1@turn0=calm"],
      "an agent has a mood from the moment it exists, and nothing has a goal yet on turn 0",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("spiderFlyBoard reports the resting board without advancing a turn", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-spider-fly-resting-"));
  try {
    await startSpiderFlyGame(dir, { flyCount: 1 });
    const board = await spiderFlyBoard(dir);
    assert.equal(board.turn, 0, "no tick has run");
    assert.equal(board.agents["spider-1"].cell, "cell-2-2");
    assert.equal(board.agents["spider-1"].mass, KNOBS.spiderInitialMass);
    assert.equal(board.agents["spider-1"].goal, "", "a resting board reports what is true, never a decision it has not made");
    assert.deepEqual(board.activeWebs, [], "nothing has spun a web yet");
    assert.deepEqual(board.items, {}, "nothing inert lies on this board");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("startSpiderFlyGame and runSpiderFlyTick both honour a custom config override, end to end through the real store", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-spider-fly-config-override-"));
  try {
    const config = { ...KNOBS, spiderInitialMass: 3, spiderMassDecrementPerTurn: 3 };
    await startSpiderFlyGame(dir, { flyCount: 1, config });
    const afterStart = readFactRows(await loadMemory(dir));
    assert.ok(
      afterStart.some((r) => r.subject === "spider-1@turn0" && r.predicate === "mgx:hasMass" && r.object === "3"),
      "the custom spiderInitialMass reaches the freshly-started game's own written facts, not the shipped default of 15",
    );

    const tick = await runSpiderFlyTick(dir, { config });
    assert.deepEqual(starvedIds(tick), ["spider-1"], "a custom decrement of 3 against a custom starting mass of 3 starves the spider on its very first tick");
    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((r) => r.subject === "spider-1@turn1" && r.predicate === "mgx:starved" && r.object === "true"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- a real run through the real store ----------------------------------------------

test("the spider engages a visible fly, and the fly is eaten or starved within a mass-guaranteed turn count", async () => {
  // fly-1 starts at cell-6-2 — Chebyshev distance 4 from the web home (2,2),
  // exactly at the default vision radius, so the chase is live from turn 1
  // rather than depending on the pair wandering into range.
  const dir = await boardWith([place("spider-1", "cell-2-2"), place("fly-1", "cell-6-2"), weigh("fly-1", FLY_INITIAL_MASS)], "sim");
  try {
    let sawSpiderLeaveHome = false;
    let terminal = null;
    for (let i = 0; i < 15 && !terminal; i += 1) {
      const tick = await runSpiderFlyTick(dir);
      if (tick.agents["spider-1"]?.cell !== "cell-2-2") sawSpiderLeaveHome = true;
      if (eatenFlies(tick).includes("fly-1")) terminal = "eaten";
      else if (starvedIds(tick).includes("fly-1")) terminal = "starved";
    }
    assert.ok(sawSpiderLeaveHome, "the spider actively chases rather than sitting idle in its web");
    assert.ok(terminal, "fly-1 started with mass 10, decrementing by 1 every turn it survives — within 15 turns it is eaten or starved, never left dangling");

    const rows = readFactRows(await loadMemory(dir));
    const marker = terminal === "eaten" ? "mgx:eaten-by" : "mgx:starved";
    assert.ok(rows.some((r) => r.subject.startsWith("fly-1@turn") && r.predicate === marker));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a spider avoids another spider believed visible, even with no fly anywhere on the board", async () => {
  const dir = await boardWith([place("spider-1", "cell-5-5"), place("spider-2", "cell-5-6")], "avoid");
  try {
    const tick = await runSpiderFlyTick(dir);
    assert.equal(tick.agents["spider-1"].cell, "cell-5-4", "moves away from spider-2 (north opens the most distance) rather than holding");
    assert.equal(tick.agents["spider-2"].cell, "cell-5-7", "moves away from spider-1 symmetrically (south)");
    assert.match(tick.agents["spider-1"].goal, /avoiding spider-2/);
    assert.match(tick.agents["spider-2"].goal, /avoiding spider-1/);
    assert.equal(tick.agents["spider-1"].mood, "scared", "backing off a rival reads as fear, not the predatory focus of a chase");
    assert.equal(tick.agents["spider-2"].mood, "scared");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a fly inside an active web cannot move, even with a spider in sight it would otherwise evade", async () => {
  const dir = await boardWith([
    place("spider-1", "cell-6-2"), // Chebyshev 4 from fly-1 — believed visible
    place("fly-1", "cell-2-2"), // the static web home — always active
    weigh("fly-1", FLY_INITIAL_MASS),
  ], "webtrap");
  try {
    const tick = await runSpiderFlyTick(dir);
    assert.equal(tick.rungs["fly-1"], "trapped");
    assert.equal(tick.agents["fly-1"].cell, "cell-2-2", "webbed — stays put despite a visible spider it would otherwise flee");
    assert.match(tick.agents["fly-1"].goal, /trapped in an active web/);
    assert.equal(tick.agents["fly-1"].mood, "scared", "pinned in a web with a spider in sight is the sharpest form of the same fear");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a spider with no fly in sight builds a web at its held cell, and never double-mints while it's still active", async () => {
  const dir = await boardWith([place("spider-1", "cell-6-6")], "webbuild");
  try {
    const tick1 = await runSpiderFlyTick(dir);
    assert.equal(tick1.rungs["spider-1"], "build-web");
    assert.equal(tick1.agents["spider-1"].cell, "cell-6-6");
    assert.equal(tick1.agents["spider-1"].goal, "nothing in sight — building a web here.");
    assert.equal(tick1.agents["spider-1"].mood, "calm", "holding position and spinning is the no-strong-emotion baseline");
    assert.deepEqual(tick1.activeWebs.map((w) => w.cell), ["cell-6-6"]);
    assert.equal(tick1.activeWebs[0].builtAtTurn, 1);

    const tick2 = await runSpiderFlyTick(dir);
    assert.equal(tick2.rungs["spider-1"], "hold-web");
    assert.equal(tick2.activeWebs.length, 1, "the same still-active web, not a second one at the same cell");

    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((r) => r.subject === "web-1@turn1" && r.predicate === "mgx:currently-in" && r.object === "cell-6-6"));
    assert.ok(rows.some((r) => r.subject === "web-1@turn1" && r.predicate === "mgx:web-built-at-turn" && r.object === "1"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a spider's mass decrements every tick and it starves at zero, exactly like a fly", async () => {
  const dir = await boardWith([place("spider-1", "cell-6-6"), weigh("spider-1", 0.5)], "spiderstarve");
  try {
    const tick = await runSpiderFlyTick(dir);
    assert.deepEqual(starvedIds(tick), ["spider-1"]);
    assert.equal(tick.agents["spider-1"], undefined);
    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((r) => r.subject === "spider-1@turn1" && r.predicate === "mgx:starved" && r.object === "true"));
    assert.equal(
      rows.some((r) => r.subject === "spider-1@turn1" && r.predicate === "mgx:hasMass"), false,
      "an agent the board took off it this turn records the terminal marker and no mass of its own",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a fly whose mass reaches zero starves, written and readable through the real store", async () => {
  const dir = await boardWith([place("spider-1", "cell-2-2"), place("fly-1", "cell-9-9"), weigh("fly-1", 1)], "starve");
  try {
    const tick = await runSpiderFlyTick(dir);
    assert.deepEqual(starvedIds(tick), ["fly-1"]);
    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((r) => r.subject === "fly-1@turn1" && r.predicate === "mgx:starved" && r.object === "true"));
    assert.ok(rows.some((r) => r.subject === "fly-1@turn1" && r.predicate === "mgx:currently-in"), "its last position still goes on record");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("eating transfers the fly's exact post-decrement mass, not a flat bonus, and bumps the count", async () => {
  const dir = await boardWith([
    place("spider-1", "cell-2-2"), weigh("spider-1", 12),
    place("fly-1", "cell-2-2"), weigh("fly-1", 8),
  ], "eatmass");
  try {
    const tick = await runSpiderFlyTick(dir);
    assert.deepEqual(eatenFlies(tick), ["fly-1"]);
    // spider-1: 12 - 0.5 (this tick's own decrement) = 11.5, plus fly-1's
    // post-decrement mass 8 - 1 = 7 -> 18.5.
    assert.equal(tick.agents["spider-1"].mass, 18.5, "the returned mass is the post-eat total, not the stale movement-phase one");
    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((r) => r.subject === "spider-1@turn1" && r.predicate === "mgx:hasMass" && r.object === "18.5"));
    assert.ok(rows.some((r) => r.subject === "spider-1@turn1" && r.predicate === "mgx:prey-eaten" && r.object === "1"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a spider co-located with two flies claims only one of them this tick", async () => {
  const dir = await boardWith([
    place("spider-1", "cell-2-2"), weigh("spider-1", 12),
    place("fly-1", "cell-2-2"), weigh("fly-1", 10),
    place("fly-2", "cell-2-2"), weigh("fly-2", 8),
  ], "one-catch");
  try {
    const tick = await runSpiderFlyTick(dir);
    assert.deepEqual(eatenFlies(tick), ["fly-1"], "the carrying model allows at most one catch per spider per tick");
    assert.equal(tick.agents["fly-2"].cell, "cell-2-2", "the second fly stays on the board, trapped in the same web");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a spider can catch a fly far from any web, carry it home, and eat it once delivered", async () => {
  // fly-1 starts pinned into the board's far corner — cornered, it cannot keep
  // opening distance from a spider closing in from the same corner, so it
  // eventually gets caught nowhere near the web.
  const dir = await boardWith([
    place("spider-1", "cell-9-9"),
    place("fly-1", "cell-10-10"), weigh("fly-1", 200),
  ], "carry-cycle");
  try {
    let caughtOutsideWeb = false;
    let sawCarryingGoal = false;
    let sawCarryRung = false;
    let eaten = false;
    for (let i = 0; i < 60 && !eaten; i += 1) {
      const tick = await runSpiderFlyTick(dir);
      for (const c of eventsOfType(tick, "catch-prey")) {
        const cell = parseCellId(c.cell);
        if (!isInWebBlock(cell.x, cell.y)) caughtOutsideWeb = true;
      }
      if (tick.rungs["spider-1"] === "carry") sawCarryRung = true;
      if (tick.agents["fly-1"]?.goal?.includes("being carried")) sawCarryingGoal = true;
      if (eatenFlies(tick).includes("fly-1")) eaten = true;
    }
    assert.ok(caughtOutsideWeb, "the spider caught the fly somewhere outside the web block");
    assert.ok(sawCarryRung, "and hauled it home on the carry rung rather than chasing on");
    assert.ok(sawCarryingGoal, "the caught fly's own goal narrates being carried while inert");
    assert.ok(eaten, "carrying it home eventually delivers it into an active web and it gets eaten");

    const rows = readFactRows(await loadMemory(dir));
    assert.ok(rows.some((r) => r.subject.startsWith("fly-1@turn") && r.predicate === "mgx:eaten-by" && r.object === "spider-1"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a carried fly self-heals to independent movement the tick after its captor dies", async () => {
  const dir = await boardWith([
    place("spider-1", "cell-9-9"),
    weigh("spider-1", 0.5), // starves this very first tick
    { subject: "spider-1", predicate: "mgx:carrying", object: "fly-1" },
    place("fly-1", "cell-9-9"), weigh("fly-1", 10),
  ], "selfheal");
  try {
    const tick1 = await runSpiderFlyTick(dir);
    assert.deepEqual(starvedIds(tick1), ["spider-1"]);
    assert.ok(tick1.agents["fly-1"], "the fly rode along with its still-live-at-tick-start captor, but is still on the board itself");
    // Its own pre-ecology "being carried by spider-1" goal is stale the instant
    // spider-1 starves later in this SAME tick, and the died-this-tick scrub
    // catches it exactly as it would any other agent's stale reference.
    assert.equal(tick1.agents["fly-1"].goal, "spider-1 is gone — re-evaluating.");
    assert.equal(tick1.agents["fly-1"].mood, "calm", "the scrubbed goal takes the mood with it — nothing is chasing it any more");
    assert.equal(tick1.agents["spider-1"], undefined, "the starved captor is gone from this tick's own agents");

    const tick2 = await runSpiderFlyTick(dir);
    assert.ok(tick2.agents["fly-1"], "the fly is still on the board");
    assert.doesNotMatch(tick2.agents["fly-1"].goal, /being carried/, "the captor is gone — the fly moves independently again");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("lay, hatch and spawn all drive real turn-stamped writes, verified against readFactRows", async () => {
  // spider-1 already carries enough mass to cross the 25 lay threshold on its
  // very first tick, sitting in the static home web the whole time — no fly
  // anywhere on the board, so it just holds there.
  const dir = await boardWith([place("spider-1", "cell-2-2"), weigh("spider-1", 25.5)], "ecology");
  try {
    const tick1 = await runSpiderFlyTick(dir); // 25.5 - 0.5 = 25, in the web — lays egg-1
    assert.equal(tick1.turn, 1);
    assert.equal(laidEgg(tick1), "egg-1");

    await runSpiderFlyTick(dir);
    const tick3 = await runSpiderFlyTick(dir); // a spawn turn (3 % 3 === 0)
    const spawn = spawnedFly(tick3);
    assert.ok(spawn, "turn 3 is a spawn turn regardless of the egg's own timeline");
    assert.ok(tick3.agents[spawn.agent], "the spawned fly is already in THIS tick's own agents, not only next tick's fold");
    assert.equal(tick3.agents[spawn.agent].cell, spawn.cell);
    assert.ok(perimeterCells(SPIDER_FLY_LAYOUT).includes(spawn.cell), "and it lands on a real perimeter cell");

    const tick4 = await runSpiderFlyTick(dir); // egg-1 (laid turn 1) hatches
    const hatches = eventsOfType(tick4, "hatch-egg");
    assert.equal(hatches.length, 1);
    assert.equal(hatches[0].egg, "egg-1");
    assert.equal(hatches[0].cell, "cell-2-2");
    for (const { id, mass } of hatches[0].hatchlings) {
      assert.ok(tick4.agents[id], "each hatchling is already in THIS tick's own agents, not only next tick's fold");
      assert.equal(tick4.agents[id].cell, "cell-2-2");
      assert.equal(tick4.agents[id].mass, mass);
      assert.equal(tick4.agents[id].goal, "just hatched — no goal yet.");
    }

    const rows = readFactRows(await loadMemory(dir));
    const has = (subject, predicate, object) => rows.some((r) => r.subject === subject && r.predicate === predicate && r.object === object);
    assert.ok(has("egg-1@turn1", "mgx:currently-in", "cell-2-2"), "the egg is laid at the laying spider's cell");
    assert.ok(has("egg-1@turn1", "mgx:laid-at-turn", "1"));
    assert.ok(has("egg-1@turn1", "mgx:hasMass", "10"), "the 25 - 15 surplus becomes the egg's own starting mass");
    assert.ok(has("spider-1@turn1", "mgx:hasMass", "15"), "the laying spider resets to exactly its own initial mass");
    assert.ok(has("egg-1@turn4", "mgx:hatched-into", hatches[0].hatchlings[0].id));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a live egg blocks a second lay, and mass alone outside the web is never enough", async () => {
  const outside = await boardWith([place("spider-1", "cell-6-6"), weigh("spider-1", 30)], "lay-outside");
  try {
    const tick = await runSpiderFlyTick(outside);
    assert.equal(laidEgg(tick), null, "the spider must be standing in an active web too");
  } finally {
    await rm(outside, { recursive: true, force: true });
  }

  const withEgg = await boardWith([
    place("spider-1", "cell-2-2"), weigh("spider-1", 30),
    { subject: "egg-1@turn1", predicate: "mgx:currently-in", object: "cell-2-3" },
    { subject: "egg-1@turn1", predicate: "mgx:laid-at-turn", object: "1" },
    { subject: "egg-1@turn1", predicate: "mgx:hasMass", object: "9" },
  ], "lay-blocked");
  try {
    const tick = await runSpiderFlyTick(withEgg);
    assert.equal(laidEgg(tick), null, "a live, unhatched egg blocks laying a second one regardless of mass");
  } finally {
    await rm(withEgg, { recursive: true, force: true });
  }
});

test("every live agent's returned entry carries a plan array and a belief map, not just a chasing spider's", async () => {
  const dir = await boardWith([
    place("spider-1", "cell-2-2"),
    place("fly-1", "cell-5-2"), weigh("fly-1", 10),
  ], "plan-belief");
  try {
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

test("a run replays byte-identically into a second store", async () => {
  const play = async (label) => {
    const dir = await boardWith([place("spider-1", "cell-2-2"), place("fly-1", "cell-6-2"), weigh("fly-1", FLY_INITIAL_MASS)], label);
    try {
      const turns = [];
      for (let i = 0; i < 12; i += 1) {
        const tick = await runSpiderFlyTick(dir);
        turns.push({ turn: tick.turn, agents: tick.agents, ecology: tick.ecology, activeWebs: tick.activeWebs });
      }
      return turns;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
  assert.deepEqual(await play("replay-a"), await play("replay-b"));
});

// ---- mood: a written fact, not a renderer's re-reading of the goal prose ------
//
// The mood word used to be recovered downstream by prefix-matching the goal
// sentence the engine renders. `moodFromGoalProse` is that derivation, kept as
// the oracle the written fact has to agree with, so moving the word from parsed
// prose to a real mgx:feels row cannot silently change what an agent feels.

function moodFromGoalProse(agent, kind) {
  const goal = agent?.goal || "";
  if (kind === "spider") {
    if (goal.startsWith("just ate")) return "happy";
    if (goal.startsWith("carrying") || goal.startsWith("chasing") || goal.startsWith("co-located with")) return "angry";
    if (goal.startsWith("avoiding")) return "scared";
    return "calm";
  }
  if (kind === "fly") {
    if (
      goal.startsWith("evading")
      || goal.startsWith("being carried by")
      || goal.startsWith("just caught by")
      || goal.startsWith("trapped in an active web")
    ) return "scared";
    return "calm";
  }
  return "calm";
}

test("a tick appends each live agent's mood as that turn's own mgx:feels fact, beside its placement", async () => {
  const dir = await boardWith([
    place("spider-1", "cell-2-2"),
    place("fly-1", "cell-5-2"), weigh("fly-1", 10),
  ], "mood-fact");
  try {
    const tick = await runSpiderFlyTick(dir);
    assert.equal(tick.agents["spider-1"].mood, "angry", "a spider closing on a fly it can see");
    assert.equal(tick.agents["fly-1"].mood, "scared", "a fly with that spider in sight");

    const rows = readFactRows(await loadMemory(dir));
    const feelsFor = (subject) => rows.filter((r) => r.subject === subject && r.predicate === "mgx:feels").map((r) => r.object);
    assert.deepEqual(feelsFor("spider-1@turn1"), ["angry"]);
    assert.deepEqual(feelsFor("fly-1@turn1"), ["scared"]);
    const placementProvenance = rows.find((r) => r.subject === "spider-1@turn1" && r.predicate === "mgx:currently-in").provenance;
    const moodProvenance = rows.find((r) => r.subject === "spider-1@turn1" && r.predicate === "mgx:feels").provenance;
    assert.equal(moodProvenance, placementProvenance, "the mood is this turn's fact on the same footing as the placement, same provenance tag");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the mood a spider ends the tick on is what goes on record — happy after an eat, not the angry it was mid-chase", async () => {
  const dir = await boardWith([
    place("spider-1", "cell-2-2"), weigh("spider-1", 12),
    place("fly-1", "cell-2-2"), weigh("fly-1", 8),
  ], "mood-eat");
  try {
    const tick = await runSpiderFlyTick(dir);
    assert.deepEqual(eatenFlies(tick), ["fly-1"]);
    assert.equal(tick.agents["spider-1"].mood, "happy");
    assert.equal(tick.agents["spider-1"].goal, "just ate fly-1 in the web.");

    const rows = readFactRows(await loadMemory(dir));
    assert.deepEqual(
      rows.filter((r) => r.subject === "spider-1@turn1" && r.predicate === "mgx:feels").map((r) => r.object),
      ["happy"],
      "one mood per agent per turn, and it is the post-ecology one",
    );
    assert.ok(
      !rows.some((r) => r.subject === "fly-1@turn1" && r.predicate === "mgx:feels"),
      "the eaten fly left the board this tick, so no mood is recorded for it",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("every mood the engine emits over a real run is a curated expression word, and matches what the goal prose used to be parsed into", async () => {
  const dir = await boardWith([place("spider-1", "cell-2-2"), place("fly-1", "cell-6-2"), weigh("fly-1", FLY_INITIAL_MASS)], "mood-golden");
  try {
    const seen = new Set();
    let checked = 0;
    for (let i = 0; i < 15; i += 1) {
      const tick = await runSpiderFlyTick(dir);
      for (const [id, agent] of Object.entries(tick.agents)) {
        const kind = id.replace(/-\d+$/, "");
        assert.ok(EXPRESSION_PALETTE[agent.mood], `${id} turn ${tick.turn}: "${agent.mood}" is not a curated expression word`);
        assert.equal(agent.mood, moodFromGoalProse(agent, kind), `${id} turn ${tick.turn}: mood disagrees with its own goal line "${agent.goal}"`);
        seen.add(agent.mood);
        checked += 1;
      }
      const rows = readFactRows(await loadMemory(dir));
      for (const [id, agent] of Object.entries(tick.agents)) {
        assert.ok(
          rows.some((r) => r.subject === `${id}@turn${tick.turn}` && r.predicate === "mgx:feels" && r.object === agent.mood),
          `${id} turn ${tick.turn}: the returned mood is not on record in the store`,
        );
      }
    }
    assert.ok(checked >= 15, "the run really exercised the oracle rather than ending after a turn or two");
    assert.ok(seen.size >= 3, `a chase, an escape and a hold all happened over 15 turns — saw only ${[...seen].join(", ")}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- the world's structural self-description facts ----------------------------

test("worldFactRows restates the page-surfaced structure as facts, quoting the shipped defaults it actually runs", () => {
  const rows = [...worldFactRows()];
  const has = (subject, predicate, object) =>
    rows.some((r) => r.subject === subject && r.predicate === predicate && r.object === object);

  assert.ok(has("board", "rdf:type", "grid"));
  assert.ok(has("board", "mgx:hasA", "10 rows"));
  assert.ok(has("board", "mgx:hasA", "10 columns"));
  assert.ok(has("board", "mgx:hasA", "100 cells"));
  assert.ok(has("web", "mgx:cover", `9 cells around ${cellId(2, 2)}`), "the web block's own cell count and home cell, derived, not typed in");
  assert.ok(has("web", "mgx:last-for", `${KNOBS.webDurationTurns} turns by default when a spider builds one`));
  assert.ok(has("spider", "mgx:hasA", `vision radius of ${KNOBS.spiderVisionRadius} cells by default`));
  assert.ok(has("spider", "mgx:start-with", `mass ${KNOBS.spiderInitialMass} by default`));
  assert.ok(has("spider", "mgx:lose", `${KNOBS.spiderMassDecrementPerTurn} mass per turn by default`));
  assert.ok(has("spider", "mgx:lay", `one egg at mass ${KNOBS.eggLayMassThreshold} by default`));
  assert.ok(has("fly", "mgx:hasA", `vision radius of ${KNOBS.flyVisionRadius} cells by default`));
  assert.ok(has("fly", "mgx:start-with", `mass ${KNOBS.flyInitialMass} by default`));
  assert.ok(has("fly", "mgx:lose", `${KNOBS.flyMassDecrementPerTurn} mass per turn by default`));
  assert.ok(has("fly", "mgx:arrive", `every ${KNOBS.flySpawnIntervalTurns} turns at the edge of the board by default`));
  assert.ok(has("egg", "mgx:hatch-after", `${KNOBS.eggHatchDelayTurns} turns by default`));
  assert.ok(has("egg", "mgx:hatch-into", `${KNOBS.eggHatchCount} spiders by default`));
  assert.ok(
    has("vision radius", "mgx:hasProperty", `${KNOBS.spiderVisionRadius} cells for both the spider and the fly by default`),
    "the exact slider-label term describes too, not only the per-class rows",
  );
});

test("every tunable-knob structural fact says 'by default' — a slider or tmct.toml can move the number, so an unqualified claim would go stale", () => {
  // Grid geometry is fixed in the world module itself, so those rows carry no
  // qualifier; everything else quotes a game-config knob.
  const geometryRows = new Set(["board", "web mgx:cover"]);
  const structural = [...worldFactRows()].filter((r) =>
    ["board", "web", "spider", "fly", "egg", "vision radius"].includes(r.subject)
    && !["rdf:type", "rdfs:subClassOf"].includes(r.predicate));
  assert.ok(structural.length >= 15, "the structural family is present at all");
  for (const r of structural) {
    if (geometryRows.has(r.subject) || geometryRows.has(`${r.subject} ${r.predicate}`)) continue;
    assert.match(r.object, /by default/, `${r.subject} ${r.predicate} ${r.object} quotes a tunable without saying "by default"`);
  }
});
