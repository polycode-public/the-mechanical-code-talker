// adventure-viz.mjs — the adventure's own full-screen/home-page hero
// (PLAN_GAMES_UPLIFT_V2.md Part B), styled directly after
// spider-fly-viz.mjs's own self-contained page-builder: one inlined <style>
// importing viz-theme.mjs's shared tokens, behaviour as an inlined IIFE, the
// shared `createTicker` primitive spliced in via `.toString()` exactly the
// way that page splices its own render-glue helpers.
//
// Where this page's data-loading DIVERGES from spider-fly's, on purpose:
// spider-fly-world.mjs is itself a plain, dependency-free JS module (no I/O),
// so its browser entry can call it directly to bootstrap a board. Ashcombe
// Hall's canonical definition is a JSONL corpus source
// (corpus/worlds/src/ashcombe-hall.jsonl), read through a Node fs/gzip
// provider the browser cannot run. Rather than hand-duplicating the world as
// a second, hardcoded JS copy (exactly the kind of drift this project's
// worlds-pack build step exists to prevent), the real facts+rules are read
// ONCE at build time (scripts/build-demo-site.mjs, the same Node path
// test/services/adventure.test.mjs's own loadShippedWorldInto uses) and
// embedded into this page as plain JSON — the same posture ledger.html
// already takes with its own precomputed memory payload, just applied to a
// second kind of build-time data.
//
// Two pure, `.toString()`-splice-safe pieces are exported as real functions
// (not raw inline-script text) so they can be pinned directly by tests, the
// same discipline spider-fly-viz.mjs holds classOfAgentId/
// threadCellsForSpiderPlan to: `spriteClassForObject` (an object's sprite
// class, from its own rdf:type or mgx:is-container fact — NOT from
// adventure.mjs's private isContainer/isTyped, which this module cannot
// import without duplicating adventure.mjs's own closed vocabulary reading)
// and `roomSceneObjects` (every subject actually visible in a room, mirrored
// from adventure.mjs's private `visibleRoomOf` the same way
// adventure-autoplay.mjs's own `roomOfSubject` already has to). `roomCaptionText`
// is a third pure helper, exported for testing, but NOT spliced — it calls
// `worldDigestRows` via a real ES import, since Node/test callers have one,
// while the in-page script instead calls the browser bundle's own exposed
// copy (mirroring how the inline script calls `tmctSpiderFly.*` rather than
// re-importing spider-fly-world.mjs).
import { THEME_TOKENS_CSS, SERIF_STACK, MONO_STACK, escapeHtml, embedJson } from "./viz-theme.mjs";
import { createTicker } from "./viz-ticker.mjs";
import { worldDigestRows } from "./adventure.mjs";

const DEFAULT_TITLE = "tmct — the adventure";
const PREVIEW_MAX_TICKS = 30;
const TICK_WAIT_MS = 900;

/** An object's sprite class: `container` when it carries mgx:is-container
 *  (a distinct icon from plain furniture, since Ashcombe's own cabinet and
 *  portrait are typed "furniture" but read more clearly as a container on
 *  screen), else its own rdf:type object, else the generic "portable"
 *  fallback for anything a world places with no type fact at all. Pure,
 *  self-contained — no reference to adventure.mjs's own private isContainer/
 *  isTyped, since those aren't exported. */
export function spriteClassForObject(rows, subject) {
  const isContainer = (rows || []).some(
    (r) => r.subject === subject && r.predicate === "mgx:is-container" && r.object === "true",
  );
  if (isContainer) return "container";
  const typeRow = (rows || []).find((r) => r.subject === subject && r.predicate === "rdf:type");
  return typeRow ? typeRow.object : "portable";
}

/** Every subject actually visible in `here`, sorted, each with its sprite
 *  class — mirroring adventure.mjs's own private `visibleRoomOf` walk (one
 *  containment hop through an OPEN container) so this can never draw a
 *  hidden or carried object the text digest wouldn't also mention. `player`
 *  is excluded; the caller draws the player's own adventurer sprite
 *  separately. Pure. */
export function roomSceneObjects(rows, state, here) {
  const isTypedRoom = (subject) =>
    (rows || []).some((r) => r.subject === subject && r.predicate === "rdf:type" && r.object === "room");
  const visibleRoomOf = (subject) => {
    const place = state.placements.get(subject);
    if (!place || place.predicate === "mgx:hidden-in") return null;
    if (place.predicate === "mgx:currently-in" || isTypedRoom(place.object)) return place.object;
    const holder = place.object;
    if (holder === "player") return null;
    if (!state.openness.get(holder)?.open) return null;
    const holderPlace = state.placements.get(holder);
    return holderPlace && holderPlace.predicate !== "mgx:hidden-in" ? holderPlace.object : null;
  };
  const out = [];
  for (const subject of [...state.placements.keys()].sort()) {
    if (subject === "player") continue;
    if (visibleRoomOf(subject) !== here) continue;
    out.push({ subject, spriteClass: spriteClassForObject(rows, subject) });
  }
  return out;
}

