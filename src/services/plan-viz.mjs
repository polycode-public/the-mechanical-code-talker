// plan-viz.mjs — renders a computed plan (result.plan from the chat plan lane)
// as a self-contained, animated HTML page: the "blocks" archetype.
//
// A pure layout step (computeBlocksLayout), a pure page-data reducer
// (planToPageData) and a pure string builder (renderPlanHtml). No I/O here —
// callers pass the plan, the class→archetype map (rendersAs), and the
// size-order pairs; both derive from fact rows at wiring time.
//
// The page ships as a HYBRID, on purpose: the initial board/movelist/PDDL
// panel are baked in at render time exactly as before (so a plain
// `renderPlanHtml({ plan, ... })` call, with no live bundle anywhere nearby,
// still produces a fully working replay — the CLI's own `--render blocks`
// output, and every existing test, keep working unchanged), while an
// optional sibling `./plan-browser.bundle.js` (built by
// scripts/build-plan-bundle.mjs, wired in by scripts/build-demo-site.mjs)
// layers live re-solving on top: disk-count/max-depth controls and a
// chat-assert dock that can mount a FRESH plan without a page reload. The
// inline script degrades honestly when that sibling script is absent or
// fails to load — the live controls disable themselves rather than pretend
// to work.
import { THEME_TOKENS_CSS, SERIF_STACK, MONO_STACK, escapeHtml, embedJson, countLabel, demoEyebrowHtml, EYEBROW_LINKS_CSS } from "./viz-theme.mjs";
import { planToPddl } from "./plan-pddl.mjs";

const BOARD_W = 640;
const BOARD_H = 260;
const BASE_Y = BOARD_H - 28;
const BLOCK_H = 26;
const BLOCK_GAP = 3;
const BASE_W = 64;
const STEP_W = 33;
const LIFT_Y = 36;

// One stable hue per block class (viz's one-hue-per-class rule); shades within
// a class darken with size rank.
const CLASS_HUES = ["#5A80AC", "#8A6E4E", "#5E8A4E", "#8A4E6E", "#4E8A86"];

