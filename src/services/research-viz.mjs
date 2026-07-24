// research-viz.mjs — research.html, the graph-BUILDING page: a self-contained
// document shaped exactly like ingest-viz.mjs/chat-page-viz.mjs's own
// page-builders — one inlined <style> importing viz-theme.mjs's shared tokens,
// behaviour as an inlined IIFE — running the research engine
// (research-browser.bundle.js's globalThis.tmctResearch) by same-origin
// relative paths.
//
// One in-memory graph grows three ways, each visible on the page:
//   1. research a term — submits "research <topic>" (the Simple English
//      Wikipedia lane) and steps its "research next" queue.
//   2. teach by telling — an ordinary teach turn ("a beagle is a kind of dog").
//   3. ingest documents — paste/drop text through the ingest recognizer.
// A highlights panel shows the facts just learned and the best-connected terms.
// The "ask the graph" box is scoped BY SOURCE: a checkbox per source (taught,
// ingested, research, each seeded corpus band), and the ask runs against only
// the checked sources — or the whole store when every box is checked. Each
// source lists the facts it added, so its learning history is on the page too.
//
// renderResearchHtml() is pure: no I/O, deterministic output for identical
// input. scripts/build-demo-site.mjs calls it directly and writes the result to
// public/research.html, after research-browser.bundle.js already exists.
import { THEME_TOKENS_CSS, SERIF_STACK, MONO_STACK, escapeHtml } from "./viz-theme.mjs";
import { fetchWithProgress } from "./memory-panel-viz.mjs";
import { createTicker, prefersReducedMotion } from "./viz-ticker.mjs";

const DEFAULT_TITLE = "the-mechanical-code-talker — research";

/** The human label + short colour key for one source snapshot entry
 *  ({ key, band }). A seed band folds to a readable corpus name; the three
 *  growth sources get their own words. Pure and `.toString()`-splice safe. */
export function sourceLabelFor(source) {
  const BANDS = {
    human: "human persona", "human-medium": "human persona", "human-large": "human persona",
    seon: "SEON ontology", conceptnet: "ConceptNet",
    "tier2-aws": "AWS", "tier2-python": "Python", "tier2-java": "Java", "wordnet-xl": "WordNet",
  };
  const key = (source && source.key) || "";
  if (key === "taught") return { label: "taught by telling", tone: "taught" };
  if (key === "ingest") return { label: "ingested documents", tone: "ingest" };
  if (key === "research") return { label: "wikipedia research", tone: "research" };
  if (key === "other") return { label: "derived / other", tone: "seed" };
  const band = (source && source.band) || "";
  return { label: (BANDS[band] || band || "seed") + " (seed corpus)", tone: "seed" };
}

/** One learned fact as its three canonical cells plus a source tone, for the
 *  highlights and history lists. Pure, `.toString()`-splice safe. */
export function factTripleParts(fact) {
  return {
    subject: String((fact && fact.subject) || ""),
    predicate: String((fact && fact.predicate) || ""),
    object: String((fact && fact.object) || ""),
    source: String((fact && fact.source) || ""),
  };
}

/** The boot statusline while the big assets stream in — the same aggregator
 *  ingest-viz.mjs's own loadProgressLine is. `parts` is an array of
 *  { loaded, total } byte counts. Self-contained, `.toString()`-splice safe. */
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

/** The self-contained research page. Pure — the same output for the same
 *  input every time; every piece of state is computed live in the browser once
 *  the sibling research bundle loads. `digestStructures` are the pre-parsed
 *  [[structure]] rows of the digest sentence-structure bank, embedded so the
 *  page can digest a term client-side over its grown store (no TOML parser in
 *  the browser); an empty list leaves the digest panel degrading to an honest
 *  "no digest available" the same way the node stub does. */
