// plan-viz.mjs — renders a computed plan (result.plan from the chat plan lane)
// as a self-contained, animated HTML page: the "blocks" archetype.
//
// A pure layout step (computeBlocksLayout) and a pure string builder
// (renderPlanHtml). No I/O here — callers pass the plan, the class→archetype
// map (rendersAs), and the size-order pairs; both derive from fact rows at
// wiring time.

import { THEME_TOKENS_CSS, SERIF_STACK, MONO_STACK, escapeHtml, embedJson } from "./viz-theme.mjs";

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
 *  absent from every pair are appended in label order. */
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
  for (const m of [...members].sort()) {
    if (!(m in ranks)) ranks[m] = next++;
  }
  return ranks;
}

/**
 * Pure geometry for the blocks archetype.
 *
 * plan:      { states: [[{subject, predicate, object}], …], domain: { classMembers } }
 * rendersAs: { className: "block" | "slot" } — classes absent from the map
 *            fall back to labeled circles.
 * sizeOrder: [[smallerLabel, largerLabel], …]
 *
 * Returns { board, ranks, anchors, snapshots: [{ items, stacks }] } —
 * deterministic for identical inputs.
 */
export function computeBlocksLayout({ plan, rendersAs = {}, sizeOrder = [] }) {
  const classMembers = plan?.domain?.classMembers || {};
  const classes = Object.keys(classMembers).sort();
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
      for (const m of members) anchorDefs.push({ id: m, kind });
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
  const ranks = rankBySize(sizeOrder, blocks);
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
    const supporterOf = new Map(); // object -> subject resting on it
    for (const r of [...rows].sort((a, b) => (a.subject < b.subject ? -1 : 1))) {
      if (blockSet.has(r.subject) && !supporterOf.has(r.object)) {
        supporterOf.set(r.object, r.subject);
      }
    }
    const stacks = {};
    const items = anchors.map((a) => ({ ...a }));
    for (const a of anchors) {
      const stack = [];
      let top = a.id;
      while (supporterOf.has(top)) {
        top = supporterOf.get(top);
        stack.push(top);
      }
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

  return { board: { w: BOARD_W, h: BOARD_H }, ranks, anchors, snapshots };
}

/** Phase brackets from the largest block's single move: everything before it
 *  frees the piece, the move itself is the pivot, the rest rebuilds. */
function phasesFor(actions, ranks) {
  const ranked = Object.keys(ranks);
  if (!ranked.length || !actions.length) return [];
  const pivot = ranked.reduce((a, b) => (ranks[a] >= ranks[b] ? a : b));
  const k = actions.findIndex((a) => a.subject === pivot);
  if (k <= 0 || k >= actions.length - 1) return [];
  return [
    { label: `free ${pivot}`, from: 0, to: k },
    { label: "the pivot", from: k, to: k + 1 },
    { label: `rebuild on ${pivot}`, from: k + 1, to: actions.length },
  ];
}

const displayPredicate = (p) => String(p).replace(/^mgx:/, "").replace(/-/g, " ");

/**
 * The self-contained plan page. Consumes the plan-lane contract
 * ({actions, states, stepGoals, goal, domain}) plus the render inputs.
 */
export function renderPlanHtml({ plan, rendersAs = {}, sizeOrder = [], title } = {}) {
  const actions = plan?.actions || [];
  const layout = computeBlocksLayout({ plan, rendersAs, sizeOrder });
  const stepGoals =
    Array.isArray(plan?.stepGoals) && plan.stepGoals.length === actions.length
      ? plan.stepGoals
      : null;
  const labels = actions.map((a, i) => a.label || `move ${a.subject} onto ${a.target}`);
  const factsPerStep = (plan?.states || []).map((rows) =>
    [...rows]
      .map((r) => `${r.subject} ${displayPredicate(r.predicate)} ${r.object}`)
      .sort(),
  );
  const embedded = embedJson({
    actions,
    labels,
    stepGoals,
    goalText: plan?.goal?.text || "",
    layouts: layout.snapshots,
    anchors: layout.anchors,
    board: layout.board,
    facts: factsPerStep,
    phases: phasesFor(actions, layout.ranks),
  });
  const pageTitle = title || `tmct plan — ${actions.length} move${actions.length === 1 ? "" : "s"}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(pageTitle)}</title>
<style>
${THEME_TOKENS_CSS}
html { background: var(--bg); }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: ${SERIF_STACK}; font-size: 16px; }
main { max-width: 880px; margin: 0 auto; padding: 1.4rem 1rem 3rem; }
.head { display: flex; justify-content: space-between; align-items: baseline; flex-wrap: wrap; gap: .4rem; }
h1 { font-size: 1.15rem; margin: 0 0 .8rem; }
.chip { font-family: ${MONO_STACK}; font-size: .68rem; color: var(--muted); border: 1px solid var(--line); border-radius: 99px; padding: .12rem .55rem; }
.stage { display: grid; grid-template-columns: minmax(0, 1fr) 230px; gap: 1rem; }
@media (max-width: 660px) { .stage { grid-template-columns: 1fr; } }
.boardwrap { overflow-x: auto; }
.board { position: relative; width: ${BOARD_W}px; height: ${BOARD_H}px; background: var(--card); border: 1px solid var(--line); border-radius: 8px; }
.base { position: absolute; left: 4%; right: 4%; bottom: 22px; height: 6px; background: var(--line); border-radius: 3px; }
.post { position: absolute; bottom: 28px; width: 6px; height: 150px; background: var(--line); border-radius: 3px 3px 0 0; }
.anchorlabel { position: absolute; bottom: 2px; transform: translateX(-50%); font-family: ${MONO_STACK}; font-size: .66rem; color: var(--muted); }
.block { position: absolute; height: ${BLOCK_H}px; border-radius: 6px; color: #fff; display: flex; align-items: center; justify-content: center; font-family: ${MONO_STACK}; font-size: .66rem; box-shadow: 0 1px 2px rgba(0,0,0,.25); }
.block.moving { z-index: 3; box-shadow: 0 4px 10px rgba(0,0,0,.3); }
.circle { position: absolute; width: 28px; height: 28px; border-radius: 50%; border: 2px solid var(--muted); transform: translate(-50%, -100%); }
.circlelabel { position: absolute; transform: translateX(-50%); font-family: ${MONO_STACK}; font-size: .6rem; color: var(--muted); }
.controls { display: flex; gap: .45rem; align-items: center; margin-top: .7rem; flex-wrap: wrap; }
.controls button { font-family: ${MONO_STACK}; font-size: .78rem; padding: .3rem .7rem; border-radius: 6px; border: 1px solid var(--line); background: var(--card); color: var(--ink); cursor: pointer; }
.controls button:hover { border-color: var(--taught); }
.controls button:focus-visible { outline: 2px solid var(--taught); outline-offset: 2px; }
.controls button[disabled] { opacity: .4; cursor: default; }
.controls .step { margin-left: auto; font-family: ${MONO_STACK}; font-size: .74rem; color: var(--muted); font-variant-numeric: tabular-nums; }
.goalline { margin-top: .7rem; font-family: ${MONO_STACK}; font-size: .76rem; color: var(--taught); background: var(--taught-soft); border-radius: 6px; padding: .45rem .65rem; }
.facts { margin-top: .7rem; font-family: ${MONO_STACK}; font-size: .7rem; color: var(--muted); border-top: 1px dashed var(--line); padding-top: .55rem; line-height: 1.7; }
.facts b { color: var(--ink); }
.movelist { list-style: none; margin: 0; padding: 0; font-family: ${MONO_STACK}; font-size: .74rem; align-self: start; }
.movelist li { padding: .28rem .55rem; border-left: 3px solid transparent; color: var(--muted); cursor: pointer; border-radius: 0 5px 5px 0; font-variant-numeric: tabular-nums; }
.movelist li:hover { color: var(--ink); }
.movelist li.done { color: var(--ink); }
.movelist li.current { border-left-color: var(--taught); color: var(--ink); background: var(--taught-soft); font-weight: 700; }
.movelist .phasehead { font-size: .64rem; letter-spacing: .06em; text-transform: uppercase; border-left: 3px solid var(--taught); margin-top: .5rem; }
.movelist .phasehead:first-child { margin-top: 0; }
.movelist .phasehead:hover { color: var(--taught); background: var(--taught-soft); }
.movelist .phasehead:focus-visible { outline: 2px solid var(--taught); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { .block { transition: none !important; } }
</style>
</head>
<body>
<main>
  <div class="head">
    <h1>${escapeHtml(pageTitle)}</h1>
    <span class="chip">blocks archetype · ${layout.snapshots.length} snapshots · plan: findActionPath</span>
  </div>
  <div class="stage">
    <div>
      <div class="boardwrap"><div class="board" id="board" aria-label="plan board"></div></div>
      <div class="controls">
        <button id="reset" aria-label="Reset to start">⏮ reset</button>
        <button id="back" aria-label="Step back">◀ back</button>
        <button id="play" aria-label="Play">▶ play</button>
        <button id="next" aria-label="Step forward">step ▶</button>
        <span class="step" id="stepLabel"></span>
      </div>
      <div class="goalline" id="goalline" hidden></div>
      <div class="facts" id="facts"></div>
    </div>
    <ol class="movelist" id="movelist"></ol>
  </div>
</main>
<script>
const PLAN = ${embedded};
(function () {
  "use strict";
  const N = PLAN.actions.length;
  const board = document.getElementById("board");
  const stepLabel = document.getElementById("stepLabel");
  const goalline = document.getElementById("goalline");
  const factsEl = document.getElementById("facts");
  const movelist = document.getElementById("movelist");
  const btn = {
    reset: document.getElementById("reset"), back: document.getElementById("back"),
    play: document.getElementById("play"), next: document.getElementById("next"),
  };
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  let step = 0, playing = false, animating = false;

  const base = document.createElement("div"); base.className = "base"; board.appendChild(base);
  for (const a of PLAN.anchors) {
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
  const blockEls = {};
  for (const item of PLAN.layouts[0].items) {
    if (item.kind !== "block") continue;
    const el = document.createElement("div");
    el.className = "block"; el.textContent = item.id;
    el.style.width = item.w + "px"; el.style.background = item.fill;
    board.appendChild(el); blockEls[item.id] = el;
  }
  const posIn = (snap, id) => snap.items.find((i) => i.id === id && i.kind === "block");
  function drawState(i) {
    for (const id of Object.keys(blockEls)) {
      const p = posIn(PLAN.layouts[i], id);
      if (!p) continue;
      blockEls[id].style.transition = "none";
      blockEls[id].style.left = p.x + "px";
      blockEls[id].style.top = p.y + "px";
    }
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  async function animateMove(i) {
    const before = PLAN.layouts[i], after = PLAN.layouts[i + 1];
    const movers = Object.keys(blockEls).filter((id) => {
      const a = posIn(before, id), b = posIn(after, id);
      return a && b && (a.x !== b.x || a.y !== b.y);
    });
    if (reduced || movers.length !== 1) { drawState(i + 1); return; }
    const id = movers[0], el = blockEls[id], to = posIn(after, id);
    animating = true; el.classList.add("moving");
    el.style.transition = "top .18s ease-in"; el.style.top = "${LIFT_Y}px"; await wait(190);
    el.style.transition = "left .26s ease-in-out"; el.style.left = to.x + "px"; await wait(270);
    el.style.transition = "top .18s ease-out"; el.style.top = to.y + "px"; await wait(200);
    el.classList.remove("moving"); animating = false;
  }
  const phaseFor = (i) => {
    if (i >= N) return "done";
    const ph = PLAN.phases.find((p) => i >= p.from && i < p.to);
    return ph ? ph.label : "";
  };
  function render() {
    const phase = phaseFor(step);
    stepLabel.textContent = "step " + step + " / " + N + (phase ? " · " + phase : "");
    if (PLAN.stepGoals) {
      goalline.hidden = false;
      goalline.textContent = step < N
        ? "Goal (inferred): " + PLAN.stepGoals[step]
        : "Goal (inferred): Goal reached" + (PLAN.goalText ? " — " + PLAN.goalText : "") + " (" + N + " of " + N + " steps).";
    }
    factsEl.innerHTML = "<b>board@step" + step + "</b> — " +
      PLAN.facts[step].map((f) => f.replace(/&/g, "&amp;").replace(/</g, "&lt;")).join(" · ") +
      ' <span style="opacity:.7">(plan: findActionPath)</span>';
    [...movelist.querySelectorAll("li:not(.phasehead)")].forEach((li, i) => {
      li.classList.toggle("done", i < step);
      li.classList.toggle("current", i === step && step < N);
    });
    btn.back.disabled = step === 0 || animating;
    btn.next.disabled = step === N || animating;
    btn.play.textContent = playing ? "⏸ pause" : (step === N ? "▶ replay" : "▶ play");
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
  PLAN.labels.forEach((label, i) => {
    const ph = PLAN.phases.find((p) => p.from === i);
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
  btn.next.addEventListener("click", () => { playing = false; forward(); });
  btn.back.addEventListener("click", () => { if (animating) return; playing = false; step = Math.max(0, step - 1); drawState(step); render(); });
  btn.reset.addEventListener("click", () => { if (animating) return; playing = false; step = 0; drawState(0); render(); });
  btn.play.addEventListener("click", async () => {
    if (animating) return;
    if (playing) { playing = false; render(); return; }
    if (step === N) { step = 0; drawState(0); }
    await playRange(step, N);
  });
  drawState(0); render();
})();
</script>
</body>
</html>
`;
}
