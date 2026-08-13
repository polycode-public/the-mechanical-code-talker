// news-feed.mjs — from fact rows plus `now`, choose hubs, cut two-hop
// sub-graphs, assemble news items, and render the fixed paraphrase paragraph
// (PLAN_NEWS_FEED.md sections 8.2-8.3). Pure throughout: no clock, no I/O, no
// reliance on the caller's row order — feeding one fact set in two different
// orders yields byte-identical items, the same discipline p2p-room.mjs's
// sortFactIndividualsById holds for a CRDT-merged fact set.

import { sha256Bytes, normFactTerm } from "./hash.mjs";
import { FACT_PREDICATE_PHRASES, predicatePhrase, predicateVerb, factSentence } from "./fact-phrase.mjs";
import { STOP_SET } from "./hub-terms.mjs";
import { articleFor } from "./digest/words.mjs";
import { provenanceTagToSource } from "./memory/trust.mjs";
import { buildSenseScope } from "./sense-scope.mjs";

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
// Attributions: who a report said its claim came from.
// ---------------------------------------------------------------------------

// A reified attribution names its claim by that claim's own group id, so its
// subject is "fact:" and sixteen hex — normFactTerm's own carve-out shape, and
// nothing a source ever writes as a term.
const FACT_REFERENCE_TERM_RE = /^fact:[0-9a-f]{16}$/;

const namesAFactRow = (term) => FACT_REFERENCE_TERM_RE.test(String(term ?? "").trim().toLowerCase());

/** The fact `row` is ABOUT, when either of its sides names one rather than a
 *  thing, else "". */
function referencedFactId(row) {
  const subject = String(row?.subject ?? "").trim().toLowerCase();
  if (namesAFactRow(subject)) return subject;
  const object = String(row?.object ?? "").trim().toLowerCase();
  return namesAFactRow(object) ? object : "";
}

/** True when `row` is about another row rather than about the world. Every card
 *  lane scores, walks and prints terms, and `looksLikeEntityTerm` reads a bare
 *  `fact:285cf1618315591b` as a perfectly good one-word name, so a row like this
 *  loose in a lane can head a card with a hex id. */
export function isFactReferenceRow(row) {
  return Boolean(referencedFactId(row));
}

const ATTRIBUTED_TO_PREDICATE = "mgx:attributedTo";

/** Splits a fact set once, at the door: the claims a card may read, and the
 *  speakers each claim was attributed to (claim group id -> speaker[], sorted).
 *  Everything downstream — the hub gate, the adjacency index, the walk, the
 *  sentences, a card's own `factIds` — takes `claims`, so an attribution reaches
 *  no lane at all and the suppression cannot be missed one lane at a time.
 *
 *  Pure and order-independent: one claim's speakers come back in the same sorted
 *  order whichever order the attributions arrived in, and a claim the fact set
 *  never names simply has no entry — an attribution can arrive before its claim,
 *  after it, or without it. */
