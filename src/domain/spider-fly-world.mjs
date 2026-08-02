// spider-fly-world.mjs — the one pure definition of the spider/fly 10x10
// grid: cell naming, Chebyshev geometry, the fixed web block, the seed
// taxonomy, and the static fact/rule/meta rows the shipped world carries.
// Pure — the only import is the sibling pure-data game-config.mjs, so the
// structural self-description facts below quote the same shipped defaults
// the engine actually runs. Both
// scripts/gen-spider-fly-world.mjs (writes corpus/worlds/src/spider-fly.jsonl)
// and src/services/spider-fly-turn.mjs (the runtime) read the SAME grid/web
// constants from here, so the shipped world and the engine that plays it can
// never drift apart.

import { DEFAULT_GAME_CONFIG } from "./game-config.mjs";

export const WORLD_NAME = "spider-fly";
export const GRID_SIZE = 10;

// The spider's home cell, and the web's Chebyshev radius around it (radius 1 =
// a 3x3 block). Corner-ish on purpose: a spider that starts here sees close to
// half the board just from edge-clipping.
export const WEB_HOME = Object.freeze({ x: 2, y: 2 });
export const WEB_RADIUS = 1;

// A spider-built web stays active for this many turns past the turn it was
// spun, mirroring the home zone's own always-on web without a second code path.
export const WEB_DURATION_TURNS = 10;

// A spider starves like a fly does, and gains exactly a fly's remaining mass on
// an eat. Heavier starting mass than a single fly's worth on purpose — a spider
// that eats nothing for a while has some runway before starving. The decrement
// is half a fly's own (spiders live longer between meals than flies do), and —
// like every other tunable here — overridable per session via tmct.toml's
// [games.spider-fly] (src/domain/game-config.mjs).
export const SPIDER_INITIAL_MASS = 15;
export const SPIDER_MASS_DECREMENT_PER_TURN = 0.5;

/** The cast the shared predator/prey engine runs this board with. Same shape as
 *  the town square's own roles object, minus the food entry: nothing inert
 *  lies on a spider-and-fly board, and a null food role is what says so. */
export const SPIDER_FLY_ROLES = Object.freeze({
  predator: Object.freeze({ role: "predator", kind: "spider", idPrefix: "spider" }),
  prey: Object.freeze({ role: "prey", kind: "fly", idPrefix: "fly" }),
  food: null,
});

export const cellId = (x, y) => `cell-${x}-${y}`;

const CELL_ID_RE = /^cell-(\d+)-(\d+)$/;

