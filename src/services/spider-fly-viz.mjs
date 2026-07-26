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
import { THEME_TOKENS_CSS, SERIF_STACK, MONO_STACK, escapeHtml, embedJson, embedScriptText } from "./viz-theme.mjs";
import { createTicker } from "./viz-ticker.mjs";
import { GRID_SIZE, WEB_HOME, WEB_RADIUS, isInWebBlock, cellId } from "../domain/spider-fly-world.mjs";
import { FLY_INITIAL_MASS, EGG_LAY_MASS_THRESHOLD } from "./spider-fly.mjs";
import { DEFAULT_GAME_CONFIG } from "../domain/game-config.mjs";

// A larger cell than this page's first cut (44px) — the board sits in its
// own full-width block, so a bigger cell keeps it reading as the page's
// main scene rather than a small inset square.
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

/** The sprite-facing rotation (degrees) for one agent this tick, driven by
 *  its CURRENT plan's first step (spider-fly.mjs's own `agents[id].plan`),
 *  never its actual next move — the two usually coincide, but re-planning
 *  fresh every tick means they can visibly diverge as a plan gets clobbered
 *  and replaced, which is the intended, honest demonstration of "plans get
 *  clobbered under partial/unreliable knowledge," not a glitch to smooth
 *  over. A held agent (`plan` empty/absent — no direction to face) keeps
 *  `previousDegrees` unchanged rather than snapping back to a default, so
 *  holding still never spins the sprite; a brand-new agent with no prior
 *  facing at all defaults to 0 (the art's own default north/up pose).
 *  Self-contained (no outer refs), `.toString()`-splice safe — the
 *  direction -> degrees table lives INSIDE the function body on purpose:
 *  spider.toml and fly.toml both draw the head/thorax at the TOP of the
 *  viewBox (facing north by default), matching spider-fly-world.mjs's own
 *  DIRECTION_DELTA (north decreases y — up on screen). */
export function facingDegreesFor(plan, previousDegrees) {
  const FACING_DEGREES = { north: 0, east: 90, south: 180, west: 270 };
  const direction = plan && plan[0];
  if (direction && FACING_DEGREES[direction] !== undefined) return FACING_DEGREES[direction];
  return previousDegrees ?? 0;
}

/** The instance-level `mgx:feels` emotion for one spider-fly agent this
 *  tick — a PURE derivation from state spider-fly.mjs's own `runSpiderFlyTick`
 *  already returns on the agent (`goal`/`mass`), never a new persisted fact,
 *  the same derive-don't-duplicate posture `hasActiveWebAt` already holds for
 *  web state (PLAN_GAMES_UPLIFT_V3.md §B.2.4). Operator-confirmed mapping: a
 *  spider that just ate is happy; a spider carrying an uncaught fly or
 *  mid-chase (chasing, or co-located and about to catch) is angry (predatory
 *  focus); a spider avoiding another spider is scared; a spider holding
 *  position or building a web is calm. A fly evading a believed-visible
 *  spider is scared, and so is the sharper form of the same fear — just
 *  caught, or already being carried; a fly with no threat visible (wandering,
 *  or trapped with none in sight) is calm.
 *
 *  `agent.goal` is spider-fly.mjs's own fixed-template text (`goalLineFor`'s
 *  literal phrasing) — the only reliable per-tick discriminator this
 *  function's caller has, and every real goal string that engine can ever
 *  produce is matched below by its own distinguishing prefix. A goal this
 *  function doesn't recognize (a freshly hatched/spawned agent's "no goal
 *  yet", or the transient "X is gone — re-evaluating" scrub once a named
 *  agent dies) falls through to "calm" — the 6-word vocabulary's own
 *  deliberate no-strong-emotion baseline (sprite-expressions.mjs's B.2.1
 *  design), not a guess.
 *
 *  `maxMass` is accepted for parity with this page's own per-class mass-bar
 *  denominators (`SPIDERFLY.maxSpiderMass`/`maxFlyMass`) but unused today —
 *  no state in the operator's own confirmed table keys off a mass ratio,
 *  only off the goal text above. Self-contained (no outer refs),
 *  `.toString()`-splice safe. */
