// ledger-viz.mjs — `tmct viz --ledger`: the memory graph as a readable ledger
// of fact-sentences around one focus term (PLAN_VIZ_LEDGER.md phase 1).
//
// Same three-piece factoring as viz.mjs:
//   - computeLedgerData(repoDir, opts)      — I/O (loadMemory) + derivation
//   - computeLedgerDataFromPayload(payload) — the pure derivation half
//   - renderLedgerHtml(data)                — pure string builder, one
//     self-contained document, no external requests.

import { loadMemory, readFactRows, findContradictions, normFactTerm } from "./memory/core.mjs";
import { escapeHtml, embedJson } from "./viz.mjs";
import { THEME_TOKENS_CSS, SERIF_STACK, MONO_STACK } from "./viz-theme.mjs";

export const LEDGER_ROW_LIMIT_DEFAULT = 20000;

// Predicate rendering + family grouping. A closed table with a verbatim
// fallback: an unknown predicate still reads as itself, never breaks the page.
const PHRASES = new Map([
  ["rdfs:subClassOf", "is a kind of"],
  ["rdf:type", "is a"],
  ["mgx:hasA", "has"],
  ["mgx:partOf", "is part of"],
  ["mgx:madeOf", "is made of"],
  ["mgx:capableOf", "can"],
  ["mgx:receivesAction", "can be"],
  ["mgx:usedFor", "is used for"],
  ["mgx:mannerOf", "is a way of"],
  ["mgx:ownedBy", "is owned by"],
  ["mgx:createdBy", "is created by"],
  ["mgx:hasProperty", "is"],
  ["mgx:atLocation", "is at"],
]);
const PREP_FOLD_RE = /^mgx:([a-z]+)-(on|in|at|onto|upon|under|over|beside|near|behind|above|below|inside|outside)$/;
const COMPARATIVE_RE = /^mgx:([a-z][a-z-]*)-than$/;

export function phraseFor(predicate) {
  const p = String(predicate || "");
  const curated = PHRASES.get(p);
  if (curated) return curated;
  const prep = PREP_FOLD_RE.exec(p);
  if (prep) return `${prep[1]}s ${prep[2]}`;
  const comp = COMPARATIVE_RE.exec(p);
  if (comp) return `is ${comp[1].replace(/-/g, " ")} than`;
  return p.replace(/^mgx:/, "").replace(/[-_]/g, " ");
}

const FAMILY_OF = new Map([
  ["rdfs:subClassOf", "is-a"], ["rdf:type", "is-a"],
  ["mgx:hasA", "has"], ["mgx:partOf", "has"], ["mgx:madeOf", "has"],
  ["mgx:capableOf", "can"], ["mgx:receivesAction", "can"],
  ["mgx:usedFor", "used-for"], ["mgx:mannerOf", "used-for"],
  ["mgx:ownedBy", "role"], ["mgx:createdBy", "role"], ["mgx:hasProperty", "role"],
]);
export const FAMILIES = Object.freeze(["is-a", "has", "can", "used-for", "rests-on", "role", "other"]);

export function familyFor(predicate) {
  const p = String(predicate || "");
  const fixed = FAMILY_OF.get(p);
  if (fixed) return fixed;
  if (PREP_FOLD_RE.test(p)) return "rests-on";
  return "other";
}

/** Provenance bucket for one fact row: who says so. Taught wins over
 *  entailed (the stronger claim when a fact carries both), source types win
 *  over the legacy provenance string. */
export function provBucketFor(sourceTypes = [], provenance = "") {
  const t = new Set(sourceTypes);
  if (t.has("teach") || t.has("operator")) return "taught";
  if (t.has("entailed")) return "entailed";
  if (t.size) return "corpus";
  const p = String(provenance);
  if (/(^|\|\s*)(teach|ace|operator)\b/i.test(p)) return "taught";
  if (/entailed/i.test(p)) return "entailed";
  return "corpus";
}

const trustTierFor = (trust) => (trust >= 0.85 ? 3 : trust >= 0.5 ? 2 : 1);

/** Pure derivation over a loaded memory payload (the half scripts/
 *  build-demo-site.mjs consumes directly). Returns
 *  { rows, terms, edges, focus, contradictions, worthALook, payload, meta }. */
