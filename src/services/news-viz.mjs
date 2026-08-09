// news-viz.mjs — news.html: a dashboard over the news capability
// (PLAN_NEWS_FEED.md section 13), on the ledger.html dashboard precedent
// (src/services/ledger-viz.mjs: `.dash`/`.kpirow`/`.tile`/`.tile-bars`, the
// same THEME_TOKENS_CSS palette) with chat.html's seed-loading shell
// (src/services/chat-page-viz.mjs: SEED_STAMP/SEED_BYTES, the tmct.seed
// phase pill, loadSeedPayload/fetchWithProgress).
//
// The page's one behavioural promise, restated everywhere it matters: NO
// third-party request fires before the visitor presses start (or, on a
// returning visit, before the page replays that same consent). Every
// `https://` string this renderer emits — every source's homepage link, the
// embedded source-registry JSON the source-toggle list reads — sits inside
// the ONE fenced block `<!-- sources:start -->` … `<!-- sources:end -->`, so
// that promise is mechanically checkable: nothing outside that block ever
// names a third party.
//
// Every fetched or user-supplied string this page will ever show (a feed
// item's title/summary, a source's display name, an uploaded fact row) goes
// through escapeHtml at render time — the second half of the two-layer
// sanitisation rule (constitution, PLAN_NEWS_FEED.md section 3); the first
// half (stripMarkup at parse time) already ran in the domain/adapter layers
// this page's engine calls.
import {
  THEME_TOKENS_CSS, MONO_STACK, escapeHtml, embedJson, demoEyebrowHtml, EYEBROW_LINKS_CSS,
} from "./viz-theme.mjs";
import { loadSeedPayload, fetchWithProgress, factTripleParts } from "./memory-panel-viz.mjs";
import { predicatePhrase, factSentence, FACT_PREDICATE_PHRASES } from "../domain/fact-phrase.mjs";
import { NEWS_SOURCE_RECORDS } from "../adapters/corpus/news-sources.mjs";

const DEFAULT_TITLE = "tmct news — a dashboard over the graph, fed on your say-so";

const DASH_SANS_STACK = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;

/** One `.tile` cell for the KPI row — the zero-state every tile renders in
 *  before the first poll, since the dashboard's own JS overwrites every
 *  number once the session opens. Static markup only; the live numbers are
 *  a client-side re-render (see the inline script's `renderAll`). */
function kpiTileHtml(label, id) {
  return `<div class="tile" id="${escapeHtml(id)}">
    <span class="tile-label">${escapeHtml(label)}</span>
    <span class="tile-value" data-value>0</span>
    <span class="tile-sub" data-sub></span>
  </div>`;
}

function barPanelHtml(label, id) {
  return `<div class="tile tile-bars" id="${escapeHtml(id)}">
    <span class="tile-label">${escapeHtml(label)}</span>
    <div class="bundlebars" data-bars><span class="tile-sub">nothing yet</span></div>
  </div>`;
}

function sourceRowsHtml(kind) {
  return NEWS_SOURCE_RECORDS.filter((r) => (kind === "kb" ? r.kind === "kb" : r.kind !== "kb")).map((r) => {
    const cls = r.kind === "kb" ? "kb" : "contemporary";
    return `<label class="sourcerow ${cls}" data-source-id="${escapeHtml(r.id)}">
      <input type="checkbox" data-source-toggle value="${escapeHtml(r.id)}" ${r.enabledByDefault ? "checked" : ""}>
      <span class="sourcename">${escapeHtml(r.name)}</span>
      <a class="sourcehome" href="${escapeHtml(r.homepage)}" target="_blank" rel="noopener">homepage</a>
      <span class="sourcestatus" data-source-status>not yet polled</span>
    </label>`;
  }).join("");
}

/** The one fenced region carrying every third-party URL this page ever
 *  names, in two groups the visitor can tell apart: the news feeds a poll
 *  fetches, and the reference works enrichment looks unknown terms up in. A
 *  reference work is never polled — ticking it arms the lookup, nothing
 *  else. Nothing fetches merely because this markup rendered. */
function sourcesConfigBlockHtml() {
  return `<!-- sources:start -->
  <div class="sources" id="sourcesConfig" aria-label="News sources">
    <h2 class="tile-label" id="pollRosterLabel">news feeds — polled when you press start or poll once</h2>
    <div class="sourcegroup" id="pollRoster" aria-labelledby="pollRosterLabel">
      ${sourceRowsHtml("contemporary")}
    </div>
    <h2 class="tile-label" id="lookupRosterLabel">reference works — looked up to explain a term, never polled</h2>
    <div class="sourcegroup" id="lookupRoster" aria-labelledby="lookupRosterLabel">
      ${sourceRowsHtml("kb")}
    </div>
  </div>
  <script type="application/json" id="newsSourceRecordsJson">${embedJson(NEWS_SOURCE_RECORDS)}</script>
  <!-- sources:end -->`;
}