export function emotionFor(agent, kind, maxMass) {
  const goal = agent?.goal || "";
  if (kind === "spider") {
    if (goal.startsWith("just ate")) return "happy";
    if (goal.startsWith("carrying") || goal.startsWith("chasing") || goal.startsWith("co-located with")) return "angry";
    if (goal.startsWith("avoiding")) return "scared";
    return "calm";
  }
  if (kind === "fly") {
    if (
      goal.startsWith("evading")
      || goal.startsWith("being carried by")
      || goal.startsWith("just caught by")
      || goal.startsWith("trapped in an active web")
    ) return "scared";
    return "calm";
  }
  return "calm";
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
 * `lingerTurns` defaults to a literal 4 (not the module-level
 * CORPSE_LINGER_TURNS constant) so this function stays fully
 * `.toString()`-splice safe — every real caller (both the inlined page and
 * CORPSE_LINGER_TURNS's own callers elsewhere in this module) passes it
 * explicitly anyway.
 */
export function nextCorpses(prevCorpses, prevAgents, agents, turn, lingerTurns = 4) {
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
 *  data/sprites-large/*.toml (sprite-large-template-files.mjs) — the large
 *  tier, not the small icon tier every other embedder reads, because it's
 *  the only one `spider-with-emotion.toml`/`fly-with-emotion.toml` (the live
 *  `mgx:feels` wiring below resolves against) actually exist in — embedded
 *  as page data the same reason adventure-viz.mjs's own worldPayload is —
 *  the browser bundle stays fs-free. Defaults to `[]` (every agent falls
 *  back to the flat SPRITE_REGISTRY, unchanged from before this module
 *  existed).
 *  `?preview=1` on the page's own URL switches it into the small, auto-
 *  playing, non-interactive mode the home page's hero iframe embeds (§11) —
 *  one file serves both the hero and the "open full-screen" link, matching
 *  how ledger.html/plan.html are each one file embedded two ways.
 *  `engineBundleJs` (the built spider-fly-browser bundle's own text) inlines
 *  the engine into the page instead of the sibling `<script src>`, for the
 *  CLI's standalone export — one downloadable file that runs from file://
 *  with no sibling assets. Default empty keeps the site build's sibling-file
 *  arrangement byte-identical. */
export function renderSpiderFlyHtml({ title = DEFAULT_TITLE, spriteTemplates = [], engineBundleJs = "" } = {}) {
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
<link rel="icon" href="./favicon.svg" type="image/svg+xml">
<link rel="icon" href="./favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="./apple-touch-icon.png">
<style>
${THEME_TOKENS_CSS}
  :root { --fly: #A6791F; }
  @media (prefers-color-scheme: dark) { :root { --fly: #D9A94B; } }
  :root[data-theme="dark"] { --fly: #D9A94B; }
  :root[data-theme="light"] { --fly: #A6791F; }
  /* The dashboard chrome (Part C.4.2): a beveled control-panel palette
     WRAPPING the dusty-window board scene above, never touching it — every
     rule below this block styles .side/.controls-row/.tuning/.status only,
     all of which are hidden in ?preview=1 mode alongside .side itself, so
     none of this bleeds into the embedded home-page hero. --chrome-face is
     the panel's own warm plastic face; --chrome-edge-hi/-lo are its raised-
     bevel light/shadow edges; --chrome-brass is the console's metal accent
     (borders, active/hover states); --chrome-well/-well-ink are the dark
     "LCD" readout a real panel's numeric window would use, deliberately
     near-black in both themes (a lit readout reads dark-with-a-glow whether
     the room around it is light or dark). --chrome-shadow-raised/-inset
     compose the two bevel directions once so every panel/button/well below
     just references one of them, never re-deriving the edge colors. */
  :root {
    --chrome-face: #DCD3B8; --chrome-face-hi: #EFE8CC; --chrome-edge-hi: #FBF7E6; --chrome-edge-lo: #8B7F5C;
    --chrome-brass: #8A6A26; --chrome-brass-soft: rgba(138, 106, 38, .16);
    --chrome-well: #201A10; --chrome-well-ink: #E8C876;
    --chrome-shadow-raised: inset 0 1px 0 var(--chrome-edge-hi), inset 0 -1px 0 var(--chrome-edge-lo), 0 1px 2px rgba(0, 0, 0, .18);
    --chrome-shadow-inset: inset 0 1px 3px var(--chrome-edge-lo), inset 0 -1px 0 var(--chrome-edge-hi);
  }
  @media (prefers-color-scheme: dark) {
    :root { --chrome-face: #2B2E23; --chrome-face-hi: #363A29; --chrome-edge-hi: #4C5138; --chrome-edge-lo: #14150D;
      --chrome-brass: #D3AE5C; --chrome-brass-soft: rgba(211, 174, 92, .16);
      --chrome-well: #0B0904; --chrome-well-ink: #F0D392; }
  }
  :root[data-theme="dark"] { --chrome-face: #2B2E23; --chrome-face-hi: #363A29; --chrome-edge-hi: #4C5138; --chrome-edge-lo: #14150D;
    --chrome-brass: #D3AE5C; --chrome-brass-soft: rgba(211, 174, 92, .16);
    --chrome-well: #0B0904; --chrome-well-ink: #F0D392; }
  :root[data-theme="light"] { --chrome-face: #DCD3B8; --chrome-face-hi: #EFE8CC; --chrome-edge-hi: #FBF7E6; --chrome-edge-lo: #8B7F5C;
    --chrome-brass: #8A6A26; --chrome-brass-soft: rgba(138, 106, 38, .16);
    --chrome-well: #201A10; --chrome-well-ink: #E8C876; }
  html { background: var(--bg); }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: ${SERIF_STACK}; font-size: 16px; line-height: 1.5; }
  .mono { font-family: ${MONO_STACK}; }
  main { max-width: 1120px; margin: 0 auto; padding: 1.4rem 1.2rem 2.2rem; }
  .eyebrow { font-family: ${MONO_STACK}; font-size: .7rem; letter-spacing: .08em; text-transform: uppercase; color: var(--chrome-brass); }
  h1 { font-size: 1.4rem; margin: .3rem 0 .9rem; text-wrap: balance; }
  button { font: inherit; color: inherit; background: none; cursor: pointer; }
  button:focus-visible, input:focus-visible, .sprite:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  /* The top row: the tuning console at roughly two-thirds width on the left,
     the chat/agents column at roughly a quarter on the right — the 8fr/3fr
     split plus the gap approximates that pair of fractions without them
     needing to sum to a full width. */
  .stage { display: grid; grid-template-columns: minmax(0, 8fr) minmax(280px, 3fr); gap: 1.2rem; align-items: start; }
  @media (max-width: 760px) { .stage { grid-template-columns: minmax(0, 1fr); } }
  /* A dusty window corner: a soft light glow near the top-left (WEB_HOME
     already sits near that corner — spider-fly-world.mjs's own header
     comment), and a faint diagonal weave standing in for dust/silk caught
     in the light. Decoration only — the 10x10 game grid itself is drawn by
     drawBoard() on the canvas beneath, unchanged. */
  .board-frame {
    margin: 0 auto;
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
  .stage-left { display: flex; flex-direction: column; gap: 1.2rem; min-width: 0; }
  .side { display: flex; flex-direction: column; gap: .8rem; min-width: 0; }
  /* The console panel shell: a raised beveled plastic face (chrome-shadow-
     raised), never the flat card/hairline the rest of the site uses — the
     nameplate header below bleeds to this same panel's own edges via a
     negative margin equal to this padding, so it reads as one welded unit,
     not a label floating inside a box. */
  .hud, .chat, .tuning { background: var(--chrome-face); border: 1px solid var(--chrome-edge-lo); box-shadow: var(--chrome-shadow-raised); border-radius: 2px; padding: .6rem .75rem; }
  /* Both the controls strip above the board and the tuning strip below it
     match the board's own width (not the wider stage-left column they sit
     in), so all three line up as one visual stack. */
  .tuning, .controls-panel, .head-inner { width: ${BOARD_PX}px; max-width: 100%; margin: 0 auto; box-sizing: border-box; }
  /* the eyebrow+h1 sit in their own board-width column (.head-inner), inside
     a .page-head row that mirrors the real board's own 8fr/3fr split below
     it — the second, empty column just holds that split in place so the
     first column's own left edge lines up with the board's, instead of the
     wider page margin. min-width: 0 matches .stage-left's own override:
     without it, a grid item's default automatic minimum size is its
     content's own max-content width, and at the phone-width single-column
     override below the fixed-width child would force the track (and the
     page) wider than the viewport instead of actually shrinking. */
  .page-head { margin-bottom: 0; }
  .head-inner { min-width: 0; }
  .hud h2, .chat h2, .tuning h2 {
    font-family: ${MONO_STACK}; font-size: .68rem; letter-spacing: .1em; text-transform: uppercase; font-weight: 600;
    margin: -.6rem -.75rem .5rem; padding: .42rem .75rem;
    background: var(--chrome-face-hi); border-bottom: 1px solid var(--chrome-edge-lo);
    box-shadow: inset 0 1px 0 var(--chrome-edge-hi);
    color: var(--ink); text-shadow: 0 1px 0 var(--chrome-edge-hi);
  }
  /* Fixed-height, internally-scrolling — a hatch can mint several spiders
     at once now, so the agent count (and a naive card list's own height)
     can jump sharply; the panel must never grow the page underneath it. */
  .hud-list { max-height: 420px; overflow-y: auto; }
  .hud-row { display: flex; align-items: flex-start; gap: .6rem; padding: .4rem 0; border-top: 1px solid var(--chrome-edge-lo); box-shadow: inset 0 1px 0 var(--chrome-edge-hi); }
  .hud-row:first-of-type { border-top: none; box-shadow: none; }
  .hud-row.clickable { cursor: pointer; }
  .hud-row.clickable:hover, .hud-row.clickable:focus-visible { background: var(--chrome-brass-soft); }
  .hud-main { display: flex; flex-direction: column; gap: .1rem; flex: 1 1 auto; min-width: 0; }
  .hud-id { font-family: ${MONO_STACK}; font-size: .74rem; font-weight: 600; }
  .hud-id.spider { color: var(--taught); } .hud-id.fly { color: var(--fly); } .hud-id.egg { color: var(--muted); }
  .hud-goal { font-size: .85rem; }
  .hud-plan, .hud-belief { font-family: ${MONO_STACK}; font-size: .66rem; color: var(--muted); margin-top: .25rem; line-height: 1.4; padding-left: .5rem; border-left: 2px solid var(--chrome-brass); }
  /* the click-expand facts panel (§28): beside the clicked spider/fly's own
     row, never a separate popover or a second panel elsewhere on the page —
     the same believedCellOf/beliefSnapshotFor read path spider-fly.mjs
     already computes every tick for planning, rendered here as full
     sentences instead of the compact believes:-line above. */
  .hud-detail { flex: 1 1 auto; min-width: 0; font-family: ${MONO_STACK}; font-size: .64rem; line-height: 1.5; color: var(--chrome-well-ink); background: var(--chrome-well); border: 1px solid var(--chrome-edge-lo); box-shadow: var(--chrome-shadow-inset); border-radius: 2px; padding: .35rem .5rem; }
  .hud-detail-title { text-transform: uppercase; letter-spacing: .06em; opacity: .75; margin-bottom: .2rem; }
  /* A stat-readout track: an inset "LCD" well, filled with a segmented pip
     texture (repeating-linear-gradient) instead of a smooth gradient bar —
     discrete resource units, the same reading-at-a-glance language a 90s
     strategy game's own gold/mana meters use. */
  .mass-track { height: 7px; margin-top: .35rem; background: var(--chrome-well); border: 1px solid var(--chrome-edge-lo); box-shadow: var(--chrome-shadow-inset); border-radius: 1px; overflow: hidden; }
  .mass-fill { height: 100%; background: repeating-linear-gradient(90deg, var(--taught) 0 6px, rgba(0, 0, 0, .25) 6px 7px); }
  .mass-fill.fly { background: repeating-linear-gradient(90deg, var(--fly) 0 6px, rgba(0, 0, 0, .25) 6px 7px); }
  .hud-empty { color: var(--muted); font-size: .85rem; }
  .chatlog { display: flex; flex-direction: column; gap: .4rem; max-height: 220px; overflow-y: auto; margin-bottom: .5rem; }
  .chatlog:empty { display: none; margin-bottom: 0; }
  .chatlog .u { font-family: ${MONO_STACK}; font-size: .74rem; color: var(--muted); }
  .chatlog .u::before { content: "tmct> "; color: var(--taught); }
  .chatlog .a { font-size: .88rem; line-height: 1.4; white-space: pre-wrap; }
  .chatask { display: flex; align-items: center; gap: .5rem; border-top: 1px solid var(--chrome-edge-lo); padding-top: .5rem; }
  .chatlog:empty + .chatask { border-top: none; padding-top: 0; }
  .chatask .prompt { color: var(--taught); font-size: .78rem; font-family: ${MONO_STACK}; }
  /* An inset "command slot" — the same LCD-well treatment the turn counter
     and every live tuning readout below use, so typed input, live stats and
     the turn plaque all read as one instrument panel, not three styles. */
  .chatask input { flex: 1; font-family: ${MONO_STACK}; font-size: .78rem; background: var(--chrome-well); color: var(--chrome-well-ink); border: 1px solid var(--chrome-edge-lo); box-shadow: var(--chrome-shadow-inset); border-radius: 2px; padding: .32rem .55rem; min-width: 0; box-sizing: border-box; }
  .chatask input::placeholder { color: var(--chrome-edge-hi); opacity: .55; }
  .chatask input:disabled { opacity: .5; }
  .chatpills { display: flex; flex-wrap: wrap; gap: .3rem; margin-top: .5rem; }
  .pill { font-family: ${MONO_STACK}; font-size: .68rem; padding: .2rem .6rem; border: 1px solid var(--chrome-edge-lo); border-radius: 99px; background: var(--chrome-face); color: var(--ink); box-shadow: inset 0 1px 0 var(--chrome-edge-hi); white-space: nowrap; }
  .pill:hover:not(:disabled) { border-color: var(--chrome-brass); }
  .pill:disabled { opacity: .45; cursor: default; }
  .pill[data-role="addr"].active { border-color: var(--taught); color: var(--taught); }
  /* The dynamic deception-pill rail (§A.2.4): a true/false tag shown ONLY
     here, via border style/color and a small human-facing glyph — the
     submitted sentence itself (data-sentence, filled into #chatq on click)
     never carries the tag, so a clicked pill is indistinguishable from a
     hand-typed claim once it's in the input. */
  .dynpills { display: flex; flex-wrap: wrap; gap: .3rem; margin-top: .5rem; padding-top: .5rem; border-top: 1px solid var(--chrome-edge-lo); }
  .dynpills:empty { display: none; padding-top: 0; border-top: none; }
  .pill[data-role="dyn-addr"][data-active="1"] { border-color: var(--taught); color: var(--taught); }
  .pill[data-role="dyn-claim"][data-truth="true"] { border-color: var(--taught-t2, var(--taught)); }
  .pill[data-role="dyn-claim"][data-truth="true"]::before { content: "✓ "; opacity: .5; }
  .pill[data-role="dyn-claim"][data-truth="false"] { border-style: dashed; border-color: var(--alert); }
  .pill[data-role="dyn-claim"][data-truth="false"]::before { content: "✕ "; opacity: .6; }
  .tuning-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 1rem; }
  .tuning-col h3 { font-size: .74rem; margin: 0 0 .4rem; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; }
  .tuning-col.spider h3 { color: var(--taught); } .tuning-col.fly h3 { color: var(--fly); }
  .tuning-col label { display: block; font-size: .68rem; color: var(--muted); margin-bottom: .6rem; }
  /* Every live number on this page (this readout, the turn plaque below)
     shares the same brass-on-well "LED" treatment — one readout language,
     not a one-off flourish. */
  .tuning-col .tuning-val { font-family: ${MONO_STACK}; font-variant-numeric: tabular-nums; color: var(--chrome-well-ink); background: var(--chrome-well); border: 1px solid var(--chrome-edge-lo); box-shadow: var(--chrome-shadow-inset); border-radius: 2px; padding: 0 .35rem; float: right; }
  .tuning-col input[type="range"] {
    display: block; width: 100%; margin-top: .3rem; height: 6px; border-radius: 3px;
    background: var(--chrome-well); box-shadow: var(--chrome-shadow-inset); accent-color: var(--taught);
    -webkit-appearance: none; appearance: none;
  }
  .tuning-col.fly input[type="range"] { accent-color: var(--fly); }
  /* A lever-look thumb (a molded brass-edged cap) — appearance: none above
     drops the OS's own native slider look in browsers that honor it;
     accent-color just above is the fallback for any that don't. */
  .tuning-col input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none; width: 14px; height: 14px; border-radius: 50%; margin-top: -4px; cursor: pointer;
    background: var(--chrome-face-hi); border: 1px solid var(--chrome-edge-lo); box-shadow: var(--chrome-shadow-raised);
  }
  .tuning-col.spider input[type="range"]::-webkit-slider-thumb { border-color: var(--taught); }
  .tuning-col.fly input[type="range"]::-webkit-slider-thumb { border-color: var(--fly); }
  .tuning-col input[type="range"]::-moz-range-track { height: 6px; border-radius: 3px; background: var(--chrome-well); box-shadow: var(--chrome-shadow-inset); }
  .tuning-col input[type="range"]::-moz-range-thumb {
    width: 14px; height: 14px; border-radius: 50%; cursor: pointer; border: 1px solid var(--chrome-edge-lo);
    background: var(--chrome-face-hi); box-shadow: var(--chrome-shadow-raised);
  }
  .tuning-col.spider input[type="range"]::-moz-range-thumb { border-color: var(--taught); }
  .tuning-col.fly input[type="range"]::-moz-range-thumb { border-color: var(--fly); }
  .tuning-col input:disabled { opacity: .45; }
  .controls-row { display: flex; align-items: center; gap: .6rem; flex-wrap: wrap; }
  /* Chunky keycaps: raised by default, pressed-in on :active — the one place
     this redesign uses interaction (not animation) to sell "physical
     control panel", and it costs nothing under reduced-motion since neither
     state involves a transition, just an instant bevel swap. */
  .controls-row button { font-family: ${MONO_STACK}; font-size: .78rem; letter-spacing: .03em; text-transform: uppercase; padding: .4rem .85rem; border-radius: 2px; border: 1px solid var(--chrome-edge-lo); background: var(--chrome-face); box-shadow: var(--chrome-shadow-raised); color: var(--ink); }
  .controls-row button:hover:not(:disabled) { border-color: var(--chrome-brass); }
  .controls-row button:active:not(:disabled) { box-shadow: var(--chrome-shadow-inset); }
  .controls-row button:disabled { opacity: .4; cursor: default; box-shadow: none; }
  /* The signature element: a brass-framed digital turn counter, the same
     inset-well readout language as every stat above it — the one thing this
     page is remembered by. */
  .controls-row .turn { margin-left: auto; font-family: ${MONO_STACK}; font-size: .82rem; letter-spacing: .05em; text-transform: uppercase; font-variant-numeric: tabular-nums; color: var(--chrome-well-ink); background: var(--chrome-well); border: 1px solid var(--chrome-brass); box-shadow: var(--chrome-shadow-inset); border-radius: 2px; padding: .3rem .7rem; }
  .status { font-family: ${MONO_STACK}; font-size: .74rem; color: var(--muted); margin-top: .5rem; padding-left: .5rem; border-left: 2px solid var(--chrome-brass); }
  body.preview .side, body.preview .controls-panel, body.preview .tuning { display: none; }
  body.preview main { padding: 0; max-width: none; }
  body.preview .stage, body.preview .stage-left { display: block; }
  body.preview .board-frame { margin: 0; }
  body.preview .page-head { display: none; }
</style>
</head>
<body>
<main>
  <div class="stage page-head">
    <div class="head-inner">
      <div class="eyebrow">tmct &middot; spider and fly</div>
      <h1>Multiple competing planning agents</h1>
    </div>
    <div></div>
  </div>
  <div class="stage">
    <div class="stage-left">
    <div class="controls-panel" id="controlsPanel" aria-label="game controls">
      <div class="controls-row">
        <button id="resetBtn" type="button" disabled>reset</button>
        <button id="playBtn" type="button" disabled>&#9654; play</button>
        <button id="stepBtn" type="button" disabled>step</button>
        <span class="turn mono" id="turnLabel">turn: 0</span>
      </div>
      <div class="status" id="status">loading the engine&hellip;</div>
    </div>
    <div class="board-frame" id="boardFrame">
      <canvas id="board" width="${BOARD_PX}" height="${BOARD_PX}" aria-label="the 10x10 board"></canvas>
      <canvas id="pov" width="${BOARD_PX}" height="${BOARD_PX}" aria-hidden="true"></canvas>
      <div class="sprite-layer" id="spriteLayer"></div>
      <div class="thread-tip" id="threadTip"></div>
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
    </div>
    <aside class="side" aria-label="Chat and agents">
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
      <div class="hud">
        <h2>agents</h2>
        <div class="hud-list" id="hud"></div>
      </div>
    </aside>
  </div>
</main>
<script>
const SPIDERFLY = ${gridData};
</script>
${engineBundleJs ? `<script>\n${embedScriptText(engineBundleJs)}\n</script>` : `<script src="./spider-fly-browser.bundle.js"></script>`}
<script>
(function () {
  "use strict";
  const createTicker = ${createTicker.toString()};
  const classOfAgentId = ${classOfAgentId.toString()};
  const threadCellsForSpiderPlan = ${threadCellsForSpiderPlan.toString()};
  const facingDegreesFor = ${facingDegreesFor.toString()};
  const emotionFor = ${emotionFor.toString()};
  const nextCorpses = ${nextCorpses.toString()};
  const esc = ${escapeHtml.toString()};
  const el = (id) => document.getElementById(id);
  const boardFrame = el("boardFrame");
  const boardCanvas = el("board");
  const povCanvas = el("pov");
  const spriteLayer = el("spriteLayer");
  const threadTip = el("threadTip");
  const hudEl = el("hud");
  // Which agent ids currently show their expanded observed-facts panel —
  // survives renderHud() rebuilding the list's innerHTML every tick, since
  // that's the only way this state can persist across a full re-render.
  const expandedAgents = new Set();
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
  const emotionByAgent = {};
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
        spriteEls[id].remove(); delete spriteEls[id]; delete goalById[id]; delete facingByAgent[id]; delete emotionByAgent[id];
      }
    }
  }

  // maxMassFor/propertyFactsForAgent (emotionFor's own caller-side glue): only
  // spider/fly carry the mgx:feels parameter (data/sprites-large/*-with-
  // emotion.toml exists for those two classes only) — every other class (egg,
  // and any class this page has no template for at all) keeps propertyFacts
  // empty, resolving through its plain template exactly as before this page
  // wired emotion through. maxMassFor mirrors massBarHtml's own per-class
  // denominator below so the HUD's mass bar and the sprite's own expression
  // read the same "how full" scale.
  function maxMassFor(cls) {
    return cls === "spider" ? SPIDERFLY.maxSpiderMass : cls === "fly" ? SPIDERFLY.maxFlyMass : null;
  }
  function propertyFactsForAgent(agent, cls) {
    if (cls !== "spider" && cls !== "fly") return [];
    return [{ predicate: "mgx:feels", object: emotionFor(agent, cls, maxMassFor(cls)) }];
  }
  function resolveSpriteFace(cls, propertyFacts) {
    return window.tmctSpiderFly
      ? tmctSpiderFly.resolveSpriteAsset(cls, (session && session.taxonomyRows) || [], propertyFacts, SPIDERFLY.spriteTemplates, tmctSpiderFly.SPRITE_REGISTRY)
      : "";
  }

  function togglePov(id) {
    povAgentId = povAgentId === id ? null : id;
    if (!povAgentId) for (const node of Object.values(spriteEls)) node.classList.remove("dimmed");
    drawPov();
  }
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && povAgentId) togglePov(povAgentId);
  });

  function ensureSpriteEl(id, cls, agent) {
    let node = spriteEls[id];
    if (node) return node;
    node = document.createElement("div");
    node.className = "sprite";
    node.dataset.cls = cls;
    // Property-aware resolution (sprite-templates.mjs's resolveSpriteAsset):
    // a spider/fly's live mgx:feels emotion (emotionFor, above) resolves it
    // through the matching data/sprites-large/*-with-emotion.toml template;
    // every other class (egg) keeps propertyFacts empty and resolves through
    // its plain class template (or the flat SPRITE_REGISTRY), unchanged.
    const propertyFacts = propertyFactsForAgent(agent, cls);
    emotionByAgent[id] = propertyFacts[0] ? propertyFacts[0].object : null;
    // The sprite SVG lives in its own inner wrapper so plan-driven facing
    // (a CSS rotate on THIS wrapper) never fights the outer .sprite node's
    // own translate(-50%,-50%) positioning transform.
    const face = document.createElement("div");
    face.className = "sprite-face";
    face.innerHTML = resolveSpriteFace(cls, propertyFacts);
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
      const node = ensureSpriteEl(id, cls, a);
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
      if (face) {
        face.style.transform = "rotate(" + facingByAgent[id] + "deg)";
        // Emotion changes tick-to-tick (a fly's fear spikes the instant a
        // spider comes into view, a spider's joy fires the instant it eats),
        // so this must re-resolve every redraw, not just at sprite creation —
        // but only actually replace the DOM when the emotion word itself
        // changed since last render, never on every tick regardless.
        const propertyFacts = propertyFactsForAgent(a, cls);
        const emotion = propertyFacts[0] ? propertyFacts[0].object : null;
        if (emotion !== emotionByAgent[id]) {
          emotionByAgent[id] = emotion;
          face.innerHTML = resolveSpriteFace(cls, propertyFacts);
        }
      }
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
        // A corpse's expression is frozen — never re-resolved on later
        // redraws (there's no more agent state to derive one from), and
        // never emotion-parameterized at all (a rotting carcass has none),
        // just its class's own plain template under the grayscale/fade the
        // .sprite.corpse CSS rule already applies.
        face.innerHTML = resolveSpriteFace(corpse.cls, []);
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

  // The full text rendering behind the click-expand panel: one sentence per
  // other candidate the observer currently has a belief about, or "has not
  // been observed" for a candidate it doesn't — the same belief map
  // beliefLineHtml already compresses into a single line, spelled out in
  // full beside the clicked agent instead of abbreviated above it.
  function observedFactsHtml(observerId, belief) {
    const entries = Object.entries(belief || {});
    const lines = entries.length
      ? entries.map(([id, cell]) => '<div class="hud-detail-line">'
          + (cell ? esc(id) + " is at " + esc(cell) + "." : esc(id) + " has not been observed.")
          + "</div>").join("")
      : '<div class="hud-detail-line">nothing else is on the board yet.</div>';
    return '<div class="hud-detail"><div class="hud-detail-title">' + esc(observerId) + " observes</div>" + lines + "</div>";
  }

  function renderHud() {
    const ids = Object.keys(lastAgents).sort();
    if (!ids.length) { hudEl.innerHTML = '<div class="hud-empty">no agents on the board.</div>'; return; }
    hudEl.innerHTML = ids.map((id) => {
      const cls = classOfAgentId(id);
      const a = lastAgents[id];
      const clickable = cls === "spider" || cls === "fly";
      const expanded = clickable && expandedAgents.has(id);
      const main = '<div class="hud-main"><span class="hud-id ' + esc(cls) + '">' + esc(id) + '</span>'
        + '<span class="hud-goal">' + esc(goalById[id] || "watching\\u2026") + "</span>"
        + massBarHtml(cls, a.mass)
        + planLineHtml(a.plan)
        + beliefLineHtml(a.belief)
        + "</div>";
      const attrs = clickable ? ' role="button" tabindex="0" aria-expanded="' + (expanded ? "true" : "false") + '"' : "";
      return '<div class="hud-row' + (clickable ? " clickable" : "") + '" data-agent-id="' + esc(id) + '"' + attrs + '>'
        + main + (expanded ? observedFactsHtml(id, a.belief) : "")
        + "</div>";
    }).join("");
  }

  function toggleAgentExpansion(id) {
    if (!id) return;
    if (expandedAgents.has(id)) expandedAgents.delete(id); else expandedAgents.add(id);
    renderHud();
  }
  hudEl.addEventListener("click", (event) => {
    const row = event.target.closest(".hud-row.clickable");
    if (row) toggleAgentExpansion(row.dataset.agentId);
  });
  hudEl.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const row = event.target.closest(".hud-row.clickable");
    if (!row) return;
    event.preventDefault();
    toggleAgentExpansion(row.dataset.agentId);
  });

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
