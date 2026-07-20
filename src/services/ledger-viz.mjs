// ledger-viz.mjs — `tmct viz`: the memory graph as a readable ledger of
// fact-sentences around one focus term, with the in-page chat dock.
//
// "ledger" is a UI label for this VIEW, not a storage claim. The memory graph
// underneath is mutable — upsert rewrites a fact in place and removeFacts
// deletes — so this renders a report over the current graph, not an
// append-only or immutable log (the ISO 22739 sense of the word does not hold).
//
// Three pure/impure-separated pieces:
//   - computeLedgerData(repoDir, opts)      — I/O (loadMemory) + derivation
//   - computeLedgerDataFromPayload(payload) — the pure derivation half
//   - renderLedgerHtml(data)                — pure string builder, one
//     self-contained document, no external requests.
// readMemoryAskBundle() is the one extra bit of I/O renderLedgerHtml itself
// doesn't do: it reads the checked-in chat-dock engine bundle.

import { loadMemory, readFactRows, findContradictions, normFactTerm } from "../adapters/memory/core.mjs";
import { THEME_TOKENS_CSS, SERIF_STACK, MONO_STACK, escapeHtml, embedJson } from "./viz-theme.mjs";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const LEDGER_ROW_LIMIT_DEFAULT = 20000;

/** Read the checked-in browser memory-ask-engine bundle
 *  (`src/surfaces/web/memory-ask-browser.bundle.js`) — the real memory-graph answer engine
 *  (chat.mjs's factAnswer/factReadBack) the chat dock runs on. Returns `""`,
 *  never throws, if the bundle hasn't been built — the page then renders with
 *  an honest "chat unavailable" note instead of a dock. */
export async function readMemoryAskBundle() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    return await readFile(join(here, "..", "surfaces", "web", "memory-ask-browser.bundle.js"), "utf8");
  } catch {
    return "";
  }
}

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
  // phantom term.
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
  // Dashboard-strip stats: always over the FULL rows/terms/contradictions —
  // computed here, before the row-cap section below, so a huge graph's
  // tile numbers stay the whole-graph truth even when the ledger view itself
  // degrades to "recent + local".
  const stats = computeLedgerStats(rows, terms, contradictions);

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

  return { rows: shownRows, terms, edges, focus: focusTerm, contradictions, worthALook, payload, meta, stats };
}

/** Load the memory graph under `repoDir` and derive the ledger data. Never
 *  throws on a missing/empty memory dir. */
export async function computeLedgerData(repoDir, opts = {}) {
  const payload = await loadMemory(repoDir);
  return computeLedgerDataFromPayload(payload, opts);
}

/** The chat dock's answer-to-focus resolver. Pass 1: earliest term label (≥3
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

/** Per-segment facet counts for the rows touching `focus`: each group's count
 *  is computed against the OTHER groups' active filters (its own group's
 *  selection is skipped), so a selected family narrows the provenance and
 *  recency counts but never its own rail. `sel` holds the active multi-select
 *  Sets ({prov, fam, rec}); `now` anchors the recency buckets. Self-contained
 *  on purpose: its source is injected into the rendered page verbatim, so it
 *  must close over nothing. */
export function facetCounts(rows, focus, sel, now) {
  const DAY = 86400000;
  const recencyOf = (r) => {
    const t = Date.parse(r.createdAt);
    if (!Number.isFinite(t)) return "older";
    const age = now - t;
    return age < DAY ? "today" : age < 7 * DAY ? "this week" : "older";
  };
  const passes = (r, skip) =>
    (skip === "prov" || !sel.prov.size || sel.prov.has(r.prov)) &&
    (skip === "fam" || !sel.fam.size || sel.fam.has(r.family)) &&
    (skip === "rec" || !sel.rec.size || sel.rec.has(recencyOf(r)));
  const counts = { prov: {}, fam: {}, rec: {} };
  for (const r of rows || []) {
    if (!focus || (r.s !== focus && r.o !== focus)) continue;
    if (passes(r, "prov")) counts.prov[r.prov] = (counts.prov[r.prov] || 0) + 1;
    if (passes(r, "fam")) counts.fam[r.family] = (counts.fam[r.family] || 0) + 1;
    if (passes(r, "rec")) {
      const k = recencyOf(r);
      counts.rec[k] = (counts.rec[k] || 0) + 1;
    }
  }
  return counts;
}

