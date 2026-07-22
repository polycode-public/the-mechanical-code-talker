// ingest-viz.mjs — ingest.html, the "bring your own text" page: a
// self-contained document shaped exactly like chat-page-viz.mjs's own
// page-builder — one inlined <style> importing viz-theme.mjs's shared tokens,
// behaviour as an inlined IIFE — running the ingest engine
// (ingest-browser.bundle.js's globalThis.tmctIngest) by same-origin relative
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
import { THEME_TOKENS_CSS, SERIF_STACK, MONO_STACK, escapeHtml } from "./viz-theme.mjs";
import { bandLabelFor, statsSummaryLine, fetchWithProgress, renderStatsPanelInto } from "./memory-panel-viz.mjs";

const DEFAULT_TITLE = "the-mechanical-code-talker — ingest";

/** One grounded fact as a canonical triple line — subject, predicate, object,
 *  each in its own cell so the pane can align them. Pure and
 *  `.toString()`-splice safe (no outer refs): the inline script splices this
 *  in and calls it per row. */
export function factTripleParts(fact) {
  return {
    subject: String((fact && fact.subject) || ""),
    predicate: String((fact && fact.predicate) || ""),
    object: String((fact && fact.object) || ""),
    provenance: String((fact && fact.provenance) || ""),
  };
}

/** The boot statusline while the big assets stream in — the same aggregator
 *  chat-page-viz.mjs's own loadProgressLine is (kept as this page's own copy
 *  rather than a shared import — the two pages' boot lines diverge slightly
 *  and neither is a collaborator the other calls). `parts` is an array of
 *  { loaded, total } byte counts (total 0 when the response carried no
 *  Content-Length); with no usable total the line shows loaded bytes alone
 *  rather than inventing a denominator. Self-contained, `.toString()`-splice
 *  safe. */
export function loadProgressLine(parts) {
  const mb = (n) => (n / 1048576).toFixed(1);
  let loaded = 0;
  let total = 0;
  let totalKnown = true;
  for (const p of parts || []) {
    loaded += (p && p.loaded) || 0;
    if (p && p.total > 0) total += p.total;
    else totalKnown = false;
  }
  return totalKnown && total > 0
    ? "loading the engine… " + mb(loaded) + " MB / " + mb(total) + " MB"
    : "loading the engine… " + mb(loaded) + " MB";
}

/** The self-contained ingest page. Pure — the same output for the same
 *  `title` every time; every piece of state (the session, each grounded fact)
 *  is computed live in the browser once the sibling ingest bundle loads. */