export function renderResearchHtml({ title = DEFAULT_TITLE, digestStructures = [] } = {}) {
  const digestStructuresJson = JSON.stringify(Array.isArray(digestStructures) ? digestStructures : []);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<!--
  The wink lemma/POS tier loads from ./vendor/wink.js — the site's own shared
  first-party bundle (built by scripts/build-wink-vendor.mjs), one cached copy
  for every page, no CDN. The research engine needs wink to split and parse the
  sentences it grounds; a failed load degrades to the curated tiers, never an
  error.
-->
<style>
${THEME_TOKENS_CSS}
  html, body { min-height: 100%; }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: ${SERIF_STACK}; font-size: 16px; line-height: 1.5; }
  .mono { font-family: ${MONO_STACK}; }
  button { font: inherit; color: inherit; background: none; cursor: pointer; border: none; }
  button:focus-visible, textarea:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
  a { color: var(--corpus); }

  .wrap { max-width: 1100px; margin: 0 auto; padding: 1.1rem 1.1rem 3rem; }

  header.topbar { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; flex-wrap: wrap; margin-bottom: 1rem; }
  .brand { display: flex; flex-direction: column; gap: .12rem; }
  .eyebrow { font-family: ${MONO_STACK}; font-size: .78rem; letter-spacing: .08em; color: var(--muted); }
  .subtitle { font-size: .86rem; color: var(--muted); max-width: 46ch; }
  .status { font-family: ${MONO_STACK}; font-size: .68rem; color: var(--muted); }

  h2.band { font-family: ${MONO_STACK}; font-size: .7rem; letter-spacing: .09em; text-transform: uppercase; color: var(--muted); margin: 1.6rem 0 .7rem; border-bottom: 1px solid var(--line); padding-bottom: .35rem; }

  /* the three ways to grow the graph — three cards in one row, stacking on a
     narrow screen. */
  .grow { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--line); border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  .grow .card { background: var(--bg); padding: .9rem 1rem 1.1rem; display: flex; flex-direction: column; gap: .55rem; min-width: 0; }
  .grow .card h3 { margin: 0; font-size: .95rem; }
  .grow .card .hint { font-size: .76rem; color: var(--muted); margin: 0; }
  .grow .card .tone { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: .35rem; vertical-align: baseline; }
  .tone-taught { background: var(--taught); } .tone-ingest { background: var(--entail); }
  .tone-research { background: var(--corpus); } .tone-seed { background: var(--muted); }

  .grow input[type="text"], .grow textarea { width: 100%; box-sizing: border-box; font-family: ${MONO_STACK}; font-size: .8rem; background: var(--card); color: var(--ink); border: 1px solid var(--line); border-radius: 6px; padding: .4rem .55rem; }
  .grow textarea { resize: vertical; min-height: 5.5rem; line-height: 1.5; }
  .grow input::placeholder, .grow textarea::placeholder { color: var(--muted); }
  .row { display: flex; gap: .5rem; align-items: center; flex-wrap: wrap; }
  .btn { font-family: ${MONO_STACK}; font-size: .72rem; color: var(--ink); border: 1px solid var(--line); border-radius: 6px; padding: .32rem .8rem; background: var(--card); }
  .btn.primary { background: var(--ink); color: var(--bg); border-color: var(--ink); }
  .btn:disabled { opacity: .45; cursor: default; }
  .card .note { font-family: ${MONO_STACK}; font-size: .68rem; color: var(--muted); min-height: 1rem; }
  .optionToggle { display: inline-flex; align-items: center; gap: .35rem; font-family: ${MONO_STACK}; font-size: .68rem; color: var(--muted); cursor: pointer; }
  .optionToggle input { margin: 0; accent-color: var(--corpus); }
  .knobs { display: flex; gap: .9rem; align-items: center; flex-wrap: wrap; }
  .knob { display: inline-flex; align-items: center; gap: .4rem; font-family: ${MONO_STACK}; font-size: .68rem; color: var(--muted); }
  .knob input[type="number"] { width: 3.4rem; font-family: ${MONO_STACK}; font-size: .74rem; background: var(--card); color: var(--ink); border: 1px solid var(--line); border-radius: 6px; padding: .25rem .35rem; text-align: right; }

  /* highlights + ask, two columns */
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 1.4rem; align-items: start; }

  .panel { border: 1px solid var(--line); border-radius: 10px; padding: .9rem 1rem 1rem; background: var(--card); }
  .panel h3 { margin: 0 0 .6rem; font-size: .9rem; }
  .panel .empty { color: var(--muted); font-size: .8rem; margin: .3rem 0; }

  .fact { display: grid; grid-template-columns: auto 1fr auto 1fr; gap: .45rem; align-items: baseline; padding: .28rem 0; border-bottom: 1px solid var(--line); font-family: ${MONO_STACK}; font-size: .76rem; }
  .fact:last-child { border-bottom: none; }
  .fact .dot { width: 7px; height: 7px; border-radius: 50%; align-self: center; }
  .fact .subj { color: var(--ink); word-break: break-word; }
  .fact .pred { color: var(--corpus); white-space: nowrap; }
  .fact .obj { color: var(--ink); word-break: break-word; }

  .chips { display: flex; flex-wrap: wrap; gap: .4rem; }
  .chip { font-family: ${MONO_STACK}; font-size: .74rem; border: 1px solid var(--line); border-radius: 99px; padding: .2rem .6rem; background: var(--bg); }
  .chip.tapchip { cursor: pointer; }
  .chip.tapchip:hover { border-color: var(--ink); }
  .chip .deg { color: var(--muted); margin-left: .35rem; }

  /* the term digest: a narrative card, its sources, and the flat fact list one
     click away behind "show the facts". */
  .digestpanel .hint { font-size: .78rem; color: var(--muted); margin: 0 0 .55rem; }
  .digestout { min-height: 1.4rem; }
  .digestout .empty { color: var(--muted); font-size: .82rem; margin: .2rem 0; }
  .digestout .miss { color: var(--muted); font-size: .88rem; border: 1px dashed var(--line); border-radius: 8px; padding: .55rem .7rem; }
  .dgcard { border: 1px solid var(--line); border-radius: 8px; padding: .7rem .85rem .8rem; background: var(--bg); }
  .dgterm { font-family: ${MONO_STACK}; font-size: .72rem; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); margin-bottom: .4rem; }
  .dgcard p { margin: 0 0 .5rem; font-size: .95rem; }
  .dgcard p:last-of-type { margin-bottom: 0; }
  .dgsrc { font-family: ${MONO_STACK}; font-size: .7rem; color: var(--muted); word-break: break-word; }
  .dgfacts { margin-top: .6rem; }
  .dgfacts > summary { font-family: ${MONO_STACK}; font-size: .72rem; color: var(--corpus); cursor: pointer; list-style: revert; }
  .dgfacts[open] > summary { margin-bottom: .35rem; }
  .dgfacts .factlist { border-top: 1px solid var(--line); }

  /* ask, scoped by source */
  .askRow { display: flex; gap: .5rem; margin: .2rem 0 .7rem; }
  .askRow input { flex: 1; min-width: 0; font-family: ${SERIF_STACK}; font-size: .92rem; background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 8px; padding: .45rem .7rem; }
  #answer { font-size: .9rem; white-space: pre-wrap; word-break: break-word; padding: .55rem .7rem; border-radius: 8px; background: var(--bg); border: 1px solid var(--line); min-height: 1.4rem; }
  #answer.miss { color: var(--muted); border-style: dashed; }
  .sourcesHead { display: flex; align-items: baseline; justify-content: space-between; gap: .6rem; margin: .2rem 0 .5rem; }
  .sourcesHead .toggleAll { font-family: ${MONO_STACK}; font-size: .66rem; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: .12rem .5rem; background: var(--bg); }

  details.source { border-bottom: 1px solid var(--line); }
  details.source:last-of-type { border-bottom: none; }
  details.source > summary { list-style: none; display: flex; align-items: center; gap: .5rem; padding: .35rem 0; cursor: pointer; font-family: ${MONO_STACK}; font-size: .78rem; }
  details.source > summary::-webkit-details-marker { display: none; }
  details.source > summary .srcLabel { flex: 1; display: inline-flex; align-items: center; gap: .4rem; }
  details.source > summary input { margin: 0; accent-color: var(--corpus); }
  details.source > summary .count { color: var(--muted); font-variant-numeric: tabular-nums; }
  details.source > summary .caret { color: var(--muted); font-size: .7rem; }
  .srcHistory { padding: .1rem 0 .6rem 1.4rem; }
  .srcHistory .empty { font-size: .74rem; }

  .toolsRow { display: flex; gap: .5rem; margin-top: 1.2rem; flex-wrap: wrap; }
  .toolsRow .btn { font-size: .7rem; }

  @media (max-width: 820px) {
    .grow { grid-template-columns: 1fr; }
    .cols { grid-template-columns: 1fr; }
  }
  @media (prefers-reduced-motion: reduce) { * { scroll-behavior: auto !important; } }