// ---- dashboard-strip stats: real counts over the FULL fact-row set --------
// (never the row-capped view — meta.total's own honesty contract) for the
// telemetry-style tiles atop the existing 3-column layout.

const BUNDLE_TOP_N = 6;
const PREDICATE_TOP_N = 6;
const SPARK_MAX_POINTS = 48;

/** Corpus-bundle grouping key for one fact's `src` string: the first
 *  pipe-segment, folded to its stable source-family prefix
 *  ("teach:chat:<session>@<ts>" -> "teach:chat", "corpus:human /r/IsA" ->
 *  "corpus:human", "import:hanoi-3.txt" stays whole — the filename IS the
 *  bundle). A closed table with a verbatim fallback, same posture as
 *  phraseFor: an unrecognized tag still reads as itself. */
export function bundleKeyFor(src) {
  const first = String(src || "").split(" | ")[0].trim();
  if (!first) return "unrecorded";
  if (first.startsWith("teach:chat")) return "teach:chat";
  if (first.startsWith("ace:chat")) return "ace:chat";
  if (first === "operator" || first.startsWith("operator:")) return "operator";
  if (first.startsWith("entailed")) {
    const rule = first.slice("entailed".length).replace(/^[:\s]+/, "").split(/[\s:]/)[0];
    return rule ? `entailed:${rule}` : "entailed";
  }
  if (first.startsWith("corpus:")) {
    const name = first.slice("corpus:".length).split(" ")[0];
    return name ? `corpus:${name}` : "corpus";
  }
  return first; // import:<file>, provider/reference/web sourceTypes, etc — verbatim
}

/** Human label for a bundleKeyFor() key. */
export function bundleLabelFor(key) {
  const k = String(key || "");
  if (k === "teach:chat") return "taught via chat";
  if (k === "ace:chat") return "taught (parsed)";
  if (k === "operator") return "operator-asserted";
  if (k === "unrecorded") return "unrecorded";
  if (k.startsWith("corpus:")) return `corpus: ${k.slice(7)}`;
  if (k.startsWith("import:")) return `imported: ${k.slice(7)}`;
  if (k.startsWith("entailed:")) return `entailed: ${k.slice(9)}`;
  if (k === "entailed") return "entailed";
  return k;
}

/** Dashboard-strip stats over `rows` (the FULL set — pass it before any
 *  row-cap slicing) and `terms`/`contradictions` from the same derivation.
 *  Every number is a straight count or ratio over real rows; nothing here is
 *  estimated or placeholder. The ingestion sparkline plots cumulative fact
 *  count in TEACH order (oldest first), not wall-clock time — a store built
 *  in one script run has timestamps seconds apart, so order carries the
 *  signal the clock can't. */
export function computeLedgerStats(rows, terms, contradictions) {
  const list = rows || [];
  const byProv = { taught: 0, corpus: 0, entailed: 0 };
  const byTier = { 1: 0, 2: 0, 3: 0 };
  const bundleCounts = new Map();
  const predicateCounts = new Map(); // predicate -> { phrase, count }
  for (const r of list) {
    byProv[r.prov] = (byProv[r.prov] || 0) + 1;
    byTier[r.trustTier] = (byTier[r.trustTier] || 0) + 1;
    const bk = bundleKeyFor(r.src);
    bundleCounts.set(bk, (bundleCounts.get(bk) || 0) + 1);
    const pc = predicateCounts.get(r.p) || { phrase: r.phrase, count: 0 };
    pc.count += 1;
    predicateCounts.set(r.p, pc);
  }
  const bundles = [...bundleCounts.entries()]
    .map(([key, count]) => ({ key, label: bundleLabelFor(key), count }))
    .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
    .slice(0, BUNDLE_TOP_N);
  const predicates = [...predicateCounts.entries()]
    .map(([predicate, v]) => ({ predicate, phrase: v.phrase, count: v.count }))
    .sort((a, b) => b.count - a.count || a.predicate.localeCompare(b.predicate))
    .slice(0, PREDICATE_TOP_N);

  const totalDegree = (terms || []).reduce((sum, t) => sum + (t.degree || 0), 0);
  const density = terms && terms.length ? totalDegree / terms.length : 0;

  // Cumulative fact count in teach order, sampled to SPARK_MAX_POINTS for a
  // large graph — every plotted value is a real cumulative count at a real
  // index, never interpolated.
  const ordered = list.filter((r) => r.createdAt).slice().reverse(); // rows sort newest-first
  const n = ordered.length;
  const sparkline = [];
  if (n > 0) {
    const stride = Math.max(1, Math.ceil(n / SPARK_MAX_POINTS));
    for (let i = stride - 1; i < n; i += stride) sparkline.push(i + 1);
    if (sparkline[sparkline.length - 1] !== n) sparkline.push(n);
  }

  return {
    totalFacts: list.length,
    totalTerms: (terms || []).length,
    byProv, byTier, bundles, predicates, density,
    contradictionCount: (contradictions || []).length,
    firstLearned: n ? ordered[0].createdAt : null,
    lastLearned: n ? ordered[n - 1].createdAt : null,
    sparkline,
  };
}

