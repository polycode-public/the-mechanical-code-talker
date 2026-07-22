// code-explorer-viz.mjs — the code-graph "ledger" the desktop shell renders:
// each import/call/contains edge read back as a plain sentence, a hint rail of
// suggested next queries, and a live chat dock over the same graph. The two
// derivations are pure so the shell, the packaging script, and the unit tests
// all share one code path; renderCodeExplorerHtml builds one self-contained
// document with no external requests.
//
// The channel is deliberately thin: this is the SAME ledger-pattern UI the
// browser ledger page uses, refocused on a code graph, and it stays servable
// as a plain page — only the Electron shell around it (electron/) is desktop.

import { THEME_TOKENS_CSS, SERIF_STACK, MONO_STACK, escapeHtml, embedJson, embedScriptText } from "./viz-theme.mjs";
import { generateCodeHints } from "../domain/code-explorer-hints.mjs";

// Third-person verb for each stored relation kind, symbol grain folded onto its
// coarse sibling. A kind with no row here reads back as itself, never breaking
// the sentence.
const EDGE_PHRASE = new Map([
  ["imports", "imports"],
  ["calls", "calls"], ["callsSymbol", "calls"],
  ["contains", "contains"],
  ["defines", "defines"],
  ["inherits", "inherits from"],
  ["tests", "tests"],
  ["touches", "touches"], ["touchesSymbol", "touches"],
  ["cochange", "co-changes with"],
  ["reexports", "re-exports"],
]);

