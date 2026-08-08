import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CAST_KINDS, DEFAULT_FACING, DEFAULT_GRID_SIZE, DIRECTION_DELTA, FOOD_KINDS, PROP_KINDS,
  SEED_TAXONOMY, TOWN_SQUARE_LAYOUTS, WORLD_NAMES,
  agentKindOf, cellId, chebyshevDistance, inBounds, isFoodId, isLiveRenderableAgent, isPropId,
  isSolid, layoutNamed, liveIdsOfKind, oneStepDirectionBetween, openCells, parseCellId,
  perimeterCells, propFactRows, solidCells, structuralFactRows, visibleCells,
  worldFactRows, worldMetaRow, worldRuleRows,
} from "../../src/domain/town-square-world.mjs";
import { MUDIII_ROLES, gridApplyActions, pathStateKey } from "../../src/services/predator-prey.mjs";
import { findReachableSet } from "../../src/domain/planning.mjs";
import { objectClassChain } from "../../src/services/adventure.mjs";
import { isWorldFactRow, isWorldMetaRow, isWorldRuleRow } from "../../src/domain/worlds-pack.mjs";
import { DEFAULT_GAME_CONFIG } from "../../src/domain/game-config.mjs";
import { worldSourceText } from "../../scripts/gen-town-square-worlds.mjs";

const REPO_ROOT = join(fileURLToPath(import.meta.url), "..", "..", "..");
const FIXTURE = JSON.parse(readFileSync(join(REPO_ROOT, "test", "fixtures", "mudiii-ticks.json"), "utf8"));
const ASSETS = JSON.parse(readFileSync(join(REPO_ROOT, "data", "mudiii-assets.json"), "utf8"));
const ASSET_KEYS = new Set(ASSETS.assets.map((a) => a.key));

const LAYOUTS = WORLD_NAMES.map((name) => TOWN_SQUARE_LAYOUTS[name]);
// scripts/build-worlds-pack.mjs's own budget. Raw source is the tight side of
// the two — the gzipped shard compresses a grid of near-identical rows to a
// fraction of it — so the assert that has to fail at authoring time is this one.
const SOURCE_BYTES_BUDGET = 128 * 1024;

// ---- geometry, sized per layout rather than per module -------------------------

test("cell ids round-trip and Chebyshev distance ignores which axis the gap is on", () => {
  assert.equal(cellId(3, 9), "cell-3-9");
  assert.deepEqual(parseCellId("cell-3-9"), { x: 3, y: 9 });
  assert.equal(parseCellId("cell-3"), null);
  assert.equal(parseCellId(""), null);
  assert.equal(chebyshevDistance(1, 1, 4, 3), 3);
  assert.equal(chebyshevDistance(4, 3, 1, 1), 3);
});

test("inBounds and visibleCells take the board size as an argument, so a 14x14 layout is not clipped to a 12x12 one", () => {
  assert.equal(inBounds(12, 12, 12), true);
  assert.equal(inBounds(12, 13, 12), false);
  assert.equal(inBounds(14, 13, 14), true, "the chapel board reaches past 12 and nothing here says otherwise");
  assert.ok(visibleCells(14, 13, 13, 2).includes("cell-14-14"));
  assert.equal(visibleCells(12, 13, 13, 2).includes("cell-14-14"), false, "clipping follows the size it was handed");
  assert.deepEqual(visibleCells(12, 1, 1, 1), ["cell-1-1", "cell-2-1", "cell-1-2", "cell-2-2"], "raster order, clipped at the corner");
});

test("oneStepDirectionBetween names only a true cardinal neighbour", () => {
  assert.equal(oneStepDirectionBetween({ x: 3, y: 3 }, { x: 3, y: 2 }), "north");
  assert.equal(oneStepDirectionBetween({ x: 3, y: 3 }, { x: 4, y: 3 }), "east");
  assert.equal(oneStepDirectionBetween({ x: 3, y: 3 }, { x: 3, y: 3 }), null, "the same cell is no direction");
  assert.equal(oneStepDirectionBetween({ x: 3, y: 3 }, { x: 4, y: 4 }), null, "a diagonal is no direction");
  assert.equal(oneStepDirectionBetween({ x: 3, y: 3 }, { x: 5, y: 3 }), null, "two cells away is no direction");
});

test("the direction key order is the one every search tie-breaks on", () => {
  assert.deepEqual(Object.keys(DIRECTION_DELTA), ["north", "south", "east", "west"]);
});

// ---- the three layouts ----------------------------------------------------------

test("three layouts ship, at three sizes, with the headline square first", () => {
  assert.deepEqual(WORLD_NAMES, ["town-square", "town-square-market", "town-square-chapel"]);
  assert.deepEqual(LAYOUTS.map((l) => l.gridSize), [12, 10, 14]);
  assert.equal(TOWN_SQUARE_LAYOUTS["town-square"].gridSize, DEFAULT_GRID_SIZE);
  assert.equal(layoutNamed("town-square-chapel").gridSize, 14);
  assert.equal(layoutNamed("no-such-square"), null, "an unknown name gets nothing, never the headline square wearing it");
});

