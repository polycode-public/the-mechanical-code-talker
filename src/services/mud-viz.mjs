// mud-viz.mjs — mud.html: the self-contained proof of the shared,
// multi-character shape PLAN_MUD.md's "Demo phase" section describes. Four
// burrowing animals (mole-1, vole-1, badger-2, groundhog-1 — mud-garden.jsonl
// ships all four) each get their own window over ONE shared live world
// (mud-browser-entry.mjs's createMudSession); a fifth, omniscient view — the
// soil cross-section world map — sits in the middle with no fog of war at
// all, the one deliberate exception PLAN_MUD.md names.
//
// Shaped after adventure-viz.mjs/spider-fly-viz.mjs: one inlined <style>
// over viz-theme.mjs's shared tokens, behaviour as an inlined IIFE, the
// engine arriving via a sibling <script src="./mud-browser.bundle.js">
// (mirroring adventure-viz.mjs's own worldPayload-embedding rationale — the
// world's canonical source is a Node-only gzipped JSONL shard the browser
// cannot read, so it is read ONCE at build time through the real worlds-pack
// provider and embedded as page data). `createTicker` and a small set of
// self-contained, `.toString()`-splice-safe room-scene helpers are spliced
// into the inline script exactly the way spider-fly-viz.mjs splices its own
// render-glue — `roomSceneObjects`/`spriteClassForObject`/`visibleRoomOf`/
// `roomKindForRoom` are REUSED directly from adventure-viz.mjs rather than
// re-derived: mud-garden ships no individual named "player" (the whole point
// of the multi-character demo), so those functions' own hardcoded "player"
// exclusion never fires for a mud character — every character reads back as
// an ordinary visible object of its room until this page's own code filters
// the CURRENT viewing character out by name (mudRoomSceneObjects, below).
//
// A room's graphic is a rendering of worldDigestRows'/roomAffordances' own
// text digest, never a replacement for it (PLAN_MUD.md's own "Room view"
// spec) — this page keeps the layout intentionally simpler than Ashcombe
// Hall's wall/floor stacking (adventure-viz.mjs's roomSceneLayout): a soil-
// toned canvas backdrop (roomKindForRoom picks outdoor/underground), the
// viewing character's own sprite drawn center-low, every room-mate and loose
// object laid out as a plain wrapped tray of sprites above it. PLAN_MUD.md
// specifies the canvas+sprite-layer TECHNIQUE and the ground-truth-vs-
// rendering relationship, not stacking physics, so this is this page's own
// engineering call on the gap PLAN_MUD.md leaves open, not a cut from its
// spec.
//
// FIVE ticker instances (viz-ticker.mjs's createTicker): one per window, so
// each can play/pause/step independently, plus the rail's own "auto" control
// that just calls .play()/.pause() on the four window tickers at once. Every
// tick, from ANY window, is funneled through one shared async queue
// (serializeTick, spliced below) so two characters' turns can never
// interleave their reads/writes of the one shared memoryDir — mud-browser-
// entry.mjs's own header names this as the caller's responsibility, and this
// is where that responsibility is discharged. The queue is also what makes
// the rail's GLOBAL turn counter well-defined: it increments in the exact
// order turns actually executed, never a race between windows.
import { THEME_TOKENS_CSS, SERIF_STACK, MONO_STACK, escapeHtml, embedJson, embedScriptText } from "./viz-theme.mjs";
import { createTicker } from "./viz-ticker.mjs";
import {
  roomSceneObjects, scenePlacement, spriteClassForObject, spriteAncestryRows,
  visibleRoomOf, roomKindForRoom, factsForSubject,
} from "./adventure-viz.mjs";
import { DEFAULT_GAME_CONFIG } from "../domain/game-config.mjs";

const DEFAULT_TITLE = "tmct — the mud";
// No display-face embedding pipeline exists anywhere in this project yet
// (grep turns up no @font-face/font-display in any *-viz.mjs) — Fraunces
// itself never ships, so DISPLAY_STACK is SERIF_STACK's own web-safe serif
// fallback, named separately only so a later session that DOES add a font
// pipeline has one obvious constant to point at Fraunces instead of typing
// "Georgia" into headings by hand.
const DISPLAY_STACK = SERIF_STACK;
const SANS_STACK = `"IBM Plex Sans", "Inter", -apple-system, BlinkMacSystemFont, sans-serif`;

const ROOT_ROOM = "garden";
const SLOTS = ["nw", "ne", "sw", "se"];
const DEFAULT_DELAY_MS = 650;
const DEFAULT_MAX_TURNS = 400;