export function computeLedgerDataFromPayload(payload, { focus, term, rowLimit = LEDGER_ROW_LIMIT_DEFAULT } = {}) {
  const individuals = payload?.individuals || [];
  const indById = new Map(individuals.map((i) => [i?.id, i]));
  const factRows = readFactRows(payload);

  const rows = factRows.map((r) => {
    const ind = indById.get(r.id);
    const createdAt = (ind?.attributes || []).find((a) => a?.key === "createdAt")?.value || "";
    return {
      id: r.id, s: r.subject, p: r.predicate, o: r.object,
      phrase: phraseFor(r.predicate),
      prov: provBucketFor(r.sourceTypes, r.provenance),
      trustTier: trustTierFor(r.trust),
      family: familyFor(r.predicate),
      createdAt,
      src: r.provenance || (r.sourceTypes || []).join(" ") || "unrecorded",
    };
  });
  rows.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "") || a.id.localeCompare(b.id));

  // Term index + adjacency.
  const termMap = new Map(); // term -> { degree, best: {trust, prov}, newest }
  const bump = (t, row, trust) => {
    if (!t) return;
    const cur = termMap.get(t) || { term: t, degree: 0, prov: row.prov, best: -1, newest: "" };
    cur.degree += 1;
    if (trust > cur.best) { cur.best = trust; cur.prov = row.prov; }
    if ((row.createdAt || "") > cur.newest) cur.newest = row.createdAt || "";
    termMap.set(t, cur);
  };
  const trustById = new Map(factRows.map((r) => [r.id, r.trust]));
  for (const row of rows) {
    bump(row.s, row, trustById.get(row.id) || 0);
    bump(row.o, row, trustById.get(row.id) || 0);
  }
  const terms = [...termMap.values()]
    .map(({ term: t, degree, prov, newest }) => ({ term: t, degree, prov, newest }))
    .sort((a, b) => b.degree - a.degree || a.term.localeCompare(b.term));
  const edges = rows.map((r) => ({ s: r.s, o: r.o, id: r.id }));

  // Focus: the asked term when it resolves; otherwise the newest taught
  // row's subject, then the highest-degree term. A miss never seeds a
  // phantom term (viz.mjs's own --term rule).
  let focusTerm = null;
  const asked = focus || term;
  if (asked) {
    const nf = normFactTerm(asked);
    if (termMap.has(nf)) focusTerm = nf;
  }
  if (!focusTerm) {
    const newestTaught = rows.find((r) => r.prov === "taught");
    if (newestTaught) focusTerm = newestTaught.s;
    else if (terms.length) focusTerm = terms[0].term;
  }

  const rowIds = new Set(rows.map((r) => r.id));
  const contradictions = findContradictions(payload)
    .map((group) => group.map((r) => r.id).filter((id) => rowIds.has(id)))
    .filter((ids) => ids.length > 1);

  const newestTaughtRow = rows.find((r) => r.prov === "taught") || null;
  const firstContra = contradictions.length ? rows.find((r) => r.id === contradictions[0][0]) : null;
  const worthALook = {
    newestTaught: newestTaughtRow ? { rowId: newestTaughtRow.id, term: newestTaughtRow.s } : null,
    contradictions: { count: contradictions.length, firstFocusTerm: firstContra ? firstContra.s : null },
    biggestHub: terms.length ? { term: terms[0].term, degree: terms[0].degree } : null,
  };

  // Row cap: the focus 2-hop neighborhood survives first (the minimap's own
  // radius, so facet counts and the map stay mutually correct), the rest by
  // recency, so a huge store degrades to "recent + local" honestly.
  const total = rows.length;
  let shownRows = rows;
  if (total > rowLimit) {
    const hop1 = new Set();
    for (const e of edges) {
      if (e.s === focusTerm) hop1.add(e.o);
      if (e.o === focusTerm) hop1.add(e.s);
    }
    const near = new Set([focusTerm, ...hop1]);
    const inHood = (r) => near.has(r.s) || near.has(r.o);
    const hood = rows.filter(inHood);
    const rest = rows.filter((r) => !inHood(r));
    shownRows = [...hood, ...rest].slice(0, rowLimit);
  }
  const meta = { shown: shownRows.length, total, truncated: shownRows.length < total };

  return { rows: shownRows, terms, edges, focus: focusTerm, contradictions, worthALook, payload, meta };
}

/** Load the memory graph under `repoDir` and derive the ledger data. Never
 *  throws on a missing/empty memory dir. */
export async function computeLedgerData(repoDir, opts = {}) {
  const payload = await loadMemory(repoDir);
  return computeLedgerDataFromPayload(payload, opts);
}

/** The chat dock's answer-to-focus resolver (viz.mjs's findAnsweredTermIds,
 *  retargeted at the ledger term index). Pass 1: earliest term label (≥3
 *  chars, space-boundary) appearing in the ANSWER text. Pass 2: strip the
 *  QUESTION's crust and try the remainder as one normalized term. Returns a
 *  term string or null. Self-contained on purpose: its source is injected
 *  into the rendered page verbatim, so it must close over nothing. */
