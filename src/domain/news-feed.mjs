// news-feed.mjs — from fact rows plus `now`, choose hubs, cut two-hop
// sub-graphs, assemble news items, and render the fixed paraphrase paragraph
// (PLAN_NEWS_FEED.md sections 8.2-8.3). Pure throughout: no clock, no I/O, no
// reliance on the caller's row order — feeding one fact set in two different
// orders yields byte-identical items, the same discipline p2p-room.mjs's
// sortFactIndividualsById holds for a CRDT-merged fact set.

import { sha256Bytes, normFactTerm } from "./hash.mjs";
import { FACT_PREDICATE_PHRASES, predicatePhrase, factSentence } from "./fact-phrase.mjs";
import { STOP_SET } from "./hub-terms.mjs";
import { articleFor } from "./digest/words.mjs";

export const NEWS_HUB_HOPS = 2; // fixed by design, not a knob

function sha256HexPrefix(str, nBytes) {
  const bytes = sha256Bytes(str);
  let hex = "";
  for (let i = 0; i < nBytes; i += 1) hex += bytes[i].toString(16).padStart(2, "0");
  return hex;
}

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

function toMs(value) {
  if (typeof value === "number") return value;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : NaN;
}

// The ingest seam wraps a caller's tag in its own audit prefix
// (extracted:news-fixture:…, optimistic-extract:news:…), so the news tag is
// matched at any segment boundary, never only at the front.
const NEWS_WINDOW_PROVENANCE_RE = /(?:^|:)(?:news|news-fixture|research):/;

/** Rows whose provenance carries a `news:`, `news-fixture:` or `research:`
 *  tag and whose observedAt (else createdAt) falls inside [now - windowMs,
 *  now]. Pure filter — `now` is the caller's clock reading, nothing here
 *  reads a live one. */
/** A row's own observation moment: the top-level stamp when a caller set
 *  one, else the latest per-assertion stamp the fold surfaces — readFactRows
 *  keeps observedAt/createdAt on each assertion record, not on the row. */
function rowObservedMs(row) {
  const own = toMs(row.observedAt || "");
  if (Number.isFinite(own)) return own;
  let latest = NaN;
  for (const a of row.assertions || []) {
    const t = toMs(a.observedAt || a.createdAt || "");
    if (Number.isFinite(t) && !(latest >= t)) latest = t;
  }
  if (Number.isFinite(latest)) return latest;
  return toMs(row.createdAt || "");
}

/** Does this provenance carry a news/research tag anywhere in it? True for a
 *  bare `news:…` and for both ingest wrappers (`extracted:news:…`,
 *  `optimistic-extract:news:…`), which is what the live poll path writes. The
 *  window filter below and any surface counting "facts from news" read the
 *  same rule from here, so a tile can never drift from the feed. */
export function isNewsProvenance(provenance) {
  return NEWS_WINDOW_PROVENANCE_RE.test(String(provenance || ""));
}

export function newsWindowRows(rows, { now, windowMs }) {
  const nowMs = toMs(now);
  const startMs = nowMs - windowMs;
  return rows.filter((row) => {
    if (!isNewsProvenance(row.provenance)) return false;
    const t = rowObservedMs(row);
    return Number.isFinite(t) && t >= startMs && t <= nowMs;
  });
}

// ---------------------------------------------------------------------------
// The newsworthiness gate (PLAN_NEWS_FEED.md section 17). A card reports what
// a contemporary source said inside the window; everything the graph looked
// up, inferred or already held is background. classifyNewsRow bands a single
// row; reportedRows and newsworthyHubs narrow buildNewsItems downstream of
// newsWindowRows/scoreHubs, which keep their own behaviour unchanged.
// ---------------------------------------------------------------------------

// Identity predicates and their negative twins — what a thing IS, never what
// happened to it, so a row under any of these bands background whoever wrote
// it. Distinct from renderNewsParagraph's own narrower IDENTITY_PREDICATES
// (below), which only needs the two positive forms for its identity sentence.
const GATE_IDENTITY_PREDICATES = new Set(["rdf:type", "rdfs:subClassOf", "mgxneg:subClassOf", "owl:disjointWith"]);

// Every determiner a universal quantifier is ever stored under — today only
// "every" is written (chat.mjs's own teach lane), "all"/"each" kept here so a
// future writer of either still bands background rather than heading a card.
const UNIVERSAL_QUANTIFIERS = new Set(["every", "all", "each"]);