const NEWS_STYLE = `
${THEME_TOKENS_CSS}
  html { background: var(--bg); }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: ${DASH_SANS_STACK}; font-size: 15px; line-height: 1.5; }
  .mono { font-family: ${MONO_STACK}; }
  main { max-width: 1100px; margin: 0 auto; padding: 1.4rem 1.2rem 3rem; }
  .visually-hidden { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
  .eyebrow { font-family: ${MONO_STACK}; font-size: .7rem; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); display: flex; flex-wrap: wrap; gap: .4em 1.2em; margin-bottom: .9rem; }
  ${EYEBROW_LINKS_CSS}
  button { font: inherit; color: inherit; background: none; border: none; padding: 0; cursor: pointer; }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--corpus); outline-offset: 2px; border-radius: 4px; }
  .dash { display: flex; flex-direction: column; gap: .6rem; margin: 0 0 1.1rem; }
  .kpirow { display: grid; grid-template-columns: repeat(5, 1fr); gap: .6rem; }
  .barpanels { display: grid; grid-template-columns: repeat(2, 1fr); gap: .6rem; }
  @media (max-width: 900px) { .kpirow { grid-template-columns: repeat(2, 1fr); } .barpanels { grid-template-columns: 1fr; } }
  .tile { background: var(--card); border: 1px solid var(--line); border-left: 3px solid var(--line); border-radius: 6px; padding: .6rem .75rem .65rem; display: flex; flex-direction: column; gap: .18rem; min-width: 0; }
  .tile-label { font-family: ${MONO_STACK}; font-size: .62rem; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); }
  .tile-value { font-family: ${MONO_STACK}; font-size: 1.5rem; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.15; }
  .tile-sub { font-family: ${MONO_STACK}; font-size: .66rem; color: var(--muted); }
  .bundlebars { display: flex; flex-direction: column; gap: .26rem; margin-top: .4rem; }
  .bbar { display: grid; grid-template-columns: minmax(0,1fr) 3.4rem 1.6rem; align-items: center; gap: .4rem; font-family: ${MONO_STACK}; font-size: .7rem; }
  .bblabel { color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bbtrack { background: var(--line); border-radius: 99px; height: 5px; overflow: hidden; }
  .bbfill { display: block; height: 100%; background: var(--ink); opacity: .6; border-radius: 99px; }
  .bbn { color: var(--muted); text-align: right; font-variant-numeric: tabular-nums; }
  .controls { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: .6rem .7rem; margin-bottom: 1rem; }
  .btn { font-family: ${MONO_STACK}; font-size: .72rem; color: var(--muted); border: 1px solid var(--line); border-radius: 6px; padding: .3rem .65rem; background: var(--bg); }
  .btn:hover { color: var(--ink); border-color: var(--ink); }
  .btn.primary { background: var(--ink); color: var(--bg); border-color: var(--ink); }
  .btn.ghost { border-color: transparent; color: var(--muted); text-decoration: underline; text-underline-offset: 2px; }
  .btn[disabled] { opacity: .55; cursor: progress; }
  .btn[aria-busy="true"] { opacity: .55; cursor: progress; }
  .btn[aria-busy="true"]::after { content: ""; display: inline-block; width: .5em; height: .5em; margin-left: .45em; border-radius: 50%; background: currentColor; animation: pulse 1s ease-in-out infinite; }
  @keyframes pulse { 0%, 100% { opacity: .25; } 50% { opacity: 1; } }
  @media (prefers-reduced-motion: reduce) { .btn[aria-busy="true"]::after { animation: none; opacity: .7; } }
  select, .urlinput { font-family: ${MONO_STACK}; font-size: .72rem; background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 6px; padding: .3rem .55rem; }
  .urlinput { flex: 1 1 12rem; min-width: 8rem; }
  .sources { display: flex; flex-direction: column; gap: .3rem; margin: .6rem 0; }
  .sources h2 { margin: .6rem 0 .1rem; }
  .sourcegroup { display: flex; flex-direction: column; gap: .3rem; }
  .sourcerow { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; font-size: .78rem; padding: .25rem .1rem; min-width: 0; }
  .sourcerow.kb { opacity: .85; }
  .sourcename { min-width: 12rem; }
  @media (max-width: 480px) { .sourcename { min-width: 0; } .sourcestatus { flex-basis: 100%; } }
  .sourcehome { font-family: ${MONO_STACK}; font-size: .66rem; color: var(--corpus); }
  .sourcestatus { margin-left: auto; font-family: ${MONO_STACK}; font-size: .66rem; color: var(--muted); }
  .reqlog { margin-bottom: 1rem; max-width: 100%; overflow-x: auto; }
  .reqlog table { width: 100%; table-layout: fixed; border-collapse: collapse; font-family: ${MONO_STACK}; font-size: .7rem; }
  .reqlog th, .reqlog td { text-align: left; padding: .2rem .4rem; border-bottom: 1px solid var(--line); overflow-wrap: anywhere; }
  .reqlog tbody:empty::after { content: "no requests yet — nothing has fetched before you press start"; }
  .feedwrap { margin-bottom: 1.2rem; }
  .feedbar { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; margin-bottom: .45rem; }
  .feedbar label { font-family: ${MONO_STACK}; font-size: .66rem; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); }
  .feedcount { font-family: ${MONO_STACK}; font-size: .66rem; color: var(--muted); margin-left: auto; }
  .pills { display: flex; flex-wrap: wrap; gap: .3rem; margin-bottom: .5rem; }
  .pill { font-family: ${MONO_STACK}; font-size: .66rem; color: var(--muted); background: var(--bg); border: 1px solid var(--line); border-radius: 99px; padding: .15rem .6rem; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pill:hover { color: var(--ink); border-color: var(--ink); }
  .pill[aria-pressed="true"] { background: var(--ink); color: var(--bg); border-color: var(--ink); }
  .feed { display: flex; flex-direction: column; gap: .7rem; max-height: 62vh; overflow-y: auto; overscroll-behavior: contain; padding-right: .25rem; }
  @media (max-width: 480px) { .feedcount { margin-left: 0; flex-basis: 100%; } .feed { max-height: 70vh; } }
  .item { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: .8rem 1rem; }
  .item .hub { font-weight: 700; font-size: 1.05rem; }
  .item .tier { font-family: ${MONO_STACK}; font-size: .64rem; padding: .05rem .5rem; border-radius: 99px; border: 1px solid var(--line); margin-left: .5rem; }
  .item .seedtag { font-family: ${MONO_STACK}; font-size: .64rem; color: var(--muted); margin-left: .5rem; }
  .item .paragraph { margin: .4rem 0; }
  .item .sources-links { font-size: .74rem; color: var(--muted); }
  .item details.facts summary { font-family: ${MONO_STACK}; font-size: .68rem; color: var(--corpus); cursor: pointer; }
  .item details.background summary { font-family: ${MONO_STACK}; font-size: .68rem; color: var(--muted); cursor: pointer; }
  .item details.background p { margin: .35rem 0 0; color: var(--muted); }
  .item .factrow { font-family: ${MONO_STACK}; font-size: .68rem; padding: .15rem 0; border-bottom: 1px dotted var(--line); }
  .item .facttriple { font-family: ${MONO_STACK}; font-size: .62rem; color: var(--muted); padding-left: .6rem; }
  .empty { color: var(--muted); font-size: .85rem; border: 1px dashed var(--line); border-radius: 6px; padding: .8rem 1rem; }
  .teach { background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: .7rem .85rem; margin-bottom: 1rem; }
  .teach textarea { width: 100%; box-sizing: border-box; min-height: 90px; font-family: ${MONO_STACK}; font-size: .76rem; background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 6px; padding: .5rem .6rem; }
  .teach .teachrow { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .5rem; align-items: center; }
  .pagelog { font-family: ${MONO_STACK}; font-size: .68rem; color: var(--muted); max-height: 140px; overflow-y: auto; border-top: 1px solid var(--line); padding-top: .4rem; }
`;