const pct = (n, total) => (total > 0 ? (n / total) * 100 : 0);

/** The facts.by-tier tile: a proportional bar plus a counts legend, both over
 *  the SAME three taught/corpus/entailed tokens the rest of the page already
 *  colors provenance with. Server-rendered once; the tier split doesn't
 *  change with the interactive segment filters below it. */
function tierTileHtml(byProv, total) {
  const segs = [["taught", byProv.taught || 0], ["corpus", byProv.corpus || 0], ["entail", byProv.entailed || 0]];
  const bar = segs.map(([cls, n]) => `<span class="tseg t-${cls}" style="width:${pct(n, total).toFixed(2)}%"></span>`).join("");
  const legend = segs.map(([cls, n]) => `<span class="tleg t-${cls}">${n} ${cls === "entail" ? "entailed" : cls}</span>`).join("");
  return `<div class="tierbar" role="img" aria-label="${segs.map(([c, n]) => `${n} ${c === "entail" ? "entailed" : c}`).join(", ")} of ${total} facts">${bar}</div><div class="tierlegend">${legend}</div>`;
}

/** A small leaderboard bar list — bundles or predicates, each scaled to the
 *  list's own max (not the grand total), like a top-N panel on a dashboard. */
function microbarsHtml(items) {
  const max = items.reduce((m, it) => Math.max(m, it.count), 0) || 1;
  return items.map((it) =>
    `<div class="bbar"><span class="bblabel">${escapeHtml(it.label)}</span><span class="bbtrack"><span class="bbfill" style="width:${pct(it.count, max).toFixed(1)}%"></span></span><span class="bbn">${it.count}</span></div>`,
  ).join("");
}

/** The dashboard strip: fact/term totals, the tier bar, graph density, a data-
 *  quality tile keyed off the SAME contradiction count worthALook surfaces,
 *  and the corpus-bundle/predicate leaderboards. Every tile reads straight
 *  off `stats` (computeLedgerStats) — no client-side recomputation.
 *
 *  Also the live dock's own re-render target: `id="dash"` gives a post-teach
 *  refresh a single element to replace (`el("dash").outerHTML = dashboardHtml(...)`
 *  — see renderLedgerHtml's inline script), and `fresh: true` marks that
 *  replacement with a quiet settle-fade (`.dash.fresh`, below) rather than a
 *  silent swap — the SAME function serves the server-rendered initial paint
 *  (fresh omitted) and every live update after it, so the two can never drift. */