// A REPORT is `news:` or `news-fixture:` only — `research:` counts for the
// window (isNewsProvenance, above) but never for the gate: an enrichment
// lookup is something the graph asked for, not something a source reported.
const REPORT_PROVENANCE_RE = /(?:^|:)(?:news|news-fixture):/;

// A term the anchoring test (newsworthyHubs, below) must treat as prior
// knowledge — matched at any segment boundary, including after a " | "
// union, so a row folded from two assertions counts if either one does.
const CORPUS_OR_TEACH_SEGMENT_RE = /(?:^|:|\|\s*)(?:corpus|teach):/;

const hasNonEmptyArray = (value) => Array.isArray(value) && value.length > 0;

// The provenance HEAD is the first whitespace-delimited token — the same cut
// point trust.mjs's own provenanceTagToSource uses, so "entailed:" is read
// off the row's OWN assertion even when a union has appended a second tag
// after it.
const provenanceHead = (provenance) => String(provenance || "").trim().split(/\s+/)[0] || "";

/** "derived" | "background" | "reported" for one row, pure over the row plus
 *  `now` (PLAN_NEWS_FEED.md section 17.3, step one). Rules apply in order,
 *  first hit wins: a syllogised row is derived; an identity, universal or
 *  non-news-provenance row is background; a news/news-fixture row with no
 *  readable or in-window stamp is background; everything else is reported. */
export function classifyNewsRow(row, { now, windowMs }) {
  if (provenanceHead(row.provenance).startsWith("entailed:")
    || hasNonEmptyArray(row.environments) || hasNonEmptyArray(row.justification)) {
    return "derived";
  }
  if (GATE_IDENTITY_PREDICATES.has(row.predicate)) return "background";
  if (UNIVERSAL_QUANTIFIERS.has(String(row.quantifier || "").toLowerCase())) return "background";
  if (!REPORT_PROVENANCE_RE.test(String(row.provenance || ""))) return "background";
  const t = rowObservedMs(row);
  const nowMs = toMs(now);
  if (!Number.isFinite(t) || t < nowMs - windowMs || t > nowMs) return "background";
  return "reported";
}

/** The "reported" subset of `rows` — counting occurrences over this set,
 *  rather than the wider news window, is what makes a hub's `changedCount`
 *  count reports rather than lookups (newsworthyHubs, below). */
export function reportedRows(rows, { now, windowMs }) {
  return rows.filter((row) => classifyNewsRow(row, { now, windowMs }) === "reported");
}

/** The class objects of every identity row anywhere in `rows` — what the
 *  graph's own `rdf:type`/`rdfs:subClassOf` (and negative twins) rows name as
 *  a CLASS, regardless of who reported the identity fact. A hub test, not a
 *  row band: a term absent from this set is not a class by the graph's own
 *  account. */
export function conceptTerms(rows) {
  const terms = new Set();
  for (const row of rows) {
    if (!GATE_IDENTITY_PREDICATES.has(row.predicate)) continue;
    const t = normFactTerm(row.object);
    if (t) terms.add(t);
  }
  return terms;
}

const BARE_NUMBER_RE = /^-?[£$€]?\d[\d,]*(?:\.\d+)?%?$/;
const ISO_DATE_RE = /^\d{4}-\d{2}(-\d{2})?$/;
const QUARTER_RE = /^q[1-4]\s+\d{4}$/i;
const LEADING_DIGIT_PHRASE_RE = /^\d[\d,.]*\s+\S/;
const TRAILING_NUMBER_PHRASE_RE = /\s\d[\d,.]*$/;

/** True when the WHOLE term is a number, a date or a quantity phrase ("q3
 *  2026", "7,409 square kilometres", "1,683,115") — never a term a hub may
 *  head: a date is when a card happened, and an amount is what it says. */
export function isQuantityTerm(term) {
  const t = String(term ?? "").trim().toLowerCase();
  if (!t) return false;
  if (BARE_NUMBER_RE.test(t)) return true;
  if (ISO_DATE_RE.test(t)) return true;
  if (QUARTER_RE.test(t)) return true;
  if (LEADING_DIGIT_PHRASE_RE.test(t)) return true;
  if (TRAILING_NUMBER_PHRASE_RE.test(t)) return true;
  return false;
}

/** True when `term` contains a digit run anywhere — the anchor a specific
 *  measurement gives a seeded hub, weaker than isQuantityTerm's "the whole
 *  term IS a number" test. */
