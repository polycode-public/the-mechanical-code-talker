// code-explorer-viz.mjs — the code explorer as a full-viewport IDE shell:
// a title bar (graph source, Open graph…/Open repo…), an explorer sidebar
// reading each import/call/contains edge back as a plain sentence, a chat
// centre over the same graph with a rail of suggested questions, and a status
// bar carrying the graph's own counts. Clicking a term asks the engine what
// relates to it (askRelatedFacts, over tmct_ask) and renders the answer, so the
// sidebar and the chat put the same question to the same place.
//
// The chat session seeds BOTH the loaded code graph and chat.html's
// general-knowledge bands (./chat-seed.json, fetched lazily at runtime), so one
// conversation answers "what is a queue" and "what imports src/core/model.mjs"
// alike — and degrades to graph-only when the seed asset is unavailable.
//
// The derivations are pure so the shell, the packaging scripts, and the unit
// tests all share one code path; renderCodeExplorerHtml builds one
// self-contained document that both packagers ship unchanged — the site build
// (scripts/build-demo-site.mjs) and the Electron desktop shell
// (scripts/build-electron-app.mjs). Panels are plain sections inside the
// sidebar/centre grid, so a later panel is one more <section class="panel">,
// not a re-architecture.

import { THEME_TOKENS_CSS, SERIF_STACK, MONO_STACK, escapeHtml, embedJson, embedScriptText, demoEyebrowHtml, EYEBROW_LINKS_CSS } from "./viz-theme.mjs";
import { generateCodeHints } from "../domain/code-explorer-hints.mjs";
import { phraseForRelation } from "../domain/ask-vocab.mjs";
import { fetchWithProgress } from "./memory-panel-viz.mjs";

// Third-person verb for each stored relation kind, symbol grain folded onto
// its coarse sibling — derived from ask-vocab.mjs's own RELATIONS table
// rather than a second hand-curated relation-verb table.
export function edgePhrase(kind) {
  return phraseForRelation(kind);
}

// Both packagers (build-electron-app.mjs, build-demo-site.mjs) place
// vendor/wink.js one level below the page they render, so the same loader
// script inlines into renderCodeExplorerHtml's `winkLoaderInline` slot for
// either channel.
export const VENDOR_WINK_LOADER_JS = `window.__WINK_LOADER__ = async function () {
  var m = await import("./vendor/wink.js");
  return { winkNLP: m.winkNLP, model: m.model };
};`;

export const DESKTOP_APP_URL = "https://gitlab.com/polycode-projects/the-mechanical-code-talker#the-code-explorer-desktop";

const LEDGER_ROW_LIMIT_DEFAULT = 4000;

/** Pure derivation over an entities payload (individuals + objectProperties).
 *  Returns { rows, terms, focus, stats, meta } — rows are one readable
 *  sentence per example edge, terms is the degree-ranked label index, and the
 *  neighbourhood of `focus` survives a row cap first so a huge graph degrades
 *  to "local + rest" rather than truncating the centre. */
