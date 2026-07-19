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
// adventure-autoplay.mjs's own `roomOfSubject` already has to). Two further
// pure helpers are exported for testing but NOT spliced, because each calls
// an adventure.mjs export the in-page script instead reaches through the
// browser bundle's own `tmctAdventure` global (mirroring how the inline
// script calls `tmctSpiderFly.*` rather than re-importing
// spider-fly-world.mjs): `roomCaptionText` (calls `worldDigestRows`; the
// in-page `captionFor` mirrors it against `tmctAdventure.worldDigestRows`)
// and `pillsForRoom` (the room's clickable command suggestions — a thin
// wrapper over adventure.mjs's own exported `roomAffordances`, whose header
// explains why its list can never promise an action one of take/open/talk/
// examine would then refuse; the in-page `pillsFor` mirrors it against
// `tmctAdventure.roomAffordances`).
//
// The chat dock (chatlog/chatform/chatq/pills, below) mirrors
// spider-fly-viz.mjs's own side panel: every manual exchange (via
// adventure-browser-entry.mjs's new `session.turn(line)`) and every
// auto-play tick's own narration append to the SAME scrolling `#chatlog`, so
// a visitor sees one continuous history rather than a line overwritten every
// tick. `#caption`/`#goalLine` keep their existing job as the current-state
// summary; the chat log is the persistent addition.
import { THEME_TOKENS_CSS, SERIF_STACK, MONO_STACK, escapeHtml, embedJson } from "./viz-theme.mjs";
import { createTicker } from "./viz-ticker.mjs";
import { worldDigestRows, roomAffordances } from "./adventure.mjs";

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

/** `rows` plus one synthetic rdfs:subClassOf edge from `subject`'s own name
 *  to its declared sprite class (spriteClassForObject's own result) — never
 *  written back to the corpus, just handed to sprite-templates.mjs's
 *  resolver so a NAMED object (`cabinet`, `butler`) can carry its own sprite
 *  template while an unauthored object of the same declared class still
 *  falls back through it cleanly. Ashcombe Hall's own objects have no
 *  rdfs:subClassOf chain of their own (each is directly typed, e.g. `cabinet
 *  rdf:type furniture`); this is the exact same ancestor-walk mechanism
 *  spider-fly's real poodle-IsA-dog taxonomy already exercises, just
 *  synthesized at render time for a world whose taxonomy doesn't reach this
 *  deep. A no-op when the subject's own name already IS its declared class
 *  (nothing to synthesize). Pure. */
export function spriteAncestryRows(rows, subject) {
  const declaredClass = spriteClassForObject(rows, subject);
  if (subject === declaredClass) return rows;
  return [...(rows || []), { subject, predicate: "rdfs:subClassOf", object: declaredClass }];
}

/** Every fact row belonging to `subject` — the small `{predicate, object}`
 *  set sprite-templates.mjs's resolver checks a parameterized/match template
 *  against (e.g. an mgx:hasProperty row). Pure. */