export function partitionAttributions(rows) {
  const claims = [];
  const named = new Map();
  for (const row of rows) {
    if (!isFactReferenceRow(row)) {
      claims.push(row);
      continue;
    }
    if (row.predicate !== ATTRIBUTED_TO_PREDICATE) continue;
    const claimId = String(row.subject ?? "").trim().toLowerCase();
    const speaker = String(row.object ?? "").trim();
    if (!claimId || !speaker) continue;
    let speakers = named.get(claimId);
    if (!speakers) named.set(claimId, (speakers = new Set()));
    speakers.add(speaker);
  }
  const speakersByClaimId = new Map();
  for (const [claimId, speakers] of named) speakersByClaimId.set(claimId, [...speakers].sort());
  return { claims, speakersByClaimId };
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

// A name is one noun phrase, so a word that opens a new phrase or clause
// BETWEEN a term's first and last word marks a headline a frame tore into
// subject + predicate + remainder ("colombia as rescuers free quake victim").
// Mirrors extract-facts.mjs's INTERIOR_CLAUSE_WORDS, for the same reason the
// sets above mirror their originals. "of" stays out: real names are built with
// it ("house of representatives").
// A term the source itself wrapped in quotation marks is a title it quoted, and
// a title is free to read as a clause. Mirrors extract-facts.mjs's own
// QUOTED_TERM_RE, and exempts the interior rule alone.
const ENTITY_QUOTED_TERM_RE = /^["“'‘].*["”'’]$/;
const ENTITY_INTERIOR_CLAUSE_WORDS = new Set([
  "a", "an", "the",
  "and", "or", "but", "because", "since", "although", "though", "whereas", "while", "so",
  "if", "when", "then", "however", "as", "that", "which", "who", "whom", "whose",
  "is", "are", "was", "were", "be", "been", "being", "am", "has", "have", "had",
  "do", "does", "did", "can", "could", "will", "would", "should", "may", "might", "must",
  "in", "on", "at", "for", "to", "with", "from", "by", "into", "onto",
  "over", "under", "after", "before", "between", "during", "about", "near", "through",
  "against", "among", "within", "without", "per",
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
  if (!ENTITY_QUOTED_TERM_RE.test(`${words[0]} ${words[words.length - 1]}`)) {
    for (let i = 1; i < words.length - 1; i += 1) {
      if (ENTITY_INTERIOR_CLAUSE_WORDS.has(words[i].toLowerCase())) return false;
    }
  }
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
 *  widens only what the card can draw background from.
 *
 *  `excludeIds` drops rows before the cap rather than after it, so a card that
 *  gives a report away to another card (storyCoverage) spends the freed budget
 *  on rows it will actually show.
 *
 *  `inSense` is the same-sense discipline (sense-scope.mjs): a `(term) =>
 *  boolean` test the walk applies to every term that is not a seed. A term it
 *  refuses collects no row and joins no frontier, so the walk stays inside the
 *  seeds' own sense instead of climbing a shared class node and coming back
 *  down another meaning of it. What a source actually REPORTED about a seed is
 *  exempt: a card never drops its own news to keep a sense tidy. */
export function subgraphAround(rows, hub, {
  hops = NEWS_HUB_HOPS, cap = 60, adjacency = null, priorityIds = null, seedTerms = null,
  excludeIds = null, inSense = null,
} = {}) {
  const adj = adjacency ?? buildTermAdjacency(rows);
  const hubTerm = normFactTerm(hub);
  const seeds = (seedTerms?.length ? seedTerms : [hubTerm]).map((t) => normFactTerm(t)).filter(Boolean);
  const visited = new Set(seeds);
  const seedSet = new Set(seeds);
  let frontier = [...new Set(seeds)].sort();
  const collected = new Map();
  const hopOf = new Map();
  const isExcluded = excludeIds instanceof Set ? (id) => excludeIds.has(id) : () => false;
  const isPriority = (id) => (priorityIds instanceof Set ? priorityIds.has(id) : Boolean(priorityIds?.includes?.(id)));
  const inScope = typeof inSense === "function" ? (term) => seedSet.has(term) || inSense(term) : () => true;
  for (let hop = 0; hop < hops; hop += 1) {
    const nextFrontier = new Set();
    for (const term of [...frontier].sort()) {
      for (const idx of adj.byTerm.get(term) ?? []) {
        const row = rows[idx];
        if (isExcluded(row.id)) continue;
        const [s, o] = adj.terms[idx];
        const staysInSense = inScope(s) && inScope(o);
        const isOwnReport = isPriority(row.id) && (seedSet.has(s) || seedSet.has(o));
        if (!staysInSense && !isOwnReport) continue;
        collected.set(row.id, row);
        if (!hopOf.has(row.id)) hopOf.set(row.id, hop);
        if (!visited.has(s) && inScope(s)) nextFrontier.add(s);
        if (!visited.has(o) && inScope(o)) nextFrontier.add(o);
      }
    }
    for (const term of nextFrontier) visited.add(term);
    frontier = [...nextFrontier].sort();
  }
  return [...collected.values()]
    .sort((a, b) => (isPriority(b.id) - isPriority(a.id))
      || (hopOf.get(a.id) - hopOf.get(b.id))
      || byId(a, b))
    .slice(0, cap);
}

// How far the walk goes from an entity the ARTICLE names rather than a fact,
// and how many rows it may bring back. One hop: what the graph says about that
// entity itself, never what it says about everything that entity touches. The
// hub's own two-hop walk is unchanged; this one runs beside it.
const ARTICLE_ENTITY_HOPS = 1;
const ARTICLE_ENTITY_ROW_CAP = 24;

/** The rows sitting one hop from an entity the card's article names. Seeded
 *  from `terms` rather than the hub, so a definition the graph holds about a
 *  name inside the headline reaches the card even when no fact of the card's
 *  own touches that name — "amigados is a disk operating system" beside a
 *  report whose only fact is that a site discussed the headline.
 *
 *  `excludeIds` carries the card's reported rows as well as the ones another
 *  card claimed, so this walk returns background and nothing else: what a
 *  source reported is the hub walk's business. */
export function articleEntityRows(rows, terms, {
  adjacency = null, excludeIds = null, cap = ARTICLE_ENTITY_ROW_CAP, inSense = null,
} = {}) {
  const seedTerms = (terms || []).map((term) => normFactTerm(term)).filter(Boolean);
  if (!seedTerms.length) return [];
  return subgraphAround(rows, seedTerms[0], {
    hops: ARTICLE_ENTITY_HOPS, cap, adjacency, seedTerms, excludeIds, inSense,
  });
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

/** The speakers `speakersByClaimId` attributes to `rows`, deduped and sorted.
 *  Empty for rows nothing attributed, which is every row until a report stores
 *  one. */
function speakersFor(rows, speakersByClaimId) {
  if (!(speakersByClaimId instanceof Map) || !speakersByClaimId.size) return [];
  const named = new Set();
  for (const row of rows) {
    for (const speaker of speakersByClaimId.get(row.id) ?? []) named.add(speaker);
  }
  return [...named].sort();
}

/** ", president trump said" — the article's own construction, folded onto the
 *  end of the claim's own sentence rather than printed as apparatus beside it. */
function speakerClause(speakers) {
  return speakers.length ? `, ${joinWithAnd(speakers)} said` : "";
}

/** One row's whole sentence with its own speaker folded in. */
function attributedFactSentence(row, speakersByClaimId) {
  return `${factSentence(row)}${speakerClause(speakersFor([row], speakersByClaimId))}`;
}

/** The speaker clause a GROUPED sentence may carry. One sentence stands for
 *  several rows, so the clause is only true where the attributed rows among them
 *  already name every object the sentence prints. A group whose UNattributed row
 *  brings an object of its own would put that object in a speaker's mouth, so
 *  the clause drops whole rather than narrowing to a sentence it no longer
 *  describes. */
function groupSpeakerClause(rows, printedObjects, speakersByClaimId) {
  if (!(speakersByClaimId instanceof Map) || !speakersByClaimId.size) return "";
  const named = new Set();
  const spokenObjects = new Set();
  for (const row of rows) {
    const speakers = speakersByClaimId.get(row.id);
    if (!speakers?.length) continue;
    for (const speaker of speakers) named.add(speaker);
    spokenObjects.add(row.object);
  }
  if (!named.size) return "";
  if (!printedObjects.every((object) => spokenObjects.has(object))) return "";
  return speakerClause([...named].sort());
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

// Two report rows on one card can state ONE act under two words: a headline
// says a prisoner was "freed", the description says "released", and the graph
// is right to hold both edges because two different sentences really said so.
// The card is the thing that should say it once.
//
// The fold is here, at assembly, and NOT at extraction, because only here is
// the whole row set in view. Extraction reads one verb at a time, and folding
// "free" onto "release" there turned "rescuers free quake victim" into a jail
// delivery: the two senses of "free" split on the subject's kind, an open set,
// and a headline carries nothing to tell them apart. A card folds only where
// BOTH verbs already stand over the SAME subject naming the SAME people, which
// is the evidence extraction never had. A rescue card carries "free" alone, so
// nothing folds and it still reads as a rescue.
//
// The bar for a pair is that the two words name one act wherever a card can
// hold both. Verbs that merely share a subject and an object stay apart,
// opposites first among them: "russia detains X" and "russia releases X" are
// two claims about one prisoner, they are in no group together, and each keeps
// its own sentence.
const ONE_ACT_VERB_GROUPS = [
  ["free", "release"],
];
const ONE_ACT_CANONICAL_VERB = new Map(
  ONE_ACT_VERB_GROUPS.flatMap((group) => group.map((verb) => [verb, group[0]])),
);

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

// Where a background row's anchor term came from, and so which rows the
// disclosure names first: the card's own hub, then a term its report names,
// then an entity its article names that no fact of the card's own touches.
const ANCHOR_RANK_HUB = 0;
const ANCHOR_RANK_REPORT = 1;
const ANCHOR_RANK_ARTICLE = 2;

/** What this card is ABOUT, each term mapped to its anchor rank: its hub, the
 *  region of a hub the source spelled "settlement, region", the other terms its
 *  own report sentences name, and the entities its article names (`articleTerms`)
 *  — minus any of those that reads across senses. A quake card's report
 *  names "earthquake" and a place; the class term is where the graph's
 *  knowledge is thinnest and its senses widest, so background drawn through it
 *  is background about earthquakes in general, never about this quake. The hub
 *  itself is always in, whatever its sense count — the card is about it.
 *
 *  An article entity earns the same reading a report term gets, one rank
 *  behind it: the story's own words name it, but no fact the card reports
 *  does. */
function cardSubjectTerms(hub, subgraphRows, { reportedIds = null, senseFan, articleTerms = [] }) {
  const hubTerm = normFactTerm(hub);
  const isReported = idMembership(reportedIds);
  const terms = new Map();
  for (const seed of hubSeedTerms(hubTerm)) terms.set(seed, ANCHOR_RANK_HUB);
  const admit = (raw, rank) => {
    const term = normFactTerm(raw);
    if (!term || terms.has(term) || STOP_SET.has(term)) return;
    if ((senseFan.get(term) || 0) > IDENTITY_MAX_CLASSES) return;
    terms.set(term, rank);
  };
  for (const row of hubReportRows(hubTerm, subgraphRows, { reportedIds })) {
    if (!isReported(row.id)) continue;
    for (const raw of [row.subject, row.object]) admit(raw, ANCHOR_RANK_REPORT);
  }
  for (const raw of articleTerms) admit(raw, ANCHOR_RANK_ARTICLE);
  return terms;
}

/** The background rows worth telling a reader about, ranked: a row touching
 *  one of this card's own subject terms, whose other side is not a category
 *  node, and — for an identity row — whose subject is not read across senses.
 *  Ranks the hub's own rows first, then the ones its report names, then the
 *  ones an entity in its article names, then by how specific the other side
 *  is, then by content-addressed id, so the same fact set always yields the
 *  same lines in the same order. */
export function knownFactRows(hub, subgraphRows, {
  reportedIds = null, limit = KNOWN_FACT_ROW_LIMIT, articleTerms = [],
} = {}) {
  const hubTerm = normFactTerm(hub);
  const isReported = idMembership(reportedIds);
  const { senseFan, sourcedSenseFan, categoryFan } = identityFans(subgraphRows);
  const subjects = cardSubjectTerms(hub, subgraphRows, { reportedIds, senseFan, articleTerms });
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
      anchorRank: subjects.get(anchor),
      otherCategoryFan: categoryFan.get(other) || 0,
      otherSenseFan: senseFan.get(other) || 0,
    });
  }

  return scored
    .sort((a, b) => (a.anchorRank - b.anchorRank)
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

/** The act a report predicate states, as the key two predicates share when
 *  they say it in one word: the predicate's verb lemma folded onto its group's
 *  canonical verb, with any particle beside it, so `tmct:releases` and
 *  `mgx:free` both read "release" while `mgx:strike-near` stays apart from
 *  `mgx:strike`. Empty for a predicate that states no act at all (an identity
 *  row, a comparative, a passive participle), which folds with nothing. */
function oneActKey(predicate) {
  const verb = predicateVerb(predicate);
  if (!verb) return "";
  return `${ONE_ACT_CANONICAL_VERB.get(verb.lemma) ?? verb.lemma} ${verb.particle}`;
}

/** One sentence per (subject, predicate) group over `rows`, in the order the
 *  rows arrive — the same shape the hub's own relation sentences take, so a
 *  background line reads like the rest of the paragraph rather than a dump.
 *  Each entry carries the group's own rows alongside its text, so a caller
 *  that needs to know which facts a sentence came from (the bench's noisy-
 *  line scoring) reads them off the same grouping the sentence itself used,
 *  never a second derivation of it. */
function groupedFactSentenceEntries(rows, speakersByClaimId = null) {
  const groups = new Map();
  for (const row of rows) {
    const key = `${row.subject} ${row.predicate}`;
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { subject: row.subject, predicate: row.predicate, objects: [], rows: [] }));
    group.objects.push(row.object);
    group.rows.push(row);
  }
  return [...groups.values()].map(({ subject, predicate, objects, rows: groupRows }) => {
    const sorted = [...objects].sort();
    // "rdf:type" reads "is a" from the curated phrase table, which is the wrong
    // article before a vowel and a second one in front of an object articleFor
    // has already spelled. The identity clause the paragraph opens with says a
    // bare "is" and lets articleFor choose; a background line says it the same
    // way. Every other predicate, "is a kind of" included, carries whatever
    // article it needs inside its own phrase and takes the object bare.
    const text = predicate === "rdf:type"
      ? `${subject} is ${joinObjects(sorted.map((object) => `${articleFor(object)} ${object}`))}`
      : `${subject} ${predicatePhrase(predicate, subject)} ${joinObjects(sorted)}`;
    return { text: `${text}${groupSpeakerClause(groupRows, sorted, speakersByClaimId)}`, rows: groupRows };
  });
}

function groupedFactSentences(rows, speakersByClaimId = null) {
  return groupedFactSentenceEntries(rows, speakersByClaimId).map((entry) => entry.text);
}

/** The sentences a card's paragraph is made of, as four ordered blocks: the
 *  report (what a source said inside the window), the identity clause, the
 *  related facts the graph already held, and the neighbourhood. Each entry is
 *  `{ text, rows }` — the rendered sentence and the fact row(s) it came from
 *  — so a caller that needs to know which facts actually reached the printed
 *  text (the bench's noisy-line scoring) reads them off the same blocks
 *  `renderNewsParagraph` itself slices, never a second derivation of it.
 *  Callers that render only one block — the "what the graph already knew"
 *  disclosure — read the block they want instead of re-deriving it. */
function paragraphBlocks(hub, subgraphRows, { reportedIds = null, articleTerms = [], speakersByClaimId = null } = {}) {
  const hubTerm = normFactTerm(hub);
  const isReported = idMembership(reportedIds);
  const hubRows = subgraphRows.filter((r) => normFactTerm(r.subject) === hubTerm);
  const reportedHubRows = hubRows.filter((r) => isReported(r.id));
  // Every sentence here shares the one subject, so the act key and the objects
  // are all that separate two of them. A predicate whose act a sentence above
  // it has already stated, over people that sentence already names, adds no
  // word a reader has not read — its rows join the sentence that says their
  // act, so a fact still counts as printed and the fold can lose nothing. A
  // predicate that brings a new name to the act keeps its own sentence.
  const reportGroups = [];
  const statedActs = new Map();
  for (const predicate of predicatesInRenderOrder(reportedHubRows)) {
    if (IDENTITY_PREDICATES.has(predicate) || reportGroups.length >= REPORT_SENTENCE_CAP) continue;
    const groupRows = reportedHubRows.filter((r) => r.predicate === predicate);
    const objects = groupRows.map((r) => r.object).sort();
    if (!objects.length) continue;
    const actKey = oneActKey(predicate);
    const stated = actKey ? statedActs.get(actKey) : null;
    if (stated && objects.every((object) => stated.objects.has(object))) {
      stated.group.rows.push(...groupRows);
      continue;
    }
    const group = { text: `${hub} ${predicatePhrase(predicate, hub)} ${joinObjects(objects)}`, rows: groupRows, objects };
    reportGroups.push(group);
    if (actKey && !stated) statedActs.set(actKey, { group, objects: new Set(objects) });
  }
  // The speaker is read off the whole group, once the fold above has finished
  // moving rows into it — the row an article attributed is often the FOLDED one,
  // not the row whose words the sentence ended up wearing.
  const report = reportGroups.map(({ text, rows: groupRows, objects }) => ({
    text: `${text}${groupSpeakerClause(groupRows, objects, speakersByClaimId)}`,
    rows: groupRows,
  }));

  // A hub that only ever appears as an OBJECT — the place a quake struck, the
  // story a site discussed — has no subject-side row to build a sentence from,
  // and its card came out blank. What was reported about it still says
  // something, so those rows render whole, subject and all.
  if (!report.length) {
    const aboutHubRows = subgraphRows
      .filter((r) => normFactTerm(r.object) === hubTerm && normFactTerm(r.subject) !== hubTerm && isReported(r.id))
      .sort(byId)
      .slice(0, OBJECTS_PER_SENTENCE);
    if (aboutHubRows.length) {
      report.push({
        text: aboutHubRows.map((r) => attributedFactSentence(r, speakersByClaimId)).join("; "),
        rows: aboutHubRows,
      });
    }
  }

  // The identity clause follows the news, never leads it, and only when
  // something actually stated the hub's kind in one sense. The entailment
  // closure names thirteen classes for "france" — a list nobody asked for,
  // most of it the wrong sense — so it opens no card.
  const identity = [];
  const identityRows = hubRows.filter((r) => IDENTITY_PREDICATES.has(r.predicate) && !isDerivedRow(r));
  const identityObjects = identityRows.map((r) => r.object).sort();
  const identityIsSingleSense = identityObjects.length > 0 && identityObjects.length <= IDENTITY_MAX_CLASSES;
  if (identityIsSingleSense) {
    const said = groupSpeakerClause(identityRows, identityObjects, speakersByClaimId);
    identity.push({
      text: `${hub} is ${joinObjects(identityObjects.map((object) => `${articleFor(object)} ${object}`))}${said}`,
      rows: identityRows,
    });
  }

  const known = groupedFactSentenceEntries(
    knownFactRows(hub, subgraphRows, { reportedIds, articleTerms }),
    speakersByClaimId,
  );

  const neighbours = neighbourRows(hub, subgraphRows, { reportedIds });
  const around = neighbours.length
    ? [{
      text: `Around it: ${neighbours.map((r) => attributedFactSentence(r, speakersByClaimId)).join("; ")}`,
      rows: neighbours,
    }]
    : [];

  return { report, identity, known, around };
}

/** The paragraph's own sentence entries (`{ text, rows }`), in print order and
 *  sliced to exactly what `renderNewsParagraph` shows — the per-block caps
 *  (identity, known) and the paragraph-wide `SENTENCE_CAP` both applied.
 *  Shared by `renderNewsParagraph` and `printedParagraphRows` so the two can
 *  never drift: one reads `.text`, the other reads `.rows`. */
function paragraphSentenceEntries(hub, subgraphRows, { reportedIds = null, articleTerms = [], speakersByClaimId = null } = {}) {
  const { report, identity, known, around } = paragraphBlocks(hub, subgraphRows, { reportedIds, articleTerms, speakersByClaimId });
  return [
    ...report,
    ...identity.slice(0, IDENTITY_SENTENCE_CAP),
    ...known.slice(0, KNOWN_FACT_SENTENCE_CAP),
    ...around,
  ].slice(0, SENTENCE_CAP);
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
export function renderNewsParagraph(hub, subgraphRows, { reportedIds = null, articleTerms = [], speakersByClaimId = null } = {}) {
  const sentences = paragraphSentenceEntries(hub, subgraphRows, { reportedIds, articleTerms, speakersByClaimId })
    .map((entry) => entry.text);
  return sentences.length ? `${sentences.join(". ")}.` : "";
}

/** Every fact row that survives into the card's rendered main paragraph —
 *  the same rows `renderNewsParagraph` drew its sentences from, after every
 *  cap it applies (per-block and the paragraph-wide `SENTENCE_CAP`). A row
 *  computed but sliced away before render (an "Around it" clause cut by the
 *  overall cap, an identity class beyond `IDENTITY_MAX_CLASSES`) never
 *  appears here, because it never appears on the card either. */
export function printedParagraphRows(hub, subgraphRows, { reportedIds = null, articleTerms = [], speakersByClaimId = null } = {}) {
  return paragraphSentenceEntries(hub, subgraphRows, { reportedIds, articleTerms, speakersByClaimId })
    .flatMap((entry) => entry.rows);
}

/** The "what the graph already knew" disclosure: the same related facts the
 *  paragraph leads with, at the disclosure's own fuller depth, and nothing the
 *  card already reported. Empty when the graph held nothing about this card's
 *  own subjects — a card with no background says so rather than filling the
 *  space with whatever the two-hop walk happened to reach. */
export function renderKnownFactsParagraph(hub, subgraphRows, { reportedIds = null, articleTerms = [], speakersByClaimId = null } = {}) {
  const sentences = groupedFactSentences(
    knownFactRows(hub, subgraphRows, { reportedIds, articleTerms }),
    speakersByClaimId,
  );
  return sentences.length ? `${sentences.join(". ")}.` : "";
}

// ---------------------------------------------------------------------------
// What a card says beyond its own headline.
// ---------------------------------------------------------------------------

// Two spellings of one headline — the source's own capitals and punctuation,
// and the quoted, lower-cased form a fact's object carries — fold to the same
// key, so the comparison answers to the words alone.
const HEADLINE_NOISE_RE = /[^a-z0-9]+/g;

const headlineKey = (text) => String(text ?? "").toLowerCase().replace(HEADLINE_NOISE_RE, " ").trim();

/** Every term this card is about: its hub, whatever its own reports name, and
 *  the entities its article names. Deliberately looser than
 *  `cardSubjectTerms` — that one picks what a SENTENCE may draw on, and drops
 *  a term the graph reads across senses; this one asks the plainer question of
 *  what the card is about at all, which is what a count of held background
 *  answers to. */
function cardAboutTerms(hub, reports, articleTerms) {
  const terms = new Set(hubSeedTerms(normFactTerm(hub)));
  for (const row of reports) {
    for (const raw of [row.subject, row.object]) {
      const term = normFactTerm(raw);
      if (term) terms.add(term);
    }
  }
  for (const raw of articleTerms) {
    const term = normFactTerm(raw);
    if (term) terms.add(term);
  }
  return terms;
}

/** What one card is carrying, and the reason a feed puts one card above
 *  another.
 *
 *  `claims` are the card's own reports (`hubReportRows`) that say something
 *  about the world. `headlineMentions` are its own reports whose object IS one
 *  of its headlines — "hackernews discuss <that headline>", a true fact that
 *  tells a reader nothing the card's own quoted report already prints.
 *  `background` is what the graph holds about the terms the card is about:
 *  the rows behind its "what the graph already knew" lines, counted before the
 *  paragraph's own caps cut them, and never another card's report.
 *
 *  A source whose wire format carries no body can only ever mint headline
 *  mentions, so a card off one lands at zero on both counts unless a lookup
 *  attached something to a name in its headline. Those cards read last. They
 *  still build, still cite their source, and `thin` marks them so a reader or
 *  a bench run can count how many there were.
 *
 *  Pure over the rows and the headline strings. A card with no headlines to
 *  compare against (a caller that wired no sources) counts every report as a
 *  claim: nothing is demoted without the evidence to demote it. */
export function cardSubstance(hub, subgraphRows, { reportedIds = null, articleTerms = [], headlines = [] } = {}) {
  const isReported = idMembership(reportedIds);
  const ownHeadlines = new Set(headlines.map(headlineKey).filter(Boolean));

  const reports = hubReportRows(hub, subgraphRows, { reportedIds });
  let claims = 0;
  let headlineMentions = 0;
  for (const row of reports) {
    if (ownHeadlines.has(headlineKey(row.object))) headlineMentions += 1;
    else claims += 1;
  }

  const about = cardAboutTerms(hub, reports, articleTerms);
  let background = 0;
  for (const row of subgraphRows) {
    if (isReported(row.id) || isDerivedRow(row)) continue;
    if (about.has(normFactTerm(row.subject)) || about.has(normFactTerm(row.object))) background += 1;
  }

  return { claims, background, headlineMentions, thin: claims === 0 && background === 0 };
}

/** How a feed orders two cards once their build moment is equal: the one that
 *  reports more about the world first, then the one the graph holds more
 *  around, then id. Reports outrank background on purpose — a card leads with
 *  what a source said, and a hub whose common-noun object the seed graph
 *  happens to know hundreds of edges about does not outrank a card carrying
 *  more news. */
function bySubstance(a, b) {
  return (b.substance.claims - a.substance.claims) || (b.substance.background - a.substance.background);
}

// ---------------------------------------------------------------------------
// Which story a card tells, and what it is called.
// ---------------------------------------------------------------------------

// The item tag a news row carries, at whatever depth the ingest wrapper
// nested it ("news:<sourceId>@<itemId>", "optimistic-extract:news:…"), plus
// the fixture replay's own twin. Every sentence a card prints comes from a
// row, so which story a card is telling is readable from the fact set alone —
// no source map, no arrival order, no clock.
const NEWS_STORY_TAG_RE = /(?:^|:)news(?:-fixture)?:([^\s|]+)/;

/** The newsworthy item one row reported, or "" when its provenance names
 *  none. Pure. */
export function newsStoryKey(row) {
  return NEWS_STORY_TAG_RE.exec(String(row?.provenance || ""))?.[1] || "";
}

/** Every reported row touching each term, subject side or object side. Built
 *  once per feed assembly and shared, for the same reason buildTermAdjacency
 *  is. */
function reportedRowsByTerm(reported) {
  const byTerm = new Map();
  for (const row of reported) {
    for (const term of new Set([normFactTerm(row.subject), normFactTerm(row.object)])) {
      if (!term) continue;
      let rowsFor = byTerm.get(term);
      if (!rowsFor) byTerm.set(term, (rowsFor = []));
      rowsFor.push(row);
    }
  }
  return byTerm;
}

// How many stories a term's own reports must span before it stops being one
// story's subject. Two is enough: a term the day's second story also names is
// a publication, a wire desk or a class every item shares, and a card headed
// by one repeats whatever the per-story cards already said.
const PUBLICATION_STORY_MIN = 2;

/** How many distinct newsworthy items each term's own reports came from. */
function storyCountsByTerm(rowsByTerm) {
  const counts = new Map();
  for (const [term, rowsFor] of rowsByTerm) {
    const keys = new Set();
    for (const row of rowsFor) {
      const key = newsStoryKey(row);
      if (key) keys.add(key);
    }
    counts.set(term, keys.size);
  }
  return counts;
}

// The classes the graph's own identity rows use to say a thing is a place or
// a person. The same closed set the bench's entity-preservation metric reads
// off the seed, duplicated here (not imported) because the domain layer never
// imports a script.
const PLACE_OR_PERSON_CLASS_TERMS = new Set([
  "place", "person", "city", "country", "location", "nation", "continent",
  "capital", "state", "province", "town", "region",
]);

/** Every term the graph itself types as a place or a person, whoever stated
 *  the identity. A card prefers one of these for its own title: it is the
 *  thing the story is about, where a clause the same report threw off is only
 *  something that happened to it. Pure over `rows`. */
export function placeAndPersonTerms(rows) {
  const grounded = new Set();
  for (const row of rows) {
    if (row.predicate !== "rdf:type" && row.predicate !== "rdfs:subClassOf") continue;
    if (!PLACE_OR_PERSON_CLASS_TERMS.has(normFactTerm(row.object))) continue;
    const subject = normFactTerm(row.subject);
    if (subject) grounded.add(subject);
  }
  return grounded;
}

// A predicate minted from a source's own verb, lemma only: "mgx:hit",
// "mgx:discuss". The curated table's entries carry a capital ("mgx:partOf")
// and a folded preposition carries a hyphen ("mgx:strike-near"), and neither
// can be a single word inside a term, so neither belongs in the verb set.
const MINTED_VERB_PREDICATE_RE = /^mgx:([a-z]+)$/;

/** The verbs this window's own reports minted a predicate from. A term
 *  carrying one of them is a clause the extraction cut in half, and the graph
 *  says so itself rather than a hand-written verb list saying it. */
export function reportedVerbWords(reported) {
  const verbs = new Set();
  for (const row of reported) {
    const lemma = MINTED_VERB_PREDICATE_RE.exec(String(row.predicate || ""))?.[1];
    if (lemma) verbs.add(lemma);
  }
  return verbs;
}

// How many words a name runs to before it reads as a sentence about a thing
// rather than the thing's name. "south sandwich islands region" is a place;
// "boats hit by mystery attackers" is what happened to some.
const CLAUSE_TITLE_MAX_WORDS = 4;
const CLAUSE_WORD_EDGE_RE = /^[^a-z0-9]+|[^a-z0-9]+$/g;

/** Does `term` read as a clause rather than a name — longer than a name runs,
 *  or carrying one of the verbs the window's own reports minted? A clause
 *  never takes a card's title from a grounded entity term. */
export function readsAsClauseTerm(term, verbWords) {
  const words = String(term ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return false;
  if (words.length > CLAUSE_TITLE_MAX_WORDS) return true;
  const verbs = verbWords instanceof Set ? verbWords : new Set(verbWords || []);
  return words.some((word) => verbs.has(word.replace(CLAUSE_WORD_EDGE_RE, "")));
}

/** The term a card is titled and keyed by, given the hub the gate chose and
 *  the reported rows that hub sits in. In order:
 *
 *  1. the hub itself, when the graph already types it as a place or a person;
 *  2. a place/person term the hub's own reports name — "bali" over "sacred
 *     glow", "clacton" over "election";
 *  3. the subject those reports share, but only when the hub reads as a clause
 *     and only when that subject tells one story of its own — the publication
 *     every headline hangs off is never a card's name;
 *  4. the hub, unchanged.
 *
 *  Ties inside a step go to the term the reports name most, then alphabetical,
 *  so the same fact set always titles a card the same way. Nothing here invents
 *  a term: every candidate is already on one of the card's own rows. */
export function hubTitleTerm(hubTerm, hubRows, { placeOrPerson, verbWords, storyCountByTerm }) {
  if (placeOrPerson.has(hubTerm)) return hubTerm;

  const namesAThing = (term) => Boolean(term) && term !== hubTerm && !STOP_SET.has(term)
    && !isQuantityTerm(term) && looksLikeEntityTerm(term) && !readsAsClauseTerm(term, verbWords);

  const groundedCounts = new Map();
  const subjectCounts = new Map();
  for (const row of hubRows) {
    const subject = normFactTerm(row.subject);
    const object = normFactTerm(row.object);
    for (const term of new Set([subject, object])) {
      if (namesAThing(term) && placeOrPerson.has(term)) groundedCounts.set(term, (groundedCounts.get(term) || 0) + 1);
    }
    if (object !== hubTerm || !namesAThing(subject)) continue;
    if ((storyCountByTerm.get(subject) || 0) >= PUBLICATION_STORY_MIN) continue;
    subjectCounts.set(subject, (subjectCounts.get(subject) || 0) + 1);
  }

  const mostNamed = (counts) => [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))[0]?.[0] || "";

  return mostNamed(groundedCounts)
    || (readsAsClauseTerm(hubTerm, verbWords) ? mostNamed(subjectCounts) : "")
    || hubTerm;
}

/** True when a source spelled this term as a settlement and its region at once
 *  — "wana, pakistan", "mina, nevada". The source has already said which of a
 *  report's terms is the thing that happened somewhere, so the term reads as a
 *  place even where no identity row types it as one. hubSeedTerms holds the
 *  same reading for the walk. */
const namesASettlementAndRegion = (term) => hubSeedTerms(term).length > 1;

/** The gate's hubs retitled by hubTitleTerm, with two hubs that answer to the
 *  same name merged into one. Each keeps the two readings storyCoverage ranks
 *  cards by, taken on the title the card will actually wear. Keeps the gate's
 *  own sort — changed count desc, then term asc. */
function titledHubs(hubs, rows, reported, rowsByTerm) {
  const placeOrPerson = placeAndPersonTerms(rows);
  const verbWords = reportedVerbWords(reported);
  const storyCountByTerm = storyCountsByTerm(rowsByTerm);
  const changedByTitle = new Map();
  for (const { term, changed } of hubs) {
    const title = hubTitleTerm(term, rowsByTerm.get(term) || [], { placeOrPerson, verbWords, storyCountByTerm });
    const held = changedByTitle.get(title);
    if (held === undefined || changed > held) changedByTitle.set(title, changed);
  }
  return [...changedByTitle.entries()]
    .map(([term, changed]) => ({
      term,
      changed,
      namesAnEntity: placeOrPerson.has(term) || namesASettlementAndRegion(term),
      clauseShaped: readsAsClauseTerm(term, verbWords),
      reportSubject: (rowsByTerm.get(term) || []).some((row) => normFactTerm(row.subject) === term),
    }))
    .sort((a, b) => b.changed - a.changed || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0));
}

/** How a story picks between the cards that want to tell it. In order: the
 *  hub whose own reports span fewest stories, since a card about one story
 *  beats a publication's roundup of it; then the hub that names a place or a
 *  person, since that is what the story is about; then the hub that
 *  reads as a name rather than a clause; then the one the report puts on the
 *  subject side, the story's actor where the object is what happened to it;
 *  then the gate's own changed count; then the term itself, so the answer never
 *  comes down to arrival order. */
function byCardClaim(a, b) {
  return a.storyCount - b.storyCount
    || (Number(b.namesAnEntity) - Number(a.namesAnEntity))
    || (Number(a.clauseShaped) - Number(b.clauseShaped))
    || (Number(b.reportSubject) - Number(a.reportSubject))
    || (b.changed - a.changed)
    || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0);
}

/** Which stories each hub gets to tell, and which of its reports belong to
 *  another card. One story mints one card: the hubs bid for it in byCardClaim
 *  order and the first takes it, so a report that threw off both a subject hub
 *  and an object hub ("ukraine" beside "air war", "london" beside "glass")
 *  stops minting a card each. A hub left with no story of its own does not
 *  mint, and one that keeps some carries only those — the "hackernews" card
 *  that repeated both of the day's Hacker News cards wholesale is gone, and one
 *  that repeated three of four carries the fourth alone.
 *
 *  A row whose provenance names no story is never claimed and never dropped, so
 *  a hub built only from those still mints.
 *
 *  Returns hub term -> `{ mints, coveredRowIds }`. */
export function storyCoverage(hubs, rowsByTerm) {
  const rowIdsByStory = new Map();
  for (const { term } of hubs) {
    const byStory = new Map();
    for (const row of rowsByTerm.get(term) || []) {
      const key = newsStoryKey(row);
      if (!key) continue;
      let ids = byStory.get(key);
      if (!ids) byStory.set(key, (ids = []));
      ids.push(row.id);
    }
    rowIdsByStory.set(term, byStory);
  }

  const bidders = hubs
    .map((hub) => ({ ...hub, storyCount: rowIdsByStory.get(hub.term).size }))
    .sort(byCardClaim);

  const claimed = new Set();
  const coverage = new Map();
  for (const { term, storyCount } of bidders) {
    const stories = rowIdsByStory.get(term);
    const coveredRowIds = new Set();
    let ownStories = 0;
    for (const key of [...stories.keys()].sort()) {
      if (claimed.has(key)) {
        for (const id of stories.get(key)) coveredRowIds.add(id);
        continue;
      }
      claimed.add(key);
      ownStories += 1;
    }
    coverage.set(term, { mints: storyCount === 0 || ownStories > 0, coveredRowIds });
  }
  return coverage;
}

/** The entities this card's own article names, as terms the graph could hold
 *  facts about. `articleEntityNames` reads them out of the text the card
 *  already shows — each source's headline and the description beneath it — and
 *  the same discipline the hub gate applies then filters them: no stop word, no
 *  quantity, no class the graph's own identity rows name, nothing that reads as
 *  a clause rather than a name. Sorted, so a card's background never depends on
 *  the order the names came back in. */
function cardArticleTerms(sources, articleEntityNames, { concepts, readsAsEntityTerm }) {
  const texts = [];
  for (const source of sources) {
    if (source.title) texts.push(source.title);
    if (source.summary) texts.push(source.summary);
  }
  if (!texts.length) return [];
  const terms = new Set();
  for (const name of articleEntityNames(texts) || []) {
    const term = normFactTerm(name);
    if (!term || STOP_SET.has(term) || isQuantityTerm(term) || concepts.has(term)) continue;
    if (!readsAsEntityTerm(term)) continue;
    terms.add(term);
  }
  return [...terms].sort();
}

/** newsworthyHubs -> one item per hub (PLAN_NEWS_FEED.md section 6.6),
 *  paragraph included, sorted builtAt desc, then by what the card carries
 *  (`cardSubstance` through `bySubstance`), then id asc — every card of one
 *  build shares a `builtAt`, so substance is what actually orders a feed, and
 *  a card whose only fact restates its own headline reads after every card
 *  with something to say. Nothing is dropped for being thin: each item carries
 *  its own `substance` count instead. `sourcesByFactId`
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
 *  borrows, and it carries its own citation on its own card.
 *
 *  Between the gate and the render sit two more reads over the same reported
 *  rows: `titledHubs` names each card after the entity its own report grounds
 *  rather than a clause the report threw off, and `storyCoverage` leaves a
 *  publication with only the stories no other card tells. Both are pure over
 *  the fact set, so a feed built from the same rows in two orders still comes
 *  back byte for byte.
 *
 *  `articleEntityNames`, when the caller supplies one, reads the entity names
 *  out of the text of the sources a card shows (news.mjs wires the services
 *  layer's own capture, the same one the enrichment ledger admits terms by).
 *  Those entities widen the card's background: what the graph holds about a
 *  name inside the headline now reaches the card, where before only the
 *  endpoints of its own facts did. They never widen its report — the walk they
 *  seed excludes every reported row — so what a card claims a source said is
 *  untouched. They also carry the card's sense when its hub is a phrase the
 *  bands never place: the hub walk then keeps to the senses of the names the
 *  article uses, where before it kept to nothing. */
export function buildNewsItems(rows, {
  now, windowMs, limit = 6, sourcesByFactId = new Map(), readsAsEntityTerm, articleEntityNames = null,
} = {}) {
  // Every lane below reads `claimRows`, never `rows`: the hub gate, the
  // adjacency index both walks share, the prior/concept/sense reads, the
  // sentences, and each card's own `factIds`. An attribution says something
  // about a row rather than about the world, and a lane handed one can score it
  // as a hub and head a card with a hex id.
  const { claims: claimRows, speakersByClaimId } = partitionAttributions(rows);
  const reported = reportedRows(claimRows, { now, windowMs });
  const reportedIds = new Set(reported.map((r) => r.id));
  const adjacency = buildTermAdjacency(claimRows);
  const prior = priorTerms(claimRows);
  const hubOptions = { now, windowMs, limit, adjacency, prior };
  if (readsAsEntityTerm) hubOptions.readsAsEntityTerm = readsAsEntityTerm;
  const rowsByTerm = reportedRowsByTerm(reported);
  const hubs = titledHubs(newsworthyHubs(claimRows, reported, hubOptions), claimRows, reported, rowsByTerm);
  const coverage = storyCoverage(hubs, rowsByTerm);
  const concepts = conceptTerms(claimRows);
  const namesEntities = readsAsEntityTerm || looksLikeEntityTerm;
  const senseScope = buildSenseScope(claimRows);
  const items = hubs.filter(({ term }) => coverage.get(term).mints).map(({ term, changed }) => {
    const coveredRowIds = coverage.get(term).coveredRowIds;
    const seeds = hubSeedTerms(term);
    const hubWalk = {
      adjacency,
      priorityIds: reportedIds,
      seedTerms: seeds,
      excludeIds: coveredRowIds,
    };
    // The card's sources have to be read before its sense can be chosen, and a
    // walk that admits no background at all is enough to read them: a report on
    // the hub sits on a seed, and every scope admits those. So this pass and
    // the real one below hand `hubReportRows` the same rows.
    const reportedRowsOnly = subgraphAround(claimRows, term, { ...hubWalk, inSense: () => false });
    const sources = collectSources(hubReportRows(term, reportedRowsOnly, { reportedIds }), sourcesByFactId);
    const articleTerms = articleEntityNames
      ? cardArticleTerms(sources, articleEntityNames, { concepts, readsAsEntityTerm: namesEntities })
      : [];
    // A hub the bands never place has no sense of its own, so a scope anchored
    // on it refuses nothing and the walk fills the card with whatever it meets.
    // The entities the article names carry the card's sense instead, so its
    // background stays tied to its own text. When the bands place none of those
    // names either, the card keeps to the unplaced and reads sparse, which is
    // the price of not filling a card about a coined phrase with strays.
    const hubSense = senseScope.hasPlacedSense(seeds)
      ? senseScope.sameSenseAs(seeds)
      : senseScope.sameSenseAs([...seeds, ...articleTerms], { admitAllWhenUnplaced: false });
    const hubRows = subgraphAround(claimRows, term, { ...hubWalk, inSense: hubSense });
    const heldIds = new Set(hubRows.map((r) => r.id));
    const articleRows = articleTerms.length
      ? articleEntityRows(claimRows, articleTerms, {
        adjacency,
        excludeIds: new Set([...coveredRowIds, ...reportedIds]),
        inSense: senseScope.sameSenseAs(articleTerms),
      }).filter((r) => !heldIds.has(r.id))
      : [];
    const subgraphRows = articleRows.length ? [...hubRows, ...articleRows] : hubRows;
    const factIds = subgraphRows.map((r) => r.id).sort();
    const { background } = splitCardRows(subgraphRows, reportedIds);
    return {
      id: `news-feed:${sha256HexPrefix(`${term}\0${factIds.join(",")}`, 8)}`,
      hub: term,
      factIds,
      changedCount: changed,
      substance: cardSubstance(term, subgraphRows, {
        reportedIds, articleTerms, headlines: sources.map((s) => s.title),
      }),
      builtAt: now,
      paragraph: renderNewsParagraph(term, subgraphRows, { reportedIds, articleTerms, speakersByClaimId }),
      tier: tierOf(subgraphRows),
      sources,
      background: background.map((r) => r.id).sort(),
      backgroundParagraph: renderKnownFactsParagraph(term, subgraphRows, { reportedIds, articleTerms, speakersByClaimId }),
    };
  });
  return items.sort((a, b) => (toMs(b.builtAt) - toMs(a.builtAt)) || bySubstance(a, b) || byId(a, b));
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

/** News-tagged fact ids to retract, oldest observation first, ties by id — the
 *  eviction the service applies at ingest time so the graph cannot grow past
 *  `cap` unattended. Never selects a seed/taught/research/fixture-replay row.
 *
 *  A claim and the attributions naming it evict as ONE unit. They carry the same
 *  news tag and the same stamp but not the same id, so choosing row by row
 *  routinely kept one half and dropped the other, leaving a speaker with no
 *  claim or a claim whose surface can no longer say who said it. A unit that
 *  straddles the cap goes whole: the graph lands under `cap`, never on half a
 *  pair.
 *
 *  The stamp comes from `rowObservedMs`, which is where a read row actually
 *  carries it — `readFactRows` keeps observedAt on the assertion records, so
 *  reading `row.observedAt` scored every real news row 0 and left the cap
 *  evicting by id order. */
export function evictNewsFacts(rows, { cap }) {
  const newsRows = rows.filter((r) => NEWS_PROVENANCE_RE.test(String(r.provenance || "")));
  if (newsRows.length <= cap) return [];

  const units = new Map();
  for (const row of newsRows) {
    const key = referencedFactId(row) || row.id;
    let unit = units.get(key);
    if (!unit) units.set(key, (unit = { key, ids: [], observedMs: Infinity }));
    unit.ids.push(row.id);
    const t = rowObservedMs(row);
    unit.observedMs = Math.min(unit.observedMs, Number.isFinite(t) ? t : 0);
  }

  const target = newsRows.length - cap;
  const evicted = [];
  const oldestFirst = [...units.values()]
    .sort((a, b) => a.observedMs - b.observedMs || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  for (const unit of oldestFirst) {
    if (evicted.length >= target) break;
    evicted.push(...unit.ids.slice().sort());
  }
  return evicted;
}