export function computeCodeLedger(payload, { focus = null, rowLimit = LEDGER_ROW_LIMIT_DEFAULT } = {}) {
  const individuals = Array.isArray(payload?.individuals) ? payload.individuals : [];
  const classOf = new Map();
  for (const ind of individuals) if (ind?.label && !classOf.has(ind.label)) classOf.set(ind.label, ind.class || "");

  const groups = Array.isArray(payload?.objectProperties) ? payload.objectProperties : [];
  const rows = [];
  const degree = new Map();
  const kindCounts = new Map();
  const bumpTerm = (t) => { if (t) degree.set(t, (degree.get(t) || 0) + 1); };
  for (const g of groups) {
    if (!g?.predicate) continue;
    const kind = String(g.predicate);
    kindCounts.set(kind, (kindCounts.get(kind) || 0) + (Number(g.count) || 0));
    for (const e of Array.isArray(g.examples) ? g.examples : []) {
      const s = e?.subjectLabel || e?.subject;
      const o = e?.objectLabel || e?.object;
      if (!s || !o) continue;
      rows.push({ s, kind, phrase: edgePhrase(kind), o, sClass: classOf.get(s) || "", oClass: classOf.get(o) || "" });
      bumpTerm(s); bumpTerm(o);
    }
  }

  const terms = [...degree.entries()]
    .map(([term, deg]) => ({ term, degree: deg, class: classOf.get(term) || "" }))
    .sort((a, b) => b.degree - a.degree || a.term.localeCompare(b.term));

  let focusTerm = focus && degree.has(focus) ? focus : null;
  if (!focusTerm && terms.length) focusTerm = terms[0].term;

  const classCounts = new Map();
  for (const ind of individuals) if (ind?.class) classCounts.set(ind.class, (classCounts.get(ind.class) || 0) + 1);
  const stats = {
    individuals: individuals.length,
    edges: rows.length,
    classes: [...classCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    kinds: [...kindCounts.entries()].filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
  };

  const total = rows.length;
  let shown = rows;
  if (total > rowLimit) {
    const near = new Set([focusTerm]);
    for (const r of rows) { if (r.s === focusTerm) near.add(r.o); if (r.o === focusTerm) near.add(r.s); }
    const inHood = (r) => near.has(r.s) || near.has(r.o);
    shown = [...rows.filter(inHood), ...rows.filter((r) => !inHood(r))].slice(0, rowLimit);
  }
  return { rows: shown, terms, focus: focusTerm, stats, meta: { shown: shown.length, total, truncated: shown.length < total } };
}

/** Everything the page embeds, derived once from a payload: the ledger, the
 *  degree-ranked terms, the suggested queries, and the focus symbol. */
export function computeCodeExplorerData(payload, opts = {}) {
  const ledger = computeCodeLedger(payload, opts);
  const { focus, hints } = generateCodeHints(payload, { focus: ledger.focus });
  return { payload, ledger, hints, focus: ledger.focus || focus, meta: { title: opts.title || "code graph" } };
}

// ---- client script pieces, spliced into CLIENT_JS below -------------------
// Named module functions so the page's own source reads as a list of calls
// into real, unit-tested code rather than an inlined block. Each is written
// to survive a `.toString()` round trip into a browser `<script>` tag: no
// closure over this module's own scope, only its parameters and whichever
// sibling below it is also spliced into the same page script.

/** One line naming the loaded graph's own size: individual/edge counts, then
 *  up to four of its most common classes. */
export function statsSummaryLine(ledgerStats) {
  var parts = [ledgerStats.individuals + " individuals", ledgerStats.edges + " edges"];
  var cls = ledgerStats.classes.slice(0, 4).map(function (c) { return c[1] + " " + c[0]; });
  return parts.concat(cls).join("  ·  ");
}

/** Every fact the chat can draw on: the graph's own edges plus whatever the
 *  general-knowledge seed has counted so far. */
export function factTotalText(edges, seedFacts) {
  return (edges + seedFacts).toLocaleString();
}

export function rowKey(row) { return JSON.stringify([row.s, row.kind, row.o]); }

/** The sidebar's rows: the engine's own answer about the focus when it
 *  grounded one, the row list's plain filter otherwise, then whatever
 *  neither named — a fold over the rest of the graph. */
export function focusRowsHtml(data, related) {
  var focus = data.focus;
  var rows = data.ledger.rows;
  var grounded = Boolean(related && related.grounded);
  var near = grounded ? related.rows : rows.filter(function (r) { return r.s === focus || r.o === focus; });
  var nearKeys = {};
  near.forEach(function (r) { nearKeys[rowKey(r)] = true; });
  var rest = rows.filter(function (r) { return !nearKeys[rowKey(r)]; });
  var ordered = near.concat(rest);
  return ordered.map(function (r) {
    var hot = (r.s === focus || r.o === focus) ? " row-focus" : "";
    return '<li class="row' + hot + '">'
      + '<button class="term" data-term="' + escapeHtml(r.s) + '">' + escapeHtml(r.s) + '</button> '
      + '<span class="verb">' + escapeHtml(r.phrase) + '</span> '
      + '<button class="term" data-term="' + escapeHtml(r.o) + '">' + escapeHtml(r.o) + '</button>'
      + '</li>';
  }).join("") || (grounded
    ? '<li class="row muted">nothing in this graph relates to ' + escapeHtml(focus) + '.</li>'
    : '<li class="row muted">no edges in this graph.</li>');
}

export function hintsHtml(hints) {
  return hints.map(function (h) {
    return '<button class="hint" data-q="' + escapeHtml(h.text) + '" title="' + escapeHtml(h.rationale) + '">'
      + escapeHtml(h.text) + '</button>';
  }).join("") || '<span class="muted">nothing to suggest for this graph.</span>';
}

export function turnHtml(role, text) {
  return '<span class="who">' + (role === "you" ? "you" : "tmct") + '</span><span class="said">' + escapeHtml(text) + '</span>';
}

export function chatEmptyStateHtml(hasEngine) {
  return hasEngine
    ? '<p class="chat-empty-head">Ask the graph, or ask it anything</p>'
      + '<p>Ask about the code graph on the left, or about anything its general knowledge covers, like “what is a queue”.</p>'
      + '<p class="chat-empty-hint">Try one of the questions below, or type your own.</p>'
    : '<p class="chat-empty-head">Static view</p>'
      + '<p>This page shows a fixed snapshot of the graph. The live chat is not available here.</p>';
}

export function mbText(n) { return (n / 1048576).toFixed(1); }

/** How many of the seed's own individuals are facts — the general-knowledge
 *  half of the fact-total pill. */
export function seedFactsFromPayload(payload) {
  return (payload.individuals || []).filter(function (i) { return i.class === "Fact"; }).length;
}

export function seedLoadingNote(loadedBytes, totalBytes) {
  return "loading general knowledge… " + mbText(loadedBytes) + (totalBytes ? " of " + mbText(totalBytes) : "") + " MB";
}

/** One retry with a cache-busting query param, fetch side only: a CDN edge
 *  can serve a corrupted or truncated precompressed response (a transient
 *  bad cache entry, not a code defect — real bytes decompress fine, and the
 *  same URL fetched moments later is clean), and JSON.parse throwing is the
 *  only signal of that. `fetcher` is `fetchWithProgress` (or a stand-in for
 *  a test); `baseUrl` already carries the build's own content-hash query
 *  string, if any, so the bust param joins with `&` or `?` accordingly. */
export async function fetchSeedPayloadWithRetry(fetcher, baseUrl, seedQuery, onProgress) {
  var lastErr = null;
  for (var attempt = 1; attempt <= 2; attempt++) {
    try {
      var bust = attempt === 1 ? "" : (seedQuery ? "&" : "?") + "retry=1";
      var seedBlob = await fetcher(baseUrl + seedQuery + bust, onProgress);
      var text = await seedBlob.text();
      return JSON.parse(text); // throwing here is the corrupted/truncated-response retry signal
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

const CLIENT_JS = String.raw`
(function () {
  var DATA = window.__CODE_EXPLORER__;
  var api = window.tmct ? window.tmct.page : null;
  var els = {
    focus: document.getElementById("focus-name"),
    ledger: document.getElementById("ledger"),
    hints: document.getElementById("hints"),
    stats: document.getElementById("stats"),
    log: document.getElementById("chat-log"),
    form: document.getElementById("chat-form"),
    input: document.getElementById("chat-input"),
    dockNote: document.getElementById("dock-note"),
    source: document.getElementById("source-name"),
    seedStatus: document.getElementById("seed-status"),
    factTotal: document.getElementById("fact-total-value"),
  };
  var session = null;

  var escapeHtml = ${escapeHtml.toString()};
  var rowKey = ${rowKey.toString()};
  var statsSummaryLine = ${statsSummaryLine.toString()};
  var factTotalText = ${factTotalText.toString()};
  var focusRowsHtml = ${focusRowsHtml.toString()};
  var hintsHtml = ${hintsHtml.toString()};
  var turnHtml = ${turnHtml.toString()};
  var chatEmptyStateHtml = ${chatEmptyStateHtml.toString()};

  function renderStats(data) {
    els.stats.textContent = statsSummaryLine(data.ledger.stats);
    renderFactTotal(data);
  }

  // Everything the chat can answer from: the graph's own edges plus the
  // general-knowledge seed, which arrives later and re-renders this.
  function renderFactTotal(data) {
    if (!els.factTotal) return;
    var edges = (data && data.ledger && data.ledger.stats && data.ledger.stats.edges) || 0;
    els.factTotal.textContent = factTotalText(edges, seedState.facts);
  }

  // "What relates to the focus", put to the engine. askRelatedFacts asks
  // tmct_ask one question per relation kind the loaded graph carries, in both
  // directions, and hands back the answers' own typed rows — the same ask()
  // this page's chat turns reach, so the panel and the conversation answer one
  // question one way. Null on the static page, which has no engine to ask.
  function askRelated(focus) {
    if (!api || !api.askRelatedFacts || !focus) return null;
    try {
      return api.askRelatedFacts(DATA.payload, focus);
    } catch (e) {
      console.warn("tmct code explorer: the related-facts ask failed, splitting the row list instead", e);
      return null;
    }
  }

  // The engine's answer whenever it grounded one. The row list's own split is
  // what is left when there is no engine (the static page) or when every
  // question came back parsed as something else — an identifier that is
  // itself a relation verb reads as a question about the verb. Whatever the
  // neighbourhood did not already name follows, in degree order: a bulk view
  // of the rest of the graph, which is a fold and not a question.
  function renderFocusRows(data, related) {
    els.ledger.innerHTML = focusRowsHtml(data, related);
    els.focus.textContent = data.focus || "—";
  }

  function renderHints(data) {
    els.hints.innerHTML = hintsHtml(data.hints);
  }

  function focusOn(term) {
    if (!api || !api.computeCodeExplorerData) return;
    DATA = api.computeCodeExplorerData(DATA.payload, { focus: term, title: DATA.meta.title });
    window.__CODE_EXPLORER__ = DATA;
    mountView(DATA);
  }

  function mountView(data) {
    renderStats(data);
    renderFocusRows(data, askRelated(data.focus));
    renderHints(data);
  }

  function clearEmptyState() {
    var e = document.getElementById("chat-empty");
    if (e) e.remove();
  }

  function appendTurn(role, text) {
    clearEmptyState();
    var div = document.createElement("div");
    div.className = "turn turn-" + role;
    div.innerHTML = turnHtml(role, text);
    els.log.appendChild(div);
    els.log.scrollTop = els.log.scrollHeight;
  }

  function renderEmptyState() {
    var div = document.createElement("div");
    div.className = "chat-empty";
    div.id = "chat-empty";
    div.innerHTML = chatEmptyStateHtml(Boolean(api));
    els.log.appendChild(div);
  }

  // ---- the general-knowledge seed --------------------------------------
  // The same chat-seed.json chat.html boots from, loaded lazily so the shell
  // paints instantly: same-origin fetch on the site, the preload bridge's
  // readSeed under the desktop shell (a file:// page cannot fetch). The
  // status bar narrates the load; a missing or failing seed leaves the chat
  // graph-only and says so, never broken.
  // The build's own content hash for the seed rides in the URL, so the service
  // worker's cache-first read can only return the copy this page asked for.
  // Empty under the desktop shell, which reads the seed off disk instead.
  var SEED_QUERY = DATA.seedStamp ? "?b=" + DATA.seedStamp : "";
  var seedState = { status: api ? "loading" : "absent", payload: null, facts: 0 };
  function seedNote(text) { if (els.seedStatus) els.seedStatus.textContent = text; }

  var mbText = ${mbText.toString()};
  var fetchWithProgress = ${fetchWithProgress.toString()};
  var seedFactsFromPayload = ${seedFactsFromPayload.toString()};
  var seedLoadingNote = ${seedLoadingNote.toString()};
  var fetchSeedPayloadWithRetry = ${fetchSeedPayloadWithRetry.toString()};

  // The desktop shell's readSeed() reads off local disk, not a CDN, so it
  // keeps its single attempt in loadSeed() below; only this fetch path retries.
  function fetchSeedPayload() {
    return fetchSeedPayloadWithRetry(fetchWithProgress, "./chat-seed.json", SEED_QUERY, function (loaded, total) {
      seedNote(seedLoadingNote(loaded, total));
    });
  }

  async function loadSeed() {
    try {
      var payload = null;
      if (window.tmctDesktop && typeof window.tmctDesktop.readSeed === "function") {
        seedNote("loading general knowledge…");
        var text = await window.tmctDesktop.readSeed();
        if (text) payload = JSON.parse(text);
      } else {
        payload = await fetchSeedPayload();
      }
      if (payload) {
        seedState.payload = payload;
        seedState.facts = seedFactsFromPayload(seedState.payload);
        seedState.status = "ready";
        seedNote("general knowledge: " + seedState.facts + " facts");
        renderFactTotal(DATA);
        return;
      }
    } catch (e) {
      console.warn("tmct code explorer: chat-seed unavailable, continuing graph-only", e);
    }
    seedState.status = "absent";
    seedNote("graph-only, general knowledge unavailable");
  }
  var seedPromise = api ? loadSeed() : Promise.resolve();

  function cloneSeed() {
    if (!seedState.payload) return null;
    try { return structuredClone(seedState.payload); } catch (e) { return JSON.parse(JSON.stringify(seedState.payload)); }
  }

  async function ensureSession() {
    if (session || !api || !api.createCodeExplorerSession) return session;
    if (api.registerWinkModel && window.__WINK_LOADER__) {
      try { var mod = await window.__WINK_LOADER__(); api.registerWinkModel(function () { return mod; }); }
      catch (e) { /* the lemma/POS tier is optional */ }
    }
    await seedPromise;
    session = api.createCodeExplorerSession({
      graphPayload: DATA.payload,
      seedPayload: cloneSeed(),
      vocabSeeded: seedState.status === "ready",
    });
    return session;
  }

  async function ask(q) {
    appendTurn("you", q);
    var s = await ensureSession();
    if (!s) { appendTurn("tmct", "the live chat is not loaded on this page."); return; }
    var res = await s.turn(q);
    appendTurn("tmct", res.answer);
  }

  // Delegate term + hint clicks.
  document.addEventListener("click", function (ev) {
    var t = ev.target.closest ? ev.target.closest("[data-term]") : null;
    if (t) { focusOn(t.getAttribute("data-term")); return; }
    var h = ev.target.closest ? ev.target.closest("[data-q]") : null;
    if (h) { els.input.value = h.getAttribute("data-q"); els.input.focus(); if (api) ask(h.getAttribute("data-q")); return; }
  });

  if (els.form) {
    els.form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var q = els.input.value.trim();
      if (!q) return;
      els.input.value = "";
      ask(q);
    });
  }

  // Desktop pickers, present only under the Electron shell. A swapped graph
  // starts a fresh session; the general-knowledge seed carries over.
  function wirePicker(id, method, updateSource) {
    var btn = document.getElementById(id);
    if (!btn) return;
    if (!window.tmctDesktop || typeof window.tmctDesktop[method] !== "function") { btn.disabled = true; return; }
    btn.addEventListener("click", async function () {
      btn.disabled = true;
      try {
        var picked = await window.tmctDesktop[method]();
        if (picked && picked.payload) {
          session = null;
          DATA = (api && api.computeCodeExplorerData)
            ? api.computeCodeExplorerData(picked.payload, { title: picked.name || "code graph" })
            : DATA;
          window.__CODE_EXPLORER__ = DATA;
          if (updateSource && els.source) els.source.textContent = picked.name || "(loaded graph)";
          els.log.innerHTML = "";
          renderEmptyState();
          mountView(DATA);
        }
      } finally { btn.disabled = false; }
    });
  }
  wirePicker("open-graph", "openGraph", true);
  wirePicker("open-repo", "openRepo", true);

  if (!api) {
    if (els.dockNote) els.dockNote.textContent = "static view, live chat unavailable here.";
    if (els.input) els.input.disabled = true;
    seedNote("static view");
  }
  renderEmptyState();

  mountView(DATA);
})();
`;

/**
 * One self-contained HTML document: the full-viewport IDE shell over
 * computeCodeExplorerData's output. `bundleInline` inlines the chat engine
 * (for a single-file page / a data: URL); otherwise `bundleAvailable` links
 * `./code-explorer.bundle.js`. `winkLoaderInline` optionally inlines a wink
 * model loader as `window.__WINK_LOADER__`. `showDesktopLink` adds a line
 * pointing at the desktop app's README section — the desktop shell itself
 * renders this page too and passes `false`, since it has nothing to point at.
 */
export function renderCodeExplorerHtml(data, { bundleInline = "", bundleAvailable = false, winkLoaderInline = "", sourceName = "demo code graph", showDesktopLink = false, seedStamp = "" } = {}) {
  const payloadJson = embedJson(data.payload);
  const dataJson = embedJson({ ledger: data.ledger, hints: data.hints, focus: data.focus, meta: data.meta });

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>tmct code explorer</title>
<link rel="icon" href="./favicon.svg" type="image/svg+xml">
<link rel="icon" href="./favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="./apple-touch-icon.png">
<style>
${THEME_TOKENS_CSS}
* { box-sizing: border-box; }
html, body { height: 100%; }
body { margin: 0; overflow: hidden; background: var(--bg); color: var(--ink); font-family: ${SERIF_STACK}; }
.shell { height: 100%; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; }

.titlebar { display: flex; align-items: center; gap: 0.7rem; flex-wrap: wrap; padding: 0.5rem 0.9rem; background: var(--card); border-bottom: 1px solid var(--line); box-shadow: inset 0 -2px 0 var(--entail-soft); }
.titlebar .mark { width: 15px; height: 15px; color: var(--entail); flex: none; }
.titlebar h1 { font-size: 0.95rem; margin: 0; font-weight: 600; letter-spacing: 0.02em; }
${EYEBROW_LINKS_CSS}
.titlebar .sub { color: var(--muted); font-size: 0.76rem; font-family: ${MONO_STACK}; }
.titlebar .sub a { color: var(--corpus); }
/* the fact count sits in the titlebar, not the footer status bar: it is what
   the chat can actually answer from, and the footer is where a wrong number
   goes unread. */
.titlebar .factpill { display: inline-flex; align-items: baseline; gap: 0.34rem; font-family: ${MONO_STACK}; font-size: 0.62rem; letter-spacing: 0.07em; text-transform: uppercase; color: var(--muted); border: 1px solid var(--entail); border-radius: 99px; padding: 0.14rem 0.7rem; background: var(--entail-soft); white-space: nowrap; }
.titlebar .factpill-value { font-size: 0.9rem; letter-spacing: 0; font-variant-numeric: tabular-nums; font-weight: 600; color: var(--ink); }
.titlebar .pickers { margin-left: auto; display: flex; gap: 0.45rem; }
button { font: inherit; cursor: pointer; }
button:disabled { cursor: default; opacity: 0.5; }
button:focus-visible, input:focus-visible { outline: 2px solid var(--entail); outline-offset: 1px; }
.pickers button { background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 4px; padding: 0.3rem 0.65rem; font-size: 0.8rem; }
.pickers button:hover { border-color: var(--entail); }

.workbench { display: grid; grid-template-columns: minmax(230px, 320px) minmax(0, 1fr); min-height: 0; }
.sidebar { display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--line); }
.panel { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.panel-head { margin: 0; padding: 0.45rem 0.9rem; flex: none; display: flex; align-items: baseline; gap: 0.45rem; font-family: ${MONO_STACK}; font-size: 0.66rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.09em; color: var(--muted); border-bottom: 1px solid var(--line); }
.panel-body { flex: 1; min-height: 0; overflow-y: auto; padding: 0.5rem 0.9rem 1rem; }
.focus-line { font-family: ${MONO_STACK}; font-size: 0.72rem; color: var(--corpus); text-transform: none; letter-spacing: 0; overflow-wrap: anywhere; }
ul.rows { list-style: none; margin: 0; padding: 0; }
.row { padding: 0.26rem 0.35rem; border-radius: 4px; font-size: 0.88rem; line-height: 1.45; }
.row-focus { background: var(--corpus-soft); }
.row.muted, .muted { color: var(--muted); }
.term { background: none; border: none; padding: 0; color: var(--corpus); font-family: ${MONO_STACK}; font-size: 0.8rem; text-align: left; text-decoration: underline; text-decoration-color: var(--line); overflow-wrap: anywhere; }
.term:hover { text-decoration-color: var(--corpus); }
.verb { color: var(--muted); }

.editor { display: flex; flex-direction: column; min-height: 0; background: var(--card); }
#chat-log { flex: 1; min-height: 0; overflow-y: auto; padding: 0.9rem 1.1rem; display: flex; flex-direction: column; gap: 0.7rem; }
.turn { max-width: 46rem; font-size: 0.95rem; line-height: 1.5; }
.turn .who { display: block; font-family: ${MONO_STACK}; font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); margin-bottom: 0.15rem; }
.turn-you .said { font-family: ${MONO_STACK}; font-size: 0.84rem; }
.turn-tmct { border-left: 2px solid var(--entail); padding-left: 0.7rem; }
.turn-tmct .said { white-space: pre-wrap; }
.chat-empty { margin: auto; max-width: 26rem; text-align: center; color: var(--muted); }
.chat-empty-head { color: var(--ink); font-weight: 600; font-size: 1.05rem; margin: 0 0 0.5rem; }
.chat-empty p { margin: 0.3rem 0; line-height: 1.55; font-size: 0.92rem; }
.chat-empty-hint { font-size: 0.82rem; }
.suggest { flex: none; border-top: 1px solid var(--line); padding: 0.65rem 1.1rem 0.4rem; }
.suggest-label { font-family: ${MONO_STACK}; font-size: 0.66rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.09em; color: var(--muted); }
.hints { display: flex; flex-wrap: wrap; gap: 0.4rem; max-height: 5.6rem; overflow-y: auto; padding: 0.45rem 0 0.55rem; }
.hint { background: var(--bg); border: 1px solid var(--line); border-radius: 999px; padding: 0.24rem 0.7rem; font-size: 0.8rem; color: var(--ink); text-align: left; }
.hint:hover { border-color: var(--entail); }
#chat-form { flex: none; display: flex; gap: 0.5rem; padding: 0.75rem 1.1rem 0.9rem; border-top: 1px solid var(--line); }
#chat-input { flex: 1; min-width: 0; font: inherit; font-size: 0.92rem; padding: 0.5rem 0.65rem; border: 1px solid var(--line); border-radius: 4px; background: var(--bg); color: var(--ink); }
#chat-form button { background: var(--entail); color: var(--card); font-weight: 600; border: none; border-radius: 4px; padding: 0.5rem 1rem; font-size: 0.9rem; }

.statusbar { display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap; padding: 0.32rem 0.9rem; font-family: ${MONO_STACK}; font-size: 0.7rem; color: var(--muted); background: var(--entail-soft); border-top: 1px solid var(--entail); }
#seed-status { margin-left: auto; text-align: right; }

@media (max-width: 760px) {
  .workbench { grid-template-columns: 1fr; grid-template-rows: minmax(0, 34%) minmax(0, 1fr); }
  .sidebar { border-right: none; border-bottom: 1px solid var(--line); }
}
</style>
</head>
<body>
<div class="shell">
  <header class="titlebar">
    <svg class="mark" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 0l1 2.3a5.8 5.8 0 0 1 1.9.8L13.3 2l.7.7-1.1 2.4c.4.6.6 1.2.8 1.9L16 8l-2.3 1a5.8 5.8 0 0 1-.8 1.9l1.1 2.4-.7.7-2.4-1.1a5.8 5.8 0 0 1-1.9.8L8 16l-1-2.3a5.8 5.8 0 0 1-1.9-.8L2.7 14l-.7-.7 1.1-2.4a5.8 5.8 0 0 1-.8-1.9L0 8l2.3-1c.2-.7.4-1.3.8-1.9L2 2.7l.7-.7 2.4 1.1A5.8 5.8 0 0 1 7 2.3L8 0zm0 5.2A2.8 2.8 0 1 0 8 10.8 2.8 2.8 0 0 0 8 5.2z"/></svg>
    <h1>${demoEyebrowHtml("code", "code explorer")}</h1>
    <span class="sub">source: <span id="source-name">${escapeHtml(sourceName)}</span></span>
    <span class="factpill" id="fact-total" aria-live="polite" title="every fact this page's chat can draw on — the code graph's own edges plus the general-knowledge seed once it lands">
      <span class="factpill-value" id="fact-total-value">&mdash;</span> facts loaded
    </span>
    ${showDesktopLink ? `<span class="sub">Also available as a <a href="${DESKTOP_APP_URL}">desktop app</a>.</span>` : ""}
    <div class="pickers">
      <button id="open-graph">Open graph…</button>
      <button id="open-repo">Open repo…</button>
    </div>
  </header>
  <div class="workbench">
    <aside class="sidebar">
      <section class="panel" data-panel="explorer">
        <h2 class="panel-head">Facts around <span class="focus-line" id="focus-name">—</span></h2>
        <div class="panel-body">
          <ul class="rows" id="ledger"></ul>
        </div>
      </section>
    </aside>
    <section class="editor" data-panel="conversation">
      <h2 class="panel-head">Conversation</h2>
      <div id="chat-log"></div>
      <div class="suggest">
        <span class="suggest-label">Try asking</span>
        <div class="hints" id="hints"></div>
      </div>
      <form id="chat-form">
        <input id="chat-input" type="text" autocomplete="off" placeholder="ask about this graph, or anything it knows…">
        <button type="submit">Ask</button>
      </form>
    </section>
  </div>
  <footer class="statusbar">
    <span id="stats"></span>
    <span id="dock-note"></span>
    <span id="seed-status"></span>
  </footer>
</div>
<script>window.__CODE_EXPLORER__ = Object.assign({ payload: ${payloadJson}, seedStamp: ${JSON.stringify(seedStamp)} }, ${dataJson});</script>
${winkLoaderInline ? `<script>\n${embedScriptText(winkLoaderInline)}\n</script>` : ""}
${bundleInline ? `<script>\n${embedScriptText(bundleInline)}\n</script>` : ""}
${bundleAvailable && !bundleInline ? `<script src="./code-explorer.bundle.js"></script>` : ""}
<script>
${embedScriptText(CLIENT_JS)}
</script>
</body>
</html>`;
}