test("the chapel is the only layout with two predators, so it is the only shipped home for the avoid branch", () => {
  assert.deepEqual(
    Object.fromEntries(LAYOUTS.map((l) => [l.name, l.cast])),
    {
      "town-square": { predators: 1, prey: 3 },
      "town-square-market": { predators: 1, prey: 4 },
      "town-square-chapel": { predators: 2, prey: 2 },
    },
  );
});

test("the headline layout's prop table is exactly the frozen fixture's", () => {
  assert.deepEqual(
    TOWN_SQUARE_LAYOUTS["town-square"].props.map((p) => ({ id: p.id, model: p.model, cell: p.cell, rotation: p.rotation })),
    FIXTURE.props,
    "the recorded ticks are a seeded run over this board — moving a prop moves every cell in the fixture",
  );
});

test("every prop id names a known prop kind and stands on its own cell", () => {
  for (const lay of LAYOUTS) {
    const cells = new Set();
    for (const prop of lay.props) {
      assert.ok(isPropId(prop.id), `${lay.name}: ${prop.id} is not a prop id`);
      assert.ok(PROP_KINDS.includes(agentKindOf(prop.id)), `${lay.name}: ${prop.id}`);
      assert.equal(cells.has(prop.cell), false, `${lay.name}: two props stand on ${prop.cell}`);
      cells.add(prop.cell);
      const at = parseCellId(prop.cell);
      assert.ok(at && inBounds(lay.gridSize, at.x, at.y), `${lay.name}: ${prop.id} stands off the board at ${prop.cell}`);
      assert.match(prop.rotation, /^(0|90|180|270)$/, `${lay.name}: ${prop.id} rotation`);
    }
  }
});

test("every model key the market and chapel layouts name is a row in the checked asset allowlist", () => {
  for (const name of ["town-square-market", "town-square-chapel"]) {
    for (const prop of TOWN_SQUARE_LAYOUTS[name].props) {
      assert.ok(ASSET_KEYS.has(prop.model), `${name}: ${prop.id} names model "${prop.model}", which data/mudiii-assets.json does not list`);
    }
  }
});

test("solidCells, openCells and isSolid agree, and no open cell holds a prop", () => {
  for (const lay of LAYOUTS) {
    const solid = solidCells(lay);
    const open = openCells(lay);
    assert.equal(solid.size, lay.props.length);
    assert.equal(open.length, lay.gridSize * lay.gridSize - lay.props.length);
    for (const cell of open) assert.equal(isSolid(lay, cell), false);
    for (const cell of solid) assert.equal(open.includes(cell), false);
    assert.equal(isSolid(lay, lay.props[0].cell), true);
  }
});

test("perimeterCells drops the prop cells, which matters because the headline layout has buildings on two whole edges", () => {
  const lay = TOWN_SQUARE_LAYOUTS["town-square"];
  const edge = perimeterCells(lay);
  assert.equal(edge.includes("cell-8-1"), false, "house-1 sits on the north edge");
  assert.equal(edge.includes("cell-1-1"), true);
  for (const cell of edge) {
    const { x, y } = parseCellId(cell);
    assert.ok(x === 1 || x === lay.gridSize || y === 1 || y === lay.gridSize, `${cell} is not on the edge`);
    assert.equal(isSolid(lay, cell), false);
  }
});

// ---- the fact rows --------------------------------------------------------------

test("every generated row passes the worlds-pack validator and carries its own layout name", () => {
  for (const lay of LAYOUTS) {
    assert.ok(isWorldMetaRow(worldMetaRow(lay)));
    const rules = [...worldRuleRows(lay)];
    assert.ok(rules.length > 0 && rules.every(isWorldRuleRow));
    for (const row of worldFactRows(lay)) {
      assert.ok(isWorldFactRow(row), `${lay.name}: ${JSON.stringify(row)}`);
      assert.equal(row.world, lay.name);
    }
  }
});

test("every in-bounds cell is typed, solid ones included, so \"what is at cell-8-1?\" grounds instead of missing on an undeclared individual", () => {
  for (const lay of LAYOUTS) {
    const typed = new Set([...worldFactRows(lay)]
      .filter((r) => r.predicate === "rdf:type" && r.object === "cell")
      .map((r) => r.subject));
    assert.equal(typed.size, lay.gridSize * lay.gridSize, `${lay.name}`);
    for (const prop of lay.props) assert.ok(typed.has(prop.cell), `${lay.name}: ${prop.cell} is undeclared`);
  }
});