export function edgePhrase(kind) {
  return EDGE_PHRASE.get(String(kind || "")) || String(kind || "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}

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

const CLIENT_JS = String.raw`
(function () {
  var DATA = window.__CODE_EXPLORER__;
  var api = window.tmctCodeExplorer || null;
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
  };
  var session = null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function renderStats(data) {
    var s = data.ledger.stats;
    var parts = [s.individuals + " individuals", s.edges + " edges"];
    var cls = s.classes.slice(0, 4).map(function (c) { return c[1] + " " + c[0]; });
    els.stats.textContent = parts.concat(cls).join("  ·  ");
  }

  function renderFocusRows(data) {
    var focus = data.focus;
    var rows = data.ledger.rows;
    var near = rows.filter(function (r) { return r.s === focus || r.o === focus; });
    var rest = rows.filter(function (r) { return r.s !== focus && r.o !== focus; });
    var ordered = near.concat(rest);
    els.ledger.innerHTML = ordered.map(function (r) {
      var hot = (r.s === focus || r.o === focus) ? " row-focus" : "";
      return '<li class="row' + hot + '">'
        + '<button class="term" data-term="' + esc(r.s) + '">' + esc(r.s) + '</button> '
        + '<span class="verb">' + esc(r.phrase) + '</span> '
        + '<button class="term" data-term="' + esc(r.o) + '">' + esc(r.o) + '</button>'
        + '</li>';
    }).join("") || '<li class="row muted">no edges in this graph.</li>';
    els.focus.textContent = focus || "—";
  }

  function renderHints(data) {
    els.hints.innerHTML = data.hints.map(function (h) {
      return '<button class="hint" data-q="' + esc(h.text) + '" title="' + esc(h.rationale) + '">'
        + esc(h.text) + '</button>';
    }).join("") || '<span class="muted">nothing to suggest for this graph.</span>';
  }

  function focusOn(term) {
    if (!api || !api.computeCodeExplorerData) return;
    DATA = api.computeCodeExplorerData(DATA.payload, { focus: term, title: DATA.meta.title });
    window.__CODE_EXPLORER__ = DATA;
    mountView(DATA);
  }

  function mountView(data) {
    renderStats(data);
    renderFocusRows(data);
    renderHints(data);
  }

  function appendLog(role, text) {
    var div = document.createElement("div");
    div.className = "turn turn-" + role;
    div.innerHTML = '<span class="who">' + (role === "you" ? "you" : "tmct") + '</span><span class="said">' + esc(text) + '</span>';
    els.log.appendChild(div);
    els.log.scrollTop = els.log.scrollHeight;
  }

  async function ensureSession() {
    if (session || !api || !api.createCodeExplorerSession) return session;
    var winkLoaded = true;
    if (api.registerWinkModel && window.__WINK_LOADER__) {
      try { var mod = await window.__WINK_LOADER__(); api.registerWinkModel(function () { return mod; }); }
      catch (e) { winkLoaded = false; }
    }
    session = api.createCodeExplorerSession({ graphPayload: DATA.payload });
    return session;
  }

  async function ask(q) {
    appendLog("you", q);
    var s = await ensureSession();
    if (!s) { appendLog("tmct", "the live dock is not loaded on this page."); return; }
    var res = await s.turn(q);
    appendLog("tmct", res.answer);
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

  // Desktop pickers, present only under the Electron shell.
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
          mountView(DATA);
        }
      } finally { btn.disabled = false; }
    });
  }
  wirePicker("open-graph", "openGraph", true);
  wirePicker("open-repo", "openRepo", true);

  if (!api) {
    if (els.dockNote) els.dockNote.textContent = "static view — the live chat dock is unavailable on this page.";
    if (els.input) els.input.disabled = true;
  }

  mountView(DATA);
})();
`;

/**
 * One self-contained HTML document for the code explorer. `data` is
 * computeCodeExplorerData's output. `bundleInline` inlines the dock engine
 * (for a single-file page / a data: URL); otherwise `bundleAvailable` links
 * `./code-explorer.bundle.js`. `winkLoaderInline` optionally inlines a wink
 * model loader as `window.__WINK_LOADER__`.
 */
export function renderCodeExplorerHtml(data, { bundleInline = "", bundleAvailable = false, winkLoaderInline = "", sourceName = "demo code graph" } = {}) {
  const payloadJson = embedJson(data.payload);
  const dataJson = embedJson({ ledger: data.ledger, hints: data.hints, focus: data.focus, meta: data.meta });
  const title = escapeHtml(data.meta?.title || "code explorer");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>tmct code explorer</title>
<style>
${THEME_TOKENS_CSS}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font-family: ${SERIF_STACK}; }
header { display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap; padding: 0.8rem 1.1rem; border-bottom: 1px solid var(--line); }
header h1 { font-size: 1.05rem; margin: 0; font-weight: 600; }
header .sub { color: var(--muted); font-size: 0.85rem; }
header .pickers { margin-left: auto; display: flex; gap: 0.5rem; }
button { font: inherit; cursor: pointer; }
button:disabled { cursor: default; opacity: 0.5; }
.pickers button { background: var(--card); color: var(--ink); border: 1px solid var(--line); border-radius: 6px; padding: 0.35rem 0.7rem; font-size: 0.85rem; }
#stats { padding: 0.4rem 1.1rem; color: var(--muted); font-size: 0.8rem; font-family: ${MONO_STACK}; border-bottom: 1px solid var(--line); }
main { display: grid; grid-template-columns: minmax(0, 1.7fr) minmax(260px, 1fr); gap: 0; align-items: stretch; }
@media (max-width: 720px) { main { grid-template-columns: 1fr; } }
.ledger-pane { padding: 0.6rem 1.1rem 2rem; min-height: 60vh; }
.rail { border-left: 1px solid var(--line); padding: 0.6rem 1rem 2rem; display: flex; flex-direction: column; gap: 1rem; }
h2 { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 0 0 0.4rem; }
ul.rows { list-style: none; margin: 0; padding: 0; }
.row { padding: 0.28rem 0.4rem; border-radius: 5px; font-size: 0.95rem; line-height: 1.5; }
.row-focus { background: var(--corpus-soft); }
.row.muted, .muted { color: var(--muted); }
.term { background: none; border: none; padding: 0; color: var(--corpus); font-family: ${MONO_STACK}; font-size: 0.85rem; text-decoration: underline; text-decoration-color: var(--line); }
.term:hover { text-decoration-color: var(--corpus); }
.verb { color: var(--muted); }
.hints { display: flex; flex-direction: column; gap: 0.35rem; }
.hint { text-align: left; background: var(--card); border: 1px solid var(--line); border-radius: 6px; padding: 0.35rem 0.55rem; font-size: 0.85rem; color: var(--ink); }
.hint:hover { border-color: var(--corpus); }
.dock { display: flex; flex-direction: column; gap: 0.4rem; }
#chat-log { display: flex; flex-direction: column; gap: 0.4rem; max-height: 40vh; overflow-y: auto; }
.turn { font-size: 0.9rem; line-height: 1.45; }
.turn .who { display: block; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
.turn-you .said { color: var(--ink); }
.turn-tmct .said { color: var(--taught); white-space: pre-wrap; }
#chat-form { display: flex; gap: 0.4rem; }
#chat-input { flex: 1; font: inherit; padding: 0.4rem 0.5rem; border: 1px solid var(--line); border-radius: 6px; background: var(--card); color: var(--ink); }
#chat-form button { background: var(--corpus); color: #fff; border: none; border-radius: 6px; padding: 0.4rem 0.8rem; }
#dock-note { color: var(--muted); font-size: 0.78rem; }
.focus-line { font-family: ${MONO_STACK}; font-size: 0.85rem; }
</style>
</head>
<body>
<header>
  <h1>tmct code explorer</h1>
  <span class="sub">source: <span id="source-name">${escapeHtml(sourceName)}</span></span>
  <div class="pickers">
    <button id="open-graph">Open graph…</button>
    <button id="open-repo">Open repo…</button>
  </div>
</header>
<div id="stats"></div>
<main>
  <section class="ledger-pane">
    <h2>Facts around <span class="focus-line" id="focus-name">—</span></h2>
    <ul class="rows" id="ledger"></ul>
  </section>
  <aside class="rail">
    <div>
      <h2>Try asking</h2>
      <div class="hints" id="hints"></div>
    </div>
    <div class="dock">
      <h2>Chat</h2>
      <div id="chat-log"></div>
      <form id="chat-form">
        <input id="chat-input" type="text" autocomplete="off" placeholder="ask about this graph…">
        <button type="submit">Ask</button>
      </form>
      <div id="dock-note"></div>
    </div>
  </aside>
</main>
<script>window.__CODE_EXPLORER__ = Object.assign({ payload: ${payloadJson} }, ${dataJson});</script>
${winkLoaderInline ? `<script>\n${embedScriptText(winkLoaderInline)}\n</script>` : ""}
${bundleInline ? `<script>\n${embedScriptText(bundleInline)}\n</script>` : ""}
${bundleAvailable && !bundleInline ? `<script src="./code-explorer.bundle.js"></script>` : ""}
<script>
${embedScriptText(CLIENT_JS)}
</script>
</body>
</html>`;
}
