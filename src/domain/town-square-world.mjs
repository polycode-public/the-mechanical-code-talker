// town-square-world.mjs — the pure definition of every town-square board: cell
// naming, Chebyshev geometry, the prop tables that make buildings solid, the
// seed taxonomy, and the static fact/rule/meta rows each shipped layout
// carries. Pure — the only import is the sibling pure-data game-config.mjs, so
// the structural self-description facts below quote the same shipped defaults
// the engine actually runs.
//
// The one structural difference from spider-fly-world.mjs: grid size is a
// property of the layout, never a module constant. Three layouts ship at three
// sizes, so every geometry function takes the size (or the layout) as its first
// argument. A module-level GRID_SIZE would silently clip the 14x14 chapel board
// to whichever number was written here.
//
// Both scripts/gen-town-square-worlds.mjs (which writes
// corpus/worlds/src/<layout>.jsonl) and src/services/predator-prey.mjs (the
// runtime) read the SAME layouts from here, so a shipped world and the engine
// that plays it cannot drift apart.

import { DEFAULT_GAME_CONFIG } from "./game-config.mjs";

export const DEFAULT_GRID_SIZE = 12;
export const DEFAULT_FACING = "south";

/** The species each role is cast as. The engine's own MUDIII_ROLES object
 *  (src/services/predator-prey.mjs) names the same four words; they are
 *  repeated rather than imported because a domain module may not read a
 *  service, and a test asserts the two agree. */
export const CAST_KINDS = Object.freeze({
  predator: "fox",
  prey: "goblin",
  spawnedFood: "crumb",
  placedFood: "morsel",
});

export const cellId = (x, y) => `cell-${x}-${y}`;

const CELL_ID_RE = /^cell-(\d+)-(\d+)$/;

