// spider-fly-viz.mjs — the spider-and-fly full-screen page (PLAN_SPIDER_FLY.md
// §8/§9/§11): a self-contained document shaped exactly like ledger-viz.mjs/
// plan-viz.mjs — one inlined <style> (importing viz-theme.mjs's shared
// tokens), behaviour as an inlined IIFE — but unlike those two, almost
// nothing is embedded as build-time data: the whole game is LIVE client-side
// state (spider-fly-browser-entry.mjs's createSpiderFlySession), so
// renderSpiderFlyHtml only needs the page's own static grid geometry (which
// never changes) plus a title. The engine, sprite resolver and chat turn
// engine all arrive via ./spider-fly-browser.bundle.js, referenced with a
// plain same-origin <script src> — the same sibling-file arrangement
// index.html already uses for chat-browser.bundle.js (both are the FULL
// turn engine, both generated fresh per build, neither meant to be
// committed), not memory-ask-browser.bundle.js's inlined-text arrangement
// (that bundle is small, committed, and inlined specifically so ledger.html
// stays portable on its own — neither reason applies here).
//
// renderSpiderFlyHtml() is pure: no I/O, deterministic output for identical
// input. scripts/build-demo-site.mjs calls it directly and writes the result
// to public/spider-fly.html, after building the sibling bundle.
//
// Runtime pieces are spliced into the page's own inlined script via
// `.toString()` — exactly ledger-viz.mjs's own `facetCounts`/
// `resolveAnsweredTerm` pattern — because they are genuinely UI-only, with no
// reason to live inside the engine bundle: `createTicker` (viz-ticker.mjs,
// the shared play/pause/step/reset primitive), `classOfAgentId`,
// `threadCellsForSpiderPlan` (the silk-thread reconstruction), `nextCorpses`
// (the dying-agent bookkeeping behind the dusty-corner corpse pile) and
// `facingDegreesFor` (plan-driven sprite orientation) — all kept as real,
// independently-tested exports rather than raw inline-script text, the same
// discipline ledger-viz.mjs holds its own spliced helpers to. Sprite
// resolution, grid geometry and the chat turn engine all come from the
// bundle's own real ES exports instead, since (unlike ledger-viz, which
// reuses a FIXED shared bundle it can't extend for one page's own needs) this
// page ships its own dedicated bundle and can just export what it needs.
import { THEME_TOKENS_CSS, SERIF_STACK, MONO_STACK, escapeHtml, embedJson } from "./viz-theme.mjs";
import { createTicker } from "./viz-ticker.mjs";
import { GRID_SIZE, WEB_HOME, WEB_RADIUS, isInWebBlock, cellId } from "../domain/spider-fly-world.mjs";
import { FLY_INITIAL_MASS, EGG_LAY_MASS_THRESHOLD } from "./spider-fly.mjs";
import { DEFAULT_GAME_CONFIG } from "../domain/game-config.mjs";

// A larger cell than this page's first cut (44px) — the board now fills
// noticeably more of the stage's own width, closing most of the dead gap a
// fixed-260px side column used to leave next to a small fixed-440px board.
const CELL_PX = 54;
const BOARD_PX = CELL_PX * GRID_SIZE;
const DEFAULT_TITLE = "tmct — the spider and the fly";
const PREVIEW_MAX_TURNS = 40;
const TICK_WAIT_MS = 700;
// How many turns a corpse lingers at the bottom of its own board column
// before the carcass "rots" (stops being drawn at all) — a page-local
// constant, not a game-config knob: purely cosmetic, never read by the
// engine, so a visitor's carrying/hatch mechanics never depend on it.
const CORPSE_LINGER_TURNS = 4;

function webCellIds() {
  const out = [];
  for (let y = 1; y <= GRID_SIZE; y += 1) {
    for (let x = 1; x <= GRID_SIZE; x += 1) {
      if (isInWebBlock(x, y)) out.push(cellId(x, y));
    }
  }
  return out;
}

/** An agent id's class for sprite/HUD purposes — "spider-2" -> "spider",
 *  "fly-10" -> "fly", "egg-1" -> "egg". Self-contained (no outer refs),
 *  `.toString()`-splice safe. */
export function classOfAgentId(id) {
  return String(id).replace(/-\d+$/, "");
}

/**
 * Reconstruct the spider's remaining silk-thread path — the sequence of
 * cell ids from its CURRENT cell (after this tick's one executed step) to
 * wherever `findActionPath` was aiming — from spider-fly.mjs's own
 * `agents[spiderId]` shape ({ cell, plan }), where `plan` is the FULL
 * direction list `findActionPath` returned (the step already taken this
 * tick, `plan[0]`, plus every step still to come). Only a spider with a
 * REAL multi-step plan draws a thread at all: spider-fly.mjs's own
 * `planSpiderPath` only ever returns one when the believed fly cell sits
 * inside the web block (its `isGoal`'s own requirement) — most ticks the
 * spider is greedily closing distance with no such plan, and this
 * correctly returns null then, same as "no proof chain to draw" elsewhere
 * in this project's viz pages.
 *
 * `geometry` is `{ parseCellId, cellId, directionDelta }` — the exact three
 * grid-geometry primitives spider-fly-world.mjs exports, injected rather
 * than imported so this function stays `.toString()`-splice safe (the
 * inlined page calls it with `window.tmctSpiderFly`'s own re-exports of the
 * same three). Returns the ordered cell-id array (length > 1) or null.
 */
export function threadCellsForSpiderPlan(agents, geometry) {
  const { parseCellId, cellId: toCellId, directionDelta } = geometry;
  for (const [id, agent] of Object.entries(agents || {})) {
    if (!/^spider-/.test(id) || !agent.plan || !agent.plan.length) continue;
    const cells = [agent.cell];
    let cur = parseCellId(agent.cell);
    for (const direction of agent.plan.slice(1)) {
      const delta = directionDelta[direction];
      if (!delta || !cur) break;
      cur = { x: cur.x + delta.dx, y: cur.y + delta.dy };
      cells.push(toCellId(cur.x, cur.y));
    }
    if (cells.length > 1) return cells;
  }
  return null;
}