test("a prop's cell has no exit out and no exit in, and the omission is symmetric by construction", () => {
  for (const lay of LAYOUTS) {
    const solid = solidCells(lay);
    const exits = [...worldFactRows(lay)].filter((r) => /^mgx:has-exit-/.test(r.predicate));
    for (const row of exits) {
      assert.equal(solid.has(row.subject), false, `${lay.name}: ${row.subject} is solid and still has an exit`);
      assert.equal(solid.has(row.object), false, `${lay.name}: an exit leads into the solid cell ${row.object}`);
    }
    const edge = new Set(exits.map((r) => `${r.subject}>${r.object}`));
    for (const row of exits) {
      assert.ok(edge.has(`${row.object}>${row.subject}`), `${lay.name}: ${row.subject} -> ${row.object} is one-way`);
    }
  }
});

test("the open board is one connected component on every layout — a sealed courtyard is a live bug that reads as a broken page", () => {
  for (const lay of LAYOUTS) {
    const applyActions = gridApplyActions([...worldFactRows(lay)]);
    const open = openCells(lay);
    const start = parseCellId(open[0]);
    const reached = new Set([open[0], ...findReachableSet(start, applyActions, { maxDepth: 400, stateKey: pathStateKey }).map((r) => cellId(r.node.x, r.node.y))]);
    assert.equal(reached.size, open.length, `${lay.name}: ${open.length - reached.size} open cell(s) are walled off`);
  }
});

test("prop facts are four rows apiece and every object is a string term", () => {
  for (const lay of LAYOUTS) {
    const rows = [...propFactRows(lay)];
    assert.equal(rows.length, lay.props.length * 4);
    for (const row of rows) assert.equal(typeof row.object, "string", JSON.stringify(row));
    const forStall = rows.filter((r) => r.subject === lay.props[0].id);
    assert.deepEqual(forStall.map((r) => r.predicate), ["rdf:type", "mgx:currently-in", "mgx:model", "mgx:rotation"]);
    assert.equal(forStall[0].object, "prop");
  }
});

test("the headline layout's prop rows are exactly the fixture's propFacts", () => {
  const rows = [...propFactRows(TOWN_SQUARE_LAYOUTS["town-square"])]
    .map(({ subject, predicate, object }) => ({ subject, predicate, object }));
  assert.deepEqual(rows, FIXTURE.propFacts);
});

test("the seed taxonomy carries both food kinds up to food, which is the forage read's actual precondition", () => {
  const lay = TOWN_SQUARE_LAYOUTS["town-square"];
  const rows = [
    ...worldFactRows(lay),
    { subject: "crumb-1", predicate: "rdf:type", object: "crumb" },
    { subject: "morsel-1", predicate: "rdf:type", object: "morsel" },
  ];
  assert.ok(objectClassChain(rows, "crumb-1").includes("food"), "a world crumb reads as food");
  assert.ok(objectClassChain(rows, "morsel-1").includes("food"), "player food reads as food too, so only distance separates them");
  assert.ok(objectClassChain(rows, "crumb-1").includes("thing"));
});

test("the cast's own classes reach animal, and the world module and the engine name the same cast", () => {
  const lay = TOWN_SQUARE_LAYOUTS["town-square"];
  const rows = [
    ...worldFactRows(lay),
    { subject: "fox-1", predicate: "rdf:type", object: CAST_KINDS.predator },
    { subject: "goblin-1", predicate: "rdf:type", object: CAST_KINDS.prey },
  ];
  assert.ok(objectClassChain(rows, "fox-1").includes("canine"));
  assert.ok(objectClassChain(rows, "fox-1").includes("animal"));
  assert.ok(objectClassChain(rows, "goblin-1").includes("creature"));
  assert.ok(objectClassChain(rows, "goblin-1").includes("animal"));
  assert.equal(CAST_KINDS.predator, MUDIII_ROLES.predator.kind);
  assert.equal(CAST_KINDS.prey, MUDIII_ROLES.prey.kind);
  assert.equal(CAST_KINDS.spawnedFood, MUDIII_ROLES.food.spawnedKind);
  assert.equal(CAST_KINDS.placedFood, MUDIII_ROLES.food.placedKind);
  assert.deepEqual([...FOOD_KINDS].sort(), ["crumb", "morsel"]);
  assert.deepEqual(SEED_TAXONOMY.map(([a]) => a).filter((c) => c === "fox").length, 1);
});