function dashboardHtml(stats, { fresh = false } = {}) {
  const s = stats || {};
  const total = s.totalFacts || 0;
  const freshCls = fresh ? " fresh" : "";
  if (!total) {
    return `<section class="dash${freshCls}" id="dash" aria-label="Ledger metrics"><div class="tile"><span class="tile-label">facts.total</span><span class="tile-value">0</span><span class="tile-sub">nothing taught yet</span></div></section>`;
  }
  const terms = s.totalTerms || 0;
  const qualityCls = s.contradictionCount > 0 ? " tile-alert" : "";
  const bundlesHtml = s.bundles?.length ? microbarsHtml(s.bundles) : `<span class="tile-sub">no sources recorded</span>`;
  const predicatesHtml = s.predicates?.length
    ? microbarsHtml(s.predicates.map((p) => ({ label: p.phrase || p.predicate, count: p.count })))
    : `<span class="tile-sub">none yet</span>`;
  return `<section class="dash${freshCls}" id="dash" aria-label="Ledger metrics">
    <div class="tile">
      <span class="tile-label">facts.total</span>
      <span class="tile-value">${total}</span>
      <span class="tile-sub">${terms} term${terms === 1 ? "" : "s"} tracked</span>
    </div>
    <div class="tile tile-wide">
      <span class="tile-label">facts.by-tier</span>
      ${tierTileHtml(s.byProv || {}, total)}
    </div>
    <div class="tile">
      <span class="tile-label">graph.avg-degree</span>
      <span class="tile-value">${(s.density || 0).toFixed(1)}</span>
      <span class="tile-sub">facts per term</span>
    </div>
    <div class="tile${qualityCls}">
      <span class="tile-label">data.quality</span>
      <span class="tile-value">${s.contradictionCount || 0}</span>
      <span class="tile-sub">term${s.contradictionCount === 1 ? "" : "s"} with more than one answer</span>
    </div>
    <div class="tile tile-wide">
      <span class="tile-label">corpus.bundles</span>
      <div class="bundlebars">${bundlesHtml}</div>
    </div>
    <div class="tile tile-wide">
      <span class="tile-label">predicate.top</span>
      <div class="bundlebars">${predicatesHtml}</div>
    </div>
  </section>`;
}

/** The aside's ingestion sparkline: a real cumulative-count polyline over
 *  `stats.sparkline` (see computeLedgerStats), server-rendered as inline SVG
 *  so it needs no client JS and repaints for free on a theme switch via the
 *  CSS custom properties its classes resolve against. */
