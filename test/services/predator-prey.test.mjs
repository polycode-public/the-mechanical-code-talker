import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MUDIII_ROLES, MUDIII_STATE_PREDICATES,
  foldTownSquareState, greedyBlend, gridApplyActions, greedyAway, greedyToward, hasActiveWebAt, isMudiiiStatePredicate,
  liveWebs, pathStateKey, placeFood, recastTownSquare, roleOfId, runTownSquareTick, seededWander,
  startTownSquareGame, townSquareBoard, townSquareTickPayload,
} from "../../src/services/predator-prey.mjs";
import { TOWN_SQUARE_LAYOUTS, cellId, openCells, worldFactRows } from "../../src/domain/town-square-world.mjs";
import { appendFacts, loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";
import { DEFAULT_GAME_CONFIG } from "../../src/domain/game-config.mjs";
import { EXPRESSION_PALETTE } from "../../src/domain/sprite-expressions.mjs";

const LAYOUT = TOWN_SQUARE_LAYOUTS["town-square"];
const CONFIG = DEFAULT_GAME_CONFIG.mudiii;

const worldRows = () => [...worldFactRows(LAYOUT)]
  .map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object, provenance: "world:town-square" }));

async function boardWith(facts, label) {
  const dir = await mkdtemp(join(tmpdir(), `tmct-mudiii-${label}-`));
  await appendFacts(dir, worldRows());
  if (facts.length) await appendFacts(dir, facts.map((f) => ({ ...f, provenance: "world:town-square" })));
  return dir;
}

const place = (id, cell) => ({ subject: id, predicate: "mgx:currently-in", object: cell });
const weigh = (id, mass) => ({ subject: id, predicate: "mgx:hasMass", object: String(mass) });
const classify = (id, kind) => ({ subject: id, predicate: "rdf:type", object: kind });

// ---- the roles object -----------------------------------------------------------

test("the cast is data, keyed by role rather than by species", () => {
  assert.deepEqual(MUDIII_ROLES, {
    predator: { role: "predator", kind: "fox", idPrefix: "fox" },
    prey: { role: "prey", kind: "goblin", idPrefix: "goblin" },
    food: { spawnedKind: "crumb", placedKind: "morsel" },
  });
  assert.equal(roleOfId("fox-2"), "predator");
  assert.equal(roleOfId("goblin-10"), "prey");
  assert.equal(roleOfId("crumb-1"), null, "food has no role");
  assert.equal(roleOfId("well-1"), null, "nor does a prop");
});

test("the state-predicate filter names the families a turn writes, and nothing else", () => {
  for (const predicate of ["mgx:currently-in", "mgx:hasMass", "mgx:feels", "mgx:facing", "mgx:eaten-by", "mgx:starved", "mgx:placed-by", "rdf:type", "mgx:has-exit-north"]) {
    assert.ok(isMudiiiStatePredicate(predicate), predicate);
  }
  assert.equal(isMudiiiStatePredicate("mgx:mass"), false, "spider-fly's own predicate is not this engine's");
  assert.equal(isMudiiiStatePredicate("rdfs:label"), false);
  assert.ok(MUDIII_STATE_PREDICATES.includes("mgx:hasMass"));
  assert.deepEqual([...MUDIII_STATE_PREDICATES].sort(), MUDIII_STATE_PREDICATES, "sorted, so a diff of the list reads");
});

// ---- the (epoch, turn) fold ------------------------------------------------------

test("the fold takes the newest snapshot per subject and separates every terminal marker into removed", () => {
  const state = foldTownSquareState([
    place("fox-1", "cell-2-2"),
    { subject: "fox-1@turn3", predicate: "mgx:currently-in", object: "cell-3-2" },
    place("goblin-1", "cell-8-2"),
    weigh("goblin-1", 8),
    { subject: "goblin-1@turn1", predicate: "mgx:hasMass", object: "7.94" },
    { subject: "goblin-1@turn2", predicate: "mgx:hasMass", object: "7.88" },
    { subject: "goblin-2@turn2", predicate: "mgx:currently-in", object: "cell-4-2" },
    { subject: "goblin-2@turn2", predicate: "mgx:starved", object: "true" },
    { subject: "goblin-3@turn1", predicate: "mgx:eaten-by", object: "fox-1" },
    { subject: "goblin-1@turn3", predicate: "mgx:feels", object: "scared" },
    { subject: "square@turn3", predicate: "mgx:turn-played", object: "3" },
  ]);
  assert.equal(state.epoch, 0);
  assert.equal(state.turnCount, 3);
  assert.equal(state.tickCount, 3, "read off the one marker row a tick always writes");
  assert.deepEqual(state.placements.get("fox-1"), { cell: "cell-3-2", turn: 3, epoch: 0 });
  assert.deepEqual(state.mass.get("goblin-1"), { value: 7.88, turn: 2, epoch: 0 });
  assert.deepEqual([...state.removed].sort(), ["goblin-2", "goblin-3"]);
});

test("rows rank by (epoch, turn), so a recast's turn-1 snapshot beats the previous run's turn-9 one", () => {
  const state = foldTownSquareState([
    { subject: "world", predicate: "mgx:world-epoch", object: "2" },
    place("fox-1", "cell-1-1"),
    { subject: "fox-1@turn9", predicate: "mgx:currently-in", object: "cell-9-9" },
    { subject: "fox-1@epoch2@turn1", predicate: "mgx:currently-in", object: "cell-4-4" },
    { subject: "square@turn9", predicate: "mgx:turn-played", object: "9" },
    { subject: "square@epoch2@turn1", predicate: "mgx:turn-played", object: "1" },
  ]);
  assert.equal(state.epoch, 2);
  assert.deepEqual(state.placements.get("fox-1"), { cell: "cell-4-4", turn: 1, epoch: 2 });
  assert.equal(state.tickCount, 1, "the new run's turn counter, not the old run's");
});

test("an epoch-stamped subject's base is the bare id — a greedy snapshot regex would read it as \"goblin-1@epoch2\" and drop the row", () => {
  const state = foldTownSquareState([
    { subject: "world", predicate: "mgx:world-epoch", object: "2" },
    { subject: "goblin-1@epoch2@turn3", predicate: "mgx:currently-in", object: "cell-5-5" },
    { subject: "goblin-1@epoch2@turn3", predicate: "mgx:feels", object: "calm" },
  ]);
  assert.ok(state.placements.has("goblin-1"), "the roster id, not a stamped one");
  assert.equal(state.placements.has("goblin-1@epoch2"), false);
});

test("an unstamped row ranks as turn 0 of the CURRENT epoch, so a recast re-seeds from the shard's own rows", () => {
  const state = foldTownSquareState([
    { subject: "world", predicate: "mgx:world-epoch", object: "1" },
    place("goblin-1", "cell-2-2"),
    { subject: "goblin-1@turn9", predicate: "mgx:currently-in", object: "cell-9-9" },
  ]);
  assert.deepEqual(state.placements.get("goblin-1"), { cell: "cell-2-2", turn: 0, epoch: 1 });
});

test("a terminal marker from a previous epoch does not arrive at the new run already dead", () => {
  const state = foldTownSquareState([
    { subject: "world", predicate: "mgx:world-epoch", object: "2" },
    { subject: "goblin-1@turn4", predicate: "mgx:eaten-by", object: "fox-1" },
    { subject: "goblin-1@epoch2@turn1", predicate: "mgx:currently-in", object: "cell-3-3" },
  ]);
  assert.equal(state.removed.has("goblin-1"), false);
});

// ---- movement over the world's own exit facts ------------------------------------

test("gridApplyActions offers one hop per exit fact, in the fixed direction order", () => {
  const applyActions = gridApplyActions([
    { subject: "cell-5-5", predicate: "mgx:has-exit-west", object: "cell-4-5" },
    { subject: "cell-5-5", predicate: "mgx:has-exit-north", object: "cell-5-4" },
  ]);
  assert.deepEqual(applyActions({ x: 5, y: 5 }).map((a) => a.action), ["north", "west"]);
  assert.deepEqual(applyActions({ x: 9, y: 9 }), [], "a cell with no exit rows is a dead end");
});

test("a building is a missing edge and nothing else — no exit into the terrace exists to be taken", () => {
  const applyActions = gridApplyActions([...worldFactRows(LAYOUT)]);
  const fromWest = applyActions({ x: 7, y: 1 }).map((a) => a.nextState).map((s) => cellId(s.x, s.y));
  assert.equal(fromWest.includes("cell-8-1"), false, "house-1 stands there");
  assert.deepEqual(applyActions({ x: 8, y: 2 }), [], "house-2's own cell offers no move at all");
});