function darken(hex, fraction) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v) => Math.max(0, Math.round(v * (1 - fraction)));
  const r = ch((n >> 16) & 255);
  const g = ch((n >> 8) & 255);
  const b = ch(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** Topological rank over [smaller, larger] pairs, label tiebreak; members
 *  absent from every pair are appended in label order. `sized` names the members
 *  a pair actually ordered — the appended rest carry a rank so they can be drawn,
 *  which says nothing about their size. */
function rankBySize(sizeOrder, members) {
  const pairs = Array.isArray(sizeOrder) ? sizeOrder : [];
  const inPairs = new Set();
  const after = new Map(); // smaller -> Set(larger)
  const indegree = new Map();
  for (const [small, large] of pairs) {
    if (!small || !large) continue;
    inPairs.add(small); inPairs.add(large);
    if (!after.has(small)) after.set(small, new Set());
    if (!after.get(small).has(large)) {
      after.get(small).add(large);
      indegree.set(large, (indegree.get(large) || 0) + 1);
    }
    if (!indegree.has(small)) indegree.set(small, indegree.get(small) || 0);
  }
  const ranks = {};
  let next = 0;
  let ready = [...inPairs].filter((t) => (indegree.get(t) || 0) === 0).sort();
  const seen = new Set();
  while (ready.length) {
    const term = ready.shift();
    if (seen.has(term)) continue;
    seen.add(term);
    ranks[term] = next++;
    for (const larger of [...(after.get(term) || [])].sort()) {
      indegree.set(larger, indegree.get(larger) - 1);
      if (indegree.get(larger) === 0) ready.push(larger);
    }
    ready.sort();
  }
  const sized = new Set(Object.keys(ranks));
  for (const m of [...members].sort()) {
    if (!(m in ranks)) ranks[m] = next++;
  }
  return { ranks, sized };
}

/** Every label the plan itself names — across its states and its actions. The
 *  board's undeclared anchors are drawn from this rather than from the whole
 *  domain, which is the entire memory. */
function namesInPlan(plan) {
  const named = new Set();
  for (const rows of plan?.states || []) {
    for (const r of rows || []) {
      if (r?.subject != null) named.add(r.subject);
      if (r?.object != null) named.add(r.object);
    }
  }
  for (const a of plan?.actions || []) {
    if (a?.subject != null) named.add(a.subject);
    if (a?.target != null) named.add(a.target);
  }
  return named;
}

/**
 * Pure geometry for the blocks archetype.
 *
 * plan:      { states: [[{subject, predicate, object}], …], domain: { classMembers } }
 * rendersAs: { className: "block" | "slot" } — classes absent from the map
 *            fall back to labeled circles, and contribute only the members the
 *            plan names (see the loop below: the domain is the whole memory).
 * sizeOrder: [[smallerLabel, largerLabel], …]
 *
 * Returns { board, ranks, anchors, snapshots: [{ items, stacks }] } —
 * deterministic for identical inputs.
 */
export function computeBlocksLayout({ plan, rendersAs = {}, sizeOrder = [] }) {
  const classMembers = plan?.domain?.classMembers || {};
  const classes = Object.keys(classMembers).sort();
  const named = namesInPlan(plan);
  const blockSet = new Set();
  const anchorDefs = [];
  const classHue = {};
  let hueIndex = 0;
  for (const cls of classes) {
    const archetype = rendersAs[cls];
    const members = [...(classMembers[cls] || [])].sort();
    if (archetype === "block") {
      classHue[cls] = CLASS_HUES[hueIndex++ % CLASS_HUES.length];
      for (const m of members) blockSet.add(m);
    } else {
      const kind = archetype === "slot" ? "slot" : "circle";
      // A DECLARED class is the board's own furniture: every member is drawn,
      // empty or not (an unused peg is still a peg). An UNDECLARED class only
      // falls back to circles, and the domain it comes from is the whole
      // memory, not just this puzzle — one that has been taught a vocabulary
      // carries hundreds of individuals that have nothing to do with the game.
      // Drawing those puts every noun the memory knows on the board, which
      // squeezes the real anchors into a few pixels at the left edge. So an
      // undeclared class contributes only what the plan actually names.
      for (const m of members) {
        if (!archetype && !named.has(m)) continue;
        anchorDefs.push({ id: m, kind });
      }
    }
  }
  anchorDefs.sort((a, b) => (a.kind === b.kind ? (a.id < b.id ? -1 : 1) : a.kind === "slot" ? -1 : 1));
  const anchors = anchorDefs.map((a, i) => ({
    ...a,
    x: Math.round((BOARD_W * (2 * i + 1)) / (2 * anchorDefs.length)),
    y: BASE_Y,
  }));
  const anchorX = new Map(anchors.map((a) => [a.id, a.x]));

  const blocks = [...blockSet].sort();
  const { ranks, sized } = rankBySize(sizeOrder, blocks);
  const maxRank = blocks.reduce((m, b) => Math.max(m, ranks[b] ?? 0), 0);
  const blockClassOf = (label) =>
    classes.find((cls) => rendersAs[cls] === "block" && (classMembers[cls] || []).includes(label));
  const widthOf = (label) => BASE_W + (ranks[label] ?? 0) * STEP_W;
  const fillOf = (label) => {
    const hue = classHue[blockClassOf(label)] || CLASS_HUES[0];
    const f = maxRank > 0 ? ((ranks[label] ?? 0) / (maxRank + 1)) * 0.45 : 0;
    return darken(hue, f);
  };

  const snapshots = (plan?.states || []).map((rows) => {
    const restingOn = new Map(); // object -> every subject resting directly on it
    for (const r of [...rows].sort((a, b) => (a.subject < b.subject ? -1 : 1))) {
      if (!blockSet.has(r.subject)) continue;
      if (!restingOn.has(r.object)) restingOn.set(r.object, []);
      const above = restingOn.get(r.object);
      if (!above.includes(r.subject)) above.push(r.subject);
    }
    const stacks = {};
    const items = anchors.map((a) => ({ ...a }));
    for (const a of anchors) {
      const stack = [];
      const placed = new Set();
      const pileOnto = (support) => {
        for (const label of [...(restingOn.get(support) || [])].sort()) {
          if (placed.has(label)) continue;
          placed.add(label);
          stack.push(label);
          pileOnto(label);
        }
      };
      pileOnto(a.id);
      stacks[a.id] = stack;
      stack.forEach((label, i) => {
        const w = widthOf(label);
        items.push({
          id: label,
          kind: "block",
          x: a.x - Math.round(w / 2),
          y: BASE_Y - (i + 1) * (BLOCK_H + BLOCK_GAP),
          w,
          h: BLOCK_H,
          rank: ranks[label] ?? 0,
          fill: fillOf(label),
        });
      });
    }
    items.sort((a, b) => (a.id < b.id ? -1 : 1));
    return { items, stacks };
  });

  return { board: { w: BOARD_W, h: BOARD_H }, ranks, sized, anchors, snapshots };
}

/** Phase brackets from the largest block's single move: everything before it
 *  frees the piece, the move itself is the pivot, the rest rebuilds. */
function phasesFor(actions, ranks, sized) {
  // free-it / move-it / rebuild-on-it describes ONE shape: a puzzle whose biggest
  // piece is declared biggest and travels once, everything before clearing its way
  // and everything after stacking back on top. Hanoi is that shape. A puzzle that
  // declares no sizes has no biggest piece to pivot on — rankBySize ranks its
  // pieces by label so they can be drawn, and reading a pivot out of that ordering
  // names an arbitrary piece. Say nothing rather than something arbitrary.
  const ordered = [...(sized || [])];
  if (!ordered.length || !actions.length) return [];
  const pivot = ordered.reduce((a, b) => (ranks[a] >= ranks[b] ? a : b));
  const moves = actions.filter((a) => a.subject === pivot);
  if (moves.length !== 1) return []; // travels more than once — not this shape
  const k = actions.indexOf(moves[0]);
  if (k <= 0 || k >= actions.length - 1) return [];
  return [
    { label: `free ${pivot}`, from: 0, to: k },
    { label: "the pivot", from: k, to: k + 1 },
    { label: `rebuild on ${pivot}`, from: k + 1, to: actions.length },
  ];
}

const displayPredicate = (p) => String(p).replace(/^mgx:/, "").replace(/-/g, " ");

/** The board/movelist page data a rendered plan page embeds — one board
 *  layout snapshot per plan.states entry, plus the labels/goal-lines/facts
 *  text the movelist and facts strip read. Pure; the same shape whether
 *  computed at render time (the initial embed) or live in the browser after
 *  a re-solve (plan-browser-entry.mjs re-exports this for that reason). */
export function planToPageData({ plan, rendersAs = {}, sizeOrder = [] } = {}) {
  const actions = plan?.actions || [];
  const layout = computeBlocksLayout({ plan, rendersAs, sizeOrder });
  const stepGoals =
    Array.isArray(plan?.stepGoals) && plan.stepGoals.length === actions.length
      ? plan.stepGoals
      : null;
  const labels = actions.map((a) => a.label || `move ${a.subject} onto ${a.target}`);
  const factsPerStep = (plan?.states || []).map((rows) =>
    [...rows]
      .map((r) => `${r.subject} ${displayPredicate(r.predicate)} ${r.object}`)
      .sort(),
  );
  return {
    actions,
    labels,
    stepGoals,
    goalText: plan?.goal?.text || "",
    layouts: layout.snapshots,
    anchors: layout.anchors,
    board: layout.board,
    facts: factsPerStep,
    phases: phasesFor(actions, layout.ranks, layout.sized),
  };
}

/** `{ rendersAs, sizeOrder }` derived straight from a solved plan's own
 *  `domain.renderHints`/`domain.ordering` — the same derivation bin/tmct.mjs's
 *  `--render blocks` step does, factored out so the live re-solve path
 *  (plan-browser-entry.mjs) never has to duplicate it. */
export function renderInputsFromPlan(plan) {
  const rendersAs = plan?.domain?.renderHints ?? {};
  const sizeOrder = (plan?.domain?.ordering ?? [])
    .filter((row) => /-than$/.test(String(row.predicate || "")))
    .map((row) => [row.subject, row.object]);
  return { rendersAs, sizeOrder };
}

/**
 * The self-contained plan page. Consumes the plan-lane contract
 * ({actions, states, stepGoals, goal, domain}) plus the render inputs.
 */
export function renderPlanHtml({ plan, rendersAs = {}, sizeOrder = [], title } = {}) {
  const actions = plan?.actions || [];
  const pageData = planToPageData({ plan, rendersAs, sizeOrder });
  const embedded = embedJson(pageData);
  const pddlText = planToPddl(plan);
  const pageTitle = title || `tmct plan — ${countLabel(actions.length, "move")}`;

  return `<!doctype html>
<!-- data-theme is pinned to dark on purpose: this page reads as a track/
     timeline console, and that console stays dark under a light OS or site
     theme too, the same way a DAW's own window does. -->
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(pageTitle)}</title>
<link rel="icon" href="./favicon.svg" type="image/svg+xml">
<link rel="icon" href="./favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="./apple-touch-icon.png">
<!--
  The wink lemma/POS tier loads from ./vendor/wink.js — the site's own shared
  first-party bundle of wink-nlp + wink-eng-lite-web-model (built by
  scripts/build-wink-vendor.mjs), one cached copy shared with chat.html and
  ledger.html, no CDN. The bundle itself (./plan-browser.bundle.js) never
  touches wink directly — wink-model.mjs's own header explains why a static
  import would drag the ~1 MB model into every bundle; only the page's own
  inline script performs the import, the same bounded-race tryLoadWink()
  pattern public/tmct-browser.mjs uses, and a failed load degrades to the
  curated + fuzzy tiers, never an error.
-->
<style>
${THEME_TOKENS_CSS}
/* This console stays dark under either site theme (the html tag pins
   data-theme="dark" above), so these extra surfaces are plain literals
   rather than theme-reactive tokens — a track console has one lighting
   rig, not two. --taught/--corpus/--entail/--alert still come from
   THEME_TOKENS_CSS above and still carry the site's own provenance
   language: taught (green) marks the actual current position, entail
   (amber) marks tmct's own inferred step goal, corpus (blue) marks a
   session parameter, alert (red) marks a failed solve. */
:root {
  --rail: #101317; --well: #0A0C0E; --strip: #1A1F25; --strip2: #20262D;
  --taught-glow: rgba(95, 190, 139, .45); --entail-glow: rgba(217, 165, 84, .4);
}
html { background: var(--rail); }
body { margin: 0; background: var(--rail); color: var(--ink); font-family: ${MONO_STACK}; font-size: 14px; }
main { max-width: 1040px; margin: 0 auto; padding: 1.3rem 1rem 3rem; }
button { font: inherit; }

.rack { border: 1px solid var(--line); background: var(--card); }

/* ---- head strip: the nameplate ---- */
.headStrip { display: flex; justify-content: space-between; align-items: flex-end; gap: .6rem; flex-wrap: wrap; padding: .9rem 1.1rem .75rem; background: linear-gradient(180deg, var(--strip2), var(--strip)); border-bottom: 1px solid var(--line); border-radius: 9px 9px 0 0; }
.eyebrow { font-family: ${MONO_STACK}; font-size: .64rem; letter-spacing: .16em; text-transform: uppercase; color: var(--muted); margin: 0 0 .35rem; }
${EYEBROW_LINKS_CSS}
h1 { font-family: ${SERIF_STACK}; font-size: 1.2rem; font-weight: 600; margin: 0; color: var(--ink); }
.chip { font-family: ${MONO_STACK}; font-size: .64rem; letter-spacing: .02em; color: var(--muted); border: 1px solid var(--line); border-radius: 3px; padding: .22rem .6rem; background: var(--well); text-align: right; }

/* ---- session strip: a channel-strip row of solve parameters ---- */
.sessionStrip { display: flex; align-items: stretch; flex-wrap: wrap; background: var(--strip); border-bottom: 1px solid var(--line); font-family: ${MONO_STACK}; font-size: .74rem; }
.sessionCell { display: flex; flex-direction: column; justify-content: center; gap: .3rem; padding: .55rem .95rem; border-right: 1px solid var(--line); }
.paramLabel { font-size: .6rem; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); }
.sessionStrip input[type="number"] { width: 3.6rem; font-family: ${MONO_STACK}; font-size: .78rem; background: var(--well); color: var(--taught); border: 1px solid var(--line); border-radius: 4px; padding: .22rem .4rem; font-variant-numeric: tabular-nums; }
.sessionAction { justify-content: center; }
.sessionAction button { font-family: ${MONO_STACK}; font-size: .74rem; padding: .4rem .85rem; border-radius: 5px; border: 1px solid var(--line); background: var(--well); color: var(--ink); cursor: pointer; }
.sessionAction button:hover:not(:disabled) { border-color: var(--corpus); color: var(--corpus); }
.sessionAction button:focus-visible { outline: 2px solid var(--corpus); outline-offset: 2px; }
.sessionAction button:disabled { opacity: .4; cursor: default; }
.sessionStatus { display: flex; align-items: center; margin-left: auto; padding: 0 .95rem; color: var(--muted); }
.sessionStatus.isError { color: var(--alert); }

/* ---- transport bar ---- */
.transport { display: flex; align-items: center; gap: 1rem; flex-wrap: wrap; padding: .7rem 1.1rem; background: var(--rail); border-bottom: 1px solid var(--line); }
.transportButtons { display: flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.transportButtons button { font-family: ${MONO_STACK}; font-size: .78rem; padding: .48rem .8rem; border: none; border-right: 1px solid var(--line); background: var(--strip); color: var(--ink); cursor: pointer; }
.transportButtons button:last-child { border-right: none; }
.transportButtons button:hover:not(:disabled) { background: var(--strip2); }
.transportButtons button:focus-visible { outline: 2px solid var(--taught); outline-offset: -2px; }
.transportButtons button[disabled] { opacity: .35; cursor: default; }
.transportButtons #play.isPlaying { background: var(--taught-soft); color: var(--taught); }
.lcd { margin-left: auto; background: var(--well); border: 1px solid var(--line); border-radius: 6px; padding: .45rem .75rem; min-width: 10rem; }
#stepLabel { display: block; font-family: ${MONO_STACK}; font-size: 1rem; letter-spacing: .03em; color: var(--taught); text-shadow: 0 0 8px var(--taught-glow); font-variant-numeric: tabular-nums; white-space: nowrap; }
.lcdMeter { margin-top: .3rem; height: 3px; background: var(--line); border-radius: 2px; overflow: hidden; }
.lcdMeterFill { height: 100%; width: 0%; background: var(--taught); box-shadow: 0 0 6px var(--taught-glow); transition: width .18s ease; }

/* ---- the deck: board on the left, arrangement view on the right ---- */
.stage { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 0; }
/* grid items refuse to shrink below their content's min-width by default, so
   the 640px board would stretch the track and the whole page with it on a
   phone — let the items shrink and the boardwrap scroll instead. */
.stage > * { min-width: 0; }
.deck { padding: 1rem 1.1rem 1.1rem; border-right: 1px solid var(--line); }
@media (max-width: 660px) { .stage { grid-template-columns: 1fr; } .deck { border-right: none; border-bottom: 1px solid var(--line); } }
.boardwrap { overflow-x: auto; }
.board { position: relative; width: ${BOARD_W}px; height: ${BOARD_H}px; background: var(--well); border: 1px solid var(--line); border-radius: 6px; }
.base { position: absolute; left: 4%; right: 4%; bottom: 22px; height: 6px; background: var(--line); border-radius: 3px; }
.post { position: absolute; bottom: 28px; width: 6px; height: 150px; background: var(--line); border-radius: 3px 3px 0 0; }
.anchorlabel { position: absolute; bottom: 2px; transform: translateX(-50%); font-family: ${MONO_STACK}; font-size: .64rem; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
.block { position: absolute; height: ${BLOCK_H}px; border-radius: 4px; color: #fff; display: flex; align-items: center; justify-content: center; font-family: ${MONO_STACK}; font-size: .64rem; font-weight: 600; box-shadow: inset 0 1px 0 rgba(255,255,255,.1), 0 2px 4px rgba(0,0,0,.4); }
.block.moving { z-index: 3; box-shadow: 0 0 0 2px var(--taught), 0 6px 14px rgba(0,0,0,.5); }
.circle { position: absolute; width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--muted); transform: translate(-50%, -100%); }
.circlelabel { position: absolute; transform: translateX(-50%); font-family: ${MONO_STACK}; font-size: .6rem; color: var(--muted); }
.goalline { margin-top: .8rem; font-family: ${MONO_STACK}; font-size: .76rem; color: var(--entail); background: var(--entail-soft); border: 1px solid var(--entail); border-radius: 6px; padding: .5rem .75rem; }
.facts { margin-top: .7rem; font-family: ${MONO_STACK}; font-size: .68rem; color: var(--muted); border-top: 1px dashed var(--line); padding-top: .55rem; line-height: 1.7; }
.facts b { color: var(--ink); }
.movelist { list-style: none; margin: 0; padding: .5rem; font-family: ${MONO_STACK}; font-size: .72rem; align-self: start; }
.movelist .phasehead { display: block; background: var(--strip); border: 1px solid var(--line); border-left: 3px solid var(--corpus); border-radius: 4px; padding: .35rem .55rem; margin: .55rem 0 .3rem; font-size: .62rem; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); cursor: pointer; }
.movelist .phasehead:first-child { margin-top: 0; }
.movelist .phasehead:hover { color: var(--ink); border-left-color: var(--taught); }
.movelist .phasehead:focus-visible { outline: 2px solid var(--taught); outline-offset: 2px; }
.movelist li:not(.phasehead) { padding: .38rem .55rem; margin: .12rem 0; border: 1px solid transparent; border-radius: 4px; color: var(--muted); cursor: pointer; font-variant-numeric: tabular-nums; opacity: .55; }
.movelist li:not(.phasehead):hover { color: var(--ink); border-color: var(--line); opacity: 1; }
.movelist li.done { color: var(--ink); background: var(--strip); opacity: 1; }
.movelist li.current { color: var(--ink); background: var(--taught-soft); border-color: var(--taught); box-shadow: inset 3px 0 0 var(--taught); font-weight: 700; opacity: 1; }
@media (prefers-reduced-motion: reduce) { .block, .lcdMeterFill { transition: none !important; } }

/* ---- lower rack: two channel strips, teach dock and PDDL artifact ---- */
.lower { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 0; border-top: 1px solid var(--line); }
@media (max-width: 780px) { .lower { grid-template-columns: 1fr; } }
.chat, .pddlpanel { background: var(--card); padding: .65rem .8rem; min-width: 0; }
.chat { border-right: 1px solid var(--line); }
@media (max-width: 780px) { .chat { border-right: none; border-bottom: 1px solid var(--line); } }
.chat h2, .pddlpanel h2 { font-family: ${MONO_STACK}; font-size: .64rem; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); font-weight: 400; margin: 0 0 .5rem; }
.chatlog { display: flex; flex-direction: column; gap: .4rem; max-height: 180px; overflow-y: auto; margin-bottom: .5rem; }
.chatlog:empty { display: none; margin-bottom: 0; }
.chatlog .u { font-family: ${MONO_STACK}; font-size: .74rem; color: var(--muted); }
.chatlog .u::before { content: "tmct> "; color: var(--taught); }
.chatlog .b { font-family: ${MONO_STACK}; font-size: .74rem; color: var(--muted); }
.chatlog .b::before { content: "board> "; color: var(--corpus); }
.chatlog .a { font-family: ${SERIF_STACK}; font-size: .87rem; line-height: 1.45; white-space: pre-wrap; color: var(--ink); }
.chatask { display: flex; align-items: center; gap: .5rem; border-top: 1px solid var(--line); padding-top: .5rem; }
.chatlog:empty + .chatask { border-top: none; padding-top: 0; }
.chatask .prompt { color: var(--taught); font-size: .78rem; font-family: ${MONO_STACK}; }
.chatask input { flex: 1; font-family: ${MONO_STACK}; font-size: .78rem; background: var(--well); color: var(--ink); border: 1px solid var(--line); border-radius: 4px; padding: .34rem .55rem; min-width: 0; }
.chatask input:focus-visible { outline: 2px solid var(--taught); outline-offset: 2px; }
.chatpills { display: flex; flex-wrap: wrap; gap: .3rem; margin-top: .5rem; }
.boardask { margin-top: .75rem; border-top: 1px dashed var(--line); padding-top: .55rem; }
.boardask h3 { font-family: ${MONO_STACK}; font-size: .6rem; letter-spacing: .1em; text-transform: uppercase; color: var(--muted); font-weight: 400; margin: 0 0 .45rem; }
.boardask .chatask { border-top: none; padding-top: 0; }
.boardask .prompt { color: var(--corpus); }
.boardask input:focus-visible { outline-color: var(--corpus); }
.boardask .pill:hover { border-color: var(--corpus); color: var(--corpus); }
.pill { font-family: ${MONO_STACK}; font-size: .66rem; padding: .22rem .6rem; border: 1px solid var(--line); border-radius: 99px; background: var(--well); color: var(--ink); cursor: pointer; white-space: nowrap; }
.pill:hover { border-color: var(--taught); color: var(--taught); }
.pill:focus-visible { outline: 2px solid var(--taught); outline-offset: 2px; }
.pddlpanel pre { margin: 0; font-family: ${MONO_STACK}; font-size: .67rem; line-height: 1.55; white-space: pre-wrap; word-break: break-word; max-height: 420px; overflow-y: auto; color: var(--ink); background: var(--well); border: 1px solid var(--line); border-radius: 4px; padding: .6rem .7rem; }
</style>
</head>
<body>
<main>
<div class="rack">
  <div class="headStrip">
    <div>
      <div class="eyebrow">${demoEyebrowHtml("plan", "plan")}</div>
      <h1 id="pageTitle">${escapeHtml(pageTitle)}</h1>
    </div>
    <span class="chip">blocks archetype · ${pageData.layouts.length} snapshots · plan: findActionPath</span>
  </div>
  <div class="sessionStrip" id="liveControls">
    <label class="sessionCell" for="diskCount"><span class="paramLabel">disks</span><input id="diskCount" type="number" min="1" max="7" value="3"></label>
    <label class="sessionCell" for="maxDepth"><span class="paramLabel">max depth</span><input id="maxDepth" type="number" min="1" max="999" value="300"></label>
    <div class="sessionCell sessionAction"><button id="resolveBtn" type="button">solve a fresh puzzle</button></div>
    <span class="sessionStatus" id="liveStatus"></span>
  </div>
  <div class="transport">
    <div class="transportButtons">
      <button id="reset" aria-label="Reset to start">⏮ reset</button>
      <button id="back" aria-label="Step back">◀ back</button>
      <button id="play" aria-label="Play">▶ play</button>
      <button id="next" aria-label="Step forward">step ▶</button>
    </div>
    <div class="lcd">
      <span id="stepLabel"></span>
      <div class="lcdMeter"><div class="lcdMeterFill" id="stepMeter"></div></div>
    </div>
  </div>
  <div class="stage">
    <div class="deck">
      <div class="boardwrap"><div class="board" id="board" aria-label="plan board"></div></div>
      <div class="goalline" id="goalline" hidden></div>
      <div class="facts" id="facts"></div>
    </div>
    <ol class="movelist" id="movelist"></ol>
  </div>
  <div class="lower">
    <div class="chat">
      <h2>teach it something, then ask it to solve again</h2>
      <div class="chatlog" id="chatlog" aria-live="polite"></div>
      <form class="chatask" id="chatform">
        <span class="prompt">tmct&gt;</span>
        <input id="chatq" type="text" placeholder="disk-1 is smaller than disk-4." aria-label="Teach a fact, or ask it to solve">
      </form>
      <div class="chatpills" id="chatpills" role="group" aria-label="quick phrases to fill the chat input">
        <button type="button" class="pill" data-fill="solve it.">solve it</button>
        <button type="button" class="pill" data-fill="what moves are legal now?">what moves are legal now?</button>
      </div>
      <div class="boardask">
        <h3>ask the board at this step</h3>
        <form class="chatask" id="boardform">
          <span class="prompt">board&gt;</span>
          <input id="boardq" type="text" placeholder="list the locations of disks" aria-label="Ask a question about the board at the current step">
        </form>
        <div class="chatpills" id="boardpills" role="group" aria-label="quick phrases to fill the board question input">
          <button type="button" class="pill" data-fill="list the locations of disks">list the locations of disks</button>
          <button type="button" class="pill" data-fill="how many moves are there?">how many moves are there?</button>
          <button type="button" class="pill" data-fill="list the pegs">list the pegs</button>
        </div>
      </div>
    </div>
    <div class="pddlpanel">
      <h2>PDDL + OWL/RDF plan artifact</h2>
      <pre id="pddlOut">${escapeHtml(pddlText)}</pre>
    </div>
  </div>
</div>
</main>
<script>
const PLAN = ${embedded};
</script>
<script src="./plan-browser.bundle.js"></script>
<script>
(function () {
  "use strict";
  const escapeHtml = ${escapeHtml.toString()};
  const countLabel = ${countLabel.toString()};
  // Best-effort: a copy of this page opened without the sibling worker file
  // (a tmct --render plan --output file, a file:// open) just swallows the
  // registration failure and works exactly as before.
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./tmct-sw.js").catch(() => {});
  const pageTitleEl = document.getElementById("pageTitle");
  const board = document.getElementById("board");
  const stepLabel = document.getElementById("stepLabel");
  const stepMeterEl = document.getElementById("stepMeter");
  const goalline = document.getElementById("goalline");
  const factsEl = document.getElementById("facts");
  const movelist = document.getElementById("movelist");
  const pddlEl = document.getElementById("pddlOut");
  const btn = {
    reset: document.getElementById("reset"), back: document.getElementById("back"),
    play: document.getElementById("play"), next: document.getElementById("next"),
  };
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- the board/movelist renderer: a live re-solve calls mountPlan(data)
  // again with a FRESH page-data object (planToPageData's own shape), so
  // every closure below reads the mutable "plan" binding, never the
  // top-level immutable PLAN constant (which stays exactly the initial
  // server-rendered embed, for a plain renderPlanHtml() caller with no live
  // bundle nearby).
  let plan = null, N = 0, blockEls = {}, step = 0, playing = false, animating = false;

  const posIn = (snap, id) => snap.items.find((i) => i.id === id && i.kind === "block");
  function drawState(i) {
    for (const id of Object.keys(blockEls)) {
      const p = posIn(plan.layouts[i], id);
      if (!p) continue;
      blockEls[id].style.transition = "none";
      blockEls[id].style.left = p.x + "px";
      blockEls[id].style.top = p.y + "px";
    }
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function animateMove(i) {
    const before = plan.layouts[i], after = plan.layouts[i + 1];
    const movers = Object.keys(blockEls).filter((id) => {
      const a = posIn(before, id), b = posIn(after, id);
      return a && b && (a.x !== b.x || a.y !== b.y);
    });
    if (reduced || movers.length === 0) { drawState(i + 1); return; }
    // A step can move several pieces at once (a carrier plus its passengers).
    // Only pieces that change column actually travel; a piece whose column is
    // unchanged is settling into the gap a departing piece left, so it drops
    // in place rather than miming the journey.
    const travellers = movers.filter((id) => posIn(before, id).x !== posIn(after, id).x);
    const settlers = movers.filter((id) => posIn(before, id).x === posIn(after, id).x);
    animating = true;
    // Each traveller rides its own lane so pieces crossing together stay
    // legible instead of stacking up on one another mid-air.
    const riders = travellers.map((id, lane) => ({
      el: blockEls[id],
      to: posIn(after, id),
      liftY: ${LIFT_Y} - lane * ${BLOCK_H + BLOCK_GAP},
    }));
    for (const r of riders) r.el.classList.add("moving");
    for (const r of riders) { r.el.style.transition = "top .18s ease-in"; r.el.style.top = r.liftY + "px"; }
    await wait(190);
    for (const id of settlers) {
      const el = blockEls[id];
      el.style.transition = "top .2s ease-in-out"; el.style.top = posIn(after, id).y + "px";
    }
    for (const r of riders) { r.el.style.transition = "left .26s ease-in-out"; r.el.style.left = r.to.x + "px"; }
    await wait(270);
    for (const r of riders) { r.el.style.transition = "top .18s ease-out"; r.el.style.top = r.to.y + "px"; }
    await wait(200);
    for (const r of riders) r.el.classList.remove("moving");
    drawState(i + 1);
    animating = false;
  }
  const phaseFor = (i) => {
    if (i >= N) return "done";
    const ph = plan.phases.find((p) => i >= p.from && i < p.to);
    return ph ? ph.label : "";
  };
  function render() {
    const phase = phaseFor(step);
    stepLabel.textContent = "step " + step + " / " + N + (phase ? " · " + phase : "");
    if (stepMeterEl) stepMeterEl.style.width = (N ? Math.min(step, N) / N * 100 : 0) + "%";
    if (plan.stepGoals) {
      goalline.hidden = false;
      goalline.textContent = step < N
        ? "Goal (inferred): " + plan.stepGoals[step]
        : "Goal (inferred): Goal reached" + (plan.goalText ? " — " + plan.goalText : "") + " (" + N + " of " + N + " steps).";
    } else {
      goalline.hidden = true;
    }
    factsEl.innerHTML = "<b>board@step" + step + "</b> — " +
      plan.facts[step].map((f) => escapeHtml(f)).join(" · ") +
      ' <span style="opacity:.7">(plan: findActionPath)</span>';
    [...movelist.querySelectorAll("li:not(.phasehead)")].forEach((li, i) => {
      li.classList.toggle("done", i < step);
      li.classList.toggle("current", i === step && step < N);
    });
    btn.back.disabled = step === 0 || animating;
    btn.next.disabled = step === N || animating;
    btn.play.textContent = playing ? "⏸ pause" : (step === N ? "▶ replay" : "▶ play");
    btn.play.classList.toggle("isPlaying", playing);
  }
  async function forward() {
    if (animating || step >= N) return;
    render(); await animateMove(step); step += 1; render();
  }
  async function playRange(from, to) {
    if (animating) return;
    playing = false; step = from; drawState(step); render();
    playing = true; render();
    while (playing && step < to) { await forward(); if (step < to) await wait(300); }
    playing = false; render();
  }

  /** (Re)mount the board/movelist from a planToPageData-shaped object —
   *  called once at boot with the server-embedded PLAN, and again after
   *  every successful live re-solve. */
  function mountPlan(data) {
    plan = data;
    N = plan.actions.length;
    step = 0; playing = false; animating = false;
    board.innerHTML = ""; movelist.innerHTML = ""; blockEls = {};

    const base = document.createElement("div"); base.className = "base"; board.appendChild(base);
    for (const a of plan.anchors) {
      if (a.kind === "slot") {
        const post = document.createElement("div"); post.className = "post";
        post.style.left = (a.x - 3) + "px"; board.appendChild(post);
      } else {
        const c = document.createElement("div"); c.className = "circle";
        c.style.left = a.x + "px"; c.style.top = a.y + "px"; board.appendChild(c);
      }
      const lab = document.createElement("div");
      lab.className = a.kind === "slot" ? "anchorlabel" : "circlelabel";
      lab.textContent = a.id; lab.style.left = a.x + "px";
      if (a.kind !== "slot") lab.style.top = (a.y + 4) + "px";
      board.appendChild(lab);
    }
    for (const item of plan.layouts[0].items) {
      if (item.kind !== "block") continue;
      const el = document.createElement("div");
      el.className = "block"; el.textContent = item.id;
      el.style.width = item.w + "px"; el.style.background = item.fill;
      board.appendChild(el); blockEls[item.id] = el;
    }
    plan.labels.forEach((label, i) => {
      const ph = plan.phases.find((p) => p.from === i);
      if (ph) {
        const head = document.createElement("li");
        head.className = "phasehead"; head.tabIndex = 0;
        head.setAttribute("role", "button");
        head.setAttribute("aria-label", "Play phase: " + ph.label);
        head.textContent = ph.label + " · " + (ph.from + 1) + (ph.to - ph.from > 1 ? "–" + ph.to : "");
        const go = () => playRange(ph.from, ph.to);
        head.addEventListener("click", go);
        head.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); }
        });
        movelist.appendChild(head);
      }
      const li = document.createElement("li");
      li.textContent = (i + 1) + ". " + label;
      li.addEventListener("click", () => { if (animating) return; playing = false; step = i + 1; drawState(step); render(); });
      movelist.appendChild(li);
    });
    drawState(0); render();
  }

  btn.next.addEventListener("click", () => { playing = false; forward(); });
  btn.back.addEventListener("click", () => { if (animating) return; playing = false; step = Math.max(0, step - 1); drawState(step); render(); });
  btn.reset.addEventListener("click", () => { if (animating) return; playing = false; step = 0; drawState(0); render(); });
  btn.play.addEventListener("click", async () => {
    if (animating) return;
    if (playing) { playing = false; render(); return; }
    if (step === N) { step = 0; drawState(0); }
    await playRange(step, N);
  });

  mountPlan(PLAN);

  // ---- live re-solve: disk-count/max-depth controls + the chat-assert dock
  // over the sibling plan-browser.bundle.js (window.tmct). Degrades
  // honestly when the bundle failed to load or wasn't built alongside this
  // page (e.g. a plain renderPlanHtml() call with no bundle nearby) — the
  // baked-in replay above already stands on its own either way.
  const liveStatusEl = document.getElementById("liveStatus");
  const diskCountEl = document.getElementById("diskCount");
  const maxDepthEl = document.getElementById("maxDepth");
  const resolveBtn = document.getElementById("resolveBtn");
  const chatlogEl = document.getElementById("chatlog");
  const chatformEl = document.getElementById("chatform");
  const chatqEl = document.getElementById("chatq");
  const chatpillsEl = document.getElementById("chatpills");
  const boardformEl = document.getElementById("boardform");
  const boardqEl = document.getElementById("boardq");
  const boardpillsEl = document.getElementById("boardpills");

  const liveAvailable = typeof tmct !== "undefined" && typeof tmct.open === "function";
  if (!liveAvailable) {
    liveStatusEl.textContent = "live re-solve unavailable here — showing the baked-in replay only.";
    liveStatusEl.classList.add("isError");
    resolveBtn.disabled = true;
    // Neither dock has a submit handler without the live engine, and a form
    // that submits with no handler navigates away — so the inputs are shut
    // off rather than left to reload the page on Enter.
    chatqEl.disabled = true;
    boardqEl.disabled = true;
    boardqEl.placeholder = "needs the live engine — the replay above still works.";
  } else {
    let session = null;
    // Every engine-touching call (a resolve click and a chat submit) shares
    // one in-memory session — serialize them, the same posture spider-fly-
    // viz.mjs's own withLock takes for its ticker/chat-dock pair.
    let lock = Promise.resolve();
    const withLock = (fn) => { const run = lock.then(fn, fn); lock = run.catch(() => {}); return run; };

    // The hanoi lesson's own "moving a disk onto a target makes the disk
    // rest on the target" sentence needs a real lemmatiser to reduce
    // "moving" to "move" — without it that one teach sentence honestly
    // declines and every position fact taught after it fails in turn. Load
    // wink from the site's shared first-party ./vendor/wink.js and register
    // it, the SAME bounded-race pattern public/tmct-browser.mjs uses: a
    // dynamic import() can neither resolve nor reject on some failures, so
    // an unbounded await would leave a resolve stuck forever.
    // Awaited before EVERY session creation below (idempotent — a second
    // await after the first attempt already settled resolves immediately).
    const WINK_LOAD_TIMEOUT_MS = 8000;
    const winkTimeout = (ms, reason) => new Promise((_, reject) => setTimeout(() => reject(new Error(reason)), ms));
    let winkReady = null;
    function tryLoadWink() {
      if (winkReady) return winkReady;
      winkReady = (async () => {
        try {
          const mod = await Promise.race([
            import("./vendor/wink.js"),
            winkTimeout(WINK_LOAD_TIMEOUT_MS, "wink vendor asset load timed out"),
          ]);
          tmct.page.registerWinkModel(() => ({ winkNLP: mod.winkNLP, model: mod.model }));
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("tmct plan: the wink vendor asset failed to load, continuing without the lemma/POS tier", err);
        }
      })();
      return winkReady;
    }
    tryLoadWink(); // fire eagerly at load, so it is likely settled by the first interaction

    function addChatLine(cls, text) {
      const d = document.createElement("div");
      d.className = cls; d.textContent = text;
      chatlogEl.appendChild(d); chatlogEl.scrollTop = chatlogEl.scrollHeight;
    }
    function applyPlan(freshPlan) {
      if (!freshPlan) return;
      const { rendersAs, sizeOrder } = tmct.page.renderInputsFromPlan(freshPlan);
      mountPlan(tmct.page.planToPageData({ plan: freshPlan, rendersAs, sizeOrder }));
      // The board tmct.ask() traverses is projected from a plan and a step.
      // mountPlan rewinds the transport to step 0, so the graph is moved to
      // the same position rather than left pointing at the previous puzzle.
      if (typeof tmct.session?.showBoard === "function") {
        tmct.session.showBoard({ plan: freshPlan, step: 0 });
      }
      if (pddlEl) pddlEl.textContent = tmct.page.planToPddl(freshPlan);
      // The <title>/<h1> were baked from the INITIAL plan's own goal text —
      // a live re-solve toward a different goal (a fresh puzzle, or a
      // taught goal revision) must not leave them stating the old one.
      const freshTitle = freshPlan.goal?.text || pageTitleEl.textContent;
      pageTitleEl.textContent = freshTitle;
      document.title = freshTitle;
    }
    async function ensureSession() {
      if (session) return session;
      await tryLoadWink();
      session = await tmct.open({
        diskCount: Math.max(1, Math.min(7, parseInt(diskCountEl.value, 10) || 3)),
        maxDepth: Math.max(1, parseInt(maxDepthEl.value, 10) || 300),
      });
      // The board on screen is the server-rendered embed until the first
      // session opens, and the disk-count control may have moved since. A
      // session solving a different puzzle would answer about a board nobody
      // is looking at, so mount its own plan instead.
      if (session.plan && session.plan.actions.length !== N) applyPlan(session.plan);
      return session;
    }

    resolveBtn.addEventListener("click", () => withLock(async () => {
      resolveBtn.disabled = true;
      const n = Math.max(1, Math.min(7, parseInt(diskCountEl.value, 10) || 3));
      const d = Math.max(1, parseInt(maxDepthEl.value, 10) || 300);
      diskCountEl.value = n; maxDepthEl.value = d;
      liveStatusEl.textContent = "solving a " + n + "-disk puzzle…";
      liveStatusEl.classList.remove("isError");
      await tryLoadWink();
      session = await tmct.open({ diskCount: n, maxDepth: d });
      if (session.plan) {
        applyPlan(session.plan);
        liveStatusEl.textContent = "live — " + countLabel(n, "disk", "disks") + ", max depth " + d + ".";
      } else {
        liveStatusEl.textContent = "no plan found within " + d + " moves — raise max search depth and try again.";
        liveStatusEl.classList.add("isError");
      }
      resolveBtn.disabled = false;
    }));

    chatformEl.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = chatqEl.value.trim();
      if (!q) return;
      chatqEl.value = "";
      addChatLine("u", q);
      withLock(async () => {
        const s = await ensureSession();
        const maxDepth = Math.max(1, parseInt(maxDepthEl.value, 10) || 300);
        const result = await tmct.turn(q, { maxDepth });
        addChatLine("a", result.answer);
        if (result.plan) applyPlan(result.plan);
      });
    });

    // A board question goes to tmct.ask(), not tmct.turn(): ask() traverses
    // the puzzle projected as a graph at the step the transport is showing,
    // so "list the locations of disks" reads the board in front of you. A
    // question that graph can't ground gets the engine's own refusal.
    boardformEl.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = boardqEl.value.trim();
      if (!q) return;
      boardqEl.value = "";
      addChatLine("b", q + " (step " + step + ")");
      withLock(async () => {
        await ensureSession();
        const result = await tmct.ask(q, { step });
        addChatLine("a", result.answer);
      });
    });

    for (const [pills, input] of [[chatpillsEl, chatqEl], [boardpillsEl, boardqEl]]) {
      for (const pill of pills.querySelectorAll(".pill")) {
        pill.addEventListener("click", () => {
          input.value = pill.dataset.fill || "";
          input.focus();
        });
      }
    }
  }
})();
</script>
</body>
</html>
`;
}