export function hasQuantityMarker(term) {
  return /\d/.test(String(term ?? ""));
}

/** scoreHubs's gated twin: from `reported` rows only, counts terms (subject
 *  and object, STOP_SET removed) as `changed`, then keeps a term only when it
 *  passes all three hub tests (PLAN_NEWS_FEED.md section 17.3, step two):
 *  reported (it is why the term is a candidate at all), not a class or a bare
 *  quantity, and anchored — either the window introduced the term outright,
 *  or one of its own reported rows joins it to something window-new or
 *  carrying a digit run. `rows` is the WHOLE fact set (conceptTerms and the
 *  anchoring test both read prior knowledge from it, not just the window). */
export function newsworthyHubs(rows, reported, { now, windowMs, limit = 6, adjacency = null } = {}) {
  const adj = adjacency ?? buildTermAdjacency(rows);
  const concepts = conceptTerms(rows);
  const nowMs = toMs(now);
  const startMs = nowMs - windowMs;

  function isWindowNewTerm(term) {
    const idxs = adj.byTerm.get(term);
    if (!idxs || !idxs.length) return false;
    for (const idx of idxs) {
      const row = rows[idx];
      const t = rowObservedMs(row);
      if (!(Number.isFinite(t) && t >= startMs && t <= nowMs)) return false;
      if (CORPUS_OR_TEACH_SEGMENT_RE.test(String(row.provenance || ""))) return false;
    }
    return true;
  }

  const counts = new Map();
  const anchors = new Map();
  for (const row of reported) {
    const s = normFactTerm(row.subject);
    const o = normFactTerm(row.object);
    for (const [term, other] of [[s, o], [o, s]]) {
      if (!term || STOP_SET.has(term)) continue;
      counts.set(term, (counts.get(term) || 0) + 1);
      let others = anchors.get(term);
      if (!others) anchors.set(term, (others = new Set()));
      if (other) others.add(other);
    }
  }

  const hubs = [];
  for (const [term, changed] of counts) {
    if (concepts.has(term) || isQuantityTerm(term)) continue;
    let anchored = isWindowNewTerm(term);
    if (!anchored) {
      for (const other of anchors.get(term) ?? []) {
        if (hasQuantityMarker(other) || isWindowNewTerm(other)) { anchored = true; break; }
      }
    }
    if (!anchored) continue;
    hubs.push({ term, changed });
  }

  return hubs
    .sort((a, b) => b.changed - a.changed || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
    .slice(0, limit);
}

/** A card's two-hop sub-graph, divided by the row-band gate: `reported` rows
 *  (what heads the card) and everything else (the collapsed background
 *  line). `reportedIds` is the reported-row id set the caller already
 *  computed over the whole fact set (reportedRows' output, by id). */
export function splitCardRows(subgraphRows, reportedIds) {
  const ids = reportedIds instanceof Set ? reportedIds : new Set(reportedIds || []);
  const reported = [];
  const background = [];
  for (const row of subgraphRows) (ids.has(row.id) ? reported : background).push(row);
  return { reported, background };
}

/** Counts window facts per term (subject and object, normalized, STOP_SET
 *  removed) -> [{ term, changed }] sorted changed desc then term asc, capped
 *  at `limit`. */
export function scoreHubs(rows, windowRows, { limit = 6 } = {}) {
  const counts = new Map();
  for (const row of windowRows) {
    for (const raw of [row.subject, row.object]) {
      const term = normFactTerm(raw);
      if (!term || STOP_SET.has(term)) continue;
      counts.set(term, (counts.get(term) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([term, changed]) => ({ term, changed }))
    .sort((a, b) => b.changed - a.changed || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
    .slice(0, limit);
}

/** One normalization pass over `rows`: each term to the row indices touching
 *  it, plus every row's own normalized pair. Built once per feed assembly and
 *  shared across every hub's walk — re-normalizing the whole store per
 *  frontier term is minutes of main-thread work on a browser-sized graph. */
export function buildTermAdjacency(rows) {
  const byTerm = new Map();
  const terms = new Array(rows.length);
  for (let i = 0; i < rows.length; i += 1) {
    const s = normFactTerm(rows[i].subject);
    const o = normFactTerm(rows[i].object);
    terms[i] = [s, o];
    let forSubject = byTerm.get(s);
    if (!forSubject) byTerm.set(s, (forSubject = []));
    forSubject.push(i);
    if (o !== s) {
      let forObject = byTerm.get(o);
      if (!forObject) byTerm.set(o, (forObject = []));
      forObject.push(i);
    }
  }
  return { byTerm, terms };
}

/** Breadth-first over subject/object adjacency from `hub`, exactly `hops`
 *  levels deep, then capped by content-addressed id — so the cap never
 *  depends on `rows`' own order, only on which rows the hop-bounded walk
 *  actually reaches. */
export function subgraphAround(rows, hub, { hops = NEWS_HUB_HOPS, cap = 60, adjacency = null } = {}) {
  const adj = adjacency ?? buildTermAdjacency(rows);
  const hubTerm = normFactTerm(hub);
  const visited = new Set([hubTerm]);
  let frontier = [hubTerm];
  const collected = new Map();
  for (let hop = 0; hop < hops; hop += 1) {
    const nextFrontier = new Set();
    for (const term of [...frontier].sort()) {
      for (const idx of adj.byTerm.get(term) ?? []) {
        const row = rows[idx];
        collected.set(row.id, row);
        const [s, o] = adj.terms[idx];
        if (!visited.has(s)) nextFrontier.add(s);
        if (!visited.has(o)) nextFrontier.add(o);
      }
    }
    for (const term of nextFrontier) visited.add(term);
    frontier = [...nextFrontier].sort();
  }
  return [...collected.values()].sort(byId).slice(0, cap);
}

/** The strongest prior kind among `rows`, for the item's trust chip — read
 *  off each row's own `trust` (a number) and `sourceTypes` (the kind array
 *  readFactRows already computes), never a re-derivation of SOURCE_PRIOR. */
function tierOf(rows) {
  if (!rows.length) return "";
  let strongest = rows[0];
  for (const row of rows) {
    if (Number(row.trust ?? 0) > Number(strongest.trust ?? 0)) strongest = row;
  }
  const kinds = Array.isArray(strongest.sourceTypes) ? strongest.sourceTypes : [];
  return kinds[0] || "";
}

function collectSources(subgraphRows, sourcesByFactId) {
  const get = (id) => (sourcesByFactId instanceof Map ? sourcesByFactId.get(id) : sourcesByFactId?.[id]);
  const seen = new Set();
  const sources = [];
  for (const row of subgraphRows) {
    const src = get(row.id);
    if (!src) continue;
    const key = src.url || src.title || "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    sources.push({ title: src.title || "", url: src.url || "", name: src.name || "" });
  }
  return sources;
}

function joinWithAnd(items) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

const IDENTITY_PREDICATES = new Set(["rdf:type", "rdfs:subClassOf"]);
const SENTENCE_CAP = 5;

/** The fixed five-sentence paraphrase template (PLAN_NEWS_FEED.md section
 *  8.3): identity first, then the hub's own relations grouped by predicate in
 *  FACT_PREDICATE_PHRASES table order, then one closing sentence naming up to
 *  three second-hop facts. Every sentence shown is a grounded fact, never a
 *  paraphrase of prose the grammar could not read.
 *
 *  `reportedIds` (PLAN_NEWS_FEED.md section 17.4), when given, restricts the
 *  relation sentences and the closing "Around it" sentence to rows in that
 *  set — the identity sentence keeps drawing from every row it's handed,
 *  since "what is this thing" is the first question a reader has regardless
 *  of who reported it. Defaults to null, meaning every row renders, so every
 *  existing caller and pin is unaffected. */
export function renderNewsParagraph(hub, subgraphRows, { reportedIds = null } = {}) {
  const hubTerm = normFactTerm(hub);
  const isReported = reportedIds === null
    ? () => true
    : (id) => (reportedIds instanceof Set ? reportedIds.has(id) : reportedIds.includes(id));
  const hubRows = subgraphRows.filter((r) => normFactTerm(r.subject) === hubTerm);
  const reportedHubRows = hubRows.filter((r) => isReported(r.id));
  const secondHopRows = subgraphRows.filter(
    (r) => normFactTerm(r.subject) !== hubTerm && normFactTerm(r.object) !== hubTerm && isReported(r.id),
  );

  const sentences = [];

  const identityObjects = hubRows
    .filter((r) => IDENTITY_PREDICATES.has(r.predicate))
    .map((r) => r.object)
    .sort();
  if (identityObjects.length) {
    const withArticles = identityObjects.map((object) => `${articleFor(object)} ${object}`);
    sentences.push(`${hub} is ${joinWithAnd(withArticles)}`);
  }

  for (const predicate of Object.keys(FACT_PREDICATE_PHRASES)) {
    if (IDENTITY_PREDICATES.has(predicate) || sentences.length >= SENTENCE_CAP) continue;
    const objects = reportedHubRows
      .filter((r) => r.predicate === predicate)
      .map((r) => r.object)
      .sort();
    if (!objects.length) continue;
    sentences.push(`${hub} ${predicatePhrase(predicate)} ${joinWithAnd(objects)}`);
  }

  if (sentences.length < SENTENCE_CAP && secondHopRows.length) {
    const around = secondHopRows
      .slice()
      .sort(byId)
      .slice(0, 3)
      .map((r) => factSentence(r))
      .join("; ");
    sentences.push(`Around it: ${around}`);
  }

  const capped = sentences.slice(0, SENTENCE_CAP);
  return capped.length ? `${capped.join(". ")}.` : "";
}

/** newsworthyHubs -> one item per hub (PLAN_NEWS_FEED.md section 6.6),
 *  paragraph included, sorted builtAt desc then id asc. `sourcesByFactId`
 *  maps fact ids to snapshot source links ({ title, url, name }). The gate
 *  (PLAN_NEWS_FEED.md section 17): `reportedRows` replaces `newsWindowRows`
 *  and `newsworthyHubs` replaces `scoreHubs` as this function's own inputs —
 *  both keep their prior behaviour for every other caller. Each item's
 *  two-hop sub-graph then splits into its own `reported`/`background` rows,
 *  so a card's paragraph draws from what was reported and its collapsed
 *  `backgroundParagraph` draws from what the graph already knew. */
export function buildNewsItems(rows, { now, windowMs, limit = 6, sourcesByFactId = new Map() } = {}) {
  const reported = reportedRows(rows, { now, windowMs });
  const reportedIds = new Set(reported.map((r) => r.id));
  const adjacency = buildTermAdjacency(rows);
  const hubs = newsworthyHubs(rows, reported, { now, windowMs, limit, adjacency });
  const items = hubs.map(({ term, changed }) => {
    const subgraphRows = subgraphAround(rows, term, { adjacency });
    const factIds = subgraphRows.map((r) => r.id).sort();
    const { background } = splitCardRows(subgraphRows, reportedIds);
    return {
      id: `news-feed:${sha256HexPrefix(`${term}\0${factIds.join(",")}`, 8)}`,
      hub: term,
      factIds,
      changedCount: changed,
      builtAt: now,
      paragraph: renderNewsParagraph(term, subgraphRows, { reportedIds }),
      tier: tierOf(subgraphRows),
      sources: collectSources(subgraphRows, sourcesByFactId),
      background: background.map((r) => r.id).sort(),
      backgroundParagraph: renderNewsParagraph(term, background),
    };
  });
  return items.sort((a, b) => (toMs(b.builtAt) - toMs(a.builtAt)) || byId(a, b));
}

// A `news:` tag, matched wherever it sits in a fact's provenance — bare
// ("news:<sourceId>@<itemId>", the shape a caller writing directly under
// this tag produces) or nested inside the strict/optimistic ingest wrapper
// ("extracted:news:<sourceId>@<itemId>", "optimistic-extract:news:<sourceId>
// @<itemId>" — ingestText's own audit-tag wrapping, and a fact the strict
// recognizer also grounds carries a THIRD, unioned ace:/teach: tag ahead of
// it). Never matches "news-fixture:" (no colon follows "news" there), which
// is the deliberate exclusion the fixture-replay rows need.
const NEWS_PROVENANCE_RE = /(?:^|[:|]\s*)news:/;

/** News-tagged fact ids to retract, oldest observedAt first, ties by id —
 *  the eviction the service applies at ingest time so the graph cannot grow
 *  past `cap` unattended. Never selects a seed/taught/research/fixture-
 *  replay row. */
export function evictNewsFacts(rows, { cap }) {
  const newsRows = rows.filter((r) => NEWS_PROVENANCE_RE.test(String(r.provenance || "")));
  if (newsRows.length <= cap) return [];
  const sorted = newsRows.slice().sort((a, b) => {
    const at = toMs(a.observedAt || "");
    const bt = toMs(b.observedAt || "");
    const an = Number.isFinite(at) ? at : 0;
    const bn = Number.isFinite(bt) ? bt : 0;
    return an - bn || byId(a, b);
  });
  return sorted.slice(0, newsRows.length - cap).map((r) => r.id);
}