/** A short caption for `here`, built ONLY from the rows worldDigestRows
 *  itself already produces (the exact same view the chat reply's own digest
 *  reads) — every row already reads as a plain sentence
 *  (`${subject} ${predicate} ${object}.`), so this never invents a phrase
 *  the text digest doesn't already carry. Filters to rows about the room
 *  itself (its own exits) or about something placed IN it — the same
 *  "visible here" boundary `roomSceneObjects` draws from. The player's own
 *  "is in the" row is excluded: the room frame already IS the current room,
 *  so restating "you are here" is redundant, never informative. */
export function roomCaptionText(rows, state, here) {
  const hereCased = here.charAt(0).toUpperCase() + here.slice(1);
  const lines = worldDigestRows(rows, state)
    .filter((row) => row.subject !== "Player" && (row.object === here || row.subject === hereCased))
    .map((row) => `${row.subject} ${row.predicate} ${row.object}.`);
  return lines.length ? lines.join(" ") : `Nothing more about the ${here} is written down yet.`;
}

/** The self-contained adventure page. Pure given `worldPayload` (the build
 *  step's own read of the real Ashcombe Hall world — `{ facts, rules,
 *  opening }`), the same "byte-identical for identical input" invariant
 *  every other viz page in this project holds. `?preview=1` switches into
 *  the small, auto-playing, non-interactive mode the home page's hero iframe
 *  embeds, matching spider-fly.html's own dual-purpose file. */