/** `renderNewsHtml({ title, seedStamp, seedBytes, digestStructures })` — one
 *  self-contained document: the dashboard, the controls row (start / poll
 *  interval / stop & forget / source toggles / add-by-URL / enrich now / the
 *  two fixture-replay demo buttons), the request log, the feed, and the
 *  teach panel. `seedStamp`/`seedBytes` feed the same chat-seed.json loading
 *  contract chat.html's own shell uses (chat-page-viz.mjs); `digestStructures`
 *  rides through unused today, the same build-time plumbing every other
 *  generated page threads even before it has its own digest affordance. */
export function renderNewsHtml({ title = DEFAULT_TITLE, seedStamp = "", seedBytes = 0, digestStructures = [] } = {}) {
  const digestJson = embedJson(Array.isArray(digestStructures) ? digestStructures : []);
  const factPhrasesJson = embedJson(FACT_PREDICATE_PHRASES);

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
${NEWS_STYLE}
</style>
</head>
<body>
<main>
  <div class="eyebrow"><span>${demoEyebrowHtml("news", "news")}</span><span id="seedPill" data-sub></span></div>
  <h1 class="visually-hidden">news — a dashboard over the graph, fed on your say-so</h1>

  <section class="dash" id="dash" aria-label="News metrics">
    <div class="kpirow">
      ${kpiTileHtml("feed.items", "tileFeedItems")}
      ${kpiTileHtml("terms.ungrounded", "tileTermsUngrounded")}
      ${kpiTileHtml("facts.from-news", "tileFactsFromNews")}
      ${kpiTileHtml("graph.size", "tileGraphSize")}
      ${kpiTileHtml("sources.live", "tileSourcesLive")}
    </div>
    <div class="barpanels">
      ${barPanelHtml("terms.ranked", "panelTermsRanked")}
      ${barPanelHtml("sources.per-source", "panelSourcesPerSource")}
    </div>
  </section>

  <div class="controls" id="controls">
    <button type="button" class="btn primary" id="newsStart">start polling live sources</button>
    <button type="button" class="btn" id="pollOnce">poll once</button>
    <button type="button" class="btn" id="stopPolling" disabled>stop polling</button>
    <label class="mono" for="pollInterval">poll every</label>
    <select id="pollInterval">
      <option value="0">off</option>
      <option value="5">5 min</option>
      <option value="15" selected>15 min</option>
      <option value="60">60 min</option>
    </select>
    <button type="button" class="btn ghost" id="stopForget">stop &amp; forget</button>
    <button type="button" class="btn" id="enrichNow">enrich now</button>
    <input type="text" class="urlinput" id="addSourceUrl" placeholder="add a source by url (https only)" autocomplete="off" spellcheck="false">
    <button type="button" class="btn" id="addSourceBtn">add</button>
    <button type="button" class="btn" id="replayNyt">replay recorded NYT sample</button>
    <button type="button" class="btn" id="replayWikipedia">replay recorded Wikipedia sample</button>
    <span class="mono" id="controlsStatus" aria-live="polite"></span>
  </div>

  ${sourcesConfigBlockHtml()}

  <section class="reqlog" id="requestLog" aria-label="Request log">
    <h2 class="tile-label">request log</h2>
    <table>
      <thead><tr><th>url</th><th>at</th><th>bytes</th><th>status</th></tr></thead>
      <tbody id="requestLogBody"></tbody>
    </table>
  </section>

  <section class="feedwrap" aria-label="News feed">
    <div class="feedbar">
      <label for="feedSort">sort</label>
      <select id="feedSort">
        <option value="newest" selected>newest first</option>
        <option value="facts">most facts first</option>
        <option value="changed">most changed first</option>
      </select>
      <span class="feedcount" id="feedCount" aria-live="polite"></span>
    </div>
    <div class="pills" id="feedPills" aria-label="Filter the feed by key term"></div>
    <div class="feed" id="feed" tabindex="0">
      <div class="empty" id="feedEmpty">no news yet — the feed only shows named people, places and events from polled sources. press poll once to fetch some.</div>
    </div>
  </section>

  <section class="teach" id="teachPanel">
    <h2 class="tile-label">teach the graph</h2>
    <textarea id="teachText" spellcheck="false" aria-label="Text or fact rows to ingest" placeholder="Paste prose, or drop a .txt/.md/.json/.jsonl file below."></textarea>
    <div class="teachrow">
      <button type="button" class="btn" id="exampleProse">example: prose</button>
      <button type="button" class="btn" id="exampleJsonl">example: facts (.jsonl)</button>
      <button type="button" class="btn" id="teachBrowse">browse&hellip;</button>
      <input type="file" id="teachFile" accept=".txt,.md,.json,.jsonl" hidden>
      <button type="button" class="btn primary" id="teachIngest">ingest</button>
      <span class="mono" id="teachStatus" aria-live="polite"></span>
    </div>
  </section>

  <div class="pagelog" id="pageLog" aria-live="polite"></div>
</main>
<script>
const DIGEST_STRUCTURES = ${digestJson};
const SEED_STAMP = ${JSON.stringify(seedStamp)};
const SEED_QUERY = SEED_STAMP ? "?b=" + SEED_STAMP : "";
const SEED_BYTES = ${Number(seedBytes) || 0};
</script>
<!--
  news-browser.bundle.js (built by scripts/build-news-bundle.mjs) publishes
  window.tmct — createNewsSession as tmct.open(), every session verb as
  tmct.session.<verb>(). The inline script below only wires DOM to that
  surface; it never touches the network, the memory store, or the news
  engine directly, so every third-party request this page ever makes is
  traceable to one of the session's own consent-gated methods.
-->
<script src="./news-browser.bundle.js"></script>
<script>
(function () {
  "use strict";
  const el = (id) => document.getElementById(id);
  const esc = ${escapeHtml.toString()};
  const FACT_PREDICATE_PHRASES = ${factPhrasesJson};
  const predicatePhrase = ${predicatePhrase.toString()};
  const factSentence = ${factSentence.toString()};
  const factTripleParts = ${factTripleParts.toString()};
  const fetchWithProgress = ${fetchWithProgress.toString()};
  const loadSeedPayload = ${loadSeedPayload.toString()};

  function appendLog(text) {
    const line = document.createElement("div");
    line.textContent = text;
    el("pageLog").appendChild(line);
    el("pageLog").scrollTop = el("pageLog").scrollHeight;
  }

  function microbars(items) {
    if (!items.length) return '<span class="tile-sub">nothing yet</span>';
    const max = items.reduce((m, it) => Math.max(m, it.count), 0) || 1;
    return items.map((it) =>
      '<div class="bbar"><span class="bblabel">' + esc(it.label) + '</span><span class="bbtrack"><span class="bbfill" style="width:' + Math.min(100, (it.count / max) * 100).toFixed(1) + '%"></span></span><span class="bbn">' + it.count + '</span></div>',
    ).join("");
  }

  function setTile(id, value, sub) {
    const node = el(id);
    if (!node) return;
    node.querySelector("[data-value]").textContent = String(value);
    const subEl = node.querySelector("[data-sub]");
    if (subEl && sub != null) subEl.textContent = sub;
  }

  function setBars(id, items) {
    const node = el(id);
    if (!node) return;
    node.querySelector("[data-bars]").innerHTML = microbars(items);
  }

  async function renderRequestLog() {
    const body = el("requestLogBody");
    body.innerHTML = "";
    for (const row of (window.tmct.session ? window.tmct.session.requestLog : []).slice(0, 50)) {
      const tr = document.createElement("tr");
      tr.innerHTML = "<td>" + esc(row.url) + "</td><td>" + esc(row.at) + "</td><td>" + esc(String(row.bytes)) + "</td><td>" + esc(row.status) + "</td>";
      body.appendChild(tr);
    }
  }

  function renderSourceStatus() {
    const health = window.tmct.session ? window.tmct.session.health : [];
    const byId = new Map(health.map((h) => [h.sourceId, h]));
    const config = window.tmct.session ? window.tmct.session.config : { sources: [] };
    const enabled = new Set(config.sources);
    document.querySelectorAll("[data-source-id]").forEach((row) => {
      const id = row.getAttribute("data-source-id");
      const h = byId.get(id);
      const statusEl = row.querySelector("[data-source-status]");
      let text = "off";
      if (enabled.has(id)) {
        if (h && h.autoDisabled) text = "auto-disabled";
        else if (h && h.browserBlocked) text = "source does not permit browser access";
        else if (h && h.lastStatus) text = h.lastStatus;
        else text = "not yet polled";
      }
      statusEl.textContent = text;
    });
    return { byId, enabled };
  }

  async function factListHtml(factIds) {
    const rows = await window.tmct.session.factRows(factIds);
    return rows.map((row) => {
      const triple = factTripleParts(row);
      return '<div class="factrow">' + esc(factSentence(row))
        + '<details><summary>triple</summary><div class="facttriple">'
        + esc(triple.subject) + " | " + esc(triple.predicate) + " | " + esc(triple.object)
        + " (" + esc(row.provenance || "") + ", trust " + esc(String(row.trust || 0)) + ")"
        + '</div></details></div>';
    }).join("");
  }

  // The last built feed and one rendered card per item, so a sort change or a
  // pill toggle re-orders what is already on screen instead of rebuilding
  // every card's fact list from the store again.
  let feedItems = [];
  const cardsByItemId = new Map();
  const activePillTerms = new Set();
  // What an empty feed says: this line before a poll, or after one that
  // reported nothing newsworthy; the purge line once "stop & forget" has
  // emptied the graph of articles, until the next poll (start or poll once)
  // puts content back and reverts it — the same "next action that puts
  // content back" rule the session's own forgotten flag follows.
  const DEFAULT_EMPTY_FEED_TEXT = "no news yet — the feed only shows named people, places and events from polled sources. press poll once to fetch some.";
  let emptyFeedText = DEFAULT_EMPTY_FEED_TEXT;

  const MAX_PILLS = 12;

  function itemMatchesActivePills(item) {
    if (!activePillTerms.size) return true;
    const haystack = (item.hub + " " + item.paragraph).toLowerCase();
    for (const term of activePillTerms) {
      if (item.hub === term || haystack.indexOf(term) !== -1) return true;
    }
    return false;
  }

  function sortedFeedItems() {
    const mode = el("feedSort").value;
    const items = feedItems.slice();
    if (mode === "facts") items.sort((a, b) => b.factIds.length - a.factIds.length || (a.hub < b.hub ? -1 : 1));
    else if (mode === "changed") items.sort((a, b) => b.changedCount - a.changedCount || (a.hub < b.hub ? -1 : 1));
    return items;
  }

  function renderPills() {
    const pillsEl = el("feedPills");
    const terms = feedItems
      .slice()
      .sort((a, b) => b.changedCount - a.changedCount || (a.hub < b.hub ? -1 : 1))
      .map((it) => it.hub)
      .slice(0, MAX_PILLS);
    for (const term of [...activePillTerms]) if (terms.indexOf(term) === -1) activePillTerms.delete(term);
    pillsEl.innerHTML = terms.map((term) =>
      '<button type="button" class="pill" data-pill-term="' + esc(term) + '" aria-pressed="'
      + (activePillTerms.has(term) ? "true" : "false") + '">' + esc(term) + '</button>',
    ).join("");
    pillsEl.querySelectorAll("[data-pill-term]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const term = btn.getAttribute("data-pill-term");
        if (activePillTerms.has(term)) activePillTerms.delete(term); else activePillTerms.add(term);
        btn.setAttribute("aria-pressed", activePillTerms.has(term) ? "true" : "false");
        paintFeed();
      });
    });
  }

  function paintFeed() {
    const feedEl = el("feed");
    const emptyEl = el("feedEmpty");
    feedEl.querySelectorAll(".item").forEach((n) => n.remove());
    const shown = sortedFeedItems().filter(itemMatchesActivePills);
    for (const item of shown) {
      const card = cardsByItemId.get(item.id);
      if (card) feedEl.appendChild(card);
    }
    emptyEl.hidden = shown.length > 0;
    if (!shown.length) {
      emptyEl.textContent = feedItems.length
        ? "no article matches the terms you picked — unpick a pill to see the rest."
        : emptyFeedText;
    }
    el("feedCount").textContent = shown.length === feedItems.length
      ? (feedItems.length + " article" + (feedItems.length === 1 ? "" : "s"))
      : (shown.length + " of " + feedItems.length + " articles");
  }

  async function renderFeed() {
    const feedEl = el("feed");
    const feed = await window.tmct.session.buildFeed();
    feedItems = feed.items;
    cardsByItemId.clear();
    feedEl.querySelectorAll(".item").forEach((n) => n.remove());
    for (const item of feed.items) {
      // One yield per card keeps the page clickable while a long feed renders.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const card = document.createElement("div");
      card.className = "item";
      const seedTag = feed.seedFallback ? '<span class="seedtag">from the seed graph — start to poll live sources</span>' : "";
      const sourcesText = item.sources.map((s) => esc(s.title || s.url)).join(", ");
      const facts = await factListHtml(item.factIds);
      const background = item.backgroundParagraph
        ? '<details class="background"><summary>what the graph already knew</summary><p>' + esc(item.backgroundParagraph) + '</p></details>'
        : "";
      card.innerHTML =
        '<span class="hub">' + esc(item.hub) + '</span><span class="tier">' + esc(item.tier || "unranked") + '</span>' + seedTag
        + '<p class="paragraph">' + esc(item.paragraph) + '</p>'
        + background
        + (sourcesText ? '<p class="sources-links">sources: ' + sourcesText + '</p>' : "")
        + '<details class="facts"><summary>' + item.factIds.length + ' facts</summary>' + facts + '</details>';
      cardsByItemId.set(item.id, card);
      // Each card shows the moment it is built; the paint below re-orders and
      // filters what is already on screen.
      if (itemMatchesActivePills(item)) { el("feedEmpty").hidden = true; feedEl.appendChild(card); }
    }
    renderPills();
    paintFeed();
    setTile("tileFeedItems", feed.items.length, feed.seedFallback ? "from the seed graph" : "live");
  }

  async function renderGraphTiles() {
    const stats = await window.tmct.session.stats();
    setTile("tileFactsFromNews", stats.factsFromNews, stats.factsFromNews ? "polled, replayed or enriched" : "nothing ingested yet");
    setTile("tileGraphSize", stats.graphSize, "facts in this session's graph");
  }

  async function renderRank() {
    const rows = await window.tmct.session.rank({ limit: 8 });
    setTile("tileTermsUngrounded", rows.length, rows.length ? "ranked by occurrence" : "none yet");
    setBars("panelTermsRanked", rows.map((r) => ({
      label: r.term + (r.vocabGrounded ? " (parseable but knowledge-free)" : " (unknown word)"),
      count: r.count,
    })));
  }

  function renderSourcesPanel() {
    const { enabled } = renderSourceStatus();
    const config = window.tmct.session ? window.tmct.session.config : { sources: [] };
    setTile("tileSourcesLive", enabled.size, config.pollMinutes ? ("every " + config.pollMinutes + " min") : "on demand");
    const health = window.tmct.session ? window.tmct.session.health : [];
    setBars("panelSourcesPerSource", health.map((h) => ({ label: h.sourceId, count: h.consecutiveFailures ? 0 : 1 })));
  }

  async function renderAll() {
    // Chips and tiles are cheap synchronous text writes; they lead so a
    // just-finished poll reads back immediately while the feed's own slower,
    // yielding render catches up behind it.
    renderSourcesPanel();
    await Promise.all([renderFeed(), renderRank(), renderRequestLog(), renderGraphTiles()]);
    renderSourcesPanel();
    window.tmct.news = Object.assign({}, window.tmct.news, {
      phase: window.tmct.session.phase,
      metrics: window.tmct.session.metrics,
      nextPollAt: window.tmct.session.nextPollAt,
    });
    appendLog("phase: " + window.tmct.session.phase);
  }

  async function boot() {
    window.tmct.news = { phase: "seeding", metrics: { timeToFirstArticleMs: null, timeToFirstCompletePollMs: null }, nextPollAt: "" };
    appendLog("phase: seeding");
    // The wink vendor is what lets ingested prose ground at all — without it
    // every extract runs lexicon-blind and the whole enrich loop misses.
    // Loaded alongside the seed, tolerated as absent the same way chat.html
    // tolerates it, never blocking the page.
    const winkLoad = (async function () {
      try {
        const mod = await Promise.race([
          import("./vendor/wink.js"),
          new Promise(function (resolve, reject) { setTimeout(function () { reject(new Error("wink vendor load timed out")); }, 20000); }),
        ]);
        window.tmct.page.registerWinkModel(function () { return { winkNLP: mod.winkNLP, model: mod.model }; });
        appendLog("wink vendor loaded — prose grounding armed");
      } catch (err) {
        appendLog("wink vendor unavailable — prose grounding runs lexicon-blind");
      }
    })();
    const outcome = await loadSeedPayload(fetchWithProgress, "./chat-seed.json", SEED_QUERY, function () {});
    window.tmct.seed = { state: outcome.status.state, facts: outcome.status.facts };
    await winkLoad;
    await window.tmct.open({ seedPayload: outcome.payload, vocabSeeded: Boolean(outcome.payload) });

    // Every control binds before the phase flips to "seeded": the first feed
    // render is deliberately slow (it yields per card), and a click that
    // lands in that window must already have its listener.
    const startBtn = el("newsStart");
    // Read once, here. The first render below takes a while, a visitor can
    // press start inside it, and that press grants consent — so re-reading
    // the flag afterwards to decide whether to replay a returning visit's
    // poll would poll a second time on top of the one already running.
    const returningVisit = window.tmct.session.consented;
    startBtn.textContent = returningVisit ? "poll now" : "start polling live sources";

    el("feedSort").addEventListener("change", paintFeed);

    // A poll can run for a while, so the button reads back its own state the
    // moment it is pressed and the status line follows the session's phase
    // until it settles.
    function markBusy(button, label) {
      button.dataset.idleLabel = button.textContent;
      button.textContent = label;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    }
    function markIdle(button, label) {
      button.textContent = label || button.dataset.idleLabel || button.textContent;
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
    // "stop polling" is live whenever there is something to stop: a press
    // still in flight, a cycle running, or a timer armed for the next one.
    // The press counter leads the session's own busy flag — a click must be
    // able to stop the cycle it just started, from the same tick.
    let pressesInFlight = 0;
    function syncStopPolling() {
      const session = window.tmct.session;
      el("stopPolling").disabled = !(pressesInFlight > 0 || (session && (session.busy || session.nextPollAt)));
    }
    function followPhase(label) {
      el("controlsStatus").textContent = label;
      const id = setInterval(function () {
        el("controlsStatus").textContent = window.tmct.session.phase + "…";
        syncStopPolling();
      }, 400);
      return function () { clearInterval(id); el("controlsStatus").textContent = ""; syncStopPolling(); };
    }

    /** One press that fetches: the button reads back busy at once, the
     *  status line follows the phase, and everything re-renders after. */
    async function runFetchingPress(button, busyLabel, idleLabel, work) {
      markBusy(button, busyLabel);
      pressesInFlight += 1;
      syncStopPolling();
      const stopFollowing = followPhase(busyLabel);
      try {
        await work();
      } finally {
        pressesInFlight -= 1;
        stopFollowing();
        markIdle(button, idleLabel);
        syncStopPolling();
      }
      await renderAll();
    }

    startBtn.addEventListener("click", function () {
      emptyFeedText = DEFAULT_EMPTY_FEED_TEXT;
      return runFetchingPress(startBtn, "polling…", "poll now", function () { return window.tmct.session.start(); });
    });

    el("pollOnce").addEventListener("click", function () {
      emptyFeedText = DEFAULT_EMPTY_FEED_TEXT;
      const pollOnceBtn = el("pollOnce");
      return runFetchingPress(pollOnceBtn, "polling…", "poll once", function () { return window.tmct.session.pollOnce(); });
    });

    el("stopPolling").addEventListener("click", function () {
      const result = window.tmct.session.stopPolling();
      el("controlsStatus").textContent = result.wasRunning ? "stopping…" : "polling stopped";
      appendLog(result.wasRunning
        ? "stopping — the running cycle finishes the article it is on and stops there"
        : "polling stopped — no cycle was running, the next scheduled poll is cancelled");
      syncStopPolling();
      renderSourcesPanel();
    });

    // The button stays busy until the purge is finished on screen as well as
    // in the store, so "enabled again" really does mean "the articles are
    // gone" rather than "the store call returned".
    el("stopForget").addEventListener("click", async function () {
      const stopForgetBtn = el("stopForget");
      markBusy(stopForgetBtn, "forgetting…");
      try {
        const result = await window.tmct.session.revokeConsent();
        const removed = (result && result.factsRemoved) || 0;
        startBtn.textContent = "start polling live sources";
        feedItems = [];
        cardsByItemId.clear();
        activePillTerms.clear();
        el("feed").querySelectorAll(".item").forEach(function (n) { n.remove(); });
        emptyFeedText = "the articles are gone — press start or poll once to gather news again.";
        renderPills();
        paintFeed();
        appendLog("stopped and forgot: " + removed + " fact(s) from news dropped, articles cleared, this page reads as first-visit next load");
        await renderAll();
      } finally {
        markIdle(stopForgetBtn, "stop & forget");
        syncStopPolling();
      }
    });

    el("pollInterval").addEventListener("change", function (ev) {
      const minutes = window.tmct.session.setInterval(Number(ev.target.value));
      ev.target.value = String(minutes);
      syncStopPolling();
    });

    el("enrichNow").addEventListener("click", function () {
      const enrichBtn = el("enrichNow");
      return runFetchingPress(enrichBtn, "enriching…", "enrich now", function () { return window.tmct.session.enrich(); });
    });

    document.querySelectorAll("[data-source-toggle]").forEach(function (box) {
      box.addEventListener("change", function () {
        const ids = [].slice.call(document.querySelectorAll("[data-source-toggle]:checked")).map(function (b) { return b.value; });
        window.tmct.session.setSources(ids);
        renderSourcesPanel();
      });
    });

    el("addSourceBtn").addEventListener("click", async function () {
      const url = el("addSourceUrl").value.trim();
      if (!url) return;
      el("controlsStatus").textContent = "checking…";
      const result = await window.tmct.session.addSource(url);
      el("controlsStatus").textContent = result.ok ? ("added as " + result.format) : ("couldn't add: " + result.reason);
      if (result.ok) renderSourcesPanel();
    });

    async function replayFrom(sourceId, fixtureKey) {
      el("controlsStatus").textContent = "replaying…";
      try {
        const res = await fetch("./news-fixtures.json");
        const bundle = res.ok ? await res.json() : null;
        const fixture = bundle && bundle[fixtureKey];
        if (!fixture) { el("controlsStatus").textContent = "fixture unavailable"; return; }
        await window.tmct.session.replayFixture(sourceId, fixture);
        el("controlsStatus").textContent = "replayed " + fixtureKey;
        await renderAll();
      } catch (err) {
        el("controlsStatus").textContent = "fixture unavailable";
      }
    }
    el("replayNyt").addEventListener("click", function () { replayFrom("nyt-world", "nyt-world"); });
    el("replayWikipedia").addEventListener("click", function () { replayFrom("wikimedia-featured", "wikimedia-featured"); });

    el("exampleProse").addEventListener("click", function () {
      el("teachText").value = "A ceasefire is a formal agreement to stop fighting. A tariff is a tax on imported goods.";
    });
    el("exampleJsonl").addEventListener("click", function () {
      el("teachText").value = [
        '{"subject":"ceasefire","predicate":"rdf:type","object":"agreement"}',
        '{"subject":"tariff","predicate":"rdf:type","object":"tax"}',
      ].join("\\n");
    });
    el("teachBrowse").addEventListener("click", function () { el("teachFile").click(); });
    el("teachFile").addEventListener("change", async function () {
      const file = el("teachFile").files[0];
      if (!file) return;
      el("teachText").value = await file.text();
      el("teachStatus").textContent = "loaded " + file.name + " — press ingest";
      el("teachFile").dataset.name = file.name;
    });

    window.tmct.news.phase = "seeded";
    appendLog("phase: seeded");
    await renderAll();
    syncStopPolling();
    if (returningVisit) {
      await window.tmct.session.start();
      await renderAll();
      syncStopPolling();
    }
    el("teachIngest").addEventListener("click", async function () {
      const text = el("teachText").value;
      if (!text.trim()) return;
      const name = el("teachFile").dataset.name || "";
      const result = await window.tmct.session.ingestFile({ name: name, text: text });
      el("teachStatus").textContent = result.error ? result.error : (result.facts + " fact(s), " + result.vocabAdded + " vocab hint(s)");
      await renderAll();
    });
  }

  boot().catch(function (err) { appendLog("boot failed: " + (err && err.message ? err.message : String(err))); });
})();
</script>
</body>
</html>`;
}
