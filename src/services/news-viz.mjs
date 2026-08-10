// news-viz.mjs — news.html: a thin client over the row service's news
// routes (PLAN_MEMORY_BACKEND.md's news.html-goes-thin revision), on the
// ledger.html dashboard precedent (src/services/ledger-viz.mjs: `.dash`/
// `.kpirow`/`.tile`/`.tile-bars`, the same THEME_TOKENS_CSS palette).
//
// This page carries no engine and no seed. Every card, tile, bar, source
// status line and request-log row it ever shows is read straight off one
// document — `GET /api/feed` — and nothing here recomputes any of it. The
// only client-side work is: mint a session key at the first press, POST the
// three trigger routes (poll/enrich/ingest) on their own press, wait for the
// cycle each one starts to materialize, and render the document that comes
// back. src/surfaces/web/news-browser-entry.mjs is the whole of that; this
// file is markup, CSS and the inline script wiring DOM to it.
//
// Every fetched or user-supplied string this page ever shows (a card's
// paragraph, a fact line, a source name, teach-panel text) goes through
// escapeHtml at render time — the page's one sanitisation layer, since
// nothing here parses raw prose itself; that already happened server-side,
// in the worker, before the string ever reached this document.
import {
  THEME_TOKENS_CSS, MONO_STACK, escapeHtml, embedJson, demoEyebrowHtml, EYEBROW_LINKS_CSS,
} from "./viz-theme.mjs";
import { NEWS_SOURCE_RECORDS } from "../adapters/corpus/news-sources.mjs";

const DEFAULT_TITLE = "tmct news — a feed the graph only shows what it can ground";