const MUD_NOTE_LINES = [
  "Four burrowing animals share one world here. Each one only knows what it has dug up, asked about, or been told. Nobody sees the whole map except you, watching from the middle.",
  `This is a MUD, short for Multi Underground creature Dig. The name nods to MUDII (mudii.co.uk), one of the first multiplayer text games. The dig-your-own-rooms idea came from a skim of Wikipedia's Colossal Cave Adventure article, the game that started the genre.`,
];

/** A character id's species — "mole-1" -> "mole", "groundhog-1" ->
 *  "groundhog" — mirroring spider-fly-viz.mjs's own classOfAgentId. Self-
 *  contained, `.toString()`-splice safe. */
export function speciesOfCharacter(id) {
  return String(id).replace(/-\d+$/, "");
}

/** Every object visible in `here` EXCEPT `viewer` itself — `roomSceneObjects`
 *  (adventure-viz.mjs) only ever excludes the literal id "player", which no
 *  mud-garden character is ever named, so every OTHER character sharing the
 *  room (and every loose object) comes back exactly like any prop; this page
 *  draws the viewer's own sprite separately, so it is the one subject this
 *  wrapper drops. Pure, self-contained (roomSceneObjects is spliced
 *  alongside it). */
export function mudRoomSceneObjects(rows, state, here, viewer) {
  return roomSceneObjects(rows, state, here).filter((o) => o.subject !== viewer);
}

/** Every object `character` carries, sorted, each with its sprite class —
 *  mud's own version of adventure-viz.mjs's carriedItems, parametrized by
 *  character instead of hardcoded to "player" (mud-garden ships no such
 *  individual). Pure, self-contained. */
export function carriedItemsFor(rows, state, character) {
  return [...state.placements]
    .filter(([, p]) => p.predicate === "mgx:located-in" && p.object === character)
    .map(([subject]) => ({ subject, spriteClass: spriteClassForObject(rows, subject) }))
    .sort((a, b) => a.subject.localeCompare(b.subject));
}

/** Every room's depth level, `Map<roomId, number>`, BFS from `root` at level
 *  0: an "up"/"down" exit moves the level by ∓ 1, any other direction
 *  keeps the level unchanged — the soil cross-section's own row assignment,
 *  and each window's own minimap filter ("this character's own level only").
 *  A room unreachable from `root` (should not happen — every dug room writes
 *  a two-way exit back) is simply absent from the map rather than guessed
 *  at. Pure, self-contained. */
export function levelsOf(state, root = "garden") {
  const levels = new Map([[root, 0]]);
  const queue = [root];
  while (queue.length) {
    const room = queue.shift();
    const level = levels.get(room);
    for (const [direction, target] of state.exits.get(room) ?? []) {
      if (levels.has(target)) continue;
      const delta = direction === "down" ? -1 : direction === "up" ? 1 : 0;
      levels.set(target, level + delta);
      queue.push(target);
    }
  }
  return levels;
}

/** `levels` grouped into `{ level, rooms: [roomId...] }` rows, deepest last
 *  so a caller can lay the soil cross-section out top (level 0) to bottom —
 *  rooms within a level sort by id for a stable, deterministic column order.
 *  Pure. */
export function levelBands(levels) {
  const byLevel = new Map();
  for (const [room, level] of levels) {
    if (!byLevel.has(level)) byLevel.set(level, []);
    byLevel.get(level).push(room);
  }
  return [...byLevel.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([level, rooms]) => ({ level, rooms: rooms.sort() }));
}

/** Which characters currently stand in `room` — the omniscient world map's
 *  own per-room roster, and a per-window minimap's own (visited-only)
 *  roster. Pure. */
export function charactersInRoom(state, room, characters) {
  return characters.filter((c) => state.placements.get(c)?.object === room);
}

function slugForSlot(slot) {
  return `window-${slot}`;
}

/** The self-contained mud.html page. Pure — identical output for identical
 *  input; every other piece of state (the live world, chat, ticks) is
 *  computed in the browser once the sibling bundle loads.
 *  `characters` is `[{ id, slot, species }]`, one entry per window, in NW,
 *  NE, SW, SE order. `worldPayload` is `{ name, facts, rules, opening }`,
 *  read once at build time through the real worlds-pack provider (see this
 *  module's own header). `spriteTemplates` is the large-tier sprite set
 *  (data/sprites-large/*.toml) so mole/vole/badger/groundhog/meerkat all
 *  resolve their own art instead of falling back to the flat animal icon.
 *  `mudConfig` defaults to game-config.mjs's own DEFAULT_GAME_CONFIG.mud —
 *  the per-species mass/speed/dig-reach reference table the Creature Stats
 *  panel reads for flavor (see this module's header on why the live
 *  simulation does not yet act on speed/dig-reach itself).
 *  `engineBundleJs` inlines the built mud-browser bundle instead of the
 *  sibling `<script src>`, mirroring spider-fly-viz.mjs's own standalone-
 *  export knob; default empty keeps the site build's sibling-file
 *  arrangement unchanged. */