// direction -> rotation degrees, matching this page's sprite art convention
// (both spider.toml and fly.toml draw the head/thorax at the TOP of the
// viewBox, i.e. facing north by default) and spider-fly-world.mjs's own
// DIRECTION_DELTA (north decreases y — up on screen).
const FACING_DEGREES = Object.freeze({ north: 0, east: 90, south: 180, west: 270 });

/** The sprite-facing rotation (degrees) for one agent this tick, driven by
 *  its CURRENT plan's first step (spider-fly.mjs's own `agents[id].plan`),
 *  never its actual next move — the two usually coincide, but re-planning
 *  fresh every tick means they can visibly diverge as a plan gets clobbered
 *  and replaced, which is the intended, honest demonstration of "plans get
 *  clobbered under partial/unreliable knowledge," not a glitch to smooth
 *  over. A held agent (`plan` empty/absent — no direction to face) keeps
 *  `previousDegrees` unchanged rather than snapping back to a default, so
 *  holding still never spins the sprite; a brand-new agent with no prior
 *  facing at all defaults to 0 (the art's own default north/up pose). */
export function facingDegreesFor(plan, previousDegrees) {
  const direction = plan && plan[0];
  if (direction && FACING_DEGREES[direction] !== undefined) return FACING_DEGREES[direction];
  return previousDegrees ?? 0;
}

/**
 * The updated corpse set for one redraw (§A.2.5 — visual-only, entirely
 * client-side; the actual starve/eat removal already happened in the
 * engine). Every id present in `prevAgents` but absent from `agents` died
 * THIS tick — eaten or starved are the only two ways an agent ever leaves
 * the engine's own returned roster — and is added at its last-known cell
 * and class; every corpse already older than `lingerTurns` past its own
 * death turn is dropped first, so the set never grows without bound.
 * Returns a plain `{ [id]: { cls, cell, diedAtTurn } }` map. Pure.
 */
export function nextCorpses(prevCorpses, prevAgents, agents, turn, lingerTurns = CORPSE_LINGER_TURNS) {
  const out = {};
  for (const [id, corpse] of Object.entries(prevCorpses || {})) {
    if (turn - corpse.diedAtTurn <= lingerTurns) out[id] = corpse;
  }
  for (const id of Object.keys(prevAgents || {})) {
    if (agents[id] || out[id]) continue;
    const cell = prevAgents[id]?.cell;
    if (!cell) continue;
    out[id] = { cls: classOfAgentId(id), cell, diedAtTurn: turn };
  }
  return out;
}

/** The self-contained spider-and-fly page. Pure — the same output for the
 *  same `title`/`spriteTemplates` every time; every other piece of state
 *  this page shows is computed live in the browser once the sibling bundle
 *  loads. `spriteTemplates` is the build step's own read of
 *  data/sprites/*.toml (sprite-template-files.mjs), embedded as page data
 *  the same reason adventure-viz.mjs's own worldPayload is — the browser
 *  bundle stays fs-free. Defaults to `[]` (every agent falls back to the
 *  flat SPRITE_REGISTRY, unchanged from before this module existed).
 *  `?preview=1` on the page's own URL switches it into the small, auto-
 *  playing, non-interactive mode the home page's hero iframe embeds (§11) —
 *  one file serves both the hero and the "open full-screen" link, matching
 *  how ledger.html/plan.html are each one file embedded two ways. */