test("structural facts quote the shipped numbers: trait rows for the cast, \"by default\" only where config still decides", () => {
  const knobs = DEFAULT_GAME_CONFIG.mudiii;
  const rows = [...structuralFactRows(TOWN_SQUARE_LAYOUTS["town-square"])];
  const objectsFor = (subject, predicate) => rows.filter((r) => r.subject === subject && r.predicate === predicate).map((r) => r.object);
  assert.deepEqual(objectsFor("board", "mgx:hasA"), ["12 rows", "12 columns", "144 cells"]);
  assert.deepEqual(objectsFor("fox", "mgx:hasMass"), [String(knobs.predatorInitialMass)]);
  assert.deepEqual(objectsFor("fox", "mgx:vision-radius"), [String(knobs.predatorVisionRadius)]);
  assert.deepEqual(objectsFor("fox", "mgx:pursues"), ["goblin"]);
  assert.deepEqual(objectsFor("fox", "mgx:consumes"), ["goblin"]);
  assert.deepEqual(objectsFor("goblin", "mgx:mass-drain-per-turn"), [String(knobs.preyMassDecrementPerTurn)]);
  assert.deepEqual(objectsFor("goblin", "mgx:consumes"), ["crumb", "morsel"]);
  assert.deepEqual(objectsFor("goblin", "mgx:evades"), [], "the fear derives from the fox's own appetite, never stated twice");
  assert.deepEqual(objectsFor("goblin", "mgx:arrive"), [`every ${knobs.preySpawnIntervalTurns} turns at the edge of the board by default`]);
  assert.deepEqual(objectsFor("crumb", "mgx:arrive"), [`every ${knobs.foodSpawnIntervalTurns} turns on any open cell by default`]);
  assert.deepEqual(objectsFor("crumb", "mgx:start-with"), [`mass ${knobs.spawnedFoodMass} by default`], "food mass stays a config knob, so it keeps the hedge");
  assert.deepEqual(objectsFor("square", "mgx:cover"), ["138 open cells and 6 cells a prop stands on"]);
});

test("the vision-radius term takes the split branch, because this cast's two radii differ", () => {
  const knobs = DEFAULT_GAME_CONFIG.mudiii;
  assert.notEqual(knobs.predatorVisionRadius, knobs.preyVisionRadius, "the asymmetry is the point — the one-cell band is where a predator has acquired something that cannot see it back");
  const rows = [...structuralFactRows(TOWN_SQUARE_LAYOUTS["town-square"])]
    .filter((r) => r.subject === "vision radius");
  assert.deepEqual(rows.map((r) => r.object), [
    `${knobs.predatorVisionRadius} cells for the fox`,
    `${knobs.preyVisionRadius} cells for the goblin`,
  ]);
});

test("the meta row carries each layout's own opening line", () => {
  for (const lay of LAYOUTS) {
    assert.deepEqual(worldMetaRow(lay), { world: lay.name, kind: "meta", opening: lay.opening });
    assert.notEqual(lay.opening.trim(), "");
  }
});

// ---- budgets and rosters ----------------------------------------------------------

test("every generated world source fits the pack's raw-source budget, and fails here rather than in the build", () => {
  for (const lay of LAYOUTS) {
    const bytes = Buffer.byteLength(worldSourceText(lay));
    assert.ok(
      bytes <= SOURCE_BYTES_BUDGET,
      `${lay.name}: ${bytes} bytes against a ${SOURCE_BYTES_BUDGET}-byte budget — cut world content, never raise the number`,
    );
  }
});

test("id readers tell a prop from a food item from a live agent", () => {
  assert.equal(agentKindOf("goblin-12"), "goblin");
  assert.equal(agentKindOf("market-stall"), "market-stall", "a bare noun with no number is its own kind");
  assert.ok(isPropId("well-1"));
  assert.ok(isPropId("house-3"));
  assert.equal(isPropId("goblin-1"), false);
  assert.ok(isFoodId("crumb-2"));
  assert.ok(isFoodId("morsel-1"));
  assert.equal(isFoodId("fox-1"), false);

  const state = { removed: new Set(["goblin-2"]) };
  assert.ok(isLiveRenderableAgent("fox-1", state));
  assert.equal(isLiveRenderableAgent("goblin-2", state), false, "eaten");
  assert.equal(isLiveRenderableAgent("well-1", state), false, "a prop is drawn from the world pack, not the roster");
  assert.equal(isLiveRenderableAgent("crumb-1", state), false, "food rides the items map");
});

test("liveIdsOfKind reads a plain roster or a placements Map, and honours a removed set", () => {
  assert.deepEqual(liveIdsOfKind({ "goblin-2": {}, "goblin-10": {}, "fox-1": {} }, "goblin"), ["goblin-10", "goblin-2"]);
  const placements = new Map([["goblin-1", {}], ["goblin-2", {}], ["fox-1", {}]]);
  assert.deepEqual(liveIdsOfKind(placements, "goblin", new Set(["goblin-1"])), ["goblin-2"]);
});

test("the default facing is a real direction, so a payload never carries a null one", () => {
  assert.ok(Object.keys(DIRECTION_DELTA).includes(DEFAULT_FACING));
  assert.equal(DEFAULT_FACING, FIXTURE.defaultFacing);
});
