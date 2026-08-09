// news-feed.mjs — from fact rows plus `now`, choose hubs, cut two-hop
// sub-graphs, assemble news items, and render the fixed paraphrase paragraph
// (PLAN_NEWS_FEED.md sections 8.2-8.3). Pure throughout: no clock, no I/O, no
// reliance on the caller's row order — feeding one fact set in two different
// orders yields byte-identical items, the same discipline p2p-room.mjs's
// sortFactIndividualsById holds for a CRDT-merged fact set.

import { sha256Bytes, normFactTerm } from "./hash.mjs";
import { FACT_PREDICATE_PHRASES, predicatePhrase, factSentence } from "./fact-phrase.mjs";
import { STOP_SET } from "./hub-terms.mjs";

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

export function newsWindowRows(rows, { now, windowMs }) {
  const nowMs = toMs(now);
  const startMs = nowMs - windowMs;
  return rows.filter((row) => {
    if (!NEWS_WINDOW_PROVENANCE_RE.test(String(row.provenance || ""))) return false;
    const t = rowObservedMs(row);
    return Number.isFinite(t) && t >= startMs && t <= nowMs;
  });
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
 *  paraphrase of prose the grammar could not read. */
export function renderNewsParagraph(hub, subgraphRows) {
  const hubTerm = normFactTerm(hub);
  const hubRows = subgraphRows.filter((r) => normFactTerm(r.subject) === hubTerm);
  const secondHopRows = subgraphRows.filter(
    (r) => normFactTerm(r.subject) !== hubTerm && normFactTerm(r.object) !== hubTerm,
  );

  const sentences = [];

  const identityObjects = hubRows
    .filter((r) => IDENTITY_PREDICATES.has(r.predicate))
    .map((r) => r.object)
    .sort();
  if (identityObjects.length) sentences.push(`${hub} is a ${joinWithAnd(identityObjects)}`);

  for (const predicate of Object.keys(FACT_PREDICATE_PHRASES)) {
    if (IDENTITY_PREDICATES.has(predicate) || sentences.length >= SENTENCE_CAP) continue;
    const objects = hubRows
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

/** scoreHubs -> one item per hub (PLAN_NEWS_FEED.md section 6.6), paragraph
 *  included, sorted builtAt desc then id asc. `sourcesByFactId` maps fact ids
 *  to snapshot source links ({ title, url, name }). */
export function buildNewsItems(rows, { now, windowMs, limit = 6, sourcesByFactId = new Map() } = {}) {
  const windowRows = newsWindowRows(rows, { now, windowMs });
  const hubs = scoreHubs(rows, windowRows, { limit });
  const adjacency = buildTermAdjacency(rows);
  const items = hubs.map(({ term, changed }) => {
    const subgraphRows = subgraphAround(rows, term, { adjacency });
    const factIds = subgraphRows.map((r) => r.id).sort();
    return {
      id: `news-feed:${sha256HexPrefix(`${term}\0${factIds.join(",")}`, 8)}`,
      hub: term,
      factIds,
      changedCount: changed,
      builtAt: now,
      paragraph: renderNewsParagraph(term, subgraphRows),
      tier: tierOf(subgraphRows),
      sources: collectSources(subgraphRows, sourcesByFactId),
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
