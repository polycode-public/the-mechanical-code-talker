// mudiii-viz.mjs — mudiii.html: the one-player town-square demo PLAN_MUD_MUDIII.md
// describes, over a real three.js scene rather than mud.html's canvas-drawn
// room boxes. mud.html's whole control deck carries over unchanged (same
// ids, same ranges, same defaults — see MUDIII_STYLE and renderMudiiiHtml's
// own header below for the two sliders' new labels); what mudiii adds is a
// free camera (follow/pov/overhead), a single shared conversation instead of
// one pane per player, and an omniscient top-down map panel standing in for
// mud.html's burrow survey.
//
// This module owns the PAGE SHELL only. The 3D scene itself — the actual
// three.js renderer, the model loader, the per-frame camera update — is a
// concurrent track's file, src/services/mudiii-scene.mjs, reached through
// exactly one frozen function: `mudiiiSceneScript(opts) -> string`, a
// standalone inline <script> this page embeds next to its own. That module
// does not exist in every worktree yet (see the guarded import below), so
// this file also ships a "" stub until it lands — no edit needed here when
// it does.
//
// The contract runs both ways. Scene -> shell: the scene script calls
// `window.mudiiiHandleSceneClick(cellId)` on a raycast hit. Shell -> scene:
// this page's own script calls `window.mudiiiScene.boot(...)` once per
// world/reset/scenario switch, `.applyTick(...)` every tick, and
// `.setCamera(...)` on every camera-mode change, agent-select change and
// `nextCameraSelection` fallback (see `callScene`, below) — every call
// guarded, because a failed three.js vendor load (~800 KB) must never take
// the map panel, the HUD, the deck or the chat down with it.
//
// Deliberately absent, all P2P (mud.html's #statePill, share/join buttons,
// the share overlay, the wave button, the compass ring): this is the
// 1-player page. A later document adds sharing back from the same bundle.
//
// Two corrections applied against PLAN_MUD_MUDIII.md's own text (see
// AGENTS.md/the dispatch brief this track was built from): the page
// publishes through the ONE `globalThis.tmct` surface (tmct-surface.mjs),
// never a page-scoped `tmctMudiii` bag; and `createTicker`/`createSerialQueue`
// are spliced into the page script from viz-ticker.mjs, not carried by the
// browser entry.
//
// A THIRD correction, found while wiring the deck's own play control: the
// brief's "one createTicker per agent" does not fit the engine contract it
// was written against. `runPredatorPreyTick(memoryDir, opts)` returns
// `{ turn, agents, items, ecology }` for the WHOLE WORLD in one call — it has
// no per-character entry point the way mud-turn.mjs's `runMudTurn(character,
// ...)` does, so there is nothing for a second or third ticker to drive that
// the first one has not already advanced. This page runs ONE shared ticker
// for the whole simulation, serialized through the same createSerialQueue
// mud.html uses for its own multi-pane writes; every HUD card still reads
// its own agent's slice of the one tick result, which is what "per agent"
// was actually asking for.
import {
  THEME_TOKENS_CSS, SERIF_STACK, MONO_STACK, escapeHtml, embedJson, embedScriptText, scenarioLabel,
  rowsForWorld, appendLogLine, wordBeforeCursor,
} from "./viz-theme.mjs";
import { createTicker, createSerialQueue, prefersReducedMotion } from "./viz-ticker.mjs";
import { renderMudEditorText, gridWorldEditorState } from "./mud-editor.mjs";
import {
  pillCandidates, matchPills, pillCompleteMarkup, createPillComplete, PILL_COMPLETE_CSS,
} from "./pill-complete.mjs";
import { DEFAULT_GAME_CONFIG } from "../domain/game-config.mjs";
import { believedFactSentence } from "./mudiii-turn.mjs";

// The scene module and this one import each other: this file embeds the
// scene's generated IIFE, and the scene splices this file's pure geometry
// helpers into it. A static cycle is fine here because every binding crossing
// it is a hoisted function declaration that nothing calls at module-evaluation
// time — the same shape world-teach.mjs and adventure.mjs already rely on. It
// must NOT be a top-level `await import()`: two modules awaiting each other at
// evaluation time never settle, and the failure is a silent hang rather than
// an error.
import { mudiiiSceneScript } from "./mudiii-scene.mjs";

const DEFAULT_TITLE = "tmct — mudiii";
const DISPLAY_STACK = SERIF_STACK;
const SANS_STACK = `"IBM Plex Sans", "Inter", -apple-system, BlinkMacSystemFont, sans-serif`;

// The deck's own detents, copied from mud-viz.mjs verbatim: every count here
// still divides evenly, and the sliders keep mud.html's exact ranges and
// defaults even though this page relabels what they size (foxes/goblins,
// never "players"/"npcs" — neither is a player on a one-player page).
const PLAYER_COUNTS = [1, 2, 4];
const DEFAULT_PLAYER_COUNT = 2;
const NPC_COUNT_MIN = 1;
const NPC_COUNT_MAX = 10;
const NPC_COUNT_LABELLED = [1, 5, 10];
const DEFAULT_NPC_COUNT = 2;
const DEFAULT_DELAY_MS = 220;
const DEFAULT_MAX_TURNS = 400;
// test/fixtures/mudiii-ticks.json's own board size — the fallback for a
// scenario that names no gridSize of its own.
const DEFAULT_GRID_SIZE = 12;
const DEFAULT_FACING = "south";
const CAMERA_MODES = ["follow", "pov", "overhead"];
// The ring reads ABSOLUTE, not relative to whichever way an agent happens to
// face: every other direction word on this page is a compass point (a told
// fact says "the goblin is east", the map is north-up), and driveRequest takes
// a compass point directly — a cardinal steps and faces that way, an
// intercardinal turns on the spot. Ordered north-first, clockwise.
const RING_POINTS = [
  "north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest",
];

const MUDIII_NOTE_LINES = [
  "One fox and a handful of goblins share a town square, rendered in three dimensions rather than mud.html's flat rooms. The foxes slider picks how many predators are cast; the goblins slider adds more prey. Nothing here is a player either — you watch from whichever camera you pick.",
  "Follow tracks whichever agent the dropdown names, from just behind it. POV puts the camera at that agent's own eyes, facing the way it is facing. Overhead looks straight down at the whole square, no fog of war, the same deliberate exception mud.html's own survey makes.",
  "Click place food, then click a clear cell in the square to drop a morsel there — the same click a fox or a goblin would use to walk there, refused the same way if the cell is already taken.",
];

/** A live agent id's kind — "fox-1" -> "fox", "goblin-3" -> "goblin" —
 *  mirroring mud-viz.mjs's own speciesOfCharacter. This is the manifest KEY
 *  a species resolves its model and clips under (data/mudiii-assets.json's
 *  own `key` column), not the engine's predator/prey ROLE tag — an agent's
 *  actual role travels on its own tick payload (`agent.role`) and is never
 *  re-derived from its id here. Pure, self-contained. */
export function roleOfAgentId(id) {
  return String(id).replace(/-\d+$/, "");
}

/** A manifest row's `destPath` as a URL the page can actually fetch.
 *  `data/mudiii-assets.json` records paths from the repository root
 *  ("public/models/props/well.glb"), because that is where the checker and
 *  the credits generator read them from. The deployed site is rooted AT
 *  `public/`, so the leading segment has to come off or every model 404s
 *  under a doubled prefix. One function so the rule is written once: the
 *  loader, the cache key and any future preload all go through it. Pure. */
export function modelUrlFor(destPath) {
  const path = String(destPath == null ? "" : destPath).trim();
  if (!path) return null;
  return `./${path.replace(/^\.?\/?public\//, "")}`;
}

/** `cell-<x>-<y>` (x, y both 1..gridSize) to a ground-plane world position,
 *  `{ x, z }`, centred on the grid's own middle so a `gridSize`-square board
 *  sits symmetrically around the origin regardless of size. `cellSize` is
 *  the world-unit edge length of one cell — the scene track's own convention
 *  for how many three.js units a step covers. Returns null for anything that
 *  is not a well-formed cell id, or a non-finite/non-positive `gridSize`.
 *  Pure, self-contained, no closed-over constant (gridSize/cellSize both
 *  travel as parameters for exactly that reason). The inverse is
 *  `cellFromGroundPoint`, below. */
export function cellToWorld(cell, gridSize, cellSize) {
  const match = /^cell-(\d+)-(\d+)$/.exec(String(cell == null ? "" : cell));
  if (!match) return null;
  const size = Number(gridSize);
  const unit = Number(cellSize);
  if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(unit)) return null;
  const center = (size + 1) / 2;
  return { x: (Number(match[1]) - center) * unit, z: (Number(match[2]) - center) * unit };
}

/** The inverse of `cellToWorld`: a ground-plane point `{ x, z }` to the
 *  nearest `cell-<x>-<y>` id, clamped into the board (1..gridSize on both
 *  axes) — a raycast hit a hair past the square's own edge still resolves to
 *  the edge cell rather than refusing outright. Null for a non-finite point
 *  or board. Pure, self-contained. */
export function cellFromGroundPoint(point, gridSize, cellSize) {
  if (!point || typeof point.x !== "number" || typeof point.z !== "number") return null;
  const size = Number(gridSize);
  const unit = Number(cellSize);
  if (!Number.isFinite(size) || size <= 0 || !Number.isFinite(unit) || unit === 0) return null;
  const center = (size + 1) / 2;
  const x = Math.max(1, Math.min(size, Math.round(point.x / unit + center)));
  const y = Math.max(1, Math.min(size, Math.round(point.z / unit + center)));
  return `cell-${x}-${y}`;
}

/** Every static prop the world's own fact rows place, resolved against
 *  `assetManifest` (data/mudiii-assets.json's own `assets` rows) by its
 *  `mgx:model` value — a fact row never carries a file path (see this
 *  module's header), so this JOIN is the one place a `destPath` enters the
 *  page. Each returned entry is `{ id, cell, model, rotation, asset }`;
 *  `asset` is the matching manifest row, or null when the world names a
 *  model the manifest carries no key for (an honest gap, never a guessed
 *  fallback model). `rotation` defaults to "0" for a prop whose row omits
 *  it. Only rows shaped `rdf:type prop` / `mgx:currently-in` / `mgx:model` /
 *  `mgx:rotation` are read; every other predicate on the same subject is
 *  ignored. Sorted by id for a stable, testable order. Pure. */
export function propPlacementsFrom(rows, assetManifest) {
  const byKey = new Map();
  for (const row of assetManifest || []) if (row && row.key) byKey.set(row.key, row);
  const bySubject = new Map();
  for (const row of rows || []) {
    if (!row || !row.subject) continue;
    if (
      row.predicate !== "rdf:type" && row.predicate !== "mgx:currently-in"
      && row.predicate !== "mgx:model" && row.predicate !== "mgx:rotation"
    ) continue;
    if (!bySubject.has(row.subject)) bySubject.set(row.subject, { id: row.subject });
    const entry = bySubject.get(row.subject);
    if (row.predicate === "rdf:type") entry.type = row.object;
    else if (row.predicate === "mgx:currently-in") entry.cell = row.object;
    else if (row.predicate === "mgx:model") entry.model = row.object;
    else if (row.predicate === "mgx:rotation") entry.rotation = row.object;
  }
  const placements = [];
  for (const entry of bySubject.values()) {
    if (entry.type !== "prop" || !entry.cell || !entry.model) continue;
    placements.push({
      id: entry.id, cell: entry.cell, model: entry.model,
      rotation: entry.rotation || "0",
      asset: byKey.get(entry.model) || null,
    });
  }
  placements.sort((a, b) => a.id.localeCompare(b.id));
  return placements;
}