export function factsForSubject(rows, subject) {
  return (rows || []).filter((r) => r.subject === subject);
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

/** The clickable command suggestions for the room the player is CURRENTLY
 *  in — a thin, testable wrapper over adventure.mjs's own `roomAffordances`
 *  (the exact same data take/open/talk/examine already check), so a pill can
 *  never promise an action one of those verbs would then refuse. Each
 *  returned string ("go north", "take lamp", "unlock cabinet", ...) is
 *  already a complete, submittable command in this world's own imperative
 *  grammar — the page inserts one into the chat input verbatim on click,
 *  never reformats it. Pure; recomputed fresh on every redraw, so a pill for
 *  a room the player has left, or an object already taken, never lingers. */
export function pillsForRoom(rows, state, here) {
  return roomAffordances(rows, state, here);
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
 *  every other viz page in this project holds. `spriteTemplates` is the
 *  build step's own read of data/sprites/*.toml (sprite-template-files.mjs's
 *  readSpriteTemplateFiles), embedded as page data the same way the world
 *  payload is — the browser cannot read the filesystem, so the parsed
 *  templates travel as JSON rather than as a bundled fs read. Defaults to
 *  `[]` (every sprite falls back to the flat SPRITE_REGISTRY, unchanged from
 *  before this module existed) so existing callers that don't pass one keep
 *  working. `?preview=1` switches into the small, auto-playing, non-
 *  interactive mode the home page's hero iframe embeds, matching
 *  spider-fly.html's own dual-purpose file. */
export function renderAdventureHtml({
  title = DEFAULT_TITLE,
  worldPayload = { facts: [], rules: [], opening: "" },
  spriteTemplates = [],
} = {}) {
  const pageData = embedJson({
    world: worldPayload,
    previewMaxTicks: PREVIEW_MAX_TICKS,
    tickWaitMs: TICK_WAIT_MS,
    spriteTemplates,
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
  .stage { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 1rem; align-items: start; }
  @media (max-width: 760px) { .stage { grid-template-columns: 1fr; } }
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
  .side { display: flex; flex-direction: column; gap: .8rem; min-width: 0; }
  .chat { background: var(--card); border: 1px solid var(--line); padding: .6rem .75rem; }
  .chat h2 { font-family: ${MONO_STACK}; font-size: .66rem; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 400; margin: 0 0 .5rem; }
  .chatlog { display: flex; flex-direction: column; gap: .4rem; max-height: 320px; overflow-y: auto; margin-bottom: .5rem; }
  .chatlog .u { font-family: ${MONO_STACK}; font-size: .74rem; color: var(--muted); }
  .chatlog .u::before { content: "tmct> "; color: var(--taught); }
  .chatlog .a { font-size: .88rem; line-height: 1.4; white-space: pre-wrap; }
  .chatlog .t { font-family: ${MONO_STACK}; font-size: .74rem; color: var(--muted); font-style: italic; }
  .chatlog .t::before { content: "\\2022 "; }
  .pills { display: flex; flex-wrap: wrap; gap: .35rem; margin-bottom: .5rem; }
  .pills:empty { display: none; margin-bottom: 0; }
  .pill { font-family: ${MONO_STACK}; font-size: .72rem; padding: .25rem .6rem; border: 1px solid var(--line); background: var(--bg); color: var(--ink); border-radius: 999px; }
  .pill:hover { border-color: var(--taught); }
  .chatask { display: flex; align-items: center; gap: .5rem; border-top: 1px solid var(--line); padding-top: .5rem; }
  .chatask .prompt { color: var(--taught); font-size: .78rem; font-family: ${MONO_STACK}; }
  .chatask input { flex: 1; font-family: ${MONO_STACK}; font-size: .78rem; background: var(--bg); color: var(--ink); border: 1px solid var(--line); padding: .32rem .55rem; min-width: 0; }
  .chatask input:disabled { opacity: .5; }
  .controls-row { display: flex; align-items: center; gap: .6rem; margin-top: 1rem; flex-wrap: wrap; }
  .controls-row button { font-family: ${MONO_STACK}; font-size: .78rem; padding: .3rem .7rem; border: 1px solid var(--line); background: var(--card); color: var(--ink); }
  .controls-row button:hover:not(:disabled) { border-color: var(--taught); }
  .controls-row button:disabled { opacity: .4; cursor: default; }
  .controls-row .turn { margin-left: auto; font-family: ${MONO_STACK}; font-size: .78rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .goal-line { font-family: ${MONO_STACK}; font-size: .78rem; color: var(--muted); margin-top: .5rem; }
  .status { font-family: ${MONO_STACK}; font-size: .74rem; color: var(--muted); margin-top: .3rem; }
  body.preview .side, body.preview .controls-row, body.preview .status { display: none; }
  body.preview main { padding: 0; max-width: none; }
  body.preview .stage { display: block; }
  body.preview .eyebrow, body.preview h1 { display: none; }
</style>
</head>
<body>
<main>
  <div class="eyebrow">tmct &middot; the adventure</div>
  <h1>A room, drawn from exactly what the text already says is there</h1>
  <div class="stage">
    <div class="room-frame" id="roomFrame">
      <div class="sprite-row" id="spriteRow"></div>
    </div>
    <aside class="side" aria-label="The adventure's log and chat">
      <div class="chat">
        <h2>what's happened, and what you can do</h2>
        <div class="chatlog" id="chatlog" aria-live="polite"></div>
        <div class="pills" id="pills"></div>
        <form class="chatask" id="chatform">
          <span class="prompt mono">tmct&gt;</span>
          <input id="chatq" type="text" placeholder="go north" aria-label="Type a command, or ask a question" disabled>
        </form>
      </div>
    </aside>
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
  const spriteAncestryRows = ${spriteAncestryRows.toString()};
  const factsForSubject = ${factsForSubject.toString()};
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
  const chatlogEl = el("chatlog");
  const pillsEl = el("pills");
  const chatformEl = el("chatform");
  const chatqEl = el("chatq");

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

  // ---- chat/event log — every manual exchange AND every auto-play tick's
  // own narration append here, in order, so it reads as one continuous
  // history rather than a line overwritten every tick.
  function addChatLine(cls, html) {
    const d = document.createElement("div");
    d.className = cls; d.innerHTML = html;
    chatlogEl.appendChild(d); chatlogEl.scrollTop = chatlogEl.scrollHeight;
  }

  // ---- contextual pills — refreshed every redraw from the CURRENT room's
  // own roomAffordances-derived list (mirroring pillsForRoom against
  // tmctAdventure.roomAffordances, the same way captionFor above mirrors
  // roomCaptionText against tmctAdventure.worldDigestRows), so a pill for a
  // room the player has left, or an object already taken, never lingers.
  // Clicking one inserts its exact command text into the input and focuses
  // it; it never auto-submits, so free typing still works and a clicked
  // suggestion can still be edited first.
  function pillsFor(rows, state, here) {
    return tmctAdventure.roomAffordances(rows, state, here);
  }
  function renderPills(rows, state, here) {
    const actions = pillsFor(rows, state, here);
    pillsEl.innerHTML = actions.map((a) => '<button type="button" class="pill">' + esc(a) + "</button>").join("");
  }
  pillsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill");
    if (!btn || !chatqEl) return;
    chatqEl.value = btn.textContent;
    chatqEl.focus();
  });

  // ---- sprite resolution — property/instance-aware (sprite-templates.mjs's
  // resolveSpriteAsset), keyed on the OBJECT'S OWN NAME (via
  // spriteAncestryRows' synthetic subClassOf edge to its declared class) so
  // a named object (cabinet, butler) can carry its own data/sprites/*.toml
  // template while the data-cls attribute still reflects the DECLARED class
  // (container/furniture/portable/person/room) — the CSS accent-color rules
  // stay keyed on that declared class unchanged. The player's own "you" row
  // has no backing fact row, so it resolves directly by its fixed
  // "adventurer" class with no ancestry/property rows to check.
  function resolveObjectSprite(rows, s) {
    if (s.subject === "you") return tmctAdventure.resolveSpriteAsset("adventurer", [], [], ADVENTURE.spriteTemplates, tmctAdventure.SPRITE_REGISTRY);
    return tmctAdventure.resolveSpriteAsset(
      s.subject, spriteAncestryRows(rows, s.subject), factsForSubject(rows, s.subject),
      ADVENTURE.spriteTemplates, tmctAdventure.SPRITE_REGISTRY,
    );
  }

  function redraw(snap) {
    const objects = roomSceneObjects(snap.rows, snap.state, snap.here);
    const sprites = [{ subject: "you", spriteClass: "adventurer" }, ...objects];
    spriteRow.innerHTML = sprites.map((s) => {
      const svg = resolveObjectSprite(snap.rows, s);
      return '<div><div class="sprite" data-cls="' + esc(s.spriteClass) + '">' + svg + '</div>'
        + '<div class="sprite-label">' + esc(s.subject) + "</div></div>";
    }).join("");
    captionEl.textContent = captionFor(snap.rows, snap.state, snap.here);
    turnLabelEl.textContent = "turn: " + snap.turn;
    renderPills(snap.rows, snap.state, snap.here);
  }

  // ---- serialize every engine-touching call: the ticker and the chat dock
  // share one in-memory store, and an overlapping tick()/turn() pair could
  // race against the same @turnN write.
  let lock = Promise.resolve();
  function withLock(fn) {
    const run = lock.then(fn, fn);
    lock = run.catch(() => {});
    return run;
  }

  chatformEl.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = chatqEl.value.trim();
    if (!q || !session) return;
    chatqEl.value = "";
    // A manual command lands mid-tick otherwise — pause first, and stay
    // paused until the visitor presses play again.
    ticker.pause();
    addChatLine("u", esc(q));
    withLock(async () => {
      const result = await session.turn(q);
      addChatLine("a", esc(result.answer).replace(/\\n/g, "<br>"));
      const snap = await session.snapshot();
      redraw(snap);
    });
  });

  async function boot() {
    session = await tmctAdventure.createAdventureSession(ADVENTURE.world);
    lastTicks = 0;
    const snap = await session.snapshot();
    redraw(snap);
    goalLineEl.textContent = "";
    chatlogEl.innerHTML = "";
    statusEl.textContent = ADVENTURE.world.opening || "";
    addChatLine("t", esc(ADVENTURE.world.opening || "the adventure begins."));
    chatqEl.disabled = false;
    resetBtn.disabled = false; playBtn.disabled = false; stepBtn.disabled = false;
  }

  const ticker = createTicker({
    onTick: () => withLock(async () => {
      const result = await session.autoplayTick();
      lastTicks += 1;
      const snap = await session.snapshot();
      redraw(snap);
      goalLineEl.textContent = result.goal || "";
      addChatLine("t", esc(result.goal || ""));
      if (result.done || result.stalled) ticker.pause();
    }),
    onRender: (state) => {
      playBtn.textContent = state.playing ? "\\u23f8 pause" : "\\u25b6 play";
      playBtn.disabled = state.animating;
      stepBtn.disabled = state.animating || state.playing;
      resetBtn.disabled = state.animating;
    },
    onReset: () => withLock(boot),
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