export function renderMudHtml({
  title = DEFAULT_TITLE,
  worldPayload,
  characters = [],
  spriteTemplates = [],
  mudConfig = DEFAULT_GAME_CONFIG.mud,
  engineBundleJs = "",
} = {}) {
  const pageData = embedJson({
    worldPayload, characters, spriteTemplates, mudConfig,
    rootRoom: ROOT_ROOM,
    defaultDelayMs: DEFAULT_DELAY_MS,
    defaultMaxTurns: DEFAULT_MAX_TURNS,
  });

  const windowHtml = characters.map((c) => windowMarkup(c)).join("\n");

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
${MUD_STYLE}
</style>
</head>
<body>
<main>
  <div class="eyebrow">tmct &middot; mud</div>
  <h1>Multiple actors, one shared world</h1>
  <div class="mud-stage" id="mudStage">
    ${windowHtml}
    <div class="world-map" id="worldMap" aria-label="the whole world, every level, every character">
      <div class="world-map-head">
        <span class="world-map-title">the whole burrow</span>
        <span class="mono world-map-turn" id="worldMapTurn">turn 0</span>
      </div>
      <div class="world-map-bands" id="worldMapBands"></div>
    </div>
  </div>
  <div class="rail" id="rail" aria-label="simulation controls">
    <div class="rail-row">
      <button type="button" id="autoToggle" aria-pressed="false">&#9654; auto</button>
      <span class="mono rail-turns" id="globalTurnCount">turns: 0</span>
      <label class="rail-slider">delay
        <input type="range" id="delaySlider" min="80" max="2000" step="20" value="${DEFAULT_DELAY_MS}">
        <span class="mono" id="delayValue">${DEFAULT_DELAY_MS}ms</span>
      </label>
      <label class="rail-slider">max turns
        <input type="range" id="maxTurnsSlider" min="20" max="2000" step="20" value="${DEFAULT_MAX_TURNS}">
        <span class="mono" id="maxTurnsValue">${DEFAULT_MAX_TURNS}</span>
      </label>
      <button type="button" id="resetBtn">reset</button>
    </div>
    <div class="rail-note mud-note">
      <p>${escapeHtml(MUD_NOTE_LINES[0])}</p>
      <p>${escapeHtml(MUD_NOTE_LINES[1])}</p>
    </div>
  </div>
</main>
<script>
const MUD_PAGE_DATA = ${pageData};
</script>
${engineBundleJs ? `<script>\n${embedScriptText(engineBundleJs)}\n</script>` : `<script src="./mud-browser.bundle.js"></script>`}
<script>
${embedScriptText(pageScript())}
</script>
</body>
</html>
`;
}

function windowMarkup({ id, slot, species }) {
  const w = slugForSlot(slot);
  return `<div class="mud-window" id="${w}" data-slot="${escapeHtml(slot)}" data-character="${escapeHtml(id)}">
      <div class="mud-window-head">
        <h2>${escapeHtml(species)} <span class="mono char-id">${escapeHtml(id)}</span></h2>
        <span class="mono window-turn" id="${w}-turn">turn 0</span>
      </div>
      <div class="room-view" id="${w}-room">
        <canvas id="${w}-canvas" width="360" height="220" aria-hidden="true"></canvas>
        <div class="sprite-layer" id="${w}-sprites"></div>
        <div class="speech-bubble" id="${w}-bubble" hidden></div>
        <div class="dig-flourish" id="${w}-flourish" hidden></div>
      </div>
      <p class="room-caption" id="${w}-caption"></p>
      <div class="window-columns">
        <div class="pouch" id="${w}-pouch" aria-label="pouch">
          <h3>pouch</h3>
          <ul class="pouch-list" id="${w}-pouch-list"></ul>
          <p class="mono stat-line" id="${w}-stats"></p>
        </div>
        <div class="minimap" aria-label="what this character has discovered">
          <h3>known ground</h3>
          <div class="minimap-rooms" id="${w}-minimap"></div>
        </div>
      </div>
      <div class="window-controls controls-row">
        <button type="button" id="${w}-play" disabled>&#9654; play</button>
        <button type="button" id="${w}-step" disabled>step</button>
        <span class="mono" id="${w}-count">0 turns</span>
      </div>
      <div class="chat">
        <div class="chatlog" id="${w}-chatlog" aria-live="polite"></div>
        <form class="chatask" id="${w}-chatform">
          <span class="prompt mono">tmct&gt;</span>
          <input id="${w}-chatq" type="text" placeholder="dig north" aria-label="talk to ${escapeHtml(id)}" disabled>
        </form>
        <div class="chatpills" id="${w}-chatpills" role="group" aria-label="quick commands">
          <button type="button" class="pill" data-fill="look" disabled>look</button>
          <button type="button" class="pill" data-fill="what do you know about food" disabled>what do you know about food</button>
          <button type="button" class="pill" data-fill="dig north" disabled>dig north</button>
          <button type="button" class="pill" data-fill="dig down" disabled>dig down</button>
        </div>
      </div>
    </div>`;
}

const MUD_STYLE = `
  :root {
    --soil-deep: #2B1D14; --soil-mid: #4A3324; --soil-light: #7A5A3D;
    --root-moss: #6B7A4F; --parchment: #EFE6D8; --mud-ink: #2A211A; --burrow-glow: #E8A33D;
  }
  html { background: var(--soil-deep); }
  body { margin: 0; background: linear-gradient(180deg, var(--root-moss) 0%, var(--soil-light) 18%, var(--soil-mid) 55%, var(--soil-deep) 100%) fixed; color: var(--mud-ink); font-family: ${SANS_STACK}; font-size: 15px; line-height: 1.5; }
  .mono { font-family: ${MONO_STACK}; }
  main { max-width: 1280px; margin: 0 auto; padding: 1.4rem 1.2rem 2.4rem; }
  .eyebrow { font-family: ${MONO_STACK}; font-size: .7rem; letter-spacing: .1em; text-transform: uppercase; color: var(--parchment); opacity: .85; }
  h1 { font-family: ${DISPLAY_STACK}; font-weight: 600; font-size: 1.7rem; margin: .25rem 0 1.1rem; color: var(--parchment); text-wrap: balance; }
  h2 { font-family: ${DISPLAY_STACK}; font-size: 1rem; margin: 0; text-transform: capitalize; }
  h3 { font-family: ${DISPLAY_STACK}; font-size: .78rem; margin: 0 0 .35rem; text-transform: uppercase; letter-spacing: .04em; color: var(--soil-mid); }
  button { font: inherit; color: inherit; background: none; cursor: pointer; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--burrow-glow); outline-offset: 2px; }
  button:disabled { opacity: .45; cursor: default; }

  .mud-stage {
    position: relative;
    display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: auto auto; gap: 1rem;
  }
  @media (max-width: 760px) { .mud-stage { grid-template-columns: 1fr; } .world-map { position: static; margin: .5rem 0; transform: none; } }

  .mud-window {
    background: var(--parchment); border: 1px solid var(--soil-mid); border-radius: 4px;
    box-shadow: 0 2px 0 rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.35);
    padding: .7rem .8rem; display: flex; flex-direction: column; gap: .5rem; min-width: 0;
  }
  .mud-window-head { display: flex; align-items: baseline; justify-content: space-between; gap: .5rem; }
  .char-id { font-size: .68rem; color: var(--soil-mid); }
  .window-turn { font-size: .7rem; color: var(--soil-mid); }

  .room-view { position: relative; border-radius: 3px; overflow: hidden; border: 1px solid var(--soil-mid); }
  .room-view canvas { display: block; width: 100%; height: auto; }
  .sprite-layer { position: absolute; inset: 0; display: flex; align-items: flex-end; flex-wrap: wrap; gap: 2%; padding: 4%; box-sizing: border-box; }
  .sprite { width: 15%; min-width: 28px; transition: transform .2s ease; }
  .sprite.self { width: 20%; min-width: 34px; order: -1; }
  .sprite svg { width: 100%; display: block; }
  @media (prefers-reduced-motion: reduce) { .sprite { transition: none; } }

  .speech-bubble {
    position: absolute; top: 6%; left: 6%; max-width: 78%;
    background: var(--parchment); color: var(--mud-ink); border: 1px solid var(--soil-mid); border-radius: 8px;
    padding: .3rem .55rem; font-size: .72rem; line-height: 1.3; box-shadow: 0 2px 4px rgba(0,0,0,.25);
    opacity: 0; transition: opacity .35s ease;
  }
  .speech-bubble.shown { opacity: 1; }
  @media (prefers-reduced-motion: reduce) { .speech-bubble { transition: none; } }

  .dig-flourish { position: absolute; inset: 0; pointer-events: none; opacity: 0; background: radial-gradient(circle at 50% 70%, var(--burrow-glow) 0%, transparent 60%); transition: opacity .5s ease; }
  .dig-flourish.shown { opacity: .55; }
  @media (prefers-reduced-motion: reduce) { .dig-flourish { transition: none; opacity: 0 !important; } }

  .room-caption { font-size: .8rem; margin: 0; color: var(--soil-mid); }

  .window-columns { display: grid; grid-template-columns: 1fr 1fr; gap: .6rem; }
  .pouch, .minimap { background: rgba(255,255,255,.35); border: 1px solid var(--soil-light); border-radius: 3px; padding: .4rem .5rem; }
  .pouch-list { list-style: none; margin: 0; padding: 0; font-size: .74rem; display: flex; flex-direction: column; gap: .15rem; }
  .pouch-list:empty::after { content: "carrying nothing"; color: var(--soil-mid); font-style: italic; }
  .stat-line { margin: .3rem 0 0; font-size: .64rem; color: var(--soil-mid); }
  .minimap-rooms { display: flex; flex-wrap: wrap; gap: .25rem; font-family: ${MONO_STACK}; font-size: .62rem; }
  .minimap-room { padding: .12rem .35rem; background: var(--soil-light); color: var(--parchment); border-radius: 2px; }
  .minimap-room.current { background: var(--burrow-glow); color: var(--mud-ink); font-weight: 600; }
  .minimap-rooms:empty::after { content: "nothing dug yet"; color: var(--soil-mid); font-family: ${SANS_STACK}; font-size: .68rem; font-style: italic; }

  .window-controls button, .rail button { font-family: ${MONO_STACK}; font-size: .72rem; text-transform: uppercase; letter-spacing: .02em; padding: .3rem .6rem; border: 1px solid var(--soil-mid); border-radius: 3px; background: var(--parchment); }
  .window-controls button:hover:not(:disabled), .rail button:hover:not(:disabled) { border-color: var(--burrow-glow); }
  .window-controls { gap: .4rem; }
  .window-controls .mono { margin-left: auto; font-size: .7rem; }

  .chat { display: flex; flex-direction: column; gap: .35rem; }
  .chatlog { display: flex; flex-direction: column; gap: .3rem; max-height: 140px; overflow-y: auto; }
  .chatlog .u { font-family: ${MONO_STACK}; font-size: .68rem; color: var(--soil-mid); }
  .chatlog .u::before { content: "tmct> "; color: var(--burrow-glow); }
  .chatlog .a { font-size: .76rem; line-height: 1.35; }
  .chatask { display: flex; align-items: center; gap: .4rem; }
  .chatask .prompt { color: var(--burrow-glow); font-size: .72rem; }
  .chatask input { flex: 1; min-width: 0; font-family: ${MONO_STACK}; font-size: .72rem; background: rgba(255,255,255,.6); color: var(--mud-ink); border: 1px solid var(--soil-mid); border-radius: 2px; padding: .28rem .45rem; box-sizing: border-box; }
  .chatpills { display: flex; flex-wrap: wrap; gap: .25rem; }
  .pill { font-family: ${MONO_STACK}; font-size: .62rem; padding: .15rem .5rem; border: 1px solid var(--soil-mid); border-radius: 99px; background: rgba(255,255,255,.5); }
  .pill:hover:not(:disabled) { border-color: var(--burrow-glow); }

  .world-map {
    position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); z-index: 5;
    width: min(420px, 90%); background: var(--soil-deep); color: var(--parchment);
    border: 2px solid var(--burrow-glow); border-radius: 6px; padding: .5rem .6rem .7rem;
    box-shadow: 0 6px 24px rgba(0,0,0,.45);
  }
  .world-map-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: .35rem; }
  .world-map-title { font-family: ${DISPLAY_STACK}; font-size: .82rem; letter-spacing: .02em; }
  .world-map-turn { font-size: .66rem; opacity: .8; }
  .world-map-bands { display: flex; flex-direction: column; gap: 2px; }
  .map-band { display: flex; align-items: center; gap: .35rem; padding: .3rem .4rem; border-radius: 2px; }
  .map-band .band-level { font-family: ${MONO_STACK}; font-size: .6rem; width: 2.4em; opacity: .75; }
  .map-band .band-rooms { display: flex; flex-wrap: wrap; gap: .3rem; flex: 1; }
  .map-room { font-family: ${MONO_STACK}; font-size: .6rem; padding: .12rem .4rem; border-radius: 2px; background: rgba(239,230,216,.14); }
  .map-room .room-cast { margin-left: .25rem; opacity: .85; }
  .map-room.freshly-dug { animation: dig-pulse 1.1s ease-out; }
  @keyframes dig-pulse { 0% { box-shadow: 0 0 0 0 var(--burrow-glow); } 100% { box-shadow: 0 0 0 8px transparent; } }
  @media (prefers-reduced-motion: reduce) { .map-room.freshly-dug { animation: none; } }

  .rail { margin-top: 1.2rem; background: var(--parchment); border: 1px solid var(--soil-mid); border-radius: 4px; padding: .7rem .9rem; }
  .rail-row { display: flex; flex-wrap: wrap; align-items: center; gap: .7rem; }
  .rail-turns { font-size: .78rem; }
  .rail-slider { display: flex; align-items: center; gap: .35rem; font-size: .68rem; color: var(--soil-mid); }
  .rail-slider input[type="range"] { accent-color: var(--burrow-glow); }
  .rail-note { margin-top: .6rem; padding-top: .55rem; border-top: 1px solid var(--soil-light); font-size: .78rem; color: var(--soil-mid); }
  .rail-note p { margin: 0 0 .4rem; }
  .rail-note p:last-child { margin-bottom: 0; }