export function renderSpiderFlyHtml({ title = DEFAULT_TITLE, spriteTemplates = [] } = {}) {
  const gridData = embedJson({
    gridSize: GRID_SIZE,
    webCells: webCellIds(),
    webHome: WEB_HOME,
    webRadius: WEB_RADIUS,
    boardPx: BOARD_PX,
    cellPx: CELL_PX,
    previewMaxTurns: PREVIEW_MAX_TURNS,
    tickWaitMs: TICK_WAIT_MS,
    corpseLingerTurns: CORPSE_LINGER_TURNS,
    maxFlyMass: FLY_INITIAL_MASS,
    // The spider's mass bar now scales against the EGG-LAY threshold, not
    // its own starting mass — "how close to laying" is the meaningful cap
    // to visualize under the new mass-gated lay mechanic (§A.2.2); the old
    // denominator (a flat starting mass) said nothing about progress toward
    // the spider's actual goal.
    maxSpiderMass: EGG_LAY_MASS_THRESHOLD,
    defaultConfig: DEFAULT_GAME_CONFIG.spiderFly,
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
  :root { --fly: #A6791F; }
  @media (prefers-color-scheme: dark) { :root { --fly: #D9A94B; } }
  :root[data-theme="dark"] { --fly: #D9A94B; }
  :root[data-theme="light"] { --fly: #A6791F; }
  html { background: var(--bg); }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: ${SERIF_STACK}; font-size: 16px; line-height: 1.5; }
  .mono { font-family: ${MONO_STACK}; }
  main { max-width: 1120px; margin: 0 auto; padding: 1.4rem 1.2rem 2.2rem; }
  .eyebrow { font-family: ${MONO_STACK}; font-size: .7rem; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); }
  h1 { font-size: 1.4rem; margin: .3rem 0 .9rem; text-wrap: balance; }
  button { font: inherit; color: inherit; background: none; cursor: pointer; }
  button:focus-visible, input:focus-visible, .sprite:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  .stage { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 360px); gap: 1.2rem; align-items: start; }
  @media (max-width: 760px) { .stage { grid-template-columns: 1fr; } }
  /* A dusty window corner: a soft light glow near the top-left (WEB_HOME
     already sits near that corner — spider-fly-world.mjs's own header
     comment), and a faint diagonal weave standing in for dust/silk caught
     in the light. Decoration only — the 10x10 game grid itself is drawn by
     drawBoard() on the canvas beneath, unchanged. */
  .board-frame {
    position: relative; width: ${BOARD_PX}px; max-width: 100%; aspect-ratio: 1 / 1;
    background:
      radial-gradient(140% 140% at 6% 6%, rgba(255, 241, 199, .55), transparent 52%),
      repeating-linear-gradient(115deg, rgba(120, 110, 90, .06) 0 1px, transparent 1px 30px),
      var(--card);
    border: 1px solid var(--line);
    box-shadow: inset 0 0 0 6px var(--bg), inset 0 0 0 7px var(--line);
  }
  @media (prefers-color-scheme: dark) { .board-frame { background: radial-gradient(140% 140% at 6% 6%, rgba(130, 112, 60, .32), transparent 52%), repeating-linear-gradient(115deg, rgba(255, 255, 255, .045) 0 1px, transparent 1px 30px), var(--card); } }
  :root[data-theme="dark"] .board-frame { background: radial-gradient(140% 140% at 6% 6%, rgba(130, 112, 60, .32), transparent 52%), repeating-linear-gradient(115deg, rgba(255, 255, 255, .045) 0 1px, transparent 1px 30px), var(--card); }
  .board-frame canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .sprite-layer { position: absolute; inset: 0; }
  .sprite { position: absolute; width: 7.6%; height: 7.6%; transform: translate(-50%, -50%); transition: left .25s ease, top .25s ease; }
  @media (prefers-reduced-motion: reduce) { .sprite, .sprite-face { transition: none !important; } }
  .sprite-face { width: 100%; height: 100%; transition: transform .25s ease; }
  .sprite-face svg { width: 100%; height: 100%; display: block; }
  .sprite[data-cls="spider"] { color: var(--taught); }
  .sprite[data-cls="fly"] { color: var(--fly); }
  .sprite[data-cls="egg"] { color: var(--muted); }
  .sprite.dimmed { opacity: .28; }
  /* A corpse never faces anywhere in particular (the rot has no plan) and
     never rotates — grayscale-and-fade at the bottom of its own column
     until CORPSE_LINGER_TURNS passes and it stops being drawn at all. */
  .sprite.corpse { filter: grayscale(1); opacity: .38; pointer-events: none; }
  .sprite.corpse .sprite-face { transform: none !important; }
  .thread-tip { position: absolute; transform: translate(-50%, -130%); font-family: ${MONO_STACK}; font-size: .68rem; background: var(--ink); color: var(--bg); padding: .1rem .4rem; border-radius: 3px; pointer-events: none; white-space: nowrap; display: none; }
  .side { display: flex; flex-direction: column; gap: .8rem; min-width: 0; }
  .hud, .chat, .tuning { background: var(--card); border: 1px solid var(--line); padding: .6rem .75rem; }
  .hud h2, .chat h2, .tuning h2 { font-family: ${MONO_STACK}; font-size: .66rem; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 400; margin: 0 0 .5rem; }
  /* Fixed-height, internally-scrolling — a hatch can mint several spiders
     at once now, so the agent count (and a naive card list's own height)
     can jump sharply; the panel must never grow the page underneath it. */
  .hud-list { max-height: 420px; overflow-y: auto; }
  .hud-row { display: flex; flex-direction: column; gap: .1rem; padding: .4rem 0; border-top: 1px solid var(--line); }
  .hud-row:first-of-type { border-top: none; }
  .hud-id { font-family: ${MONO_STACK}; font-size: .74rem; }
  .hud-id.spider { color: var(--taught); } .hud-id.fly { color: var(--fly); } .hud-id.egg { color: var(--muted); }
  .hud-goal { font-size: .85rem; }
  .hud-plan, .hud-belief { font-family: ${MONO_STACK}; font-size: .66rem; color: var(--muted); margin-top: .2rem; line-height: 1.4; }
  .mass-track { height: 4px; margin-top: .3rem; background: var(--line); border-radius: 2px; overflow: hidden; }
  .mass-fill { height: 100%; background: var(--taught); }
  .mass-fill.fly { background: var(--fly); }
  .hud-empty { color: var(--muted); font-size: .85rem; }
  .chatlog { display: flex; flex-direction: column; gap: .4rem; max-height: 220px; overflow-y: auto; margin-bottom: .5rem; }
  .chatlog:empty { display: none; margin-bottom: 0; }
  .chatlog .u { font-family: ${MONO_STACK}; font-size: .74rem; color: var(--muted); }
  .chatlog .u::before { content: "tmct> "; color: var(--taught); }
  .chatlog .a { font-size: .88rem; line-height: 1.4; white-space: pre-wrap; }
  .chatask { display: flex; align-items: center; gap: .5rem; border-top: 1px solid var(--line); padding-top: .5rem; }
  .chatlog:empty + .chatask { border-top: none; padding-top: 0; }
  .chatask .prompt { color: var(--taught); font-size: .78rem; font-family: ${MONO_STACK}; }
  .chatask input { flex: 1; font-family: ${MONO_STACK}; font-size: .78rem; background: var(--bg); color: var(--ink); border: 1px solid var(--line); padding: .32rem .55rem; min-width: 0; }
  .chatask input:disabled { opacity: .5; }
  .chatpills { display: flex; flex-wrap: wrap; gap: .3rem; margin-top: .5rem; }
  .pill { font-family: ${MONO_STACK}; font-size: .68rem; padding: .2rem .6rem; border: 1px solid var(--line); border-radius: 99px; background: var(--bg); color: var(--ink); white-space: nowrap; }
  .pill:hover:not(:disabled) { border-color: var(--taught); }
  .pill:disabled { opacity: .45; cursor: default; }
  .pill[data-role="addr"].active { border-color: var(--taught); color: var(--taught); }
  /* The dynamic deception-pill rail (§A.2.4): a true/false tag shown ONLY
     here, via border style/color and a small human-facing glyph — the
     submitted sentence itself (data-sentence, filled into #chatq on click)
     never carries the tag, so a clicked pill is indistinguishable from a
     hand-typed claim once it's in the input. */
  .dynpills { display: flex; flex-wrap: wrap; gap: .3rem; margin-top: .5rem; padding-top: .5rem; border-top: 1px solid var(--line); }
  .dynpills:empty { display: none; padding-top: 0; border-top: none; }
  .pill[data-role="dyn-addr"][data-active="1"] { border-color: var(--taught); color: var(--taught); }
  .pill[data-role="dyn-claim"][data-truth="true"] { border-color: var(--taught-t2, var(--taught)); }
  .pill[data-role="dyn-claim"][data-truth="true"]::before { content: "✓ "; opacity: .5; }
  .pill[data-role="dyn-claim"][data-truth="false"] { border-style: dashed; border-color: var(--alert); }
  .pill[data-role="dyn-claim"][data-truth="false"]::before { content: "✕ "; opacity: .6; }
  .tuning-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 1rem; }
  .tuning-col h3 { font-size: .74rem; margin: 0 0 .4rem; font-weight: 600; }
  .tuning-col.spider h3 { color: var(--taught); } .tuning-col.fly h3 { color: var(--fly); }
  .tuning-col label { display: block; font-size: .68rem; color: var(--muted); margin-bottom: .6rem; }
  .tuning-col .tuning-val { font-family: ${MONO_STACK}; color: var(--ink); float: right; }
  .tuning-col input[type="range"] { display: block; width: 100%; margin-top: .2rem; accent-color: var(--taught); }
  .tuning-col.fly input[type="range"] { accent-color: var(--fly); }
  .tuning-col input:disabled { opacity: .45; }
  .controls-row { display: flex; align-items: center; gap: .6rem; margin-top: 1rem; flex-wrap: wrap; }
  .controls-row button { font-family: ${MONO_STACK}; font-size: .78rem; padding: .3rem .7rem; border: 1px solid var(--line); background: var(--card); color: var(--ink); }
  .controls-row button:hover:not(:disabled) { border-color: var(--taught); }
  .controls-row button:disabled { opacity: .4; cursor: default; }
  .controls-row .turn { margin-left: auto; font-family: ${MONO_STACK}; font-size: .78rem; color: var(--muted); font-variant-numeric: tabular-nums; }
  .status { font-family: ${MONO_STACK}; font-size: .74rem; color: var(--muted); margin-top: .5rem; }
  body.preview .side, body.preview .controls-row, body.preview .status, body.preview .tuning { display: none; }
  body.preview main { padding: 0; max-width: none; }
  body.preview .stage { display: block; }
  body.preview .eyebrow, body.preview h1 { display: none; }
</style>
</head>
<body>
<main>
  <div class="eyebrow">tmct &middot; spider and fly</div>
  <h1>A spider in its web, a fly on the board — each planning against the other</h1>
  <div class="stage">
    <div class="board-frame" id="boardFrame">
      <canvas id="board" width="${BOARD_PX}" height="${BOARD_PX}" aria-label="the 10x10 board"></canvas>
      <canvas id="pov" width="${BOARD_PX}" height="${BOARD_PX}" aria-hidden="true"></canvas>
      <div class="sprite-layer" id="spriteLayer"></div>
      <div class="thread-tip" id="threadTip"></div>
    </div>
    <aside class="side" aria-label="Agents and chat">
      <div class="hud">
        <h2>agents</h2>
        <div class="hud-list" id="hud"></div>
      </div>
      <div class="chat">
        <h2>tell the spider or the fly something</h2>
        <div class="chatlog" id="chatlog" aria-live="polite"></div>
        <form class="chatask" id="chatform">
          <span class="prompt mono">tmct&gt;</span>
          <input id="chatq" type="text" placeholder="@spider the fly is east" aria-label="Address the spider or the fly" disabled>
        </form>
        <div class="chatpills" id="chatpills" role="group" aria-label="quick phrases to fill the chat input">
          <button type="button" class="pill" data-role="addr" data-addressee="spider" disabled>@spider</button>
          <button type="button" class="pill" data-role="addr" data-addressee="fly" disabled>@fly</button>
          <button type="button" class="pill" data-role="dir" data-direction="north" disabled>the fly is north</button>
          <button type="button" class="pill" data-role="dir" data-direction="south" disabled>the fly is south</button>
          <button type="button" class="pill" data-role="dir" data-direction="east" disabled>the fly is east</button>
          <button type="button" class="pill" data-role="dir" data-direction="west" disabled>the fly is west</button>
        </div>
        <div class="dynpills" id="dynamicPills" role="group" aria-label="address one individual and feed it a true or false position claim"></div>
      </div>
    </aside>
  </div>
  <div class="tuning" id="tuning">
    <h2>live tuning &mdash; mass loss, spawn rate, vision, per class</h2>
    <div class="tuning-grid">
      <div class="tuning-col spider">
        <h3>spider</h3>
        <label>mass lost/turn <span class="tuning-val" id="tvSpiderMass"></span>
          <input type="range" id="ctlSpiderMass" min="0.1" max="3" step="0.1" disabled></label>
        <label>hatchlings per egg <span class="tuning-val" id="tvSpiderSpawn"></span>
          <input type="range" id="ctlSpiderSpawn" min="1" max="5" step="1" disabled></label>
        <label>vision radius <span class="tuning-val" id="tvSpiderVision"></span>
          <input type="range" id="ctlSpiderVision" min="1" max="8" step="1" disabled></label>
      </div>
      <div class="tuning-col fly">
        <h3>fly</h3>
        <label>mass lost/turn <span class="tuning-val" id="tvFlyMass"></span>
          <input type="range" id="ctlFlyMass" min="0.1" max="3" step="0.1" disabled></label>
        <label>spawns every N turns <span class="tuning-val" id="tvFlySpawn"></span>
          <input type="range" id="ctlFlySpawn" min="1" max="10" step="1" disabled></label>
        <label>vision radius <span class="tuning-val" id="tvFlyVision"></span>
          <input type="range" id="ctlFlyVision" min="1" max="8" step="1" disabled></label>
      </div>
    </div>
  </div>
  <div class="controls-row">
    <button id="resetBtn" type="button" disabled>reset</button>
    <button id="playBtn" type="button" disabled>&#9654; play</button>
    <button id="stepBtn" type="button" disabled>step</button>
    <span class="turn mono" id="turnLabel">turn: 0</span>
  </div>
  <div class="status" id="status">loading the engine&hellip;</div>
</main>
<script>
const SPIDERFLY = ${gridData};
</script>
<script src="./spider-fly-browser.bundle.js"></script>
<script>
(function () {
  "use strict";
  const createTicker = ${createTicker.toString()};
  const classOfAgentId = ${classOfAgentId.toString()};
  const threadCellsForSpiderPlan = ${threadCellsForSpiderPlan.toString()};
  const facingDegreesFor = ${facingDegreesFor.toString()};
  const nextCorpses = ${nextCorpses.toString()};
  const esc = ${escapeHtml.toString()};
  const el = (id) => document.getElementById(id);
  const boardFrame = el("boardFrame");
  const boardCanvas = el("board");
  const povCanvas = el("pov");
  const spriteLayer = el("spriteLayer");
  const threadTip = el("threadTip");
  const hudEl = el("hud");
  const chatlogEl = el("chatlog");
  const chatformEl = el("chatform");
  const chatqEl = el("chatq");
  const chatpillsEl = el("chatpills");
  const addressPillEls = [...chatpillsEl.querySelectorAll('[data-role="addr"]')];
  const directionPillEls = [...chatpillsEl.querySelectorAll('[data-role="dir"]')];
  const dynamicPillsEl = el("dynamicPills");
  const statusEl = el("status");
  const turnLabelEl = el("turnLabel");
  const resetBtn = el("resetBtn");
  const playBtn = el("playBtn");
  const stepBtn = el("stepBtn");
  const TUNING_CONTROLS = [
    { input: "ctlSpiderMass", out: "tvSpiderMass", key: "spiderMassDecrementPerTurn" },
    { input: "ctlSpiderSpawn", out: "tvSpiderSpawn", key: "eggHatchCount" },
    { input: "ctlSpiderVision", out: "tvSpiderVision", key: "spiderVisionRadius" },
    { input: "ctlFlyMass", out: "tvFlyMass", key: "flyMassDecrementPerTurn" },
    { input: "ctlFlySpawn", out: "tvFlySpawn", key: "flySpawnIntervalTurns" },
    { input: "ctlFlyVision", out: "tvFlyVision", key: "flyVisionRadius" },
  ].map((c) => ({ ...c, inputEl: el(c.input), outEl: el(c.out) }));

  const params = new URLSearchParams(location.search);
  const preview = params.get("preview") === "1";
  document.body.classList.toggle("preview", preview);

  const dpr = window.devicePixelRatio || 1;
  const boardCtx = boardCanvas.getContext("2d");
  const povCtx = povCanvas.getContext("2d");
  function sizeCanvas(canvas, ctx) {
    canvas.width = SPIDERFLY.boardPx * dpr;
    canvas.height = SPIDERFLY.boardPx * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  sizeCanvas(boardCanvas, boardCtx);
  sizeCanvas(povCanvas, povCtx);

  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  // ---- board geometry ---------------------------------------------------
  const cellSize = SPIDERFLY.boardPx / SPIDERFLY.gridSize;
  function cellCenterPct(x, y) {
    return { leftPct: ((x - 0.5) / SPIDERFLY.gridSize) * 100, topPct: ((y - 0.5) / SPIDERFLY.gridSize) * 100 };
  }

  // ---- state shared across redraws --------------------------------------
  let session = null;
  let lastAgents = {};
  let lastActiveWebs = [];
  let lastTurn = 0;
  const goalById = {};
  const spriteEls = {};
  const facingByAgent = {};
  let corpses = {};
  const corpseEls = {};
  let selectedAddresseeId = null;
  let povAgentId = null;
  let threadHits = [];
  // Populated once the live session boots (session.getConfig()) and kept in
  // sync with whatever the tuning sliders below are currently set to — the
  // POV overlay's own per-class vision radius reads this instead of a fixed
  // constant, so dragging a slider changes what a toggled POV shows too.
  let liveConfig = {};

  function removeStaleSprites(agents) {
    for (const id of Object.keys(spriteEls)) {
      if (!agents[id]) {
        spriteEls[id].remove(); delete spriteEls[id]; delete goalById[id]; delete facingByAgent[id];
      }
    }
  }

  function togglePov(id) {
    povAgentId = povAgentId === id ? null : id;
    if (!povAgentId) for (const node of Object.values(spriteEls)) node.classList.remove("dimmed");
    drawPov();
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && povAgentId) togglePov(povAgentId);
  });

  function ensureSpriteEl(id, cls) {
    let node = spriteEls[id];
    if (node) return node;
    node = document.createElement("div");
    node.className = "sprite";
    node.dataset.cls = cls;
    // Property-aware resolution (sprite-templates.mjs's resolveSpriteAsset):
    // no agent here carries an mgx:hasProperty fact today, so propertyFacts
    // stays empty and every agent resolves through its plain class template
    // (or the flat SPRITE_REGISTRY, for a class with none) — the same output
    // as before this module existed, just wired for the day an agent does
    // carry one.
    const sprite = window.tmctSpiderFly
      ? tmctSpiderFly.resolveSpriteAsset(cls, (session && session.taxonomyRows) || [], [], SPIDERFLY.spriteTemplates, tmctSpiderFly.SPRITE_REGISTRY)
      : "";
    // The sprite SVG lives in its own inner wrapper so plan-driven facing
    // (a CSS rotate on THIS wrapper) never fights the outer .sprite node's
    // own translate(-50%,-50%) positioning transform.
    const face = document.createElement("div");
    face.className = "sprite-face";
    face.innerHTML = sprite;
    node.appendChild(face);
    if (!preview) {
      node.tabIndex = 0;
      node.setAttribute("role", "button");
      node.setAttribute("aria-label", "show " + id + "\\u2019s point of view");
      node.addEventListener("click", () => togglePov(id));
      node.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); togglePov(id); }
      });
    }
    spriteLayer.appendChild(node);
    spriteEls[id] = node;
    return node;
  }

  function applyAgents(agents) {
    removeStaleSprites(agents);
    for (const [id, a] of Object.entries(agents)) {
      const cls = classOfAgentId(id);
      const node = ensureSpriteEl(id, cls);
      const parsed = tmctSpiderFly.parseCellId(a.cell);
      if (!parsed) continue;
      const pct = cellCenterPct(parsed.x, parsed.y);
      node.style.left = pct.leftPct + "%";
      node.style.top = pct.topPct + "%";
      // Facing is driven by the agent's own CURRENT plan's first step, not
      // its actual next move — the two usually agree, but a fresh plan is
      // computed every tick, so facing can visibly flip as a plan gets
      // clobbered and replaced under partial/unreliable knowledge (the
      // whole point of this page, not a glitch).
      facingByAgent[id] = facingDegreesFor(a.plan, facingByAgent[id]);
      const face = node.querySelector(".sprite-face");
      if (face) face.style.transform = "rotate(" + facingByAgent[id] + "deg)";
      if (a.goal) goalById[id] = a.goal;
    }
    lastAgents = agents;
  }

  // ---- corpses (§A.2.5): visual-only — the actual starve/eat removal
  // already happened in the engine before this redraw ever sees "agents".
  // A corpse sinks to the bottom row of the SAME board column it died in
  // ("drops to the bottom" — spider-fly-world.mjs's own x/y convention,
  // y = GRID_SIZE is the bottom row) and fades out once CORPSE_LINGER_TURNS
  // passes, drawn in the same sprite layer as every live sprite, just
  // grayscaled and non-interactive (see the .sprite.corpse CSS rule).
  function renderCorpses() {
    for (const id of Object.keys(corpseEls)) {
      if (!corpses[id]) { corpseEls[id].remove(); delete corpseEls[id]; }
    }
    for (const [id, corpse] of Object.entries(corpses)) {
      let node = corpseEls[id];
      if (!node) {
        node = document.createElement("div");
        node.className = "sprite corpse";
        node.dataset.cls = corpse.cls;
        node.setAttribute("aria-hidden", "true");
        const face = document.createElement("div");
        face.className = "sprite-face";
        face.innerHTML = window.tmctSpiderFly
          ? tmctSpiderFly.resolveSpriteAsset(corpse.cls, (session && session.taxonomyRows) || [], [], SPIDERFLY.spriteTemplates, tmctSpiderFly.SPRITE_REGISTRY)
          : "";
        node.appendChild(face);
        spriteLayer.appendChild(node);
        corpseEls[id] = node;
      }
      const deathCell = tmctSpiderFly.parseCellId(corpse.cell);
      if (!deathCell) continue;
      const pct = cellCenterPct(deathCell.x, SPIDERFLY.gridSize);
      node.style.left = pct.leftPct + "%";
      node.style.top = pct.topPct + "%";
    }
  }

  function massBarHtml(cls, mass) {
    const maxMass = cls === "spider" ? SPIDERFLY.maxSpiderMass : cls === "fly" ? SPIDERFLY.maxFlyMass : null;
    if (typeof mass !== "number" || !maxMass) return "";
    const pct = Math.max(0, Math.min(100, (mass / maxMass) * 100));
    return '<div class="mass-track"><div class="mass-fill ' + esc(cls) + '" style="width:' + pct + '%"></div></div>';
  }

  // The last-created plan as a plain arrow chain ("west → west"), or
  // "holding." when the agent's plan this tick is empty — mirrors exactly
  // what drove this tick's sprite facing (facingDegreesFor reads the same
  // plan[0]), so the HUD line and the sprite's own orientation never
  // disagree about what the agent is "about to do".
  function planLineHtml(plan) {
    const text = plan && plan.length ? plan.map((d) => esc(d)).join(" \\u2192 ") : "holding";
    return '<div class="hud-plan">plan: ' + text + ".</div>";
  }

  // The agent's own current world-knowledge-graph snapshot (§A.2.7) — every
  // OTHER live individual it believes it knows the position of, or
  // "unseen" when it has no belief at all. Deliberately never ground truth:
  // this is what the agent would actually ACT on, which a false pill or a
  // told fact can make visibly wrong compared to where that individual
  // really is — the gap IS the demonstration.
  function beliefLineHtml(belief) {
    const entries = Object.entries(belief || {});
    if (!entries.length) return "";
    const text = entries.map(([id, cell]) => esc(id) + (cell ? " @ " + esc(cell) : " unseen")).join(" \\u00b7 ");
    return '<div class="hud-belief">believes: ' + text + "</div>";
  }

  function renderHud() {
    const ids = Object.keys(lastAgents).sort();
    if (!ids.length) { hudEl.innerHTML = '<div class="hud-empty">no agents on the board.</div>'; return; }
    hudEl.innerHTML = ids.map((id) => {
      const cls = classOfAgentId(id);
      const a = lastAgents[id];
      return '<div class="hud-row"><span class="hud-id ' + esc(cls) + '">' + esc(id) + '</span>'
        + '<span class="hud-goal">' + esc(goalById[id] || "watching\\u2026") + "</span>"
        + massBarHtml(cls, a.mass)
        + planLineHtml(a.plan)
        + beliefLineHtml(a.belief)
        + "</div>";
    }).join("");
  }

  const threadGeometry = {
    parseCellId: (id) => tmctSpiderFly.parseCellId(id),
    cellId: (x, y) => tmctSpiderFly.cellId(x, y),
    directionDelta: tmctSpiderFly.DIRECTION_DELTA,
  };

  function drawBoard(agents, activeWebs) {
    const w = SPIDERFLY.boardPx, h = SPIDERFLY.boardPx;
    boardCtx.clearRect(0, 0, w, h);
    boardCtx.fillStyle = cssVar("--taught-soft") || "rgba(46,125,79,.12)";
    for (const wc of SPIDERFLY.webCells) {
      const p = tmctSpiderFly.parseCellId(wc);
      boardCtx.fillRect((p.x - 1) * cellSize, (p.y - 1) * cellSize, cellSize, cellSize);
    }
    // A spider-built dynamic web is a distinct color from the always-on
    // static home zone above, plus a dashed outline — same concept
    // (hasActiveWebAt), visually two different things on the board.
    boardCtx.fillStyle = cssVar("--alert-soft") || "rgba(176,80,63,.12)";
    boardCtx.strokeStyle = cssVar("--alert") || "#B0503F";
    boardCtx.lineWidth = 1;
    boardCtx.setLineDash([3, 2]);
    for (const web of activeWebs || []) {
      const p = tmctSpiderFly.parseCellId(web.cell);
      if (!p) continue;
      boardCtx.fillRect((p.x - 1) * cellSize, (p.y - 1) * cellSize, cellSize, cellSize);
      boardCtx.strokeRect((p.x - 1) * cellSize + 0.5, (p.y - 1) * cellSize + 0.5, cellSize - 1, cellSize - 1);
    }
    boardCtx.setLineDash([]);
    boardCtx.strokeStyle = cssVar("--line") || "#DDD9D0";
    boardCtx.lineWidth = 1;
    for (let i = 0; i <= SPIDERFLY.gridSize; i += 1) {
      boardCtx.beginPath(); boardCtx.moveTo(i * cellSize, 0); boardCtx.lineTo(i * cellSize, h); boardCtx.stroke();
      boardCtx.beginPath(); boardCtx.moveTo(0, i * cellSize); boardCtx.lineTo(w, i * cellSize); boardCtx.stroke();
    }
    threadHits = [];
    const thread = threadCellsForSpiderPlan(agents, threadGeometry);
    if (thread) {
      boardCtx.strokeStyle = cssVar("--taught") || "#2E7D4F";
      boardCtx.lineWidth = 2;
      boardCtx.beginPath();
      let prev = null;
      thread.forEach((c, i) => {
        const p = tmctSpiderFly.parseCellId(c);
        const px = (p.x - 0.5) * cellSize, py = (p.y - 0.5) * cellSize;
        if (i === 0) boardCtx.moveTo(px, py); else boardCtx.lineTo(px, py);
        if (prev) threadHits.push({ x: (prev.x + px) / 2, y: (prev.y + py) / 2, step: i });
        prev = { x: px, y: py };
      });
      boardCtx.stroke();
    }
  }

  function drawPov() {
    povCtx.clearRect(0, 0, SPIDERFLY.boardPx, SPIDERFLY.boardPx);
    if (!povAgentId) return;
    const agent = lastAgents[povAgentId];
    if (!agent) { povAgentId = null; return; }
    const p = tmctSpiderFly.parseCellId(agent.cell);
    // The live, slider-adjustable per-class radius (falling back to the
    // engine's own shipped default before the session has finished
    // booting) — a POV toggle always reflects whatever vision range this
    // class currently actually has, not a fixed constant.
    const radius = classOfAgentId(povAgentId) === "spider"
      ? (liveConfig.spiderVisionRadius ?? tmctSpiderFly.DEFAULT_VISION_RADIUS)
      : (liveConfig.flyVisionRadius ?? tmctSpiderFly.DEFAULT_VISION_RADIUS);
    const visible = new Set(tmctSpiderFly.visibleCells(p.x, p.y, radius));
    povCtx.fillStyle = "rgba(0,0,0,.55)";
    for (let gy = 1; gy <= SPIDERFLY.gridSize; gy += 1) {
      for (let gx = 1; gx <= SPIDERFLY.gridSize; gx += 1) {
        if (visible.has(tmctSpiderFly.cellId(gx, gy))) continue;
        povCtx.fillRect((gx - 1) * cellSize, (gy - 1) * cellSize, cellSize, cellSize);
      }
    }
    for (const [id, node] of Object.entries(spriteEls)) {
      const a = lastAgents[id];
      node.classList.toggle("dimmed", id !== povAgentId && !!a && !visible.has(a.cell));
    }
  }

  boardFrame.addEventListener("mousemove", (e) => {
    if (!threadHits.length) { threadTip.style.display = "none"; return; }
    const rect = boardFrame.getBoundingClientRect();
    const scale = SPIDERFLY.boardPx / rect.width;
    const mx = (e.clientX - rect.left) * scale, my = (e.clientY - rect.top) * scale;
    const hit = threadHits.find((h) => (h.x - mx) ** 2 + (h.y - my) ** 2 <= 196);
    if (!hit) { threadTip.style.display = "none"; return; }
    threadTip.textContent = "step " + hit.step;
    threadTip.style.left = ((hit.x / SPIDERFLY.boardPx) * 100) + "%";
    threadTip.style.top = ((hit.y / SPIDERFLY.boardPx) * 100) + "%";
    threadTip.style.display = "block";
  });
  boardFrame.addEventListener("mouseleave", () => { threadTip.style.display = "none"; });

  function redraw(agents, turn, activeWebs) {
    // nextCorpses compares the OLD lastAgents against the NEW agents, so it
    // must run before applyAgents overwrites lastAgents below.
    corpses = nextCorpses(corpses, lastAgents, agents, turn, SPIDERFLY.corpseLingerTurns);
    applyAgents(agents);
    renderCorpses();
    renderHud();
    renderDynamicPills();
    lastTurn = turn;
    lastActiveWebs = activeWebs || [];
    turnLabelEl.textContent = "turn: " + turn;
    drawBoard(agents, lastActiveWebs);
    drawPov();
  }

  // ---- chat dock ---------------------------------------------------------
  function addChatLine(cls, html) {
    const d = document.createElement("div");
    d.className = cls; d.innerHTML = html;
    chatlogEl.appendChild(d); chatlogEl.scrollTop = chatlogEl.scrollHeight;
  }
  chatformEl.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = chatqEl.value.trim();
    if (!q || !session) return;
    chatqEl.value = "";
    addChatLine("u", esc(q));
    withLock(async () => {
      const result = await session.turn(q);
      addChatLine("a", esc(result.answer).replace(/\\n/g, "<br>"));
      const snap = await session.snapshot();
      redraw(snap.agents, snap.turn, snap.activeWebs);
    });
  });

  // ---- chat pills: click-to-fill shortcuts over the SAME #chatq input, never
  // a second path into the engine — a pill only ever sets/appends text and
  // focuses the field, exactly what typing the same characters would do, so
  // free typing keeps working unchanged and every resulting phrase is one the
  // addressed teach-frame grammar (SPIDER_FLY_TOLD_RE in spider-fly-turn.mjs)
  // genuinely accepts.
  function addresseeKindOf(value) {
    const m = /^@(spider|fly)(?:-\\d+)?\\b/i.exec(String(value).trim());
    return m ? m[1].toLowerCase() : null;
  }
  function refreshPills() {
    const explicitKind = addresseeKindOf(chatqEl.value);
    const subject = (explicitKind || "spider") === "spider" ? "fly" : "spider";
    for (const btn of directionPillEls) btn.textContent = "the " + subject + " is " + btn.dataset.direction;
    for (const btn of addressPillEls) btn.classList.toggle("active", btn.dataset.addressee === explicitKind);
  }
  for (const btn of addressPillEls) {
    btn.addEventListener("click", () => {
      chatqEl.value = "@" + btn.dataset.addressee + " ";
      refreshPills();
      chatqEl.focus();
    });
  }
  for (const btn of directionPillEls) {
    btn.addEventListener("click", () => {
      const kind = addresseeKindOf(chatqEl.value) || "spider";
      let value = chatqEl.value;
      if (!addresseeKindOf(value)) value = "@" + kind + " " + value.trimStart();
      chatqEl.value = value.replace(/\\s+$/, "") + " " + btn.textContent;
      refreshPills();
      chatqEl.focus();
    });
  }
  chatqEl.addEventListener("input", refreshPills);
  refreshPills();

  // ---- deception pills (§A.2.4): a SEPARATE dynamic rail, alongside (never
  // replacing) the static one above. tmctSpiderFly.pillsForSpiderFly is the
  // exact same pure function spider-fly-turn.mjs exports — this page never
  // reimplements the true/false claim logic, only renders its output and
  // fills #chatq on click, same click-to-fill discipline as every other
  // pill on this page (never auto-submits).
  function renderDynamicPills() {
    if (!session || !Object.keys(lastAgents).length) { dynamicPillsEl.innerHTML = ""; return; }
    const result = tmctSpiderFly.pillsForSpiderFly(lastAgents, selectedAddresseeId, {});
    selectedAddresseeId = result.addresseeId;
    const addrHtml = result.addressPills.map((p) =>
      '<button type="button" class="pill" data-role="dyn-addr" data-id="' + esc(p.id) + '"'
      + (p.id === selectedAddresseeId ? ' data-active="1"' : "") + ">" + esc(p.label) + "</button>"
    ).join("");
    const claimHtml = result.claimPills.map((p) =>
      '<button type="button" class="pill" data-role="dyn-claim" data-truth="' + (p.truth ? "true" : "false")
      + '" data-sentence="' + esc(p.sentence) + '">' + esc(p.text) + "</button>"
    ).join("");
    dynamicPillsEl.innerHTML = addrHtml + claimHtml;
  }
  dynamicPillsEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill");
    if (!btn) return;
    if (btn.dataset.role === "dyn-addr") {
      selectedAddresseeId = btn.dataset.id;
      renderDynamicPills();
      return;
    }
    if (btn.dataset.role === "dyn-claim") {
      chatqEl.value = btn.dataset.sentence;
      refreshPills();
      chatqEl.focus();
    }
  });

  // ---- live tuning (mass-loss-rate / spawn-rate / vision-radius, per
  // class): each slider writes straight through session.setConfig, which
  // every future tick()/turn() call reads — a change never rewinds a value
  // already written to a past turn's facts, same posture as editing
  // tmct.toml between sessions, just live and per-class.
  function applyTuningValue(control, value) {
    liveConfig[control.key] = value;
    control.outEl.textContent = String(value);
    control.inputEl.value = String(value);
    if (session) session.setConfig({ [control.key]: value });
  }
  function initTuning(config) {
    liveConfig = { ...config };
    for (const control of TUNING_CONTROLS) {
      applyTuningValue(control, liveConfig[control.key]);
      control.inputEl.disabled = false;
    }
  }
  for (const control of TUNING_CONTROLS) {
    control.inputEl.addEventListener("input", () => {
      const value = Number(control.inputEl.value);
      applyTuningValue(control, value);
      drawPov(); // a vision-radius change should reflect immediately in an open POV overlay
    });
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

  let tuningInitialized = false;
  async function boot() {
    session = await tmctSpiderFly.createSpiderFlySession();
    // A reset mints a brand-new session (fresh board, fresh config) — the
    // FIRST boot seeds the sliders from the engine's own shipped defaults;
    // every boot after that re-applies whatever the visitor already had the
    // sliders set to, so tuning survives a reset instead of silently
    // reverting.
    if (!tuningInitialized) { initTuning(session.getConfig()); tuningInitialized = true; }
    else session.setConfig(liveConfig);
    selectedAddresseeId = null;
    redraw(session.initial.agents, session.initial.turn, session.initial.activeWebs);
    statusEl.textContent = session.opening;
    chatqEl.disabled = false;
    resetBtn.disabled = false; playBtn.disabled = false; stepBtn.disabled = false;
    for (const btn of [...addressPillEls, ...directionPillEls]) btn.disabled = false;
  }

  let loopScheduled = false;
  const ticker = createTicker({
    onTick: () => withLock(async () => {
      const result = await session.tick();
      redraw(result.agents, result.turn, result.activeWebs);
    }),
    onRender: (state) => {
      playBtn.textContent = state.playing ? "\\u23f8 pause" : "\\u25b6 play";
      playBtn.disabled = state.animating;
      stepBtn.disabled = state.animating || state.playing;
      resetBtn.disabled = state.animating;
      if (preview && !state.playing && !state.animating && lastTurn >= SPIDERFLY.previewMaxTurns && !loopScheduled) {
        loopScheduled = true;
        setTimeout(() => { loopScheduled = false; ticker.reset().then(() => ticker.play()); }, 1200);
      }
    },
    onReset: () => withLock(boot),
    hasNext: () => !preview || lastTurn < SPIDERFLY.previewMaxTurns,
    waitMs: SPIDERFLY.tickWaitMs,
  });
  playBtn.addEventListener("click", () => ticker.play());
  stepBtn.addEventListener("click", () => ticker.stepOnce());
  resetBtn.addEventListener("click", () => ticker.reset());

  boot().then(() => { if (preview) ticker.play(); });

  new MutationObserver(() => { drawBoard(lastAgents, lastActiveWebs); drawPov(); })
    .observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  if (window.matchMedia) {
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { drawBoard(lastAgents, lastActiveWebs); drawPov(); });
  }
})();
</script>
</body>
</html>
`;
}