const DASH_SANS_STACK = `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;

/** One `.tile` cell for the KPI row — the zero-state every tile renders in
 *  before the first render call, since the page's own JS overwrites every
 *  number the moment a feed document (real or empty) is in hand. Static
 *  markup only. */
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
    // Only the contemporary group offers a checkbox: it narrows the NEXT
    // poll trigger's own `{sources:[...]}` body, never a fetch of its own.
    // The kb group has no client-supplied roster in the hosted worker, so
    // it renders as plain status, not a control.
    const toggle = kind === "kb" ? "" : `<input type="checkbox" data-source-toggle value="${escapeHtml(r.id)}" ${r.enabledByDefault ? "checked" : ""}>`;
    return `<label class="sourcerow ${cls}" data-source-id="${escapeHtml(r.id)}">
      ${toggle}
      <span class="sourcename">${escapeHtml(r.name)}</span>
      <a class="sourcehome" href="${escapeHtml(r.homepage)}" target="_blank" rel="noopener">homepage</a>
      <span class="sourcestatus" data-source-status>not yet polled</span>
    </label>`;
  }).join("");
}

/** The one fenced region carrying every third-party URL this page ever
 *  names — every source's own homepage link, and the embedded source
 *  registry the panel reads. No fetch happens because this markup rendered;
 *  the worker does the fetching, server-side, and only after a trigger this
 *  page's own click sent it. */
function sourcesConfigBlockHtml() {
  return `<!-- sources:start -->
  <div class="sources" id="sourcesConfig" aria-label="News sources">
    <h2 class="tile-label" id="pollRosterLabel">news feeds — the worker polls these when you press start, narrowed to what's checked</h2>
    <div class="sourcegroup" id="pollRoster" aria-labelledby="pollRosterLabel">
      ${sourceRowsHtml("contemporary")}
    </div>
    <h2 class="tile-label" id="lookupRosterLabel">reference works — the worker looks a term up here to explain it, never polled</h2>
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
  .privacy { font-size: .78rem; color: var(--muted); margin: 0 0 .8rem; max-width: 46rem; }
  .unavailable { display: none; background: var(--alert-soft); border: 1px solid var(--alert); border-radius: 6px; padding: .6rem .8rem; margin-bottom: 1rem; font-size: .84rem; }
  .unavailable.shown { display: block; }
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
  select { font-family: ${MONO_STACK}; font-size: .72rem; background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 6px; padding: .3rem .55rem; }
  .fuzzytoggle { display: inline-flex; align-items: center; gap: .35rem; font-family: ${MONO_STACK}; font-size: .68rem; color: var(--muted); cursor: pointer; }
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
  .reqlog tbody:empty::after { content: "no requests yet — nothing has been polled before you press start"; }
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
  .item .newtag { font-family: ${MONO_STACK}; font-size: .64rem; color: var(--taught); margin-left: .5rem; }
  .item .paragraph { margin: .4rem 0; }
  .item .sources-links { font-size: .74rem; color: var(--muted); }
  .item details.facts summary { font-family: ${MONO_STACK}; font-size: .68rem; color: var(--corpus); cursor: pointer; }
  .item details.background summary { font-family: ${MONO_STACK}; font-size: .68rem; color: var(--muted); cursor: pointer; }
  .item details.background p { margin: .35rem 0 0; color: var(--muted); }
  .item .factrow { font-family: ${MONO_STACK}; font-size: .68rem; padding: .15rem 0; border-bottom: 1px dotted var(--line); }
  .item .factrow.factmore { color: var(--muted); border-bottom: none; }
  .empty { color: var(--muted); font-size: .85rem; border: 1px dashed var(--line); border-radius: 6px; padding: .8rem 1rem; }
  .teach { background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: .7rem .85rem; margin-bottom: 1rem; }
  .teach textarea { width: 100%; box-sizing: border-box; min-height: 90px; font-family: ${MONO_STACK}; font-size: .76rem; background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 6px; padding: .5rem .6rem; }
  .teach .teachrow { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: .5rem; align-items: center; }
  .chat { background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: .7rem .85rem; margin-bottom: 1rem; }
  .chatlog { display: flex; flex-direction: column; gap: .5rem; max-height: 40vh; overflow-y: auto; margin: .5rem 0; padding-right: .25rem; }
  .chatlog:empty::after { content: "ask the graph what it knows, or teach it something new"; color: var(--muted); font-size: .8rem; }
  .chatturn { display: flex; flex-direction: column; gap: .2rem; }
  .chatbubble { border: 1px solid var(--line); border-radius: 6px; padding: .4rem .6rem; font-size: .84rem; max-width: 42rem; white-space: pre-wrap; }
  .chatturn.you { align-items: flex-end; }
  .chatturn.you .chatbubble { background: var(--bg); }
  .chatturn.graph .chatbubble { background: var(--bg); }
  .chatturn.error .chatbubble { border-color: var(--alert); color: var(--alert); background: var(--alert-soft); }
  .chatlearned { font-family: ${MONO_STACK}; font-size: .68rem; color: var(--muted); }
  .chatlearned ul { margin: .15rem 0 0; padding-left: 1.1rem; }
  .chattrace summary { font-family: ${MONO_STACK}; font-size: .64rem; color: var(--muted); cursor: pointer; }
  .chattrace pre { font-family: ${MONO_STACK}; font-size: .64rem; color: var(--muted); white-space: pre-wrap; margin: .3rem 0 0; }
  .chatform { display: flex; gap: .4rem; }
  .chatform input[type="text"] { flex: 1; font: inherit; font-family: ${MONO_STACK}; font-size: .8rem; background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 6px; padding: .4rem .6rem; }
  .chatform input[disabled] { opacity: .55; }
  .pagelog { font-family: ${MONO_STACK}; font-size: .68rem; color: var(--muted); max-height: 140px; overflow-y: auto; border-top: 1px solid var(--line); padding-top: .4rem; }
