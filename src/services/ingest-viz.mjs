// ingest-viz.mjs — ingest.html, the "bring your own text" page: a
// self-contained document shaped exactly like chat-page-viz.mjs's own
// page-builder — one inlined <style> importing viz-theme.mjs's shared tokens,
// behaviour as an inlined IIFE — running the ingest engine
// (ingest-browser.bundle.js's globalThis.tmct) by same-origin relative
// paths.
//
// The page's own chrome is a two-pane translate-tool layout: mode pills
// (Text | Document) across the top, a roomy free-text area on the left that
// takes paste and drag-and-drop plus a browse-for-file control, and a
// soft-panel canonical facts pane on the right that fills LIVE as the
// recognizer grounds each sentence, plus chat.html's own memory chrome:
// starter memory seeded by default, a right-docked "this session's memory"
// panel, and best-effort persistence across a reload. One options row above
// the panes (seed with general knowledge / fuzzy low-trust tier); one
// actions row under them (ingest, export facts, reset to seed, clear).
//
// Behind the panes is the ONE recognizer seam the browser bundle exposes —
// session.ingest(text) — so a wider ingest tier plugs in without this page
// changing. Grounded facts write to a PERSISTENT session store that survives
// across ingest clicks (a second paste extends the same memory, it never
// starts over); the facts pane itself still shows only what THIS ingest just
// grounded, live.
//
// renderIngestHtml() is pure: no I/O, deterministic output for identical
// input. scripts/build-demo-site.mjs calls it directly and writes the result
// to public/ingest.html, after ingest-browser.bundle.js already exists.
import { THEME_TOKENS_CSS, SERIF_STACK, MONO_STACK, escapeHtml, demoEyebrowHtml, EYEBROW_LINKS_CSS } from "./viz-theme.mjs";
import {
  bandLabelFor,
  statsSummaryLine,
  clearSiteAssetCaches,
  fetchWithProgress,
  renderStatsPanelInto,
  loadProgressLine,
  factTripleParts,
} from "./memory-panel-viz.mjs";
import { loadWinkVendor } from "./viz-boot.mjs";
import { cloneMemoryPayload } from "../adapters/memory/core.mjs";

const DEFAULT_TITLE = "the-mechanical-code-talker — ingest";

/** The self-contained ingest page. Pure — the same output for the same
 *  `title` every time; every piece of state (the session, each grounded fact)
 *  is computed live in the browser once the sibling ingest bundle loads. */