/** Every cell an agent or an item currently sits on, as a `Set<string>` —
 *  the page's own quick "is anything here at all" read, e.g. for a map dot
 *  pass that wants to know which cells to draw without walking two lists
 *  twice. `agents`/`items` are plain arrays of `{ id, cell, ... }` (the
 *  shape every tick's `agents`/`items` map turns into once the page
 *  flattens it — see this file's own header on why the engine's per-turn
 *  payload is keyed by id rather than an array). Pure. */
export function occupiedCells(agents, items) {
  const cells = new Set();
  for (const agent of agents || []) if (agent && agent.cell) cells.add(agent.cell);
  for (const item of items || []) if (item && item.cell) cells.add(item.cell);
  return cells;
}

/** Why a click-to-move or a food placement on `cell` would be refused, or
 *  null when it is clear — `"cell-4-3 is blocked"`, worded once so both the
 *  3D raycast click and a typed "go there" chat verb read the same refusal.
 *  A cell is blocked by a static prop (`props`, `propPlacementsFrom`'s own
 *  shape) or by any live agent standing on it — never by a loose food item,
 *  which the fixture's own readme notes a prop blocks movement and an item
 *  does not. Pure. */
export function blockedCellReason(cell, props, agents) {
  const byProp = (props || []).some((p) => p && p.cell === cell);
  const byAgent = (agents || []).some((a) => a && a.cell === cell);
  if (byProp || byAgent) return `${cell} is blocked`;
  return null;
}

/** The camera's own position/target for `mode` ("follow" | "pov" |
 *  "overhead") against `agent` (`{ cell, facing, ... }`, or null/absent for
 *  overhead) and a `gridSize`-square board. Pure geometry only — no three.js
 *  object is built or referenced here, so the scene track can hand this
 *  straight to whatever camera primitive it uses. Assumes a one-world-unit
 *  cell (the scene track's own baseline scale; every model in
 *  data/mudiii-assets.json ships `targetHeight` in the same metres-per-unit
 *  convention), which is why this takes no separate `cellSize` the way
 *  `cellToWorld` does.
 *
 *  "overhead" ignores `agent` entirely and looks straight down at the
 *  board's own centre. "follow" sits back and above the agent's cell, offset
 *  opposite its facing, looking at the agent. "pov" sits AT the agent's cell
 *  at eye height, looking the way it is facing. Returns null when a
 *  non-overhead mode is asked for with no agent (or an agent standing on no
 *  cell) to rig against. Pure, self-contained — calls `cellToWorld` by bare
 *  name, spliced alongside it. */
export function cameraRigFor(mode, agent, gridSize) {
  const cellSize = 1;
  if (mode === "overhead") {
    const height = Math.max(4, Number(gridSize) || DEFAULT_GRID_SIZE) * 1.4;
    return { mode: "overhead", position: { x: 0, y: height, z: 0 }, lookAt: { x: 0, y: 0, z: 0 } };
  }
  if (!agent || !agent.cell) return null;
  const world = cellToWorld(agent.cell, gridSize, cellSize);
  if (!world) return null;
  const FACING_VECTOR = {
    north: { x: 0, z: -1 }, south: { x: 0, z: 1 }, east: { x: 1, z: 0 }, west: { x: -1, z: 0 },
  };
  const dir = FACING_VECTOR[agent.facing] || FACING_VECTOR[DEFAULT_FACING];
  if (mode === "pov") {
    return {
      mode: "pov",
      position: { x: world.x, y: 1.6, z: world.z },
      lookAt: { x: world.x + dir.x * 4, y: 1.4, z: world.z + dir.z * 4 },
    };
  }
  return {
    mode: "follow",
    position: { x: world.x - dir.x * 4, y: 3.2, z: world.z - dir.z * 4 },
    lookAt: { x: world.x, y: 0.8, z: world.z },
  };
}

/** The deck's most valuable pure function: what the camera should do THIS
 *  turn given `prev`'s own selection (`{ mode, selectedId, status }`), the
 *  live `agents` (flattened `{ id, cell, ... }[]`, this turn's survivors),
 *  and `ecology` (this turn's tagged-union events, the shape
 *  test/fixtures/mudiii-ticks.json's own `_readme.ecology` documents). Five
 *  cases:
 *    1. nothing is followed (`prev.selectedId` is null/empty) — unchanged,
 *       no status line;
 *    2. the followed agent is still on the board — unchanged, no status
 *       line (a live follow never re-announces itself every turn);
 *    3. it was the PREY of an `eat-agent` event this turn — falls back to
 *       overhead, naming predator and prey;
 *    4. it was the agent of a `starve` event this turn — falls back to
 *       overhead, naming the starvation;
 *    5. it is simply missing with no ecology event to explain it (a recast,
 *       a reset) — falls back to overhead with a generic "left the board"
 *       status, rather than staying silent about an agent the dropdown can
 *       no longer find.
 *  Pure. */
export function nextCameraSelection(prev, agents, ecology) {
  const current = prev || { mode: "overhead", selectedId: null, status: null };
  if (!current.selectedId) return { mode: current.mode, selectedId: current.selectedId, status: null };
  const stillHere = (agents || []).some((a) => a && a.id === current.selectedId);
  if (stillHere) return { mode: current.mode, selectedId: current.selectedId, status: null };
  for (const event of ecology || []) {
    if (event && event.type === "eat-agent" && event.prey === current.selectedId) {
      return {
        mode: "overhead", selectedId: null,
        status: `${event.predator} ate ${event.prey} — switching to overhead`,
      };
    }
    if (event && event.type === "starve" && event.agent === current.selectedId) {
      return { mode: "overhead", selectedId: null, status: `${event.agent} starved — switching to overhead` };
    }
  }
  return {
    mode: "overhead", selectedId: null,
    status: `${current.selectedId} left the board — switching to overhead`,
  };
}

/** Every agent and item's own dot for the 2D top-down map panel, as
 *  percentage coordinates within a square panel (`{ id, kind, xPct, yPct
 *  }[]`) — never pixel values, so the panel's own CSS controls its actual
 *  size. `agents`/`items` are flattened `{ id, cell, ... }[]`; an agent's
 *  `kind` is its own `role` field (predator/prey) and an item's is its own
 *  `kind` field (crumb/morsel) — the caller's tick payload already carries
 *  both under those exact names. An entry with no parseable cell is
 *  dropped rather than drawn at a guessed position. Pure, self-contained. */
export function mapDotsFor(agents, items, gridSize) {
  function percentFor(cell) {
    const match = /^cell-(\d+)-(\d+)$/.exec(String(cell == null ? "" : cell));
    if (!match) return null;
    const size = Number(gridSize);
    if (!Number.isFinite(size) || size <= 0) return null;
    return { xPct: ((Number(match[1]) - 0.5) / size) * 100, yPct: ((Number(match[2]) - 0.5) / size) * 100 };
  }
  const dots = [];
  for (const agent of agents || []) {
    const pct = agent && percentFor(agent.cell);
    if (pct) dots.push({ id: agent.id, kind: agent.role || "agent", xPct: pct.xPct, yPct: pct.yPct });
  }
  for (const item of items || []) {
    const pct = item && percentFor(item.cell);
    if (pct) dots.push({ id: item.id, kind: item.kind || "item", xPct: pct.xPct, yPct: pct.yPct });
  }
  return dots;
}

/** Every static prop's own filled cell for the 2D map panel, as percentage
 *  coordinates within the same square board `mapDotsFor` draws into
 *  (`{ id, xPct, yPct, sizePct }[]`). `props` is `propPlacementsFrom`'s own
 *  output. A block is drawn from the cell's own top-left corner and fills it,
 *  so the offset is `- 1` where `mapDotsFor`'s dot, centred on the cell, takes
 *  `- 0.5`. A placement with no parseable cell is dropped rather than drawn at
 *  a guessed position. Pure, self-contained. */
export function mapBlocksFor(props, gridSize) {
  const size = Number(gridSize);
  if (!Number.isFinite(size) || size <= 0) return [];
  const blocks = [];
  for (const prop of props || []) {
    const match = /^cell-(\d+)-(\d+)$/.exec(String(prop && prop.cell != null ? prop.cell : ""));
    if (!match) continue;
    blocks.push({
      id: prop.id,
      xPct: ((Number(match[1]) - 1) / size) * 100,
      yPct: ((Number(match[2]) - 1) / size) * 100,
      sizePct: 100 / size,
    });
  }
  return blocks;
}

/** One HUD card's own field set, read off `agent` (`{ id, role, goal, mood,
 *  plan, mass, belief }`, this turn's slice of the tick payload) and a
 *  resolved `mudiiiConfig` (DEFAULT_GAME_CONFIG.mudiii's own shape). `massPct`
 *  is null whenever the role carries no mass ceiling to scale against
 *  (mirrors game-config.mjs's own `mudiiiMassScaleFor`, reimplemented here
 *  rather than imported so this stays `.toString()`-splice safe with no
 *  closed-over module). `planText` reads "holding" for an empty plan, the
 *  same wording spider-fly-viz.mjs's own `planLineHtml` uses. `beliefEntries`
 *  is `Object.entries(agent.belief)` unmodified — the caller renders it,
 *  this only shapes it. Pure. */
export function hudCardFieldsFor(agent, config) {
  const role = agent && agent.role ? agent.role : null;
  const scale = role === "predator" ? config?.predatorInitialMass : role === "prey" ? config?.preyInitialMass : null;
  const mass = agent && typeof agent.mass === "number" ? agent.mass : null;
  const massPct = scale && mass !== null ? Math.max(0, Math.min(100, Math.round((mass / scale) * 100))) : null;
  const plan = agent && Array.isArray(agent.plan) ? agent.plan : [];
  return {
    id: agent ? agent.id : null,
    role,
    goal: (agent && agent.goal) || "",
    mood: (agent && agent.mood) || "",
    mass,
    massPct,
    planText: plan.length ? plan.join(" → ") : "holding",
    beliefEntries: agent && agent.belief ? Object.entries(agent.belief) : [],
  };
}