export function resolveAnsweredTerm(answerText, questionText, terms, normFn) {
  const hay = " " + String(answerText || "").toLowerCase() + " ";
  let best = null;
  for (const t of terms || []) {
    const label = String((t && t.term) || "").toLowerCase();
    if (label.length < 3) continue;
    const a = hay.indexOf(" " + label);
    const b = hay.indexOf(label + " ");
    const idx = a !== -1 ? a : b;
    if (idx === -1) continue;
    if (!best || idx < best.idx) best = { term: t.term, idx };
  }
  if (best) return best.term;
  const stripped = String(questionText || "").toLowerCase()
    .replace(/^(what|where|who|which|does|do|is|are)\b/, "")
    .replace(/\b(is|are|used for|do|does|mean|means|a|an|the)\b/g, " ")
    .replace(/[?.!]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped || typeof normFn !== "function") return null;
  const norm = normFn(stripped);
  return (terms || []).some((t) => t && t.term === norm) ? norm : null;
}

/** One complete, self-contained document: the ledger, segment rail,
 *  worth-a-look panel, breadcrumb/search, two-hop minimap, and (when the
 *  memory-ask bundle is present) the ask-the-graph chat dock, all over the
 *  embedded LEDGER/PAYLOAD data. */
export function renderLedgerHtml({ rows, terms, edges, focus, contradictions, worthALook, payload, meta, memoryAskBundle } = {}) {
  const ledgerJson = embedJson({ rows: rows || [], terms: terms || [], edges: edges || [], focus: focus || null, contradictions: contradictions || [], worthALook: worthALook || null, meta: meta || { shown: 0, total: 0, truncated: false } });
  const payloadJson = embedJson(payload || { individuals: [], objectProperties: [] });
  const shown = meta?.shown ?? (rows || []).length;
  const title = `tmct ledger — ${shown} fact${shown === 1 ? "" : "s"}${focus ? ` (focus: ${escapeHtml(focus)})` : ""}`;
  const bundleStr = typeof memoryAskBundle === "string" ? memoryAskBundle : "";
  const hasMemChat = bundleStr.length > 0;
  // The placeholder is honest: the canonical exchange only when its terms are
  // really in this payload, otherwise a real term from this graph.
  const termSet = new Set((terms || []).map((t) => t.term));
  const placeholder = termSet.has("ishmael")
    ? "who is the grandfather of ishmael"
    : (terms && terms.length ? `ask the graph… e.g. what is ${terms[0].term}` : "ask the graph…");
  const dockHtml = hasMemChat
    ? `<div class="chat">
        <div class="chatlog" id="chatlog" aria-live="polite"></div>
        <form class="chatask" id="chatform">
          <span class="prompt mono">tmct&gt;</span>
          <input id="chatq" type="text" placeholder="${escapeHtml(placeholder)}" aria-label="Ask the graph">
        </form>
      </div>`
    : `<div class="chat chat-off"><p class="chatnote">chat unavailable — run <span class="mono">npm run build:ask-bundle</span> to enable the in-page ask engine.</p></div>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${THEME_TOKENS_CSS}
  html { background: var(--bg); }
  body { margin: 0; background: var(--bg); color: var(--ink); font-family: ${SERIF_STACK}; font-size: 16px; line-height: 1.5; }
  .mono { font-family: ${MONO_STACK}; }
  main { max-width: 1080px; margin: 0 auto; padding: 1.4rem 1.2rem 3rem; }
  .eyebrow { font-family: ${MONO_STACK}; font-size: .7rem; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); display: flex; flex-wrap: wrap; gap: .4em 1.2em; }
  h1 { font-size: 1.4rem; margin: .3rem 0 .9rem; text-wrap: balance; }
  button { font: inherit; color: inherit; background: none; border: none; padding: 0; cursor: pointer; }
  button:focus-visible, input:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; border-radius: 4px; }
  .topbar { display: flex; flex-wrap: wrap; align-items: center; gap: .8rem; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: .5rem 0; margin-bottom: 1.1rem; }
  .crumbs { display: flex; align-items: center; flex-wrap: wrap; gap: .35rem; font-size: .78rem; }
  .crumbs .sep { color: var(--muted); }
  .crumb { font-family: ${MONO_STACK}; font-size: .74rem; padding: .12rem .5rem; border: 1px solid var(--line); border-radius: 99px; background: var(--card); }
  .crumb[aria-current="true"] { background: var(--ink); color: var(--bg); border-color: var(--ink); }
  .search { margin-left: auto; display: flex; align-items: center; gap: .5rem; }
  .search input { font-family: ${MONO_STACK}; font-size: .78rem; background: var(--card); color: var(--ink); border: 1px solid var(--line); border-radius: 6px; padding: .3rem .6rem; width: 170px; }
  .search .miss { font-size: .72rem; color: var(--alert); font-family: ${MONO_STACK}; }
  .app { display: grid; grid-template-columns: 190px minmax(0,1fr) 230px; gap: 1.3rem; grid-template-areas: "rail ledger aside"; }
  .rail { grid-area: rail; } .ledger { grid-area: ledger; } .aside { grid-area: aside; }
  @media (max-width: 880px) { .app { grid-template-columns: 1fr; grid-template-areas: "ledger" "aside" "rail"; } .search { margin-left: 0; } }
  .rail h2, .aside h2 { font-family: ${MONO_STACK}; font-size: .66rem; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 400; margin: 1rem 0 .4rem; }
  .rail h2:first-child { margin-top: 0; }
  .segs { display: flex; flex-direction: column; gap: .28rem; }
  .seg { display: flex; align-items: center; gap: .45rem; font-family: ${MONO_STACK}; font-size: .73rem; padding: .2rem .55rem; border: 1px solid var(--line); border-radius: 99px; background: var(--card); text-align: left; }
  .seg .n { margin-left: auto; color: var(--muted); font-variant-numeric: tabular-nums; }
  .seg .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
  .seg.off { opacity: .35; }
  .seg.on { border-color: transparent; color: #fff; }
  .seg.on .n { color: #fff; opacity: .85; }
  .seg.on.neutral { background: var(--ink); color: var(--bg); } .seg.on.neutral .n { color: var(--bg); }
  .seg.on.c-taught { background: var(--taught); } .seg.on.c-corpus { background: var(--corpus); } .seg.on.c-entail { background: var(--entail); }
  .d-taught { background: var(--taught); } .d-corpus { background: var(--corpus); } .d-entail { background: var(--entail); }
  .focuscard { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: .8rem 1rem; margin-bottom: 1rem; }
  .focuscard .term { font-size: 1.35rem; font-weight: 700; }
  .focuscard .klass, .focuscard .stats { font-family: ${MONO_STACK}; font-size: .72rem; color: var(--muted); margin-top: .3rem; font-variant-numeric: tabular-nums; }
  .group { margin: 1.1rem 0; }
  .group h3 { font-family: ${MONO_STACK}; font-size: .68rem; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); font-weight: 400; margin: 0 0 .35rem; display: flex; align-items: baseline; gap: .5rem; }
  .group h3::after { content: ""; flex: 1; border-top: 1px solid var(--line); transform: translateY(-.2em); }
  .rows { display: flex; flex-direction: column; gap: .35rem; }
  .row { background: var(--card); border: 1px solid var(--line); border-left: 3px solid var(--line); border-radius: 0 8px 8px 0; padding: .45rem .75rem; display: flex; flex-wrap: wrap; align-items: baseline; gap: .3rem .5rem; font-size: .95rem; }
  .row.p-taught.t3 { border-left-color: var(--taught-t3); } .row.p-taught.t2 { border-left-color: var(--taught-t2); } .row.p-taught.t1 { border-left-color: var(--taught-t1); }
  .row.p-corpus.t3 { border-left-color: var(--corpus-t3); } .row.p-corpus.t2 { border-left-color: var(--corpus-t2); } .row.p-corpus.t1 { border-left-color: var(--corpus-t1); }
  .row.p-entail.t3 { border-left-color: var(--entail-t3); } .row.p-entail.t2 { border-left-color: var(--entail-t2); } .row.p-entail.t1 { border-left-color: var(--entail-t1); }
  .chip { font-family: ${MONO_STACK}; font-size: .76rem; padding: .05rem .45rem; border: 1px solid var(--line); border-radius: 99px; background: var(--bg); }
  button.chip:hover { border-color: var(--ink); }
  .chip.here { background: var(--ink); color: var(--bg); border-color: var(--ink); }
  .prov { margin-left: auto; font-family: ${MONO_STACK}; font-size: .64rem; padding: .08rem .5rem; border-radius: 99px; white-space: nowrap; }
  .prov.p-taught { color: var(--taught); background: var(--taught-soft); }
  .prov.p-corpus { color: var(--corpus); background: var(--corpus-soft); }
  .prov.p-entail { color: var(--entail); background: var(--entail-soft); }
  .contra { border: 1px solid var(--alert); border-radius: 10px; padding: .5rem; margin-top: .35rem; }
  .contra .label { font-family: ${MONO_STACK}; font-size: .66rem; color: var(--alert); margin: 0 0 .35rem .2rem; }
  .empty { color: var(--muted); font-size: .9rem; border: 1px dashed var(--line); border-radius: 8px; padding: .8rem 1rem; }
  .looks { display: flex; flex-direction: column; gap: .45rem; }
  .look { display: block; text-align: left; background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: .5rem .65rem; font-size: .8rem; width: 100%; }
  .look:hover { border-color: var(--ink); }
  .look .tag { display: block; font-family: ${MONO_STACK}; font-size: .62rem; letter-spacing: .06em; text-transform: uppercase; margin-bottom: .18rem; }
  .look.k-taught .tag { color: var(--taught); } .look.k-alert .tag { color: var(--alert); } .look.k-hub .tag { color: var(--corpus); }
  .mapwrap { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: .45rem; margin-top: .45rem; }
  .mapwrap canvas { display: block; width: 100%; height: 160px; cursor: pointer; }
  .mapnote { font-family: ${MONO_STACK}; font-size: .62rem; color: var(--muted); margin: .3rem .2rem 0; }
  .chat { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: .65rem .85rem; margin-bottom: 1rem; }
  .chatlog { display: flex; flex-direction: column; gap: .45rem; max-height: 220px; overflow-y: auto; }
  .chatlog:empty { display: none; }
  .chatlog .u { font-family: ${MONO_STACK}; font-size: .76rem; color: var(--muted); }
  .chatlog .u::before { content: "tmct> "; color: var(--taught); }
  .chatlog .a { font-size: .9rem; line-height: 1.45; }
  .chatlog .a.miss { color: var(--muted); }
  .chatask { display: flex; align-items: center; gap: .5rem; }
  .chatlog:not(:empty) + .chatask { border-top: 1px solid var(--line); margin-top: .55rem; padding-top: .55rem; }
  .chatask .prompt { color: var(--taught); font-size: .78rem; }
  .chatask input { flex: 1; font-family: ${MONO_STACK}; font-size: .78rem; background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 6px; padding: .32rem .6rem; min-width: 0; }
  .chatnote { font-family: ${MONO_STACK}; font-size: .72rem; color: var(--muted); margin: 0; }
  @media (prefers-reduced-motion: no-preference) { .seg, .chip, .look { transition: border-color .12s ease, background-color .12s ease; } }
</style>
</head>
<body>
<main>
  <div class="eyebrow"><span>tmct &middot; memory ledger</span><span id="counts"></span></div>
  <h1>A graph you can read</h1>
  <div class="topbar">
    <nav class="crumbs" id="crumbs" aria-label="Focus trail"></nav>
    <div class="search">
      <input id="q" type="text" placeholder="go to term&hellip; (enter)" aria-label="Go to term">
      <span class="miss" id="qmiss" aria-live="polite"></span>
    </div>
  </div>
  <div class="app">
    <aside class="rail" aria-label="Segments">
      <h2>who says so</h2><div class="segs" id="segProv"></div>
      <h2>kind of fact</h2><div class="segs" id="segFam"></div>
      <h2>when learned</h2><div class="segs" id="segRec"></div>
    </aside>
    <section class="ledger">
      ${dockHtml}
      <div id="ledger" aria-live="polite"></div>
    </section>
    <aside class="aside" aria-label="Highlights and minimap">
      <h2>worth a look</h2><div class="looks" id="looks"></div>
      <h2>two hops out</h2>
      <div class="mapwrap">
        <canvas id="map" width="230" height="160" aria-label="Two-hop neighborhood minimap"></canvas>
        <p class="mapnote">dots = terms &middot; click to refocus &middot; dim = filtered out</p>
      </div>
    </aside>
  </div>
</main>
<script>
const LEDGER = ${ledgerJson};
const PAYLOAD = ${payloadJson};
</script>
${hasMemChat ? `<script>\n${bundleStr}\n</script>` : ""}
<script>
(function () {
  "use strict";
  const DAY = 86400000;
  const el = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const FAMS = ["is-a", "has", "can", "used-for", "rests-on", "role", "other"];
  const FAM_LABEL = { "is-a": "is a kind of", has: "has", can: "can", "used-for": "used for", "rests-on": "rests on", role: "role / property", other: "other" };
  const PROVS = [["taught", "you taught"], ["corpus", "corpus"], ["entail", "entailed"]];
  const RECS = ["today", "this week", "older"];
  const provKey = (p) => (p === "entailed" ? "entail" : p); // css class key
  const termIndex = new Map(LEDGER.terms.map((t) => [t.term, t]));
  const rowById = new Map(LEDGER.rows.map((r) => [r.id, r]));
  const contraById = new Map();
  LEDGER.contradictions.forEach((ids, gi) => ids.forEach((id) => contraById.set(id, gi)));

  let focus = LEDGER.focus;
  let trail = focus ? [{ term: focus, label: null }] : [];
  const sel = { prov: new Set(), fam: new Set(), rec: new Set() };

  const recOf = (r) => {
    const t = Date.parse(r.createdAt);
    if (!Number.isFinite(t)) return "older";
    const age = Date.now() - t;
    return age < DAY ? "today" : age < 7 * DAY ? "this week" : "older";
  };
  const touches = (r, term) => r.s === term || r.o === term;
  function passes(r, skip) {
    if (skip !== "prov" && sel.prov.size && !sel.prov.has(r.prov)) return false;
    if (skip !== "fam" && sel.fam.size && !sel.fam.has(r.family)) return false;
    if (skip !== "rec" && sel.rec.size && !sel.rec.has(recOf(r))) return false;
    return true;
  }

  function segButton(group, value, label, count, cls) {
    const b = document.createElement("button");
    const on = sel[group].has(value);
    b.className = "seg" + (on ? " on " + (cls || "neutral") : "") + (count === 0 ? " off" : "");
    b.setAttribute("aria-pressed", String(on));
    if (cls && !on) { const d = document.createElement("span"); d.className = "dot " + cls.replace("c-", "d-"); b.appendChild(d); }
    const lab = document.createElement("span"); lab.textContent = label; b.appendChild(lab);
    const n = document.createElement("span"); n.className = "n"; n.textContent = String(count); b.appendChild(n);
    b.addEventListener("click", () => { if (on) sel[group].delete(value); else sel[group].add(value); render(); });
    return b;
  }
  function renderSegs() {
    const mine = LEDGER.rows.filter((r) => focus && touches(r, focus));
    const put = (id, group, values, labelOf, clsOf) => {
      const box = el(id); box.innerHTML = "";
      for (const v of values) {
        const count = mine.filter((r) => passes(r, group) &&
          (group === "prov" ? r.prov === v : group === "fam" ? r.family === v : recOf(r) === v)).length;
        box.appendChild(segButton(group, v, labelOf(v), count, clsOf ? clsOf(v) : null));
      }
    };
    put("segProv", "prov", PROVS.map((p) => p[0]), (v) => PROVS.find((p) => p[0] === v)[1], (v) => "c-" + provKey(v));
    put("segFam", "fam", FAMS, (v) => FAM_LABEL[v], null);
    put("segRec", "rec", RECS, (v) => v, null);
  }

  const chipHtml = (term) => term === focus
    ? '<span class="chip here">' + esc(term) + "</span>"
    : '<button class="chip" data-go="' + esc(term) + '">' + esc(term) + "</button>";
  function rowHtml(r) {
    const cls = "row p-" + provKey(r.prov) + " t" + r.trustTier;
    const date = r.createdAt ? " &middot; " + esc(String(r.createdAt).slice(0, 10)) : "";
    return '<div class="' + cls + '">' + chipHtml(r.s) + " <span>" + esc(r.phrase) + "</span> " + chipHtml(r.o) +
      '<span class="prov p-' + provKey(r.prov) + '">' + esc(r.src) + date + "</span></div>";
  }
  function renderLedger() {
    const box = el("ledger");
    if (!focus) { box.innerHTML = '<div class="empty">Nothing in memory yet. Teach a fact in chat, then re-run tmct viz --ledger.</div>'; return; }
    const all = LEDGER.rows.filter((r) => touches(r, focus));
    const mine = all.filter((r) => passes(r, null));
    const srcs = new Set(all.map((r) => r.src.split(" | ")[0]));
    const dates = all.map((r) => r.createdAt).filter(Boolean).sort();
    const klass = all.find((r) => r.s === focus && r.family === "is-a");
    let html = '<div class="focuscard"><div class="term">' + esc(focus) + "</div>" +
      '<div class="klass">' + (klass ? esc(klass.phrase + " " + klass.o) : "no class recorded") + "</div>" +
      '<div class="stats">' + all.length + " facts &middot; " + srcs.size + " source" + (srcs.size === 1 ? "" : "s") +
      (dates.length ? " &middot; first " + esc(dates[0].slice(0, 10)) + " &middot; last " + esc(dates[dates.length - 1].slice(0, 10)) : "") + "</div></div>";
    const bracketed = new Set();
    for (const fam of FAMS) {
      const rows = mine.filter((r) => r.family === fam && !bracketed.has(r.id));
      if (!rows.length) continue;
      let inner = "";
      const groupsHere = new Map();
      for (const r of rows) {
        const gi = contraById.get(r.id);
        if (gi !== undefined) { if (!groupsHere.has(gi)) groupsHere.set(gi, []); groupsHere.get(gi).push(r); }
      }
      const inBracket = new Set();
      for (const [, grp] of groupsHere) if (grp.length > 1) grp.forEach((r) => inBracket.add(r.id));
      inner += rows.filter((r) => !inBracket.has(r.id)).map(rowHtml).join("");
      for (const [, grp] of groupsHere) {
        if (grp.length < 2) continue;
        grp.forEach((r) => bracketed.add(r.id));
        inner += '<div class="contra"><p class="label">more than one answer on record &mdash; shown, never merged</p><div class="rows">' + grp.map(rowHtml).join("") + "</div></div>";
      }
      html += '<div class="group"><h3>' + esc(FAM_LABEL[fam]) + '</h3><div class="rows">' + inner + "</div></div>";
    }
    if (!mine.length) html += '<div class="empty">No facts about <span class="mono">' + esc(focus) + "</span> match the current segments. Clear a segment on the left, or refocus from the minimap.</div>";
    box.innerHTML = html;
    box.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => refocus(b.getAttribute("data-go"))));
  }

  function renderLooks() {
    const box = el("looks"); box.innerHTML = "";
    const w = LEDGER.worthALook || {};
    const looks = [];
    if (w.newestTaught) {
      const r = rowById.get(w.newestTaught.rowId);
      looks.push({ cls: "k-taught", tag: "newest teach", target: w.newestTaught.term, body: r ? esc(r.s + " " + r.phrase + " " + r.o) : esc(w.newestTaught.term) });
    }
    if (w.contradictions && w.contradictions.count) {
      looks.push({ cls: "k-alert", tag: w.contradictions.count + " with more than one answer", target: w.contradictions.firstFocusTerm, body: '<span class="mono">' + esc(w.contradictions.firstFocusTerm) + "</span> has answers that differ &mdash; read both" });
    }
    if (w.biggestHub) {
      looks.push({ cls: "k-hub", tag: "biggest hub", target: w.biggestHub.term, body: '<span class="mono">' + esc(w.biggestHub.term) + "</span> touches " + w.biggestHub.degree + " facts" });
    }
    for (const l of looks) {
      const b = document.createElement("button");
      b.className = "look " + l.cls;
      b.innerHTML = '<span class="tag">' + esc(l.tag) + '</span><span class="body">' + l.body + "</span>";
      if (l.target) b.addEventListener("click", () => refocus(l.target));
      box.appendChild(b);
    }
    if (!looks.length) box.innerHTML = '<div class="empty">Nothing to flag yet.</div>';
  }

  let hits = [];
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function renderMap() {
    const canvas = el("map");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 230, h = 160;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, w, h);
    hits = [];
    if (!focus) return;
    const color = { taught: cssVar("--taught"), corpus: cssVar("--corpus"), entailed: cssVar("--entail"), entail: cssVar("--entail") };
    const lineC = cssVar("--line"), inkC = cssVar("--ink");
    const hop1 = new Set(), hop2 = new Set();
    for (const e of LEDGER.edges) { if (e.s === focus) hop1.add(e.o); if (e.o === focus) hop1.add(e.s); }
    hop1.delete(focus);
    for (const e of LEDGER.edges) {
      if (hop1.has(e.s) && e.o !== focus && !hop1.has(e.o)) hop2.add(e.o);
      if (hop1.has(e.o) && e.s !== focus && !hop1.has(e.s)) hop2.add(e.s);
    }
    const cx = w / 2, cy = h / 2, r1 = 42, r2 = 68;
    const pos = { [focus]: { x: cx, y: cy } };
    const place = (set, r) => { const a = [...set].sort(); a.forEach((t, i) => { const ang = (2 * Math.PI * i) / a.length - Math.PI / 2; pos[t] = { x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) }; }); };
    place(hop1, r1); place(hop2, r2);
    ctx.strokeStyle = lineC; ctx.lineWidth = 1;
    for (const e of LEDGER.edges) { const a = pos[e.s], b = pos[e.o]; if (a && b) { ctx.globalAlpha = .5; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); } }
    ctx.globalAlpha = 1;
    const visible = (t) => t === focus || hop2.has(t) ||
      LEDGER.rows.some((r) => (r.s === t || r.o === t) && touches(r, focus) && passes(r, null));
    for (const t of Object.keys(pos)) {
      const p = pos[t], isF = t === focus, r = isF ? 6 : 4;
      ctx.globalAlpha = visible(t) ? 1 : .25;
      ctx.fillStyle = isF ? inkC : (color[(termIndex.get(t) || {}).prov] || inkC);
      ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, 2 * Math.PI); ctx.fill();
      hits.push({ x: p.x, y: p.y, r: r + 5, term: t });
    }
    ctx.globalAlpha = 1; ctx.fillStyle = inkC;
    ctx.font = "9px ui-monospace, Menlo, monospace";
    ctx.textAlign = "center";
    ctx.fillText(focus, cx, cy - 10);
  }
  el("map").addEventListener("click", (e) => {
    const rect = e.target.getBoundingClientRect();
    const x = e.clientX - rect.left, y = e.clientY - rect.top;
    for (const hit of hits) if ((x - hit.x) ** 2 + (y - hit.y) ** 2 <= hit.r ** 2) { refocus(hit.term); return; }
  });

  function renderCrumbs() {
    const box = el("crumbs"); box.innerHTML = "";
    trail.forEach((c, i) => {
      if (i) { const s = document.createElement("span"); s.className = "sep"; s.textContent = "\\u203a"; box.appendChild(s); }
      const b = document.createElement("button");
      b.className = "crumb"; b.textContent = c.label || c.term;
      b.title = c.term;
      if (i === trail.length - 1) b.setAttribute("aria-current", "true");
      b.addEventListener("click", () => { trail = trail.slice(0, i + 1); focus = c.term; render(); });
      box.appendChild(b);
    });
  }
  function refocusWithLabel(term, label) {
    if (!term || !termIndex.has(term)) return;
    if (term !== focus) { focus = term; trail.push({ term, label: label || null }); }
    render();
  }
  function refocus(term) { refocusWithLabel(term, null); }
  el("q").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const want = e.target.value.trim().toLowerCase();
    const hit = [...termIndex.keys()].find((t) => t.toLowerCase() === want);
    if (hit) { el("qmiss").textContent = ""; e.target.value = ""; refocus(hit); }
    else el("qmiss").textContent = "no such term";
  });

  // ---- the chat dock: the SAME engine + payload the CLI answers from ------
  const resolveAnsweredTerm = ${resolveAnsweredTerm.toString()};
  const chatForm = el("chatform");
  if (chatForm && typeof tmctMemoryAsk !== "undefined") {
    const memHandle = tmctMemoryAsk.createInMemoryStore();
    memHandle.payload = PAYLOAD;
    const log = el("chatlog");
    const addLine = (cls, html) => {
      const d = document.createElement("div");
      d.className = cls; d.innerHTML = html;
      log.appendChild(d); log.scrollTop = log.scrollHeight;
    };
    chatForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const input = el("chatq");
      const q = input.value.trim();
      if (!q) return;
      input.value = "";
      addLine("u", esc(q));
      (async () => {
        let fact = null;
        try { fact = await tmctMemoryAsk.factAnswer(memHandle, q, null, true, {}); } catch { fact = null; }
        // runAsk's own cascade is factAnswer ?? factReadBack; chain the same
        // way when the bundle exposes the second reader (relation chases —
        // "who is the grandfather of ishmael" — live there, not in factAnswer).
        if (!(fact && fact.text) && typeof tmctMemoryAsk.factReadBack === "function") {
          try { fact = await tmctMemoryAsk.factReadBack(memHandle, q, null, true, null); } catch { fact = null; }
        }
        if (fact && fact.text) {
          addLine("a", esc(fact.text).replace(/\\n/g, "<br>"));
          const hit = resolveAnsweredTerm(fact.text, q, LEDGER.terms, tmctMemoryAsk.normFactTerm);
          if (hit) refocusWithLabel(hit, q);
        } else {
          const tips = LEDGER.terms.filter((t) => t.term.length >= 3).slice(0, 2)
            .map((t) => '"what is ' + esc(t.term) + '"').join(" \\u00b7 ");
          addLine("a miss", "I can't ground that in this graph" + (tips ? " \\u2014 try: " + tips : "") + ".");
        }
      })();
    });
  }

  function renderCounts() {
    const m = LEDGER.meta;
    el("counts").textContent = m.truncated ? "showing " + m.shown + " of " + m.total + " facts" : m.shown + " facts";
  }
  function render() { renderCounts(); renderCrumbs(); renderSegs(); renderLedger(); renderLooks(); renderMap(); }
  window.addEventListener("resize", renderMap);
  new MutationObserver(renderMap).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderMap);
  render();
})();
</script>
</body>
</html>
`;
}
