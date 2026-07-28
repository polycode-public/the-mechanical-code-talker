// mud-viz.mjs — mud.html: the self-contained proof of the shared,
// multi-character shape PLAN_MUD.md's "Demo phase" section describes. Two
// burrowing animals, picked from the world's own roster, each get their own
// pane over ONE shared live world (mud-browser-entry.mjs's createMudSession);
// an omniscient survey of the whole burrow sits in the top row beside the
// controls with no fog of war at all, the one deliberate exception
// PLAN_MUD.md names.
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
// render-glue — `roomSceneObjects`/`scenePlacement`/`spriteClassForObject`/
// `spriteAncestryRows`/`factsForSubject`/`visibleRoomOf`/`roomKindForRoom`
// are REUSED directly from adventure-viz.mjs rather than re-derived:
// mud-garden ships no individual
// named "player" (the whole point of the multi-character demo), so those
// functions' own hardcoded "player" exclusion never fires for a mud
// character — every character reads back as an ordinary visible object of
// its room until this page's own code filters the CURRENT viewing character
// out by name (mudRoomSceneObjects, below).
//
// A room's graphic is a rendering of worldDigestRows'/roomAffordances' own
// text digest, never a replacement for it (PLAN_MUD.md's own "Room view"
// spec): a soil-toned canvas backdrop (roomKindForRoom picks outdoor/
// underground), the viewing character's own sprite standing right, every
// room-mate entering from the left, and every loose object hung on the back
// wall in a portrait frame (scenePlacement decides how high it hangs). The
// six compass affordances sit around that box where their own directions
// point, each one either the "go" a written exit already allows or the "dig"
// that would open one.
//
// The burrow survey is ONE svg routine (burrowSvg over burrowGraph) drawn
// twice: the omniscient board in the top row, and each pane's own
// visited-only "known ground". Same layout, same treatment, one code path —
// adapted from adventure-viz.mjs's own roomMapSvg/visitedRoomGraph pair, with
// a cell-collision nudge burrowGraph needs and that page does not (a mud
// character can dig down AND south out of one room, and both land on the
// same grid cell otherwise).
//
// ONE ticker instance per pane (viz-ticker.mjs's createTicker), so
// each can play/step independently, plus the deck's own "play" control that
// calls .play()/.pause() on both pane tickers at once. Nothing plays until
// that control is clicked. Every tick, from ANY pane, is funneled through one
// shared async queue (serializeTick, spliced below) so two characters' turns
// can never interleave their reads/writes of the one shared memoryDir —
// mud-browser-entry.mjs's own header names this as the caller's
// responsibility, and this is where that responsibility is discharged. The
// queue is also what makes the deck's GLOBAL turn counter well-defined: it
// increments in the exact order turns actually executed, never a race
// between panes.
import { THEME_TOKENS_CSS, SERIF_STACK, MONO_STACK, escapeHtml, embedJson, embedScriptText } from "./viz-theme.mjs";
import { createTicker } from "./viz-ticker.mjs";
import {
  roomSceneObjects, scenePlacement, spriteClassForObject, spriteAncestryRows, factsForSubject,
  visibleRoomOf, roomKindForRoom, allRoomIds,
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
const PANE_SLOTS = ["a", "b"];
const DEFAULT_DELAY_MS = 650;
const DEFAULT_MAX_TURNS = 400;

const MUD_NOTE_LINES = [
  "Two burrowing animals share one world here. Each one only knows what it has dug up, asked about, or been told. Nobody sees the whole burrow except you, watching from the survey above.",
  `This is a MUD, short for Multi Underground creature Dig. The name nods to MUD, or in its current form MUDII (mudii.co.uk), one of the first multiplayer text games. The dig-your-own-rooms idea came from a skim of Wikipedia's Colossal Cave Adventure article, the game that started the genre.`,
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
 *  keeps the level unchanged — what tells the survey where the turf line
 *  falls. A room unreachable from `root` (should not happen — every dug room
 *  writes a two-way exit back) is simply absent from the map rather than
 *  guessed at. Pure, self-contained. */
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

/** Which characters currently stand in `room` — the survey's own per-room
 *  roster, both for the omniscient board and a pane's own visited-only one.
 *  Pure. */
export function charactersInRoom(state, room, characters) {
  return characters.filter((c) => state.placements.get(c)?.object === room);
}

/** The rooms in `roomIds` laid out on an integer grid FROM the world's own
 *  has-exit-* directions — never a force-directed guess, so a room north of
 *  another sits one row above it and a room dug DOWN sits one row below.
 *  Adapted from adventure-viz.mjs's `visitedRoomGraph`, with two differences
 *  a burrow needs and a manor does not: a cell already taken nudges right
 *  rather than stacking two rooms on one square (dig down and dig south from
 *  the same room otherwise collide), and every node carries its own `level`
 *  so the renderer can draw the turf line between the surface and the soil.
 *  An edge is drawn only between two rooms BOTH in `roomIds`; `hints` names
 *  every exit from an included room toward one that is not — the direction
 *  only, never the excluded room's own name, so a fog-of-war caller can draw
 *  "there's a way on" and nothing more. Pure. */
export function burrowGraph(state, roomIds, root = "garden") {
  const DELTA = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0], up: [0, -1], down: [0, 1] };
  const known = new Set(roomIds || []);
  const positions = new Map();
  const taken = new Set();
  const edges = [];
  const edgeKeys = new Set();
  const hints = [];
  const place = (room, x, y) => {
    let px = x;
    for (let guard = 0; taken.has(px + "," + y) && guard < 64; guard += 1) px += 1;
    positions.set(room, { x: px, y });
    taken.add(px + "," + y);
  };
  let offsetX = 0;
  for (const start of [root, ...[...known].sort()]) {
    if (!known.has(start) || positions.has(start)) continue;
    place(start, offsetX, 0);
    const queue = [start];
    while (queue.length) {
      const room = queue.shift();
      const pos = positions.get(room);
      const dirs = state.exits.get(room);
      for (const direction of [...(dirs?.keys() ?? [])].sort()) {
        const target = dirs.get(direction);
        if (!known.has(target)) { hints.push({ from: room, direction }); continue; }
        const key = [room, target].sort().join("\0");
        if (!edgeKeys.has(key)) { edgeKeys.add(key); edges.push({ from: room, to: target, direction }); }
        if (positions.has(target)) continue;
        const d = DELTA[direction] ?? [0, 0];
        place(target, pos.x + d[0], pos.y + d[1]);
        queue.push(target);
      }
    }
    offsetX = Math.max(...[...positions.values()].map((p) => p.x)) + 2;
  }
  const levels = levelsOf(state, root);
  const xs = [...positions.values()].map((p) => p.x);
  const ys = [...positions.values()].map((p) => p.y);
  const minX = Math.min(0, ...xs);
  const minY = Math.min(0, ...ys);
  const nodes = [...known].filter((room) => positions.has(room)).sort().map((room) => {
    const p = positions.get(room);
    return { id: room, x: p.x - minX, y: p.y - minY, level: levels.has(room) ? levels.get(room) : null };
  });
  return { nodes, edges, hints };
}

/** The directions `here` can still be dug in: every direction the room's kind
 *  allows that has no written exit yet. Above ground there is nothing to
 *  tunnel sideways THROUGH, so a garden digs straight down and no other way;
 *  underground, all six are open soil. The engine is the authority on this —
 *  the page prefers `tmctMud.diggableDirections` whenever the bundle exposes
 *  one and only falls back to the rule below. Pure, self-contained
 *  (roomKindForRoom is spliced alongside it). */
export function diggableDirections(rows, state, here) {
  const exits = state.exits.get(here);
  const kind = roomKindForRoom(rows, here);
  const allowed = kind === "outdoor" ? ["down"] : ["north", "south", "east", "west", "up", "down"];
  return allowed.filter((direction) => !exits || !exits.has(direction));
}

/** A carried or loose object's display name. A dug object is minted as
 *  `<kind>-<the full nested room id it was dug from>` (adventure.mjs's
 *  freshRoomId), which reads as a path, not a thing — so a subject that ends
 *  in "-<a room this world actually has>" shows as its kind alone. Every
 *  other id (the world's hand-authored props: "carrot", "worm-1") is already
 *  a name and passes straight through. Pure. */
export function itemLabel(subject, roomIds) {
  const id = String(subject);
  for (const room of roomIds || []) {
    const suffix = "-" + room;
    if (id.length > suffix.length && id.endsWith(suffix)) return id.slice(0, -suffix.length);
  }
  return id;
}

/** Whether `subject` is a creature rather than a prop: the world places a
 *  character with `mgx:currently-in` and everything else with a containment
 *  predicate, the same split mud-turn.mjs's own "what is there to examine"
 *  filter reads. Pure — so the room view can put animals on the floor and
 *  props on the wall without a roster to check against, and a character the
 *  page is not itself driving (an NPC) still reads as an animal. */
export function isCreature(state, subject) {
  return state.placements.get(subject)?.predicate === "mgx:currently-in";
}

