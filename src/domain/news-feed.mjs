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
import { provenanceTagToSource } from "./memory/trust.mjs";

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
// Item identity: what makes two fetched snapshots the same newsworthy item.
// ---------------------------------------------------------------------------

// Everything a source can respell between two readings of one article —
// punctuation, capitalisation, entity escapes already stripped upstream, run
// of spaces — folds away, so the key answers to the item's words alone.
const CONTENT_KEY_NOISE_RE = /[^a-z0-9]+/g;

function itemContentText(snapshot) {
  return `${snapshot?.title ?? ""} ${snapshot?.summary ?? ""}`
    .toLowerCase()
    .replace(CONTENT_KEY_NOISE_RE, " ")
    .trim();
}

/** The content key one snapshot answers to, or "" when it carries no words:
 *  its source, its own publication stamp and its normalized text. The key a
 *  source with no stable id of its own de-dupes on, and the second chance at
 *  recognising an article a source re-issued under a fresh id. The publication
 *  stamp stays in so two genuinely different events that happen to share a
 *  headline — two quakes of the same size near the same town — keep separate
 *  keys. Pure. */
export function newsItemContentKey(snapshot) {
  const text = itemContentText(snapshot);
  if (!text) return "";
  const sourceId = String(snapshot?.sourceId ?? "");
  const publishedAt = String(snapshot?.publishedAt ?? "");
  return `news-text:${sha256HexPrefix(`${sourceId}\0${publishedAt}\0${text}`, 8)}`;
}

/** Every key a fetched snapshot is the same item under: the id the fetcher
 *  minted from the source's own identifier (Hacker News story id, USGS event
 *  id, an RSS guid, a Wikinews page id, a Wikimedia article title) and its
 *  content key. Two snapshots sharing any key name one item. Pure — a function
 *  of the snapshot's own fields, never of when or in what order it arrived. */