/** {x,y} from a "cell-<x>-<y>" id, or null when the string isn't one. */
export function parseCellId(id) {
  const m = CELL_ID_RE.exec(String(id ?? ""));
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

export const chebyshevDistance = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

export const inBounds = (gridSize, x, y) => x >= 1 && x <= gridSize && y >= 1 && y <= gridSize;

/** Every cell within Chebyshev `radius` of (cx, cy), clipped to a `gridSize`
 *  board, in raster order. Vision only — a prop's cell is visible, it just
 *  can't be walked into (see agent-belief.mjs: buildings block movement, not
 *  sight). */
export function visibleCells(gridSize, cx, cy, radius) {
  const out = [];
  for (let y = Math.max(1, cy - radius); y <= Math.min(gridSize, cy + radius); y += 1) {
    for (let x = Math.max(1, cx - radius); x <= Math.min(gridSize, cx + radius); x += 1) {
      out.push(cellId(x, y));
    }
  }
  return out;
}

// direction -> (dx, dy). Plain labels reused verbatim from Ashcombe's
// mgx:has-exit-<direction> predicate (src/services/adventure.mjs) — north
// decreases y, south increases y, east increases x, west decreases x. Key
// order is the canonical direction order every consumer iterates in, for
// deterministic search tie-breaking.
export const DIRECTION_DELTA = Object.freeze({
  north: Object.freeze({ dx: 0, dy: -1 }),
  south: Object.freeze({ dx: 0, dy: 1 }),
  east: Object.freeze({ dx: 1, dy: 0 }),
  west: Object.freeze({ dx: -1, dy: 0 }),
});

/** The single compass direction from `fromCell` to `toCell` when `toCell` sits
 *  EXACTLY one cardinal step away — null for the same cell, a diagonal, or any
 *  multi-step gap, so a caller never overstates "adjacent". */
export function oneStepDirectionBetween(fromCell, toCell) {
  for (const [direction, { dx, dy }] of Object.entries(DIRECTION_DELTA)) {
    if (fromCell.x + dx === toCell.x && fromCell.y + dy === toCell.y) return direction;
  }
  return null;
}

/** The eight points a facing may take, clockwise from north. The four
 *  cardinals are DIRECTION_DELTA's own keys, and they are the only ones a STEP
 *  can use — the grid has no diagonal exits. The four intercardinals are
 *  turn-only, which is what a forty-five degree turn on the spot writes. */
export const COMPASS_POINTS = Object.freeze([
  "north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest",
]);

/** `facing` turned `degrees` clockwise (a negative angle turns the other way),
 *  landing on one of COMPASS_POINTS. Null when `facing` isn't a compass point
 *  or the angle isn't a whole multiple of 45, so a caller refuses rather than
 *  rounding a nonsense turn into a real one. Pure. */
export function turnedFacing(facing, degrees) {
  const at = COMPASS_POINTS.indexOf(String(facing ?? ""));
  if (at < 0) return null;
  if (!Number.isInteger(degrees) || degrees % 45 !== 0) return null;
  const steps = degrees / 45;
  return COMPASS_POINTS[(((at + steps) % 8) + 8) % 8];
}

/** The compass point directly behind `facing`, or null. Pure. */
export function reverseFacing(facing) {
  return turnedFacing(facing, 180);
}

/** The cell one step `direction` from `cell`, or null when `direction` names
 *  no cardinal step or `cell` doesn't parse. Bounds and props are NOT checked
 *  here: whether that cell can actually be entered is the exit table's answer,
 *  and there is only one of those. Pure. */
export function stepCellFrom(cell, direction) {
  const at = parseCellId(cell);
  const delta = DIRECTION_DELTA[String(direction ?? "")];
  if (!at || !delta) return null;
  return cellId(at.x + delta.dx, at.y + delta.dy);
}

// ---- the prop vocabulary ------------------------------------------------------

/** The closed set of noun stems a prop id may use ("house-1" -> "house"). A
 *  town square's scenery is authored here and nowhere else, so the set is
 *  closed by construction and a reader can tell a prop from an animal or a
 *  crumb by its id alone. */
export const PROP_KINDS = Object.freeze([
  "blacksmith", "bush", "cart", "fence", "house", "inn", "oak", "stall", "well",
]);

/** The closed set of noun stems a food item's id may use. */
export const FOOD_KINDS = Object.freeze([CAST_KINDS.spawnedFood, CAST_KINDS.placedFood]);

/** The class an individual's id names — "goblin-2" -> "goblin", "crumb-10" ->
 *  "crumb". Self-contained, `.toString()`-splice safe. */
export function agentKindOf(id) {
  return String(id).replace(/-\d+$/, "");
}

/** True for a prop individual's id. A prop is placed with mgx:currently-in
 *  exactly like a live agent and is never one. */
export function isPropId(id) {
  return PROP_KINDS.includes(agentKindOf(id));
}

/** True for a food individual's id. Food is inert: a subject with a cell, no
 *  belief, no goal, no plan — the tick payload carries it in `items`, not in
 *  `agents`. */
export function isFoodId(id) {
  return FOOD_KINDS.includes(agentKindOf(id));
}

/** Whether `id` belongs on a rendered AGENT roster built from `state` (a
 *  folded world state with a `.removed` Set): live, and neither a prop nor a
 *  food item. The one world rule every renderer of `state.placements` shares. */
export function isLiveRenderableAgent(id, state) {
  return !state.removed.has(id) && !isPropId(id) && !isFoodId(id);
}

/** Every live id of `kind` among `agents`, sorted. `agents` is either a plain
 *  `{ id: ... }` roster or a `Map` keyed by id — pass the matching `removed`
 *  Set in the Map case to exclude anything the board has taken off it. Pure. */
export function liveIdsOfKind(agents, kind, removed = null) {
  const re = new RegExp(`^${kind}-\\d+$`);
  const ids = agents instanceof Map ? [...agents.keys()] : Object.keys(agents || {});
  return ids.filter((id) => re.test(id) && !(removed && removed.has(id))).sort();
}

// ---- the three shipped layouts ------------------------------------------------
// Each is a literal prop table plus its cast counts. `model` is an asset key
// resolved by the render layer (data/mudiii-assets.json's `key` column), never
// a file path; `rotation` is degrees, written as a string because a fact object
// is a term.

const layout = (spec) => Object.freeze({ ...spec, props: Object.freeze(spec.props.map((p) => Object.freeze(p))), cast: Object.freeze(spec.cast) });

/** The headline square: a terrace of houses down the east side of the north
 *  edge, a well at the centre, one stall by the west wall and the inn in the
 *  south-east. The prop table is pinned by test/fixtures/mudiii-ticks.json —
 *  the ten recorded ticks are a seeded run over exactly this board, so moving
 *  a prop moves every cell in the fixture. */
const TOWN_SQUARE = layout({
  name: "town-square",
  gridSize: 12,
  opening: "a fox prowls the town square; goblins pick over the stalls for scraps. Neither is yours to move. Watch, or address one by name in chat.",
  cast: { predators: 1, prey: 3 },
  props: [
    { id: "house-1", model: "house-1", cell: "cell-8-1", rotation: "180" },
    { id: "house-2", model: "house-2", cell: "cell-8-2", rotation: "180" },
    { id: "house-3", model: "house-3", cell: "cell-8-3", rotation: "180" },
    { id: "well-1", model: "well", cell: "cell-6-7", rotation: "0" },
    { id: "stall-1", model: "market-stall-1", cell: "cell-3-9", rotation: "90" },
    { id: "inn-1", model: "inn", cell: "cell-11-10", rotation: "270" },
  ],
});

/** Market day: two stall rows cut the square into three lanes, with gaps at
 *  the west wall, the middle and the east wall so no lane is sealed. */
const TOWN_SQUARE_MARKET = layout({
  name: "town-square-market",
  gridSize: 10,
  opening: "market day in the town square: two rows of stalls, goblins working the lanes between them, and a fox somewhere among the crowd.",
  cast: { predators: 1, prey: 4 },
  props: [
    { id: "stall-1", model: "market-stall-1", cell: "cell-2-4", rotation: "0" },
    { id: "stall-2", model: "market-stall-2", cell: "cell-3-4", rotation: "0" },
    { id: "stall-3", model: "market-stall-1", cell: "cell-4-4", rotation: "0" },
    { id: "stall-4", model: "market-stall-2", cell: "cell-6-4", rotation: "0" },
    { id: "stall-5", model: "market-stall-1", cell: "cell-7-4", rotation: "0" },
    { id: "stall-6", model: "market-stall-2", cell: "cell-8-4", rotation: "0" },
    { id: "stall-7", model: "market-stall-2", cell: "cell-2-7", rotation: "180" },
    { id: "stall-8", model: "market-stall-1", cell: "cell-3-7", rotation: "180" },
    { id: "stall-9", model: "market-stall-2", cell: "cell-4-7", rotation: "180" },
    { id: "stall-10", model: "market-stall-1", cell: "cell-6-7", rotation: "180" },
    { id: "stall-11", model: "market-stall-2", cell: "cell-7-7", rotation: "180" },
    { id: "stall-12", model: "market-stall-1", cell: "cell-8-7", rotation: "180" },
    { id: "well-1", model: "well", cell: "cell-5-5", rotation: "0" },
    { id: "blacksmith-1", model: "blacksmith", cell: "cell-10-5", rotation: "270" },
    { id: "cart-1", model: "cart", cell: "cell-1-1", rotation: "90" },
    { id: "cart-2", model: "cart", cell: "cell-10-10", rotation: "270" },
    { id: "bush-1", model: "bush", cell: "cell-10-1", rotation: "0" },
    { id: "bush-2", model: "bush", cell: "cell-1-10", rotation: "0" },
  ],
});

/** The chapel corner: an L of buildings in the north-west, a fence line across
 *  the south, three oaks. The only shipped layout with two predators, so it is
 *  where the avoid branch actually runs. */
const TOWN_SQUARE_CHAPEL = layout({
  name: "town-square-chapel",
  gridSize: 14,
  opening: "the chapel corner of the town square, fenced to the south and shaded by three oaks. Two foxes hunt here, and two goblins know it.",
  cast: { predators: 2, prey: 2 },
  props: [
    { id: "inn-1", model: "inn", cell: "cell-2-2", rotation: "180" },
    { id: "house-1", model: "house-1", cell: "cell-3-2", rotation: "180" },
    { id: "house-2", model: "house-2", cell: "cell-2-3", rotation: "90" },
    { id: "fence-1", model: "fence", cell: "cell-7-11", rotation: "0" },
    { id: "fence-2", model: "fence", cell: "cell-8-11", rotation: "0" },
    { id: "fence-3", model: "fence", cell: "cell-9-11", rotation: "0" },
    { id: "oak-1", model: "oak-tree", cell: "cell-12-4", rotation: "0" },
    { id: "oak-2", model: "oak-tree", cell: "cell-12-12", rotation: "90" },
    { id: "oak-3", model: "oak-tree", cell: "cell-5-8", rotation: "180" },
  ],
});

export const TOWN_SQUARE_LAYOUTS = Object.freeze({
  [TOWN_SQUARE.name]: TOWN_SQUARE,
  [TOWN_SQUARE_MARKET.name]: TOWN_SQUARE_MARKET,
  [TOWN_SQUARE_CHAPEL.name]: TOWN_SQUARE_CHAPEL,
});

/** Every shipped layout name, in the order the scenario dropdown lists them —
 *  the headline square first. */
export const WORLD_NAMES = Object.freeze(Object.keys(TOWN_SQUARE_LAYOUTS));

/** The layout `name` denotes, or null. Never a guessed fallback: a caller that
 *  asked for a world this pack doesn't hold gets nothing, not the headline
 *  square wearing the wrong name. */
export function layoutNamed(name) {
  return TOWN_SQUARE_LAYOUTS[String(name ?? "")] ?? null;
}

// ---- solid cells: the one primitive the buildings mean --------------------------
// A prop's cell is solid. The exit-omission rule below, prey arrival, crumb
// spawning and the page's own click refusal all read this and nothing else.

const solidCache = new WeakMap();

/** Every cell a prop stands on, as a Set of cell ids. */
export function solidCells(lay) {
  let cached = solidCache.get(lay);
  if (!cached) {
    cached = new Set(lay.props.map((p) => p.cell));
    solidCache.set(lay, cached);
  }
  return cached;
}

/** Whether `cell` holds a prop, and so can never be entered. */
export function isSolid(lay, cell) {
  return solidCells(lay).has(cell);
}

/** Every in-bounds cell no prop stands on, raster order. Where a crumb may be
 *  minted, where an agent may stand, and the set the connectivity guard floods
 *  through. */
export function openCells(lay) {
  const solid = solidCells(lay);
  const out = [];
  for (let y = 1; y <= lay.gridSize; y += 1) {
    for (let x = 1; x <= lay.gridSize; x += 1) {
      const id = cellId(x, y);
      if (!solid.has(id)) out.push(id);
    }
  }
  return out;
}

/** Every board-edge cell no prop stands on, raster order — where a spawned
 *  prey arrives. Prop-free matters here rather than being a nicety: the
 *  headline layout has a house terrace and an inn sitting on the perimeter. */
export function perimeterCells(lay) {
  const solid = solidCells(lay);
  const out = [];
  for (let y = 1; y <= lay.gridSize; y += 1) {
    for (let x = 1; x <= lay.gridSize; x += 1) {
      if (x !== 1 && x !== lay.gridSize && y !== 1 && y !== lay.gridSize) continue;
      const id = cellId(x, y);
      if (!solid.has(id)) out.push(id);
    }
  }
  return out;
}

// ---- the world's fact rows ------------------------------------------------------

/** The seed taxonomy every town-square layout ships. It has one hard job: make
 *  objectClassChain reach "food" from both a crumb and a morsel, since that
 *  chain IS the forage read's precondition and a goblin must not be able to
 *  tell world food from player food. */
export const SEED_TAXONOMY = Object.freeze([
  Object.freeze(["fox", "canine"]),
  Object.freeze(["canine", "animal"]),
  Object.freeze(["goblin", "humanoid"]),
  Object.freeze(["humanoid", "creature"]),
  Object.freeze(["creature", "animal"]),
  Object.freeze(["crumb", "food"]),
  Object.freeze(["morsel", "food"]),
  Object.freeze(["food", "thing"]),
  Object.freeze(["prop", "thing"]),
]);

/** Four rows per prop: its class, its cell, the asset key a renderer resolves
 *  to a mesh, and its rotation in degrees. Every object is a string — "90",
 *  never 90 — because a fact object is a term, and the row validator takes
 *  non-empty strings only. */
export function* propFactRows(lay) {
  for (const prop of lay.props) {
    yield { world: lay.name, kind: "fact", subject: prop.id, predicate: "rdf:type", object: "prop" };
    yield { world: lay.name, kind: "fact", subject: prop.id, predicate: "mgx:currently-in", object: prop.cell };
    yield { world: lay.name, kind: "fact", subject: prop.id, predicate: "mgx:model", object: prop.model };
    yield { world: lay.name, kind: "fact", subject: prop.id, predicate: "mgx:rotation", object: prop.rotation };
  }
}

/** Every fact row the shipped world source carries: cell typing, grid
 *  adjacency with prop cells cut out of it, the prop placements, the seed
 *  taxonomy and the structural self-description.
 *
 *  The omission rule, which is the whole of what a building does: EVERY
 *  in-bounds cell is typed, solid ones included, so "what is at cell-8-1?"
 *  grounds instead of missing on an undeclared individual. A solid cell emits
 *  no exits out, and no neighbour emits an exit into it. That is symmetric by
 *  construction, so a one-way edge into a building cannot be authored by
 *  accident, and gridApplyActions — which builds its whole successor closure
 *  from mgx:has-exit-* rows — routes around the buildings with no planner code
 *  at all. */
export function* worldFactRows(lay) {
  const solid = solidCells(lay);
  for (let y = 1; y <= lay.gridSize; y += 1) {
    for (let x = 1; x <= lay.gridSize; x += 1) {
      const id = cellId(x, y);
      yield { world: lay.name, kind: "fact", subject: id, predicate: "rdf:type", object: "cell" };
      if (solid.has(id)) continue;
      for (const [direction, { dx, dy }] of Object.entries(DIRECTION_DELTA)) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(lay.gridSize, nx, ny)) continue;
        const target = cellId(nx, ny);
        if (solid.has(target)) continue;
        yield { world: lay.name, kind: "fact", subject: id, predicate: `mgx:has-exit-${direction}`, object: target };
      }
    }
  }
  yield* propFactRows(lay);
  for (const [subject, superclass] of SEED_TAXONOMY) {
    yield { world: lay.name, kind: "fact", subject, predicate: "rdfs:subClassOf", object: superclass };
  }
  yield* structuralFactRows(lay);
}