/** The self-contained mud.html page. Pure — identical output for identical
 *  input; every other piece of state (the live world, chat, ticks) is
 *  computed in the browser once the sibling bundle loads.
 *  `characters` is the ROSTER this page may draw from, `[{ id, species }]`;
 *  the page renders one pane per PANE_SLOTS entry and binds a character to
 *  each at boot, so which two of the roster actually play is decided live by
 *  the engine's own pickMudRoster — the same draw the shared session is then
 *  opened for, never a second one. `worldPayload` is `{ name, facts,
 *  rules, opening }`, read once at build time through the real worlds-pack
 *  provider (see this module's own header). `spriteTemplates` is the
 *  large-tier sprite set (data/sprites-large/*.toml) so every species
 *  resolves its own art instead of falling back to the flat animal icon.
 *  `mudConfig` defaults to game-config.mjs's own DEFAULT_GAME_CONFIG.mud —
 *  the per-species mass/speed/dig-reach reference table each pane's stat line
 *  reads for flavor. `engineBundleJs` inlines the built mud-browser bundle
 *  instead of the sibling `<script src>`, mirroring spider-fly-viz.mjs's own
 *  standalone-export knob; default empty keeps the site build's sibling-file
 *  arrangement unchanged. */
export function renderMudHtml({
  title = DEFAULT_TITLE,
  worldPayload,
  characters = [],
  spriteTemplates = [],
  mudConfig = DEFAULT_GAME_CONFIG.mud,
  engineBundleJs = "",
} = {}) {
  const slots = PANE_SLOTS.slice(0, Math.max(1, Math.min(PANE_SLOTS.length, characters.length || PANE_SLOTS.length)));
  const pageData = embedJson({
    worldPayload, characters, spriteTemplates, mudConfig,
    slots,
    rootRoom: ROOT_ROOM,
    defaultDelayMs: DEFAULT_DELAY_MS,
    defaultMaxTurns: DEFAULT_MAX_TURNS,
  });

  const paneHtml = slots.map((slot) => paneMarkup(slot)).join("\n");

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
  <h1 class="eyebrow">tmct &middot; mud</h1>
  <div class="deck-row">
    <section class="deck" aria-label="simulation controls">
      <div class="deck-controls">
        <button type="button" class="deck-play" id="autoToggle" aria-pressed="false">&#9654; play</button>
        <button type="button" id="resetBtn">reset</button>
        <span class="mono deck-turns" id="globalTurnCount">turns: 0</span>
      </div>
      <div class="deck-sliders">
        <label class="deck-slider">delay
          <input type="range" id="delaySlider" min="80" max="2000" step="20" value="${DEFAULT_DELAY_MS}">
          <span class="mono" id="delayValue">${DEFAULT_DELAY_MS}ms</span>
        </label>
        <label class="deck-slider">max turns
          <input type="range" id="maxTurnsSlider" min="20" max="2000" step="20" value="${DEFAULT_MAX_TURNS}">
          <span class="mono" id="maxTurnsValue">${DEFAULT_MAX_TURNS}</span>
        </label>
      </div>
      <div class="deck-note mud-note">
        <p>${escapeHtml(MUD_NOTE_LINES[0])}</p>
        <p>${escapeHtml(MUD_NOTE_LINES[1])}</p>
      </div>
    </section>
    <section class="world-map" id="worldMap" aria-label="the whole burrow, every room, every character">
      <div class="world-map-head">
        <span class="world-map-title">the whole burrow</span>
        <span class="mono world-map-turn" id="worldMapTurn">turn 0</span>
      </div>
      <div class="world-map-board" id="worldMapBoard"></div>
      <div class="world-map-key" id="worldMapKey"></div>
    </section>
  </div>
  <div class="mud-stage" id="mudStage">
${paneHtml}
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

/** One pane, character-agnostic: which animal it shows is stamped in at boot
 *  (`data-character`, the heading, the chat dock's own labels), so the page
 *  can draw a different pair out of the roster on every reset without a
 *  rebuild. */
function paneMarkup(slot) {
  const w = `window-${slot}`;
  return `    <section class="mud-window pane-${escapeHtml(slot)}" id="${w}" data-slot="${escapeHtml(slot)}" data-character="">
      <div class="pane-head">
        <h2 id="${w}-name">waiting</h2>
        <span class="mono pane-turn" id="${w}-turn">turn 0</span>
      </div>
      <div class="room-stage">
        <div class="room-view" id="${w}-room">
          <canvas id="${w}-canvas" width="420" height="152" aria-hidden="true"></canvas>
          <div class="wall-band" id="${w}-wall"></div>
          <div class="floor-band">
            <div class="floor-others" id="${w}-others"></div>
            <div class="floor-self" id="${w}-self"></div>
          </div>
          <div class="bubbles" id="${w}-bubbles"></div>
          <div class="dig-flourish" id="${w}-flourish" hidden></div>
          <div class="strike-flash" id="${w}-strike" aria-hidden="true"></div>
        </div>
        <div class="dir-ring" id="${w}-dirs" aria-label="ways out of this room">
          <div class="dir-slot dir-north" id="${w}-dir-north"></div>
          <div class="dir-slot dir-up" id="${w}-dir-up"></div>
          <div class="dir-slot dir-west" id="${w}-dir-west"></div>
          <div class="dir-slot dir-east" id="${w}-dir-east"></div>
          <div class="dir-slot dir-south" id="${w}-dir-south"></div>
          <div class="dir-slot dir-down" id="${w}-dir-down"></div>
        </div>
      </div>
      <p class="room-caption" id="${w}-caption"></p>
      <div class="pane-columns">
        <div class="pouch" aria-label="pouch">
          <h3>pouch</h3>
          <ul class="pouch-list" id="${w}-pouch-list"></ul>
          <p class="mono stat-line" id="${w}-stats"></p>
        </div>
        <div class="minimap" aria-label="what this character has dug or walked">
          <h3>known ground</h3>
          <div class="minimap-board" id="${w}-minimap"></div>
        </div>
      </div>
      <div class="chat">
        <div class="chatlog" id="${w}-chatlog" aria-live="polite"></div>
        <div class="log-popup" id="${w}-logpop" role="dialog" aria-label="the whole reply" hidden>
          <p class="log-popup-text" id="${w}-logpop-text"></p>
          <button type="button" class="log-popup-close" id="${w}-logpop-close" aria-label="close the whole reply">&times;</button>
        </div>
      </div>
      <div class="chat-console">
        <div class="chatpills" id="${w}-chatpills" role="group" aria-label="quick commands"></div>
        <form class="chatask" id="${w}-chatform">
          <span class="prompt mono">tmct&gt;</span>
          <input id="${w}-chatq" type="text" placeholder="look" aria-label="type a command" disabled>
        </form>
      </div>
      <div class="pane-controls">
        <button type="button" id="${w}-play" disabled>&#9654; play</button>
        <button type="button" id="${w}-step" disabled>step</button>
        <p class="pane-fate" id="${w}-fate" role="status" hidden></p>
      </div>
    </section>`;
}

const MUD_STYLE = `
  :root {
    --soil-deep: #241710; --soil-mid: #4A3324; --soil-light: #7A5A3D;
    --root-moss: #6B7A4F; --parchment: #EFE6D8; --mud-ink: #2A211A;
    --burrow-glow: #E8A33D; --chalk: #D9CDB9;
    --actor-a: #E0912A; --actor-b: #5F97B3;
    --pane-height: 618px;
  }
  html { background: var(--soil-deep); }
  body { margin: 0; background: linear-gradient(180deg, var(--root-moss) 0%, var(--soil-light) 14%, var(--soil-mid) 48%, var(--soil-deep) 100%) fixed; color: var(--mud-ink); font-family: ${SANS_STACK}; font-size: 15px; line-height: 1.5; }
  .mono { font-family: ${MONO_STACK}; }
  main { max-width: 1280px; margin: 0 auto; padding: 1.1rem 1.2rem 2.4rem; }
  .eyebrow { font-family: ${MONO_STACK}; font-weight: 500; font-size: .72rem; letter-spacing: .16em; text-transform: uppercase; color: var(--parchment); opacity: .9; margin: 0 0 .8rem; }
  h2 { font-family: ${DISPLAY_STACK}; font-size: 1rem; margin: 0; text-transform: capitalize; }
  h3 { font-family: ${MONO_STACK}; font-size: .58rem; margin: 0 0 .3rem; text-transform: uppercase; letter-spacing: .12em; color: var(--soil-mid); }
  button { font: inherit; color: inherit; background: none; cursor: pointer; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--burrow-glow); outline-offset: 2px; }
  button:disabled { opacity: .4; cursor: default; }

  /* ---- top row: the control deck, and the survey beside it ---- */
  .deck-row { display: grid; grid-template-columns: 2fr 1fr; gap: 1rem; align-items: stretch; margin-bottom: 1rem; }
  .deck {
    background: var(--parchment); border: 1px solid var(--soil-mid); border-radius: 4px;
    box-shadow: 0 2px 0 rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.35);
    padding: .8rem .9rem; display: flex; flex-direction: column; gap: .55rem; min-width: 0;
  }
  .deck-controls { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
  .deck button, .pane-controls button {
    font-family: ${MONO_STACK}; font-size: .72rem; text-transform: uppercase; letter-spacing: .08em;
    padding: .32rem .7rem; border: 1px solid var(--soil-mid); border-radius: 3px; background: rgba(255,255,255,.5);
  }
  .deck button:hover:not(:disabled), .pane-controls button:hover:not(:disabled) { border-color: var(--burrow-glow); }
  .deck-play { background: var(--mud-ink) !important; color: var(--parchment); border-color: var(--mud-ink) !important; padding: .38rem 1.1rem !important; }
  .deck-play[aria-pressed="true"] { background: var(--burrow-glow) !important; border-color: var(--burrow-glow) !important; color: var(--mud-ink); }
  .deck-turns { margin-left: auto; font-size: .74rem; color: var(--soil-mid); }
  .deck-sliders { display: flex; flex-wrap: wrap; gap: 1rem; }
  .deck-slider { display: flex; align-items: center; gap: .35rem; font-family: ${MONO_STACK}; font-size: .62rem; text-transform: uppercase; letter-spacing: .08em; color: var(--soil-mid); }
  .deck-slider input[type="range"] { accent-color: var(--burrow-glow); width: 8rem; max-width: 34vw; }
  .deck-note { margin-top: auto; padding-top: .5rem; border-top: 1px solid var(--soil-light); font-size: .78rem; color: var(--soil-mid); }
  .deck-note p { margin: 0 0 .4rem; max-width: 62ch; }
  .deck-note p:last-child { margin-bottom: 0; }

  .world-map {
    background: var(--soil-deep); color: var(--parchment);
    border: 1px solid var(--burrow-glow); border-radius: 4px; padding: .55rem .65rem .6rem;
    box-shadow: 0 2px 0 rgba(0,0,0,.3); display: flex; flex-direction: column; gap: .4rem; min-width: 0;
  }
  .world-map-head { display: flex; justify-content: space-between; align-items: baseline; gap: .5rem; }
  .world-map-title { font-family: ${MONO_STACK}; font-size: .58rem; text-transform: uppercase; letter-spacing: .12em; opacity: .85; }
  .world-map-turn { font-size: .62rem; opacity: .7; }
  .world-map-board { flex: 1; min-height: 168px; display: flex; align-items: center; justify-content: center; }
  .world-map-board svg { width: 100%; height: 100%; max-height: 230px; }
  .world-map-key { display: flex; flex-wrap: wrap; gap: .5rem; font-family: ${MONO_STACK}; font-size: .58rem; opacity: .85; }
  .key-actor { display: inline-flex; align-items: center; gap: .28rem; }
  .key-dot { width: .5rem; height: .5rem; border-radius: 50%; display: inline-block; }

  /* ---- the survey itself, drawn twice at two sizes ---- */
  .burrow svg { display: block; }
  .burrow .turf { fill: var(--root-moss); opacity: .3; }
  .burrow .ground-line { stroke: var(--root-moss); stroke-width: 1.2; stroke-dasharray: 5 3; opacity: .9; }
  .burrow .tunnel { stroke: var(--soil-light); stroke-width: 5.5; stroke-linecap: round; opacity: .85; }
  .burrow .tunnel.shaft { stroke-dasharray: 3 3.5; stroke-width: 4; }
  .burrow .hint { fill: var(--chalk); opacity: .45; }
  .burrow .room rect { fill: var(--soil-mid); stroke: var(--chalk); stroke-width: .8; }
  .burrow .room.surface rect { fill: var(--root-moss); }
  .burrow .room text { fill: var(--parchment); font-family: ${MONO_STACK}; font-size: 7px; text-anchor: middle; }
  .burrow .room.freshly-dug rect { stroke: var(--burrow-glow); stroke-width: 1.8; animation: dig-pulse 1.2s ease-out; }
  .burrow .occupant { stroke: rgba(0,0,0,.45); stroke-width: .6; }
  @keyframes dig-pulse { 0% { opacity: .25; } 100% { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .burrow .room.freshly-dug rect { animation: none; } }

  /* ---- the panes ---- */
  .mud-stage { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  .mud-window {
    background: var(--parchment); border: 1px solid var(--soil-mid); border-radius: 4px;
    box-shadow: 0 2px 0 rgba(0,0,0,.18), inset 0 1px 0 rgba(255,255,255,.35);
    padding: .7rem .8rem; display: flex; flex-direction: column; gap: .5rem;
    min-width: 0; height: var(--pane-height); box-sizing: border-box; overflow: hidden;
    border-top: 3px solid var(--actor-a);
  }
  .mud-window.pane-b { border-top-color: var(--actor-b); }
  .pane-head { display: flex; align-items: baseline; justify-content: space-between; gap: .5rem; }
  .char-id { font-size: .66rem; color: var(--soil-mid); margin-left: .35rem; text-transform: none; }
  .pane-turn { font-size: .68rem; color: var(--soil-mid); }

  /* ---- room view: one row of soil, the compass around it ---- */
  .room-stage { position: relative; padding: 19px 34px; flex: 0 0 auto; }
  .room-view { position: relative; height: 152px; border-radius: 3px; overflow: hidden; border: 1px solid var(--soil-mid); }
  .room-view canvas { display: block; width: 100%; height: 100%; }
  .wall-band { position: absolute; left: 0; right: 0; top: 4px; height: 62px; display: flex; align-items: flex-start; justify-content: center; gap: .5rem; }
  .wall-item { display: flex; flex-direction: column; align-items: center; min-width: 34px; max-width: 72px; }
  .wall-item .hook { width: 1px; height: 5px; background: rgba(0,0,0,.45); }
  .wall-item .sprite-frame { width: 30px; padding: 2px; box-sizing: border-box; background: rgba(239,230,216,.85); border: 1px solid var(--soil-deep); border-radius: 1px; box-shadow: 0 1px 2px rgba(0,0,0,.35); }
  .wall-item.hangs-high { margin-top: 0; }
  .wall-item.hangs-low { margin-top: 14px; }
  .wall-item svg { width: 100%; display: block; }
  .floor-band { position: absolute; left: 0; right: 0; bottom: 0; height: 86px; display: flex; align-items: flex-end; justify-content: space-between; padding: 0 6px 4px; box-sizing: border-box; }
  .floor-others { display: flex; align-items: flex-end; gap: 6px; }
  .sprite { width: 40px; }
  .sprite svg { width: 100%; display: block; }
  .floor-self .sprite { width: 48px; }

  /* ---- sprite cards: adventure.html's own frame-plus-nameplate treatment,
     shrunk to the one soil row a mud pane has for it. The plate names the
     real subject (mole-1, carrot), never a class word. ---- */
  .sprite-card { display: flex; flex-direction: column; align-items: center; max-width: 76px; }
  .sprite-label {
    margin-top: 2px; max-width: 100%; box-sizing: border-box;
    font-family: ${MONO_STACK}; font-size: .5rem; line-height: 1.25; letter-spacing: .01em; text-align: center;
    color: var(--mud-ink); background: rgba(239,230,216,.92); border: 1px solid var(--soil-mid); border-radius: 2px;
    padding: 0 .22rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .sprite-mass {
    margin-top: 1px; font-family: ${MONO_STACK}; font-size: .46rem; line-height: 1.3; letter-spacing: .02em;
    color: var(--parchment); background: rgba(36,23,16,.72); border-radius: 2px; padding: 0 .2rem; white-space: nowrap;
  }
  .sprite-card.actionable { cursor: pointer; }
  .sprite-card.actionable:hover .sprite-frame, .sprite-card.actionable:focus-visible .sprite-frame { border-color: var(--burrow-glow); }
  .sprite-card.actionable:hover .sprite-label, .sprite-card.actionable:focus-visible .sprite-label { border-color: var(--burrow-glow); background: var(--burrow-glow); }
  .sprite-card.actionable:focus-visible { outline: 2px solid var(--burrow-glow); outline-offset: 1px; }
  .wall-band .sprite-card.actionable { pointer-events: auto; }

  /* ---- the compass ring: each way out sits where it points ---- */
  .dir-ring { position: absolute; inset: 0; pointer-events: none; }
  .dir-slot { position: absolute; pointer-events: auto; }
  .dir-north { top: 0; left: 50%; transform: translateX(-102%); }
  .dir-up { top: 0; left: 50%; transform: translateX(6px); }
  .dir-south { bottom: 0; left: 50%; transform: translateX(-102%); }
  .dir-down { bottom: 0; left: 50%; transform: translateX(6px); }
  .dir-west { left: 0; top: 50%; transform: translateY(-50%); }
  .dir-east { right: 0; top: 50%; transform: translateY(-50%); }
  .dir-pill {
    font-family: ${MONO_STACK}; font-size: .58rem; letter-spacing: .06em; line-height: 1;
    padding: .22rem .42rem; border-radius: 2px; border: 1px solid var(--soil-mid);
    background: var(--parchment); color: var(--mud-ink); white-space: nowrap;
  }
  .dir-pill.dig { border-style: dashed; border-color: var(--burrow-glow); color: var(--soil-mid); background: rgba(232,163,61,.14); }
  .dir-pill.vertical { border-radius: 50%; width: 1.35rem; height: 1.35rem; padding: 0; display: inline-flex; align-items: center; justify-content: center; font-size: .68rem; }
  .dir-pill:hover:not(:disabled) { border-color: var(--burrow-glow); background: var(--burrow-glow); color: var(--mud-ink); }

  .bubbles { position: absolute; inset: 0; pointer-events: none; }
  .bubble {
    position: absolute; max-width: 46%;
    background: var(--parchment); color: var(--mud-ink); border: 1px solid var(--soil-mid); border-radius: 7px;
    padding: .22rem .45rem; font-size: .66rem; line-height: 1.25; box-shadow: 0 2px 4px rgba(0,0,0,.3);
  }
  .bubble.from-self { right: 4%; bottom: 52%; }
  .bubble.from-other { left: 4%; bottom: 52%; }
  .bubble::after { content: ""; position: absolute; bottom: -5px; width: 0; height: 0; border-left: 5px solid transparent; border-right: 5px solid transparent; border-top: 5px solid var(--parchment); }
  .bubble.from-self::after { right: 12%; }
  .bubble.from-other::after { left: 12%; }

  .dig-flourish { position: absolute; inset: 0; pointer-events: none; opacity: 0; background: radial-gradient(circle at 50% 80%, var(--burrow-glow) 0%, transparent 62%); transition: opacity .5s ease; }
  .dig-flourish.shown { opacity: .5; }
  @media (prefers-reduced-motion: reduce) { .dig-flourish { transition: none; opacity: 0 !important; } }

  .room-caption { flex: 0 0 auto; font-size: .74rem; margin: 0; color: var(--soil-mid); height: 2.6em; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }

  .pane-columns { flex: 0 0 auto; display: grid; grid-template-columns: 1fr 1fr; gap: .5rem; height: 86px; }
  .pouch, .minimap { background: rgba(255,255,255,.35); border: 1px solid var(--soil-light); border-radius: 3px; padding: .35rem .45rem; overflow: hidden; display: flex; flex-direction: column; }
  .pouch-list { list-style: none; margin: 0; padding: 0; font-family: ${MONO_STACK}; font-size: .64rem; display: flex; flex-wrap: wrap; gap: .2rem .3rem; overflow-y: auto; }
  .pouch-list li { background: var(--soil-light); color: var(--parchment); border-radius: 2px; padding: .06rem .3rem; }
  .pouch-list:empty::after { content: "carrying nothing"; color: var(--soil-mid); font-family: ${SANS_STACK}; font-style: italic; font-size: .68rem; }
  .stat-line { margin: .25rem 0 0; font-size: .58rem; color: var(--soil-mid); }
  .minimap-board { flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
  .minimap-board svg { width: 100%; height: 100%; max-height: 56px; }
  .minimap-board:empty::after { content: "nothing dug yet"; color: var(--soil-mid); font-style: italic; font-size: .68rem; }
  .minimap .burrow .room text { fill: var(--parchment); font-size: 6px; }
  .minimap .burrow .room.here rect { fill: var(--burrow-glow); }
  .minimap .burrow .room.here text { fill: var(--mud-ink); }

  /* The log is the ONLY thing in a pane allowed to grow, and it grows inward:
     flex-basis 0 keeps its own content out of the pane's height arithmetic, so
     a hundred turns of narration scroll inside it instead of pushing the
     command console off the bottom of a fixed-height pane. */
  .chat { position: relative; flex: 1 1 0; min-height: 2.6rem; display: flex; flex-direction: column; }
  /* Block flow, deliberately, not a flex column: a scrolled log's own lines
     must keep their natural height, and flex items inside a height-capped
     column shrink toward zero instead. */
  .chatlog {
    flex: 1 1 0; min-height: 0; display: block;
    overflow-y: scroll; overscroll-behavior: contain; padding-right: .25rem;
  }
  .chatlog > * { margin: 0 0 .28rem; }
  .chatlog > *:last-child { margin-bottom: 0; }
  /* A styled webkit scrollbar reserves its own gutter, where the overlay one
     Chromium defaults to on macOS shows nothing until you already scroll. The
     standard properties go behind @supports because setting them at all makes
     Blink ignore the pseudo-elements and fall back to that overlay bar. */
  .chatlog::-webkit-scrollbar { width: 9px; }
  .chatlog::-webkit-scrollbar-track { background: rgba(122,90,61,.18); border-radius: 5px; }
  .chatlog::-webkit-scrollbar-thumb { background: var(--soil-light); border-radius: 5px; border: 2px solid var(--parchment); }
  .chatlog::-webkit-scrollbar-thumb:hover { background: var(--soil-mid); }
  @supports not selector(::-webkit-scrollbar) {
    .chatlog { scrollbar-width: thin; scrollbar-color: var(--soil-light) rgba(122,90,61,.18); }
  }
  .chatlog .u { font-family: ${MONO_STACK}; font-size: .66rem; color: var(--soil-mid); overflow-wrap: anywhere; }
  .chatlog .u::before { content: "tmct> "; color: var(--burrow-glow); }
  /* A reply is capped at four rendered lines. A capped one says so and opens the
     whole text in the popup above, so no single answer can take the log over.
     The unclamped variant exists only to be measured against: a line-clamped box
     reports its clamped height as its scrollHeight. */
  .chatlog .a { font-size: .74rem; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
  .chatlog .a.unclamped { display: block; -webkit-line-clamp: none; overflow: visible; }
  .chatlog .clipped { position: relative; cursor: pointer; padding-right: 2.4rem; }
  .chatlog .clipped::after {
    content: "more"; position: absolute; right: 0; bottom: 0;
    font-family: ${MONO_STACK}; font-size: .5rem; letter-spacing: .06em; text-transform: uppercase;
    color: var(--mud-ink); background: var(--burrow-glow); border-radius: 99px; padding: 0 .32rem;
  }
  .chatlog .clipped:hover::after, .chatlog .clipped:focus-visible::after { background: var(--mud-ink); color: var(--parchment); }
  .chatlog .clipped:focus-visible { outline: 2px solid var(--burrow-glow); outline-offset: 1px; }

  .log-popup {
    position: absolute; left: 0; right: 0; bottom: calc(100% - 1.4rem); z-index: 8;
    background: var(--soil-deep); color: var(--parchment);
    border: 1px solid var(--burrow-glow); border-radius: 4px;
    padding: .45rem 1.5rem .5rem .55rem; box-shadow: 0 8px 18px rgba(0,0,0,.5);
    max-height: 13rem; overflow-y: auto; animation: popup-rise .16s ease-out;
  }
  .log-popup::after {
    content: ""; position: absolute; left: 1.4rem; bottom: -6px; width: 0; height: 0;
    border-left: 6px solid transparent; border-right: 6px solid transparent; border-top: 6px solid var(--burrow-glow);
  }
  .log-popup-text { margin: 0; font-size: .74rem; line-height: 1.4; }
  .log-popup-close { position: absolute; top: .1rem; right: .25rem; font-size: 1rem; line-height: 1; color: var(--parchment); padding: .1rem .2rem; }
  .log-popup-close:hover { color: var(--burrow-glow); }
  @keyframes popup-rise { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) { .log-popup { animation: none; } }

  /* The console never moves: pills and prompt sit outside the log's own flex
     track, so no amount of narration can reach them. */
  .chat-console { flex: 0 0 auto; display: flex; flex-direction: column; gap: .3rem; margin-top: .3rem; }
  .chatask { display: flex; align-items: center; gap: .4rem; }
  .chatask .prompt { color: var(--burrow-glow); font-size: .7rem; }
  .chatask input { flex: 1; min-width: 0; font-family: ${MONO_STACK}; font-size: .7rem; background: rgba(255,255,255,.6); color: var(--mud-ink); border: 1px solid var(--soil-mid); border-radius: 2px; padding: .26rem .45rem; box-sizing: border-box; }
  .chatpills { display: flex; flex-wrap: wrap; gap: .22rem; max-height: 3.9rem; overflow-y: auto; scrollbar-width: thin; }
  .chatpills:empty { display: none; }
  .pill { font-family: ${MONO_STACK}; font-size: .58rem; padding: .14rem .45rem; border: 1px solid var(--soil-mid); border-radius: 99px; background: rgba(255,255,255,.5); white-space: nowrap; }
  .pill:hover:not(:disabled) { border-color: var(--burrow-glow); background: var(--burrow-glow); }
  .pill.affordance { border-style: dashed; border-color: var(--soil-light); }
  .pill.way { border-style: solid; border-color: var(--soil-mid); background: rgba(232,163,61,.16); }
  .pane-controls { flex: 0 0 auto; display: flex; align-items: center; gap: .4rem; }
  .pane-fate {
    margin: 0; font-family: ${MONO_STACK}; font-size: .62rem; text-transform: uppercase; letter-spacing: .08em;
    padding: .3rem .6rem; border-radius: 3px; background: var(--soil-deep); color: var(--parchment);
  }
  .mud-window.out-of-play { border-top-color: var(--soil-mid); }
  .mud-window.out-of-play .pane-controls button { display: none; }
  .room-view, .pane-columns { transition: filter .4s ease, opacity .4s ease; }
  .mud-window.out-of-play .room-view, .mud-window.out-of-play .pane-columns { filter: grayscale(1); opacity: .5; }
  .mud-window.out-of-play .dir-ring { display: none; }

  /* ---- the pounce: the one violent beat on a page that otherwise only fades.
     Every other motion here eases out; this one accelerates into the prey and
     stops dead. It plays once, on the tick a character is first out of play,
     and the pane grays out underneath it when it lands. ---- */
  .strike-flash {
    position: absolute; inset: 0; pointer-events: none; opacity: 0;
    background: radial-gradient(circle at 76% 72%, rgba(158,32,16,.95) 0%, rgba(36,23,16,.62) 40%, transparent 72%);
  }
  @keyframes strike-flash { 0%, 42% { opacity: 0; } 50% { opacity: .92; } 100% { opacity: 0; } }
  @keyframes fox-pounce {
    0% { transform: translateX(0) scale(1); }
    16% { transform: translateX(-7px) scale(.94); }
    54% { transform: translateX(var(--pounce-x, 180px)) scale(1.48); }
    100% { transform: translateX(var(--pounce-x, 180px)) scale(1.44); }
  }
  @keyframes prey-taken {
    0%, 40% { transform: none; opacity: 1; }
    47% { transform: translateX(-6px) rotate(-8deg); }
    54% { transform: translateX(6px) rotate(7deg); }
    61% { transform: translateX(-4px) rotate(-4deg); }
    100% { transform: translateX(3px) rotate(4deg) scale(.82); opacity: 0; }
  }
  .room-view.pounce .sprite-card.lunging { position: relative; z-index: 3; transform-origin: 50% 100%; animation: fox-pounce 1.05s cubic-bezier(.6,0,.85,.4) forwards; }
  .room-view.pounce .floor-self { transform-origin: 50% 100%; animation: prey-taken 1.05s cubic-bezier(.4,0,.2,1) forwards; }
  .room-view.pounce .strike-flash { animation: strike-flash 1.05s ease-out forwards; }
  .room-view.pounce .bubbles, .room-view.pounce .wall-band { opacity: .35; }
  @keyframes fate-drop { from { opacity: 0; transform: translateY(-7px); } to { opacity: 1; transform: none; } }
  .pane-fate { animation: fate-drop .3s ease-out; }
  @media (prefers-reduced-motion: reduce) {
    .room-view, .pane-columns { transition: none; }
    .pane-fate { animation: none; }
    .room-view.pounce .sprite-card.lunging, .room-view.pounce .floor-self, .room-view.pounce .strike-flash { animation: none; }
  }

  @media (max-width: 900px) {
    :root { --pane-height: 596px; }
    .deck-row { grid-template-columns: 1fr; }
    .mud-stage { grid-template-columns: 1fr; }
    .world-map-board { min-height: 150px; }
  }
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
  const charactersInRoom = ${charactersInRoom.toString()};
  const burrowGraph = ${burrowGraph.toString()};
  const diggableDirections = ${diggableDirections.toString()};
  const itemLabel = ${itemLabel.toString()};
  const isCreature = ${isCreature.toString()};
  const roomSceneObjects = ${roomSceneObjects.toString()};
  const scenePlacement = ${scenePlacement.toString()};
  const spriteClassForObject = ${spriteClassForObject.toString()};
  const spriteAncestryRows = ${spriteAncestryRows.toString()};
  const factsForSubject = ${factsForSubject.toString()};
  const visibleRoomOf = ${visibleRoomOf.toString()};
  const roomKindForRoom = ${roomKindForRoom.toString()};
  const allRoomIds = ${allRoomIds.toString()};

  const el = (id) => document.getElementById(id);
  const roster = DATA.characters.map(function (c) { return c.id; });
  const slots = DATA.slots;
  const ACTOR_COLORS = ["var(--actor-a)", "var(--actor-b)"];
  const COMPASS = ["north", "south", "east", "west", "up", "down"];
  const DIR_GLYPH = { north: "\\u25B2 N", south: "\\u25BC S", west: "\\u25C0 W", east: "E \\u25B6", up: "\\u21E1", down: "\\u21E3" };
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- the one shared tick queue -----------------------------------------
  // Every pane's ticker calls into this instead of session.windows[...]
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
  let cast = [];
  const slotOf = {};
  let globalTurn = 0;
  const turnsTaken = {};
  const eaten = {};
  let maxTurns = DATA.defaultMaxTurns;
  let delayMs = DATA.defaultDelayMs;
  const wait = function (ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); };
  const liveWait = function () { return wait(delayMs); };

  let freshlyDugRoom = null;
  // The last omniscient read, kept so the eaten scene can draw the predator's
  // own den after the engine has already moved the character out of every room.
  let lastSnapshot = null;
  const speechBubbles = new Map(); // room -> [{ speaker, text, expiresAtTurn }]

  const tickers = {};
  let autoOn = false;

  function hasNext() { return globalTurn < maxTurns; }
  function paneIdFor(character) { return "window-" + slotOf[character]; }
  function colorFor(character) { return ACTOR_COLORS[cast.indexOf(character) % ACTOR_COLORS.length]; }

  // The engine keeps each character's own tally (its scripted ticks AND its
  // typed commands), which is the only one that can be right: a typed "dig
  // north" is a turn the page never drove. The page's own count of the ticks it
  // fired is the fallback, so a pane never falls back to showing the shared
  // global figure as if it were its own.
  function turnsFor(character) {
    const w = session && session.windows[character];
    const own = w && typeof w.turnsTaken === "function" ? w.turnsTaken() : null;
    return typeof own === "number" ? own : (turnsTaken[character] || 0);
  }

  async function runOneTurn(character) {
    return serializeTick(async function () {
      if (eaten[character]) return { outOfPlay: true };
      globalTurn += 1;
      const result = await session.windows[character].autoplayTick(globalTurn);
      if (!result.outOfPlay) turnsTaken[character] = (turnsTaken[character] || 0) + 1;
      afterEngineTurn(character, result);
      return result;
    });
  }

  // A character the predator has taken keeps its pane, its final turn count and
  // its chat log, and loses everything that would advance it — the engine
  // declines its turns from here on, so offering the controls would promise a
  // turn that never runs.
  function markEaten(character, note) {
    if (eaten[character]) return;
    eaten[character] = true;
    const ticker = tickers[character];
    if (ticker) ticker.pause();
    const w = paneIdFor(character);
    el(w + "-play").disabled = true;
    el(w + "-step").disabled = true;
    el(w + "-chatq").disabled = true;
    el(w + "-chatpills").innerHTML = "";
    appendChat(character, "a", note || ("the " + character + " has been eaten. It takes no more turns."));
    playEatenScene(character);
  }

  // Whichever individual the WORLD marks dangerous, never a species this page
  // hardcodes — the same fact adventure.mjs's own predator check reads.
  function predatorInRows(rows) {
    for (const row of rows) {
      if (row.predicate === "mgx:is-predator" && row.object === "true") return row.subject;
    }
    return null;
  }

  // The pane holds on the den for the length of one pounce before it grays out.
  // Cutting straight to the banner throws away the only moment this demo has to
  // show what took the character: the character's last drawn room is the one it
  // walked out OF, so the scene is redrawn against the den first, then the fox
  // crosses it. Reduced motion, or a world with no marked predator, settles
  // straight into the end state.
  function playEatenScene(character) {
    const w = paneIdFor(character);
    const settle = function () {
      el(w).classList.add("out-of-play");
      const fate = el(w + "-fate");
      fate.hidden = false;
      fate.textContent = "eaten \\u00b7 " + turnsFor(character) + " turns";
    };
    const predator = lastSnapshot ? predatorInRows(lastSnapshot.rows) : null;
    const den = predator ? (lastSnapshot.state.placements.get(predator) || {}).object : null;
    if (reduceMotion || !den) { settle(); return; }

    const rows = lastSnapshot.rows;
    const state = lastSnapshot.state;
    renderRoomView(character, rows, state, den, allRoomIds(rows),
      window.tmctMud.castInRoom(rows, state, den, character));

    const room = el(w + "-room");
    const lunger = room.querySelector('.floor-others .sprite-card[data-subject="' + predator + '"]');
    const prey = el(w + "-self");
    if (!lunger || !prey) { settle(); return; }
    const gap = prey.getBoundingClientRect().left - lunger.getBoundingClientRect().left;
    lunger.style.setProperty("--pounce-x", Math.max(0, Math.round(gap) - 8) + "px");
    room.classList.add("pounce");
    lunger.classList.add("lunging");
    setTimeout(settle, 1000);
  }

  // A bubble carries what was SAID, not the sentence: the answer names a
  // thing, and the thing's own display label is only resolvable against the
  // fact rows a redraw has and a finished turn does not.
  function noteSpeech(room, speaker, bubble) {
    if (!speechBubbles.has(room)) speechBubbles.set(room, []);
    speechBubbles.get(room).push(Object.assign({ speaker: speaker, expiresAtTurn: globalTurn + 2 }, bubble));
  }

  function afterEngineTurn(character, result) {
    if (result && result.outOfPlay) { markEaten(character, result.text); renderAll(); return; }
    if (!result || !result.room) { renderAll(); return; }
    if (result.roomAfter && result.roomAfter !== result.room) freshlyDugRoom = result.roomAfter;
    for (const action of result.actions || []) {
      if (action.kind !== "ask" && action.kind !== "talk") continue;
      const other = action.teller || action.target || action.object;
      noteSpeech(result.room, character, { text: "what food do you know about?" });
      if (other && action.thing) noteSpeech(result.room, other, { thing: action.thing });
      else if (other && action.text) noteSpeech(result.room, other, { text: action.text });
    }
    renderAll();
  }

  function ensureTicker(character) {
    if (tickers[character]) return tickers[character];
    const playBtn = el(paneIdFor(character) + "-play");
    tickers[character] = createTicker({
      onTick: function () { return runOneTurn(character); },
      onRender: function (state) {
        playBtn.textContent = state.playing ? "\\u23F8 pause" : "\\u25B6 play";
      },
      hasNext: hasNext,
      wait: liveWait,
    });
    return tickers[character];
  }

  // ---- chat docks ---------------------------------------------------------
  // The line's own text is never shortened, only its rendered height — the whole
  // thing stays readable through the popup, and stays in the DOM for anything
  // reading the log.
  function appendChat(character, cls, text) {
    const log = el(paneIdFor(character) + "-chatlog");
    const d = document.createElement("div");
    d.className = cls;
    d.textContent = text;
    log.appendChild(d);
    // A line-clamped box reports scrollHeight EQUAL to its clamped height, so
    // the overflow has to be read against the same box with the clamp lifted.
    d.classList.add("unclamped");
    const wholeHeight = d.scrollHeight;
    d.classList.remove("unclamped");
    if (wholeHeight - d.clientHeight > 2) {
      d.classList.add("clipped");
      d.setAttribute("role", "button");
      d.setAttribute("tabindex", "0");
      d.setAttribute("title", "read the whole line");
    }
    log.scrollTop = log.scrollHeight;
  }

  function openLogPopup(slot, text) {
    const w = "window-" + slot;
    el(w + "-logpop-text").textContent = text;
    el(w + "-logpop").hidden = false;
  }

  function closeLogPopup(slot) {
    el("window-" + slot + "-logpop").hidden = true;
  }

  function sendCommand(character, line) {
    appendChat(character, "u", line);
    return serializeTick(function () { return session.windows[character].turn(line); }).then(function (res) {
      appendChat(character, "a", res.answer);
      renderAll();
      return res;
    });
  }

  // Wired ONCE per pane, never per boot: the pane outlives every reset, and
  // each handler asks which character is cast in this pane at click time, so
  // a re-cast pane drives its new animal with no re-binding.
  function wirePane(slot) {
    const w = "window-" + slot;
    const input = el(w + "-chatq");
    el(w + "-chatform").addEventListener("submit", function (e) {
      e.preventDefault();
      const character = characterInSlot(slot);
      const line = input.value.trim();
      if (!character || !line) return;
      input.value = "";
      sendCommand(character, line);
    });
    el(w + "-play").addEventListener("click", function () {
      const character = characterInSlot(slot);
      if (!character) return;
      const ticker = ensureTicker(character);
      if (ticker.getState().playing) ticker.pause(); else ticker.play();
    });
    el(w + "-step").addEventListener("click", function () {
      const character = characterInSlot(slot);
      if (character) ensureTicker(character).stepOnce();
    });

    const log = el(w + "-chatlog");
    log.addEventListener("click", function (e) {
      const line = e.target.closest(".clipped");
      if (line) openLogPopup(slot, line.textContent);
    });
    log.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      const line = e.target.closest(".clipped");
      if (!line) return;
      e.preventDefault();
      openLogPopup(slot, line.textContent);
    });
    el(w + "-logpop-close").addEventListener("click", function () { closeLogPopup(slot); });
    el(w).addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeLogPopup(slot);
    });

    // Clicking a drawn thing runs the same grounded command its pill would, so
    // the room view is a second way into one action set rather than its own.
    // A sprite the room grants no action on carries no command and does nothing.
    el(w + "-room").addEventListener("click", function (e) {
      const card = e.target.closest(".sprite-card[data-command]");
      const character = characterInSlot(slot);
      if (!card || !character || eaten[character]) return;
      sendCommand(character, card.getAttribute("data-command"));
    });
    el(w + "-room").addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      const card = e.target.closest(".sprite-card[data-command]");
      const character = characterInSlot(slot);
      if (!card || !character || eaten[character]) return;
      e.preventDefault();
      sendCommand(character, card.getAttribute("data-command"));
    });
  }

  function characterInSlot(slot) {
    return cast[slots.indexOf(slot)] || null;
  }

  // ---- room-view rendering -------------------------------------------------
  function hashOf(text) {
    let h = 0;
    for (let i = 0; i < String(text).length; i += 1) h = (h * 31 + String(text).charCodeAt(i)) % 100000;
    return h;
  }

  function spriteSvgFor(species, rows, instanceKey) {
    if (window.tmctMud && window.tmctMud.resolveSpriteAsset) {
      return window.tmctMud.resolveSpriteAsset(species, rows, [], DATA.spriteTemplates, window.tmctMud.SPRITE_REGISTRY, { instanceKey: instanceKey });
    }
    return "";
  }

  // A wall-hung object resolves through the SAME property-aware, large-tier
  // resolver the characters do, keyed on the object's OWN name (via
  // spriteAncestryRows' synthetic subClassOf edge to its declared class), so
  // a carrot draws a carrot and only a class with no template anywhere falls
  // back. The fallback root is "portable", not the resolver's default
  // "animal": everything hung on this wall is a thing, and a thing with no
  // sprite should read as a plain parcel rather than a creature.
  function objectSvgFor(subject, rows) {
    if (window.tmctMud && window.tmctMud.resolveSpriteAsset) {
      return window.tmctMud.resolveSpriteAsset(
        subject, spriteAncestryRows(rows, subject), factsForSubject(rows, subject),
        DATA.spriteTemplates, window.tmctMud.SPRITE_REGISTRY,
        { rootFallback: "portable", instanceKey: subject },
      );
    }
    return "";
  }

  // The backdrop is a drawing of what the digest already says about the room:
  // turf and sky above ground, packed strata and pebbles below it. Every
  // stroke is placed off a hash of the room's own id, so a room looks the
  // same every redraw and two rooms never look alike.
  function drawRoomBackdrop(canvas, kind, room) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    if (kind === "outdoor") {
      grad.addColorStop(0, "#A9BE83"); grad.addColorStop(0.42, "#7E9159"); grad.addColorStop(1, "#5C6B41");
    } else {
      grad.addColorStop(0, "#63482F"); grad.addColorStop(0.55, "#42301F"); grad.addColorStop(1, "#241710");
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const seed = hashOf(room);
    ctx.save();
    if (kind === "outdoor") {
      ctx.strokeStyle = "rgba(45,62,30,.5)";
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 26; i += 1) {
        const x = ((seed * (i + 3)) % w);
        const base = h - 6 - ((seed >> (i % 5)) % 8);
        ctx.beginPath();
        ctx.moveTo(x, base);
        ctx.lineTo(x + (i % 2 ? 3 : -3), base - 9 - (i % 4) * 2);
        ctx.stroke();
      }
    } else {
      ctx.strokeStyle = "rgba(0,0,0,.22)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i += 1) {
        const y = (h / 4) * i + ((seed >> i) % 6) - 3;
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= w; x += 30) ctx.lineTo(x, y + (((seed + x) % 7) - 3));
        ctx.stroke();
      }
      ctx.fillStyle = "rgba(255,255,255,.07)";
      for (let i = 0; i < 14; i += 1) {
        const x = ((seed * (i + 7)) % w);
        const y = ((seed * (i + 2)) % h);
        ctx.beginPath();
        ctx.arc(x, y, 1 + (i % 3), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
    const floor = ctx.createLinearGradient(0, h - 26, 0, h);
    floor.addColorStop(0, "rgba(0,0,0,0)");
    floor.addColorStop(1, "rgba(0,0,0,.35)");
    ctx.fillStyle = floor;
    ctx.fillRect(0, h - 26, w, 26);
  }

  // The world's own hasMass fold, the same one the pouch's stat line reads.
  // Null for anything the world never weighed, which draws no figure at all
  // rather than a guessed one.
  function massOf(state, subject) {
    const mass = state.masses.get(subject);
    return mass ? mass.value : null;
  }

  // A sprite card: adventure.html's own frame-plus-nameplate, carrying the one
  // command this room currently grants on its subject (none, for a thing the
  // room offers nothing on) and the subject's own mass under the name.
  function spriteCardHtml(subject, label, inner, command, extraClass, mass) {
    const action = command
      ? ' actionable" data-command="' + esc(command) + '" role="button" tabindex="0" title="' + esc(command) + '"'
      : '" title="' + esc(label) + '"';
    return '<div class="sprite-card ' + (extraClass || "") + action + ' data-subject="' + esc(subject) + '">'
      + inner + '<div class="sprite-label">' + esc(label) + "</div>"
      + (mass === null || mass === undefined ? "" : '<div class="sprite-mass">mass ' + esc(mass) + "</div>")
      + "</div>";
  }

  function renderRoomView(character, rows, state, here, roomIds, roomMates) {
    const w = paneIdFor(character);
    drawRoomBackdrop(el(w + "-canvas"), roomKindForRoom(rows, here), here);
    const commands = commandsBySubject(affordancesFor(rows, state, here, character));

    el(w + "-self").innerHTML = spriteCardHtml(
      character, character,
      '<div class="sprite">' + spriteSvgFor(speciesOfCharacter(character), rows, character) + "</div>",
      null, "self", massOf(state, character),
    );

    const others = roomMates.map(function (mate) {
      return spriteCardHtml(mate, mate,
        '<div class="sprite">' + spriteSvgFor(speciesOfCharacter(mate), rows, mate) + "</div>",
        commands[mate], "", massOf(state, mate));
    });
    const wall = [];
    for (const obj of mudRoomSceneObjects(rows, state, here, character)) {
      if (isCreature(state, obj.subject)) continue;
      const plane = scenePlacement(rows, state, obj.subject).plane;
      const hang = plane === "ceiling" || plane === "wall" ? "hangs-high" : "hangs-low";
      // The caption is always the THING'S own name, never the class whose
      // sprite ended up drawn — an item wearing an ancestor's icon because
      // its own class has no sprite yet still has to say what it is.
      wall.push(spriteCardHtml(obj.subject, labelForItem(rows, obj.subject, roomIds),
        '<div class="hook"></div><div class="sprite-frame">' + objectSvgFor(obj.subject, rows) + "</div>",
        commands[obj.subject], "wall-item " + hang, massOf(state, obj.subject)));
    }
    el(w + "-others").innerHTML = others.join("");
    el(w + "-wall").innerHTML = wall.join("");

    const live = (speechBubbles.get(here) || []).filter(function (b) { return b.expiresAtTurn >= globalTurn; });
    el(w + "-bubbles").innerHTML = live.map(function (b) {
      const side = b.speaker === character ? "from-self" : "from-other";
      const said = b.thing ? "there's " + labelForItem(rows, b.thing, roomIds) + ", if you can reach it." : b.text;
      return '<div class="bubble ' + side + '">' + esc(said) + "</div>";
    }).join("");

    const flourishEl = el(w + "-flourish");
    if (freshlyDugRoom && freshlyDugRoom === here && !reduceMotion) {
      flourishEl.hidden = false;
      flourishEl.classList.add("shown");
      setTimeout(function () { flourishEl.classList.remove("shown"); flourishEl.hidden = true; }, 900);
    }

    el(w + "-caption").textContent = roomCaptionFor(rows, state, here, character, roomMates);
  }

  // The digest's own room sentences say what the ROOM is, and nothing about who
  // is standing in it — a "Badger-2 is in the sett-1" row is filed under the
  // badger, not the sett, so filtering the view to this room drops every mate.
  // The cast sentence comes from the same list the talk pills and the floor
  // sprites read, so the description can never name a different set of animals
  // than the pane offers to talk to.
  function roomCaptionFor(rows, state, here, character, roomMates) {
    const parts = [];
    const view = window.tmctMud.worldDigestRows(rows, state, character);
    const lines = view.filter(function (r) { return r.subject.toLowerCase() === here.toLowerCase(); })
      .map(function (r) { return r.subject + " " + r.predicate + " " + r.object + "."; });
    parts.push(lines.length ? lines.join(" ") : "You are in the " + here + ".");
    if (roomMates.length) {
      parts.push("Here with you: " + roomMates.map(function (mate) {
        const mass = massOf(state, mate);
        return "the " + mate + (mass === null ? "" : " (mass " + mass + ")");
      }).join(", ") + ".");
    }
    return parts.join(" ");
  }

  // ---- the compass ring ----------------------------------------------------
  // One button per direction, in the slot that direction points at: the "go"
  // a written exit already allows, or the "dig" that would open one. A
  // direction with neither draws nothing, so the ring never offers a command
  // the world would refuse.
  function diggableFor(rows, state, here) {
    const fromEngine = window.tmctMud && window.tmctMud.diggableDirections;
    return fromEngine ? fromEngine(rows, state, here) : diggableDirections(rows, state, here);
  }

  function renderDirections(character, rows, state, here) {
    const w = paneIdFor(character);
    const exits = state.exits.get(here);
    const diggable = diggableFor(rows, state, here);
    for (const direction of COMPASS) {
      const slot = el(w + "-dir-" + direction);
      const open = exits && exits.has(direction);
      const command = open ? "go " + direction : (diggable.indexOf(direction) !== -1 ? "dig " + direction : null);
      if (!command) { slot.innerHTML = ""; continue; }
      const cls = "dir-pill " + (open ? "go" : "dig") + (direction === "up" || direction === "down" ? " vertical" : "");
      slot.innerHTML = '<button type="button" class="' + cls + '" data-command="' + esc(command) + '" title="' + esc(command)
        + '" aria-label="' + esc(command) + '">' + DIR_GLYPH[direction] + "</button>";
      slot.querySelector("button").addEventListener("click", function () { sendCommand(character, command); });
    }
  }

  // ---- the pill row --------------------------------------------------------
  // Every action the room actually grants comes from the engine's own
  // roomAffordances — the SAME list the "You can:" line in a look reply is built
  // from — so nothing the reply above offers can be missing from the row beneath
  // it. Exits appear in both the row and the compass ring on purpose: the ring
  // says WHERE a way out points, the row says what it is called.
  function affordancesFor(rows, state, here, character) {
    const fromEngine = window.tmctMud && window.tmctMud.roomAffordances;
    return fromEngine ? fromEngine(rows, state, here, character) : [];
  }

  function subjectOfAction(action) {
    return action.indexOf("talk to ") === 0 ? action.slice(8) : action.slice(action.indexOf(" ") + 1);
  }

  function commandsBySubject(actions) {
    const bySubject = {};
    for (const action of actions) {
      if (action.indexOf("go ") === 0) continue;
      bySubject[subjectOfAction(action)] = action;
    }
    return bySubject;
  }

  function renderChatPills(character, rows, state, here, roomIds) {
    const w = paneIdFor(character);
    const pillsEl = el(w + "-chatpills");
    const pills = [
      { command: "look", label: "look", cls: "" },
      { command: "what do you know about food", label: "what do you know about food", cls: "" },
    ];
    for (const action of affordancesFor(rows, state, here, character)) {
      if (action.indexOf("go ") === 0) { pills.push({ command: action, label: action, cls: " affordance way" }); continue; }
      const subject = subjectOfAction(action);
      const label = action.slice(0, action.length - subject.length) + labelForItem(rows, subject, roomIds);
      pills.push({ command: action, label: label, cls: " affordance" });
    }
    pillsEl.innerHTML = pills.map(function (p) {
      return '<button type="button" class="pill' + p.cls + '" data-command="' + esc(p.command)
        + '" title="' + esc(p.command) + '">' + esc(p.label) + "</button>";
    }).join("");
    for (const pill of pillsEl.querySelectorAll(".pill")) {
      pill.addEventListener("click", function () {
        sendCommand(character, pill.getAttribute("data-command"));
      });
    }
  }

  function renderPouch(character, rows, state, roomIds) {
    const w = paneIdFor(character);
    const items = carriedItemsFor(rows, state, character);
    el(w + "-pouch-list").innerHTML = items.map(function (i) {
      return '<li title="' + esc(i.subject) + '">' + esc(labelForItem(rows, i.subject, roomIds)) + "</li>";
    }).join("");
    const mass = state.masses.get(character);
    const drain = DATA.mudConfig[speciesOfCharacter(character) + "MassDecrementPerTurn"];
    el(w + "-stats").textContent = "mass " + (mass ? mass.value : "?") + (drain !== undefined ? " \\u00b7 drain/turn " + drain : "");
  }

  // The world mints a dug object with its own display-name fact, so the engine
  // can say "carrot" while every verb still resolves the distinct id
  // ("carrot-1"). itemLabel is the fallback for an id carrying no such fact.
  function labelForItem(rows, subject, roomIds) {
    const fromEngine = window.tmctMud && window.tmctMud.displayNameOf;
    const name = fromEngine ? fromEngine(rows, subject) : null;
    return name && name !== subject ? name : itemLabel(subject, roomIds);
  }

  // ---- the burrow survey ---------------------------------------------------
  // One routine, drawn twice: the omniscient board in the top row (every room
  // the world has) and each pane's own known ground (only what that character
  // has dug or walked, with a fading stub where it knows a way carries on).
  function burrowSvg(graph, options) {
    if (!graph.nodes.length) return "";
    const opts = options || {};
    const compact = !!opts.compact;
    const cellX = compact ? 44 : 76, cellY = compact ? 26 : 54;
    const roomW = compact ? 34 : 62, roomH = compact ? 14 : 26;
    const maxX = Math.max.apply(null, graph.nodes.map(function (n) { return n.x; }));
    const maxY = Math.max.apply(null, graph.nodes.map(function (n) { return n.y; }));
    const w = (maxX + 1) * cellX, h = (maxY + 1) * cellY;
    const byRoom = {};
    for (const n of graph.nodes) byRoom[n.id] = n;
    const cx = function (n) { return (n.x + 0.5) * cellX; };
    const cy = function (n) { return (n.y + 0.5) * cellY; };

    // The turf band is only drawn when the layout genuinely separates the
    // surface from the soil — a lateral dig can push a surface room onto a
    // lower row, and a ground line above it would say something false. The
    // room fills carry the same information either way, which is all the
    // thumbnail-sized copy has room for.
    const surfaceRows = graph.nodes.filter(function (n) { return n.level === 0; }).map(function (n) { return n.y; });
    const soilRows = graph.nodes.filter(function (n) { return n.level !== 0; }).map(function (n) { return n.y; });
    let turf = "";
    if (!compact && surfaceRows.length && soilRows.length && Math.max.apply(null, surfaceRows) < Math.min.apply(null, soilRows)) {
      const groundY = (Math.max.apply(null, surfaceRows) + 0.5) * cellY + roomH / 2 + (compact ? 3 : 7);
      turf = '<rect class="turf" x="0" y="0" width="' + w + '" height="' + groundY + '"></rect>'
        + '<line class="ground-line" x1="0" y1="' + groundY + '" x2="' + w + '" y2="' + groundY + '"></line>';
    }

    const tunnels = graph.edges.map(function (e) {
      const a = byRoom[e.from], b = byRoom[e.to];
      if (!a || !b) return "";
      const shaft = e.direction === "up" || e.direction === "down" ? " shaft" : "";
      return '<line class="tunnel' + shaft + '" x1="' + cx(a) + '" y1="' + cy(a) + '" x2="' + cx(b) + '" y2="' + cy(b) + '"></line>';
    }).join("");

    const HINT_DELTA = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0], up: [0, -1], down: [0, 1] };
    const hints = graph.hints.map(function (hi) {
      const from = byRoom[hi.from];
      if (!from) return "";
      const d = HINT_DELTA[hi.direction] || [0, 0];
      return '<circle class="hint" cx="' + (cx(from) + d[0] * cellX * 0.36) + '" cy="' + (cy(from) + d[1] * cellY * 0.36) + '" r="' + (compact ? 2 : 3.2) + '"></circle>';
    }).join("");

    const occupants = opts.occupants || {};
    const rooms = graph.nodes.map(function (n) {
      const here = opts.here === n.id ? " here" : "";
      const fresh = opts.fresh === n.id ? " freshly-dug" : "";
      const surface = n.level === 0 ? " surface" : "";
      const label = esc(n.id);
      const fit = label.length * (compact ? 3.6 : 4.3) > roomW - 6
        ? ' textLength="' + (roomW - 6) + '" lengthAdjust="spacingAndGlyphs"' : "";
      const cast = occupants[n.id] || [];
      const dots = cast.map(function (c, i) {
        const spread = (i - (cast.length - 1) / 2) * (compact ? 6 : 9);
        return '<circle class="occupant" cx="' + (cx(n) + spread) + '" cy="' + (cy(n) + roomH / 2) + '" r="' + (compact ? 2.4 : 3.6)
          + '" fill="' + c.color + '"><title>' + esc(c.character) + "</title></circle>";
      }).join("");
      return '<g class="room' + surface + here + fresh + '"><rect x="' + (cx(n) - roomW / 2) + '" y="' + (cy(n) - roomH / 2)
        + '" width="' + roomW + '" height="' + roomH + '" rx="3"></rect><text x="' + cx(n) + '" y="' + (cy(n) + (compact ? 2 : 2.5))
        + '"' + fit + ">" + label + "</text>" + dots + "</g>";
    }).join("");

    return '<div class="burrow"><svg viewBox="0 0 ' + w + " " + h + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="'
      + esc(opts.label || "the burrow") + '">' + turf + tunnels + hints + rooms + "</svg></div>";
  }

  function renderMinimap(character, rows, state, here) {
    const visited = session.windows[character].visitedRoomIds();
    const graph = burrowGraph(state, visited, DATA.rootRoom);
    el(paneIdFor(character) + "-minimap").innerHTML = burrowSvg(graph, {
      compact: true, here: here, label: "the ground " + character + " has covered",
    });
  }

  function renderWorldMap(rows, state, roomIds) {
    const graph = burrowGraph(state, roomIds, DATA.rootRoom);
    const occupants = {};
    for (const room of roomIds) {
      const here = charactersInRoom(state, room, cast);
      if (!here.length) continue;
      occupants[room] = here.map(function (c) { return { character: c, color: colorFor(c) }; });
    }
    el("worldMapBoard").innerHTML = burrowSvg(graph, {
      occupants: occupants, fresh: freshlyDugRoom, label: "every room in the burrow, and who stands where",
    });
    el("worldMapKey").innerHTML = cast.map(function (c) {
      const room = state.placements.get(c) ? state.placements.get(c).object : "?";
      const where = eaten[c] ? "eaten" : "in " + esc(room);
      return '<span class="key-actor"><span class="key-dot" style="background:' + colorFor(c) + '"></span>'
        + esc(speciesOfCharacter(c)) + " " + where + "</span>";
    }).join("");
    el("worldMapTurn").textContent = "turn " + globalTurn;
  }

  // A character eaten on its OWN turn is out of play the moment that turn
  // returns, one whole tick before autoplayTick would report it — so the pane's
  // state is read from the engine's own isOutOfPlay every redraw, not only off
  // a tick result.
  async function renderAll() {
    if (!session) return;
    el("globalTurnCount").textContent = "turns: " + globalTurn;
    const snap = await session.snapshot();
    lastSnapshot = snap;
    const roomIds = allRoomIds(snap.rows);
    for (const character of cast) {
      if (await session.windows[character].isOutOfPlay()) markEaten(character);
    }
    renderWorldMap(snap.rows, snap.state, roomIds);
    for (const character of cast) {
      el(paneIdFor(character) + "-turn").textContent = "turn " + turnsFor(character);
      if (eaten[character]) continue;
      const place = snap.state.placements.get(character);
      const here = place ? place.object : null;
      if (!here) continue;
      const roomMates = window.tmctMud.castInRoom(snap.rows, snap.state, here, character);
      renderRoomView(character, snap.rows, snap.state, here, roomIds, roomMates);
      renderDirections(character, snap.rows, snap.state, here);
      renderChatPills(character, snap.rows, snap.state, here, roomIds);
      renderPouch(character, snap.rows, snap.state, roomIds);
      renderMinimap(character, snap.rows, snap.state, here);
    }
    freshlyDugRoom = null;
  }

  // ---- the control deck ----------------------------------------------------
  function wireDeck() {
    const playBtn = el("autoToggle");
    const delaySlider = el("delaySlider");
    const maxTurnsSlider = el("maxTurnsSlider");
    playBtn.addEventListener("click", function () {
      if (!session) return;
      autoOn = !autoOn;
      playBtn.setAttribute("aria-pressed", autoOn ? "true" : "false");
      playBtn.textContent = autoOn ? "\\u23F8 pause" : "\\u25B6 play";
      for (const character of cast) {
        const ticker = tickers[character];
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
    el("resetBtn").addEventListener("click", function () { boot(); });
  }

  function bindPanes() {
    for (let i = 0; i < slots.length; i += 1) {
      const w = "window-" + slots[i];
      const character = cast[i];
      const pane = el(w);
      if (!character) { pane.hidden = true; continue; }
      pane.hidden = false;
      pane.setAttribute("data-character", character);
      pane.setAttribute("aria-label", speciesOfCharacter(character) + "'s own view of the shared world");
      el(w + "-name").innerHTML = esc(speciesOfCharacter(character)) + '<span class="mono char-id">' + esc(character) + "</span>";
      el(w + "-chatq").setAttribute("aria-label", "type a command for " + character);
    }
  }

  // Booting builds the shared world and draws the opening state. It never
  // starts a turn: nothing ticks until the deck's own play control (or a
  // pane's) is clicked.
  async function boot() {
    autoOn = false;
    const playBtn = el("autoToggle");
    playBtn.setAttribute("aria-pressed", "false");
    playBtn.textContent = "\\u25B6 play";
    for (const character of cast) {
      const ticker = tickers[character];
      if (ticker) ticker.pause();
      delete tickers[character];
    }
    globalTurn = 0;
    freshlyDugRoom = null;
    lastSnapshot = null;
    speechBubbles.clear();
    tickChain = Promise.resolve();
    for (const character of cast) delete eaten[character];
    for (const slot of slots) {
      const w = "window-" + slot;
      el(w + "-chatlog").innerHTML = "";
      el(w + "-play").textContent = "\\u25B6 play";
      el(w).classList.remove("out-of-play");
      el(w + "-fate").hidden = true;
      el(w + "-logpop").hidden = true;
      el(w + "-room").classList.remove("pounce");
    }

    // ONE draw, the engine's own, and the same list the session is built from:
    // a second independent draw here would leave the page showing animals the
    // shared world was never opened for.
    cast = window.tmctMud.pickMudRoster(roster, { count: slots.length });
    session = await window.tmctMud.createMudSession(DATA.worldPayload, { characters: cast });
    for (let i = 0; i < cast.length; i += 1) {
      turnsTaken[cast[i]] = 0;
      slotOf[cast[i]] = slots[i];
    }
    bindPanes();
    for (const character of cast) {
      const w = paneIdFor(character);
      el(w + "-play").disabled = false;
      el(w + "-step").disabled = false;
      el(w + "-chatq").disabled = false;
      ensureTicker(character);
    }
    renderAll();
  }

  wireDeck();
  for (const slot of slots) wirePane(slot);
  boot();
})();`;
}