export function newsItemKeys(snapshot) {
  const keys = [];
  const id = String(snapshot?.id ?? "");
  if (id) keys.push(id);
  const contentKey = newsItemContentKey(snapshot);
  if (contentKey) keys.push(contentKey);
  return keys;
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
// `mgx:nameFor` joins this set too: "X is the name for Y" defines X, and a
// definition is never a card head, whatever the row's own findings say.
const GATE_IDENTITY_PREDICATES = new Set(["rdf:type", "rdfs:subClassOf", "mgxneg:subClassOf", "owl:disjointWith", "mgx:nameFor"]);

// Every determiner a universal quantifier is ever stored under — today only
// "every" is written (chat.mjs's own teach lane), "all"/"each" kept here so a
// future writer of either still bands background rather than heading a card.
const UNIVERSAL_QUANTIFIERS = new Set(["every", "all", "each"]);

// A REPORT is `news:` or `news-fixture:` only — `research:` counts for the
// window (isNewsProvenance, above) but never for the gate: an enrichment
// lookup is something the graph asked for, not something a source reported.
const REPORT_PROVENANCE_RE = /(?:^|:)(?:news|news-fixture):/;

const hasNonEmptyArray = (value) => Array.isArray(value) && value.length > 0;

// The provenance HEAD is the first whitespace-delimited token — the same cut
// point trust.mjs's own provenanceTagToSource uses, so "entailed:" is read
// off the row's OWN assertion even when a union has appended a second tag
// after it.
const provenanceHead = (provenance) => String(provenance || "").trim().split(/\s+/)[0] || "";

/** True when the graph reasoned this row out for itself rather than reading it
 *  somewhere — an entailment head, an environment, or a justification chain.
 *  A card never speaks from one: the subClassOf closure gives a common noun
 *  every parent class of every sense it has ("earthquake is a kind of
 *  cognition, a tentacle, a christians"), which is sound as inference and
 *  useless as a sentence about today's quake. */
export function isDerivedRow(row) {
  return provenanceHead(row?.provenance).startsWith("entailed:")
    || hasNonEmptyArray(row?.environments) || hasNonEmptyArray(row?.justification);
}

/** "derived" | "background" | "reported" for one row, pure over the row plus
 *  `now` (PLAN_NEWS_FEED.md section 17.3, step one). Rules apply in order,
 *  first hit wins: a syllogised row is derived; an identity, universal or
 *  non-news-provenance row is background; a news/news-fixture row with no
 *  readable or in-window stamp is background; everything else is reported. */
export function classifyNewsRow(row, { now, windowMs }) {
  if (isDerivedRow(row)) return "derived";
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

// The SOURCE_PRIOR kinds a term counts as prior knowledge under
// (src/domain/memory/trust.mjs) — a seed corpus pack, a taught fact, a
// curated reference article. `referenceLive` (a live research: lookup) is
// deliberately absent: an enrichment lookup is something a hub candidate
// earned by already being a candidate, not knowledge the graph held before
// any report arrived (PLAN_NEWSWORTHINESS.md section 1.1).
const PRIOR_KNOWLEDGE_SOURCE_KINDS = new Set(["corpus", "corpusWeak", "reference", "provider", "teach"]);

/** Every subject and object term (term-whole — a two-word phrase is one
 *  entry, never two) touched by a row whose provenance parses to a
 *  PRIOR_KNOWLEDGE_SOURCE_KINDS kind. A REPORT row (`news:`/`news-fixture:`,
 *  REPORT_PROVENANCE_RE above) is excluded even when its own tag happens to
 *  resolve to the `corpus` kind — `news-fixture:` scores there so a demo
 *  replay never outranks a live claim (memory/trust.mjs), not because a
 *  fixture item is knowledge the graph held before its own report arrived; a
 *  row can never be prior knowledge for the very term it is reporting. Pure
 *  over `rows`; a caller building the entity gate memoises the result the
 *  same way buildTermAdjacency already is. */
export function priorTerms(rows) {
  const prior = new Set();
  for (const row of rows) {
    if (REPORT_PROVENANCE_RE.test(String(row.provenance || ""))) continue;
    const kind = provenanceTagToSource(row.provenance)?.kind;
    if (!kind || !PRIOR_KNOWLEDGE_SOURCE_KINDS.has(kind)) continue;
    const s = normFactTerm(row.subject);
    const o = normFactTerm(row.object);
    if (s) prior.add(s);
    if (o) prior.add(o);
  }
  return prior;
}

/** True when `term` never appears in `prior` — priorTerms' own absence
 *  check, taken term-whole. */
export function isNovelTerm(term, prior) {
  const t = normFactTerm(term);
  if (!t) return false;
  return prior instanceof Set ? !prior.has(t) : !new Set(prior).has(t);
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

// The clause-fragment lead words a candidate term's own first word may not
// be — the lexical half of services/extract-facts.mjs's own
// readsAsEntityTerm, duplicated here (not imported) because the domain layer
// never imports from services, a boundary this module's own header states.
// It is also exactly what that function itself falls back to when no wink
// engine is wired in, so this is a real, already-shipped code path, not an
// approximation of one — a caller that DOES wire wink in front of the news
// gate is free to filter a candidate further before it ever reaches here.
const ENTITY_TERM_MAX_WORDS = 6;
const ENTITY_FRAGMENT_LEAD_WORDS = new Set([
  "and", "or", "but", "because", "since", "although", "though", "whereas", "while", "so",
  "that", "which", "who", "whom", "whose", "if", "when", "then", "also", "however",
  "is", "are", "was", "were", "be", "been", "being", "am", "has", "have", "had",
  "do", "does", "did", "can", "could", "will", "would", "should", "may", "might", "must",
  "of", "in", "on", "at", "for", "to", "with", "from", "by", "as", "into", "onto",
  "over", "under", "after", "before", "between", "during", "about", "near", "through",
  "against", "among", "within", "without", "per",
]);

// The particles a phrasal verb leaves behind when a frame over-reads its
// remainder as a term ("falls back to the link" surfaces as "back to the
// link", which names nothing) — mirrors extract-facts.mjs's own
// PARTICLE_LEAD_WORDS lexically, with no POS-tag rule, since the domain layer
// never imports the services-layer wink engine. Applies only to a multi-word
// term; "back" alone is a fine noun.
const ENTITY_PARTICLE_LEAD_WORDS = new Set(["back", "up", "down", "out", "off", "away", "along", "around"]);

// A pronoun points back at whatever the last clause named, so a multi-word
// term opening with one is a clause the split lost the subject of. A term
// ending in a bare auxiliary is the front half of one. Both mirror
// extract-facts.mjs's own lexical rules, for the same reason the sets above do.
const ENTITY_PRONOUN_LEAD_WORDS = new Set([
  "i", "he", "she", "it", "we", "they", "you", "me", "him", "them", "us",
  "his", "her", "its", "their", "our", "your", "my",
]);
const ENTITY_CLITIC_SUFFIX_RE = /['’](?:s|re|ve|ll|d|m)$/;
const ENTITY_TRAILING_AUXILIARY_WORDS = new Set([
  "is", "are", "was", "were", "be", "been", "being", "am", "has", "have", "had",
]);

/** Does `term` read as a thing's name rather than a clause fragment? Bounds
 *  the word count and rejects a leading conjunction, auxiliary or
 *  preposition (test E's condition 3, PLAN_NEWSWORTHINESS.md section 2), plus
 *  a leading phrasal-verb particle on a multi-word term. */
function looksLikeEntityTerm(term) {
  const text = String(term ?? "").trim();
  if (!text) return false;
  const words = text.split(/\s+/);
  if (words.length > ENTITY_TERM_MAX_WORDS) return false;
  const first = words[0].toLowerCase().replace(/^[^a-z0-9]+/, "");
  if (!first || ENTITY_FRAGMENT_LEAD_WORDS.has(first)) return false;
  if (words.length === 1) return true;
  if (ENTITY_PARTICLE_LEAD_WORDS.has(first)) return false;
  if (ENTITY_PRONOUN_LEAD_WORDS.has(first.replace(ENTITY_CLITIC_SUFFIX_RE, ""))) return false;
  if (ENTITY_TRAILING_AUXILIARY_WORDS.has(words[words.length - 1].toLowerCase())) return false;
  return true;
}

// The Wikidata research provenance tag (researchSourceTag in
// adapters/corpus/research-source.mjs: `research:wikidata:<term>`) and the
// folded shape a Wikidata item id takes once normFactTerm lower-cases it —
// test A's Q-id anchor (PLAN_NEWSWORTHINESS.md section 1.1). No shipped
// source stores a raw item id as a fact's object today (wikidata-live.mjs
// resolves every claim to an English label before it reaches the graph), so
// this reads real data the day a caller stores one directly.
const WIKIDATA_RESEARCH_PROVENANCE_RE = /(?:^|:)research:wikidata:/;
const WIKIDATA_QID_TERM_RE = /^q[1-9]\d*$/;

// The two attached findings a row's own extraction may carry that disqualify
// it from heading a card or anchoring novelty: an identifier-shaped token or
// a clause-fallback read is a structural tell the row was mis-read, not a
// report a card should lead with. `pronoun-carry` is deliberately absent — a
// subject carried from the paragraph's own prose is not a mis-read, and
// barring it would suppress real hubs. A row with no `extraction` at all
// (nothing recorded, or a row written before findings existed) never
// matches.
const GATE_DECLINING_FINDINGS = new Set(["identifier-token", "clause-fallback"]);

function rowCarriesGateDecliningFinding(row) {
  const extraction = row.extraction;
  return Array.isArray(extraction) && extraction.some((finding) => GATE_DECLINING_FINDINGS.has(finding));
}

function hasWikidataQidAnchor(term, rows) {
  for (const row of rows) {
    if (!WIKIDATA_RESEARCH_PROVENANCE_RE.test(String(row.provenance || ""))) continue;
    const s = normFactTerm(row.subject);
    const o = normFactTerm(row.object);
    if (s === term && WIKIDATA_QID_TERM_RE.test(o)) return true;
    if (o === term && WIKIDATA_QID_TERM_RE.test(s)) return true;
  }
  return false;
}

/** The newsworthiness gate (PLAN_NEWSWORTHINESS.md section 2): from
 *  `reported` rows only, counts terms (subject and object, STOP_SET removed)
 *  as `changed`, then keeps a term only when it passes test E (a new
 *  entity — absent from `priorTerms(rows)`, term-whole) or test A (a fresh,
 *  anchored assertion about an entity the graph already holds). `rows` is
 *  the WHOLE fact set (conceptTerms and priorTerms both read prior knowledge
 *  from it, not just the reported window). `prior`, when the caller already
 *  computed it (buildNewsItems does), is reused rather than recomputed.
 *  `readsAsEntityTerm`, when the caller supplies one, replaces
 *  looksLikeEntityTerm — the services layer's own readsAsEntityTerm
 *  (extract-facts.mjs) adds a wink POS-tag check this domain-local default
 *  cannot, since domain never imports services; buildFeed (news.mjs) wires
 *  it through because it already imports that module for ingestText. */
export function newsworthyHubs(rows, reported, {
  now, windowMs, limit = 6, adjacency = null, prior = null, readsAsEntityTerm = looksLikeEntityTerm,
} = {}) {
  const concepts = conceptTerms(rows);
  const priorSet = prior ?? priorTerms(rows);

  const counts = new Map();
  const subjectRowsByTerm = new Map();
  // A term with at least one occurrence in a row the gate did not decline —
  // test E's own condition (below): a term backed ONLY by declined rows never
  // heads a card, but one clean occurrence is enough even when a tainted one
  // also mentions it.
  const hasUndeclinedOccurrence = new Map();
  for (const row of reported) {
    const s = normFactTerm(row.subject);
    const o = normFactTerm(row.object);
    const declined = rowCarriesGateDecliningFinding(row);
    for (const term of [s, o]) {
      if (!term || STOP_SET.has(term)) continue;
      counts.set(term, (counts.get(term) || 0) + 1);
      if (!declined) hasUndeclinedOccurrence.set(term, true);
    }
    // A declined row is excluded from `subjectRowsByTerm` outright — test A's
    // own anchor never comes from a row the gate declined.
    if (s && !STOP_SET.has(s) && !declined) {
      let subjRows = subjectRowsByTerm.get(s);
      if (!subjRows) subjectRowsByTerm.set(s, (subjRows = []));
      subjRows.push(row);
    }
  }

  function passesEntityTest(term) {
    if (concepts.has(term) || isQuantityTerm(term)) return false;
    if (!readsAsEntityTerm(term)) return false;
    if (!hasUndeclinedOccurrence.get(term)) return false;
    return isNovelTerm(term, priorSet);
  }

  // Section 2's own text lists no entity-shape check for test A (it reads a
  // "known entity" as already established), but a malformed extraction's
  // predicate remainder can BE a reported row's subject too, with nothing
  // else in test A's own three-way anchor to catch it — a recognizer frame
  // split across a bad triple ("bang" subject, "thong shooting" object) is
  // its own novel co-term as far as test A's own anchor reads. The same
  // shape check test E already needs closes that gap for test A as well.
  function passesFreshAssertionTest(term) {
    if (concepts.has(term) || isQuantityTerm(term)) return false;
    if (!readsAsEntityTerm(term)) return false;
    const subjRows = subjectRowsByTerm.get(term);
    if (!subjRows || !subjRows.length) return false;
    if (hasWikidataQidAnchor(term, rows)) return true;
    return subjRows.some((row) => {
      const object = normFactTerm(row.object);
      return hasQuantityMarker(row.object) || (object && isNovelTerm(object, priorSet));
    });
  }

  const hubs = [];
  for (const [term, changed] of counts) {
    if (passesEntityTest(term) || passesFreshAssertionTest(term)) hubs.push({ term, changed });
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

// A source names a place by settlement and region at once — "mina, nevada",
// "pedro bay, alaska", "san juan, puerto rico". The region is the trailing
// part, and it is the half the graph plausibly already holds facts about,
// while the joined term is new. So the walk seeds from the region as well as
// the whole name. The leading part stays out: "mina" the town and "mina" the
// myna bird are one string to a graph keyed on words, and the settlement half
// is exactly where that collision lands. Comma-separated only — splitting on
// spaces would turn "public investments fund" into three terms that name
// nothing.
export function hubSeedTerms(hub) {
  const whole = normFactTerm(hub);
  const seeds = [whole];
  if (!whole.includes(",")) return seeds;
  const region = normFactTerm(whole.split(",").pop());
  if (!region || region === whole) return seeds;
  if (STOP_SET.has(region) || isQuantityTerm(region) || !looksLikeEntityTerm(region)) return seeds;
  seeds.push(region);
  return seeds;
}

/** Breadth-first over subject/object adjacency from `hub`, exactly `hops`
 *  levels deep, then capped: a `priorityIds` row first, then the nearer hop,
 *  then content-addressed id. The cap never depends on `rows`' own order, only
 *  on which rows the hop-bounded walk actually reaches and how far out each
 *  one sits.
 *
 *  `priorityIds` is what keeps a card about a term the graph already knows
 *  thousands of things about from being built out of an arbitrary slice of
 *  them: a hub like "france" reaches far more rows than the cap, and the one
 *  report that made it news would otherwise be the row that fell out.
 *
 *  `seedTerms` starts the walk from more than the hub itself (hubSeedTerms).
 *  Everything downstream that asks "is this the hub" — the report sentences,
 *  the sources, the neighbourhood — still reads the hub term alone, so a seed
 *  widens only what the card can draw background from. */
export function subgraphAround(rows, hub, {
  hops = NEWS_HUB_HOPS, cap = 60, adjacency = null, priorityIds = null, seedTerms = null,
} = {}) {
  const adj = adjacency ?? buildTermAdjacency(rows);
  const hubTerm = normFactTerm(hub);
  const seeds = (seedTerms?.length ? seedTerms : [hubTerm]).map((t) => normFactTerm(t)).filter(Boolean);
  const visited = new Set(seeds);
  let frontier = [...new Set(seeds)].sort();
  const collected = new Map();
  const hopOf = new Map();
  for (let hop = 0; hop < hops; hop += 1) {
    const nextFrontier = new Set();
    for (const term of [...frontier].sort()) {
      for (const idx of adj.byTerm.get(term) ?? []) {
        const row = rows[idx];
        collected.set(row.id, row);
        if (!hopOf.has(row.id)) hopOf.set(row.id, hop);
        const [s, o] = adj.terms[idx];
        if (!visited.has(s)) nextFrontier.add(s);
        if (!visited.has(o)) nextFrontier.add(o);
      }
    }
    for (const term of nextFrontier) visited.add(term);
    frontier = [...nextFrontier].sort();
  }
  const isPriority = (id) => (priorityIds instanceof Set ? priorityIds.has(id) : Boolean(priorityIds?.includes?.(id)));
  return [...collected.values()]
    .sort((a, b) => (isPriority(b.id) - isPriority(a.id))
      || (hopOf.get(a.id) - hopOf.get(b.id))
      || byId(a, b))
    .slice(0, cap);
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

// How much of an item's own summary a card carries. A wire description runs
// about a line; an encyclopaedia extract runs several paragraphs, and a feed
// of fifty cards has a byte budget to keep (MAX_FEED_DOCUMENT_BYTES). Cut at
// the last word boundary inside the bound so the quote ends on a word.
const SOURCE_SUMMARY_MAX_CHARS = 400;

function clampSummary(summary) {
  const text = String(summary || "").trim();
  if (text.length <= SOURCE_SUMMARY_MAX_CHARS) return text;
  const cut = text.slice(0, SOURCE_SUMMARY_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function collectSources(citedRows, sourcesByFactId) {
  const get = (id) => (sourcesByFactId instanceof Map ? sourcesByFactId.get(id) : sourcesByFactId?.[id]);
  const seen = new Set();
  const sources = [];
  for (const row of citedRows) {
    const src = get(row.id);
    if (!src) continue;
    const key = src.url || src.title || "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const entry = { title: src.title || "", url: src.url || "", name: src.name || "" };
    // Both of these ride along only when the snapshot actually has one — a
    // card for an undated or summary-less snapshot shows nothing there rather
    // than a blank field.
    if (src.publishedAt) entry.publishedAt = src.publishedAt;
    const summary = clampSummary(src.summary);
    if (summary) entry.summary = summary;
    sources.push(entry);
  }
  return sources;
}

function joinWithAnd(items) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// ---------------------------------------------------------------------------
// What one card reports, and whose neighbourhood it sits in.
// ---------------------------------------------------------------------------

/** An id membership test over a Set, an array, or null — null meaning "every
 *  row counts", which is what a caller with no reported-row set of its own
 *  (the background paragraph, a direct render call) needs. */
function idMembership(ids) {
  if (ids === null || ids === undefined) return () => true;
  if (ids instanceof Set) return (id) => ids.has(id);
  return (id) => ids.includes(id);
}

const rowObservedRank = (row) => {
  const t = rowObservedMs(row);
  return Number.isFinite(t) ? t : 0;
};

/** The reported rows of `subgraphRows` that touch `hub` directly — what this
 *  card actually reports, and so what it may attribute a source to. A row
 *  further out in the two-hop walk was reached through a term the hub merely
 *  shares; it belongs to some other card's report. */
export function hubReportRows(hub, subgraphRows, { reportedIds = null } = {}) {
  const hubTerm = normFactTerm(hub);
  const isReported = idMembership(reportedIds);
  return subgraphRows.filter((row) => isReported(row.id)
    && (normFactTerm(row.subject) === hubTerm || normFactTerm(row.object) === hubTerm));
}

/** Every term sitting one edge from `hub` inside this card's own sub-graph. */
function hubLinkTerms(subgraphRows, hubTerm) {
  const terms = new Set();
  for (const row of subgraphRows) {
    const s = normFactTerm(row.subject);
    const o = normFactTerm(row.object);
    if (s === hubTerm && o) terms.add(o);
    else if (o === hubTerm && s) terms.add(s);
  }
  terms.delete(hubTerm);
  return terms;
}

const NEIGHBOUR_ROW_LIMIT = 3;

/** This hub's own neighbourhood: the reported rows one further edge out,
 *  reached only through a link term specific enough to name a neighbourhood.
 *  A link term the clause cannot name in full — one reaching more rows than
 *  the sentence prints — is a category node, not a neighbour: "earthquake"
 *  sits between all 44 quakes of a day, so every quake card walked through it
 *  and printed the same arbitrary three. Naming a slice of a category is what
 *  made sibling cards identical, so a term over the clause's own capacity
 *  contributes nothing and a card with no specific link prints no "Around it"
 *  at all.
 *
 *  Survivors rank by a predicate the hub's own report also used, then by
 *  observation time, then by id — this hub's choice, and a pure function of
 *  the fact set either way. */
export function neighbourRows(hub, subgraphRows, { reportedIds = null, limit = NEIGHBOUR_ROW_LIMIT } = {}) {
  const hubTerm = normFactTerm(hub);
  const isReported = idMembership(reportedIds);
  const linkTerms = hubLinkTerms(subgraphRows, hubTerm);

  const reachedByLinkTerm = new Map();
  for (const row of subgraphRows) {
    const s = normFactTerm(row.subject);
    const o = normFactTerm(row.object);
    if (s === hubTerm || o === hubTerm || !isReported(row.id)) continue;
    for (const term of new Set([s, o])) {
      if (!term || !linkTerms.has(term)) continue;
      let reached = reachedByLinkTerm.get(term);
      if (!reached) reachedByLinkTerm.set(term, (reached = []));
      reached.push(row);
    }
  }

  const candidates = new Map();
  for (const [, reached] of reachedByLinkTerm) {
    if (reached.length > limit) continue;
    for (const row of reached) candidates.set(row.id, row);
  }

  const hubPredicates = new Set(hubReportRows(hub, subgraphRows, { reportedIds }).map((r) => r.predicate));
  return [...candidates.values()]
    .sort((a, b) => (Number(hubPredicates.has(b.predicate)) - Number(hubPredicates.has(a.predicate)))
      || (rowObservedRank(b) - rowObservedRank(a))
      || byId(a, b))
    .slice(0, limit);
}

const IDENTITY_PREDICATES = new Set(["rdf:type", "rdfs:subClassOf"]);
const SENTENCE_CAP = 6;
// The four blocks a card's paragraph is built from, in the order they read:
// what was reported, then what the thing is, then what the graph already knew
// about it, then its neighbourhood. Their caps add up past SENTENCE_CAP on
// purpose — the paragraph fills from the front, so a news-rich card spends its
// budget on the news and a quiet one spends it on background.
const REPORT_SENTENCE_CAP = 4;
const IDENTITY_SENTENCE_CAP = 1;
const KNOWN_FACT_SENTENCE_CAP = 2;
// How many objects one sentence names before it counts the rest. A live source
// reports the same relation over and over inside one window — every quake of
// the day strikes near somewhere — and an unbounded list turns a card into a
// wall of text.
const OBJECTS_PER_SENTENCE = 6;

// A term the graph says is more than this many things is read across senses:
// "earthquake" is a natural event, a cognition, a social station and nine more,
// so no single class line about it is trustworthy on a card about one quake.
// Same discipline as the neighbourhood's own category-node test — a node too
// wide for one clause to name in full says nothing — applied to senses instead
// of edges.
const IDENTITY_MAX_CLASSES = 2;
// A background line's far side, when this many terms in the sub-graph already
// fall under it, names a category rather than anything about this card:
// "france is related to place" is true of most of the graph. The hub's own
// identity clause is exempt — a crowded class is still this thing's own kind,
// and "france is a country" is the most useful line a card can carry.
const CATEGORY_FAN_MAX = 3;
// How many background rows the "what the graph already knew" disclosure names.
// The paragraph itself shows the first KNOWN_FACT_SENTENCE_CAP groups of these.
const KNOWN_FACT_ROW_LIMIT = 6;

/** Three fan-out readings of the identity rows inside one card's sub-graph.
 *  `senseFan` counts every class a term is said to BE, the entailment closure
 *  included — high means the graph reads the term across senses, which is what
 *  makes a common noun a poor subject for a card about one event.
 *  `sourcedSenseFan` counts only the classes something actually stated, which
 *  is what a printed "X is a Y" clause may draw on. `categoryFan` counts the
 *  distinct terms said to fall UNDER a term — high means a category node, the
 *  same reading the neighbourhood's own link-term test makes. All three are
 *  pure counts over the rows handed in, so a card's own sub-graph decides and
 *  no global blocklist is involved. */
function identityFans(subgraphRows) {
  const senseFan = new Map();
  const sourcedSenseFan = new Map();
  const membersByClass = new Map();
  for (const row of subgraphRows) {
    if (!IDENTITY_PREDICATES.has(row.predicate)) continue;
    const s = normFactTerm(row.subject);
    const o = normFactTerm(row.object);
    if (!s || !o) continue;
    senseFan.set(s, (senseFan.get(s) || 0) + 1);
    if (!isDerivedRow(row)) sourcedSenseFan.set(s, (sourcedSenseFan.get(s) || 0) + 1);
    let members = membersByClass.get(o);
    if (!members) membersByClass.set(o, (members = new Set()));
    members.add(s);
  }
  const categoryFan = new Map();
  for (const [term, members] of membersByClass) categoryFan.set(term, members.size);
  return { senseFan, sourcedSenseFan, categoryFan };
}

/** What this card is ABOUT: its hub, the place-name halves of a hub the source
 *  spelled "settlement, region", and the other terms its own report sentences
 *  name — minus any of those that reads across senses. A quake card's report
 *  names "earthquake" and a place; the class term is where the graph's
 *  knowledge is thinnest and its senses widest, so background drawn through it
 *  is background about earthquakes in general, never about this quake. The hub
 *  itself is always in, whatever its sense count — the card is about it. */
function cardSubjectTerms(hub, subgraphRows, { reportedIds = null, senseFan }) {
  const hubTerm = normFactTerm(hub);
  const isReported = idMembership(reportedIds);
  const terms = new Set(hubSeedTerms(hubTerm));
  for (const row of hubReportRows(hubTerm, subgraphRows, { reportedIds })) {
    if (!isReported(row.id)) continue;
    for (const raw of [row.subject, row.object]) {
      const term = normFactTerm(raw);
      if (!term || terms.has(term) || STOP_SET.has(term)) continue;
      if ((senseFan.get(term) || 0) > IDENTITY_MAX_CLASSES) continue;
      terms.add(term);
    }
  }
  return terms;
}

/** The background rows worth telling a reader about, ranked: a row touching
 *  one of this card's own subject terms, whose other side is not a category
 *  node, and — for an identity row — whose subject is not read across senses.
 *  Ranks the hub's own rows first, then by how specific the other side is,
 *  then by content-addressed id, so the same fact set always yields the same
 *  lines in the same order. */
export function knownFactRows(hub, subgraphRows, { reportedIds = null, limit = KNOWN_FACT_ROW_LIMIT } = {}) {
  const hubTerm = normFactTerm(hub);
  const isReported = idMembership(reportedIds);
  const { senseFan, sourcedSenseFan, categoryFan } = identityFans(subgraphRows);
  const subjects = cardSubjectTerms(hub, subgraphRows, { reportedIds, senseFan });
  const neighbourIds = new Set(neighbourRows(hub, subgraphRows, { reportedIds }).map((r) => r.id));

  const scored = [];
  for (const row of subgraphRows) {
    if (isReported(row.id) || neighbourIds.has(row.id) || isDerivedRow(row)) continue;
    const s = normFactTerm(row.subject);
    const o = normFactTerm(row.object);
    if (!s || !o || s === o) continue;
    const anchorIsSubject = subjects.has(s);
    if (!anchorIsSubject && !subjects.has(o)) continue;
    const anchor = anchorIsSubject ? s : o;
    const other = anchorIsSubject ? o : s;
    if (IDENTITY_PREDICATES.has(row.predicate)) {
      // What the hub itself IS belongs to the identity clause and is said once.
      if (s === hubTerm) continue;
      if ((sourcedSenseFan.get(s) || 0) > IDENTITY_MAX_CLASSES) continue;
    }
    if ((categoryFan.get(other) || 0) > CATEGORY_FAN_MAX) continue;
    scored.push({
      row,
      anchorIsHub: anchor === hubTerm,
      otherCategoryFan: categoryFan.get(other) || 0,
      otherSenseFan: senseFan.get(other) || 0,
    });
  }

  return scored
    .sort((a, b) => (Number(b.anchorIsHub) - Number(a.anchorIsHub))
      || (a.otherCategoryFan - b.otherCategoryFan)
      || (a.otherSenseFan - b.otherSenseFan)
      || byId(a.row, b.row))
    .slice(0, limit)
    .map((entry) => entry.row);
}

function joinObjects(objects) {
  if (objects.length <= OBJECTS_PER_SENTENCE) return joinWithAnd(objects);
  const shown = objects.slice(0, OBJECTS_PER_SENTENCE);
  return `${shown.join(", ")} and ${objects.length - OBJECTS_PER_SENTENCE} more`;
}

/** The predicates `rows` carry, curated-table order first and then whatever
 *  is left, sorted. A relation minted from a source's own verb ("mgx:hit",
 *  "mgx:strike-near") has no curated entry, and reading the table alone left
 *  every card built from live headlines with an empty paragraph. */
function predicatesInRenderOrder(rows) {
  const present = new Set(rows.map((r) => r.predicate));
  const curated = Object.keys(FACT_PREDICATE_PHRASES).filter((predicate) => present.has(predicate));
  const rest = [...present].filter((predicate) => !Object.hasOwn(FACT_PREDICATE_PHRASES, predicate)).sort();
  return [...curated, ...rest];
}

/** One sentence per (subject, predicate) group over `rows`, in the order the
 *  rows arrive — the same shape the hub's own relation sentences take, so a
 *  background line reads like the rest of the paragraph rather than a dump. */
function groupedFactSentences(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.subject} ${row.predicate}`;
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { subject: row.subject, predicate: row.predicate, objects: [] }));
    group.objects.push(row.object);
  }
  return [...groups.values()].map(({ subject, predicate, objects }) => {
    const sorted = [...objects].sort();
    const rendered = IDENTITY_PREDICATES.has(predicate)
      ? sorted.map((object) => `${articleFor(object)} ${object}`)
      : sorted;
    return `${subject} ${predicatePhrase(predicate, subject)} ${joinObjects(rendered)}`;
  });
}

/** The sentences a card's paragraph is made of, as four ordered blocks: the
 *  report (what a source said inside the window), the identity clause, the
 *  related facts the graph already held, and the neighbourhood. Callers that
 *  render only one block — the "what the graph already knew" disclosure —
 *  read the block they want instead of re-deriving it. */
function paragraphBlocks(hub, subgraphRows, { reportedIds = null } = {}) {
  const hubTerm = normFactTerm(hub);
  const isReported = idMembership(reportedIds);
  const hubRows = subgraphRows.filter((r) => normFactTerm(r.subject) === hubTerm);
  const reportedHubRows = hubRows.filter((r) => isReported(r.id));
  const report = [];
  for (const predicate of predicatesInRenderOrder(reportedHubRows)) {
    if (IDENTITY_PREDICATES.has(predicate) || report.length >= REPORT_SENTENCE_CAP) continue;
    const objects = reportedHubRows
      .filter((r) => r.predicate === predicate)
      .map((r) => r.object)
      .sort();
    if (!objects.length) continue;
    report.push(`${hub} ${predicatePhrase(predicate, hub)} ${joinObjects(objects)}`);
  }

  // A hub that only ever appears as an OBJECT — the place a quake struck, the
  // story a site discussed — has no subject-side row to build a sentence from,
  // and its card came out blank. What was reported about it still says
  // something, so those rows render whole, subject and all.
  if (!report.length) {
    const aboutHub = subgraphRows
      .filter((r) => normFactTerm(r.object) === hubTerm && normFactTerm(r.subject) !== hubTerm && isReported(r.id))
      .sort(byId)
      .slice(0, OBJECTS_PER_SENTENCE)
      .map((r) => factSentence(r));
    if (aboutHub.length) report.push(aboutHub.join("; "));
  }

  // The identity clause follows the news, never leads it, and only when
  // something actually stated the hub's kind in one sense. The entailment
  // closure names thirteen classes for "france" — a list nobody asked for,
  // most of it the wrong sense — so it opens no card.
  const identity = [];
  const identityObjects = hubRows
    .filter((r) => IDENTITY_PREDICATES.has(r.predicate) && !isDerivedRow(r))
    .map((r) => r.object)
    .sort();
  const identityIsSingleSense = identityObjects.length > 0 && identityObjects.length <= IDENTITY_MAX_CLASSES;
  if (identityIsSingleSense) {
    identity.push(`${hub} is ${joinObjects(identityObjects.map((object) => `${articleFor(object)} ${object}`))}`);
  }

  const known = groupedFactSentences(knownFactRows(hub, subgraphRows, { reportedIds }));

  const neighbours = neighbourRows(hub, subgraphRows, { reportedIds });
  const around = neighbours.length ? [`Around it: ${neighbours.map((r) => factSentence(r)).join("; ")}`] : [];

  return { report, identity, known, around };
}

/** A card's paragraph: what a source reported, then what the thing is, then
 *  the related facts the graph already held about it, then its own
 *  neighbourhood (neighbourRows). Every sentence shown is a grounded fact,
 *  never a paraphrase of prose the grammar could not read, and the news always
 *  leads.
 *
 *  `reportedIds` (PLAN_NEWS_FEED.md section 17.4), when given, splits the rows
 *  into what was reported (the lead sentences) and what the graph already held
 *  (the background ones). Defaults to null, meaning every row counts as
 *  reported. */
export function renderNewsParagraph(hub, subgraphRows, { reportedIds = null } = {}) {
  const { report, identity, known, around } = paragraphBlocks(hub, subgraphRows, { reportedIds });
  const sentences = [
    ...report,
    ...identity.slice(0, IDENTITY_SENTENCE_CAP),
    ...known.slice(0, KNOWN_FACT_SENTENCE_CAP),
    ...around,
  ].slice(0, SENTENCE_CAP);
  return sentences.length ? `${sentences.join(". ")}.` : "";
}

/** The "what the graph already knew" disclosure: the same related facts the
 *  paragraph leads with, at the disclosure's own fuller depth, and nothing the
 *  card already reported. Empty when the graph held nothing about this card's
 *  own subjects — a card with no background says so rather than filling the
 *  space with whatever the two-hop walk happened to reach. */
export function renderKnownFactsParagraph(hub, subgraphRows, { reportedIds = null } = {}) {
  const sentences = groupedFactSentences(knownFactRows(hub, subgraphRows, { reportedIds }));
  return sentences.length ? `${sentences.join(". ")}.` : "";
}

/** newsworthyHubs -> one item per hub (PLAN_NEWS_FEED.md section 6.6),
 *  paragraph included, sorted builtAt desc then id asc. `sourcesByFactId`
 *  maps fact ids to snapshot source links ({ title, url, name, publishedAt?
 *  }); publishedAt is present only when the source snapshot carried one.
 *  The gate (PLAN_NEWS_FEED.md section 17): `reportedRows` replaces `newsWindowRows`
 *  and `newsworthyHubs` replaces `scoreHubs` as this function's own inputs —
 *  both keep their prior behaviour for every other caller. Each item's
 *  two-hop sub-graph then splits into its own `reported`/`background` rows:
 *  the report leads the paragraph, the related background follows it, and
 *  `backgroundParagraph` names that background at its own fuller depth for the
 *  card's disclosure.
 *
 *  A card attributes a source to the rows it reports (hubReportRows) and to
 *  nothing else. The two-hop walk reaches every row a shared class node
 *  touches, so attributing the whole sub-graph gave one quake's card all 44 of
 *  the day's quake headlines. An "Around it" neighbour is context the card
 *  borrows, and it carries its own citation on its own card. */
export function buildNewsItems(rows, { now, windowMs, limit = 6, sourcesByFactId = new Map(), readsAsEntityTerm } = {}) {
  const reported = reportedRows(rows, { now, windowMs });
  const reportedIds = new Set(reported.map((r) => r.id));
  const adjacency = buildTermAdjacency(rows);
  const prior = priorTerms(rows);
  const hubOptions = { now, windowMs, limit, adjacency, prior };
  if (readsAsEntityTerm) hubOptions.readsAsEntityTerm = readsAsEntityTerm;
  const hubs = newsworthyHubs(rows, reported, hubOptions);
  const items = hubs.map(({ term, changed }) => {
    const subgraphRows = subgraphAround(rows, term, {
      adjacency, priorityIds: reportedIds, seedTerms: hubSeedTerms(term),
    });
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
      sources: collectSources(hubReportRows(term, subgraphRows, { reportedIds }), sourcesByFactId),
      background: background.map((r) => r.id).sort(),
      backgroundParagraph: renderKnownFactsParagraph(term, subgraphRows, { reportedIds }),
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