const pluralize = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The board, the props and the cast restated as askable facts, so "what is
 *  the board?" and "what is the vision radius?" ground instead of missing.
 *  Every number is either fixed layout geometry or a shipped tuning default
 *  from game-config.mjs; the tunable ones say "by default", because a slider
 *  drag or a tmct.toml override moves them and a fact a slider falsifies is a
 *  lie. */
export function* structuralFactRows(lay) {
  const fact = (subject, predicate, object) => ({ world: lay.name, kind: "fact", subject, predicate, object });
  const knobs = DEFAULT_GAME_CONFIG.mudiii;
  const { predator, prey, spawnedFood, placedFood } = CAST_KINDS;
  const solidCount = solidCells(lay).size;
  const cellCount = lay.gridSize * lay.gridSize;

  yield fact("board", "rdf:type", "grid");
  yield fact("board", "mgx:hasA", pluralize(lay.gridSize, "row"));
  yield fact("board", "mgx:hasA", pluralize(lay.gridSize, "column"));
  yield fact("board", "mgx:hasA", pluralize(cellCount, "cell"));
  yield fact("square", "mgx:cover", `${pluralize(cellCount - solidCount, "open cell")} and ${pluralize(solidCount, "cell")} a prop stands on`);
  yield fact("square", "mgx:start-with", `${pluralize(lay.cast.predators, predator)} and ${pluralize(lay.cast.prey, prey)} by default`);
  yield fact("square", "mgx:hasA", `limit of ${pluralize(knobs.maxPreyPopulation, prey)} and ${pluralize(knobs.maxFoodItems, "food item")} at once by default`);
  yield fact("prop", "mgx:cover", "one cell each, which nothing can walk into");

  yield fact(predator, "mgx:hasA", `vision radius of ${pluralize(knobs.predatorVisionRadius, "cell")} by default`);
  yield fact(predator, "mgx:start-with", `mass ${knobs.predatorInitialMass} by default`);
  yield fact(predator, "mgx:lose", `${knobs.predatorMassDecrementPerTurn} mass per turn by default`);
  yield fact(prey, "mgx:hasA", `vision radius of ${pluralize(knobs.preyVisionRadius, "cell")} by default`);
  yield fact(prey, "mgx:start-with", `mass ${knobs.preyInitialMass} by default`);
  yield fact(prey, "mgx:lose", `${knobs.preyMassDecrementPerTurn} mass per turn by default`);
  yield fact(prey, "mgx:arrive", `every ${pluralize(knobs.preySpawnIntervalTurns, "turn")} at the edge of the board by default`);
  yield fact(spawnedFood, "mgx:arrive", `every ${pluralize(knobs.foodSpawnIntervalTurns, "turn")} on any open cell by default`);
  yield fact(spawnedFood, "mgx:start-with", `mass ${knobs.spawnedFoodMass} by default`);
  yield fact(placedFood, "mgx:start-with", `mass ${knobs.placedFoodMass} by default`);
  yield fact(placedFood, "mgx:arrive", "where the player puts it");

  // The page's own slider label is "vision radius", so that exact term has to
  // describe too, not just the per-class rows above. One combined row while
  // the two class defaults agree, one row per class once they split — never a
  // combined claim the config doesn't make. This cast splits them: the
  // predator sees further than the prey, and the one-cell band that opens is
  // the point.
  if (knobs.predatorVisionRadius === knobs.preyVisionRadius) {
    yield fact("vision radius", "mgx:hasProperty", `${pluralize(knobs.predatorVisionRadius, "cell")} for both the ${predator} and the ${prey} by default`);
  } else {
    yield fact("vision radius", "mgx:hasProperty", `${pluralize(knobs.predatorVisionRadius, "cell")} for the ${predator} by default`);
    yield fact("vision radius", "mgx:hasProperty", `${pluralize(knobs.preyVisionRadius, "cell")} for the ${prey} by default`);
  }
}

/** The layout's one meta row (its opening line). */
export function worldMetaRow(lay) {
  return { world: lay.name, kind: "meta", opening: lay.opening };
}

/** A minimal, inert rule-row family, so scripts/build-worlds-pack.mjs's shared
 *  validator ("every world needs at least one rule row") passes. The engine
 *  never reads these back: grid movement is hand-written pathfinding over
 *  findActionPath/findReachableSet, not the taught action-Rule DSL, whose
 *  precondition shapes cannot express grid adjacency. */
export function* worldRuleRows(lay) {
  yield {
    world: lay.name, kind: "rule", name: "go", ruleKind: "action-signature",
    slots: { subjectClass: "animal", targetClass: "cell" },
  };
  yield {
    world: lay.name, kind: "rule", name: "go", ruleKind: "action-effect",
    slots: { predicate: "currently-in", subjectRole: "subject", objectRole: "target" },
  };
}