/** {x,y} from a "cell-<x>-<y>" id, or null when the string isn't one. */
export function parseCellId(id) {
  const m = CELL_ID_RE.exec(String(id ?? ""));
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

export const chebyshevDistance = (ax, ay, bx, by) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

export const inBounds = (x, y) => x >= 1 && x <= GRID_SIZE && y >= 1 && y <= GRID_SIZE;

/** Every cell within Chebyshev `radius` of (cx, cy), clipped to the board, in
 *  raster order — the one visibility primitive PLAN_SPIDER_FLY.md §4 names
 *  ("visibleCells(cx, cy, radius=4)"), shared by both agents' belief and this
 *  module's own web-block derivation below. */
export function visibleCells(cx, cy, radius) {
  const out = [];
  for (let y = Math.max(1, cy - radius); y <= Math.min(GRID_SIZE, cy + radius); y += 1) {
    for (let x = Math.max(1, cx - radius); x <= Math.min(GRID_SIZE, cx + radius); x += 1) {
      out.push(cellId(x, y));
    }
  }
  return out;
}

export const isInWebBlock = (x, y) => chebyshevDistance(x, y, WEB_HOME.x, WEB_HOME.y) <= WEB_RADIUS;

/** Every board-edge (perimeter) cell, raster order — where a spawned fly
 *  arrives (PLAN_SPIDER_FLY.md §10). */
export function perimeterCells() {
  const out = [];
  for (let y = 1; y <= GRID_SIZE; y += 1) {
    for (let x = 1; x <= GRID_SIZE; x += 1) {
      if (x === 1 || x === GRID_SIZE || y === 1 || y === GRID_SIZE) out.push(cellId(x, y));
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

/** The single compass direction from `fromCell` to `toCell` when `toCell`
 *  sits EXACTLY one cardinal step away (DIRECTION_DELTA) — null for the same
 *  cell, a diagonal, or any multi-step gap, so a caller never overstates
 *  "adjacent". The one shared primitive both the engine's own plan-driven
 *  facing and the chat dock's deception pills (spider-fly-turn.mjs's
 *  pillsForSpiderFly) need — defined once here so neither has to re-derive
 *  it. */
export function oneStepDirectionBetween(fromCell, toCell) {
  for (const [direction, { dx, dy }] of Object.entries(DIRECTION_DELTA)) {
    if (fromCell.x + dx === toCell.x && fromCell.y + dy === toCell.y) return direction;
  }
  return null;
}

/** The world's seed taxonomy (PLAN_SPIDER_FLY.md §7): enough for the
 *  ontology-to-sprite worked example (a poodle sprite, a sheepdog falling
 *  back to the generic dog sprite) to run on the default persona, no
 *  --persona-size large flag required. [subject, superclass] pairs, written
 *  as rdfs:subClassOf facts. */
export const SEED_TAXONOMY = Object.freeze([
  Object.freeze(["poodle", "dog"]),
  Object.freeze(["sheepdog", "dog"]),
  Object.freeze(["dog", "animal"]),
  Object.freeze(["spider", "arachnid"]),
  Object.freeze(["arachnid", "animal"]),
  Object.freeze(["fly", "insect"]),
  Object.freeze(["insect", "animal"]),
]);

export const WORLD_OPENING =
  "a spider waits in its web; a fly drifts in from the edge of the board. Neither is yours to move. Watch, or address one by name in chat.";

/** This board as the shared predator/prey engine's own layout: a bare 10x10
 *  grid, the always-on web block, and the cast a fresh session mints. `props`
 *  is empty and stays empty — nothing here blocks movement, so every cell is
 *  open and the whole perimeter takes an arrival. */
export const SPIDER_FLY_LAYOUT = Object.freeze({
  name: WORLD_NAME,
  gridSize: GRID_SIZE,
  opening: WORLD_OPENING,
  boardNoun: "board",
  boardSubject: "board",
  cast: Object.freeze({ predators: 1, prey: 1 }),
  props: Object.freeze([]),
  staticWebAt: isInWebBlock,
  webHomeCell: cellId(WEB_HOME.x, WEB_HOME.y),
});

/** The spider-and-fly knobs restated in the engine's role-keyed shape, with the
 *  three mechanics this cast wants switched on. The public [games.spider-fly]
 *  table stays species-keyed on purpose: a tmct.toml key and a page slider keep
 *  the names a player of THIS game would use, and the translation lives here.
 *  Unset keys fall back to the shipped defaults, so a partial slider payload is
 *  always a complete engine config. Pure. */
export function spiderFlyEngineConfig(knobs) {
  const k = { ...DEFAULT_GAME_CONFIG.spiderFly, ...(knobs || {}) };
  return {
    predatorInitialMass: k.spiderInitialMass,
    predatorMassDecrementPerTurn: k.spiderMassDecrementPerTurn,
    predatorVisionRadius: k.spiderVisionRadius,
    preyInitialMass: k.flyInitialMass,
    preyMassDecrementPerTurn: k.flyMassDecrementPerTurn,
    preyVisionRadius: k.flyVisionRadius,
    preySpawnIntervalTurns: k.flySpawnIntervalTurns,
    webDurationTurns: k.webDurationTurns,
    eggLayMassThreshold: k.eggLayMassThreshold,
    eggHatchDelayTurns: k.eggHatchDelayTurns,
    eggHatchCount: k.eggHatchCount,
    minHatchlingMass: k.minHatchlingMass,
    carryPreyToWeb: true,
    buildWebs: true,
    layEggs: true,
  };
}

/** Every fact row the shipped world source carries: cell typing, grid
 *  adjacency (mgx:has-exit-<direction>), the web block (mgx:in-web) and the
 *  seed taxonomy — plain { world, kind:"fact", subject, predicate, object }
 *  objects, the exact shape src/domain/worlds-pack.mjs's isWorldFactRow
 *  reads. Deliberately NOT spider-1/fly-1: the board is reusable static
 *  content, minted game entities are a fresh session's own state
 *  (src/services/spider-fly-turn.mjs's startSpiderFlyGame). */
export function* worldFactRows() {
  for (let y = 1; y <= GRID_SIZE; y += 1) {
    for (let x = 1; x <= GRID_SIZE; x += 1) {
      const id = cellId(x, y);
      yield { world: WORLD_NAME, kind: "fact", subject: id, predicate: "rdf:type", object: "cell" };
      for (const [direction, { dx, dy }] of Object.entries(DIRECTION_DELTA)) {
        const nx = x + dx;
        const ny = y + dy;
        if (inBounds(nx, ny)) {
          yield { world: WORLD_NAME, kind: "fact", subject: id, predicate: `mgx:has-exit-${direction}`, object: cellId(nx, ny) };
        }
      }
      if (isInWebBlock(x, y)) {
        yield { world: WORLD_NAME, kind: "fact", subject: id, predicate: "mgx:in-web", object: "true" };
      }
    }
  }
  for (const [subject, superclass] of SEED_TAXONOMY) {
    yield { world: WORLD_NAME, kind: "fact", subject, predicate: "rdfs:subClassOf", object: superclass };
  }
  yield* structuralFactRows();
}

const pluralize = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The board/web/agent structure the page's own controls and copy surface,
 *  restated as askable facts — so "what is the board?" / "what is the vision
 *  radius?" ground instead of missing. Every number is either grid geometry
 *  (fixed here) or a shipped tuning default (game-config.mjs); the tunable
 *  ones say "by default" because a live session's sliders or tmct.toml can
 *  move them, and a fact that a slider drag falsifies would be a lie.
 *  Predicates stick to the curated/readable families the fact reader
 *  verbalizes cleanly ("has", "is", "covers", "lasts for", "starts with",
 *  "loses", "lays", "arrives", "hatches after/into"). */
export function* structuralFactRows() {
  const fact = (subject, predicate, object) => ({ world: WORLD_NAME, kind: "fact", subject, predicate, object });
  const knobs = DEFAULT_GAME_CONFIG.spiderFly;
  let webCellCount = 0;
  for (let y = 1; y <= GRID_SIZE; y += 1) {
    for (let x = 1; x <= GRID_SIZE; x += 1) {
      if (isInWebBlock(x, y)) webCellCount += 1;
    }
  }
  yield fact("board", "rdf:type", "grid");
  yield fact("board", "mgx:hasA", pluralize(GRID_SIZE, "row"));
  yield fact("board", "mgx:hasA", pluralize(GRID_SIZE, "column"));
  yield fact("board", "mgx:hasA", pluralize(GRID_SIZE * GRID_SIZE, "cell"));
  yield fact("web", "mgx:cover", `${pluralize(webCellCount, "cell")} around ${cellId(WEB_HOME.x, WEB_HOME.y)}`);
  yield fact("web", "mgx:last-for", `${pluralize(knobs.webDurationTurns, "turn")} by default when a spider builds one`);
  yield fact("spider", "mgx:hasA", `vision radius of ${pluralize(knobs.spiderVisionRadius, "cell")} by default`);
  yield fact("spider", "mgx:start-with", `mass ${knobs.spiderInitialMass} by default`);
  yield fact("spider", "mgx:lose", `${knobs.spiderMassDecrementPerTurn} mass per turn by default`);
  yield fact("spider", "mgx:lay", `one egg at mass ${knobs.eggLayMassThreshold} by default`);
  yield fact("fly", "mgx:hasA", `vision radius of ${pluralize(knobs.flyVisionRadius, "cell")} by default`);
  yield fact("fly", "mgx:start-with", `mass ${knobs.flyInitialMass} by default`);
  yield fact("fly", "mgx:lose", `${knobs.flyMassDecrementPerTurn} mass per turn by default`);
  yield fact("fly", "mgx:arrive", `every ${pluralize(knobs.flySpawnIntervalTurns, "turn")} at the edge of the board by default`);
  yield fact("egg", "mgx:hatch-after", `${pluralize(knobs.eggHatchDelayTurns, "turn")} by default`);
  yield fact("egg", "mgx:hatch-into", `${pluralize(knobs.eggHatchCount, "spider")} by default`);
  // The page's own slider label is "vision radius", so that exact term must
  // describe too, not just the per-class rows above. One combined row while
  // the two class defaults agree, one row per class if they ever split —
  // never a combined claim the config doesn't actually make.
  if (knobs.spiderVisionRadius === knobs.flyVisionRadius) {
    yield fact("vision radius", "mgx:hasProperty", `${pluralize(knobs.spiderVisionRadius, "cell")} for both the spider and the fly by default`);
  } else {
    yield fact("vision radius", "mgx:hasProperty", `${pluralize(knobs.spiderVisionRadius, "cell")} for the spider by default`);
    yield fact("vision radius", "mgx:hasProperty", `${pluralize(knobs.flyVisionRadius, "cell")} for the fly by default`);
  }
}

/** The world's one meta row (its opening line). */
export function worldMetaRow() {
  return { world: WORLD_NAME, kind: "meta", opening: WORLD_OPENING };
}

/** The class an agent id names — "spider-2" -> "spider", "fly-10" -> "fly",
 *  "egg-1" -> "egg" — the one regex every caller that needs an individual's
 *  kind from its id string shares. Self-contained (no outer refs),
 *  `.toString()`-splice safe. */
export function agentKindOf(id) {
  return String(id).replace(/-\d+$/, "");
}

/** Every live id of `kind` among `agents`, sorted. `agents` is either a
 *  plain `{ id: ... }` roster (runSpiderFlyTick's/foldSpiderFlyState's own
 *  agents map, already excluding anything dead) or a `Map` keyed by id
 *  (foldSpiderFlyState's own `state.placements`, which still carries a dead
 *  individual's last-known cell) — pass the matching `state.removed` Set as
 *  `removed` in the Map case to exclude those; omit it for a plain roster
 *  that has no such concept. Pure. */
export function liveIdsOfKind(agents, kind, removed = null) {
  const re = new RegExp(`^${kind}-\\d+$`);
  const ids = agents instanceof Map ? [...agents.keys()] : Object.keys(agents || {});
  return ids.filter((id) => re.test(id) && !(removed && removed.has(id))).sort();
}

/** True for a web individual's own id ("web-3") — a spider-built web is
 *  placed via mgx:currently-in exactly like a live agent, but it is never
 *  one. */
export function isWebIndividualId(id) {
  return /^web-\d+$/.test(id);
}

/** Whether `id` belongs on a rendered agent roster built from `state`
 *  (foldSpiderFlyState's own shape): live (not in `state.removed`) and not a
 *  web individual. The one world rule a browser-side snapshot needs to skip
 *  the same two things every renderer of `state.placements` must skip. */
export function isLiveRenderableAgent(id, state) {
  return !state.removed.has(id) && !isWebIndividualId(id);
}

/** A minimal, inert rule-row family, so scripts/build-worlds-pack.mjs's
 *  shared validator ("every world needs at least one rule row") passes.
 *  src/services/spider-fly-turn.mjs never reads these back: grid movement is
 *  hand-written pathfinding over findActionPath/findReachableSet
 *  (PLAN_SPIDER_FLY.md §5), not the taught action-Rule DSL, so this rides in
 *  the shard unused, same as an unrelated fact would. */
export function* worldRuleRows() {
  yield {
    world: WORLD_NAME, kind: "rule", name: "go", ruleKind: "action-signature",
    slots: { subjectClass: "spider", targetClass: "cell" },
  };
  yield {
    world: WORLD_NAME, kind: "rule", name: "go", ruleKind: "action-effect",
    slots: { predicate: "currently-in", subjectRole: "subject", objectRole: "target" },
  };
}