</style>
</head>
<body>
  <div class="wrap">
    <header class="topbar">
      <div class="brand">
        <span class="eyebrow">the-mechanical-code-talker</span>
        <span class="subtitle">research &mdash; grow one graph three ways, watch what it learns, and ask it a question scoped to the sources you trust.</span>
      </div>
      <span class="status" id="status">loading the engine&hellip;</span>
    </header>

    <h2 class="band">grow the graph</h2>
    <section class="grow">
      <div class="card">
        <h3><span class="tone tone-research"></span>research a term</h3>
        <p class="hint">Fetches the topic from Simple English Wikipedia and stores the facts it grounds, then queues the topics its lead section links to. Asking is the consent for these fetches.</p>
        <div class="row">
          <input id="researchTopic" type="text" autocomplete="off" spellcheck="false" placeholder="a topic, e.g. owls" aria-label="Topic to research">
          <button type="button" class="btn primary" id="researchGo" disabled>research</button>
          <button type="button" class="btn" id="researchNext" hidden>research next</button>
          <button type="button" class="btn" id="researchPlay" aria-pressed="false" hidden>play</button>
        </div>
        <div class="knobs">
          <label class="knob" title="How many topics one research run may fetch and store in total (the first topic counts as one). A deep run stops fetching once it reaches this budget.">
            max nodes <input id="researchNodes" type="number" min="1" max="50" step="1" value="12" inputmode="numeric" aria-label="Maximum response nodes">
          </label>
          <label class="knob" title="How deep the link fan-out follows: depth 1 is the topic's own lead links, depth 2 those topics' links, and so on. Applies to the next run you start.">
            max depth <input id="researchDepth" type="number" min="1" max="3" step="1" value="1" inputmode="numeric" aria-label="Maximum node depth">
          </label>
        </div>
        <p class="note" id="researchNote"></p>
      </div>
      <div class="card">
        <h3><span class="tone tone-taught"></span>teach by telling</h3>
        <p class="hint">Type a plain fact and it is stored if the recognizer can ground it &mdash; &ldquo;a beagle is a kind of dog&rdquo;, &ldquo;a dog has a tail&rdquo;. No guessing: an unrecognized sentence is skipped, honestly.</p>
        <div class="row">
          <input id="teachInput" type="text" autocomplete="off" spellcheck="false" placeholder="a beagle is a kind of dog" aria-label="A fact to teach">
          <button type="button" class="btn primary" id="teachGo" disabled>teach</button>
        </div>
        <p class="note" id="teachNote"></p>
      </div>
      <div class="card">
        <h3><span class="tone tone-ingest"></span>ingest documents</h3>
        <p class="hint">Paste or drop text; it keeps only the sentences it can ground as facts and skips the rest. The same recognizer the ingest page runs.</p>
        <textarea id="ingestText" spellcheck="false" placeholder="Paste a paragraph or drop a .txt/.md file here." aria-label="Text to ingest"></textarea>
        <div class="row">
          <button type="button" class="btn primary" id="ingestGo" disabled>ingest</button>
          <button type="button" class="btn" id="ingestBrowse">browse&hellip;</button>
          <input type="file" id="ingestFile" accept=".txt,.md,text/plain,text/markdown" hidden>
          <label class="optionToggle" title="On a miss, also tries a copula or known relation verb flanked by two resolvable entities as a low-trust candidate, tagged optimistic-extract — below every curated source.">
            <input type="checkbox" id="fuzzyToggle"> fuzzy tier
          </label>
        </div>
        <p class="note" id="ingestNote"></p>
      </div>
    </section>

    <h2 class="band">highlights</h2>
    <div class="cols">
      <div class="panel">
        <h3>recently learned</h3>
        <div id="recentList"><p class="empty">Nothing learned yet this session. Research a term, teach a fact, or ingest some text above.</p></div>
      </div>
      <div class="panel">
        <h3>best-connected terms</h3>
        <div class="chips" id="hubsList"><p class="empty">The graph's hubs appear here as it grows.</p></div>
      </div>
    </div>

    <h2 class="band">read a term back</h2>
    <div class="panel digestpanel">
      <p class="hint">Pick a term the graph knows and it reads back a short narrative &mdash; the facts it holds, composed into sentences with the sources named, deterministic and never a guess. The full fact list stays one click away behind &ldquo;show the facts&rdquo;.</p>
      <div class="askRow">
        <input id="digestInput" type="text" autocomplete="off" spellcheck="false" placeholder="a term the graph knows, e.g. dog" aria-label="A term to read back as a digest" disabled>
        <button type="button" class="btn primary" id="digestGo" disabled>digest</button>
      </div>
      <div id="digestOut" class="digestout" aria-live="polite"><p class="empty">Ask for a digest, or click a term under &ldquo;best-connected terms&rdquo; above.</p></div>
    </div>

    <h2 class="band">ask the graph</h2>
    <div class="cols">
      <div class="panel">
        <h3>ask a question</h3>
        <div class="askRow">
          <input id="askInput" type="text" autocomplete="off" spellcheck="false" placeholder="what is a dog" aria-label="Ask the graph a question" disabled>
          <button type="button" class="btn primary" id="askGo" disabled>ask</button>
        </div>
        <div id="answer" aria-live="polite">Ask the graph a question. The answer is drawn only from the sources you check on the right.</div>
      </div>
      <div class="panel">
        <div class="sourcesHead">
          <h3 style="margin:0">scope by source</h3>
          <button type="button" class="toggleAll" id="toggleAll">all / none</button>
        </div>
        <div id="sourcesList"><p class="empty">loading sources&hellip;</p></div>
      </div>
    </div>

    <div class="toolsRow">
      <button type="button" class="btn" id="exportFacts" disabled>export facts (JSONL)</button>
      <button type="button" class="btn" id="resetBtn">reset the graph</button>
    </div>
  </div>