/** The animation clip name for `action` (an engine-level rung/event word —
 *  "wander", "chase", "evade", "forage", "eat-agent", "eat-item", "starve")
 *  against one creature's own `clipMap` (data/mudiii-assets.json's `clips`
 *  object for that asset — `{ idle, walk, run, attack, hit, death, eat }`,
 *  some values themselves arrays). `role` is the engine's predator/prey tag,
 *  which only matters for `eat-agent`: the predator plays its attack, the
 *  prey (briefly still animate the instant it is caught) plays its death.
 *  Falls back to `clipMap.idle`, then null, for an action/role combination
 *  the map carries no clip for (goblin.glb ships no "eat" clip — see the
 *  manifest's own row — so `clipForAction("prey", "eat-item", ...)` lands on
 *  idle rather than a guessed name). An array-valued clip (the two rigs'
 *  own `hit` list) returns its first entry. Pure, self-contained. */
export function clipForAction(role, action, clipMap) {
  const clips = clipMap || {};
  const kindFor = {
    wander: "walk",
    forage: "walk",
    driven: "walk",
    chase: "run",
    evade: "run",
    "eat-agent": role === "predator" ? "attack" : "death",
    "eat-item": "eat",
    starve: "death",
    death: "death",
    idle: "idle",
  };
  const wanted = kindFor[action] || "idle";
  const clip = clips[wanted];
  const resolved = Array.isArray(clip) ? clip[0] : clip;
  return resolved || clips.idle || null;
}

/** One HUD card's whole markup, character-agnostic — mirrors mud-viz.mjs's
 *  own `paneMarkup`: which agent it shows is stamped in at render time
 *  (`data-agent`, the id/role text), so the row can be rebuilt for a
 *  different cast without a second template living anywhere else. `slot` is
 *  an opaque per-card key (the page uses the agent's position in the sorted
 *  id list); this function reads nothing from it beyond namespacing its own
 *  element ids. Pure, self-contained (escapeHtml is spliced alongside it). */
export function agentCardMarkup(slot) {
  const w = `hud-${escapeHtml(String(slot))}`;
  return `<div class="hud-card" id="${w}" data-slot="${escapeHtml(String(slot))}" data-agent="">
      <div class="hud-card-head">
        <span class="hud-card-id mono" id="${w}-id"></span>
        <span class="hud-card-role mono" id="${w}-role"></span>
      </div>
      <div class="hud-meter" id="${w}-meter"><div class="hud-meter-fill" id="${w}-meter-fill"></div></div>
      <p class="hud-goal" id="${w}-goal"></p>
      <p class="hud-plan mono" id="${w}-plan"></p>
      <button type="button" class="hud-belief-toggle" id="${w}-belief-toggle"
              aria-expanded="false" aria-controls="${w}-detail" hidden>
        <span class="hud-belief mono" id="${w}-belief"></span>
      </button>
      <div class="hud-detail mono" id="${w}-detail" hidden></div>
    </div>`;
}

/** The self-contained mudiii.html page. Pure — identical output for
 *  identical input; the live world, the ticking simulation and the 3D scene
 *  are all computed in the browser once the sibling bundle loads.
 *
 *  `worldPayload` is `{ name, facts, rules, opening }`, the same shape every
 *  other viz page's world payload takes. `agents` is the roster this page
 *  may cast from, `[{ id, role }]` (role is "predator" or "prey" — see
 *  MUDIII_ROLES). `scenarios` is `[{ label, worldPayload, agents, gridSize }]`
 *  — a page given none is the one-square case and ships no dropdown, the
 *  same rule mud-viz.mjs's own renderMudHtml follows. `assetManifest` is
 *  data/mudiii-assets.json's own `assets` rows, embedded as page data and
 *  resolved client-side by `propPlacementsFrom` — this is the one parameter
 *  mud-viz.mjs's renderMudHtml has no equivalent of, because mud.html has no
 *  file-backed models to resolve. `mudiiiConfig` defaults to
 *  game-config.mjs's own DEFAULT_GAME_CONFIG.mudiii. `engineBundleJs` inlines
 *  the built browser bundle instead of a sibling `<script src>`, the same
 *  standalone-export knob every other viz page carries. */