export function renderIngestHtml({ title = DEFAULT_TITLE, seedStamp = "" } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="icon" href="./favicon.svg" type="image/svg+xml">
<link rel="icon" href="./favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="./apple-touch-icon.png">
<!--
  The wink lemma/POS tier loads from ./vendor/wink.js — the site's own shared
  first-party bundle (built by scripts/build-wink-vendor.mjs), one cached copy
  for every page, no CDN. The ingest engine needs wink to split sentences and
  to parse each teach frame. A failed load still answers "nothing
  recognized" instead of erroring.
-->
<style>
${THEME_TOKENS_CSS}
  html, body { height: 100%; }
  /* body is the OUTER row: the ingest column plus the stats panel docked to
     its right, the same split chat.html's own body/.chatCol/.statsPanel
     layout holds. */
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: ${SERIF_STACK}; font-size: 16px; line-height: 1.5; display: flex; overflow: hidden; }
  .ingestCol { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
  .mono { font-family: ${MONO_STACK}; }
  button { font: inherit; color: inherit; background: none; cursor: pointer; border: none; }
  button:focus-visible, textarea:focus-visible, input:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }

  header.topbar { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: .7rem 1.1rem; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  .brand { display: flex; flex-direction: column; gap: .1rem; }
  .eyebrow { font-family: ${MONO_STACK}; font-size: .78rem; letter-spacing: .08em; color: var(--muted); }
  ${EYEBROW_LINKS_CSS}
  .subtitle { margin: 0; font-size: .82rem; font-weight: 400; color: var(--muted); }

  /* the live memory count, in the topbar rather than the status line: it is
     the one number that says what this page's memory actually holds, and the
     status line beside the buttons is where a wrong one goes unnoticed. */
  .topbar-right { display: flex; align-items: center; gap: .7rem; }
  .fact-pill { display: inline-flex; align-items: baseline; gap: .34rem; font-family: ${MONO_STACK}; font-size: .66rem; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); border: 1px solid var(--corpus-t1); border-radius: 99px; padding: .2rem .8rem; background: var(--corpus-soft); white-space: nowrap; }
  .fact-pill .fact-pill-value { font-size: .94rem; letter-spacing: 0; font-variant-numeric: tabular-nums; font-weight: 600; color: var(--ink); }

  /* mode pills — Text | Document — the translate-tool idiom: two segments in
     one rounded track, the active one filled. */
  .pills { display: inline-flex; border: 1px solid var(--line); border-radius: 99px; overflow: hidden; font-family: ${MONO_STACK}; font-size: .72rem; }
  .pills button { padding: .3rem .95rem; color: var(--muted); background: var(--card); border-right: 1px solid var(--line); }
  .pills button:last-child { border-right: none; }
  .pills button[aria-pressed="true"] { background: var(--ink); color: var(--bg); }

  /* the options row — seed with general knowledge / the fuzzy low-trust
     tier — both off/on switches in the statusline's own quiet mono idiom. */
  .optionsRow { flex: 0 0 auto; display: flex; align-items: center; gap: 1.2rem; padding: .5rem 1.1rem; border-bottom: 1px solid var(--line); font-family: ${MONO_STACK}; font-size: .7rem; color: var(--muted); flex-wrap: wrap; }
  .optionToggle { display: inline-flex; align-items: center; gap: .4rem; cursor: pointer; white-space: nowrap; }
  .optionToggle input { margin: 0; accent-color: var(--corpus); }

  /* the two panes: a roomy input on the left, a soft-panel facts render on the
     right. A CSS grid that stacks on a phone. */
  main.panes { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--line); overflow: hidden; }
  .pane { min-width: 0; min-height: 0; display: flex; flex-direction: column; background: var(--bg); }
  .pane-head { flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; gap: .6rem; padding: .55rem .9rem; font-family: ${MONO_STACK}; font-size: .7rem; color: var(--muted); border-bottom: 1px solid var(--line); }

  /* left: the free-text area, drop target and paste sink both. */
  .inPane { position: relative; }
  #source { flex: 1 1 auto; width: 100%; box-sizing: border-box; resize: none; border: none; background: var(--bg); color: var(--ink); font-family: ${MONO_STACK}; font-size: .84rem; line-height: 1.5; padding: .9rem 1rem; }
  #source::placeholder { color: var(--muted); }
  .inPane.drag { outline: 2px dashed var(--corpus); outline-offset: -6px; }
  .dropHint { position: absolute; inset: 0; display: none; align-items: center; justify-content: center; pointer-events: none; font-family: ${MONO_STACK}; font-size: .8rem; color: var(--corpus); background: var(--corpus-soft); }
  .inPane.drag .dropHint { display: flex; }
  .browse { font-family: ${MONO_STACK}; font-size: .68rem; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: .16rem .55rem; background: var(--card); }
  .browse:hover { color: var(--ink); }

  /* right: the canonical facts, on the soft panel background, with the ask
     dock pinned under them — you read what landed, then question it in place. */
  .outPane { background: var(--card); }
  #facts { flex: 1 1 auto; overflow-y: auto; padding: .6rem .9rem 1rem; font-family: ${MONO_STACK}; font-size: .8rem; }
  #facts .fact { display: grid; grid-template-columns: 1fr auto 1fr; gap: .5rem; align-items: baseline; padding: .3rem 0; border-bottom: 1px solid var(--line); }
  #facts .fact .subj { color: var(--ink); text-align: right; word-break: break-word; }
  #facts .fact .pred { color: var(--corpus); white-space: nowrap; }
  #facts .fact .obj { color: var(--ink); word-break: break-word; }
  #facts .fact .prov { grid-column: 1 / -1; color: var(--muted); font-size: .66rem; }
  #facts .empty { color: var(--muted); text-align: center; max-width: 24rem; line-height: 1.6; margin: 3rem auto 0; }

  /* the ask dock: one line in, one answer out, against the graph this session
     projects from what it has ingested. */
  .askDock { flex: 0 0 auto; border-top: 1px solid var(--line); display: flex; flex-direction: column; }
  #askLog { max-height: 11rem; overflow-y: auto; padding: .5rem .9rem 0; font-family: ${MONO_STACK}; font-size: .78rem; }
  #askLog:empty { display: none; }
  .askLine { margin: 0 0 .35rem; white-space: pre-wrap; word-break: break-word; }
  .askLine.q { color: var(--muted); }
  .askLine.q::before { content: "> "; }
  .askLine.a { color: var(--ink); }
  .askLine.detail { color: var(--muted); font-size: .68rem; }
  .askLine.miss { color: var(--muted); font-style: italic; }
  .askRow { display: flex; align-items: center; gap: .5rem; padding: .5rem .9rem .6rem; }
  #askq { flex: 1 1 auto; min-width: 0; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--ink); font-family: ${MONO_STACK}; font-size: .78rem; padding: .35rem .6rem; }
  #askq::placeholder { color: var(--muted); }
  #askq:disabled { opacity: .55; }
  .askGo { font-family: ${MONO_STACK}; font-size: .72rem; color: var(--ink); border: 1px solid var(--line); border-radius: 6px; padding: .32rem .85rem; background: var(--card); }
  .askGo:disabled { opacity: .45; cursor: default; }

  .actions { flex: 0 0 auto; display: flex; align-items: center; gap: .6rem; padding: .6rem 1.1rem; border-top: 1px solid var(--line); flex-wrap: wrap; }
  .actions .btn { font-family: ${MONO_STACK}; font-size: .74rem; color: var(--ink); border: 1px solid var(--line); border-radius: 6px; padding: .35rem .9rem; background: var(--card); }
  .actions .btn.primary { background: var(--ink); color: var(--bg); border-color: var(--ink); }
  .actions .btn:disabled { opacity: .45; cursor: default; }
  .actions .status { margin-left: auto; font-family: ${MONO_STACK}; font-size: .7rem; color: var(--muted); }

  /* the provenance stats panel: what this session's memory holds, docked to
     the right of the ingest column (a real layout column, not an overlay) —
     the same class names and breakpoint chat-page-viz.mjs's own docked panel
     uses, re-rendered after boot and after every ingest from
     window.tmct's own memoryStats(). */
  .statsPanel { flex: 0 0 300px; max-width: 300px; overflow-y: auto; border-left: 1px solid var(--line); padding: 1.1rem 1.2rem 1.6rem; font-family: ${MONO_STACK}; font-size: .74rem; line-height: 1.55; display: flex; flex-direction: column; }
  .statsPanel h2 { font-size: .66rem; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); margin: 1.3rem 0 .5rem; }
  .statsPanel h2:first-child { margin-top: 0; }
  .statsPanel .band-row { display: flex; justify-content: space-between; gap: .6rem; margin: 0; padding: .12rem 0; }
  .statsPanel .band-count { color: var(--muted); font-variant-numeric: tabular-nums; }
  .statsPanel .taught-item { margin: 0 0 .7rem; }
  .statsPanel .taught-tag { display: block; color: var(--muted); font-size: .66rem; margin-top: .15rem; word-break: break-word; }
  .statsPanel .empty { color: var(--muted); margin: 0; }
  /* The reset action anchors to the bottom of the rail via the auto margin —
     on a tall viewport with little taught yet, that reads as a pinned
     footer control instead of leaving a trailing gap under it. */
  .statsPanel .forget-btn { font-family: ${MONO_STACK}; font-size: .66rem; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: .18rem .55rem; margin-top: auto; background: var(--card); flex: none; }
  .statsPanel .forget-btn:hover { color: var(--ink); }
  .statsPanel .persist-note { color: var(--muted); font-size: .64rem; margin: .4rem 0 0; flex: none; }

  @media (max-width: 860px) {
    .statsPanel { display: none; }
  }
  @media (max-width: 720px) {
    main.panes { grid-template-columns: 1fr; grid-template-rows: 1fr 1fr; }
  }
  @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