`;

/** The inlined page script, as a plain function body handed to
 *  embedScriptText — mirrors spider-fly-viz.mjs's own `(function () {
 *  "use strict"; ... })()` IIFE shape, with every spliced helper listed at
 *  the top of the closure exactly like that page's own const bindings. */
function pageScript() {
  return `(function () {
  "use strict";
  const DATA = MUD_PAGE_DATA;
  const createTicker = ${createTicker.toString()};
  const esc = ${escapeHtml.toString()};
  const speciesOfCharacter = ${speciesOfCharacter.toString()};
  const mudRoomSceneObjects = ${mudRoomSceneObjects.toString()};
  const carriedItemsFor = ${carriedItemsFor.toString()};
  const levelsOf = ${levelsOf.toString()};
  const levelBands = ${levelBands.toString()};
  const charactersInRoom = ${charactersInRoom.toString()};
  const roomSceneObjects = ${roomSceneObjects.toString()};
  const scenePlacement = ${scenePlacement.toString()};
  const spriteClassForObject = ${spriteClassForObject.toString()};
  const spriteAncestryRows = ${spriteAncestryRows.toString()};
  const visibleRoomOf = ${visibleRoomOf.toString()};
  const roomKindForRoom = ${roomKindForRoom.toString()};
  const factsForSubject = ${factsForSubject.toString()};

  const el = (id) => document.getElementById(id);
  const characters = DATA.characters;
  const characterIds = characters.map((c) => c.id);
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- the one shared tick queue -----------------------------------------
  // Every window's ticker calls into this instead of session.windows[...]
  // directly, so two characters' turns can never interleave their reads and
  // writes of the one shared memoryDir, and the global turn counter always
  // increments in real execution order.
  let tickChain = Promise.resolve();
  function serializeTick(fn) {
    const run = tickChain.then(fn, fn);
    tickChain = run.catch(function () {});
    return run;
  }

  let session = null;
  let globalTurn = 0;
  let maxTurns = DATA.defaultMaxTurns;
  let delayMs = DATA.defaultDelayMs;
  const wait = function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
  const liveWait = function () { return wait(delayMs); };

  const knownRoomIds = new Set();
  let freshlyDugRoom = null;
  const speechBubbles = new Map(); // room -> { character, text, expiresAtTurn }

  const tickers = {};
  let autoOn = false;

  function hasNext() { return globalTurn < maxTurns; }

  async function runOneTurn(character) {
    return serializeTick(async function () {
      globalTurn += 1;
      const result = await session.windows[character].autoplayTick(globalTurn);
      afterEngineTurn(character, result);
      return result;
    });
  }

  function afterEngineTurn(character, result) {
    if (!result || !result.room) { renderAll(); return; }
    if (!knownRoomIds.has(result.room)) knownRoomIds.add(result.room);
    if (result.roomAfter && !knownRoomIds.has(result.roomAfter)) {
      freshlyDugRoom = result.roomAfter;
      knownRoomIds.add(result.roomAfter);
    }
    const ask = (result.actions || []).find(function (a) { return a.step === "investigate" && a.kind === "ask"; });
    if (ask) {
      speechBubbles.set(result.room, {
        character: character, text: character + " asks about food \\u2014 hears about " + ask.thing + ".",
        expiresAtTurn: globalTurn + 1,
      });
    }
    renderAll();
  }

  function ensureTicker(character) {
    if (tickers[character]) return tickers[character];
    const w = windowIdFor(character);
    const playBtn = el(w + "-play");
    const stepBtn = el(w + "-step");
    const ticker = createTicker({
      onTick: function () { return runOneTurn(character); },
      onRender: function (state) {
        playBtn.textContent = state.playing ? "\\u23F8 pause" : "\\u25B6 play";
      },
      hasNext: hasNext,
      wait: liveWait,
    });
    playBtn.addEventListener("click", function () { ticker.play(); });
    stepBtn.addEventListener("click", function () { ticker.stepOnce(); });
    tickers[character] = ticker;
    return ticker;
  }

  function windowIdFor(character) {
    const c = characters.find(function (x) { return x.id === character; });
    return "window-" + c.slot;
  }

  // ---- chat docks ---------------------------------------------------------
  function wireChat(character) {
    const w = windowIdFor(character);
    const form = el(w + "-chatform");
    const input = el(w + "-chatq");
    const log = el(w + "-chatlog");
    const pillsEl = el(w + "-chatpills");
    function append(cls, text) {
      const d = document.createElement("div");
      d.className = cls;
      d.textContent = text;
      log.appendChild(d);
      log.scrollTop = log.scrollHeight;
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      const line = input.value.trim();
      if (!line) return;
      input.value = "";
      append("u", line);
      serializeTick(function () { return session.windows[character].turn(line); }).then(function (res) {
        append("a", res.answer);
        renderAll();
      });
    });
    for (const pill of pillsEl.querySelectorAll(".pill")) {
      pill.addEventListener("click", function () {
        input.value = pill.getAttribute("data-fill");
        input.focus();
      });
    }
  }

  // ---- room-view rendering -------------------------------------------------
  function roomKindTint(kind) {
    if (kind === "outdoor") return "var(--root-moss)";
    return "var(--soil-mid)";
  }

  function spriteSvgFor(species, rows) {
    if (window.tmctMud && window.tmctMud.resolveSpriteAsset) {
      return window.tmctMud.resolveSpriteAsset(species, rows, [], DATA.spriteTemplates, window.tmctMud.SPRITE_REGISTRY);
    }
    return "";
  }

  function objectSvgFor(spriteClass, rows) {
    if (window.tmctMud && window.tmctMud.resolveSpriteForClass) {
      return window.tmctMud.resolveSpriteForClass(spriteClass, rows, window.tmctMud.SPRITE_REGISTRY);
    }
    return "";
  }

  function drawRoomBackdrop(canvas, kind) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    if (kind === "outdoor") {
      grad.addColorStop(0, "#9BB077"); grad.addColorStop(1, "#6B7A4F");
    } else {
      grad.addColorStop(0, "#5A4130"); grad.addColorStop(1, "#2B1D14");
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  function renderRoomView(character, rows, state, here) {
    const w = windowIdFor(character);
    const canvas = el(w + "-canvas");
    const kind = roomKindForRoom(rows, here);
    drawRoomBackdrop(canvas, kind);

    const layer = el(w + "-sprites");
    layer.innerHTML = "";
    const selfNode = document.createElement("div");
    selfNode.className = "sprite self";
    selfNode.innerHTML = spriteSvgFor(speciesOfCharacter(character), rows);
    layer.appendChild(selfNode);

    for (const obj of mudRoomSceneObjects(rows, state, here, character)) {
      const node = document.createElement("div");
      const isCast = characterIds.indexOf(obj.subject) !== -1;
      node.className = "sprite" + (isCast ? " roommate" : "");
      node.innerHTML = isCast ? spriteSvgFor(speciesOfCharacter(obj.subject), rows) : objectSvgFor(obj.spriteClass, rows);
      node.title = obj.subject;
      layer.appendChild(node);
    }

    const bubbleEl = el(w + "-bubble");
    const bubble = speechBubbles.get(here);
    if (bubble && bubble.expiresAtTurn >= globalTurn) {
      bubbleEl.textContent = bubble.text;
      bubbleEl.hidden = false;
      bubbleEl.classList.add("shown");
    } else {
      bubbleEl.classList.remove("shown");
      bubbleEl.hidden = true;
    }

    const flourishEl = el(w + "-flourish");
    if (freshlyDugRoom && freshlyDugRoom === here && !reduceMotion) {
      flourishEl.hidden = false;
      flourishEl.classList.add("shown");
      setTimeout(function () { flourishEl.classList.remove("shown"); flourishEl.hidden = true; }, 900);
    }

    el(w + "-caption").textContent = roomCaptionFor(rows, state, here, character);
  }

  function roomCaptionFor(rows, state, here, character) {
    if (!window.tmctMud) return here;
    const view = window.tmctMud.worldDigestRows(rows, state, character);
    const lines = view.filter(function (r) { return r.subject.toLowerCase() === here.toLowerCase(); })
      .map(function (r) { return r.subject + " " + r.predicate + " " + r.object + "."; });
    return lines.length ? lines.join(" ") : ("You are in the " + here + ".");
  }

  function renderPouch(character, rows, state) {
    const w = windowIdFor(character);
    const list = el(w + "-pouch-list");
    const items = carriedItemsFor(rows, state, character);
    list.innerHTML = items.map(function (i) { return "<li>" + esc(i.subject) + "</li>"; }).join("");
    const mass = state.masses.get(character);
    const cfgKey = speciesOfCharacter(character);
    const drain = DATA.mudConfig[cfgKey + "MassDecrementPerTurn"];
    el(w + "-stats").textContent = "mass " + (mass ? mass.value : "?") + (drain !== undefined ? " \\u00b7 drain/turn " + drain : "");
  }

  function renderMinimap(character, rows, state, here) {
    const w = windowIdFor(character);
    const mapEl = el(w + "-minimap");
    const visited = session.windows[character].visitedRoomIds();
    const levels = levelsOf(state, DATA.rootRoom);
    const myLevel = levels.get(here);
    const rooms = visited.filter(function (r) { return levels.get(r) === myLevel; }).sort();
    mapEl.innerHTML = rooms.map(function (r) {
      return "<span class=\\"minimap-room" + (r === here ? " current" : "") + "\\">" + esc(r) + "</span>";
    }).join("");
  }

  function renderWorldMap(rows, state) {
    const levels = levelsOf(state, DATA.rootRoom);
    const bands = levelBands(levels);
    el("worldMapBands").innerHTML = bands.map(function (band) {
      const rooms = band.rooms.map(function (r) {
        const cast = charactersInRoom(state, r, characterIds);
        const castText = cast.length ? "<span class=\\"room-cast\\">" + cast.map(function (c) { return speciesOfCharacter(c); }).join(",") + "</span>" : "";
        const fresh = r === freshlyDugRoom ? " freshly-dug" : "";
        return "<span class=\\"map-room" + fresh + "\\">" + esc(r) + castText + "</span>";
      }).join("");
      return "<div class=\\"map-band\\"><span class=\\"band-level\\">L" + band.level + "</span><span class=\\"band-rooms\\">" + rooms + "</span></div>";
    }).join("");
    el("worldMapTurn").textContent = "turn " + globalTurn;
  }

  function renderAll() {
    if (!session) return;
    updateGlobalTurnLabel();
    session.snapshot().then(function (snap) {
      renderWorldMap(snap.rows, snap.state);
      for (const c of characters) {
        const here = snap.state.placements.get(c.id) ? snap.state.placements.get(c.id).object : null;
        const w = "window-" + c.slot;
        el(w + "-turn").textContent = "turn " + globalTurn;
        el(w + "-count").textContent = globalTurn + " turns";
        if (!here) continue;
        renderRoomView(c.id, snap.rows, snap.state, here);
        renderPouch(c.id, snap.rows, snap.state);
        renderMinimap(c.id, snap.rows, snap.state, here);
      }
      freshlyDugRoom = null;
    });
  }

  // ---- the rail -------------------------------------------------------------
  function wireRail() {
    const autoBtn = el("autoToggle");
    const delaySlider = el("delaySlider");
    const maxTurnsSlider = el("maxTurnsSlider");
    const resetBtn = el("resetBtn");
    autoBtn.addEventListener("click", function () {
      autoOn = !autoOn;
      autoBtn.setAttribute("aria-pressed", autoOn ? "true" : "false");
      autoBtn.textContent = autoOn ? "\\u23F8 auto" : "\\u25B6 auto";
      for (const c of characters) {
        const ticker = tickers[c.id];
        if (!ticker) continue;
        if (autoOn) ticker.play(); else ticker.pause();
      }
    });
    delaySlider.addEventListener("input", function () {
      delayMs = Number(delaySlider.value);
      el("delayValue").textContent = delayMs + "ms";
    });
    maxTurnsSlider.addEventListener("input", function () {
      maxTurns = Number(maxTurnsSlider.value);
      el("maxTurnsValue").textContent = String(maxTurns);
    });
    resetBtn.addEventListener("click", function () { boot(); });
  }

  function updateGlobalTurnLabel() {
    el("globalTurnCount").textContent = "turns: " + globalTurn;
  }

  async function boot() {
    for (const c of characters) {
      const ticker = tickers[c.id];
      if (ticker) ticker.pause();
    }
    globalTurn = 0;
    knownRoomIds.clear();
    freshlyDugRoom = null;
    speechBubbles.clear();
    tickChain = Promise.resolve();
    for (const c of characters) {
      const w = "window-" + c.slot;
      el(w + "-chatlog").innerHTML = "";
    }
    session = await window.tmctMud.createMudSession(DATA.worldPayload, { characters: characterIds });
    for (const c of characters) {
      const w = "window-" + c.slot;
      el(w + "-play").disabled = false;
      el(w + "-step").disabled = false;
      el(w + "-chatq").disabled = false;
      for (const pill of el(w + "-chatpills").querySelectorAll(".pill")) pill.disabled = false;
      ensureTicker(c.id);
      wireChat(c.id);
    }
    updateGlobalTurnLabel();
    renderAll();
    // Default on load: only the NW window plays, the rest start paused.
    const nw = characters.find(function (c) { return c.slot === "nw"; });
    if (nw) tickers[nw.id].play();
  }

  wireRail();
  boot();
})();`;
}