<script src="./research-browser.bundle.js"></script>
<script>
(function () {
  "use strict";
  const loadProgressLine = ${loadProgressLine.toString()};
  const sourceLabelFor = ${sourceLabelFor.toString()};
  const factTripleParts = ${factTripleParts.toString()};
  const fetchWithProgress = ${fetchWithProgress.toString()};
  const createTicker = ${createTicker.toString()};
  const prefersReducedMotion = ${prefersReducedMotion.toString()};
  const el = (id) => document.getElementById(id);
  // The digest sentence-structure bank, pre-parsed at build time — the browser
  // has no TOML parser, so the page carries the table the client-side digest
  // composes from.
  const DIGEST_STRUCTURES = ${digestStructuresJson};

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./tmct-sw.js").catch(() => {});

  const statusEl = el("status");
  let session = null;
  let researchQueue = null;   // the engine's latest research snapshot, null when no run stands
  const checkedSources = new Set(); // source keys currently checked for the ask

  // ---- boot --------------------------------------------------------------
  const WINK_LOAD_TIMEOUT_MS = 8000;
  const progressParts = {};
  let progressActive = true;
  function noteProgress(key, loaded, total) {
    progressParts[key] = { loaded: loaded, total: total };
    if (progressActive) statusEl.textContent = loadProgressLine(Object.values(progressParts));
  }

  async function tryLoadWink() {
    let settled = false;
    const timeout = new Promise((_, reject) => setTimeout(() => { if (!settled) reject(new Error("wink load stalled")); }, WINK_LOAD_TIMEOUT_MS));
    try {
      const mod = await Promise.race([import("./vendor/wink.js"), timeout]);
      settled = true;
      window.tmctResearch.registerWinkModel(() => ({ winkNLP: mod.winkNLP, model: mod.model }));
      return "loaded";
    } catch (err) {
      settled = true;
      console.warn("tmct research: the wink vendor asset failed to load", err);
      return "unavailable";
    }
  }

  let seedPayload = null;
  let seedFacts = 0;
  async function fetchSeed() {
    try {
      const blob = await fetchWithProgress("./chat-seed.json", (loaded, total) => noteProgress("seed", loaded, total));
      seedPayload = JSON.parse(await blob.text());
      seedFacts = (seedPayload.individuals || []).filter((i) => i.class === "Fact").length;
    } catch (err) {
      seedPayload = null;
      console.warn("tmct research: chat-seed.json unavailable — starting unseeded", err);
    }
  }
  const cloneSeed = () => {
    if (!seedPayload) return null;
    try { return structuredClone(seedPayload); } catch { return JSON.parse(JSON.stringify(seedPayload)); }
  };
  function newSession() {
    return window.tmctResearch.createResearchSession({ seedPayload: cloneSeed(), vocabSeeded: Boolean(seedPayload), digestStructures: DIGEST_STRUCTURES });
  }

  // The curated reference pack provider, same fetch seam chat.html registers,
  // so a research/teach miss can still reach a shipped article where one exists.
  let packIndexPromise = null;
  function fetchPackIndex() {
    if (!packIndexPromise) {
      packIndexPromise = fetch("./reference-pack/index.json").then((res) => (res.ok ? res.json() : null)).catch(() => null);
    }
    return packIndexPromise;
  }
  const fetchPackProvider = {
    async lookup(normTerm) {
      const index = await fetchPackIndex();
      const id = index && index.terms ? index.terms[String(normTerm || "")] : null;
      if (!id) return null;
      try {
        const res = await fetch("./reference-pack/articles/" + id + ".json");
        return res.ok ? await res.json() : null;
      } catch { return null; }
    },
  };

  async function boot() {
    if (!window.tmctResearch) {
      statusEl.textContent = "the research engine didn't load — this page needs its build step (npm run demo:build)";
      return;
    }
    const [winkStatus] = await Promise.all([tryLoadWink(), fetchSeed()]);
    progressActive = false;
    window.tmctResearch.registerReferencePackProvider(fetchPackProvider);
    session = newSession();
    const winkPart = winkStatus === "loaded" ? "wink-nlp: loaded" : "wink-nlp unavailable — curated tiers only";
    statusEl.textContent = (seedPayload ? seedFacts + " seed facts" : "no seed") + " · " + winkPart + " — ready.";
    enableInputs();
    await refresh();
  }

  function enableInputs() {
    el("researchGo").disabled = false;
    el("teachGo").disabled = false;
    el("ingestGo").disabled = false;
    el("askInput").disabled = false;
    el("askGo").disabled = false;
    el("digestInput").disabled = false;
    el("digestGo").disabled = false;
    el("exportFacts").disabled = false;
  }

  // ---- refresh the panels from one snapshot ------------------------------
  async function refresh() {
    if (!session) return;
    let snap;
    try { snap = await window.tmctResearch.researchSnapshot(session.memoryDir, session.sessionIds); }
    catch (err) { console.warn("tmct research: snapshot failed", err); return; }
    renderRecent(snap.recent);
    renderHubs(snap.hubs);
    renderSources(snap.sources, snap.history);
  }

  function factRow(fact) {
    const parts = factTripleParts(fact);
    const tone = sourceLabelFor({ key: parts.source, band: parts.source.indexOf("seed:") === 0 ? parts.source.slice(5) : "" }).tone;
    const row = document.createElement("div");
    row.className = "fact";
    const dot = document.createElement("span");
    dot.className = "dot tone-" + tone;
    const subj = document.createElement("span"); subj.className = "subj"; subj.textContent = parts.subject;
    const pred = document.createElement("span"); pred.className = "pred"; pred.textContent = parts.predicate;
    const obj = document.createElement("span"); obj.className = "obj"; obj.textContent = parts.object;
    row.appendChild(dot); row.appendChild(subj); row.appendChild(pred); row.appendChild(obj);
    return row;
  }

  function renderRecent(recent) {
    const box = el("recentList");
    box.textContent = "";
    if (!recent || !recent.length) {
      const p = document.createElement("p"); p.className = "empty";
      p.textContent = "Nothing learned yet this session. Research a term, teach a fact, or ingest some text above.";
      box.appendChild(p);
      return;
    }
    for (const fact of recent) box.appendChild(factRow(fact));
  }

  function renderHubs(hubs) {
    const box = el("hubsList");
    box.textContent = "";
    if (!hubs || !hubs.length) {
      const p = document.createElement("p"); p.className = "empty";
      p.textContent = "The graph's hubs appear here as it grows.";
      box.appendChild(p);
      return;
    }
    for (const hub of hubs) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "chip tapchip";
      chip.setAttribute("aria-label", "read a digest of " + hub.term);
      chip.appendChild(document.createTextNode(hub.term));
      const deg = document.createElement("span");
      deg.className = "deg";
      deg.textContent = hub.degree + (hub.degree === 1 ? " fact" : " facts");
      chip.appendChild(deg);
      chip.addEventListener("click", () => { el("digestInput").value = hub.term; digest(); });
      box.appendChild(chip);
    }
  }

  function renderSources(sources, history) {
    const box = el("sourcesList");
    box.textContent = "";
    // Keep the checked set current: default a brand-new source to checked, drop
    // any source that has vanished.
    const present = new Set();
    for (const s of sources || []) {
      present.add(s.key);
      if (!checkedSources.has(s.key + ":seen")) { checkedSources.add(s.key); checkedSources.add(s.key + ":seen"); }
    }
    for (const k of [...checkedSources]) {
      const base = k.replace(/:seen$/, "");
      if (!present.has(base)) checkedSources.delete(k);
    }
    if (!sources || !sources.length) {
      const p = document.createElement("p"); p.className = "empty";
      p.textContent = "No facts yet — grow the graph above, then scope your question here.";
      box.appendChild(p);
      return;
    }
    for (const s of sources) {
      const info = sourceLabelFor(s);
      const det = document.createElement("details");
      det.className = "source";
      const sum = document.createElement("summary");
      const labelWrap = document.createElement("span");
      labelWrap.className = "srcLabel";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = checkedSources.has(s.key);
      cb.setAttribute("data-key", s.key);
      cb.addEventListener("click", (e) => e.stopPropagation());
      cb.addEventListener("change", () => {
        if (cb.checked) checkedSources.add(s.key); else checkedSources.delete(s.key);
      });
      const dot = document.createElement("span");
      dot.className = "tone tone-" + info.tone;
      dot.style.cssText = "display:inline-block;width:8px;height:8px;border-radius:50%";
      const name = document.createElement("span");
      name.textContent = info.label;
      labelWrap.appendChild(cb); labelWrap.appendChild(dot); labelWrap.appendChild(name);
      const count = document.createElement("span");
      count.className = "count";
      count.textContent = s.count + (s.count === 1 ? " fact" : " facts");
      const caret = document.createElement("span");
      caret.className = "caret";
      caret.textContent = "history";
      sum.appendChild(labelWrap); sum.appendChild(count); sum.appendChild(caret);
      det.appendChild(sum);
      const hist = document.createElement("div");
      hist.className = "srcHistory";
      const rows = (history && history[s.key]) || [];
      if (!rows.length) {
        const p = document.createElement("p"); p.className = "empty";
        p.textContent = "no facts recorded from this source yet.";
        hist.appendChild(p);
      } else {
        for (const row of rows) hist.appendChild(factRow(row));
      }
      det.appendChild(hist);
      box.appendChild(det);
    }
  }

  el("toggleAll").addEventListener("click", () => {
    const boxes = [...el("sourcesList").querySelectorAll('input[type="checkbox"]')];
    const anyUnchecked = boxes.some((b) => !b.checked);
    for (const b of boxes) {
      b.checked = anyUnchecked;
      const key = b.getAttribute("data-key");
      if (anyUnchecked) checkedSources.add(key); else checkedSources.delete(key);
    }
  });

  // ---- ask, scoped by source ---------------------------------------------
  async function ask() {
    const q = el("askInput").value.trim();
    if (!q || !session) return;
    const boxes = [...el("sourcesList").querySelectorAll('input[type="checkbox"]')];
    const checked = boxes.filter((b) => b.checked).map((b) => b.getAttribute("data-key"));
    // Every box checked (or none present) -> ask the whole store; a subset ->
    // scope to those keys. No box checked -> honest miss, nothing to ask.
    const allChecked = boxes.length > 0 && checked.length === boxes.length;
    const answerEl = el("answer");
    if (boxes.length && checked.length === 0) {
      answerEl.className = "miss";
      answerEl.textContent = "No source is checked — check at least one on the right to ask against it.";
      return;
    }
    answerEl.className = "";
    answerEl.textContent = "thinking…";
    let res;
    try { res = await session.ask(q, { sources: allChecked ? null : checked }); }
    catch (err) { res = { text: "", miss: true }; }
    if (res.miss || !res.text) {
      answerEl.className = "miss";
      const scope = allChecked ? "any checked source" : "the " + checked.length + " checked source" + (checked.length === 1 ? "" : "s");
      answerEl.textContent = "No grounded answer from " + scope + ". It abstains rather than guess.";
    } else {
      answerEl.className = "";
      answerEl.textContent = res.text;
    }
  }
  el("askGo").addEventListener("click", ask);
  el("askInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ask(); } });

  // ---- digest a term: the narrative read-back over the grown store ---------
  function renderDigestFact(fact) {
    const row = document.createElement("div");
    row.className = "fact";
    const dot = document.createElement("span"); dot.className = "dot tone-seed";
    const subj = document.createElement("span"); subj.className = "subj"; subj.textContent = String(fact.subject || "");
    const pred = document.createElement("span"); pred.className = "pred"; pred.textContent = String(fact.predicate || "");
    const obj = document.createElement("span"); obj.className = "obj"; obj.textContent = String(fact.object || "");
    row.appendChild(dot); row.appendChild(subj); row.appendChild(pred); row.appendChild(obj);
    return row;
  }
  function renderDigest(term, view) {
    const box = el("digestOut");
    box.textContent = "";
    if (!view) {
      const p = document.createElement("p"); p.className = "miss";
      p.textContent = 'No grounded digest for "' + term + '" — nothing is stored about it, or nothing the digest could compose. It abstains rather than guess.';
      box.appendChild(p);
      return;
    }
    const card = document.createElement("div"); card.className = "dgcard";
    const head = document.createElement("div"); head.className = "dgterm mono"; head.textContent = view.term || term;
    card.appendChild(head);
    for (const para of view.paragraphs) {
      const p = document.createElement("p"); p.textContent = para; card.appendChild(p);
    }
    if (view.sources && view.sources.length) {
      const src = document.createElement("p"); src.className = "dgsrc";
      src.textContent = "(sources: " + view.sources.join("; ") + ")";
      card.appendChild(src);
    }
    const facts = view.facts || [];
    if (facts.length) {
      const det = document.createElement("details"); det.className = "dgfacts";
      const sum = document.createElement("summary");
      sum.textContent = "show the facts (" + view.factCount + ")";
      det.appendChild(sum);
      const list = document.createElement("div"); list.className = "factlist";
      for (const f of facts) list.appendChild(renderDigestFact(f));
      det.appendChild(list);
      card.appendChild(det);
    }
    box.appendChild(card);
  }
  async function digest() {
    const term = el("digestInput").value.trim();
    if (!term || !session) return;
    const box = el("digestOut");
    box.textContent = "";
    const wait = document.createElement("p"); wait.className = "empty"; wait.textContent = "reading it back…";
    box.appendChild(wait);
    let view = null;
    try { view = await session.digest(term); } catch { view = null; }
    renderDigest(term, view);
  }
  el("digestGo").addEventListener("click", digest);
  el("digestInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); digest(); } });

  // ---- grow: teach by telling --------------------------------------------
  async function teach() {
    const q = el("teachInput").value.trim();
    if (!q || !session) return;
    const note = el("teachNote");
    note.textContent = "…";
    let res;
    try { res = await session.turn(q); } catch { res = null; }
    if (res && res.record && res.record.via === "assert" && !res.record.miss) {
      note.textContent = "stored: " + (res.answer || "remembered.");
      el("teachInput").value = "";
    } else {
      note.textContent = res && res.answer ? res.answer : "not a recognized fact shape — nothing stored.";
    }
    await refresh();
  }
  el("teachGo").addEventListener("click", teach);
  el("teachInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); teach(); } });

  // ---- grow: ingest documents --------------------------------------------
  async function ingest() {
    const text = el("ingestText").value.trim();
    if (!text || !session) return;
    const note = el("ingestNote");
    note.textContent = "reading…";
    let summary;
    try { summary = await session.ingest(text, { optimistic: el("fuzzyToggle").checked }); }
    catch (err) { note.textContent = "something went wrong reading that."; return; }
    note.textContent = summary.sentences + " sentence" + (summary.sentences === 1 ? "" : "s")
      + " read, " + summary.recognized + " grounded, " + summary.skipped + " skipped.";
    await refresh();
  }
  el("ingestGo").addEventListener("click", ingest);
  el("ingestBrowse").addEventListener("click", () => el("ingestFile").click());
  el("ingestFile").addEventListener("change", async () => {
    const file = el("ingestFile").files && el("ingestFile").files[0];
    el("ingestFile").value = "";
    if (!file) return;
    try { el("ingestText").value = await file.text(); }
    catch { el("ingestNote").textContent = "couldn't read that file."; }
  });

  // ---- grow: research a term + its queue ----------------------------------
  const RESEARCH_TICK_MS = 2400;
  const researchTicker = createTicker({
    onTick: async () => { await researchStep("research next"); },
    hasNext: () => Boolean(researchQueue && !researchQueue.complete),
    onRender: renderResearchControls,
    waitMs: RESEARCH_TICK_MS,
  });

  function renderResearchControls(tickState) {
    const state = tickState || researchTicker.getState();
    const active = Boolean(researchQueue && !researchQueue.complete);
    el("researchNext").hidden = !active;
    el("researchPlay").hidden = !active;
    el("researchPlay").textContent = state.playing ? "pause" : "play";
    el("researchPlay").setAttribute("aria-pressed", String(state.playing));
    const note = el("researchNote");
    if (!researchQueue) { /* leave whatever the last turn's note said */ }
    else {
      const depth = researchQueue.maxDepth || 1;
      const budget = researchQueue.maxTopics || 0;
      const knobs = " (depth " + depth + (budget ? ", budget " + budget : "") + ")";
      const capped = researchQueue.nodeCapReached ? " — node budget reached" : "";
      if (researchQueue.complete) {
        note.textContent = 'research "' + researchQueue.topic + '" complete — '
          + researchQueue.done.length + " topic" + (researchQueue.done.length === 1 ? "" : "s") + " grounded" + knobs + capped + ".";
      } else {
        note.textContent = 'research "' + researchQueue.topic + '": '
          + researchQueue.done.length + " done · " + researchQueue.pending.length + " queued" + knobs + capped + ".";
      }
    }
  }

  // Read the two node knobs off the page and hand them to the session for the
  // NEXT run started. A run already going keeps the knobs it captured.
  function applyResearchConfig() {
    if (!session || !session.setResearchConfig) return;
    session.setResearchConfig({
      maxTopics: parseInt(el("researchNodes").value, 10),
      maxDepth: parseInt(el("researchDepth").value, 10),
    });
  }

  async function researchStep(line) {
    if (!session) return;
    let res;
    try { res = await session.turn(line); } catch { res = null; }
    if (res && res.research !== undefined) {
      researchQueue = res.research;
      renderResearchControls();
    } else if (res && res.answer) {
      el("researchNote").textContent = res.answer.split("\\n")[0];
    }
    await refresh();
    return res;
  }

  async function startResearch() {
    const topic = el("researchTopic").value.trim();
    if (!topic || !session) return;
    applyResearchConfig();
    el("researchTopic").value = "";
    el("researchNote").textContent = 'researching "' + topic + '"…';
    const previous = researchQueue;
    await researchStep("research " + topic);
    const fresh = Boolean(researchQueue && !researchQueue.complete && (!previous || previous.complete || previous.topic !== researchQueue.topic));
    if (fresh && !prefersReducedMotion() && !researchTicker.getState().playing) researchTicker.play();
  }
  el("researchGo").addEventListener("click", startResearch);
  el("researchTopic").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); startResearch(); } });
  el("researchNext").addEventListener("click", () => researchStep("research next"));
  el("researchPlay").addEventListener("click", () => {
    if (researchTicker.getState().playing) researchTicker.pause(); else researchTicker.play();
  });

  // ---- tools --------------------------------------------------------------
  el("exportFacts").addEventListener("click", async () => {
    if (!session || !window.tmctResearch.exportFactsJsonl) return;
    let jsonl;
    try { jsonl = await window.tmctResearch.exportFactsJsonl(session.memoryDir); }
    catch { return; }
    const blob = new Blob([jsonl], { type: "application/x-ndjson" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = "tmct-facts.jsonl";
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  el("resetBtn").addEventListener("click", async () => {
    researchTicker.pause();
    researchQueue = null;
    checkedSources.clear();
    session = newSession();
    el("teachNote").textContent = "";
    el("ingestNote").textContent = "";
    el("researchNote").textContent = "";
    el("answer").className = "";
    el("answer").textContent = "Ask the graph a question. The answer is drawn only from the sources you check on the right.";
    renderResearchControls();
    await refresh();
  });

  window.tmctResearchReady = boot().catch((err) => {
    console.error("tmct research failed to boot", err);
    statusEl.textContent = "the research page failed to start (" + (err && err.message ? err.message : err) + ")";
  });
})();
</script>
</body>
</html>
`;
}