</style>
</head>
<body>
  <div class="ingestCol">
    <header class="topbar">
      <div class="brand">
        <span class="eyebrow">${demoEyebrowHtml("ingest", "ingest")}</span>
        <h1 class="subtitle">ingest &mdash; paste or drop text. It keeps the facts it can ground and skips the rest.</h1>
      </div>
      <div class="topbar-right">
        <span class="fact-pill" id="factPill" aria-live="polite"
          title="every fact this page's memory holds right now — the starter memory it booted with plus everything it has grounded since">
          <span class="fact-pill-value" id="factPillValue">&mdash;</span> facts in memory
        </span>
        <div class="pills" role="group" aria-label="Input mode">
          <button type="button" id="modeText" aria-pressed="true">Text</button>
          <button type="button" id="modeDoc" aria-pressed="false">Document</button>
        </div>
      </div>
    </header>
    <div class="optionsRow" id="optionsRow">
      <label class="optionToggle" title="Loads chat.html's own starter memory (persona, ConceptNet, WordNet and the rest) before ingesting, so a taught fact can link into what it already knows. Off starts from an empty store, which loads faster.">
        <input type="checkbox" id="seedToggle" checked>
        seed with general knowledge
      </label>
      <label class="optionToggle" title="On a miss, also tries a copula or a known relation verb between two resolvable entities, tagged optimistic-extract. It ranks below every curated source and can never corroborate one.">
        <input type="checkbox" id="fuzzyToggle">
        fuzzy tier (low-trust candidates)
      </label>
    </div>
    <main class="panes">
      <section class="pane inPane" id="inPane" aria-label="Text to ingest">
        <div class="pane-head">
          <span id="srcLabel">your text</span>
          <button type="button" class="browse" id="browseBtn">browse for a file&hellip;</button>
          <input type="file" id="fileInput" accept=".txt,.md,text/plain,text/markdown" hidden>
        </div>
        <textarea id="source" spellcheck="false" autocapitalize="off"
          placeholder="Paste text here, drop a .txt/.md file, or browse for one.&#10;&#10;Each sentence it recognizes as a fact (&quot;A beagle is a kind of dog.&quot;) is kept; every other sentence is skipped, never guessed at."></textarea>
        <div class="dropHint">drop the file to load it</div>
      </section>
      <section class="pane outPane" aria-label="Grounded canonical facts">
        <div class="pane-head">
          <span>canonical facts</span>
          <span id="factCount" class="mono"></span>
        </div>
        <div id="facts"><p class="empty">Nothing ingested yet. The facts it grounds will appear here as it reads.</p></div>
        <form class="askDock" id="askForm" autocomplete="off">
          <div id="askLog" aria-live="polite"></div>
          <div class="askRow">
            <input type="text" id="askq" aria-label="Ask about what you have ingested"
              placeholder="ask about what you&rsquo;ve ingested&hellip;" disabled>
            <button type="submit" class="askGo" id="askGo" disabled>ask</button>
          </div>
        </form>
      </section>
    </main>
    <div class="actions">
      <button type="button" class="btn primary" id="ingestBtn" disabled>ingest</button>
      <button type="button" class="btn" id="downloadBtn" disabled>export facts</button>
      <button type="button" class="btn" id="reinitStore" title="drop everything saved on this device and reload from the shipped seed">reset to seed</button>
      <button type="button" class="btn" id="clearBtn">clear</button>
      <span class="status" id="status">loading the engine&hellip;</span>
    </div>
  </div>
  <aside class="statsPanel" id="statsPanel" aria-label="This session's memory">
    <p class="empty">loading memory stats&hellip;</p>
  </aside>