export function renderAdventureHtml({ title = DEFAULT_TITLE, worldPayload = { facts: [], rules: [], opening: "" } } = {}) {
  const pageData = embedJson({
    world: worldPayload,
    previewMaxTicks: PREVIEW_MAX_TICKS,
    tickWaitMs: TICK_WAIT_MS,
  });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${THEME_TOKENS_CSS}
  html { background: var(--bg); }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: ${SERIF_STACK}; font-size: 16px; line-height: 1.5; }
  .mono { font-family: ${MONO_STACK}; }
  main { max-width: 860px; margin: 0 auto; padding: 1.4rem 1.2rem 2.2rem; }
  .eyebrow { font-family: ${MONO_STACK}; font-size: .7rem; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  h1 { font-size: 1.4rem; margin: .3rem 0 .9rem; text-wrap: balance; }
  button { font: inherit; color: inherit; background: none; cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  .room-frame { position: relative; min-height: 210px; background: var(--taught-soft); border: 1px solid var(--line); padding: 1rem; display: flex; flex-direction: column; gap: .8rem; justify-content: flex-end; }
  .sprite-row { display: flex; flex-wrap: wrap; gap: .6rem; align-items: flex-end; }
  .sprite { width: 44px; height: 44px; }
  .sprite svg { width: 100%; height: 100%; display: block; }
  .sprite[data-cls="adventurer"] { color: var(--taught); }
  .sprite[data-cls="person"] { color: var(--corpus); }
  .sprite[data-cls="container"], .sprite[data-cls="furniture"] { color: var(--entail); }
  .sprite[data-cls="portable"] { color: var(--alert); }
  .sprite[data-cls="room"] { color: var(--muted); }
  .sprite-label { font-family: ${MONO_STACK}; font-size: .62rem; text-align: center; color: var(--muted); margin-top: .15rem; }
  .caption { background: var(--card); border: 1px solid var(--line); padding: .6rem .75rem; font-size: .9rem; }
  .controls-row { display: flex; align-items: center; gap: .6rem; margin-top: 1rem; flex-wrap: wrap; }
  .controls-row button { font-family: ${MONO_STACK}; font-size: .78rem; padding: .3rem .7rem; border: 1px solid var(--line); background: var(--card); color: var(--ink); }
  .controls-row button:hover:not(:disabled) { border-color: var(--taught); }
  .controls-row button:disabled { opacity: .4; cursor: default; }
  .controls-row .turn { margin-left: auto; font-family: ${MONO_STACK}; font-size: .78rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .goal-line { font-family: ${MONO_STACK}; font-size: .78rem; color: var(--muted); margin-top: .5rem; }
  .status { font-family: ${MONO_STACK}; font-size: .74rem; color: var(--muted); margin-top: .3rem; }
  body.preview .controls-row, body.preview .status { display: none; }
  body.preview main { padding: 0; max-width: none; }
  body.preview .eyebrow, body.preview h1 { display: none; }
</style>
</head>
<body>
<main>
  <div class="eyebrow">tmct &middot; the adventure</div>
  <h1>A room, drawn from exactly what the text already says is there</h1>
  <div class="room-frame" id="roomFrame">
    <div class="sprite-row" id="spriteRow"></div>
  </div>
  <div class="caption" id="caption"></div>
  <div class="goal-line" id="goalLine"></div>
  <div class="controls-row">
    <button id="resetBtn" type="button" disabled>reset</button>
    <button id="playBtn" type="button" disabled>&#9654; play</button>
    <button id="stepBtn" type="button" disabled>step</button>
    <span class="turn mono" id="turnLabel">turn: 0</span>
  </div>
  <div class="status" id="status">loading the engine&hellip;</div>
</main>
<script>
const ADVENTURE = ${pageData};
</script>
<script src="./adventure-browser.bundle.js"></script>
<script>
(function () {
  "use strict";
  const createTicker = ${createTicker.toString()};
  const spriteClassForObject = ${spriteClassForObject.toString()};
  const roomSceneObjects = ${roomSceneObjects.toString()};
  const esc = ${escapeHtml.toString()};
  const el = (id) => document.getElementById(id);
  const spriteRow = el("spriteRow");
  const captionEl = el("caption");
  const goalLineEl = el("goalLine");
  const statusEl = el("status");
  const turnLabelEl = el("turnLabel");
  const resetBtn = el("resetBtn");
  const playBtn = el("playBtn");
  const stepBtn = el("stepBtn");

  const params = new URLSearchParams(location.search);
  const preview = params.get("preview") === "1";
  document.body.classList.toggle("preview", preview);

  let session = null;
  let lastTicks = 0;

  function captionFor(rows, state, here) {
    const hereCased = here.charAt(0).toUpperCase() + here.slice(1);
    const lines = tmctAdventure.worldDigestRows(rows, state)
      .filter((row) => row.subject !== "Player" && (row.object === here || row.subject === hereCased))
      .map((row) => row.subject + " " + row.predicate + " " + row.object + ".");
    return lines.length ? lines.join(" ") : "Nothing more about the " + here + " is written down yet.";
  }

  function redraw(snap) {
    const objects = roomSceneObjects(snap.rows, snap.state, snap.here);
    const sprites = [{ subject: "you", spriteClass: "adventurer" }, ...objects];
    spriteRow.innerHTML = sprites.map((s) => {
      const svg = tmctAdventure.resolveSpriteForClass(s.spriteClass, [], tmctAdventure.SPRITE_REGISTRY);
      return '<div><div class="sprite" data-cls="' + esc(s.spriteClass) + '">' + svg + '</div>'
        + '<div class="sprite-label">' + esc(s.subject) + "</div></div>";
    }).join("");
    captionEl.textContent = captionFor(snap.rows, snap.state, snap.here);
    turnLabelEl.textContent = "turn: " + snap.turn;
  }

  async function boot() {
    session = await tmctAdventure.createAdventureSession(ADVENTURE.world);
    lastTicks = 0;
    const snap = await session.snapshot();
    redraw(snap);
    goalLineEl.textContent = "";
    statusEl.textContent = ADVENTURE.world.opening || "";
    resetBtn.disabled = false; playBtn.disabled = false; stepBtn.disabled = false;
  }

  const ticker = createTicker({
    onTick: async () => {
      const result = await session.autoplayTick();
      lastTicks += 1;
      const snap = await session.snapshot();
      redraw(snap);
      goalLineEl.textContent = result.goal || "";
      if (result.done || result.stalled) ticker.pause();
    },
    onRender: (state) => {
      playBtn.textContent = state.playing ? "\\u23f8 pause" : "\\u25b6 play";
      playBtn.disabled = state.animating;
      stepBtn.disabled = state.animating || state.playing;
      resetBtn.disabled = state.animating;
    },
    onReset: () => boot(),
    hasNext: () => !preview || lastTicks < ADVENTURE.previewMaxTicks,
    waitMs: ADVENTURE.tickWaitMs,
  });
  playBtn.addEventListener("click", () => ticker.play());
  stepBtn.addEventListener("click", () => ticker.stepOnce());
  resetBtn.addEventListener("click", () => ticker.reset());

  boot().then(() => { if (preview) ticker.play(); });
})();
</script>
</body>
</html>
`;
}