`;

/** `renderNewsHtml({ title })` — one self-contained document: the dashboard,
 *  the controls row (start/poll, enrich now, stop & forget), the source
 *  panel, the request log, the feed, the teach panel, and the chat area.
 *  The chat area is the turn endpoint's page consumer: one input, one send,
 *  one transcript, over the same session UUID the feed already holds. A
 *  reply's text and any citation or trace text land through `textContent`/
 *  `createTextNode` only, never through markup built from a string — this
 *  page's answer text is the one thing on it never HTML-escaped-then-
 *  interpolated, because it never needs to be. */
export function renderNewsHtml({ title = DEFAULT_TITLE } = {}) {
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
  <div class="eyebrow"><span>${demoEyebrowHtml("news", "news")}</span><span id="sessionPill" data-sub></span></div>
  <h1 class="visually-hidden">news — a feed the graph only shows what it can ground</h1>

  <p class="privacy">This session is anonymous. Pressing start keeps a random key for it in this browser; everything you poll or teach here is stored against that key on the server for seven days. Stop &amp; forget hides all of it at once, and the stored copies are gone for good within that same week.</p>

  <div class="unavailable" id="serviceUnavailable" role="alert">The news service isn't answering right now, so there's nothing to show. Reload the page to try again.</div>

  <section class="dash" id="dash" aria-label="News metrics">
    <div class="kpirow">
      ${kpiTileHtml("feed.items", "tileFeedItems")}
      ${kpiTileHtml("terms.ungrounded", "tileTermsUngrounded")}
      ${kpiTileHtml("facts.from-news", "tileFactsFromNews")}
      ${kpiTileHtml("graph.size", "tileGraphSize")}
      ${kpiTileHtml("sources.reporting", "tileSourcesLive")}
    </div>
    <div class="barpanels">
      ${barPanelHtml("terms.ranked", "panelTermsRanked")}
      ${barPanelHtml("sources.per-source", "panelSourcesPerSource")}
    </div>
  </section>

  <div class="controls" id="controls">
    <button type="button" class="btn primary" id="newsStart">start polling live sources</button>
    <button type="button" class="btn" id="enrichNow">enrich now</button>
    <label class="fuzzytoggle" for="fuzzyToggle"><input type="checkbox" id="fuzzyToggle" checked> fuzzy corpus match</label>
    <button type="button" class="btn ghost" id="stopForget">stop &amp; forget</button>
    <span class="mono" id="controlsStatus" aria-live="polite"></span>
  </div>

  ${sourcesConfigBlockHtml()}

  <section class="reqlog" id="requestLog" aria-label="Request log">
    <h2 class="tile-label">the worker's own request log</h2>
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
      <div class="empty" id="feedEmpty">no news yet — the feed only shows named people, places and events the worker has reported. press start to fetch some.</div>
    </div>
  </section>

  <section class="teach" id="teachPanel">
    <h2 class="tile-label">teach the graph</h2>
    <textarea id="teachText" spellcheck="false" aria-label="Text or fact rows to ingest" placeholder="Paste prose, or drop a .txt/.md/.jsonl file below."></textarea>
    <div class="teachrow">
      <button type="button" class="btn" id="exampleProse">example: prose</button>
      <button type="button" class="btn" id="exampleJsonl">example: facts (.jsonl)</button>
      <button type="button" class="btn" id="teachBrowse">browse&hellip;</button>
      <input type="file" id="teachFile" accept=".txt,.md,.jsonl" hidden>
      <button type="button" class="btn primary" id="teachIngest">ingest</button>
      <span class="mono" id="teachStatus" aria-live="polite"></span>
    </div>
  </section>

  <section id="chatMount" aria-label="Chat">
    <h2 class="tile-label">chat with the graph</h2>
    <div class="chat">
      <div class="chatlog" id="chatLog" aria-live="polite"></div>
      <form class="chatform" id="chatForm">
        <input type="text" id="chatInput" autocomplete="off" placeholder="press start above to chat with the graph" aria-label="Message to the graph" disabled>
        <button type="submit" class="btn primary" id="chatSend" disabled>send</button>
      </form>
    </div>
  </section>

  <div class="pagelog" id="pageLog" aria-live="polite"></div>
</main>
<!--
  news-browser.bundle.js (built by scripts/build-news-bundle.mjs) publishes
  window.tmct — createNewsSession as tmct.open(), every session verb as
  tmct.session.<verb>(). The inline script below only wires DOM to that
  surface; it never touches the network directly (createHttpRowBackend
  inside the session does, over the row service's own routes), so every
  request this page ever makes is traceable to one of the session's own
  methods, each reached only from a click this script handles.
-->
<script src="./news-browser.bundle.js"></script>
<script>
(function () {
  "use strict";
  const el = (id) => document.getElementById(id);
  const esc = ${escapeHtml.toString()};

  const EMPTY_FEED = { items: [], rankedTerms: [], stats: { graphSize: 0, factsFromNews: 0 }, sourceStatus: [], requestLog: [], builtAt: null };

  // Set once boot() opens the session; read by setUnavailable/
  // updateChatAvailability below, which both live outside boot()'s own
  // closure and never call the network themselves.
  let session = null;

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

  // Every network-facing control disables together the moment the service
  // stops answering — none of them has anything left to do until it comes
  // back. Enrich and teach each mint their own session independently of the
  // "start" press, the same way the old page's add-source-by-url ran its
  // own preflight regardless of poll consent — pressing any of them first
  // is exactly what "the page mints the session, at consent" means.
  function setUnavailable(isUnavailable) {
    el("serviceUnavailable").classList.toggle("shown", isUnavailable);
    ["newsStart", "enrichNow", "stopForget", "teachIngest", "teachBrowse"].forEach(function (id) {
      el(id).disabled = isUnavailable;
    });
    updateChatAvailability();
  }

  // Chat joins the same disabled-together posture as every other
  // network-facing control once the service goes unreachable, and carries
  // its OWN gate besides: it stays disabled until the visitor has pressed
  // start at least once, the one control on this page that waits for that
  // specific press rather than minting its own session on first use.
  function updateChatAvailability() {
    const blocked = !session || !session.consented || session.unavailable;
    el("chatInput").disabled = blocked;
    el("chatSend").disabled = blocked;
    el("chatInput").placeholder = (session && session.consented)
      ? "ask or teach the graph a fact"
      : "press start above to chat with the graph";
  }

  /** One chat-log row: ".chatturn <kind>" wrapping one ".chatbubble" whose
   *  text lands through textContent alone — never HTML built from a
   *  string, matching the answer-text posture no other text on this page
   *  needs, since a chat reply is the one string here nobody has read or
   *  sanitised before it arrives. */
  function chatBubble(kind, text) {
    const row = document.createElement("div");
    row.className = "chatturn " + kind;
    const bubble = document.createElement("div");
    bubble.className = "chatbubble";
    bubble.textContent = text;
    row.appendChild(bubble);
    return row;
  }

  function appendChatTurn(kind, text) {
    const row = chatBubble(kind, text);
    el("chatLog").appendChild(row);
    el("chatLog").scrollTop = el("chatLog").scrollHeight;
    return row;
  }

  /** The graph's own turn, plus what it touched: result.citations (already
   *  phrase-layer English, from session.turn()) as a plain list under the
   *  reply, and result.narration as a collapsible trace — the same
   *  disclosure shape a fact card's own "what the graph already knew"
   *  details block uses. Both are optional; a plain answer with no writes
   *  and no trace text renders as just the one bubble. Says nothing about
   *  the feed either way — a taught fact reaches it at the next
   *  materialization, whenever that runs. */
  function appendChatReply(result) {
    const row = chatBubble("graph", result.reply);
    if (result.citations && result.citations.length) {
      const learned = document.createElement("div");
      learned.className = "chatlearned";
      learned.appendChild(document.createTextNode("learned this turn:"));
      const list = document.createElement("ul");
      for (const line of result.citations) {
        const li = document.createElement("li");
        li.textContent = line;
        list.appendChild(li);
      }
      learned.appendChild(list);
      row.appendChild(learned);
    }
    if (result.narration) {
      const trace = document.createElement("details");
      trace.className = "chattrace";
      const summary = document.createElement("summary");
      summary.textContent = "trace";
      const pre = document.createElement("pre");
      pre.textContent = result.narration;
      trace.appendChild(summary);
      trace.appendChild(pre);
      row.appendChild(trace);
    }
    el("chatLog").appendChild(row);
    el("chatLog").scrollTop = el("chatLog").scrollHeight;
  }

  function renderRequestLog(feed) {
    const body = el("requestLogBody");
    body.innerHTML = "";
    for (const row of (feed.requestLog || [])) {
      const tr = document.createElement("tr");
      tr.innerHTML = "<td>" + esc(row.url) + "</td><td>" + esc(row.at) + "</td><td>" + esc(String(row.bytes)) + "</td><td>" + esc(row.status) + "</td>";
      body.appendChild(tr);
    }
  }

  function renderSourcesPanel(feed) {
    const byId = new Map((feed.sourceStatus || []).map(function (h) { return [h.sourceId, h]; }));
    const nowMs = Date.now();
    document.querySelectorAll("[data-source-id]").forEach(function (row) {
      const health = byId.get(row.getAttribute("data-source-id"));
      const statusEl = row.querySelector("[data-source-status]");
      let text = "not yet polled";
      if (health) {
        if (health.autoDisabled) text = "auto-disabled";
        else if (health.browserBlocked) text = "source does not permit browser access";
        // A source can be skipped without being auto-disabled yet — one or
        // two failures back off for a while rather than giving up on it —
        // and that reads as nothing without its own note; left to fall
        // through to lastStatus, a merely-cooling-down source would show
        // "failed" forever, which understates what actually happened.
        else if (health.backoffUntil && Date.parse(health.backoffUntil) > nowMs) text = "skipped — backing off";
        else if (health.lastStatus) text = health.lastStatus;
      }
      statusEl.textContent = text;
    });
    setTile("tileSourcesLive", (feed.sourceStatus || []).length, "reported in the last cycle");
    setBars("panelSourcesPerSource", (feed.sourceStatus || []).map(function (h) {
      return { label: h.sourceId, count: h.consecutiveFailures ? 0 : 1 };
    }));
  }

  // Live progress during a running cycle, read off the marker each button
  // press reports through its own onCycle callback — a poll cycle's own
  // per-source entries as they land, or "polling…" for a roster member the
  // marker hasn't reached yet. renderSourcesPanel overwrites all of this the
  // moment the press's own promise resolves with the finished feed; this is
  // only what a visitor sees while it's still running.
  function renderCycleProgress(marker) {
    if (!marker) return;
    const perSource = marker.sources || {};
    document.querySelectorAll("[data-source-id]").forEach(function (row) {
      if (row.classList.contains("kb")) return;
      const id = row.getAttribute("data-source-id");
      const statusEl = row.querySelector("[data-source-status]");
      if (Object.prototype.hasOwnProperty.call(perSource, id)) {
        statusEl.textContent = perSource[id].status;
      } else if (marker.state === "running" && marker.kind === "poll") {
        statusEl.textContent = "polling…";
      }
    });
  }

  function cardHtml(item) {
    const factLines = item.factLines || [];
    const factsHtml = factLines.map(function (line) { return '<div class="factrow">' + esc(line) + '</div>'; }).join("");
    const moreCount = (item.factCount || 0) - factLines.length;
    const moreHtml = moreCount > 0 ? '<div class="factrow factmore">&hellip;and ' + moreCount + ' more</div>' : "";
    const sourcesText = (item.sources || []).map(function (s) { return esc(s.title || s.url || ""); }).filter(Boolean).join(", ");
    const background = item.backgroundParagraph
      ? '<details class="background"><summary>what the graph already knew</summary><p>' + esc(item.backgroundParagraph) + '</p></details>'
      : "";
    const newTag = item.newName ? '<span class="newtag">new</span>' : "";
    return '<div class="item" data-item-id="' + esc(item.id) + '">'
      + '<span class="hub">' + esc(item.hub) + '</span><span class="tier">' + esc(item.tier || "unranked") + '</span>' + newTag
      + '<p class="paragraph">' + esc(item.paragraph) + '</p>'
      + background
      + (sourcesText ? '<p class="sources-links">sources: ' + sourcesText + '</p>' : "")
      + '<details class="facts"><summary>' + (item.factCount || 0) + ' fact' + (item.factCount === 1 ? "" : "s") + '</summary>' + factsHtml + moreHtml + '</details>'
      + '</div>';
  }

  // The last-rendered feed's own items and one built card per item, so a
  // sort change or a pill toggle re-orders what is already on screen
  // without asking the server for anything again.
  let feedItems = [];
  const cardsByItemId = new Map();
  const activePillTerms = new Set();
  const DEFAULT_EMPTY_FEED_TEXT = "no news yet — the feed only shows named people, places and events the worker has reported. press start to fetch some.";
  let emptyFeedText = DEFAULT_EMPTY_FEED_TEXT;
  const MAX_PILLS = 12;

  function itemMatchesActivePills(item) {
    if (!activePillTerms.size) return true;
    const haystack = (item.hub + " " + item.paragraph).toLowerCase();
    for (const term of activePillTerms) { if (item.hub === term || haystack.indexOf(term) !== -1) return true; }
    return false;
  }

  function sortedFeedItems() {
    const mode = el("feedSort").value;
    const items = feedItems.slice();
    if (mode === "facts") items.sort((a, b) => (b.factCount - a.factCount) || (a.hub < b.hub ? -1 : 1));
    else if (mode === "changed") items.sort((a, b) => (b.changedCount - a.changedCount) || (a.hub < b.hub ? -1 : 1));
    else items.sort((a, b) => (b.observedMs - a.observedMs) || (a.hub < b.hub ? -1 : 1));
    return items;
  }

  function renderPills() {
    const pillsEl = el("feedPills");
    const terms = feedItems
      .slice()
      .sort((a, b) => (b.changedCount - a.changedCount) || (a.hub < b.hub ? -1 : 1))
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

  function renderFeed(feed) {
    feedItems = feed.items || [];
    cardsByItemId.clear();
    for (const item of feedItems) {
      const wrapper = document.createElement("div");
      wrapper.innerHTML = cardHtml(item);
      cardsByItemId.set(item.id, wrapper.firstElementChild);
    }
    renderPills();
    paintFeed();
    setTile("tileFeedItems", feedItems.length, feed.trimmed ? "trimmed to fit — each card's own count says how much" : "");
  }

  function renderAll(feed) {
    renderFeed(feed);
    renderSourcesPanel(feed);
    renderRequestLog(feed);
    const ranked = feed.rankedTerms || [];
    setTile("tileTermsUngrounded", ranked.length, ranked.length ? "ranked by occurrence" : "none yet");
    setBars("panelTermsRanked", ranked.map((r) => ({
      label: r.term + (r.vocabGrounded ? " (parseable but knowledge-free)" : " (unknown word)"),
      count: r.count,
    })));
    const stats = feed.stats || { graphSize: 0, factsFromNews: 0 };
    setTile("tileFactsFromNews", stats.factsFromNews, stats.factsFromNews ? "polled or taught" : "nothing ingested yet");
    setTile("tileGraphSize", stats.graphSize, "facts in this session's graph");
  }

  function looksLikeFactRows(text) {
    const lines = String(text || "").split("\\n").map(function (l) { return l.trim(); }).filter(Boolean);
    if (!lines.length) return false;
    return lines.every(function (line) {
      try {
        const row = JSON.parse(line);
        return row && typeof row === "object" && row.subject && row.predicate && row.object;
      } catch { return false; }
    });
  }

  async function boot() {
    session = await window.tmct.open({});
    window.tmct.news = { phase: "seeded" };

    // The standing refresh loop lives inside the session, started already —
    // this just subscribes to it. A cycle another tab (or a reload-surviving
    // trigger) finishes reaches this page the same way a press's own cycle
    // does, without this page having asked for anything.
    session.onFeedUpdate(function (feed) {
      renderAll(feed);
      appendLog("the feed updated in the background");
    });

    const startBtn = el("newsStart");
    startBtn.textContent = session.consented ? "poll now" : "start polling live sources";
    updateChatAvailability(); // a restored, already-consented session unlocks chat right away

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

    /** One press that talks to the service: the button reads back busy at
     *  once, the status line carries the outcome, and a network failure
     *  flips the page into the unavailable state rather than leaving the
     *  button stuck. */
    async function runPress(button, busyLabel, idleLabelFn, work) {
      markBusy(button, busyLabel);
      el("controlsStatus").textContent = busyLabel;
      try {
        const feed = await work();
        setUnavailable(false);
        renderAll(feed);
        el("controlsStatus").textContent = "";
        return feed;
      } catch (err) {
        el("controlsStatus").textContent = (err && err.message) ? err.message : String(err);
        if (session.unavailable) setUnavailable(true);
        throw err;
      } finally {
        markIdle(button, idleLabelFn());
      }
    }

    startBtn.addEventListener("click", function () {
      emptyFeedText = DEFAULT_EMPTY_FEED_TEXT;
      const ids = [].slice.call(document.querySelectorAll("[data-source-toggle]:checked")).map(function (b) { return b.value; });
      runPress(startBtn, "polling…", function () { return session.consented ? "poll now" : "start polling live sources"; }, function () { return session.start(ids, { onCycle: renderCycleProgress }); })
        .catch(function () {});
    });

    el("enrichNow").addEventListener("click", function () {
      const fuzzy = el("fuzzyToggle").checked;
      runPress(el("enrichNow"), "enriching…", function () { return "enrich now"; }, function () { return session.enrich({ fuzzy: fuzzy, onCycle: renderCycleProgress }); })
        .catch(function () {});
    });

    el("stopForget").addEventListener("click", async function () {
      const btn = el("stopForget");
      markBusy(btn, "forgetting…");
      el("controlsStatus").textContent = "forgetting…";
      const result = await session.revokeConsent();
      startBtn.textContent = "start polling live sources";
      feedItems = [];
      cardsByItemId.clear();
      activePillTerms.clear();
      emptyFeedText = "the articles are gone — press start to fetch news again.";
      renderAll(EMPTY_FEED);
      document.querySelectorAll("[data-source-status]").forEach(function (n) { n.textContent = "not yet polled"; });
      appendLog(result.ok
        ? "stopped and forgot — this page reads as first-visit on the next load"
        : "stopped and forgot locally; the server-side purge reported: " + result.error);
      markIdle(btn, "stop & forget");
      el("controlsStatus").textContent = "";
    });

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
    });

    el("teachIngest").addEventListener("click", async function () {
      const text = el("teachText").value;
      if (!text.trim()) return;
      const btn = el("teachIngest");
      const graphSizeBefore = Number((el("tileGraphSize").querySelector("[data-value]") || {}).textContent) || 0;
      await runPress(btn, "ingesting…", function () { return "ingest"; }, async function () {
        const feed = looksLikeFactRows(text)
          ? await session.ingestRows(window.tmct.page.parseJsonlRows(text), { onCycle: renderCycleProgress })
          : await session.ingestText(text, { onCycle: renderCycleProgress });
        const added = Math.max(0, (feed.stats.graphSize || 0) - graphSizeBefore);
        el("teachStatus").textContent = added + " fact(s) added to the graph";
        return feed;
      }).catch(function (err) { el("teachStatus").textContent = err.message || String(err); });
    });

    el("chatForm").addEventListener("submit", async function (ev) {
      ev.preventDefault();
      const input = el("chatInput");
      const text = input.value.trim();
      if (!text || input.disabled) return;
      appendChatTurn("you", text);
      input.value = "";
      const sendBtn = el("chatSend");
      input.disabled = true;
      sendBtn.disabled = true;
      sendBtn.setAttribute("aria-busy", "true");
      try {
        const fuzzy = el("fuzzyToggle").checked;
        const result = await session.turn(text, { fuzzy: fuzzy });
        setUnavailable(false);
        appendChatReply(result);
      } catch (err) {
        appendChatTurn("error", err && err.message ? err.message : String(err));
        if (session.unavailable) setUnavailable(true);
      } finally {
        sendBtn.removeAttribute("aria-busy");
        updateChatAvailability();
        input.focus();
      }
    });

    if (session.sessionKey) {
      try {
        const feed = await session.fetchFeed();
        renderAll(feed);
        appendLog("restored the session's last materialized feed");
      } catch (err) {
        setUnavailable(true);
        appendLog("could not load the saved session: " + (err && err.message ? err.message : String(err)));
      }
    } else {
      renderAll(EMPTY_FEED);
      appendLog("ready — nothing has been requested yet");
    }
  }

  boot().catch(function (err) { appendLog("boot failed: " + (err && err.message ? err.message : String(err))); });
})();
</script>
</body>
</html>`;
}