export function renderMudiiiHtml({
  title = DEFAULT_TITLE,
  worldPayload,
  agents = [],
  scenarios = [],
  assetManifest = [],
  mudiiiConfig = DEFAULT_GAME_CONFIG.mudiii,
  engineBundleJs = "",
} = {}) {
  const scenarioList = scenarios.length
    ? scenarios
    : [{ label: scenarioLabel(worldPayload?.name), worldPayload, agents }];
  const opening = scenarioList[0];
  const openingAgents = opening.agents || [];
  const gridSize = opening.gridSize || DEFAULT_GRID_SIZE;

  const pageData = embedJson({
    scenarios: scenarioList, assetManifest, mudiiiConfig,
    playerCounts: PLAYER_COUNTS,
    defaultPlayerCount: DEFAULT_PLAYER_COUNT,
    defaultNpcCount: DEFAULT_NPC_COUNT,
    defaultDelayMs: DEFAULT_DELAY_MS,
    defaultMaxTurns: DEFAULT_MAX_TURNS,
    gridSize,
    defaultFacing: DEFAULT_FACING,
    cameraModes: CAMERA_MODES,
  });

  const sceneScript = mudiiiSceneScript({ canvasId: "sceneCanvas", statusId: "sceneStatus", gridSize, cellSize: 1 });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${engineBundleJs ? "" : `<link rel="icon" href="./favicon.svg" type="image/svg+xml">
<link rel="icon" href="./favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="./apple-touch-icon.png">`}
<style>
${THEME_TOKENS_CSS}
${MUDIII_STYLE}
${PILL_COMPLETE_CSS}
</style>
</head>
<body>
<main>
  <header class="mudiii-topbar">
    <h1 class="eyebrow">tmct &middot; mudiii</h1>
    <a class="mudiii-topbar-help" href="./help.html" target="_blank" rel="noopener"
       title="how this demo works, in a new tab" aria-label="how this demo works, opens in a new tab">?</a>
  </header>
  <div class="deck-row">
    <section class="deck" aria-label="simulation controls">
      <div class="deck-controls">
        <button type="button" class="deck-play" id="autoToggle" aria-pressed="false">&#9654; play</button>
        <button type="button" id="resetBtn">reset</button>
${scenarioList.length > 1 ? `        <select id="scenarioSelect" class="deck-select" aria-label="which town square to play">
${scenarioList.map((s, i) => `          <option value="${i}"${i === 0 ? " selected" : ""}>${escapeHtml(s.label || scenarioLabel(s.worldPayload?.name))}</option>`).join("\n")}
        </select>` : ""}
        <button type="button" id="editModeBtn" aria-pressed="false">edit</button>
        <button type="button" class="deck-info-btn" id="deckInfoBtn" aria-expanded="false" aria-controls="deckInfoPopup" aria-label="about this demo">?</button>
        <span class="mono deck-turns" id="globalTurnCount">turns: 0</span>
      </div>
      <div class="deck-body">
        <div class="deck-sliders">
          <label class="deck-slider">foxes
            <input type="range" id="playerCountSlider" min="0" max="${PLAYER_COUNTS.length - 1}" step="1"
                   value="${Math.max(0, PLAYER_COUNTS.indexOf(DEFAULT_PLAYER_COUNT))}"
                   list="playerCountTicks" aria-valuetext="${DEFAULT_PLAYER_COUNT} foxes">
            <datalist id="playerCountTicks">${PLAYER_COUNTS.map((n, i) => `<option value="${i}" label="${n}"></option>`).join("")}</datalist>
            <span class="mono" id="playerCountValue">${DEFAULT_PLAYER_COUNT}</span>
          </label>
          <label class="deck-slider">goblins
            <input type="range" id="npcCountSlider" min="${NPC_COUNT_MIN}" max="${NPC_COUNT_MAX}" step="1"
                   value="${DEFAULT_NPC_COUNT}"
                   list="npcCountTicks" aria-valuetext="${DEFAULT_NPC_COUNT} goblins">
            <datalist id="npcCountTicks">${Array.from({ length: NPC_COUNT_MAX - NPC_COUNT_MIN + 1 }, (_, i) => {
              const n = NPC_COUNT_MIN + i;
              return NPC_COUNT_LABELLED.includes(n) ? `<option value="${n}" label="${n}"></option>` : `<option value="${n}"></option>`;
            }).join("")}</datalist>
            <span class="mono" id="npcCountValue">${DEFAULT_NPC_COUNT}</span>
          </label>
          <label class="deck-slider">delay
            <input type="range" id="delaySlider" min="80" max="2000" step="20" value="${DEFAULT_DELAY_MS}">
            <span class="mono" id="delayValue">${DEFAULT_DELAY_MS}ms</span>
          </label>
          <label class="deck-slider">max turns
            <input type="range" id="maxTurnsSlider" min="20" max="2000" step="20" value="${DEFAULT_MAX_TURNS}">
            <span class="mono" id="maxTurnsValue">${DEFAULT_MAX_TURNS}</span>
          </label>
        </div>
        <section class="map-panel" id="mapPanel" aria-label="the town square, from above">
          <div class="map-panel-head">
            <span class="map-panel-title">the square, from above</span>
            <span class="mono map-panel-turn" id="mapPanelTurn">turn 0</span>
          </div>
          <div class="map-panel-board" id="mapPanelBoard"></div>
          <div class="map-legend">
            <span class="map-key"><i class="map-swatch map-swatch-predator"></i>predator</span>
            <span class="map-key"><i class="map-swatch map-swatch-prey"></i>prey</span>
            <span class="map-key"><i class="map-swatch map-swatch-food"></i>food</span>
            <span class="map-key"><i class="map-swatch map-swatch-prop"></i>building</span>
          </div>
        </section>
      </div>
      <div class="deck-camera">
        <label class="deck-slider">follow
          <select id="agentSelect" class="deck-select" aria-label="which agent to follow"
                  aria-describedby="agentSelectHint">
${openingAgents.map((a) => `            <option value="${escapeHtml(a.id)}">${escapeHtml(a.id)}</option>`).join("\n")}
          </select>
        </label>
        <span class="deck-hint" id="agentSelectHint" hidden>pause to swap</span>
        <div class="camera-mode" id="cameraMode" role="group" aria-label="camera mode">
          <button type="button" data-mode="follow" aria-pressed="true">follow</button>
          <button type="button" data-mode="pov" aria-pressed="false">pov</button>
          <button type="button" data-mode="overhead" aria-pressed="false">overhead</button>
        </div>
        <button type="button" class="pill affordance" id="foodPill" data-command="place food" aria-pressed="false">place food</button>
      </div>
      <div class="deck-info-popup mudiii-note" id="deckInfoPopup" role="dialog" aria-label="about this demo" hidden>
        ${MUDIII_NOTE_LINES.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n        ")}
        <button type="button" class="deck-info-popup-close" id="deckInfoClose" aria-label="close">&times;</button>
      </div>
    </section>
  </div>
  <section class="scene-stage" id="sceneStage" aria-label="the town square, in three dimensions">
    <canvas id="sceneCanvas"></canvas>
    <div class="dir-ring" id="driveRing" role="group" aria-label="walk the agent the camera follows">
${RING_POINTS.map((point) => `      <span class="dir-slot dir-${point}"><button type="button" class="dir-pill" data-drive="${point}" title="walk ${point}" aria-label="walk ${point}" aria-pressed="false">${escapeHtml(point)}</button></span>`).join("\n")}
    </div>
    <p class="scene-status" id="sceneStatus" role="status"></p>
  </section>
  <div class="edit-stage" id="mudiiiEditStage" aria-label="the square's own facts, in plain sentences">
    <section class="edit-text" aria-label="the world's facts as editable sentences">
      <h2>the square, in plain sentences</h2>
      <p class="edit-lede">Every fact this world is built from. Change a line and the square changes with it.</p>
      <textarea id="editorText" spellcheck="false" aria-label="the world's own facts as plain sentences, one per line"></textarea>
      <div class="chatpills" id="editorPills" aria-label="related words for the term before the cursor"></div>
      <p class="edit-status" id="editorStatus" role="status"></p>
    </section>
    <aside class="edit-side" aria-label="who and what stands where">
      <section class="edit-panel">
        <h2>who and what stands where</h2>
        <div class="edit-placements" id="editPlacements"></div>
      </section>
    </aside>
  </div>
  <section class="mudiii-chat" aria-label="talk to the square">
    <div class="chatlog" id="chatLog" aria-live="polite"></div>
    <div class="log-popup" id="chatLogPopup" role="dialog" aria-label="the whole reply" hidden>
      <p class="log-popup-text" id="chatLogPopupText"></p>
      <button type="button" class="log-popup-close" id="chatLogPopupClose" aria-label="close the whole reply">&times;</button>
    </div>
    <div class="chat-console">
      <div class="pill-strip">
        <div class="chatpills" id="chatPills" role="group" aria-label="quick commands"></div>
      </div>
      <form class="chatask" id="chatForm">
        <span class="prompt mono">tmct&gt;</span>
        ${pillCompleteMarkup({
          inputId: "chatInput",
          inputHtml: '<input id="chatInput" type="text" placeholder="@fox the goblin is east" aria-label="type a command" disabled>',
        })}
      </form>
    </div>
  </section>
  <div class="hud-row" id="hudRow" aria-label="every agent's own status"></div>
</main>
<script>
const MUDIII_PAGE_DATA = ${pageData};
</script>
${sceneScript ? `<script>\n${embedScriptText(sceneScript)}\n</script>` : ""}
${engineBundleJs ? `<script>\n${embedScriptText(engineBundleJs)}\n</script>` : `<script src="./mudiii-browser.bundle.js"></script>`}
<script>
${embedScriptText(pageScript())}
</script>
</body>
</html>
`;
}

const MUDIII_STYLE = `
  :root {
    --square-sky: #BFE3F0; --square-horizon: #E9D9B6; --square-stone: #8C8172;
    --square-stone-dark: #59503F; --square-thatch: #B5702E; --parchment: #F3ECDD;
    --square-ink: #2B2318; --square-accent: #D98A2B; --square-grass: #7C9A5B;
    --square-predator: #B5502C; --square-prey: #4E7C5B;
  }
  html { background: var(--square-stone-dark); }
  body { margin: 0; background: linear-gradient(180deg, var(--square-sky) 0%, var(--square-horizon) 40%, var(--square-stone) 100%) fixed; color: var(--square-ink); font-family: ${SANS_STACK}; font-size: 15px; line-height: 1.5; }
  .mono { font-family: ${MONO_STACK}; }
  main { max-width: 1280px; margin: 0 auto; padding: 1.1rem 1.2rem 2.4rem; }
  .eyebrow { font-family: ${MONO_STACK}; font-weight: 500; font-size: .72rem; letter-spacing: .16em; text-transform: uppercase; color: var(--square-ink); opacity: .85; margin: 0; }
  h2 { font-family: ${DISPLAY_STACK}; font-size: 1rem; margin: 0; }
  h3 { font-family: ${MONO_STACK}; font-size: .58rem; margin: 0 0 .3rem; text-transform: uppercase; letter-spacing: .12em; color: var(--square-stone-dark); }
  button { font: inherit; color: inherit; background: none; cursor: pointer; }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--square-accent); outline-offset: 2px; }
  button:disabled { opacity: .4; cursor: default; }

  .mudiii-topbar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; margin: 0 0 .8rem; }
  .mudiii-topbar-help {
    background: var(--parchment); color: var(--square-ink); border: 1px solid var(--square-stone-dark); border-radius: 3px;
    padding: .32rem .55rem; text-decoration: none; font-size: .82rem; line-height: 1.2;
  }
  .mudiii-topbar-help:hover { border-color: var(--square-accent); }

  .deck-row { margin-bottom: 1rem; }
  .deck {
    position: relative;
    background: var(--parchment); border: 1px solid var(--square-stone-dark); border-radius: 4px;
    box-shadow: 0 2px 0 rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.35);
    padding: .8rem .9rem; display: flex; flex-direction: column; gap: .55rem; min-width: 0;
  }
  .deck-controls, .deck-camera { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
  .deck-info-btn {
    font-family: ${MONO_STACK}; font-size: .78rem; line-height: 1; width: 1.5rem; height: 1.5rem;
    border-radius: 50%; border: 1px solid var(--square-stone-dark); background: rgba(255,255,255,.5);
    color: var(--square-stone-dark); padding: 0; flex: 0 0 auto;
  }
  .deck-info-btn:hover, .deck-info-btn[aria-expanded="true"] { border-color: var(--square-accent); color: var(--square-ink); }
  .deck button, .camera-mode button {
    font-family: ${MONO_STACK}; font-size: .72rem; text-transform: uppercase; letter-spacing: .08em;
    padding: .32rem .7rem; border: 1px solid var(--square-stone-dark); border-radius: 3px; background: rgba(255,255,255,.5);
  }
  .deck button:hover:not(:disabled), .camera-mode button:hover:not(:disabled) { border-color: var(--square-accent); }
  .deck-select {
    font-family: ${MONO_STACK}; font-size: .72rem; text-transform: uppercase; letter-spacing: .08em;
    padding: .32rem .7rem; border: 1px solid var(--square-stone-dark); border-radius: 3px;
    background: rgba(255,255,255,.5); color: var(--square-ink);
    /* A select is as wide as its longest option, and a square's label runs to
       "town square (12x12, 1 fox, 3 goblins)" — on a phone that alone made the
       whole page scroll sideways. */
    min-width: 0; max-width: 100%;
  }
  #scenarioSelect { flex: 1 1 9rem; }
  .deck-select:hover { border-color: var(--square-accent); }
  .deck-select:disabled { opacity: .45; cursor: default; }
  .deck-select:disabled:hover { border-color: var(--square-stone-dark); }
  .deck-hint { font-family: ${MONO_STACK}; font-size: .58rem; text-transform: uppercase; letter-spacing: .08em; color: var(--square-stone-dark); }
  .deck-hint[hidden] { display: none; }
  .deck-play { background: var(--square-ink) !important; color: var(--parchment); border-color: var(--square-ink) !important; padding: .38rem 1.1rem !important; }
  .deck-play[aria-pressed="true"] { background: var(--square-accent) !important; border-color: var(--square-accent) !important; color: var(--square-ink); }
  .deck-turns { margin-left: auto; font-size: .74rem; color: var(--square-stone-dark); background: var(--square-stone-dark); background: rgba(43,35,24,.9); color: var(--square-accent); border-radius: 2px; padding: .1rem .5rem; }
  .deck-body { display: flex; gap: .7rem; align-items: flex-start; }
  .deck-sliders { display: flex; flex-wrap: wrap; gap: 1rem; flex: 1 1 auto; min-width: 0; }
  .deck-slider { display: flex; align-items: center; gap: .35rem; font-family: ${MONO_STACK}; font-size: .62rem; text-transform: uppercase; letter-spacing: .08em; color: var(--square-stone-dark); min-width: 0; }
  .deck-slider input[type="range"] { accent-color: var(--square-accent); flex: 1 1 4rem; min-width: 2.5rem; width: auto; max-width: 8rem; }
  .camera-mode { display: inline-flex; gap: .25rem; }
  .camera-mode button[aria-pressed="true"] { background: var(--square-accent); border-color: var(--square-accent); color: var(--square-ink); }
  .deck-info-popup {
    position: absolute; left: .9rem; right: .9rem; top: calc(100% + 8px); z-index: 8;
    background: var(--square-stone-dark); color: var(--parchment);
    border: 1px solid var(--square-accent); border-radius: 4px;
    padding: .55rem 1.6rem .6rem .65rem; box-shadow: 0 8px 18px rgba(0,0,0,.5);
  }
  .deck-info-popup::before {
    content: ""; position: absolute; left: 1.1rem; top: -6px; width: 0; height: 0;
    border-left: 6px solid transparent; border-right: 6px solid transparent; border-bottom: 6px solid var(--square-accent);
  }
  .deck-info-popup p { margin: 0 0 .4rem; max-width: 62ch; font-size: .78rem; line-height: 1.4; }
  .deck-info-popup p:last-child { margin-bottom: 0; }
  .deck-info-popup-close { position: absolute; top: .1rem; right: .3rem; font-size: 1rem; line-height: 1; color: var(--parchment); padding: .1rem .2rem; }
  .deck-info-popup-close:hover { color: var(--square-accent); }

  .map-panel {
    background: var(--square-stone-dark); color: var(--parchment);
    border: 1px solid var(--square-accent); border-radius: 4px; padding: .5rem .55rem .55rem;
    display: flex; flex-direction: column; gap: .35rem; min-width: 0;
    flex: 0 0 50%; max-width: 50%;
  }
  .map-panel-head { display: flex; justify-content: space-between; align-items: baseline; gap: .4rem; }
  .map-panel-title { font-family: ${MONO_STACK}; font-size: .54rem; text-transform: uppercase; letter-spacing: .1em; opacity: .85; }
  .map-panel-turn { font-size: .58rem; opacity: .7; }
  .map-panel-board {
    position: relative; flex: 1; min-height: 110px; aspect-ratio: 1;
    --map-cell-pct: 8.3333%;
    background-color: rgba(124,154,91,.25);
    background-image:
      repeating-linear-gradient(90deg, rgba(233,217,182,.22) 0 1px, transparent 1px var(--map-cell-pct)),
      repeating-linear-gradient(180deg, rgba(233,217,182,.22) 0 1px, transparent 1px var(--map-cell-pct));
    border: 1px solid rgba(233,217,182,.35); border-radius: 3px;
  }
  .map-block { position: absolute; box-sizing: border-box; background: rgba(89,80,63,.9); border: 1px solid rgba(0,0,0,.35); border-radius: 1px; }
  .map-dot { position: absolute; width: .55rem; height: .55rem; margin: -.28rem 0 0 -.28rem; border-radius: 50%; border: 1px solid rgba(0,0,0,.4); }
  .map-dot-predator { background: var(--square-predator); }
  .map-dot-prey { background: var(--square-prey); }
  .map-dot-crumb, .map-dot-morsel, .map-dot-item { background: var(--square-accent); width: .34rem; height: .34rem; margin: -.17rem 0 0 -.17rem; }
  .map-label {
    position: absolute; margin: -.66rem 0 0 .26rem; font-size: .44rem; line-height: 1; letter-spacing: .02em;
    color: var(--parchment); text-shadow: 0 1px 2px rgba(0,0,0,.85); white-space: nowrap; pointer-events: none;
  }
  /* Plain inline-block swatches, never .map-dot: that class is absolutely
     positioned with a centring margin, so a legend reusing it would position
     against the board and disappear. */
  .map-legend { display: flex; flex-wrap: wrap; gap: .12rem .5rem; font-family: ${MONO_STACK}; font-size: .5rem; text-transform: uppercase; letter-spacing: .08em; opacity: .85; }
  .map-key { display: inline-flex; align-items: center; gap: .24rem; }
  .map-swatch { display: inline-block; width: .45rem; height: .45rem; border-radius: 50%; border: 1px solid rgba(0,0,0,.4); }
  .map-swatch-predator { background: var(--square-predator); }
  .map-swatch-prey { background: var(--square-prey); }
  .map-swatch-food { background: var(--square-accent); }
  .map-swatch-prop { background: rgba(89,80,63,.9); border-radius: 1px; }

  .scene-stage { position: relative; margin-bottom: 1rem; border: 1px solid var(--square-stone-dark); border-radius: 4px; overflow: hidden; background: #10161B; min-height: 360px; }
  .scene-stage canvas { display: block; width: 100%; height: 360px; }
  .scene-status {
    position: absolute; left: .6rem; bottom: .6rem; margin: 0; max-width: calc(100% - 1.2rem);
    font-family: ${MONO_STACK}; font-size: .68rem; color: var(--parchment); background: rgba(43,35,24,.78);
    border-radius: 3px; padding: .28rem .55rem;
  }
  .scene-status:empty { display: none; }

  /* Each press sits where it points, mud.html's own ring idiom. */
  .dir-ring { position: absolute; inset: .3rem; pointer-events: none; }
  .dir-ring[hidden] { display: none; }
  .dir-slot { position: absolute; pointer-events: auto; }
  .dir-north { top: 0; left: 50%; transform: translateX(-50%); }
  .dir-south { bottom: 0; left: 50%; transform: translateX(-50%); }
  .dir-west { left: 0; top: 50%; transform: translateY(-50%); }
  .dir-east { right: 0; top: 50%; transform: translateY(-50%); }
  .dir-northwest { top: 0; left: 0; }
  .dir-northeast { top: 0; right: 0; }
  .dir-southwest { bottom: 0; left: 0; }
  .dir-southeast { bottom: 0; right: 0; }
  .dir-pill {
    font-family: ${MONO_STACK}; font-size: .58rem; letter-spacing: .06em; line-height: 1;
    padding: .24rem .42rem; border-radius: 2px; border: 1px solid var(--square-stone-dark);
    background: var(--parchment); color: var(--square-ink); white-space: nowrap;
  }
  .dir-pill:hover:not(:disabled) { border-color: var(--square-accent); background: var(--square-accent); }
  .dir-pill:disabled { opacity: .35; cursor: default; }

  .hud-row { display: flex; flex-wrap: wrap; gap: .7rem; margin-top: 1rem; }
  .hud-card {
    flex: 1 1 220px; min-width: 200px; max-width: 320px;
    background: var(--parchment); border: 1px solid var(--square-stone-dark); border-radius: 4px;
    box-shadow: 0 2px 0 rgba(0,0,0,.18); padding: .55rem .65rem; display: flex; flex-direction: column; gap: .3rem;
  }
  .hud-card-head { display: flex; align-items: baseline; justify-content: space-between; gap: .4rem; }
  .hud-card-id { font-size: .78rem; font-weight: 600; }
  .hud-card-role { font-size: .6rem; text-transform: uppercase; letter-spacing: .08em; color: var(--square-stone-dark); }
  .hud-meter { height: .4rem; background: rgba(0,0,0,.15); border-radius: 99px; overflow: hidden; }
  .hud-meter-fill { height: 100%; background: var(--square-accent); width: 0%; transition: width .3s ease; }
  .hud-goal { margin: 0; font-size: .74rem; }
  .hud-plan, .hud-belief { margin: 0; font-size: .62rem; color: var(--square-stone-dark); }
  .hud-belief-toggle { display: flex; align-items: baseline; gap: .25rem; width: 100%; text-align: left; padding: 0; border: 0; background: none; }
  .hud-belief-toggle[hidden] { display: none; }
  .hud-belief-toggle .hud-belief { flex: 1; min-width: 0; }
  .hud-belief-toggle::after { content: "\\25BE"; font-size: .55rem; color: var(--square-stone-dark); }
  .hud-belief-toggle[aria-expanded="true"]::after { content: "\\25B4"; }
  .hud-belief-toggle:hover .hud-belief, .hud-belief-toggle:hover::after { color: var(--square-ink); }
  .hud-detail { display: flex; flex-direction: column; gap: .1rem; font-size: .6rem; color: var(--square-stone-dark); border-top: 1px solid rgba(0,0,0,.12); padding-top: .25rem; }
  .hud-detail[hidden] { display: none; }
  @media (prefers-reduced-motion: reduce) { .hud-meter-fill { transition: none; } }

  .edit-stage { display: none; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 1rem; align-items: start; margin-bottom: 1rem; }
  body.editing .mudiii-chat, body.editing .scene-stage, body.editing .hud-row, body.editing .deck-row .map-panel { display: none; }
  body.editing .edit-stage { display: grid; }
  #editModeBtn[aria-pressed="true"] { background: var(--square-accent); border-color: var(--square-accent); }
  .edit-text, .edit-panel {
    background: var(--parchment); border: 1px solid var(--square-stone-dark); border-radius: 4px;
    box-shadow: 0 2px 0 rgba(0,0,0,.18); padding: .7rem .8rem; min-width: 0;
  }
  .edit-text { display: flex; flex-direction: column; gap: .45rem; }
  .edit-lede { margin: 0; font-size: .74rem; color: var(--square-stone-dark); max-width: 62ch; }
  #editorText {
    width: 100%; box-sizing: border-box; min-height: 22rem; flex: 1 1 auto; resize: vertical;
    font-family: ${MONO_STACK}; font-size: .74rem; line-height: 1.6;
    color: var(--square-ink); background: rgba(255,255,255,.6);
    border: 1px solid var(--square-stone-dark); border-radius: 3px; padding: .55rem .6rem;
  }
  .edit-status { margin: 0; font-family: ${MONO_STACK}; font-size: .62rem; min-height: 1.2em; color: var(--square-stone-dark); }
  .edit-status.pending { color: #9A5B12; }
  .edit-status.ok { color: #4E6B2E; }
  .edit-side { display: flex; flex-direction: column; gap: 1rem; min-width: 0; }
  .edit-panel { display: flex; flex-direction: column; gap: .35rem; }
  .edit-placements { display: flex; flex-direction: column; gap: .2rem; font-size: .74rem; }
  .edit-placement-row { display: flex; gap: .4rem; }
  .edit-empty { font-size: .74rem; font-style: italic; color: var(--square-stone-dark); }

  .mudiii-chat { background: var(--parchment); border: 1px solid var(--square-stone-dark); border-radius: 4px; box-shadow: 0 2px 0 rgba(0,0,0,.18); padding: .7rem .8rem; display: flex; flex-direction: column; gap: .5rem; }
  .chatlog { min-height: 8rem; max-height: 16rem; overflow-y: auto; }
  .chatlog > * { margin: 0 0 .32rem; }
  .chatlog:empty::after { content: "Type a command below and the answer lands here."; color: var(--square-stone-dark); font-style: italic; font-size: .72rem; }
  .chatlog .u { font-family: ${MONO_STACK}; font-size: .7rem; color: var(--square-stone-dark); overflow-wrap: anywhere; }
  .chatlog .u::before { content: "tmct> "; color: var(--square-accent); }
  .chatlog .a { font-size: .78rem; line-height: 1.4; }
  .log-popup {
    position: relative; z-index: 8; background: var(--square-stone-dark); color: var(--parchment);
    border: 1px solid var(--square-accent); border-radius: 4px; padding: .45rem 1.5rem .5rem .55rem;
  }
  .log-popup-text { margin: 0; font-size: .74rem; line-height: 1.4; }
  .log-popup-close { position: absolute; top: .1rem; right: .25rem; font-size: 1rem; line-height: 1; color: var(--parchment); padding: .1rem .2rem; }
  .chat-console { display: flex; flex-direction: column; gap: .3rem; }
  .chatask { display: flex; align-items: center; gap: .4rem; }
  .chatask .prompt { color: var(--square-accent); font-size: .7rem; }
  .chatask .pc-field { flex: 1; min-width: 0; }
  .chatask input {
    width: 100%; box-sizing: border-box; font-family: ${MONO_STACK}; font-size: .74rem; color: var(--square-ink);
    border: 1px solid var(--square-stone-dark); border-radius: 2px; padding: .3rem .5rem;
  }
  .chatpills { display: flex; flex-wrap: wrap; gap: .22rem; max-height: 3.9rem; overflow-y: auto; }
  .chatpills:empty { display: none; }
  .pill { font-family: ${MONO_STACK}; font-size: .58rem; padding: .14rem .45rem; border: 1px solid var(--square-stone-dark); border-radius: 99px; background: rgba(255,255,255,.5); white-space: nowrap; }
  .pill:hover:not(:disabled) { border-color: var(--square-accent); background: var(--square-accent); }
  .pill.affordance { border-style: dashed; border-color: var(--square-stone); }
  .pill.affordance[aria-pressed="true"] { background: var(--square-accent); border-style: solid; }
  /* The tick and the cross live in ::before so the tag stays on the screen and
     out of the submitted sentence — a clicked lie must be indistinguishable
     from a typed one by the time the lane reads it. */
  .pill[data-role="dyn-addr"][data-active="1"] { border-color: var(--taught); color: var(--taught); }
  .pill[data-role="dyn-claim"][data-truth="true"] { border-color: var(--taught); }
  .pill[data-role="dyn-claim"][data-truth="true"]::before { content: "\\2713 "; opacity: .55; }
  .pill[data-role="dyn-claim"][data-truth="false"] { border-style: dashed; border-color: var(--alert); }
  .pill[data-role="dyn-claim"][data-truth="false"]::before { content: "\\2715 "; opacity: .6; }

  @media (max-width: 900px) {
    .edit-stage { grid-template-columns: 1fr; }
    #editorText { min-height: 16rem; }
  }

  /* A landscape phone and a narrow desktop window are both under 900px but
     want different slider/map arrangements, so the split has to key off
     orientation as well as width. */
  @media (max-width: 900px) and (orientation: landscape) {
    .deck-sliders { display: grid; grid-template-columns: 1fr 1fr; gap: .4rem 1rem; }
    .deck-body { align-items: stretch; }
    .map-panel { flex-basis: 33%; max-width: 33%; }
    /* The board stays square here too. A stretched board moves every dot away
       from where its cell really is, and the panel's whole job is to be read
       against the 3D view — so the height problem gets a height fix (cap the
       square and centre it) rather than a distortion. */
    .map-panel-board { flex: 0 0 auto; width: min(100%, 108px); min-height: 0; margin: 0 auto; }
  }
`;

/** The inlined page script, spliced the same way mud-viz.mjs's own
 *  `pageScript` is: every helper this page needs client-side is listed at
 *  the top of the closure as a `const` binding built off that function's own
 *  `.toString()`. The scene track's own script (see `renderMudiiiHtml`'s
 *  `sceneScript`) is a SEPARATE, standalone `<script>` tag rather than one of
 *  these bindings — it is a whole IIFE of its own, not a helper function this
 *  page's closure calls into. */
function pageScript() {
  return `(function () {
  "use strict";
  const DATA = MUDIII_PAGE_DATA;
  const createTicker = ${createTicker.toString()};
  const createSerialQueue = ${createSerialQueue.toString()};
  const prefersReducedMotion = ${prefersReducedMotion.toString()};
  const escapeHtml = ${escapeHtml.toString()};
  const esc = escapeHtml;
  const appendLogLine = ${appendLogLine.toString()};
  const rowsForWorld = ${rowsForWorld.toString()};
  const renderMudEditorText = ${renderMudEditorText.toString()};
  const gridWorldEditorState = ${gridWorldEditorState.toString()};
  const wordBeforeCursor = ${wordBeforeCursor.toString()};
  const pillCandidates = ${pillCandidates.toString()};
  const matchPills = ${matchPills.toString()};
  const createPillComplete = ${createPillComplete.toString()};
  const roleOfAgentId = ${roleOfAgentId.toString()};
  const cellToWorld = ${cellToWorld.toString()};
  const cellFromGroundPoint = ${cellFromGroundPoint.toString()};
  const propPlacementsFrom = ${propPlacementsFrom.toString()};
  const occupiedCells = ${occupiedCells.toString()};
  const blockedCellReason = ${blockedCellReason.toString()};
  const cameraRigFor = ${cameraRigFor.toString()};
  const nextCameraSelection = ${nextCameraSelection.toString()};
  const mapDotsFor = ${mapDotsFor.toString()};
  const mapBlocksFor = ${mapBlocksFor.toString()};
  const hudCardFieldsFor = ${hudCardFieldsFor.toString()};
  const clipForAction = ${clipForAction.toString()};
  const agentCardMarkup = ${agentCardMarkup.toString()};
  const believedFactSentence = ${believedFactSentence.toString()};

  const el = (id) => document.getElementById(id);
  const SEED_COMMANDS = ["tick", "what does the fox see", "where is the goblin", "what can I do"];
  let scenarioIndex = 0;
  const scenario = function () { return DATA.scenarios[scenarioIndex]; };
  const gridSizeOf = function () { return scenario().gridSize || DATA.gridSize; };

  // ---- roster minting -----------------------------------------------------
  // The page asks for a COUNT and names the ids it is about to get back: the
  // engine mints <prefix>-1..N at seeded cells, so a slider can call for more
  // animals than the scenario's own opening cast carries and still be met. The
  // prefix is read off the scenario's own first agent of that role, so a square
  // that casts something other than foxes and goblins still names its cast
  // correctly. Drawing from the scenario's list instead capped every square at
  // whatever its layout happened to build, and a shuffled draw would leave two
  // loads of the same square with different casts.
  function rosterPrefixFor(s, role) {
    const first = (s.agents || []).find(function (a) { return a && a.role === role; });
    return first ? roleOfAgentId(first.id) : role;
  }
  function mintRoster(prefix, count) {
    const ids = [];
    for (let i = 1; i <= count; i += 1) ids.push(prefix + "-" + i);
    return ids;
  }

  let cast = [];
  let props = [];
  let agentsById = {};
  let itemsById = {};
  let globalTurn = 0;
  let maxTurns = DATA.defaultMaxTurns;
  let delayMs = DATA.defaultDelayMs;
  let session = null;
  let tickQueue = createSerialQueue();
  function serializeTick(fn) { return tickQueue.run(fn); }
  let camera = { mode: "follow", selectedId: null, status: null };
  // The mode a despawn fallback took away, held until the visitor picks
  // another agent. Without it, choosing someone new after a fox ate your
  // goblin leaves the camera overhead and the follow button unlit.
  let cameraModeBeforeFallback = null;
  let foodArmed = false;
  let livePills = [];
  let selectedAddresseeId = null;
  const expandedAgents = new Set();
  let pillComplete = null;
  let autoOn = false;
  let editing = false;
  let ticker = null;

  function hasNext() { return globalTurn < maxTurns; }
  const wait = function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
  const liveWait = function () { return wait(delayMs); };

  function agentsList() {
    return Object.keys(agentsById).map(function (id) { return Object.assign({ id: id }, agentsById[id]); });
  }
  function itemsList() {
    return Object.keys(itemsById).map(function (id) { return Object.assign({ id: id }, itemsById[id]); });
  }

  function setSceneStatus(text) {
    const node = el("sceneStatus");
    if (node) node.textContent = text || "";
  }

  // The scene track's own half of the frozen contract: window.mudiiiScene.
  // three.js is ~800 KB and can fail to vendor-load independently of
  // anything this page does, so every call is guarded the same way — a
  // missing or throwing scene must never take the map panel, the HUD, the
  // deck or the chat down with it.
  function callScene(method) {
    const scene = window.mudiiiScene;
    if (!scene || typeof scene[method] !== "function") return;
    try {
      return scene[method].apply(scene, Array.prototype.slice.call(arguments, 1));
    } catch (err) {
      setSceneStatus("the 3D scene hit an error and stopped updating \\u2014 the rest of the page still works.");
    }
  }

  function applyTickResult(result) {
    if (!result) return;
    // The engine owns the count. Anything that advances a turn — the deck, a
    // chat frame — lands here, so the page never keeps a rival tally.
    if (typeof result.turn === "number") globalTurn = result.turn;
    if (result.agents) agentsById = result.agents;
    if (result.items) itemsById = result.items;
    callScene("applyTick", {
      agents: result.agents, items: result.items, ecology: result.ecology, rungs: result.rungs,
    });
    const nextCamera = nextCameraSelection(camera, agentsList(), result.ecology || []);
    if (nextCamera.status && camera.mode !== "overhead") cameraModeBeforeFallback = camera.mode;
    camera = nextCamera;
    callScene("setCamera", camera);
    if (camera.status) setSceneStatus(camera.status);
  }

  async function runOneTick() {
    return serializeTick(async function () {
      if (!session) return null;
      const result = await session.tick();
      applyTickResult(result);
      renderAll();
      return result;
    });
  }

  function ensureTicker() {
    if (ticker) return ticker;
    ticker = createTicker({
      onTick: runOneTick,
      onRender: function (state) {
        const playBtn = el("autoToggle");
        playBtn.setAttribute("aria-pressed", state.playing ? "true" : "false");
        playBtn.textContent = state.playing ? "\\u23F8 pause" : "\\u25B6 play";
        // The follow control reads the ticker's own state, never a second
        // "am I playing" the page keeps for itself, so the two can never
        // disagree. It closes while the board plays because a redraw lands
        // on top of the open dropdown and loses the pick.
        el("agentSelect").disabled = state.playing;
        el("agentSelectHint").hidden = !state.playing;
      },
      hasNext: hasNext,
      wait: liveWait,
    });
    return ticker;
  }

  // ---- chat ------------------------------------------------------------
  function appendChat(cls, text) { appendLogLine(el("chatLog"), cls, text, { clip: true }); }

  function sendCommand(line) {
    appendChat("u", line);
    if (!session) { appendChat("a", "no session is open yet \\u2014 reset to start one."); return Promise.resolve(); }
    // A chat line can run a real turn. An addressed told-fact does, and the
    // visitor should watch the lie land, so the board is read back in the same
    // queue slot. board() spends no turn, so a line that ran none costs
    // nothing. It reports no goal or plan either, because a resting board has
    // decided nothing, which is the blank boot() already draws at turn 0.
    return serializeTick(async function () {
      const res = await tmct.turn(line);
      const board = await session.board();
      appendChat("a", res.answer);
      applyTickResult(board);
      renderAll();
      return res;
    });
  }

  el("chatForm").addEventListener("submit", function (e) {
    e.preventDefault();
    const input = el("chatInput");
    const line = input.value.trim();
    if (!line) return;
    input.value = "";
    sendCommand(line);
  });

  const chatLog = el("chatLog");
  chatLog.addEventListener("click", function (e) {
    const line = e.target.closest(".clipped");
    if (line) { el("chatLogPopupText").textContent = line.textContent; el("chatLogPopup").hidden = false; }
  });
  el("chatLogPopupClose").addEventListener("click", function () { el("chatLogPopup").hidden = true; });

  // ---- the pill rail and its typeahead ----------------------------------
  // The deception rail is tmct.page.pillsForMudiii's own output, rendered and
  // nothing more: an address pill per live agent, then a true and a false
  // claim about every individual the addressee could act on. The false cell is
  // the board's own point reflection, so a lie is always in bounds and never
  // accidentally true. Which one a pill carries is shown by a glyph in CSS
  // ::before, never in the submitted text — a clicked lie reads exactly like a
  // typed one once it is in the input.
  //
  // The fixed seeds ahead of it are the town square's OWN verbs, checked
  // against the lane's regexes rather than borrowed from another page: this
  // world has no "look".
  function renderChatPills() {
    const seeds = SEED_COMMANDS.map(function (c) { return { command: c, label: c }; });
    const seedHtml = seeds.map(function (p) {
      return '<button type="button" class="pill" data-command="' + esc(p.command) + '">' + esc(p.label) + "</button>";
    }).join("");
    const rail = window.tmct.page.pillsForMudiii(agentsById, itemsById, selectedAddresseeId, { gridSize: gridSizeOf() });
    selectedAddresseeId = rail.addresseeId;
    const addrHtml = rail.addressPills.map(function (p) {
      return '<button type="button" class="pill" data-role="dyn-addr" data-id="' + esc(p.id) + '"'
        + (p.id === selectedAddresseeId ? ' data-active="1"' : "") + ">" + esc(p.label) + "</button>";
    }).join("");
    const claims = rail.claimPills.map(function (p) {
      return { command: p.sentence, label: p.text, truth: p.truth };
    });
    const claimHtml = claims.map(function (p) {
      return '<button type="button" class="pill" data-role="dyn-claim" data-truth="' + (p.truth ? "true" : "false")
        + '" data-command="' + esc(p.command) + '">' + esc(p.label) + "</button>";
    }).join("");
    livePills = seeds.concat(claims);
    el("chatPills").innerHTML = seedHtml + addrHtml + claimHtml;
    if (pillComplete) pillComplete.refresh();
  }

  // A pill APPENDS rather than replacing, so two clicks compose one line. The
  // second click of a double is what submits: the text it would have appended
  // went in on the first click of that same pair, which is why nothing is
  // appended again here.
  function appendToChatInput(text) {
    const input = el("chatInput");
    const head = input.value.replace(/\\s+$/, "");
    input.value = (head ? head + " " : "") + text;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  el("chatPills").addEventListener("click", function (e) {
    const btn = e.target.closest(".pill");
    if (!btn) return;
    if (btn.getAttribute("data-role") === "dyn-addr") {
      selectedAddresseeId = btn.getAttribute("data-id");
      renderChatPills();
      return;
    }
    const command = btn.getAttribute("data-command");
    if (!command) return;
    if (e.detail > 1) {
      const input = el("chatInput");
      const line = input.value.trim();
      input.value = "";
      if (line) sendCommand(line);
      return;
    }
    appendToChatInput(command);
  });

  function wirePillComplete() {
    pillComplete = createPillComplete({
      input: el("chatInput"),
      ghostEl: el("chatInput-pc-ghost"),
      statusEl: el("chatInput-pc-status"),
      railEl: el("chatPills"),
      getCandidates: function () { return livePills; },
    });
  }

  // ---- food placement ----------------------------------------------------
  el("foodPill").addEventListener("click", function () {
    foodArmed = !foodArmed;
    el("foodPill").setAttribute("aria-pressed", foodArmed ? "true" : "false");
  });

  // The scene track's own script calls this on a raycast hit against the
  // ground plane (see this module's header on the two scripts' split). Kept
  // as a plain global rather than a spliced closure binding, because the
  // scene script is embedded as its OWN standalone <script> tag and shares
  // no lexical scope with this one.
  //
  // Routed through tmct.turn (sendCommand), never session.placeFood
  // directly: a typed "put food at cell-3-4" and this click must write the
  // same facts through the same provenance stamp, so "who put that there?"
  // grounds and answers identically either way, and the click's own result
  // lands in the chat log instead of vanishing silently. A blocked cell is
  // still refused entirely client-side — nothing is written, and the food
  // pill stays armed for another try.
  window.mudiiiHandleSceneClick = function (cellId) {
    if (!session || editing) return;
    if (!foodArmed) { walkFollowedTo(cellId); return; }
    const reason = blockedCellReason(cellId, props, agentsList());
    if (reason) { setSceneStatus(reason); return; }
    sendCommand("put food at " + cellId).then(function () {
      foodArmed = false;
      el("foodPill").setAttribute("aria-pressed", "false");
    });
  };

  // ---- driving one agent by hand ------------------------------------------
  // Every press here spends a turn: driveAgent runs the SAME whole-world tick
  // autoplay runs, so the ecology pass runs and every other agent decides and
  // moves with it. That is what the status line has to say, or the ring reads
  // as a free nudge that costs nothing.
  function followedAgentId() {
    const id = camera.selectedId;
    return id && agentsById[id] ? id : null;
  }

  function renderDriveRing() {
    const followed = followedAgentId();
    const buttons = el("driveRing").querySelectorAll("[data-drive]");
    for (let i = 0; i < buttons.length; i += 1) buttons[i].disabled = !followed;
  }

  function drivePress(direction) {
    const followed = followedAgentId();
    if (!session || !followed) { setSceneStatus("pick an agent to follow \\u2014 the ring walks whoever the camera is on."); return; }
    // A hand-driven turn is a deliberate one, so autoplay stands down rather
    // than racing the press.
    autoOn = false;
    if (ticker) ticker.pause();
    return serializeTick(async function () {
      const result = await session.driveAgent(followed, direction);
      applyTickResult(result);
      renderAll();
      const driven = result.driven || {};
      setSceneStatus(driven.accepted
        ? followed + " went " + driven.direction + " to " + driven.cell + " \\u2014 turn " + result.turn + ", and the whole square moved with it."
        : followed + " could not go " + direction + " \\u2014 the turn was spent anyway, and the whole square moved.");
      return result;
    });
  }

  el("driveRing").addEventListener("click", function (e) {
    const btn = e.target.closest("[data-drive]");
    if (!btn || btn.disabled) return;
    drivePress(btn.getAttribute("data-drive"));
  });

  // A ground click with nothing armed walks the followed agent one step along
  // the route to the cell, and draws the whole route it is heading down. The
  // route comes from the world's own exit search, so a cell behind a building
  // is declined rather than drawn as a line through the wall.
  async function walkFollowedTo(target) {
    const followed = followedAgentId();
    if (!followed) { setSceneStatus("pick an agent to follow \\u2014 a click on the ground walks whoever the camera is on."); return; }
    const from = agentsById[followed].cell;
    if (target === from) { setSceneStatus(followed + " is already at " + target + "."); return; }
    callScene("flashCell", target);
    const snap = await session.snapshot();
    const route = await window.tmct.page.routeBetweenCells(snap.rows, from, target);
    if (!route || !route.directions.length) {
      callScene("clearRoute");
      setSceneStatus("no way through to " + target + " from " + from + ".");
      return;
    }
    callScene("showRoute", route.cells);
    await drivePress(route.directions[0]);
    const left = route.directions.length - 1;
    setSceneStatus(left
      ? followed + " is heading for " + target + " \\u2014 " + left + " more step" + (left === 1 ? "" : "s") + ", one turn each."
      : followed + " reached " + target + ".");
  }

  // ---- the HUD row --------------------------------------------------------
  function renderHudRow() {
    const ids = Object.keys(agentsById).sort();
    const row = el("hudRow");
    if (row.children.length !== ids.length) {
      row.innerHTML = ids.map(function (id, i) { return agentCardMarkup(String(i)); }).join("");
    }
    const cards = row.querySelectorAll(".hud-card");
    for (let i = 0; i < ids.length; i += 1) {
      const id = ids[i];
      const card = cards[i];
      if (!card) continue;
      card.setAttribute("data-agent", id);
      const fields = hudCardFieldsFor(Object.assign({ id: id }, agentsById[id]), DATA.mudiiiConfig);
      card.querySelector(".hud-card-id").textContent = fields.id;
      card.querySelector(".hud-card-role").textContent = fields.role || "";
      card.querySelector(".hud-meter-fill").style.width = (fields.massPct === null ? 0 : fields.massPct) + "%";
      card.querySelector(".hud-goal").textContent = fields.goal;
      card.querySelector(".hud-plan").textContent = "plan: " + fields.planText;
      renderBelief(card, id, fields.beliefEntries);
    }
  }

  // A belief map grows with the cast, so the card shows the first three and a
  // count and keeps the rest behind a toggle. Which cards are open is held
  // against the AGENT ID, never the DOM: renderHudRow only rebuilds its
  // markup when the card count changes, and card slots are positional while
  // agents re-bind by sorted id, so state left in a card would follow the
  // slot rather than the animal.
  const BELIEF_SUMMARY_LIMIT = 3;
  function renderBelief(card, id, entries) {
    const toggle = card.querySelector(".hud-belief-toggle");
    const detail = card.querySelector(".hud-detail");
    const expanded = expandedAgents.has(id);
    const shown = entries.slice(0, BELIEF_SUMMARY_LIMIT).map(function (entry) {
      return entry[0] + (entry[1] ? " @ " + entry[1] : " unseen");
    }).join(" \\u00b7 ");
    const rest = entries.length - BELIEF_SUMMARY_LIMIT;
    card.querySelector(".hud-belief").textContent = entries.length
      ? "believes: " + shown + (rest > 0 ? " +" + rest + " more" : "")
      : "";
    toggle.hidden = entries.length === 0;
    toggle.setAttribute("aria-expanded", expanded && entries.length ? "true" : "false");
    detail.hidden = !expanded || entries.length === 0;
    detail.innerHTML = entries.map(function (entry) {
      return '<div class="hud-detail-line">' + esc(believedFactSentence(entry[0], entry[1])) + "</div>";
    }).join("");
  }

  el("hudRow").addEventListener("click", function (e) {
    const toggle = e.target.closest(".hud-belief-toggle");
    if (!toggle) return;
    const card = toggle.closest(".hud-card");
    const id = card && card.getAttribute("data-agent");
    if (!id) return;
    if (expandedAgents.has(id)) expandedAgents.delete(id); else expandedAgents.add(id);
    renderHudRow();
  });

  // ---- the top-down map panel ---------------------------------------------
  function renderMapPanel() {
    const board = el("mapPanelBoard");
    const size = gridSizeOf();
    // The cell divisions are two gradients stepped by this, so the drawn grid
    // and the dots' own percentages read off the same board size.
    board.style.setProperty("--map-cell-pct", (100 / size) + "%");
    const blocks = mapBlocksFor(props, size);
    const dots = mapDotsFor(agentsList(), itemsList(), size);
    // Blocks first, dots second: a live agent standing beside a building has
    // to sit on top of it, not under it.
    board.innerHTML = blocks.map(function (b) {
      return '<span class="map-block" style="left:' + b.xPct + '%;top:' + b.yPct + '%;width:' + b.sizePct
        + '%;height:' + b.sizePct + '%" title="' + esc(b.id) + '"></span>';
    }).join("") + dots.map(function (d) {
      const dot = '<span class="map-dot map-dot-' + esc(d.kind) + '" style="left:' + d.xPct + '%;top:' + d.yPct + '%" title="' + esc(d.id) + '"></span>';
      // Items are named by their colour in the key; only the cast, which the
      // HUD and the follow control both name, carries its id on the board.
      if (d.kind !== "predator" && d.kind !== "prey") return dot;
      return dot + '<span class="map-label mono" style="left:' + d.xPct + '%;top:' + d.yPct + '%">' + esc(d.id) + "</span>";
    }).join("");
    el("mapPanelTurn").textContent = "turn " + globalTurn;
  }

  // ---- follow dropdown and camera mode ------------------------------------
  function renderAgentSelect() {
    const select = el("agentSelect");
    const ids = Object.keys(agentsById).sort();
    const current = camera.selectedId;
    select.innerHTML = ids.map(function (id) {
      return '<option value="' + esc(id) + '"' + (id === current ? " selected" : "") + '>' + esc(id) + "</option>";
    }).join("");
  }
  el("agentSelect").addEventListener("change", function () {
    const id = el("agentSelect").value || null;
    const mode = cameraModeBeforeFallback || camera.mode;
    cameraModeBeforeFallback = null;
    camera = { mode: mode, selectedId: id, status: null };
    renderCameraButtons();
    renderDriveRing();
    callScene("setCamera", camera);
  });

  function renderCameraButtons() {
    const buttons = el("cameraMode").querySelectorAll("button");
    for (let i = 0; i < buttons.length; i += 1) {
      buttons[i].setAttribute("aria-pressed", buttons[i].getAttribute("data-mode") === camera.mode ? "true" : "false");
    }
  }
  el("cameraMode").addEventListener("click", function (e) {
    const btn = e.target.closest("button[data-mode]");
    if (!btn) return;
    cameraModeBeforeFallback = null;
    camera = { mode: btn.getAttribute("data-mode"), selectedId: camera.selectedId, status: null };
    renderCameraButtons();
    callScene("setCamera", camera);
  });

  // ---- the control deck ----------------------------------------------------
  function chosenFoxCount() { return DATA.playerCounts[Number(el("playerCountSlider").value)] || DATA.defaultPlayerCount; }
  function showFoxCount(n) {
    el("playerCountValue").textContent = String(n);
    el("playerCountSlider").setAttribute("aria-valuetext", n + (n === 1 ? " fox" : " foxes"));
  }
  function chosenGoblinCount() { const n = Number(el("npcCountSlider").value); return Number.isFinite(n) ? n : DATA.defaultNpcCount; }
  function showGoblinCount(n) {
    el("npcCountValue").textContent = String(n);
    el("npcCountSlider").setAttribute("aria-valuetext", n + (n === 1 ? " goblin" : " goblins"));
  }

  function wireDeck() {
    el("autoToggle").addEventListener("click", function () {
      if (!session) return;
      autoOn = !autoOn;
      if (autoOn) ensureTicker().play(); else ensureTicker().pause();
    });
    el("delaySlider").addEventListener("input", function () {
      delayMs = Number(el("delaySlider").value);
      el("delayValue").textContent = delayMs + "ms";
    });
    el("maxTurnsSlider").addEventListener("input", function () {
      maxTurns = Number(el("maxTurnsSlider").value);
      el("maxTurnsValue").textContent = String(maxTurns);
    });
    el("playerCountSlider").addEventListener("input", function () { showFoxCount(chosenFoxCount()); });
    el("playerCountSlider").addEventListener("change", function () { boot(); });
    el("npcCountSlider").addEventListener("input", function () { showGoblinCount(chosenGoblinCount()); });
    el("npcCountSlider").addEventListener("change", function () { boot(); });
    el("resetBtn").addEventListener("click", function () { boot(); });
    const scenarioSelect = el("scenarioSelect");
    if (scenarioSelect) {
      scenarioSelect.addEventListener("change", function () {
        const picked = Number(scenarioSelect.value);
        if (!DATA.scenarios[picked] || picked === scenarioIndex) return;
        scenarioIndex = picked;
        boot();
      });
    }
    el("editModeBtn").addEventListener("click", function () {
      if (editing) exitEditMode(); else enterEditMode();
    });
    const infoBtn = el("deckInfoBtn");
    const infoPopup = el("deckInfoPopup");
    infoBtn.addEventListener("click", function () {
      const opening = infoPopup.hidden;
      infoPopup.hidden = !opening;
      infoBtn.setAttribute("aria-expanded", opening ? "true" : "false");
    });
    el("deckInfoClose").addEventListener("click", function () {
      infoPopup.hidden = true;
      infoBtn.setAttribute("aria-expanded", "false");
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !infoPopup.hidden) { infoPopup.hidden = true; infoBtn.setAttribute("aria-expanded", "false"); } });
  }

  // ---- edit mode -------------------------------------------------------
  // renderMudEditorText/session.applyEdit round-trip mgx:model and
  // mgx:rotation unchanged (mud-editor.mjs, shared with mud.html); the side
  // panel here is a plain "who/what stands where" list rather than
  // mud.html's burrow-survey SVG, since a town square is a grid, not a room
  // graph.
  function worldOnlyRows(rows) { return rowsForWorld(rows, scenario().worldPayload.name); }
  let editRows = [];
  // The FULL store, not the world's own rows: a term's synonyms and its is-a
  // chain mostly live in the background corpus, not in the square's vocabulary.
  let allStoreRows = [];

  function renderEditPlacements() {
    const placements = {};
    for (const row of editRows) {
      if (row.predicate !== "mgx:currently-in") continue;
      placements[row.subject] = row.object;
    }
    const subjects = Object.keys(placements).sort();
    el("editPlacements").innerHTML = subjects.length
      ? subjects.map(function (s) {
        return '<div class="edit-placement-row"><span class="mono">' + esc(s) + '</span><span>' + esc(placements[s]) + "</span></div>";
      }).join("")
      : '<span class="edit-empty">nothing placed yet</span>';
  }

  async function enterEditMode() {
    if (!session) return;
    editing = true;
    autoOn = false;
    if (ticker) ticker.pause();
    document.body.classList.add("editing");
    el("editModeBtn").textContent = "back to playing";
    el("editModeBtn").setAttribute("aria-pressed", "true");
    const snap = await session.snapshot();
    allStoreRows = snap.rows;
    editRows = worldOnlyRows(snap.rows);
    el("editorText").value = renderMudEditorText(editRows, gridWorldEditorState(snap.state));
    el("editorStatus").className = "edit-status";
    el("editorStatus").textContent = "";
    renderSuggestionPills();
    renderEditPlacements();
  }

  function exitEditMode() {
    editing = false;
    document.body.classList.remove("editing");
    el("editModeBtn").textContent = "edit";
    el("editModeBtn").setAttribute("aria-pressed", "false");
  }

  // The lateral SKOS neighbourhood plus the vertical is-a chain for whatever
  // word the cursor sits behind. Nothing found is nothing shown — an honest
  // miss, never a guessed suggestion.
  function renderSuggestionPills() {
    const box = el("editorPills");
    const term = wordBeforeCursor(el("editorText").value, el("editorText").selectionStart);
    if (!term || !window.tmct) { box.innerHTML = ""; return; }
    const related = window.tmct.page.relatedForTerm ? window.tmct.page.relatedForTerm(allStoreRows, term) : null;
    const chain = window.tmct.page.classAncestorChain ? window.tmct.page.classAncestorChain(term, allStoreRows) : [];
    const seen = {};
    seen[term] = true;
    const out = [];
    const push = function (label) { if (label && !seen[label]) { seen[label] = true; out.push(label); } };
    if (related) {
      related.synonyms.forEach(push);
      related.related.forEach(function (r) { push(r.prefLabel); });
    }
    chain.slice(1).forEach(push);
    box.innerHTML = out.slice(0, 8).map(function (s) {
      return '<button type="button" class="pill" data-insert="' + esc(s) + '">' + esc(s) + "</button>";
    }).join("");
  }

  el("editorPills").addEventListener("click", function (e) {
    const btn = e.target.closest(".pill");
    if (!btn) return;
    const area = el("editorText");
    const pos = area.selectionStart;
    const word = wordBeforeCursor(area.value, pos);
    const insert = btn.getAttribute("data-insert");
    area.value = area.value.slice(0, pos - word.length) + insert + area.value.slice(pos);
    const next = pos - word.length + insert.length;
    area.setSelectionRange(next, next);
    area.focus();
    onEditorChanged();
  });

  let suggestTimer = null;
  let syncTimer = null;
  function scheduleSuggestions() { clearTimeout(suggestTimer); suggestTimer = setTimeout(renderSuggestionPills, 180); }
  function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(applyEditorText, 450); }
  function onEditorChanged() { scheduleSuggestions(); scheduleSync(); }
  el("editorText").addEventListener("input", onEditorChanged);
  el("editorText").addEventListener("click", scheduleSuggestions);
  el("editorText").addEventListener("keyup", function (e) {
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].indexOf(e.key) !== -1) scheduleSuggestions();
  });

  // An edit changes the facts, so the meshes have to move with them —
  // otherwise a deleted well stands in the square until the next Reset.
  // boot() drops the camera back to overhead and empties the scene's own
  // agent groups, so the visitor's camera is put back and the live cast is
  // redrawn straight after: autoplay is paused in edit mode, so nothing else
  // would repopulate them.
  async function rebuildSceneFromEdit() {
    props = propPlacementsFrom(editRows, DATA.assetManifest);
    await callScene("boot", {
      propPlacements: props, assetManifest: DATA.assetManifest, gridSize: gridSizeOf(), cellSize: 1,
    });
    callScene("setCamera", camera);
    callScene("applyTick", { agents: agentsById, items: itemsById, ecology: [] });
  }

  async function applyEditorText() {
    if (!session) return;
    const status = el("editorStatus");
    status.className = "edit-status pending";
    status.textContent = "reading the square\\u2026";
    const result = await serializeTick(function () { return session.applyEdit(el("editorText").value); });
    const snap = await session.snapshot();
    allStoreRows = snap.rows;
    editRows = worldOnlyRows(snap.rows);
    await rebuildSceneFromEdit();
    if (result && result.unrecognized && result.unrecognized.length) {
      status.className = "edit-status pending";
      status.textContent = result.unrecognized.length + " line" + (result.unrecognized.length === 1 ? "" : "s")
        + " not understood yet \\u2014 nothing is retracted until they are.";
    } else {
      status.className = "edit-status ok";
      status.textContent = (result && (result.added || result.removed))
        ? "synced \\u2014 " + result.added + " fact(s) written, " + result.removed + " retracted."
        : "synced \\u2014 no change.";
    }
    renderEditPlacements();
  }

  // ---- booting ---------------------------------------------------------
  // The board opens playing: a square standing still reads as broken, and the
  // first thing anyone does is press play anyway. A visitor who asked for
  // reduced motion gets the opening board drawn and left still — the play
  // control is right there — because an autoplaying board is exactly the
  // unasked-for movement that setting is about.
  let bootSeq = 0;
  async function boot() {
    const seq = bootSeq += 1;
    autoOn = false;
    if (ticker) { ticker.pause(); ticker = null; }
    globalTurn = 0;
    tickQueue = createSerialQueue();
    camera = { mode: "follow", selectedId: null, status: null };
    cameraModeBeforeFallback = null;
    expandedAgents.clear();
    const s = scenario();
    const foxes = mintRoster(rosterPrefixFor(s, "predator"), chosenFoxCount());
    const goblins = mintRoster(rosterPrefixFor(s, "prey"), chosenGoblinCount());
    cast = foxes.concat(goblins);
    showFoxCount(foxes.length);
    showGoblinCount(goblins.length);
    props = propPlacementsFrom((s.worldPayload && s.worldPayload.facts) || [], DATA.assetManifest);
    const opened = await window.tmct.open(s.worldPayload, { agents: cast, epoch: 0 });
    if (seq !== bootSeq) return;
    session = opened;
    agentsById = {};
    itemsById = {};
    el("chatInput").disabled = false;
    await callScene("boot", { propPlacements: props, assetManifest: DATA.assetManifest, gridSize: gridSizeOf(), cellSize: 1 });

    // The opening board, drawn through the very path a tick takes. Without
    // this the page's first sight of where anything stands is the first tick,
    // so every mesh sits unplaced and the map panel is blank until the visitor
    // presses play. The engine mints the cast at seeded cells, so the ids and
    // the cells both come back from it rather than being guessed here.
    const opening = await session.board();
    if (seq !== bootSeq) return;
    camera.selectedId = Object.keys(opening.agents || {}).sort()[0] || null;
    applyTickResult(opening);
    renderAll();
    if (!prefersReducedMotion()) {
      autoOn = true;
      ensureTicker().play();
    }
  }

  function renderAll() {
    renderHudRow();
    renderMapPanel();
    renderAgentSelect();
    renderCameraButtons();
    renderDriveRing();
    renderChatPills();
    el("globalTurnCount").textContent = "turns: " + globalTurn;
  }

  wireDeck();
  wirePillComplete();
  boot();
})();`;
}