<script src="./ingest-browser.bundle.js"></script>
<script>
(function () {
  "use strict";
  const factTripleParts = ${factTripleParts.toString()};
  const loadProgressLine = ${loadProgressLine.toString()};
  const bandLabelFor = ${bandLabelFor.toString()};
  const statsSummaryLine = ${statsSummaryLine.toString()};
  const clearSiteAssetCaches = ${clearSiteAssetCaches.toString()};
  const fetchWithProgress = ${fetchWithProgress.toString()};
  const renderStatsPanelInto = ${renderStatsPanelInto.toString()};
  const el = (id) => document.getElementById(id);

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./tmct-sw.js").catch(() => {});

  const sourceEl = el("source");
  const factsEl = el("facts");
  const factCountEl = el("factCount");
  const statusEl = el("status");
  const ingestBtn = el("ingestBtn");
  const downloadBtn = el("downloadBtn");
  const clearBtn = el("clearBtn");
  const browseBtn = el("browseBtn");
  const fileInput = el("fileInput");
  const inPane = el("inPane");
  const srcLabel = el("srcLabel");
  const modeTextBtn = el("modeText");
  const modeDocBtn = el("modeDoc");
  const seedToggleEl = el("seedToggle");
  const fuzzyToggleEl = el("fuzzyToggle");
  const statsPanelEl = el("statsPanel");
  const factPillValueEl = el("factPillValue");
  const askFormEl = el("askForm");
  const askInputEl = el("askq");
  const askGoBtn = el("askGo");
  const askLogEl = el("askLog");

  let session = null;
  let grounded = 0; // facts on show in the right pane, from the CURRENT ingest only
  let sourceTag = "pasted text"; // what the header names the current input

  // ---- input mode: Text | Document ---------------------------------------
  // Both feed the same textarea and the same pipeline; the pill only changes
  // what the header names the source and which affordance it leads with.
  function setMode(doc) {
    modeTextBtn.setAttribute("aria-pressed", String(!doc));
    modeDocBtn.setAttribute("aria-pressed", String(doc));
    browseBtn.style.display = doc ? "" : "none";
    if (doc && sourceTag === "pasted text") srcLabel.textContent = "drop or browse for a file";
    else if (!doc) srcLabel.textContent = sourceTag;
  }
  modeTextBtn.addEventListener("click", () => setMode(false));
  modeDocBtn.addEventListener("click", () => setMode(true));

  browseBtn.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files && fileInput.files[0];
    if (file) loadFile(file);
    fileInput.value = "";
  });

  async function loadFile(file) {
    try {
      sourceEl.value = await file.text();
      sourceTag = file.name || "file";
      srcLabel.textContent = sourceTag;
      updateIngestEnabled();
    } catch (err) {
      statusEl.textContent = "couldn't read that file (" + (err && err.message ? err.message : err) + ")";
    }
  }

  // Drag-and-drop straight onto the input pane — a text file loads its
  // contents; anything else is ignored (the textarea's own paste handles
  // dropped text selections for free).
  ["dragenter", "dragover"].forEach((ev) => inPane.addEventListener(ev, (e) => {
    e.preventDefault();
    inPane.classList.add("drag");
  }));
  ["dragleave", "drop"].forEach((ev) => inPane.addEventListener(ev, (e) => {
    if (ev === "dragleave" && inPane.contains(e.relatedTarget)) return;
    inPane.classList.remove("drag");
  }));
  inPane.addEventListener("drop", (e) => {
    e.preventDefault();
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) { setMode(true); loadFile(file); }
  });

  sourceEl.addEventListener("input", () => {
    // Typing or pasting makes this "pasted text" again, not a named file.
    if (srcLabel.textContent !== "pasted text") { sourceTag = "pasted text"; }
    updateIngestEnabled();
  });

  function updateIngestEnabled() {
    ingestBtn.disabled = !session || !sourceEl.value.trim();
  }

  // ---- the canonical facts pane -------------------------------------------
  // Shows only what the CURRENT ingest grounds, live — the underlying session
  // store is persistent across ingest clicks (see below), but this pane
  // clears at the start of every ingest so it never shows a stale mix of runs.
  function clearFactsPane() {
    factsEl.textContent = "";
    grounded = 0;
    factCountEl.textContent = "";
    downloadBtn.disabled = !session;
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "Nothing ingested yet. The facts it grounds will appear here as it reads.";
    factsEl.appendChild(empty);
  }

  function appendFactRow(fact) {
    if (!grounded) factsEl.textContent = ""; // drop the empty note on the first real row
    const parts = factTripleParts(fact);
    const row = document.createElement("div");
    row.className = "fact";
    const subj = document.createElement("span");
    subj.className = "subj";
    subj.textContent = parts.subject;
    const pred = document.createElement("span");
    pred.className = "pred";
    pred.textContent = parts.predicate;
    const obj = document.createElement("span");
    obj.className = "obj";
    obj.textContent = parts.object;
    row.appendChild(subj);
    row.appendChild(pred);
    row.appendChild(obj);
    if (parts.provenance) {
      const prov = document.createElement("span");
      prov.className = "prov";
      prov.textContent = parts.provenance;
      row.appendChild(prov);
    }
    factsEl.appendChild(row);
    grounded += 1;
    factCountEl.textContent = grounded + (grounded === 1 ? " fact" : " facts");
    downloadBtn.disabled = false;
    factsEl.scrollTop = factsEl.scrollHeight;
  }

  // ---- the ask dock: one question, put to what this session has ingested ---
  // Two real routes, tried in order, and neither one guesses. window.tmct.ask
  // puts the question to the graph this session projects from its OWN grounded
  // rows (ingest-facts.mjs), which is what answers a listing — "list dogs"
  // reads the beagles actually on record. On a miss, window.tmct.turn runs the
  // full chat turn engine over the same store, which reads a term's own facts
  // back ("what is a beagle") and takes a taught line ("remember: …") the
  // graph shape has no lane for. Both missing is the honest wall, and the note
  // there names the kinds this memory really holds instead of inventing an
  // example question.
  let asking = false;

  function updateAskEnabled() {
    const ready = Boolean(session) && !asking;
    askInputEl.disabled = !ready;
    askGoBtn.disabled = !ready || !askInputEl.value.trim();
  }

  function addAskLine(cls, text) {
    const line = document.createElement("div");
    line.className = "askLine " + cls;
    line.textContent = text;
    askLogEl.appendChild(line);
    askLogEl.scrollTop = askLogEl.scrollHeight;
  }

  // The engine writes its answer first and its reasoning trailers ("Goal
  // (inferred): …", "Canonical: …") after a blank line. The answer leads; the
  // trailers stay, quieter, because they are how a reader audits it.
  function addAskAnswer(answer) {
    const blocks = String(answer).split(/\\n{2,}/).map(function (b) { return b.trim(); }).filter(Boolean);
    if (!blocks.length) return;
    addAskLine("a", blocks[0]);
    for (const block of blocks.slice(1)) addAskLine("detail", block);
  }

  function askMissNote() {
    const kinds = session && session.askableClasses ? session.askableClasses() : [];
    if (!kinds.length) return "Nothing of your own is in this session's memory yet. Ingest some text first.";
    return "I can't ground that in what you've ingested. The kinds it holds: " + kinds.slice(0, 8).join(", ") + ".";
  }

  askInputEl.addEventListener("input", updateAskEnabled);
  askFormEl.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = askInputEl.value.trim();
    if (!q || asking || !session) return;
    asking = true;
    askInputEl.value = "";
    updateAskEnabled();
    addAskLine("q", q);
    try {
      let asked = null;
      try { asked = await window.tmct.ask(q); } catch { asked = null; }
      if (asked && asked.answer && !asked.miss) { addAskAnswer(asked.answer); return; }
      let turned = null;
      try { turned = await window.tmct.turn(q); } catch { turned = null; }
      if (turned && turned.answer && !(turned.record && turned.record.miss)) {
        addAskAnswer(turned.answer);
        // A taught line writes to the same store an ingest does, so it earns
        // the same debounced save and the same panel refresh.
        if (turned.record && turned.record.via === "assert") {
          scheduleSave();
          await renderStatsPanel();
        }
        return;
      }
      addAskLine("miss", askMissNote());
    } finally {
      asking = false;
      updateAskEnabled();
      askInputEl.focus();
    }
  });

  // ---- memory stats: the docked panel, same convention as chat.html --------
  async function renderStatsPanel(stats) {
    if (!stats) {
      if (!session || !window.tmct.page.memoryStats) return;
      try { stats = await window.tmct.page.memoryStats(session.memoryDir); }
      catch { return; }
    }
    factPillValueEl.textContent = Number(stats.total || 0).toLocaleString();
    renderStatsPanelInto(statsPanelEl, stats, {
      bandLabel: bandLabelFor,
      taughtHint: "nothing yet. Ingest some text and its grounded facts land here, with their source.",
      onForget: persist ? forgetEverything : null,
      persistNote: "taught facts are kept best-effort on this device (IndexedDB), never sent anywhere.",
    });
  }

  // ---- seed: chat.html's own starter memory, on by default -----------------
  const SEED_PREF_KEY = "tmct.ingest.seed";
  function readSeedPref() {
    try {
      const stored = localStorage.getItem(SEED_PREF_KEY);
      return stored === null ? true : stored === "on";
    } catch { return true; }
  }
  function writeSeedPref(on) {
    try { localStorage.setItem(SEED_PREF_KEY, on ? "on" : "off"); } catch { /* private mode — this visit still works */ }
  }

  // The build's own content hash for the seed. It rides in the URL this page
  // fetches the seed by, so the service worker's cache-first read can only
  // ever return the copy this page asked for. Empty in a build with no seed.
  const SEED_STAMP = ${JSON.stringify(seedStamp)};
  const SEED_QUERY = SEED_STAMP ? "?b=" + SEED_STAMP : "";

  let seedPayload = null;
  let seedFacts = 0;
  const progressParts = {};
  let progressActive = true;
  function noteProgress(key, loaded, total) {
    progressParts[key] = { loaded: loaded, total: total };
    if (progressActive) statusEl.textContent = loadProgressLine(Object.values(progressParts));
  }

  // The one branch this page's seed choice makes: checked, fetch and parse
  // the same chat-seed.json chat.html embeds; unchecked, skip the request
  // outright and stay on the previous empty-store fast path.
  //
  // One retry with a cache-busting query param: a CDN edge can serve a
  // corrupted or truncated precompressed response (a transient bad cache
  // entry, not a code defect — real bytes decompress fine, and the same URL
  // fetched moments later is clean), and JSON.parse throwing is the only
  // signal of that. The bust param forces a fresh fetch past that one entry.
  async function fetchSeedIfWanted() {
    if (!seedToggleEl.checked) { seedPayload = null; seedFacts = 0; return; }
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const bust = attempt === 1 ? "" : (SEED_QUERY ? "&" : "?") + "retry=1";
        const blob = await fetchWithProgress("./chat-seed.json" + SEED_QUERY + bust, (loaded, total) => noteProgress("seed", loaded, total));
        seedPayload = JSON.parse(await blob.text());
        seedFacts = (seedPayload.individuals || []).filter((i) => i.class === "Fact").length;
        return;
      } catch (err) {
        if (attempt === 2) {
          seedPayload = null;
          seedFacts = 0;
          console.warn("tmct ingest: chat-seed.json unavailable — starting unseeded", err);
        }
      }
    }
  }
  const cloneMemoryPayload = ${cloneMemoryPayload.toString()};
  async function newSession() {
    return window.tmct.open({ seedPayload: cloneMemoryPayload(seedPayload), vocabSeeded: Boolean(seedPayload) });
  }

  // ---- engine boot ---------------------------------------------------------
  const loadWinkVendor = ${loadWinkVendor.toString()};
  const tryLoadWink = loadWinkVendor({ register: (factory) => window.tmct.page.registerWinkModel(factory) });

  // The deploy's own version, read off the service worker file the build
  // already stamps — the only same-origin place the number exists at runtime
  // without a second build artifact. Best-effort: no worker file, no match,
  // no network -> "dev".
  async function fetchSiteVersion() {
    try {
      const res = await fetch("./tmct-sw.js");
      if (!res.ok) return "dev";
      const found = /tmct-precache-v(\\d+\\.\\d+\\.\\d+)/.exec(await res.text());
      return found ? found[1] : "dev";
    } catch {
      return "dev";
    }
  }

  // ---- persistence: taught facts survive a reload, on this device ----------
  let persist = null;
  let saveTimer = null;
  let siteVersion = "dev";
  window.tmctIngestLastSave = null;

  function scheduleSave() {
    if (!persist) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (!session) return;
      const started = performance.now();
      let snapshot;
      try {
        snapshot = structuredClone(session.memoryDir.payload);
      } catch {
        try { snapshot = JSON.parse(JSON.stringify(session.memoryDir.payload)); } catch { return; }
      }
      persist.save(snapshot).then((saved) => {
        if (saved) window.tmctIngestLastSave = { at: Date.now(), ms: Math.round(performance.now() - started) };
      });
    }, 500);
  }

  async function forgetEverything() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (persist) await persist.clear();
    session = await newSession();
    clearFactsPane();
    askLogEl.textContent = "";
    updateIngestEnabled();
    updateAskEnabled();
    const stats = await window.tmct.page.memoryStats(session.memoryDir);
    statusEl.textContent = "forgot everything taught on this device. Back to the fresh seed (" + statsSummaryLine(stats, bandLabelFor) + ").";
    await renderStatsPanel(stats);
  }

  // Flipping the seed switch rebuilds the session from scratch under the new
  // choice — a seeded and an unseeded store are different enough that
  // half-carrying one visit's typed facts across the flip would be more
  // confusing than starting clean.
  seedToggleEl.addEventListener("change", async () => {
    writeSeedPref(seedToggleEl.checked);
    ingestBtn.disabled = true;
    statusEl.textContent = seedToggleEl.checked ? "loading starter memory\\u2026" : "starting unseeded\\u2026";
    await fetchSeedIfWanted();
    clearTimeout(saveTimer);
    saveTimer = null;
    session = await newSession();
    clearFactsPane();
    askLogEl.textContent = "";
    const stats = await window.tmct.page.memoryStats(session.memoryDir);
    statusEl.textContent = statsSummaryLine(stats, bandLabelFor) + ". Ready.";
    await renderStatsPanel(stats);
    updateIngestEnabled();
    updateAskEnabled();
    sourceEl.focus();
  });

  async function boot() {
    if (!window.tmct) {
      statusEl.textContent = "the ingest engine didn't load. This page needs its build step (npm run demo:build)";
      return;
    }
    seedToggleEl.checked = readSeedPref();
    const [winkStatus] = await Promise.all([
      tryLoadWink(),
      fetchSeedIfWanted(),
      fetchSiteVersion().then((v) => { siteVersion = v; }),
    ]);
    progressActive = false;
    if (window.tmct.page.openPersistedStore) {
      persist = window.tmct.page.openPersistedStore({ storeKey: "ingest", stamp: siteVersion + ":" + seedFacts + ":" + SEED_STAMP });
    }
    const savedRecord = persist ? await persist.load() : null;
    session = savedRecord && savedRecord.payload
      ? await window.tmct.open({ seedPayload: savedRecord.payload, vocabSeeded: true })
      : await newSession();
    setMode(false);
    updateIngestEnabled();
    updateAskEnabled();
    const stats = await window.tmct.page.memoryStats(session.memoryDir);
    const winkPart = winkStatus === "loaded"
      ? "wink-nlp: loaded"
      : "wink-nlp unavailable. The recognizer can't split sentences without it";
    statusEl.textContent = statsSummaryLine(stats, bandLabelFor) + " \\u00b7 " + winkPart
      + (savedRecord ? ". Restored from your last visit." : ". Paste or drop text, then ingest.");
    await renderStatsPanel(stats);
    sourceEl.focus();
  }

  // ---- ingest: the one seam call -------------------------------------------
  // The session is PERSISTENT across ingest clicks — a second paste extends
  // the same memory rather than starting over — so only the facts pane
  // clears per click, never the underlying store.
  let busy = false;
  ingestBtn.addEventListener("click", async () => {
    const text = sourceEl.value.trim();
    if (!text || busy || !session) return;
    busy = true;
    ingestBtn.disabled = true;
    clearFactsPane();
    statusEl.textContent = "reading\\u2026";
    try {
      const summary = await session.ingest(text, {
        optimistic: fuzzyToggleEl.checked,
        onFact: (fact) => { appendFactRow(fact); return new Promise((r) => setTimeout(r, 0)); },
      });
      statusEl.textContent = summary.sentences + " sentence" + (summary.sentences === 1 ? "" : "s")
        + " read, " + summary.recognized + " grounded, " + summary.skipped + " skipped"
        + (summary.skipped ? " (not a recognized fact shape, as expected)" : "");
      if (!summary.recognized) {
        const empty = factsEl.querySelector(".empty");
        if (!empty) {
          factsEl.textContent = "";
          const note = document.createElement("p");
          note.className = "empty";
          note.textContent = "No sentence here was a fact it could ground. Try a plain statement like \\u201cA beagle is a kind of dog.\\u201d";
          factsEl.appendChild(note);
        }
      } else {
        scheduleSave();
      }
      await renderStatsPanel();
    } catch (err) {
      statusEl.textContent = "something went wrong reading that (" + (err && err.message ? err.message : err) + ")";
    } finally {
      busy = false;
      updateIngestEnabled();
    }
  });

  // ---- download the canonical facts as JSONL -------------------------------
  downloadBtn.addEventListener("click", async () => {
    if (!session || !window.tmct.page.exportFactsJsonl) return;
    let jsonl;
    try {
      jsonl = await window.tmct.page.exportFactsJsonl(session.memoryDir);
    } catch (err) {
      statusEl.textContent = "couldn't build the download (" + (err && err.message ? err.message : err) + ")";
      return;
    }
    const blob = new Blob([jsonl], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "tmct-facts.jsonl";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  // "reset to seed" is the full re-initialisation: drop everything this device
  // holds and reload, so boot re-seeds from the page's shipped seed as if on a
  // first visit. Both stores go — what you taught lives in IndexedDB, and the
  // seed asset itself lives in the service worker's Cache Storage, so clearing
  // only the first would re-seed out of a cached copy of an older seed.
  el("reinitStore").addEventListener("click", async () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (persist) await persist.clear();
    await clearSiteAssetCaches();
    window.location.reload();
  });

  // "clear" only resets the UI (the textarea and this-run's facts pane) — the
  // underlying session and everything it has grounded so far stays intact,
  // matching the persistent-session contract above.
  clearBtn.addEventListener("click", () => {
    sourceEl.value = "";
    sourceTag = "pasted text";
    srcLabel.textContent = modeDocBtn.getAttribute("aria-pressed") === "true" ? "drop or browse for a file" : "pasted text";
    clearFactsPane();
    askLogEl.textContent = "";
    statusEl.textContent = "cleared";
    updateIngestEnabled();
    sourceEl.focus();
  });

  window.tmctIngestReady = boot().catch((err) => {
    console.error("tmct ingest failed to boot", err);
    statusEl.textContent = "the ingest page failed to start (" + (err && err.message ? err.message : err) + ")";
  });
  window.tmct.ready = window.tmctIngestReady;
})();
</script>
</body>
</html>
`;
}