test("greedyAway maximizes Chebyshev distance and greedyToward minimizes it", () => {
  const applyActions = gridApplyActions([...worldFactRows(LAYOUT)]);
  const away = greedyAway({ x: 5, y: 5 }, { x: 5, y: 4 }, applyActions);
  assert.deepEqual(away, { x: 5, y: 6 });
  const toward = greedyToward({ x: 5, y: 5 }, { x: 5, y: 1 }, applyActions);
  assert.deepEqual(toward, { x: 5, y: 4 });
  assert.deepEqual(greedyAway({ x: 5, y: 5 }, null, applyActions), { x: 5, y: 5 }, "nothing believed, nothing to run from");
});

test("seededWander replays byte-identically and carries the epoch, so a Reset does not repeat the previous run", () => {
  const applyActions = gridApplyActions([...worldFactRows(LAYOUT)]);
  const at = { x: 5, y: 5 };
  const first = seededWander(at, applyActions, { layoutName: "town-square", epoch: 0, turn: 3, id: "goblin-1" });
  const again = seededWander(at, applyActions, { layoutName: "town-square", epoch: 0, turn: 3, id: "goblin-1" });
  assert.deepEqual(first, again);
  const afterReset = seededWander(at, applyActions, { layoutName: "town-square", epoch: 1, turn: 3, id: "goblin-1" });
  assert.notDeepEqual(first, afterReset, "the epoch is in the seed string, or a Reset replays the run it replaced");
});

// ---- bootstrap --------------------------------------------------------------------

