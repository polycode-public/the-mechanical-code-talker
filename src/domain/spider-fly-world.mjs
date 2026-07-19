// spider-fly-world.mjs — the one pure definition of the spider/fly 10x10
// grid: cell naming, Chebyshev geometry, the fixed web block, the seed
// taxonomy, and the static fact/rule/meta rows the shipped world carries.
// Pure, no imports (PLAN_SPIDER_FLY.md §3/§4/§7) — both
// scripts/gen-spider-fly-world.mjs (writes corpus/worlds/src/spider-fly.jsonl)
// and src/services/spider-fly.mjs (the runtime) read the SAME grid/web
// constants from here, so the shipped world and the engine that plays it can
// never drift apart.

export const WORLD_NAME = "spider-fly";
export const GRID_SIZE = 10;

// The spider's home cell, and the web's Chebyshev radius around it (radius 1
// = a 3x3 block, PLAN_SPIDER_FLY.md §3). Corner-ish on purpose (§4): a spider
// that starts here sees close to half the board just from edge-clipping.
export const WEB_HOME = Object.freeze({ x: 2, y: 2 });
export const WEB_RADIUS = 1;

// A spider-built dynamic web (src/services/spider-fly.mjs's hasActiveWebAt)
// stays active for this many turns past the turn it was built, mirroring the
// static home zone's own always-on web without needing separate code paths.
export const WEB_DURATION_TURNS = 10;

// Spider mass mirrors a fly's own (src/services/spider-fly.mjs's
// FLY_INITIAL_MASS/FLY_MASS_DECREMENT_PER_TURN): a spider starves like a fly
// does, and gains exactly a fly's remaining mass on an eat. Heavier starting
// mass than a single fly's worth on purpose — a spider that eats nothing for
// a while has some runway before starving. The decrement is half a fly's own
// (spiders live longer between meals than flies do), and — like every other
// tunable here — overridable per session via tmct.toml's [games.spider-fly]
// (src/domain/game-config.mjs).
export const SPIDER_INITIAL_MASS = 15;
export const SPIDER_MASS_DECREMENT_PER_TURN = 0.5;

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
 *  facing (spider-fly.mjs) and the chat dock's deception pills
 *  (spider-fly-turn.mjs's pillsForSpiderFly) need — defined once here so
 *  neither has to re-derive it, and so the engine layer never has to import
 *  the chat-turn layer to get it (spider-fly-turn.mjs already imports
 *  spider-fly.mjs; the reverse would cycle). */
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
  "a spider waits in its web; a fly drifts in from the edge of the board. Neither is yours to move — watch, or address one by name in chat.";

/** Every fact row the shipped world source carries: cell typing, grid
 *  adjacency (mgx:has-exit-<direction>), the web block (mgx:in-web) and the
 *  seed taxonomy — plain { world, kind:"fact", subject, predicate, object }
 *  objects, the exact shape src/domain/worlds-pack.mjs's isWorldFactRow
 *  reads. Deliberately NOT spider-1/fly-1: the board is reusable static
 *  content, minted game entities are a fresh session's own state
 *  (src/services/spider-fly.mjs's startSpiderFlyGame). */
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
}

/** The world's one meta row (its opening line). */
export function worldMetaRow() {
  return { world: WORLD_NAME, kind: "meta", opening: WORLD_OPENING };
}

/** A minimal, inert rule-row family, so scripts/build-worlds-pack.mjs's
 *  shared validator ("every world needs at least one rule row") passes.
 *  src/services/spider-fly.mjs never reads these back: grid movement is
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