export function renderIngestHtml({ title = DEFAULT_TITLE } = {}) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<!--
  The wink lemma/POS tier loads from ./vendor/wink.js — the site's own shared
  first-party bundle (built by scripts/build-wink-vendor.mjs), one cached copy
  for every page, no CDN. The ingest engine needs wink to split sentences and
  to parse each teach frame; a failed load degrades to the honest "nothing
  recognized" answer, never an error.
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
  .subtitle { font-size: .82rem; color: var(--muted); }

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

  /* right: the canonical facts, on the soft panel background. */
  .outPane { background: var(--card); }
  #facts { flex: 1 1 auto; overflow-y: auto; padding: .6rem .9rem 1rem; font-family: ${MONO_STACK}; font-size: .8rem; }
  #facts .fact { display: grid; grid-template-columns: 1fr auto 1fr; gap: .5rem; align-items: baseline; padding: .3rem 0; border-bottom: 1px solid var(--line); }
  #facts .fact .subj { color: var(--ink); text-align: right; word-break: break-word; }
  #facts .fact .pred { color: var(--corpus); white-space: nowrap; }
  #facts .fact .obj { color: var(--ink); word-break: break-word; }
  #facts .fact .prov { grid-column: 1 / -1; color: var(--muted); font-size: .66rem; }
  #facts .empty { color: var(--muted); padding: .5rem 0; }

  .actions { flex: 0 0 auto; display: flex; align-items: center; gap: .6rem; padding: .6rem 1.1rem; border-top: 1px solid var(--line); flex-wrap: wrap; }
  .actions .btn { font-family: ${MONO_STACK}; font-size: .74rem; color: var(--ink); border: 1px solid var(--line); border-radius: 6px; padding: .35rem .9rem; background: var(--card); }
  .actions .btn.primary { background: var(--ink); color: var(--bg); border-color: var(--ink); }
  .actions .btn:disabled { opacity: .45; cursor: default; }
  .actions .status { margin-left: auto; font-family: ${MONO_STACK}; font-size: .7rem; color: var(--muted); }

  /* the provenance stats panel: what this session's memory holds, docked to
     the right of the ingest column (a real layout column, not an overlay) —
     the same class names and breakpoint chat-page-viz.mjs's own docked panel
     uses, re-rendered after boot and after every ingest from
     window.tmctIngest's own memoryStats(). */
  .statsPanel { flex: 0 0 300px; max-width: 300px; overflow-y: auto; border-left: 1px solid var(--line); padding: 1.1rem 1.2rem 1.6rem; font-family: ${MONO_STACK}; font-size: .74rem; line-height: 1.55; }
  .statsPanel h2 { font-size: .66rem; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); margin: 1.3rem 0 .5rem; }
  .statsPanel h2:first-child { margin-top: 0; }
  .statsPanel .band-row { display: flex; justify-content: space-between; gap: .6rem; margin: 0; padding: .12rem 0; }
  .statsPanel .band-count { color: var(--muted); font-variant-numeric: tabular-nums; }
  .statsPanel .taught-item { margin: 0 0 .7rem; }
  .statsPanel .taught-tag { display: block; color: var(--muted); font-size: .66rem; margin-top: .15rem; word-break: break-word; }
  .statsPanel .empty { color: var(--muted); margin: 0; }
  .statsPanel .forget-btn { font-family: ${MONO_STACK}; font-size: .66rem; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: .18rem .55rem; margin-top: 1.1rem; background: var(--card); }
  .statsPanel .forget-btn:hover { color: var(--ink); }
  .statsPanel .persist-note { color: var(--muted); font-size: .64rem; margin: .4rem 0 0; }

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
        <span class="eyebrow">the-mechanical-code-talker</span>
        <span class="subtitle">ingest &mdash; paste or drop text; it keeps only the facts it can ground, and skips the rest honestly</span>
      </div>
      <div class="pills" role="group" aria-label="Input mode">
        <button type="button" id="modeText" aria-pressed="true">Text</button>
        <button type="button" id="modeDoc" aria-pressed="false">Document</button>
      </div>
    </header>
    <div class="optionsRow" id="optionsRow">
      <label class="optionToggle" title="Loads chat.html's own starter memory (persona, ConceptNet, WordNet and the rest) before ingesting, so a taught fact can link into what it already knows. Off keeps the previous empty-store fast path.">
        <input type="checkbox" id="seedToggle" checked>
        seed with general knowledge
      </label>
      <label class="optionToggle" title="On a miss, also tries a copula or known relation verb flanked by two resolvable entities as a low-trust candidate fact, tagged optimistic-extract — below every curated source, and never able to corroborate one.">
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

  // ---- memory stats: the docked panel, same convention as chat.html --------
  async function renderStatsPanel(stats) {
    if (!stats) {
      if (!session || !window.tmctIngest.memoryStats) return;
      try { stats = await window.tmctIngest.memoryStats(session.memoryDir); }
      catch { return; }
    }
    renderStatsPanelInto(statsPanelEl, stats, {
      bandLabel: bandLabelFor,
      taughtHint: "nothing yet \\u2014 ingest some text and its grounded facts land here, with their source.",
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
  async function fetchSeedIfWanted() {
    if (!seedToggleEl.checked) { seedPayload = null; seedFacts = 0; return; }
    try {
      const blob = await fetchWithProgress("./chat-seed.json", (loaded, total) => noteProgress("seed", loaded, total));
      seedPayload = JSON.parse(await blob.text());
      seedFacts = (seedPayload.individuals || []).filter((i) => i.class === "Fact").length;
    } catch (err) {
      seedPayload = null;
      seedFacts = 0;
      console.warn("tmct ingest: chat-seed.json unavailable — starting unseeded", err);
    }
  }
  function cloneSeed() {
    if (!seedPayload) return null;
    try { return structuredClone(seedPayload); } catch { return JSON.parse(JSON.stringify(seedPayload)); }
  }
  function newSession() {
    return window.tmctIngest.createIngestSession({ seedPayload: cloneSeed(), vocabSeeded: Boolean(seedPayload) });
  }

  // ---- engine boot ---------------------------------------------------------
  const WINK_LOAD_TIMEOUT_MS = 8000;
  async function tryLoadWink() {
    let settled = false;
    const timeout = new Promise((_, reject) => setTimeout(() => { if (!settled) reject(new Error("wink load stalled")); }, WINK_LOAD_TIMEOUT_MS));
    try {
      const mod = await Promise.race([import("./vendor/wink.js"), timeout]);
      settled = true;
      window.tmctIngest.registerWinkModel(() => ({ winkNLP: mod.winkNLP, model: mod.model }));
      return "loaded";
    } catch (err) {
      settled = true;
      console.warn("tmct ingest: the wink vendor asset failed to load; the recognizer needs it to split and parse sentences", err);
      return "unavailable";
    }
  }

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
    session = newSession();
    clearFactsPane();
    updateIngestEnabled();
    const stats = await window.tmctIngest.memoryStats(session.memoryDir);
    statusEl.textContent = "forgot everything taught on this device \\u2014 back to the fresh seed (" + statsSummaryLine(stats, bandLabelFor) + ").";
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
    session = newSession();
    clearFactsPane();
    const stats = await window.tmctIngest.memoryStats(session.memoryDir);
    statusEl.textContent = statsSummaryLine(stats, bandLabelFor) + " \\u2014 ready.";
    await renderStatsPanel(stats);
    updateIngestEnabled();
    sourceEl.focus();
  });

  async function boot() {
    if (!window.tmctIngest) {
      statusEl.textContent = "the ingest engine didn't load \\u2014 this page needs its build step (npm run demo:build)";
      return;
    }
    seedToggleEl.checked = readSeedPref();
    const [winkStatus] = await Promise.all([
      tryLoadWink(),
      fetchSeedIfWanted(),
      fetchSiteVersion().then((v) => { siteVersion = v; }),
    ]);
    progressActive = false;
    if (window.tmctIngest.openPersistedStore) {
      persist = window.tmctIngest.openPersistedStore({ storeKey: "ingest", stamp: siteVersion + ":" + seedFacts });
    }
    const savedRecord = persist ? await persist.load() : null;
    session = savedRecord && savedRecord.payload
      ? window.tmctIngest.createIngestSession({ seedPayload: savedRecord.payload, vocabSeeded: true })
      : newSession();
    setMode(false);
    updateIngestEnabled();
    const stats = await window.tmctIngest.memoryStats(session.memoryDir);
    const winkPart = winkStatus === "loaded"
      ? "wink-nlp: loaded"
      : "wink-nlp unavailable \\u2014 the recognizer can't split sentences without it";
    statusEl.textContent = statsSummaryLine(stats, bandLabelFor) + " \\u00b7 " + winkPart
      + (savedRecord ? " \\u2014 restored from your last visit." : " \\u2014 paste or drop text, then ingest.");
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
        + (summary.skipped ? " (not a recognized fact shape \\u2014 honest, expected)" : "");
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
    if (!session || !window.tmctIngest.exportFactsJsonl) return;
    let jsonl;
    try {
      jsonl = await window.tmctIngest.exportFactsJsonl(session.memoryDir);
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

  // "reset to seed" is the full re-initialisation: drop the persisted payload
  // outright and reload, so boot re-seeds from the page's shipped seed as if
  // on a first visit.
  el("reinitStore").addEventListener("click", async () => {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (persist) await persist.clear();
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
    statusEl.textContent = "cleared";
    updateIngestEnabled();
    sourceEl.focus();
  });

  window.tmctIngestReady = boot().catch((err) => {
    console.error("tmct ingest failed to boot", err);
    statusEl.textContent = "the ingest page failed to start (" + (err && err.message ? err.message : err) + ")";
  });
})();
</script>
</body>
</html>
`;
}