test("startTownSquareGame seeds the layout's own cast once, and is a no-op the second time", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mudiii-start-"));
  try {
    await appendFacts(dir, worldRows());
    const first = await startTownSquareGame(dir, { layout: LAYOUT });
    assert.equal(first.started, true);
    const state = foldTownSquareState(readFactRows(await loadMemory(dir)));
    assert.deepEqual([...state.placements.keys()].filter((id) => /^fox-\d+$/.test(id)), ["fox-1"]);
    assert.deepEqual([...state.placements.keys()].filter((id) => /^goblin-\d+$/.test(id)).sort(), ["goblin-1", "goblin-2", "goblin-3"]);
    assert.equal(state.mass.get("fox-1").value, CONFIG.predatorInitialMass);
    assert.equal(state.mass.get("goblin-1").value, CONFIG.preyInitialMass);
    assert.equal(state.facing.get("fox-1").value, "south");
    assert.equal(state.mood.get("goblin-1").value, "calm", "a mood fact exists from the moment the individual does");
    for (const id of ["fox-1", "goblin-1", "goblin-2", "goblin-3"]) {
      assert.equal(state.placements.get(id).cell.startsWith("cell-"), true);
    }
    assert.equal((await startTownSquareGame(dir, { layout: LAYOUT })).started, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a seeded roster never places anything on a prop's cell", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mudiii-start-open-"));
  try {
    await appendFacts(dir, worldRows());
    await startTownSquareGame(dir, { layout: LAYOUT });
    const state = foldTownSquareState(readFactRows(await loadMemory(dir)));
    const open = new Set(openCells(LAYOUT));
    for (const id of ["fox-1", "goblin-1", "goblin-2", "goblin-3"]) {
      assert.ok(open.has(state.placements.get(id).cell), `${id} was seeded onto a prop`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- recast: an in-place epoch bump on a live store -------------------------------

test("recastTownSquare re-mints the roster on a store that has already played real ticks, matching a store opened straight onto that epoch", async () => {
  const played = await mkdtemp(join(tmpdir(), "tmct-mudiii-recast-played-"));
  const fresh = await mkdtemp(join(tmpdir(), "tmct-mudiii-recast-fresh-"));
  try {
    await appendFacts(played, worldRows());
    await startTownSquareGame(played, { layout: LAYOUT });
    // Several real ticks, not a never-played store — the trap only shows up
    // once fox-1 and the goblins have actually moved off their epoch-0 spawn.
    for (let i = 0; i < 5; i += 1) await runTownSquareTick(played, { layout: LAYOUT });

    const recast = await recastTownSquare(played, { layout: LAYOUT, epoch: 1 });
    assert.equal(recast.started, true, "the guard must not read the epoch-0 roster as already minted for epoch 1");

    await appendFacts(fresh, worldRows());
    await startTownSquareGame(fresh, { layout: LAYOUT, epoch: 1 });

    const playedState = foldTownSquareState(readFactRows(await loadMemory(played)));
    const freshState = foldTownSquareState(readFactRows(await loadMemory(fresh)));
    assert.equal(playedState.epoch, 1);
    for (const id of ["fox-1", "goblin-1", "goblin-2", "goblin-3"]) {
      assert.deepEqual(
        playedState.placements.get(id), freshState.placements.get(id),
        `${id}'s post-recast placement must match a store that opened straight onto epoch 1, not carry over its epoch-0 spawn`,
      );
    }
  } finally {
    await rm(played, { recursive: true, force: true });
    await rm(fresh, { recursive: true, force: true });
  }
});

test("recastTownSquare defaults epoch to one past the store's current epoch", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mudiii-recast-default-"));
  try {
    await appendFacts(dir, worldRows());
    await startTownSquareGame(dir, { layout: LAYOUT });
    const recast = await recastTownSquare(dir, { layout: LAYOUT });
    assert.equal(recast.started, true);
    const state = foldTownSquareState(readFactRows(await loadMemory(dir)));
    assert.equal(state.epoch, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("recastTownSquare refuses an epoch that would not move the store forward", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mudiii-recast-refuse-"));
  try {
    await appendFacts(dir, worldRows());
    await startTownSquareGame(dir, { layout: LAYOUT });
    await recastTownSquare(dir, { layout: LAYOUT, epoch: 3 });
    await assert.rejects(() => recastTownSquare(dir, { layout: LAYOUT, epoch: 3 }), /epoch must be an integer greater than the current epoch/);
    await assert.rejects(() => recastTownSquare(dir, { layout: LAYOUT, epoch: 1 }), /epoch must be an integer greater than the current epoch/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("startTownSquareGame stays a no-op on a second call for the SAME epoch, recast or not", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mudiii-recast-idempotent-"));
  try {
    await appendFacts(dir, worldRows());
    await recastTownSquare(dir, { layout: LAYOUT, epoch: 1 });
    const again = await startTownSquareGame(dir, { layout: LAYOUT, epoch: 1 });
    assert.equal(again.started, false, "epoch 1 already has a minted roster");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- the board as it stands, with no turn spent ----------------------------------

test("townSquareBoard reports the seeded cast at its real cells before any tick runs", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mudiii-board-"));
  try {
    await appendFacts(dir, worldRows());
    await startTownSquareGame(dir, { layout: LAYOUT });
    const board = await townSquareBoard(dir, { layout: LAYOUT });

    assert.equal(board.turn, 0, "no tick has been played");
    assert.deepEqual(board.ecology, [], "no ecology pass has run, so nothing happened to report");
    assert.deepEqual(Object.keys(board.agents), ["fox-1", "goblin-1", "goblin-2", "goblin-3"]);

    const open = new Set(openCells(LAYOUT));
    for (const [id, agent] of Object.entries(board.agents)) {
      assert.ok(open.has(agent.cell), `${id} reports a real open cell, never null`);
    }
    assert.equal(board.agents["fox-1"].role, "predator");
    assert.equal(board.agents["goblin-1"].role, "prey");
    assert.equal(board.agents["fox-1"].mass, CONFIG.predatorInitialMass);
    assert.equal(board.agents["goblin-1"].facing, "south");
    assert.equal(board.agents["goblin-1"].mood, "calm");
    assert.deepEqual(board.agents["fox-1"].plan, [], "nothing has been planned yet");
    assert.equal(board.agents["fox-1"].goal, "", "no decision has been made, so no goal is claimed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("townSquareBoard spends no turn and writes no fact — reading the board twice leaves it identical", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mudiii-board-pure-"));
  try {
    await appendFacts(dir, worldRows());
    await startTownSquareGame(dir, { layout: LAYOUT });
    const rowsBefore = readFactRows(await loadMemory(dir)).length;
    const first = await townSquareBoard(dir, { layout: LAYOUT });
    const second = await townSquareBoard(dir, { layout: LAYOUT });
    assert.deepEqual(second, first, "a read is a read");
    assert.equal(readFactRows(await loadMemory(dir)).length, rowsBefore, "nothing was appended");
    assert.equal((await townSquareBoard(dir, { layout: LAYOUT })).turn, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("townSquareBoard carries the same agent and item field set a tick emits", async () => {
  const dir = await boardWith([
    classify("fox-1", "fox"), place("fox-1", "cell-5-5"), weigh("fox-1", 20),
    classify("goblin-1", "goblin"), place("goblin-1", "cell-5-7"), weigh("goblin-1", 8),
    classify("crumb-1", "crumb"), place("crumb-1", "cell-6-6"), weigh("crumb-1", 1),
  ], "board-shape");
  try {
    const board = await townSquareBoard(dir, { layout: LAYOUT });
    const tick = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.deepEqual(
      Object.keys(board.agents["fox-1"]).sort(),
      Object.keys(tick.agents["fox-1"]).sort(),
      "a renderer reads one agent shape whether it drew the opening board or a tick",
    );
    assert.deepEqual(Object.keys(board.items["crumb-1"]).sort(), ["cell", "kind"]);
    assert.equal(board.items["crumb-1"].cell, "cell-6-6");
    assert.equal(board.items["crumb-1"].kind, "crumb");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("townSquareBoard's belief is the engine's own vision-gated snapshot, not an empty stub", async () => {
  const dir = await boardWith([
    classify("fox-1", "fox"), place("fox-1", "cell-5-5"), weigh("fox-1", 20),
    classify("goblin-1", "goblin"), place("goblin-1", "cell-5-6"), weigh("goblin-1", 8),
    classify("goblin-2", "goblin"), place("goblin-2", "cell-12-12"), weigh("goblin-2", 8),
  ], "board-belief");
  try {
    const board = await townSquareBoard(dir, { layout: LAYOUT });
    const belief = board.agents["fox-1"].belief;
    assert.equal(belief["goblin-1"], "cell-5-6", "the neighbour one step away is seen where it stands");
    assert.ok("goblin-2" in belief, "a candidate out of range is still named");
    assert.equal(belief["goblin-2"], null, "and reported unseen rather than at a guessed cell");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("townSquareBoard reports the last tick played, so a caller's turn counter resumes from it", async () => {
  const dir = await boardWith([
    classify("fox-1", "fox"), place("fox-1", "cell-5-5"), weigh("fox-1", 20),
  ], "board-turn");
  try {
    await runTownSquareTick(dir, { layout: LAYOUT });
    await runTownSquareTick(dir, { layout: LAYOUT });
    const board = await townSquareBoard(dir, { layout: LAYOUT });
    assert.equal(board.turn, 2);
    assert.equal(board.agents["fox-1"].cell, (await townSquareBoard(dir, { layout: LAYOUT })).agents["fox-1"].cell);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("townSquareBoard refuses a layout name no pack holds, the same way a tick does", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mudiii-board-layout-"));
  try {
    await assert.rejects(() => townSquareBoard(dir, { layout: "no-such-square" }), /no such layout/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- the two decision chains --------------------------------------------------------

test("a predator with nothing in view wanders rather than holding still — a motionless predator reads as a broken page", async () => {
  const dir = await boardWith([classify("fox-1", "fox"), place("fox-1", "cell-5-5"), weigh("fox-1", 20)], "wander");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.equal(tick.rungs["fox-1"], "wander");
    assert.match(tick.agents["fox-1"].goal, /wandering/);
    assert.equal(tick.agents["fox-1"].mood, "calm");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a predator that believes prey chases it with a real multi-step path, and the plan's first step is the move", async () => {
  const dir = await boardWith([
    classify("fox-1", "fox"), place("fox-1", "cell-5-5"), weigh("fox-1", 20),
    classify("goblin-1", "goblin"), place("goblin-1", "cell-8-5"), weigh("goblin-1", 8),
  ], "chase");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.equal(tick.rungs["fox-1"], "chase");
    assert.deepEqual(tick.agents["fox-1"].plan, ["east", "east", "east"]);
    assert.equal(tick.agents["fox-1"].cell, "cell-6-5", "one cell a turn, whatever the plan's length");
    assert.equal(tick.agents["fox-1"].facing, "east", "plan[0] drives facing");
    assert.equal(tick.agents["fox-1"].mood, "angry");
    assert.match(tick.agents["fox-1"].goal, /chasing goblin-1, last seen at cell-8-5/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a second live predator in view beats the chase — avoid is rung one", async () => {
  const dir = await boardWith([
    classify("fox-1", "fox"), place("fox-1", "cell-5-5"), weigh("fox-1", 20),
    classify("fox-2", "fox"), place("fox-2", "cell-6-5"), weigh("fox-2", 20),
    classify("goblin-1", "goblin"), place("goblin-1", "cell-4-5"), weigh("goblin-1", 8),
  ], "avoid");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.equal(tick.rungs["fox-1"], "avoid");
    assert.equal(tick.agents["fox-1"].mood, "scared");
    assert.match(tick.agents["fox-1"].goal, /avoiding fox-2, last seen at cell-6-5/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a prey's chain is evade over forage over wander, and the ordering alone resolves the conflict", async () => {
  const withFood = [
    classify("goblin-1", "goblin"), place("goblin-1", "cell-5-5"), weigh("goblin-1", 8),
    classify("crumb-1", "crumb"), place("crumb-1", "cell-7-5"), weigh("crumb-1", 1),
  ];
  const foraging = await boardWith(withFood, "forage");
  try {
    const tick = await runTownSquareTick(foraging, { layout: LAYOUT });
    assert.equal(tick.rungs["goblin-1"], "forage");
    assert.deepEqual(tick.agents["goblin-1"].plan, ["east", "east"]);
    assert.equal(tick.agents["goblin-1"].mood, "calm");
    assert.match(tick.agents["goblin-1"].goal, /foraging — heading for crumb-1 at cell-7-5/);
  } finally {
    await rm(foraging, { recursive: true, force: true });
  }

  const threatened = await boardWith([...withFood, classify("fox-1", "fox"), place("fox-1", "cell-4-5"), weigh("fox-1", 20)], "evade");
  try {
    const tick = await runTownSquareTick(threatened, { layout: LAYOUT });
    assert.equal(tick.rungs["goblin-1"], "evade", "the forage branch is simply never reached — there is no arbitration code");
    assert.equal(tick.agents["goblin-1"].cell, "cell-6-5", "one ply, away from the fox");
    assert.equal(tick.agents["goblin-1"].mood, "scared");
    assert.match(tick.agents["goblin-1"].goal, /evading — last saw fox-1 at cell-4-5/);
  } finally {
    await rm(threatened, { recursive: true, force: true });
  }
});

test("a fleeing prey breaks an equally-safe tie toward food it knows about, not toward whichever direction comes first", async () => {
  // From cell-5-5, fleeing cell-2-2 ties cell-5-6 and cell-6-5 at Chebyshev
  // distance 4 — DIRECTION_DELTA's key order (north, south, east, west) would
  // check south before east and settle for cell-5-6 with no tie-break at all.
  // The crumb sits east, so the tie-break should send the goblin to cell-6-5.
  const dir = await boardWith([
    classify("fox-1", "fox"), place("fox-1", "cell-2-2"), weigh("fox-1", 20),
    classify("goblin-1", "goblin"), place("goblin-1", "cell-5-5"), weigh("goblin-1", 8),
    classify("crumb-1", "crumb"), place("crumb-1", "cell-7-5"), weigh("crumb-1", 1),
  ], "evade-toward-food");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.equal(tick.rungs["goblin-1"], "evade");
    assert.equal(tick.agents["goblin-1"].cell, "cell-6-5", "the tied safe cell closer to the known crumb, not the first-enumerated one");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a fleeing predator's own tie-break is unchanged: the avoid rung never sees the prey's food preference", async () => {
  // Same geometry as the tie-break test above, but fox-2 is the threat and
  // there is no food candidate in scope for a predator at all — the avoid
  // rung must still land on cell-5-6, the first-enumerated tied cell.
  const dir = await boardWith([
    classify("fox-1", "fox"), place("fox-1", "cell-5-5"), weigh("fox-1", 20),
    classify("fox-2", "fox"), place("fox-2", "cell-2-2"), weigh("fox-2", 20),
  ], "avoid-unchanged");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.equal(tick.rungs["fox-1"], "avoid");
    assert.equal(tick.agents["fox-1"].cell, "cell-5-6", "first-wins tie order, exactly as before the prey tie-break existed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- the weighted alternative to strict evade-before-forage ------------------------
// Every board below shares one geometry. A goblin stands at cell-5-5, a fox at
// cell-2-5 (three west, inside a prey's vision), and a crumb at cell-5-3 (two
// north). Fleeing due east to cell-6-5 buys one cell of distance and abandons
// the crumb; stepping north to cell-5-4 halves the distance to the crumb and
// costs nothing at all, since cell-5-4 is the same three cells from the fox.

const blendBoard = (label) => boardWith([
  classify("fox-1", "fox"), place("fox-1", "cell-2-5"), weigh("fox-1", 20),
  classify("goblin-1", "goblin"), place("goblin-1", "cell-5-5"), weigh("goblin-1", 8),
  classify("crumb-1", "crumb"), place("crumb-1", "cell-5-3"), weigh("crumb-1", 1),
], label);

test("greedyBlend maximizes the weighted difference, and collapses to either pure rung at the ends", () => {
  const applyActions = gridApplyActions([...worldFactRows(LAYOUT)]);
  const from = { x: 5, y: 5 };
  const fox = { x: 2, y: 5 };
  const crumb = { x: 5, y: 3 };
  assert.deepEqual(greedyBlend(from, fox, crumb, applyActions, 0.5), { x: 5, y: 4 }, "one cell of hunger for no cell of safety");
  assert.deepEqual(greedyBlend(from, fox, crumb, applyActions, 1), greedyAway(from, fox, applyActions), "weight 1 is the evade rung");
  assert.deepEqual(greedyBlend(from, fox, crumb, applyActions, 0), greedyToward(from, crumb, applyActions), "weight 0 is the forage rung");
  assert.deepEqual(greedyBlend(from, null, crumb, applyActions, 0.5), greedyToward(from, crumb, applyActions), "nothing to run from");
  assert.deepEqual(greedyBlend(from, fox, null, applyActions, 0.5), greedyAway(from, fox, applyActions), "nothing to run toward");
});

test("with blendPreyDecision off, a prey in sight of a predator abandons the crumb entirely", async () => {
  const dir = await blendBoard("blend-off");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.equal(tick.rungs["goblin-1"], "evade", "evade beats forage, whatever the crumb costs");
    assert.equal(tick.agents["goblin-1"].cell, "cell-6-5", "straight away from the fox, and away from the crumb with it");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("with blendPreyDecision on, a prey takes a crumb that costs it no distance from the predator", async () => {
  const dir = await blendBoard("blend-on");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT, config: { ...CONFIG, blendPreyDecision: true } });
    assert.equal(tick.agents["goblin-1"].cell, "cell-5-4", "still three cells from the fox, now one from the crumb");
    assert.equal(tick.rungs["goblin-1"], "forage", "the step closed on the crumb, so that is what the rung says");
    assert.match(tick.agents["goblin-1"].goal, /foraging — heading for crumb-1 at cell-5-3/);
    assert.equal(tick.agents["goblin-1"].mood, "calm");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a blend weight of 1 reproduces the priority chain's own evade step, rung and goal line included", async () => {
  const blended = await blendBoard("blend-weight-one");
  const priority = await blendBoard("blend-weight-one-control");
  try {
    const withBlend = await runTownSquareTick(blended, { layout: LAYOUT, config: { ...CONFIG, blendPreyDecision: true, preyThreatWeight: 1 } });
    const withPriority = await runTownSquareTick(priority, { layout: LAYOUT });
    assert.equal(withBlend.rungs["goblin-1"], "evade");
    assert.deepEqual(townSquareTickPayload(withBlend), townSquareTickPayload(withPriority));
  } finally {
    await rm(blended, { recursive: true, force: true });
    await rm(priority, { recursive: true, force: true });
  }
});

test("a prey that believes no food at all evades identically whether or not the blend is on", async () => {
  const blended = await boardWith([
    classify("fox-1", "fox"), place("fox-1", "cell-2-5"), weigh("fox-1", 20),
    classify("goblin-1", "goblin"), place("goblin-1", "cell-5-5"), weigh("goblin-1", 8),
  ], "blend-no-food");
  const priority = await boardWith([
    classify("fox-1", "fox"), place("fox-1", "cell-2-5"), weigh("fox-1", 20),
    classify("goblin-1", "goblin"), place("goblin-1", "cell-5-5"), weigh("goblin-1", 8),
  ], "blend-no-food-control");
  try {
    const withBlend = await runTownSquareTick(blended, { layout: LAYOUT, config: { ...CONFIG, blendPreyDecision: true } });
    const withPriority = await runTownSquareTick(priority, { layout: LAYOUT });
    assert.equal(withBlend.rungs["goblin-1"], "evade");
    assert.deepEqual(townSquareTickPayload(withBlend), townSquareTickPayload(withPriority));
  } finally {
    await rm(blended, { recursive: true, force: true });
    await rm(priority, { recursive: true, force: true });
  }
});

test("the blend leaves the predator's own avoid rung alone — it is a prey-side score", async () => {
  const dir = await boardWith([
    classify("fox-1", "fox"), place("fox-1", "cell-5-5"), weigh("fox-1", 20),
    classify("fox-2", "fox"), place("fox-2", "cell-2-2"), weigh("fox-2", 20),
    classify("crumb-1", "crumb"), place("crumb-1", "cell-5-3"), weigh("crumb-1", 1),
  ], "blend-predator-untouched");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT, config: { ...CONFIG, blendPreyDecision: true } });
    assert.equal(tick.rungs["fox-1"], "avoid");
    assert.equal(tick.agents["fox-1"].cell, "cell-5-6", "first-wins tie order, exactly as with the blend off");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a config that never heard of preyThreatWeight still blends, at the shipped weight", async () => {
  const dir = await blendBoard("blend-missing-weight");
  try {
    const { preyThreatWeight, ...withoutWeight } = CONFIG;
    const tick = await runTownSquareTick(dir, { layout: LAYOUT, config: { ...withoutWeight, blendPreyDecision: true } });
    assert.equal(tick.agents["goblin-1"].cell, "cell-5-4", "an unset weight falls back to the default, never to NaN");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("foodVisionGated true (the default) hides a distant crumb from both the decision and the belief panel", async () => {
  const dir = await boardWith([
    classify("goblin-1", "goblin"), place("goblin-1", "cell-1-1"), weigh("goblin-1", 8),
    classify("crumb-1", "crumb"), place("crumb-1", "cell-10-10"), weigh("crumb-1", 1),
  ], "food-gated");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT, config: { ...CONFIG, foodVisionGated: true } });
    assert.equal(tick.rungs["goblin-1"], "wander", "the crumb sits well outside a prey's vision radius");
    assert.equal(tick.agents["goblin-1"].belief["crumb-1"], null, "the panel agrees: nothing believed");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("foodVisionGated false makes a distant crumb known to both the decision and the belief panel, in agreement", async () => {
  const dir = await boardWith([
    classify("goblin-1", "goblin"), place("goblin-1", "cell-1-1"), weigh("goblin-1", 8),
    classify("crumb-1", "crumb"), place("crumb-1", "cell-10-10"), weigh("crumb-1", 1),
  ], "food-omniscient");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT, config: { ...CONFIG, foodVisionGated: false } });
    assert.equal(tick.rungs["goblin-1"], "forage", "with the flag off, food is known however far away");
    assert.match(tick.agents["goblin-1"].goal, /foraging — heading for crumb-1 at cell-10-10/);
    assert.equal(tick.agents["goblin-1"].belief["crumb-1"], "cell-10-10", "the panel names the same cell the decision foraged toward");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("foodVisionGated false widens only the food entries in the belief panel, not a rival agent's", async () => {
  const dir = await boardWith([
    classify("fox-1", "fox"), place("fox-1", "cell-1-1"), weigh("fox-1", 20),
    classify("goblin-1", "goblin"), place("goblin-1", "cell-12-12"), weigh("goblin-1", 8),
    classify("crumb-1", "crumb"), place("crumb-1", "cell-12-1"), weigh("crumb-1", 1),
  ], "food-omniscient-selective");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT, config: { ...CONFIG, foodVisionGated: false } });
    assert.equal(tick.agents["fox-1"].belief["crumb-1"], "cell-12-1", "food is omniscient with the flag off");
    assert.equal(tick.agents["fox-1"].belief["goblin-1"], null, "a rival agent is still vision-gated — the flag is about food only");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the vision asymmetry opens a band where a predator has acquired something that cannot see it back", async () => {
  const dir = await boardWith([
    classify("fox-1", "fox"), place("fox-1", "cell-1-5"), weigh("fox-1", 20),
    classify("goblin-1", "goblin"), place("goblin-1", "cell-5-5"), weigh("goblin-1", 8),
  ], "band");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.equal(tick.rungs["fox-1"], "chase", "4 cells away, inside a predator's radius of 4");
    assert.equal(tick.rungs["goblin-1"], "wander", "and outside a prey's radius of 3");
    assert.equal(tick.agents["goblin-1"].belief["fox-1"], null, "belief says so too");
    assert.equal(tick.agents["fox-1"].belief["goblin-1"], "cell-5-5");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a told fact reaches belief, so a lie moves an animal that never looked", async () => {
  const dir = await boardWith([
    classify("goblin-1", "goblin"), place("goblin-1", "cell-2-2"), weigh("goblin-1", 8),
    classify("fox-1", "fox"), place("fox-1", "cell-11-11"), weigh("fox-1", 20),
  ], "told");
  try {
    const toldFacts = [{ subject: "fox-1", toAgent: "goblin-1", cell: "cell-1-1", turn: 1 }];
    const tick = await runTownSquareTick(dir, { layout: LAYOUT, toldFacts });
    assert.equal(tick.rungs["goblin-1"], "evade");
    assert.equal(tick.agents["goblin-1"].belief["fox-1"], "cell-1-1", "the believed cell is the told one, not the true one");
    assert.equal(tick.agents["goblin-1"].cell, "cell-2-3", "and it runs from where it was told the fox is");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a belief snapshot names every other live agent and item, sorted, and never the observer itself", async () => {
  const dir = await boardWith([
    classify("fox-1", "fox"), place("fox-1", "cell-2-2"), weigh("fox-1", 20),
    classify("goblin-1", "goblin"), place("goblin-1", "cell-9-9"), weigh("goblin-1", 8),
    classify("goblin-2", "goblin"), place("goblin-2", "cell-2-3"), weigh("goblin-2", 8),
    classify("crumb-1", "crumb"), place("crumb-1", "cell-12-12"), weigh("crumb-1", 1),
  ], "belief-keys");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.deepEqual(Object.keys(tick.agents["fox-1"].belief), ["crumb-1", "goblin-1", "goblin-2"]);
    assert.deepEqual(Object.keys(tick.agents["goblin-1"].belief), ["crumb-1", "fox-1", "goblin-2"]);
    assert.equal(tick.agents["fox-1"].belief["crumb-1"], null, "out of sight is nothing believed, never a guess");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- the ecology pass -----------------------------------------------------------------

// A prey in the open never gets caught: both move one cell a turn, and the
// prey moves second, so evade keeps the gap. A chase closes only where the
// board runs out — a corner, or a wall of buildings — which is why every catch
// test below backs the prey into one.
test("catch and eat are one step: a predator on a prey's cell takes it and gains its remaining mass", async () => {
  const dir = await boardWith([
    classify("fox-1", "fox"), place("fox-1", "cell-1-2"), weigh("fox-1", 20),
    classify("goblin-1", "goblin"), place("goblin-1", "cell-1-1"), weigh("goblin-1", 8),
  ], "eat-agent");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.equal(tick.rungs["goblin-1"], "evade");
    assert.deepEqual(tick.agents["fox-1"].plan, ["north"]);
    const eaten = tick.ecology.find((e) => e.type === "eat-agent");
    assert.deepEqual(eaten, { type: "eat-agent", predator: "fox-1", prey: "goblin-1", cell: "cell-1-1", massGained: 7.94 });
    assert.equal(tick.agents["goblin-1"], undefined, "off the board, with no stale goal left standing");
    assert.equal(tick.agents["fox-1"].mass, 27.86);
    assert.equal(tick.agents["fox-1"].mood, "happy");
    assert.match(tick.agents["fox-1"].goal, /just ate goblin-1/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a prey standing on two crumbs eats both", async () => {
  const dir = await boardWith([
    classify("goblin-1", "goblin"), place("goblin-1", "cell-5-5"), weigh("goblin-1", 8),
    classify("crumb-1", "crumb"), place("crumb-1", "cell-5-5"), weigh("crumb-1", 1),
    classify("crumb-2", "crumb"), place("crumb-2", "cell-5-5"), weigh("crumb-2", 1),
  ], "eat-two");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.deepEqual(tick.ecology.filter((e) => e.type === "eat-item").map((e) => e.item), ["crumb-1", "crumb-2"]);
    assert.equal(tick.agents["goblin-1"].mass, 9.94);
    assert.deepEqual(tick.items, {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("eat-agent runs before eat-item, so a prey taken this turn is never also credited with a crumb", async () => {
  const dir = await boardWith([
    classify("fox-1", "fox"), place("fox-1", "cell-1-2"), weigh("fox-1", 20),
    classify("goblin-1", "goblin"), place("goblin-1", "cell-1-1"), weigh("goblin-1", 8),
    classify("crumb-1", "crumb"), place("crumb-1", "cell-1-1"), weigh("crumb-1", 1),
  ], "order");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.deepEqual(tick.ecology.map((e) => e.type), ["eat-agent"]);
    assert.deepEqual(Object.keys(tick.items), ["crumb-1"], "the crumb is still there");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("whatever ate this turn survives it, because eating resolves before starving", async () => {
  const dir = await boardWith([
    classify("goblin-1", "goblin"), place("goblin-1", "cell-5-5"), weigh("goblin-1", 0.05),
    classify("crumb-1", "crumb"), place("crumb-1", "cell-5-5"), weigh("crumb-1", 1),
    classify("goblin-2", "goblin"), place("goblin-2", "cell-12-12"), weigh("goblin-2", 0.05),
  ], "starve");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.deepEqual(tick.ecology.map((e) => e.type), ["eat-item", "starve"]);
    assert.equal(tick.ecology.find((e) => e.type === "starve").agent, "goblin-2");
    assert.ok(tick.agents["goblin-1"], "the one that ate is alive");
    assert.equal(tick.agents["goblin-2"], undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("prey arrive on the perimeter minus prop cells, and food lands anywhere open", async () => {
  const dir = await boardWith([
    classify("fox-1", "fox"), place("fox-1", "cell-5-5"), weigh("fox-1", 20),
    { subject: "square@turn14", predicate: "mgx:turn-played", object: "14" },
    { subject: "fox-1@turn14", predicate: "mgx:currently-in", object: "cell-5-5" },
  ], "spawn");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.equal(tick.turn, 15, "turn 15 is a multiple of both intervals");
    assert.deepEqual(tick.ecology.map((e) => e.type), ["spawn-prey", "spawn-food"]);
    const arrival = tick.ecology.find((e) => e.type === "spawn-prey");
    const { x, y } = { x: Number(arrival.cell.split("-")[1]), y: Number(arrival.cell.split("-")[2]) };
    assert.ok(x === 1 || x === 12 || y === 1 || y === 12, `${arrival.cell} is not on the perimeter`);
    assert.equal(LAYOUT.props.some((p) => p.cell === arrival.cell), false);
    assert.equal(tick.agents[arrival.agent].goal, "just arrived — no goal yet.");
    assert.equal(tick.rungs[arrival.agent], undefined, "a prey that arrives during the pass makes no decision until the next turn");
    const food = tick.ecology.find((e) => e.type === "spawn-food");
    assert.ok(openCells(LAYOUT).includes(food.cell));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("both spawn caps are checked before a spawn, so a full board simply skips that turn's arrival", async () => {
  const prey = [];
  for (let i = 1; i <= 6; i += 1) {
    prey.push(classify(`goblin-${i}`, "goblin"), place(`goblin-${i}`, `cell-${i}-12`), weigh(`goblin-${i}`, 8));
  }
  const dir = await boardWith([
    ...prey,
    { subject: "square@turn4", predicate: "mgx:turn-played", object: "4" },
  ], "caps");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.equal(tick.turn, 5);
    assert.deepEqual(tick.ecology, [], "maxPreyPopulation is already met");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- the player's verb ----------------------------------------------------------------

test("placing food mints a morsel with player provenance, so \"who put that there?\" grounds", async () => {
  const dir = await boardWith([classify("fox-1", "fox"), place("fox-1", "cell-5-5"), weigh("fox-1", 20)], "place");
  try {
    const result = await placeFood(dir, { layout: LAYOUT, cell: "cell-3-4" });
    assert.equal(result.placed, true);
    assert.equal(result.item, "morsel-1");
    assert.equal(result.mass, CONFIG.placedFoodMass);
    const rows = readFactRows(await loadMemory(dir));
    const placedBy = rows.find((r) => r.subject === "morsel-1" && r.predicate === "mgx:placed-by");
    assert.equal(placedBy.object, "player");
    assert.match(placedBy.provenance, /^world:town-square:taught:turn1$/);
    const typed = rows.find((r) => r.subject === "morsel-1" && r.predicate === "rdf:type");
    assert.equal(typed.object, "morsel", "the class row keeps its bare subject — a stamped one names a subject nothing resolves");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a placement and the tick that resolves it share one turn, and the pass reports the placement first", async () => {
  const dir = await boardWith([
    classify("goblin-1", "goblin"), place("goblin-1", "cell-9-9"), weigh("goblin-1", 8),
  ], "place-tick");
  try {
    await placeFood(dir, { layout: LAYOUT, cell: "cell-2-2" });
    const tick = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.equal(tick.turn, 1, "the placement did not quietly consume a turn of its own");
    assert.deepEqual(tick.ecology[0], {
      type: "place-food", item: "morsel-1", kind: "morsel", cell: "cell-2-2", mass: 2, placedBy: "player",
    });
    assert.deepEqual(tick.items["morsel-1"], { kind: "morsel", cell: "cell-2-2" });
    const later = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.equal(later.ecology.some((e) => e.type === "place-food"), false, "reported once, on its own turn");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("dropping a morsel at a predator's feet is allowed — refusing it would delete the trap the design hangs on", async () => {
  const dir = await boardWith([classify("fox-1", "fox"), place("fox-1", "cell-5-5"), weigh("fox-1", 20)], "trap");
  try {
    const onTheFox = await placeFood(dir, { layout: LAYOUT, cell: "cell-5-5" });
    assert.equal(onTheFox.placed, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("placing food refuses with a reason, never silently", async () => {
  const dir = await boardWith([], "refuse");
  try {
    assert.match((await placeFood(dir, { layout: LAYOUT, cell: "over there" })).reason, /doesn't name a cell/);
    assert.match((await placeFood(dir, { layout: LAYOUT, cell: "cell-99-1" })).reason, /off the board/);
    assert.equal((await placeFood(dir, { layout: LAYOUT, cell: "cell-8-1" })).reason, "cell-8-1 is blocked.");
    assert.equal((await placeFood(dir, { layout: LAYOUT, cell: "cell-4-4" })).placed, true);
    assert.match((await placeFood(dir, { layout: LAYOUT, cell: "cell-4-4" })).reason, /already holds morsel-1/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("prey read player food and world food through the same class chain, so only distance separates them", async () => {
  const dir = await boardWith([
    classify("goblin-1", "goblin"), place("goblin-1", "cell-5-5"), weigh("goblin-1", 8),
  ], "same-food");
  try {
    await placeFood(dir, { layout: LAYOUT, cell: "cell-6-5" });
    const tick = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.equal(tick.rungs["goblin-1"], "forage");
    assert.equal(tick.ecology.some((e) => e.type === "eat-item" && e.item === "morsel-1"), true);
    assert.equal(tick.agents["goblin-1"].mass, 9.94, "placedFoodMass, not the crumb's own");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- the payload and the facts it comes from ------------------------------------------

test("the tick payload is the frozen shape, and the engine's own extras stay out of it", async () => {
  const dir = await boardWith([
    classify("fox-1", "fox"), place("fox-1", "cell-5-5"), weigh("fox-1", 20),
    classify("crumb-1", "crumb"), place("crumb-1", "cell-1-1"), weigh("crumb-1", 1),
  ], "payload");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.deepEqual(Object.keys(townSquareTickPayload(tick)), ["turn", "agents", "items", "ecology"]);
    assert.deepEqual(Object.keys(tick.agents["fox-1"]).sort(), ["belief", "cell", "facing", "goal", "mass", "mood", "plan", "role"]);
    assert.deepEqual(Object.keys(tick.items["crumb-1"]).sort(), ["cell", "kind"]);
    assert.equal(tick.agents["fox-1"].role, "predator");
    assert.ok(Object.keys(EXPRESSION_PALETTE).includes(tick.agents["fox-1"].mood));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("mass rounds at the payload boundary only, so the simulation never drifts on a rounded number", async () => {
  const dir = await boardWith([classify("goblin-1", "goblin"), place("goblin-1", "cell-5-5"), weigh("goblin-1", 8)], "round");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.equal(tick.agents["goblin-1"].mass, 7.94);
    const massRow = tick.writes.find((w) => w.predicate === "mgx:hasMass" && w.subject.startsWith("goblin-1@"));
    assert.equal(massRow.object, String(8 - CONFIG.preyMassDecrementPerTurn));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a turn writes mgx:hasMass, never spider-fly's unlisted mgx:mass", async () => {
  const dir = await boardWith([classify("goblin-1", "goblin"), place("goblin-1", "cell-5-5"), weigh("goblin-1", 8)], "predicate");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.equal(tick.writes.some((w) => w.predicate === "mgx:mass"), false);
    assert.ok(tick.writes.some((w) => w.predicate === "mgx:hasMass"));
    for (const write of tick.writes) assert.ok(isMudiiiStatePredicate(write.predicate), write.predicate);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an agent that held still keeps the facing it had, and one that never moved keeps the default", async () => {
  const dir = await boardWith([
    classify("fox-1", "fox"), place("fox-1", "cell-5-5"), weigh("fox-1", 20),
    { subject: "fox-1", predicate: "mgx:facing", object: "north" },
    classify("goblin-1", "goblin"), place("goblin-1", "cell-5-5"), weigh("goblin-1", 8),
  ], "facing");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.deepEqual(tick.agents["fox-1"].plan, [], "co-located already, so it holds");
    assert.equal(tick.agents["fox-1"].facing, "north");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a goal that names something this turn killed is scrubbed, including a third agent's", async () => {
  const dir = await boardWith([
    classify("fox-1", "fox"), place("fox-1", "cell-1-2"), weigh("fox-1", 20),
    classify("goblin-1", "goblin"), place("goblin-1", "cell-1-1"), weigh("goblin-1", 8),
    classify("goblin-2", "goblin"), place("goblin-2", "cell-9-9"), weigh("goblin-2", 8),
    classify("crumb-1", "crumb"), place("crumb-1", "cell-9-9"), weigh("crumb-1", 1),
  ], "scrub");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.match(tick.agents["fox-1"].goal, /just ate goblin-1/, "the eater's own line wins over the scrub");
    assert.match(tick.agents["goblin-2"].goal, /just ate crumb-1/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a run replays byte-identically into a second store", async () => {
  const facts = [
    classify("fox-1", "fox"), place("fox-1", "cell-2-9"), weigh("fox-1", 20),
    classify("goblin-1", "goblin"), place("goblin-1", "cell-7-4"), weigh("goblin-1", 8),
    classify("goblin-2", "goblin"), place("goblin-2", "cell-11-6"), weigh("goblin-2", 8),
  ];
  const a = await boardWith(facts, "replay-a");
  const b = await boardWith(facts, "replay-b");
  try {
    const runA = [];
    const runB = [];
    for (let i = 0; i < 6; i += 1) runA.push(townSquareTickPayload(await runTownSquareTick(a, { layout: LAYOUT })));
    for (let i = 0; i < 6; i += 1) runB.push(townSquareTickPayload(await runTownSquareTick(b, { layout: LAYOUT })));
    assert.deepEqual(runA, runB);
  } finally {
    await rm(a, { recursive: true, force: true });
    await rm(b, { recursive: true, force: true });
  }
});

test("a tick names the layout it runs, and refuses a name no pack holds", async () => {
  const dir = await boardWith([classify("fox-1", "fox"), place("fox-1", "cell-2-2"), weigh("fox-1", 20)], "byname");
  try {
    const tick = await runTownSquareTick(dir, { layout: "town-square" });
    assert.equal(tick.turn, 1);
    await assert.rejects(() => runTownSquareTick(dir, { layout: "no-such-square" }), /no such layout/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("pathStateKey collapses a search state onto its cell alone", () => {
  assert.equal(pathStateKey({ x: 3, y: 9 }), "cell-3-9");
});

test("the turn counter keeps advancing on a board with nothing alive left on it", async () => {
  const dir = await boardWith([classify("goblin-1", "goblin"), place("goblin-1", "cell-9-9"), weigh("goblin-1", 0.01)], "empty-board");
  try {
    const first = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.deepEqual(first.ecology.map((e) => e.type), ["starve"]);
    assert.deepEqual(first.agents, {}, "nothing left to write a mood for");
    const second = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.equal(second.turn, 2, "the turn marker is a row of its own, so an empty board still counts turns");
    const third = await runTownSquareTick(dir, { layout: LAYOUT });
    assert.equal(third.turn, 3);
    assert.deepEqual(third.ecology.map((e) => e.type), ["spawn-food"], "and a spawn interval still comes round");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- the visitor's own hand ---------------------------------------------------------
// A press reaches the world through the same tick as everything else, so a
// driven agent is one more decision inside a turn the whole board still takes.

async function boardOnLayout(lay, facts, label) {
  const dir = await mkdtemp(join(tmpdir(), `tmct-mudiii-${label}-`));
  const provenance = `world:${lay.name}`;
  await appendFacts(dir, [...worldFactRows(lay)].map((f) => ({
    subject: f.subject, predicate: f.predicate, object: f.object, provenance,
  })));
  if (facts.length) await appendFacts(dir, facts.map((f) => ({ ...f, provenance })));
  return dir;
}

const wall = (id, cell) => ({ id, model: "house-1", cell, rotation: "0" });

// Two three-by-three boards built to pin one thing each: an agent that cannot
// step at all, and one with exactly one way out.
const WALLED_IN = {
  name: "town-square-walled-in", gridSize: 3, opening: "walled in on all four sides",
  cast: { predators: 1, prey: 0 },
  props: [wall("house-1", "cell-2-1"), wall("house-2", "cell-1-2"), wall("house-3", "cell-3-2"), wall("house-4", "cell-2-3")],
};
const ONE_WAY_OUT = {
  ...WALLED_IN, name: "town-square-one-way-out", opening: "one way out, east",
  props: [wall("house-1", "cell-2-1"), wall("house-2", "cell-1-2"), wall("house-3", "cell-2-3")],
};
// No arrivals on the small boards: a spawn would put a second agent on a
// three-by-three square and change what the one under test can see.
const NO_ARRIVALS = { ...CONFIG, preySpawnIntervalTurns: 0, foodSpawnIntervalTurns: 0 };

test("a hand-driven step leaves the same rows behind as a move the planner chose", async () => {
  const facts = [classify("fox-1", "fox"), place("fox-1", "cell-5-5"), weigh("fox-1", 20)];
  const driven = await boardWith(facts, "driven-step");
  const planned = await boardWith(facts, "driven-step-control");
  try {
    const tick = await runTownSquareTick(driven, { layout: LAYOUT, manualMoves: { "fox-1": "cell-4-5" } });
    assert.equal(tick.rungs["fox-1"], "driven");
    assert.equal(tick.agents["fox-1"].cell, "cell-4-5");
    assert.deepEqual(tick.agents["fox-1"].plan, ["west"]);
    assert.equal(tick.agents["fox-1"].facing, "west");
    assert.equal(tick.agents["fox-1"].mood, "calm");
    assert.match(tick.agents["fox-1"].goal, /driven by hand — stepping to cell-4-5/);

    const ownRow = (t, predicate) => t.writes.filter((w) => w.subject === "fox-1@turn1" && w.predicate === predicate).map((w) => w.object);
    assert.deepEqual(ownRow(tick, "mgx:currently-in"), ["cell-4-5"]);
    assert.deepEqual(ownRow(tick, "mgx:facing"), ["west"]);
    assert.deepEqual(ownRow(tick, "mgx:driven-facing"), ["west"], "and the record that a hand chose it");

    const control = await runTownSquareTick(planned, { layout: LAYOUT });
    const rowShape = (t) => t.writes.filter((w) => w.subject.startsWith("fox-1@")).map((w) => w.predicate).sort();
    assert.deepEqual(
      rowShape(tick).filter((p) => p !== "mgx:driven-facing"),
      rowShape(control),
      "one fact path: a driven turn writes the predicates a planned turn writes, plus the hand's own record",
    );
  } finally {
    await rm(driven, { recursive: true, force: true });
    await rm(planned, { recursive: true, force: true });
  }
});

test("a hand-driven move into a building is refused, and that agent still takes its own turn", async () => {
  const dir = await boardWith([
    classify("fox-1", "fox"), place("fox-1", "cell-7-1"), weigh("fox-1", 20),
    classify("goblin-1", "goblin"), place("goblin-1", "cell-5-1"), weigh("goblin-1", 8),
  ], "driven-refused");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT, manualMoves: { "fox-1": "cell-8-1" } });
    assert.equal(tick.rungs["fox-1"], "chase", "house-1 stands on cell-8-1, so the press is no move at all");
    assert.equal(tick.agents["fox-1"].cell, "cell-6-1", "and the fox spends the turn on its own chase");
    assert.equal(tick.agents["fox-1"].facing, "west");
    assert.equal(tick.writes.some((w) => w.predicate === "mgx:driven-facing"), false, "a refused press records no hand turn");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a hand-driven agent spends one shared turn — every other agent still decides and moves in the same call", async () => {
  const facts = [
    classify("fox-1", "fox"), place("fox-1", "cell-2-2"), weigh("fox-1", 20),
    classify("goblin-1", "goblin"), place("goblin-1", "cell-10-10"), weigh("goblin-1", 8),
    classify("crumb-1", "crumb"), place("crumb-1", "cell-10-8"), weigh("crumb-1", 1),
    classify("goblin-2", "goblin"), place("goblin-2", "cell-11-4"), weigh("goblin-2", 8),
    classify("crumb-2", "crumb"), place("crumb-2", "cell-9-4"), weigh("crumb-2", 1),
  ];
  const driven = await boardWith(facts, "driven-others");
  const untouched = await boardWith(facts, "driven-others-control");
  try {
    const tick = await runTownSquareTick(driven, { layout: LAYOUT, manualMoves: { "fox-1": "cell-3-2" } });
    assert.equal(tick.rungs["fox-1"], "driven");
    assert.equal(tick.rungs["goblin-1"], "forage");
    assert.equal(tick.rungs["goblin-2"], "forage");
    assert.equal(tick.agents["goblin-1"].cell, "cell-10-9", "one step toward its crumb, in the very call that drove the fox");
    assert.equal(tick.agents["goblin-2"].cell, "cell-10-4");
    assert.ok(tick.agents["goblin-1"].mass < 8, "the ecology pass ran for the whole board, not for the driven agent alone");
    assert.ok(tick.agents["goblin-2"].mass < 8);

    const control = await runTownSquareTick(untouched, { layout: LAYOUT });
    assert.deepEqual(tick.agents["goblin-1"], control.agents["goblin-1"], "a hand on the fox changes nothing about a goblin's own turn");
    assert.deepEqual(tick.agents["goblin-2"], control.agents["goblin-2"]);
  } finally {
    await rm(driven, { recursive: true, force: true });
    await rm(untouched, { recursive: true, force: true });
  }
});

test("a hand-driven turn holds its facing while the agent stands still, and loses it to the agent's own next step", async () => {
  const still = await boardOnLayout(WALLED_IN, [
    classify("fox-1", "fox"), place("fox-1", "cell-2-2"), weigh("fox-1", 20),
  ], "driven-facing-held");
  try {
    const turned = await runTownSquareTick(still, { layout: WALLED_IN, config: NO_ARRIVALS, manualMoves: { "fox-1": { facing: "east" } } });
    assert.equal(turned.rungs["fox-1"], "driven");
    assert.equal(turned.agents["fox-1"].cell, "cell-2-2", "a turn on the spot is a hold");
    assert.equal(turned.agents["fox-1"].facing, "east");
    assert.match(turned.agents["fox-1"].goal, /driven by hand — holding at cell-2-2, facing east/);
    assert.ok(turned.writes.some((w) => w.subject === "fox-1@turn1" && w.predicate === "mgx:driven-facing" && w.object === "east"));

    const later = await runTownSquareTick(still, { layout: WALLED_IN, config: NO_ARRIVALS });
    assert.deepEqual(later.agents["fox-1"].plan, [], "walled in on all four sides, it takes no step of its own");
    assert.equal(later.agents["fox-1"].facing, "east", "so the facing the hand chose still stands");
  } finally {
    await rm(still, { recursive: true, force: true });
  }

  const walking = await boardOnLayout(ONE_WAY_OUT, [
    classify("fox-1", "fox"), place("fox-1", "cell-2-2"), weigh("fox-1", 20),
    classify("goblin-1", "goblin"), place("goblin-1", "cell-3-2"), weigh("goblin-1", 8),
  ], "driven-facing-replaced");
  try {
    const turned = await runTownSquareTick(walking, { layout: ONE_WAY_OUT, config: NO_ARRIVALS, manualMoves: { "fox-1": { facing: "north" } } });
    assert.equal(turned.agents["fox-1"].facing, "north");
    const stepped = await runTownSquareTick(walking, { layout: ONE_WAY_OUT, config: NO_ARRIVALS });
    assert.equal(stepped.agents["fox-1"].plan[0], "east", "the one way out");
    assert.equal(stepped.agents["fox-1"].facing, "east", "the planner's own step replaces the hand's facing");
    const state = foldTownSquareState(readFactRows(await loadMemory(walking)));
    assert.deepEqual(state.facing.get("fox-1"), { value: "east", turn: 2, epoch: 0 }, "and the store agrees — the hand's row is outranked, not merely ignored");
  } finally {
    await rm(walking, { recursive: true, force: true });
  }
});

test("a tick nobody touched is byte-identical to one that never heard of manualMoves", async () => {
  const facts = [
    classify("fox-1", "fox"), place("fox-1", "cell-2-9"), weigh("fox-1", 20),
    classify("goblin-1", "goblin"), place("goblin-1", "cell-7-4"), weigh("goblin-1", 8),
  ];
  const withOption = await boardWith(facts, "driven-empty");
  const without = await boardWith(facts, "driven-none");
  try {
    const runA = [];
    const runB = [];
    for (let i = 0; i < 4; i += 1) runA.push(townSquareTickPayload(await runTownSquareTick(withOption, { layout: LAYOUT, manualMoves: {} })));
    for (let i = 0; i < 4; i += 1) runB.push(townSquareTickPayload(await runTownSquareTick(without, { layout: LAYOUT })));
    assert.deepEqual(runA, runB);
  } finally {
    await rm(withOption, { recursive: true, force: true });
    await rm(without, { recursive: true, force: true });
  }
});

// ---- the opt-in mechanics --------------------------------------------------------
// Carrying, webs and eggs are off unless a config names them, so every test
// above this line runs the board the town square has always run. These use a
// layout with an always-on web block and a config that turns all three on.

const WEB_LAYOUT = {
  ...LAYOUT,
  boardNoun: "board",
  webHomeCell: cellId(2, 2),
  staticWebAt: (x, y) => x === 2 && y === 2,
};
const CARRY_CONFIG = {
  ...CONFIG,
  carryPreyToWeb: true,
  buildWebs: true,
  layEggs: true,
  webDurationTurns: 10,
  eggLayMassThreshold: 25,
  eggHatchDelayTurns: 3,
  eggHatchCount: 2,
  minHatchlingMass: 3,
};

const carries = (predatorId, preyId) => ({ subject: predatorId, predicate: "mgx:carrying", object: preyId });

test("hasActiveWebAt reads the layout's own block and any unexpired built web, and nothing else", () => {
  const state = { webs: new Map([["web-1", { cell: cellId(7, 7), builtAtTurn: 4 }]]) };
  assert.equal(hasActiveWebAt(WEB_LAYOUT, state, 5, 2, 2, 10), true, "the static block never expires");
  assert.equal(hasActiveWebAt(WEB_LAYOUT, state, 5, 7, 7, 10), true);
  assert.equal(hasActiveWebAt(WEB_LAYOUT, state, 13, 7, 7, 10), true, "built at 4, live through turn 13");
  assert.equal(hasActiveWebAt(WEB_LAYOUT, state, 14, 7, 7, 10), false);
  assert.equal(hasActiveWebAt(LAYOUT, { webs: new Map() }, 5, 2, 2, 10), false, "a layout with no block and no webs is bare");
  assert.deepEqual(
    liveWebs(state.webs, 5, 10),
    [{ id: "web-1", cell: cellId(7, 7), builtAtTurn: 4, expiresAtTurn: 14 }],
  );
  assert.deepEqual(liveWebs(state.webs, 14, 10), [], "an expired web is off the renderer's list too");
});

test("a carrying predator hauls its catch toward the web, and the prey rides along", async () => {
  const dir = await boardWith([
    classify("fox-1", "fox"), place("fox-1", "cell-6-6"), weigh("fox-1", 20), carries("fox-1", "goblin-1"),
    classify("goblin-1", "goblin"), place("goblin-1", "cell-6-6"), weigh("goblin-1", 8),
  ], "carry-transit");
  try {
    const tick = await runTownSquareTick(dir, { layout: WEB_LAYOUT, config: CARRY_CONFIG });
    assert.equal(tick.rungs["fox-1"], "carry");
    assert.equal(tick.rungs["goblin-1"], "carried");
    assert.equal(tick.agents["fox-1"].cell, tick.agents["goblin-1"].cell, "the prey is wherever its captor ended up");
    assert.notEqual(tick.agents["fox-1"].cell, "cell-6-6", "and the captor moved toward the web");
    assert.equal(tick.agents["fox-1"].goal, "carrying goblin-1 toward the web.");
    assert.equal(tick.agents["goblin-1"].goal, "being carried by fox-1.");
    assert.deepEqual(tick.ecology, [], "a catch already made is not re-announced, and no eat happens outside a web");
    assert.ok(tick.writes.some((w) => w.predicate === "mgx:carrying" && w.object === "goblin-1"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a catch made in a web is eaten the same turn, and the count goes on record", async () => {
  const dir = await boardWith([
    classify("fox-1", "fox"), place("fox-1", "cell-2-2"), weigh("fox-1", 10),
    classify("goblin-1", "goblin"), place("goblin-1", "cell-2-2"), weigh("goblin-1", 8),
  ], "carry-in-web");
  try {
    const tick = await runTownSquareTick(dir, { layout: WEB_LAYOUT, config: CARRY_CONFIG });
    assert.deepEqual(tick.ecology.map((e) => e.type), ["catch-prey", "eat-agent"]);
    assert.equal(tick.rungs["goblin-1"], "trapped", "a prey standing in a web cannot flee it");
    assert.equal(tick.agents["fox-1"].goal, "just ate goblin-1 in the web.");
    assert.ok(tick.writes.some((w) => w.predicate === "mgx:prey-eaten" && w.object === "1"));
    assert.ok(tick.writes.some((w) => w.predicate === "mgx:carrying" && w.object === "none"), "and the claim is released");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the same trapped pair with only the carrying flag off eats in one step, with no catch and no claim", async () => {
  const dir = await boardWith([
    classify("fox-1", "fox"), place("fox-1", "cell-2-2"), weigh("fox-1", 10),
    classify("goblin-1", "goblin"), place("goblin-1", "cell-2-2"), weigh("goblin-1", 8),
  ], "carry-off");
  try {
    const tick = await runTownSquareTick(dir, { layout: WEB_LAYOUT, config: { ...CARRY_CONFIG, carryPreyToWeb: false } });
    assert.deepEqual(tick.ecology.map((e) => e.type), ["eat-agent"], "co-location alone takes the prey");
    assert.equal(tick.agents["goblin-1"], undefined);
    assert.equal(tick.writes.some((w) => w.predicate === "mgx:carrying"), false);
    assert.equal(tick.agents["fox-1"].goal, "just ate goblin-1.", "and the line says nothing about a web");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a web-spinning predator with nothing in sight holds its cell and spins one", async () => {
  const dir = await boardWith([classify("fox-1", "fox"), place("fox-1", "cell-6-6"), weigh("fox-1", 20)], "build-web");
  try {
    const first = await runTownSquareTick(dir, { layout: WEB_LAYOUT, config: CARRY_CONFIG });
    assert.equal(first.rungs["fox-1"], "build-web");
    assert.equal(first.agents["fox-1"].cell, "cell-6-6", "spinning a web means staying put");
    assert.equal(first.agents["fox-1"].goal, "nothing in sight — building a web here.");
    assert.deepEqual(first.activeWebs, [{ id: "web-1", cell: "cell-6-6", builtAtTurn: 1, expiresAtTurn: 11 }]);

    const second = await runTownSquareTick(dir, { layout: WEB_LAYOUT, config: CARRY_CONFIG });
    assert.equal(second.rungs["fox-1"], "hold-web", "a live web already covers this cell");
    assert.equal(second.agents["fox-1"].goal, "nothing in sight — holding position in the web.");
    assert.equal(second.activeWebs.length, 1, "and no second web is spun on top of it");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("without the web flag the same lone predator wanders, and names its layout's own board noun", async () => {
  const dir = await boardWith([classify("fox-1", "fox"), place("fox-1", "cell-6-6"), weigh("fox-1", 20)], "no-web");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT, config: CONFIG });
    assert.equal(tick.rungs["fox-1"], "wander");
    assert.equal(tick.agents["fox-1"].goal, "nothing in sight — wandering the square.");
    assert.equal(tick.writes.some((w) => w.predicate === "mgx:web-built-at-turn"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a predator in a web lays an egg once its mass crosses the threshold, and the egg hatches on time", async () => {
  const dir = await boardWith([classify("fox-1", "fox"), place("fox-1", "cell-2-2"), weigh("fox-1", 25.08)], "lay-hatch");
  try {
    const first = await runTownSquareTick(dir, { layout: WEB_LAYOUT, config: CARRY_CONFIG });
    const laid = first.ecology.find((e) => e.type === "lay-egg");
    assert.deepEqual(laid, { type: "lay-egg", agent: "fox-1", egg: "egg-1", cell: "cell-2-2", mass: 5 });
    assert.equal(first.agents["fox-1"].mass, CARRY_CONFIG.predatorInitialMass, "the layer resets to its own starting mass");

    await runTownSquareTick(dir, { layout: WEB_LAYOUT, config: CARRY_CONFIG });
    const third = await runTownSquareTick(dir, { layout: WEB_LAYOUT, config: CARRY_CONFIG });
    assert.equal(third.ecology.some((e) => e.type === "hatch-egg"), false, "three turns after laying, not two");

    const fourth = await runTownSquareTick(dir, { layout: WEB_LAYOUT, config: CARRY_CONFIG });
    const hatch = fourth.ecology.find((e) => e.type === "hatch-egg");
    assert.deepEqual(hatch, {
      type: "hatch-egg", egg: "egg-1", cell: "cell-2-2",
      hatchlings: [{ id: "fox-2", mass: 5 }],
    }, "a 5-mass egg makes one viable hatchling rather than two starved ones");
    assert.equal(fourth.agents["fox-2"].goal, "just hatched — no goal yet.");
    assert.ok(fourth.writes.some((w) => w.predicate === "mgx:hatched-into" && w.object === "fox-2"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the town square's own config asks for none of it, so a plain turn writes none of the opt-in rows", async () => {
  const dir = await boardWith([
    classify("fox-1", "fox"), place("fox-1", "cell-2-2"), weigh("fox-1", 99),
    classify("goblin-1", "goblin"), place("goblin-1", "cell-9-9"), weigh("goblin-1", 8),
  ], "no-opt-in");
  try {
    const tick = await runTownSquareTick(dir, { layout: LAYOUT, config: CONFIG });
    const optIn = ["mgx:carrying", "mgx:prey-eaten", "mgx:web-built-at-turn", "mgx:laid-at-turn", "mgx:hatched-into"];
    for (const predicate of optIn) {
      assert.equal(tick.writes.some((w) => w.predicate === predicate), false, predicate);
      assert.ok(isMudiiiStatePredicate(predicate), `${predicate} still syncs for a cast that does write it`);
    }
    assert.equal(tick.ecology.some((e) => ["catch-prey", "lay-egg", "hatch-egg"].includes(e.type)), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