function sparklineSvg(stats) {
  const pts = stats?.sparkline || [];
  const W = 200, H = 44, PAD = 3;
  if (!pts.length) return `<p class="mapnote">not enough dated facts yet</p>`;
  if (pts.length === 1) {
    return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="1 fact taught"><circle class="dot" cx="${W / 2}" cy="${H / 2}" r="2.5"></circle></svg>`;
  }
  const max = pts[pts.length - 1]; // cumulative and monotonic — last is the max
  const stepX = (W - PAD * 2) / (pts.length - 1);
  const y = (v) => H - PAD - (v / max) * (H - PAD * 2);
  const coords = pts.map((v, i) => [PAD + i * stepX, y(v)]);
  const line = coords.map(([x, yy], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${yy.toFixed(1)}`).join(" ");
  const area = `${line} L${coords[coords.length - 1][0].toFixed(1)},${H} L${coords[0][0].toFixed(1)},${H} Z`;
  const last = coords[coords.length - 1];
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="${pts.length} sampled points, ${max} facts total">
    <path class="fill" d="${area}"></path>
    <path class="line" d="${line}"></path>
    <circle class="dot" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.5"></circle>
  </svg>`;
}

/** The sparkline's own caption — "learned <date>" for a single-day graph,
 *  "first … last …" once it spans more than one, or the generic fallback
 *  before any dated fact exists. Its own named function (not inlined at the
 *  one server call site) so the live dock's post-teach refresh can call the
 *  identical logic client-side — see renderLedgerHtml's `sparkCaptionHtml`
 *  toString-embed, below. */
function sparkCaptionHtml(stats) {
  return stats?.firstLearned && stats?.lastLearned
    ? (stats.firstLearned.slice(0, 10) === stats.lastLearned.slice(0, 10)
        ? `learned ${escapeHtml(stats.lastLearned.slice(0, 10))}`
        : `first ${escapeHtml(stats.firstLearned.slice(0, 10))} &middot; last ${escapeHtml(stats.lastLearned.slice(0, 10))}`)
    : "cumulative facts, teach order";
}

/** One complete, self-contained document: the ledger, segment rail,
 *  worth-a-look panel, breadcrumb/search, two-hop minimap, and (when the
 *  memory-ask bundle is present) the ask-the-graph chat dock, all over the
 *  embedded LEDGER/PAYLOAD data.
 *
 *  `ledgerBundleAvailable` (default false — every existing caller, including
 *  bin/tmct.mjs's `tmct viz` and every test that doesn't pass it) governs
 *  ONE thing: whether an external `<script src="./ledger-browser.bundle.js">`
 *  reference is emitted at all. That bundle carries the full runTurn engine
 *  (teach AND ask) and is Pages-demo-site-only — never built or shipped
 *  alongside the CLI's own output — so the CLI's `renderLedgerHtml` call
 *  never sets this and the page stays exactly as documented above, one
 *  self-contained document with no external requests. Only
 *  scripts/build-demo-site.mjs, which builds the sibling bundle itself
 *  first, passes `true`. The dock's own runtime code below ALSO gates on
 *  `typeof tmctLedger !== "undefined"` regardless — the two checks answer
 *  different questions (did this render even offer the reference; did the
 *  browser actually manage to load it), and both must hold for the live
 *  path to run. */
export function renderLedgerHtml({ rows, terms, edges, focus, contradictions, worthALook, payload, meta, memoryAskBundle, stats, ledgerBundleAvailable = false } = {}) {
  const ledgerJson = embedJson({ rows: rows || [], terms: terms || [], edges: edges || [], focus: focus || null, contradictions: contradictions || [], worthALook: worthALook || null, meta: meta || { shown: 0, total: 0, truncated: false } });
  const payloadJson = embedJson(payload || { individuals: [], objectProperties: [] });
  const shown = meta?.shown ?? (rows || []).length;
  const title = `tmct ledger — ${shown} fact${shown === 1 ? "" : "s"}${focus ? ` (focus: ${escapeHtml(focus)})` : ""}`;
  const bundleStr = typeof memoryAskBundle === "string" ? memoryAskBundle : "";
  const hasMemChat = bundleStr.length > 0;
  // The placeholder is honest: the canonical exchange only when its terms are
  // really in this payload, otherwise a real term from this graph. Left as
  // the query-only wording even when the live bundle is offered — the dock's
  // own script swaps it for a teach-aware placeholder the moment it confirms
  // tmctLedger actually loaded (never claimed ahead of that confirmation).
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
<!--
  Import map: resolves the "wink-nlp"/"wink-eng-lite-web-model" bare specifiers the
  live ask-and-teach dock's own dynamic import() needs (pinned to the exact versions
  package.json depends on) to esm.sh CDN builds — the same seam index.html's own
  import map wires up for the embedded chat, mirrored here because this page can be
  opened standalone (no import map inherited from a host document; this includes the
  self-contained file tmct viz writes to disk — a plain cross-origin dynamic
  import() of a remote https:// URL, not a file:// read, so it works the same way
  offline this page's own try/catch already handles for the deployed site: the
  fetch fails and the wink tier degrades gracefully). Nothing in this file touches
  wink-nlp directly — wink-model.mjs's own header explains why a static import would
  drag the ~1 MB model into every bundle; only the page's own inline script performs
  this CDN import, exactly like public/chat-ui.mjs's own tryLoadWink().
-->
<script type="importmap">
{
  "imports": {
    "wink-nlp": "https://esm.sh/wink-nlp@2.4.0",
    "wink-eng-lite-web-model": "https://esm.sh/wink-eng-lite-web-model@1.8.1"
  }
}
</script>
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
  .dash { display: grid; grid-template-columns: repeat(auto-fill, minmax(148px, 1fr)); gap: .6rem; margin: 0 0 1.1rem; }
  .tile { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: .55rem .7rem .6rem; display: flex; flex-direction: column; gap: .15rem; min-width: 0; }
  .tile-wide { grid-column: span 2; }
  .tile-alert { border-color: var(--alert); }
  .tile-label { font-family: ${MONO_STACK}; font-size: .62rem; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); }
  .tile-value { font-family: ${MONO_STACK}; font-size: 1.5rem; font-weight: 600; font-variant-numeric: tabular-nums; line-height: 1.15; }
  .tile-alert .tile-value { color: var(--alert); }
  .tile-sub { font-family: ${MONO_STACK}; font-size: .68rem; color: var(--muted); }
  .tierbar { display: flex; height: 8px; border-radius: 99px; overflow: hidden; background: var(--line); margin-top: .3rem; }
  .tseg { height: 100%; }
  .tseg.t-taught { background: var(--taught); } .tseg.t-corpus { background: var(--corpus); } .tseg.t-entail { background: var(--entail); }
  .tierlegend { display: flex; flex-wrap: wrap; gap: .15rem .7rem; margin-top: .35rem; font-family: ${MONO_STACK}; font-size: .65rem; }
  .tleg.t-taught { color: var(--taught); } .tleg.t-corpus { color: var(--corpus); } .tleg.t-entail { color: var(--entail); }
  .bundlebars { display: flex; flex-direction: column; gap: .22rem; margin-top: .35rem; }
  .bbar { display: grid; grid-template-columns: minmax(0,1fr) 3.4rem 1.6rem; align-items: center; gap: .4rem; font-family: ${MONO_STACK}; font-size: .68rem; }
  .bblabel { color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bbtrack { background: var(--line); border-radius: 99px; height: 5px; overflow: hidden; }
  .bbfill { display: block; height: 100%; background: var(--ink); opacity: .55; border-radius: 99px; }
  .bbn { color: var(--muted); text-align: right; font-variant-numeric: tabular-nums; }
  .sparkwrap { margin-top: .5rem; }
  .spark { display: block; width: 100%; height: 44px; }
  .spark .fill { fill: var(--muted); opacity: .18; stroke: none; }
  .spark .line { fill: none; stroke: var(--ink); stroke-width: 1.4; }
  .spark .dot { fill: var(--ink); }
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
  .prov { margin-left: auto; font-family: ${MONO_STACK}; font-size: .64rem; padding: .08rem .5rem; border-radius: 99px; max-width: 100%; overflow-wrap: anywhere; }
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
  .chatlog .a.goal { font-family: ${MONO_STACK}; font-size: .72rem; color: var(--muted); }
  .chatlog .a.pending { color: var(--muted); font-style: italic; }
  .chatlog .a.taught { border-left: 2px solid var(--taught); padding-left: .55rem; }
  .chatlog .a.taught .tag { display: block; font-family: ${MONO_STACK}; font-size: .62rem; letter-spacing: .06em; text-transform: uppercase; color: var(--taught); margin-bottom: .18rem; }
  .chatask { display: flex; align-items: center; gap: .5rem; }
  .chatlog:not(:empty) + .chatask { border-top: 1px solid var(--line); margin-top: .55rem; padding-top: .55rem; }
  .chatask .prompt { color: var(--taught); font-size: .78rem; }
  .chatask input { flex: 1; font-family: ${MONO_STACK}; font-size: .78rem; background: var(--bg); color: var(--ink); border: 1px solid var(--line); border-radius: 6px; padding: .32rem .6rem; min-width: 0; }
  .chatask input:disabled { opacity: .6; }
  .chatnote { font-family: ${MONO_STACK}; font-size: .72rem; color: var(--muted); margin: 0; }
  @media (prefers-reduced-motion: no-preference) {
    .seg, .chip, .look { transition: border-color .12s ease, background-color .12s ease; }
    /* A live teach re-render swaps the dash section wholesale (dashboardHtml
       is called again in full — see the inline script below), so the "this
       just changed" signal has to be an animation on the fresh markup itself,
       never a transition (which needs an old and new state on the SAME node
       to interpolate between). Off entirely under reduced motion — the
       numbers still update, just without the settle-fade. */
    .dash.fresh .tile { animation: freshsettle 1.6s ease-out; }
    @keyframes freshsettle { from { background: var(--taught-soft); } to { background: var(--card); } }
  }
</style>
</head>
<body>
<main>
  <div class="eyebrow"><span>tmct &middot; memory ledger</span><span id="counts"></span></div>
  <h1>A graph you can read</h1>
  ${dashboardHtml(stats)}
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
      <h2>ingestion</h2>
      <div class="mapwrap sparkwrap" id="sparkWrap">
        ${sparklineSvg(stats)}
        <p class="mapnote">${sparkCaptionHtml(stats)}</p>
      </div>
    </aside>
  </div>
</main>
<script>
// let, not const: a successful live teach reassigns this wholesale
// (applyLedgerData, in the script below) so the page re-renders the graph
// it actually holds, not the snapshot from the moment the page loaded.
let LEDGER = ${ledgerJson};
const PAYLOAD = ${payloadJson};
</script>
${hasMemChat ? `<script>\n${bundleStr}\n</script>` : ""}
${ledgerBundleAvailable ? `<script src="./ledger-browser.bundle.js"></script>` : ""}
<script>
(function () {
  "use strict";
  const DAY = 86400000;
  const facetCounts = ${facetCounts.toString()};
  const el = (id) => document.getElementById(id);
  const esc = ${escapeHtml.toString()};
  // Aliased so the dashboard/sparkline builders below (toString-embedded
  // verbatim from ledger-viz.mjs's own Node-side source, which calls
  // escapeHtml/pct by their real names) resolve without a second copy.
  const escapeHtml = esc;
  const pct = ${pct.toString()};
  const tierTileHtml = ${tierTileHtml.toString()};
  const microbarsHtml = ${microbarsHtml.toString()};
  const dashboardHtml = ${dashboardHtml.toString()};
  const sparklineSvg = ${sparklineSvg.toString()};
  const sparkCaptionHtml = ${sparkCaptionHtml.toString()};
  const FAMS = ["is-a", "has", "can", "used-for", "rests-on", "role", "other"];
  const FAM_LABEL = { "is-a": "is a kind of", has: "has", can: "can", "used-for": "used for", "rests-on": "rests on", role: "role / property", other: "other" };
  const PROVS = [["taught", "you taught"], ["corpus", "corpus"], ["entail", "entailed"]];
  const RECS = ["today", "this week", "older"];
  const provKey = (p) => (p === "entailed" ? "entail" : p); // css class key

  // LEDGER (declared "let" in the embed script above this one — a classic,
  // non-module script's top-level bindings are reachable as bare identifiers
  // by every later script tag in the document, never as window.LEDGER; see
  // e2e/pages-ledger.test.mjs's own note on this) and its indexes start as
  // the server-rendered snapshot but are REASSIGNED wholesale after a live
  // teach (applyLedgerData, below) — a successful teach through the dock
  // changes the underlying graph, and the page has to show that, not keep
  // rendering the page-load snapshot next to a chat log that merely SAYS
  // something new was learned.
  let termIndex, rowById, contraById;
  function rebuildIndexes() {
    termIndex = new Map(LEDGER.terms.map((t) => [t.term, t]));
    rowById = new Map(LEDGER.rows.map((r) => [r.id, r]));
    contraById = new Map();
    LEDGER.contradictions.forEach((ids, gi) => ids.forEach((id) => contraById.set(id, gi)));
  }
  rebuildIndexes();

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
    const counts = facetCounts(LEDGER.rows, focus, sel, Date.now());
    const put = (id, group, values, labelOf, clsOf) => {
      const box = el(id); box.innerHTML = "";
      for (const v of values) {
        box.appendChild(segButton(group, v, labelOf(v), counts[group][v] || 0, clsOf ? clsOf(v) : null));
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
    if (!focus) { box.innerHTML = '<div class="empty">Nothing in memory yet. Teach a fact in chat, then re-run tmct viz.</div>'; return; }
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

  // A successful live teach re-derives the WHOLE ledger (computeLedgerDataFromPayload,
  // the sibling bundle's own re-export of the exact function this page's build
  // step called) and re-mounts it here — the same view a fresh page load
  // would render, never a stale snapshot next to a chat log that only SAYS
  // something new was learned. The dashboard/sparkline sections are replaced
  // wholesale (dashboardHtml/sparklineSvg, toString-embedded above, are the
  // SAME functions the server used for the very first paint) rather than
  // patched, so they can never drift from what a fresh render would produce.
  function applyLedgerData(freshData) {
    LEDGER = {
      rows: freshData.rows, terms: freshData.terms, edges: freshData.edges,
      focus: freshData.focus, contradictions: freshData.contradictions,
      worthALook: freshData.worthALook, meta: freshData.meta,
    };
    rebuildIndexes();
    el("dash").outerHTML = dashboardHtml(freshData.stats, { fresh: true });
    el("sparkWrap").innerHTML = sparklineSvg(freshData.stats) + '<p class="mapnote">' + sparkCaptionHtml(freshData.stats) + "</p>";
    // computeLedgerDataFromPayload resolves an unset focus to the newest
    // taught row's own subject — passing no explicit term (below) means every
    // successful teach naturally jumps the view to what was just learned.
    if (freshData.focus) refocusWithLabel(freshData.focus, null);
    else render();
  }

  // ---- the chat dock: LIVE teach+ask over the sibling ledger-browser.bundle.js
  // (window.tmctLedger) when the demo build offered it AND it actually
  // loaded; falls back to the read-only tmctMemoryAsk engine below —
  // unchanged from before this page could teach at all — otherwise.
  // bin/tmct.mjs's own \`tmct viz\` output never offers the live bundle
  // (renderLedgerHtml's own ledgerBundleAvailable defaults false there), so
  // this branch is simply never reachable on a CLI-generated page.
  const resolveAnsweredTerm = ${resolveAnsweredTerm.toString()};
  const chatForm = el("chatform");
  if (chatForm && typeof tmctLedger !== "undefined" && typeof tmctLedger.createLedgerSession === "function") {
    const log = el("chatlog");
    const chatqEl = el("chatq");
    chatqEl.placeholder = 'ask or teach the graph\\u2026 e.g. "blue is a peg"';
    const addLine = (cls, html) => {
      const d = document.createElement("div");
      d.className = cls; d.innerHTML = html;
      log.appendChild(d); log.scrollTop = log.scrollHeight;
      return d;
    };

    let session = null;
    // Serializes every engine-touching call through this one dock — the same
    // posture plan-viz.mjs's own chat-assert dock takes with its withLock,
    // so a fast double-submit can never race two turns over one session.
    let lock = Promise.resolve();
    const withLock = (fn) => { const run = lock.then(fn, fn); lock = run.catch(() => {}); return run; };

    // The SAME bounded-race wink-nlp CDN load plan-viz.mjs's own chat-assert
    // dock uses: a cross-origin dynamic import() can neither resolve nor
    // reject on some failures, so an unbounded await would leave a session
    // stuck forever. Best-effort — a teach sentence that needs the lemma tier
    // just declines honestly without it, same as a checkout missing the
    // optional deps.
    const WINK_LOAD_TIMEOUT_MS = 8000;
    const winkTimeout = (ms, reason) => new Promise((_, reject) => setTimeout(() => reject(new Error(reason)), ms));
    let winkReady = null;
    function tryLoadWink() {
      if (winkReady) return winkReady;
      winkReady = (async () => {
        try {
          const mods = await Promise.race([
            Promise.all([import("wink-nlp"), import("wink-eng-lite-web-model")]),
            winkTimeout(WINK_LOAD_TIMEOUT_MS, "wink-nlp CDN load timed out"),
          ]);
          const winkNLP = mods[0].default;
          const model = mods[1].default;
          tmctLedger.registerWinkModel(() => ({ winkNLP: winkNLP, model: model }));
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("tmct ledger: wink-nlp CDN load failed, continuing without the lemma/POS tier", err);
        }
      })();
      return winkReady;
    }
    tryLoadWink(); // fire eagerly at load, so it is likely settled by the first interaction

    async function ensureSession() {
      if (session) return session;
      await tryLoadWink();
      session = await tmctLedger.createLedgerSession({ seedPayload: PAYLOAD });
      return session;
    }

    chatForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = chatqEl.value.trim();
      if (!q) return;
      chatqEl.value = "";
      addLine("u", esc(q));
      const pending = addLine("a pending", "computing\\u2026");
      chatqEl.disabled = true;
      withLock(async () => {
        try {
          const s = await ensureSession();
          const result = await s.turn(q);
          const record = result.record;
          const taught = !!record && record.miss === false && (record.via === "assert" || record.via === "retract");
          const body = esc(result.answer).replace(/\\n/g, "<br>");
          pending.className = "a" + (taught ? " taught" : (record && record.miss ? " miss" : ""));
          pending.innerHTML = taught ? '<span class="tag">taught</span>' + body : body;
          if (taught) {
            const fresh = tmctLedger.computeLedgerDataFromPayload(s.memoryDir.payload, {});
            applyLedgerData(fresh);
          } else if (!(record && record.miss)) {
            // Only a genuine answer (never a miss) tries to resolve a
            // refocus target — the honest-miss cascade's own boilerplate
            // ("Run \`tmct init\`…") can contain a real term as an
            // ordinary English word (e.g. "run", if the graph happens to
            // hold it), and resolveAnsweredTerm has no way to tell that
            // apart from the term genuinely being discussed.
            const hit = resolveAnsweredTerm(result.answer, q, LEDGER.terms, tmctLedger.normFactTerm);
            if (hit) refocusWithLabel(hit, q);
          }
        } catch {
          pending.className = "a miss";
          pending.textContent = "Something went wrong answering that. Try rephrasing, or reload the page.";
        } finally {
          chatqEl.disabled = false;
          chatqEl.focus();
        }
      });
    });
  } else if (chatForm && typeof tmctMemoryAsk !== "undefined") {
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
          // Same formatting contract as chat's withGoalLine: capitalized,
          // full-stop-terminated, rendered only when the engine deduced one.
          if (fact.goal) addLine("a goal", "Goal (inferred): " + esc(fact.goal.charAt(0).toUpperCase() + fact.goal.slice(1)) + ".");
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
