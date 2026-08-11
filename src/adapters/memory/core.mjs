// memory/core.mjs — tmct's OWN conversational memory graph: a dedicated
// OWL-labelled store (routed default: the SQLite file at
// <repo>/.tmct/memory/graph.sqlite; "memory" keeps it in-process; the
// flat-JSON read/write path survives for callers holding a plain dir),
// distinct from any provider-supplied code graph. Utterances, Facts (reified RDF triples via
// appendFact), and Sessions are all typed twice — payload `class` and an
// `rdf:type` attribute. Every append is crash-safe and idempotent (utterance
// ids are deterministic, fact ids hash the triple).
//
// A Fact is textbook RDF reification: `rdf:type rdf:Statement` plus
// rdf:subject/predicate/object, which carries the per-triple provenance and
// polarity stamps a bare triple has no room for. This is the RDF 1.1
// reification vocabulary, which RDF 1.2 reclassifies as legacy (steering new
// systems toward triple terms) but does not deprecate. See
// docs/references/schemas/rdf-reification-and-rdf-star.md.

import { access, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { proseTokensFor, buildProseIndex } from "../../domain/prose.mjs";
import { fnv1aHex, normText, normFactTerm, normFactPredicate, factIdFor, factIdForTriple } from "../../domain/hash.mjs";

// Fact identity (normalization + id derivation) lives in hash.mjs — the one
// content-address contract — and is re-exported here so store consumers keep
// a single import site for read/write plus identity.
export { normFactTerm, normFactPredicate, factIdForTriple } from "../../domain/hash.mjs";
import {
  computeTrust, computeAssertionGroupTrust, computeAssertionGroupTrustBase,
  assertionPrior, sessionReliabilityFrom,
  TRUST_SCORE_PROP, TRUST_INPUTS_PROP, PROV_CLASS_BY_SOURCE_TYPE,
  CREATED_AT_PROP, UPDATED_AT_PROP, provenanceTagToSource,
} from "../../domain/memory/trust.mjs";
import {
  resolutionStrategyFor, resolveSiblingGroups, MERGE_PREDICATES,
  RESOLUTION_MERGE, RESOLUTION_CONTRADICTION, RESOLUTION_LATEST_OBSERVATION_WINS,
} from "../../domain/memory/resolution.mjs";

// The createdAt/updatedAt vocabulary and the provenance-tag Source parser live
// with the trust layer (they are its inputs); re-exported here so store
// consumers keep one import site.
export { CREATED_AT_PROP, UPDATED_AT_PROP, provenanceTagToSource } from "../../domain/memory/trust.mjs";
import { NEG_PREDICATE_PREFIX, negatedPredicate } from "../../domain/memory/capability.mjs";
import {
  planHeadRollup, planChainRollup, mergeRollups,
  isHeadRollupId, isChainRollupId, isRollupId, headRollupTypeOf,
  isAbsorbedSource, absorbedSourceIds,
  ROLLUP_PRIOR_PROP, ROLLUP_EARLIEST_PROP, ROLLUP_LATEST_PROP, ROLLUP_COUNT_PROP,
  CHAIN_ROLLUP_THRESHOLD,
} from "../../domain/memory/compaction.mjs";
import {
  planRetraction, mergeRetractions, retractionFromWire, retractionWireFact,
  isRetractedRecord, RETRACTION_CLASS,
} from "../../domain/memory/retraction.mjs";
import { admittedNodes, stableRecordIds } from "../../domain/memory/causal-stability.mjs";
import { assertIndividualValid } from "./shacl.mjs";
import {
  BackendRejected, BackendUnavailable, isRowBackend, rowBackendProblems, assertValidRow,
  BOOKKEEPING_ROW_CLASS, ROW_BACKEND_KIND, ROW_BACKEND_CONTRACT_VERSION,
} from "./row-backend.mjs";
// The row-backend contract lives in its own module (a consumer imports it
// without loading the engine); re-exported here so store consumers keep one
// import site, the same way the trust and retraction vocabularies are.
export {
  BackendRejected, BackendUnavailable, isRowBackend, rowBackendProblems,
  isValidRow, rowProblems, assertValidRow,
  ROW_BACKEND_KIND, ROW_BACKEND_CONTRACT_VERSION, ROW_CLASSES, MAX_ROW_BYTES,
} from "./row-backend.mjs";
// rows.mjs imports this module back for the class constants. The cycle is
// fine as long as neither side READS an imported binding while the other's
// body is still running — rows.mjs builds its class map on first use, and
// every use here is inside a function.
import { payloadToRows, rowsToPayload, diffRows } from "./rows.mjs";

// The rollup vocabulary and its tuning constants live with the compaction
// layer; re-exported here so store consumers keep one import site.
export {
  GROUP_ROLLUP_THRESHOLD, ROLLUP_KEEP_PER_TYPE, CHAIN_ROLLUP_THRESHOLD, CHAIN_KEEP_DEPTH,
  ROLLUP_SOURCE_IDS_PROP, ROLLUP_RECORD_IDS_PROP, ROLLUP_COUNT_PROP,
  ROLLUP_EARLIEST_PROP, ROLLUP_LATEST_PROP, ROLLUP_PRIOR_PROP,
  headRollupIdFor, chainRollupIdFor, isHeadRollupId, isChainRollupId, isRollupId,
} from "../../domain/memory/compaction.mjs";

// Same reasoning for the retraction vocabulary: the tombstone shape is the
// domain layer's, and store consumers reach it through this one import site.
export {
  RETRACTION_CLASS, RETRACTION_PREDICATE,
  RETRACTED_RECORD_IDS_PROP, RETRACTED_AT_PROP, RETRACTED_COUNT_PROP,
  retractionIdFor, isRetractionId, retractionScopeOf,
  retractedRecordIds, retractedAtOf, retractionWireFact, retractionFromWire,
} from "../../domain/memory/retraction.mjs";

export { admittedNodes, peersToConvince, stableRecordIds } from "../../domain/memory/causal-stability.mjs";

export const MEMORY_DIR_REL = join(".tmct", "memory");
export const MEMORY_GRAPH_REL = join(MEMORY_DIR_REL, "graph.json");

export const UTTERANCE_CLASS = "Utterance";
export const FACT_CLASS = "Fact";
export const MEMORY_SESSION_CLASS = "Session";
export const SOURCE_CLASS = "Source";
// A taught RULE (a composed/filtered/recursive relation-shape) — a sibling
// of Fact, never a taught concept itself.
export const RULE_CLASS = "Rule";

export const SAID_IN_SESSION_PROP = "mgx:saidInSession";
export const IN_REPLY_TO_PROP = "mgx:inReplyTo";

// The provenance-link predicate family: one umbrella object property with two
// workhorse subproperties, minted in the owned mgx: namespace to match
// tmct-core.ttl's object-property style.
const DERIVED_FROM_PROP = "mgx:derivedFrom";        // umbrella: Fact → Source|Fact
export const STATED_BY_PROP = "mgx:statedBy";              // a Source directly asserts a Fact
export const CANONICALISED_FROM_PROP = "mgx:canonicalisedFrom"; // a canonical Fact ← its raw form
export const SOURCE_RELIABILITY_PROP = "mgx:sourceReliability"; // actor-level (session-scoped) trust nudge on a Source, [0.5,1.5]

// Bare (session-less) singleton Source ids — fallback for a provenance tag
// with no session-id segment. A tag that does carry one mints its own
// per-session Source instead (`${ID}:<sessionId>`, sourceIdFor below).
export const OPERATOR_SOURCE_ID = "src:operator-chat";
const TEACH_SOURCE_ID = "src:teach-chat";
// One Source per peer NODE, keyed by the stable id its relabeled tag carries.
const TEACH_NODE_SOURCE_ID = "src:teach-node";

const ROLES = new Set(["visitor", "tmct"]);
const LABEL_CAP = 48;    // utterance/fact labels stay skimmable in renders

/** The memory graph's vocabulary — documented in-payload exactly like
 *  graph-build.mjs documents the code graph's. */
const MEMORY_VOCABULARY = [
  { prop: "rdf:type", note: "rdf-ish typing attribute: owl:NamedIndividual (utterances/sessions) or rdf:Statement (reified facts)" },
  { prop: "mgx:utteranceRole", note: "who said it: visitor (an a-visitor-said item) or tmct (the response alongside it)" },
  { prop: "mgx:utteranceText", note: "the utterance's normalized text (capped)" },
  { prop: "mgx:utteranceTs", note: "when it was said, ISO-8601 (the chat turn timestamp)" },
  { prop: "mgx:utteranceParsed", note: "optional JSON of the parse the interpretation pipeline produced for this request" },
  { prop: SAID_IN_SESSION_PROP, predicate: "saidInSession", note: "Utterance → Session it was said in; runtime observation, owned (no SEON term)" },
  { prop: IN_REPLY_TO_PROP, predicate: "inReplyTo", note: "tmct Utterance → the visitor Utterance it answers (the Q/A pairing)" },
  { prop: "rdf:subject", note: "reified fact: the triple's subject term" },
  { prop: "rdf:predicate", note: "reified fact: the triple's predicate term" },
  { prop: "rdf:object", note: "reified fact: the triple's object term" },
  { prop: "mgx:factProvenance", note: "LEGACY COMPAT SHIM: the ' | '-joined provenance tag string a fact came from; the source-of-truth is now the mgx:statedBy edges derived from it" },
  { prop: "mgx:sourceId", note: "the assertion key a Fact record is filed under — the Source id of the ONE party asserting it, which is also the @-suffix of the record's own id. `src:none` when no tag names a Source, so every record has a key rather than a hole" },
  { prop: "mgx:observedAt", note: "OPTIONAL valid time: when the asserting party WITNESSED the claim, as against mgx:createdAt's transaction time (when this store recorded it). A stale article read today loses to an eyewitness report from yesterday. Stored only when a caller supplies one — never fabricated, never backfilled" },
  { prop: "mgx:extractionFinding", note: "OPTIONAL: the space-joined structural findings the extractor recorded about how THIS assertion's sentence was read, from the closed vocabulary identifier-token | clause-fallback | pronoun-carry | definitional-frame. Per assertion, never per triple: a later clean re-assertion of the same triple carries none. Absence means no findings were recorded, never that the sentence was checked and read cleanly" },
  { prop: "mgx:supersedes", note: "the record id(s) this one replaced when its own source re-asserted the triple with a newer embedded timestamp. A space-joined LIST; absent, never empty, until the first supersession" },
  { prop: "mgx:supersededBy", note: "the record id(s) that replaced this one. Its presence is what makes a record a demoted leaf rather than a live head, and the group fold skips it: a source's past belief is not a second vote for the present one. A LIST, because one source with two live replicas can fork before they sync" },
  { prop: "mgx:factQuantifier", note: "OPTIONAL: the quantifier word a plural class-membership teach used ('every'/'some'/'a few'), for literal recall by 'how many Xs are Ys' — never real cardinality counting" },
  { prop: "mgx:factJustification", note: "an entailed Fact's supporting premise fact ids: ' | '-separated environments, one space-separated premise-id list per independent derivation, capped by syllogise's maxEnvironments knob; a value with no ' | ' is a single environment" },
  { prop: "mgx:ruleName", note: "a taught Rule's own name (e.g. 'grandparent') — the query-dispatcher's lookup key, PLAN_TAUGHT_RELATIONS.md §2/§3" },
  { prop: "mgx:ruleKind", note: "a taught Rule's SHAPE tag — the closed vocabulary compose2 | filter | recursive (structural, like 'Fact'/'Rule' themselves, never a domain word)" },
  { prop: "mgx:ruleBase1", note: "compose2: the first hop's base relation name; filter: the base rule/relation being filtered (same 'base relation' role in both kinds, so the name is shared)" },
  { prop: "mgx:ruleBase2", note: "compose2 only: the second hop's base relation name" },
  { prop: "mgx:ruleFilterProperty", note: "filter only: the property literal candidates are filtered by (an mgx:hasProperty-shaped Fact lookup)" },
  { prop: "mgx:ruleBaseCase", note: "recursive only: the base-case relation name (hop zero)" },
  { prop: "mgx:ruleRecStep", note: "recursive only: the self-referential recursive-step relation name" },
  { prop: CREATED_AT_PROP, note: "when an individual was FIRST written, ISO-8601 (first-write-wins on upsert); the audit 'when', the recency input to trust, the novelty signal" },
  { prop: UPDATED_AT_PROP, note: "an audit / last-modified stamp: when an individual's OWN attributes were last mutated in place (upsertSession, recomputeFactTrust, recomputeSourceReliability) — most individuals never carry it at all. NOT transaction time: a mutable stamp cannot record when the previous version stopped being current, so tmct is not bitemporal" },
  { prop: DERIVED_FROM_PROP, predicate: "derivedFrom", note: "umbrella: a Fact derived from a Source (or another Fact). ext ref prov:wasDerivedFrom (UNVERIFIED-pending-web-check)" },
  { prop: STATED_BY_PROP, predicate: "statedBy", note: "subPropertyOf derivedFrom: a Source directly asserts this Fact (one edge per independent source — replaces the factProvenance union)" },
  { prop: CANONICALISED_FROM_PROP, predicate: "canonicalisedFrom", note: "subPropertyOf derivedFrom: a canonical Fact cleaned from a raw Block/Source, never replacing it" },
  { prop: "mgx:sourceType", note: "a Source's kind: operator | teach | provider | corpus | corpusWeak | reference | referenceLive | extracted | optimisticExtract | web | entailed (the trust-prior key)" },
  { prop: "mgx:sourceUrl", note: "a web Source's URL" },
  { prop: "mgx:sourceRule", note: "an entailed Source's rule id" },
  { prop: "mgx:sourceReliability", note: "actor-level (session-scoped) trust nudge in [0.5,1.5], neutral 1.0 when absent — materialised by recomputeSourceReliability from a session's asserted-vs-contradicted track record (memory/trust.mjs's sessionReliabilityFrom); folds into computeTrust's per-source prior" },
  { prop: TRUST_SCORE_PROP, note: "materialised trust cache in [0,1] — pure function of a fact's Sources + createdAt (memory/trust.mjs); invalidated when a statedBy edge is added" },
  { prop: TRUST_INPUTS_PROP, note: "JSON of the inputs the trust score was computed from (source-type multiset, corroboration count, createdAt, recency) — makes the score auditable" },
  { prop: "mgx:hasProseTokens", note: "prose tokens (prose.mjs tokenizer) backing the payload's proseIndex" },
  { prop: "mgx:sessionStarted", note: "session anchor: when the session started, ISO-8601" },
  { prop: "rdf:predicate", prefix: NEG_PREDICATE_PREFIX, note: "a reified fact's predicate carries its POLARITY: mgxneg:capableOf is the negative twin of mgx:capableOf ('a penguin cannot fly'). Polarity cannot be a separate property — the fact id hashes (subject, predicate, object), so both polarities would share one id and union their statedBy edges (memory/capability.mjs)" },
];

/** A fresh, empty memory payload — the buildEntities shape, plus the OWL/RDF
 *  prefixes the memory vocabulary uses. `memory: true` marks it as tmct's own
 *  store (never a provider artifact). */
export function emptyMemory() {
  return {
    generated_at: "",
    memory: true,
    prefixes: {
      owl: "http://www.w3.org/2002/07/owl#",
      rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
      rdfs: "http://www.w3.org/2000/01/rdf-schema#",
      mgx: "urn:tmct:mgx#",
      mgxneg: "urn:tmct:mgxneg#",
    },
    vocabulary: MEMORY_VOCABULARY.map((v) => ({ ...v })),
    classes: [],
    objectProperties: [],
    individuals: [],
    proseIndex: {},
  };
}

/** Resolve the on-disk path of a memory graph file for `dir`. `version` null
 *  (default) is the live graph; a numeric version resolves a snapshot copy
 *  (see snapshotMemory below). The single source of truth for this path. */
export function resolveMemoryGraphFile(dir, version = null) {
  if (isMemoryOrSqliteHandle(dir)) {
    throw new Error("resolveMemoryGraphFile: dir is a store handle, not a file path (Backend A only)");
  }
  if (version === null) return join(dir, MEMORY_GRAPH_REL);
  return join(dir, MEMORY_DIR_REL, `graph.v${version}.json`);
}

const memoryGraphFile = (dir) => resolveMemoryGraphFile(dir);

// ---- Storage-backend seam --------------------------------------------------
// `dir` is either a plain repo-path string (Backend A, file-backed) or a
// handle from createInMemoryStore() (Backend B), createSqliteMemoryStore()
// (Backend C), or wrapRowBackend() over a consumer's own row store
// (Backend D). Only loadMemory/mutateMemory dispatch on backend; every other
// function operates on the plain payload object they hand back.

const BACKEND_MEMORY = "memory";
const BACKEND_SQLITE = "sqlite";
const BACKEND_ROW = "row";

function isMemoryHandle(dir) {
  return !!dir && typeof dir === "object" && dir.backend === BACKEND_MEMORY;
}
function isSqliteHandle(dir) {
  return !!dir && typeof dir === "object" && dir.backend === BACKEND_SQLITE;
}
/** True for a Backend D handle — the wrapper wrapRowBackend puts around a
 *  consumer's injected row store. A row store has no path and no connection of
 *  tmct's own, so callers that reach for either have to branch on this. */
export function isRowHandle(dir) {
  return !!dir && typeof dir === "object" && dir.backend === BACKEND_ROW;
}
/** True for any store handle — Backend B, C or D — that is NOT a plain
 *  repo-path string. Exported so every OTHER module that takes a `dir` and
 *  might reach a raw `node:path`/`node:fs` call (blocks.mjs's session-block
 *  index chief among them) can guard the same way this module already does,
 *  instead of a bare `join(dir, …)` throwing Node's generic "path argument
 *  must be of type string" at a caller with no idea why. */
export function isMemoryOrSqliteHandle(dir) {
  return isMemoryHandle(dir) || isSqliteHandle(dir) || isRowHandle(dir);
}

/** Backend B — pure in-memory store: `{ backend: "memory", payload }` held by
 *  the caller (never module-global). Zero file I/O; distinct from
 *  `--ephemeral`, which still round-trips a throwaway temp dir. */
export function createInMemoryStore() {
  return { backend: BACKEND_MEMORY, payload: emptyMemory() };
}

/** Assign `seedPayload` onto `memoryDir`'s own payload — spread over the
 *  store's own (possibly empty) payload rather than replacing it outright,
 *  so a partial seed (individuals and objectProperties only) still carries
 *  the classes/prefixes scaffolding the write path recounts, and a later
 *  teach turn works regardless of what the seed carries. A no-op when
 *  `seedPayload` is null/undefined — a browser session with nothing to seed
 *  keeps its own fresh empty payload untouched. */
export function applySeedPayload(memoryDir, seedPayload) {
  if (seedPayload) memoryDir.payload = { ...memoryDir.payload, ...seedPayload };
}

/** A structurally independent copy of a memory payload — `structuredClone`
 *  where available, falling back to a JSON round-trip for an environment
 *  without it. Returns null for a null/undefined `payload`, so a caller can
 *  seed a fresh session with "no seed yet" rather than an empty object. */
export function cloneMemoryPayload(payload) {
  if (!payload) return null;
  try { return structuredClone(payload); } catch { return JSON.parse(JSON.stringify(payload)); }
}

// ---- Backend C — SQLite: a live node:sqlite connection, per-row
// INSERT/REPLACE/DELETE diffed against what's already stored (write cost
// proportional to what changed, not total store size). Reads are cached on
// `handle.cachedPayload` and incrementally patched in lockstep with writes;
// a failed write invalidates the cache so the next read rebuilds honestly.

const SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS individuals (id TEXT PRIMARY KEY, ord INTEGER NOT NULL, class TEXT, label TEXT, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS relations (prop TEXT PRIMARY KEY, ord INTEGER NOT NULL, predicate TEXT, count INTEGER);
CREATE TABLE IF NOT EXISTS edges (prop TEXT NOT NULL, subject TEXT NOT NULL, object TEXT NOT NULL, subject_label TEXT, object_label TEXT, extra TEXT, PRIMARY KEY (prop, subject, object));
CREATE INDEX IF NOT EXISTS edges_by_prop ON edges(prop);
CREATE TABLE IF NOT EXISTS facts (
  id            TEXT PRIMARY KEY,
  triple_hash   TEXT NOT NULL,
  subject       TEXT NOT NULL,
  predicate     TEXT NOT NULL,
  object        TEXT NOT NULL,
  source_id     TEXT NOT NULL,
  source_type   TEXT NOT NULL,
  trust_score   REAL NOT NULL,
  created_at    TEXT NOT NULL,
  observed_at   TEXT,
  superseded_by TEXT,
  json          TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS facts_by_triple_hash       ON facts(triple_hash);
CREATE INDEX IF NOT EXISTS facts_by_subject_predicate ON facts(subject, predicate);
CREATE INDEX IF NOT EXISTS facts_by_predicate_object  ON facts(predicate, object);
CREATE INDEX IF NOT EXISTS facts_current              ON facts(triple_hash, source_id, superseded_by);
CREATE TABLE IF NOT EXISTS fact_heads (
  triple_hash  TEXT PRIMARY KEY,
  trust_base   REAL NOT NULL,
  inputs_json  TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS fact_object_supersessions (
  subject     TEXT NOT NULL,
  predicate   TEXT NOT NULL,
  ord         INTEGER NOT NULL,
  from_id     TEXT NOT NULL,
  to_id       TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (subject, predicate, ord)
);
`;

// ---- The `facts` projection ------------------------------------------------
// `facts` holds one queryable row per Fact individual, written in the SAME
// transaction as the `individuals` row it mirrors. The JSON blob stays the
// single source of truth — the columns exist so a reader can ask the database
// for "every fact about dog" instead of loading the whole store and scanning
// it in JS, the same discipline `individuals` already applies to its own
// `class`/`label` columns. Plain portable SQL: the schema above works
// unchanged against Postgres/MySQL/Aurora, so a cloud relational backend
// inherits the read path rather than reinventing it.

// A Fact whose provenance tag maps to no Source at all still needs a key, so
// it projects onto this singleton rather than a NULL.
const NO_SOURCE_ID = "src:none";

const OBSERVED_AT_PROP = "mgx:observedAt";      // valid time: when the asserting party witnessed the claim
const SOURCE_ID_PROP = "mgx:sourceId";          // the assertion key this record is filed under
const SUPERSEDES_PROP = "mgx:supersedes";       // the id(s) this record replaced; absent until the first supersession
const SUPERSEDED_BY_PROP = "mgx:supersededBy";  // the id(s) that replaced this record; absent on a live head

/** How the extractor read the sentence one assertion came from — a space-joined
 *  list from the closed EXTRACTION_FINDINGS vocabulary, absent when the write
 *  recorded none. It sits on the assertion record rather than the triple, so a
 *  second source stating the same thing cleanly inherits no caveat. */
export const EXTRACTION_FINDING_PROP = "mgx:extractionFinding";
export { EXTRACTION_FINDINGS } from "./shacl.mjs";

/** The Source key a Fact's provenance union projects onto: the first tag that
 *  derives one, since the tags of one fact are asserted in arrival order and
 *  the earliest is its primary source. `src:none` when no tag parses. */
function primarySourceOf(provenance) {
  for (const tag of String(provenance || "").split(" | ")) {
    if (!tag) continue;
    const info = sourceIdFor(provenanceTagToSource(tag));
    if (info) return info;
  }
  return { id: NO_SOURCE_ID, type: "" };
}

// ---- One record per ASSERTION, not one per triple --------------------------
// A Fact's identity is `<groupId>@<sourceId>`: the content-addressed triple hash
// every reader still calls "the fact id", plus the Source key of the ONE party
// asserting it. Two sources asserting the same triple hold two records sharing
// a group; the same source re-asserting resolves onto its own lineage. The
// group id stays the public id — it is what a justification premise list, a
// citation and `tmct inspect` all print — so nothing outside this file has to
// learn the record id at all.

/** The group (triple) id a record id belongs to: everything before the first
 *  `@`. A record id with no `@` is its own group, which is what a hand-built
 *  fixture and a not-yet-migrated store both still look like. */
export function factGroupId(recordId) {
  const id = String(recordId || "");
  const at = id.indexOf("@");
  return at < 0 ? id : id.slice(0, at);
}

/** The record id one provenance tag keys for a triple. A store files an
 *  assertion under the Source its OWN tag derives, and a broadcast relabel
 *  changes that Source — locally a chat session, at the peer the node that
 *  sent it. So two stores hold one assertion under two ids, and anything that
 *  has to name a record ACROSS the wire (a retraction does) resolves the id
 *  through the tag rather than assuming both ends agree. */
export function factRecordIdForTag(groupId, tag) {
  return `${groupId}@${assertionSourceFor(tag).id}`;
}

/** The assertion key one provenance tag derives — the SAME closed derivation
 *  Source individuals already use, with the `src:none` singleton standing in
 *  for a tag that parses to no Source at all. Under this model every record
 *  needs a key, so the null case gets a name rather than a hole. */
function assertionSourceFor(tag) {
  return sourceIdFor(provenanceTagToSource(tag)) || { id: NO_SOURCE_ID, type: "" };
}

/** Split a provenance string into one group per Source id, keeping each group's
 *  own tags in arrival order. Normally one tag per group; two only when both
 *  derive the SAME Source (`corpus:conceptnet /r/IsA` and `child:conceptnet:dog`
 *  both key on `src:corpus:conceptnet`). An empty provenance still yields one
 *  group, under `src:none`, so the fact keeps a record. */
function groupTagsBySource(provenance) {
  const groups = new Map();
  for (const raw of String(provenance || "").split(" | ")) {
    const tag = raw.trim();
    if (!tag) continue;
    const { id, type } = assertionSourceFor(tag);
    const group = groups.get(id) || { sourceId: id, sourceType: type, tags: [] };
    if (!group.tags.includes(tag)) group.tags.push(tag);
    groups.set(id, group);
  }
  if (!groups.size) groups.set(NO_SOURCE_ID, { sourceId: NO_SOURCE_ID, sourceType: "", tags: [] });
  return [...groups.values()];
}

/** The instant a source's own tag(s) EMBED — the origin's assertion moment, and
 *  the only clock supersession is allowed to read. `pick` is Math.max for a
 *  live write ("when did this source last say it") and Math.min for the
 *  migration ("when did this source first say it"). "" when no tag carries one,
 *  which is the common corpus case. */
function embeddedTagTimestamp(tags, pick = Math.max) {
  let best = "";
  let bestAt = null;
  for (const tag of tags || []) {
    const ts = provenanceTagToSource(tag)?.createdAt || "";
    const at = Date.parse(ts);
    if (!Number.isFinite(at)) continue;
    if (bestAt === null || pick(at, bestAt) === at) { best = ts; bestAt = at; }
  }
  return best;
}

/** When a record says it was asserted: its tag's own embedded timestamp, else
 *  the caller's explicit createdAt. This is the recency clock — separate from
 *  the supersession clock above on purpose. A caller's createdAt is THIS
 *  store's transaction stamp; letting it order supersession would turn every
 *  re-import that passes a later createdAt into a new version and quietly break
 *  first-write-wins. Only what the origin embedded can order the origin. */
function assertionTimestampFor(tags, fallback = "", pick = Math.max) {
  return embeddedTagTimestamp(tags, pick) || (Number.isFinite(Date.parse(fallback)) ? String(fallback) : "");
}

/** Does an incoming assertion replace this source's own current record?
 *  A genuinely newer embedded timestamp does; an exact re-delivery never does,
 *  which is what keeps a re-seed and a duplicate mesh delivery no-ops. Both
 *  sides must carry a real embedded timestamp — an unstamped corpus row
 *  asserted a second time is the same hop saying the same thing, not a new
 *  version. The one tie-break: at equal instants a record carrying an
 *  observation time supersedes the same record without one, since only the
 *  origin could have supplied that field, so presence can only add information. */
function supersedesPriorAssertion(incoming, prior) {
  const a = Date.parse(incoming.assertedAt);
  const b = Date.parse(prior.assertedAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  if (a > b) return true;
  return a === b && !!incoming.observedAt && !prior.observedAt;
}

/** The `facts` bind values for a Fact individual, in column order. `json` is
 *  the already-serialized blob the `individuals` row stores, passed in so the
 *  two rows can never disagree about the same individual. */
function factProjectionValues(ind, json) {
  const attr = (prop) => (ind.attributes || []).find((a) => a?.prop === prop)?.value || "";
  // Every tag on one record derives the same Source, so the record's own
  // provenance settles its type; the stored key wins on the id, since a
  // `src:none` record has no tag to re-derive it from.
  const source = primarySourceOf(attr("mgx:factProvenance"));
  // A collection in the blob; the column carries the common-case single
  // successor, so a reader can filter for live heads without opening the JSON.
  const supersededBy = attr(SUPERSEDED_BY_PROP).split(" ").filter(Boolean)[0] || null;
  // A pool-1 summary has no tag to re-derive a type from and no Source of its
  // own: it stands for many absorbed sources of ONE type, which its id carries,
  // and its trust contribution is the noisy-OR base over what it absorbed.
  // Both belong in the columns, so a per-type SQL read sees a compacted group
  // exactly as it sees an uncompacted one.
  const rollupType = headRollupTypeOf(ind.id);
  return [
    ind.id,
    factGroupId(ind.id),
    attr("rdf:subject"), attr("rdf:predicate"), attr("rdf:object"),
    attr(SOURCE_ID_PROP) || source.id, rollupType || source.type,
    Number(attr(rollupType ? ROLLUP_PRIOR_PROP : TRUST_SCORE_PROP)) || 0,
    attr(CREATED_AT_PROP),
    attr(OBSERVED_AT_PROP) || null,
    supersededBy,
    json,
  ];
}

const FACT_PROJECTION_UPSERT_SQL =
  "INSERT OR REPLACE INTO facts(id, triple_hash, subject, predicate, object, source_id, source_type, trust_score, created_at, observed_at, superseded_by, json)"
  + " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

/** Project every Fact individual a store already holds into an empty `facts`
 *  table — what a store written before the projection existed needs, once.
 *  Runs at open so a read-only session gets the columns too. Cheap to skip: a
 *  projected store answers the first probe with a row and returns. */
function backfillFactsProjection(db) {
  if (db.prepare("SELECT id FROM facts LIMIT 1").get()) return;
  if (!db.prepare("SELECT id FROM individuals WHERE class = ? LIMIT 1").get(FACT_CLASS)) return;
  const upsertFact = db.prepare(FACT_PROJECTION_UPSERT_SQL);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of db.prepare("SELECT json FROM individuals WHERE class = ?").all(FACT_CLASS)) {
      upsertFact.run(...factProjectionValues(JSON.parse(row.json), row.json));
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

const individualAttr = (ind, prop) => (ind?.attributes || []).find((a) => a?.prop === prop)?.value || "";
const individualKey = (ind, key) => (ind?.attributes || []).find((a) => a?.key === key)?.value || "";
const subjectPredicateKey = (subject, predicate) => `${subject}\u0000${predicate}`;

// ---- Derived-local tables: `fact_heads` and `fact_object_supersessions` -----
// Both are breadcrumbs over a computation that is already correct without them,
// and both are LOCAL: they are never replicated, never exported, and never
// reachable from a wire fact. Replicating a derived aggregate would manufacture
// exactly the merge conflicts one-record-per-assertion removes, and recency
// makes any shipped aggregate stale on arrival.
//
// `fact_heads` stores a group's aggregate BASE — the noisy-OR with the time
// axis removed — plus the per-record audit trail it was folded from. A reader
// replays that trail through the same aggregate at its own `now`, so the decay
// lands at the reading moment exactly as it does when the group is folded from
// scratch. A head that baked recency in would be wrong the moment it was
// written, which is why the column holds a base and not a score.

/** The replayable audit trail a head stores: the four fields the group
 *  aggregate actually folds, and nothing that depends on when it was written. */
function headInputsFrom(assertions) {
  return (assertions || []).map((a) => ({
    sourceId: a.sourceId || "",
    sourceType: a.sourceType || "",
    ownTrust: a.ownTrust,
    assertedAt: a.assertedAt || "",
  }));
}

// Symbol-keyed, so it is invisible to JSON.stringify and dropped by
// structuredClone — a payload carrying the index cannot leak it into a
// snapshot, an export, or the wire even by accident.
const FACT_HEADS = Symbol("materialised fact_heads index");

/** Attach a materialised head index to a payload, for readFactRows to consume.
 *  A payload without one folds every group itself, which is the same answer. */
export function attachFactHeads(payload, heads) {
  if (payload && heads) payload[FACT_HEADS] = heads;
  return payload;
}

export const factHeadsOf = (payload) => payload?.[FACT_HEADS] || null;

const FACT_HEAD_UPSERT_SQL =
  "INSERT OR REPLACE INTO fact_heads(triple_hash, trust_base, inputs_json, updated_at) VALUES (?, ?, ?, ?)";

/** Every materialised head in a store, as the groupId -> head map
 *  readFactRows consumes. */
function readFactHeadIndex(db) {
  const heads = new Map();
  for (const row of db.prepare("SELECT triple_hash, trust_base, inputs_json FROM fact_heads").all()) {
    heads.set(row.triple_hash, { trustBase: row.trust_base, inputs: JSON.parse(row.inputs_json) });
  }
  return heads;
}

/** Re-materialise the head of every group this write touched, inside the
 *  caller's own open transaction — the same discipline the per-record trust
 *  recompute already follows, re-keyed from "the sources on one fact" to "the
 *  records in one group".
 *
 *  Only touched groups are recomputed, and that is exact rather than thrifty: a
 *  base carries no recency, so nothing but a change to a group's own records can
 *  move it. Reading the group back inside the transaction is also what makes a
 *  second writer correct — it folds over whatever is committed by then, not over
 *  the payload it happened to arrive with. */
function recomputeFactHeads(db, ctx, touchedGroups, headIndex) {
  const upsert = db.prepare(FACT_HEAD_UPSERT_SQL);
  const drop = db.prepare("DELETE FROM fact_heads WHERE triple_hash = ?");
  const updatedAt = nowIso();
  for (const groupId of touchedGroups) {
    const members = ctx.groups.get(groupId);
    // Every record of the group is gone (a retraction) or every one of them is
    // demoted — either way there is no live aggregate left to stand for.
    if (!members?.length) {
      drop.run(groupId);
      headIndex?.delete(groupId);
      continue;
    }
    const inputs = headInputsFrom(foldFactGroup(groupId, members, ctx).assertions);
    const trustBase = computeAssertionGroupTrustBase(inputs).score;
    upsert.run(groupId, trustBase, JSON.stringify(inputs), updatedAt);
    headIndex?.set(groupId, { trustBase, inputs });
  }
}

/** Materialise a head for every group a store already holds — what a store
 *  written before the table existed needs, once. Guarded exactly like the
 *  `facts` projection backfill beside it: a store that already has heads, or
 *  has no facts at all, returns without touching anything. */
function backfillFactHeads(handle) {
  const db = handle.db;
  if (db.prepare("SELECT triple_hash FROM fact_heads LIMIT 1").get()) return;
  if (!db.prepare("SELECT id FROM individuals WHERE class = ? LIMIT 1").get(FACT_CLASS)) return;
  const ctx = factFoldContext(buildSqlitePayloadFromRows(handle));
  db.exec("BEGIN IMMEDIATE");
  try {
    recomputeFactHeads(db, ctx, ctx.groups.keys(), null);
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

// `fact_object_supersessions` records the OTHER shape supersession takes. A
// same-source re-assertion supersedes by re-keying its own record, a real
// replicated chain. A latest-observation-wins winner changing is different in
// kind: the old room and the new one are different objects, so they are
// different content-addressed groups, and an id can never be reassigned onto
// different content the way the same-source case reuses its own slot. What is
// recordable there is an EDGE between the two groups' own stable ids.
//
// It is a breadcrumb, not an authority. Every fact behind it is already fully
// replicated and the resolution already runs correctly without it, so recording
// "A used to be current, B is now" changes nothing about how the winner is
// chosen. It is written lazily, only when a resolution actually finds the winner
// has moved — a pair that resolves the same way a thousand times running holds
// one row, and the first row a pair ever gets seeds the chain with an empty
// `from_id` because nothing preceded it.

/** Record the cross-object supersession edge for every (subject, predicate)
 *  this write touched whose winner has moved since the last one recorded. */
function recordObjectSupersessions(db, ctx, touchedPairs) {
  const latest = db.prepare(
    "SELECT ord, to_id FROM fact_object_supersessions WHERE subject = ? AND predicate = ? ORDER BY ord DESC LIMIT 1",
  );
  const insert = db.prepare(
    "INSERT INTO fact_object_supersessions(subject, predicate, ord, from_id, to_id, recorded_at) VALUES (?, ?, ?, ?, ?, ?)",
  );
  const recordedAt = nowIso();
  for (const pairKey of touchedPairs) {
    const [subject, predicate] = pairKey.split("\u0000");
    if (resolutionStrategyFor(predicate) !== RESOLUTION_LATEST_OBSERVATION_WINS) continue;
    const groupIds = ctx.groupsByPair.get(pairKey) || [];
    if (groupIds.length < 2) continue; // one object is a state, not a succession
    const rows = groupIds.map((groupId) => {
      const row = foldFactGroup(groupId, ctx.groups.get(groupId), ctx);
      row.trust = computeAssertionGroupTrust(row.assertions).score;
      return row;
    });
    if (new Set(rows.map((r) => r.object)).size < 2) continue;
    const winner = resolveSiblingGroups(rows, RESOLUTION_LATEST_OBSERVATION_WINS)?.winner?.id;
    if (!winner) continue;
    const prior = latest.get(subject, predicate);
    if (prior?.to_id === winner) continue; // nothing moved — the breadcrumb is already there
    insert.run(subject, predicate, (prior?.ord ?? -1) + 1, prior?.to_id || "", winner, recordedAt);
  }
}

/** The recorded cross-object supersession chain — "what changed to what" for a
 *  (subject, predicate), oldest first. The walk a view AT a past instant would
 *  consume; empty for any backend that keeps no derived tables. */
export function readObjectSupersessions(handle, { subject, predicate } = {}) {
  if (!isSqliteHandle(handle)) return [];
  const where = subject && predicate ? " WHERE subject = ? AND predicate = ?" : "";
  const args = where ? [subject, predicate] : [];
  return handle.db
    .prepare(`SELECT subject, predicate, ord, from_id, to_id, recorded_at FROM fact_object_supersessions${where} ORDER BY subject, predicate, ord`)
    .all(...args)
    .map((r) => ({
      subject: r.subject, predicate: r.predicate, ord: r.ord,
      fromId: r.from_id, toId: r.to_id, recordedAt: r.recorded_at,
    }));
}

// Edge keys with dedicated columns; any other key round-trips via `extra`.
const STD_EDGE_KEYS = new Set(["subject", "object", "subjectLabel", "objectLabel"]);

// node:sqlite still emits an ExperimentalWarning on first import. Using it is
// this module's deliberate choice, so the warning is pure noise for every
// consumer (library embedders, examples, bare `node` scripts) — swallow that
// one warning here, once, and re-emit everything else untouched.
let sqliteWarningFilterInstalled = false;
function installSqliteWarningFilter() {
  if (sqliteWarningFilterInstalled) return;
  sqliteWarningFilterInstalled = true;
  const prior = process.listeners("warning").slice();
  process.removeAllListeners("warning");
  process.on("warning", (warning) => {
    if (warning?.name === "ExperimentalWarning" && /sqlite/i.test(String(warning?.message))) return;
    if (prior.length) for (const l of prior) l(warning);
    else console.error(warning.stack || String(warning));
  });
}

/** Open (creating if absent) a resident node:sqlite connection: a Backend C
 *  handle `{ backend: "sqlite", db, dbPath }`, carrying the row-backend methods
 *  over its own tables. `node:sqlite` is imported lazily — only opting into
 *  this backend ever loads it. Meant to be opened once per session; close via
 *  closeSqliteMemoryStore at session end. */
export async function createSqliteMemoryStore(dbPath) {
  installSqliteWarningFilter();
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec(SQLITE_DDL);
  backfillFactsProjection(db);
  const handle = attachSqliteRowMethods({ backend: BACKEND_SQLITE, db, dbPath });
  backfillFactHeads(handle);
  return handle;
}

/** Close a Backend C handle's connection. A no-op for anything else (so a
 *  caller that doesn't know which backend it has can call this unconditionally
 *  at session end). A Backend D handle is closed through its own `impl.close()`
 *  instead — openMemoryBackend's returned `close` is the call site. */
export function closeSqliteMemoryStore(handle) {
  if (isSqliteHandle(handle)) handle.db.close();
}

/** Open a pre-built seed file READ-ONLY: the same tables
 *  `createSqliteMemoryStore` writes, opened without the DDL, the backfills or
 *  the WAL pragma, so the file itself never changes and it can sit on a
 *  read-only image layer. This is the base layer a
 *  `wrapRowBackendOverSqliteSeed` handle assembles under a session's own rows.
 *  No row-backend methods are attached: nothing may ever write here. Close it
 *  with `closeSqliteMemoryStore`. */
export async function openSqliteSeedStore(dbPath) {
  installSqliteWarningFilter();
  const { DatabaseSync } = await import("node:sqlite");
  return { backend: BACKEND_SQLITE, db: new DatabaseSync(dbPath, { readOnly: true }), dbPath, readOnly: true };
}

// ---- Backend D — a consumer's own row store ------------------------------
// The consumer constructs the store (row-backend.mjs is the contract) and
// tmct binds it into the same `memoryDir` token every memory call threads.
// The payload this handle hands back is `basePayload` overlaid with the rows
// the store holds; the payload it writes back is the DELTA against what it
// last assembled, so a turn pays for what it changed and nothing else.
//
// `basePayload` is a read-only overlay for a bundled seed graph. Its rows are
// assembled into every read and are excluded from every write, so a session
// over a 60k-fact seed still stores only the handful of facts that session
// taught.
//
// No cross-writer cache guard exists here, unlike Backend C's PRAGMA
// data_version check: a second writer's rows appear at this handle's next cold
// open, and the derived state recomputes then. A consumer that needs to see
// another writer's rows immediately constructs a fresh handle per request,
// which is what the serverless pattern does anyway.

const ROW_META_MEMORY_KEY = "memory";
const ROW_META_PREFIXES_KEY = "prefixes";
const ROW_SYLLOGISE_STATE_KEY = "syllogiseState";
const ROW_NODE_ID_KEY = "nodeId";

/** Bind a row backend as a `memoryDir` token: `{ backend: "row", impl,
 *  cachedPayload, basePayload }`. `basePayload` is the read-only seed overlay;
 *  `onOversizedRow` is the projection's posture for a record over the per-row
 *  cap ("throw", the default, or "drop"), and `log` takes the drop notices.
 *
 *  `sqliteSeedStore` is the same seed overlay held as an OPEN sqlite store
 *  (`openSqliteSeedStore`) instead of a parsed payload — see
 *  `wrapRowBackendOverSqliteSeed`, the entry point that takes one.
 *  `sqliteSeedOverlayRows` are rows that layer over that seed and under the
 *  session's own (a turn's retrieved corpus subgraph), read-only exactly as
 *  the seed is. */
export function wrapRowBackend(impl, {
  basePayload = null,
  sqliteSeedStore = null,
  sqliteSeedOverlayRows = null,
  onOversizedRow = "throw",
  log = undefined,
} = {}) {
  const problems = rowBackendProblems(impl);
  if (problems.length) {
    throw new BackendRejected(`not a memory row backend: ${problems.join("; ")}`);
  }
  if (sqliteSeedStore && !isSqliteHandle(sqliteSeedStore)) {
    throw new BackendRejected("sqliteSeedStore must be an open sqlite store handle (openSqliteSeedStore)");
  }
  if (sqliteSeedStore && basePayload) {
    throw new BackendRejected("a handle takes its seed either as a basePayload or as a sqliteSeedStore, never both");
  }
  return {
    backend: BACKEND_ROW,
    impl,
    cachedPayload: null,
    basePayload: cloneMemoryPayload(basePayload),
    sqliteSeedStore,
    sqliteSeedOverlayRows: sqliteSeedOverlayRows ? [...sqliteSeedOverlayRows] : null,
    sqliteSeedKeyOrds: null,
    baseRows: null,
    storedRows: null,
    onOversizedRow,
    log,
  };
}

/** `wrapRowBackend` over a seed held as an open read-only sqlite store. The
 *  seed's rows stream into assembly one at a time and the keys the session may
 *  never write come off the store's own key columns, so a 60k-fact seed is
 *  never materialized as a row array: the assembled payload is the only copy
 *  of it this process holds. `overlayRows` layer over the seed and under the
 *  session's own rows. */
export function wrapRowBackendOverSqliteSeed(impl, sqliteSeedStore, { overlayRows = null, onOversizedRow = "throw", log = undefined } = {}) {
  return wrapRowBackend(impl, { sqliteSeedStore, sqliteSeedOverlayRows: overlayRows, onOversizedRow, log });
}

/** Drain whatever `readRows()` returned: the contract allows an array or an
 *  async iterable, so a paginating backend can stream its pages. */
async function collectRows(source) {
  const value = await source;
  if (Array.isArray(value)) return value;
  const rows = [];
  for await (const row of value) rows.push(row);
  return rows;
}

/** The seed rows under the session's own, keyed so a session row with a base
 *  row's key wins. */
function overlayRows(baseRows, sessionRows) {
  const byKey = new Map();
  for (const row of baseRows) byKey.set(row.rowKey, row);
  for (const row of sessionRows) byKey.set(row.rowKey, row);
  return [...byKey.values()];
}

/** The seed keys this handle must never write or delete: every base row the
 *  session store does not already hold a row for. */
function seedOnlyKeys(handle) {
  const sessionKeys = new Set(handle.storedRows.map((r) => r.rowKey));
  const baseKeys = handle.sqliteSeedStore
    ? sqliteSeedKeyOrds(handle).keys()
    : handle.baseRows.map((r) => r.rowKey);
  const seedOnly = new Set();
  for (const key of baseKeys) if (!sessionKeys.has(key)) seedOnly.add(key);
  return seedOnly;
}

async function readRowMeta(handle, key, fallback) {
  const raw = await handle.impl.readMeta(key);
  if (raw === null || raw === undefined) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

/** loadMemory's read for Backend D: one `readRows()` per cold open, assembled
 *  once with the seed overlay, then served from `cachedPayload` with no
 *  further backend traffic. Bookkeeping rows are held aside — they round-trip
 *  through the store but never compose into a payload. */
async function readRowPayload(handle) {
  if (!handle.cachedPayload) {
    const empty = emptyMemory();
    const stored = await collectRows(handle.impl.readRows());
    handle.storedRows = stored.filter((row) => row?.rowClass !== BOOKKEEPING_ROW_CLASS);
    const meta = {
      memory: await readRowMeta(handle, ROW_META_MEMORY_KEY, seedScalar(handle, "memory", empty.memory)),
      prefixes: await readRowMeta(handle, ROW_META_PREFIXES_KEY, seedScalar(handle, "prefixes", empty.prefixes)),
    };
    if (handle.sqliteSeedStore) {
      handle.cachedPayload = assembleSqliteSeededPayload(handle, meta);
    } else {
      // "keep": the base overlay's own rows never reach the wire (persistRowPayload
      // excludes every seed key from every write via seedOnlyKeys below), so the
      // per-row byte cap that protects a real backend's real item-size limit has
      // nothing to protect here — capping it would silently drop a real corpus
      // band's own high-fan-out property (one edge per fact is normal, not a
      // pathology) and break every read that depends on it.
      handle.baseRows = payloadToRows(handle.basePayload || empty, { onOversizedRow: "keep" });
      handle.cachedPayload = rowsToPayload(overlayRows(handle.baseRows, handle.storedRows), { meta });
    }
  }
  return cloneJson(handle.cachedPayload);
}

/** A record with its audit stamp removed. `mgx:updatedAt` moves on every
 *  individual a trust recompute touches, which is every fact in the store on
 *  every mutate, so comparing raw bytes calls every row changed. */
function recordWithoutAuditStamp(json) {
  let record;
  try { record = JSON.parse(json); } catch { return json; }
  const ind = record?.individual;
  if (!Array.isArray(ind?.attributes)) return json;
  return JSON.stringify({
    ...record,
    individual: { ...ind, attributes: ind.attributes.filter((a) => a?.prop !== UPDATED_AT_PROP) },
  });
}

/** A row worth a write: something about it changed beyond the audit stamp. A
 *  row whose only difference is that stamp says nothing new, and writing it
 *  would let a handle with a stale read overwrite a concurrent writer's real
 *  change with its own no-op. */
function movedBeyondAuditStamp(beforeRow, row) {
  if (!beforeRow) return true;
  return recordWithoutAuditStamp(beforeRow.json) !== recordWithoutAuditStamp(row.json);
}

/** persistMemory's write for Backend D: project the mutated payload, diff it
 *  against what this handle last assembled, and write only the delta. A failed
 *  write drops the cache so the next read rebuilds from the store rather than
 *  from a payload that never landed. */
async function persistRowPayload(handle, payload) {
  await readRowPayload(handle);
  const seedKeys = seedOnlyKeys(handle);
  // On the sqlite path the seed is out of BOTH sides of the diff: the rows it
  // holds are exactly the keys no write may touch, so projecting them would
  // materialize the whole seed only to filter every row of it back out.
  const before = handle.sqliteSeedStore ? handle.storedRows : overlayRows(handle.baseRows, handle.storedRows);
  const beforeByKey = new Map(before.map((row) => [row.rowKey, row]));
  const after = payloadToRows(handle.sqliteSeedStore ? payloadWithoutRowKeys(payload, seedKeys) : payload, {
    priorRows: handle.sqliteSeedStore ? sqliteSeedPriorRows(handle) : before,
    onOversizedRow: handle.onOversizedRow,
    ...(handle.log ? { log: handle.log } : {}),
  });
  const { puts, deletes } = diffRows(before, after);
  const writes = puts
    .filter((row) => !seedKeys.has(row.rowKey))
    .filter((row) => movedBeyondAuditStamp(beforeByKey.get(row.rowKey), row));
  const removals = deletes.filter((key) => !seedKeys.has(key));
  try {
    if (writes.length) await handle.impl.putRows(writes);
    if (removals.length) await handle.impl.deleteRows(removals);
    await handle.impl.putMeta(ROW_META_MEMORY_KEY, JSON.stringify(payload.memory ?? emptyMemory().memory));
    await handle.impl.putMeta(ROW_META_PREFIXES_KEY, JSON.stringify(payload.prefixes ?? emptyMemory().prefixes));
  } catch (e) {
    handle.cachedPayload = null;
    handle.storedRows = null;
    handle.baseRows = null;
    throw e;
  }
  const removed = new Set(removals);
  const next = new Map(handle.storedRows.filter((row) => !removed.has(row.rowKey)).map((row) => [row.rowKey, row]));
  for (const row of writes) next.set(row.rowKey, row);
  handle.storedRows = [...next.values()];
  const meta = { memory: payload.memory, prefixes: payload.prefixes };
  // Dropped before the rebuild, not after it: the payload this replaces is the
  // largest object the handle holds, and keeping it reachable while the next
  // one assembles doubles the peak for no reason.
  handle.cachedPayload = null;
  handle.cachedPayload = handle.sqliteSeedStore
    ? assembleSqliteSeededPayload(handle, meta)
    : rowsToPayload(overlayRows(handle.baseRows, handle.storedRows), { meta });
}

/** The payload minus a set of row keys, for a projection that must not spend
 *  bytes on rows the write path is about to filter out anyway. */
function payloadWithoutRowKeys(payload, excluded) {
  if (!excluded.size) return payload;
  return {
    ...payload,
    individuals: (payload?.individuals || []).filter((ind) => !excluded.has(String(ind?.id ?? ""))),
    objectProperties: (payload?.objectProperties || []).filter((group) => !excluded.has(`${EDGE_GROUP_KEY_PREFIX}${group?.prop}`)),
  };
}

// ---- A sqlite store as the seed layer --------------------------------------
// The seed a Backend D handle reads under its session's own rows can be an
// open read-only sqlite store instead of a parsed payload. Nothing about the
// contract changes: the same rows assemble in the same order and the same keys
// are barred from every write. What changes is how many copies of the seed
// exist at once — the rows stream out of the store one at a time and the
// write path never projects them, so the assembled payload is the only one.

/** node:sqlite's row-at-a-time read where the runtime has it, the whole result
 *  set where it does not. Streaming is the point: a seed row is garbage the
 *  moment assembly has parsed it. */
function statementRowStream(statement) {
  return typeof statement.iterate === "function" ? statement.iterate() : statement.all();
}

/** Every row the seed store holds, one at a time. `coveredByAnotherLayer(key)`
 *  drops the keys the subgraph overlay or the session's own rows already own,
 *  so assembly sees each key exactly once. */
function* sqliteSeedRowStream(store, coveredByAnotherLayer) {
  const individuals = store.db.prepare(
    "SELECT i.id AS id, i.ord AS ord, i.class AS class, i.json AS json, f.subject AS subject"
    + " FROM individuals i LEFT JOIN facts f ON f.id = i.id ORDER BY i.ord, i.id",
  );
  for (const r of statementRowStream(individuals)) {
    if (coveredByAnotherLayer(r.id)) continue;
    const rowClass = ROW_CLASS_BY_INDIVIDUAL_CLASS.get(r.class) || "";
    yield {
      rowKey: r.id,
      rowClass,
      term: rowClass === "fact" ? normFactTerm(r.subject || "") : "",
      json: individualRowJson(r.ord, r.json),
    };
  }
  // One query per group rather than one over every edge in the store: a group
  // is freed as soon as assembly has taken it, so the edges of the largest
  // property are all this ever holds at once.
  const edgesOfProp = store.db.prepare(
    "SELECT subject, object, subject_label, object_label, extra FROM edges WHERE prop = ? ORDER BY rowid",
  );
  for (const relation of store.db.prepare("SELECT prop, ord, predicate, count FROM relations ORDER BY ord, prop").all()) {
    if (coveredByAnotherLayer(`${EDGE_GROUP_KEY_PREFIX}${relation.prop}`)) continue;
    const examples = [];
    for (const e of edgesOfProp.all(relation.prop)) {
      const edge = { subject: e.subject, object: e.object, subjectLabel: e.subject_label, objectLabel: e.object_label };
      if (e.extra) Object.assign(edge, JSON.parse(e.extra));
      examples.push(edge);
    }
    yield edgeGroupRow({ predicate: relation.predicate, prop: relation.prop, count: relation.count, examples }, relation.ord);
  }
  for (const row of readUnmappedRows(store.db)) {
    if (!coveredByAnotherLayer(row.rowKey)) yield row;
  }
}

/** Every key the read-only layers hold, with the ord each one carries — the
 *  keys-only view of the seed the write path needs. A key and an integer per
 *  row is small where the rows themselves are not, so this is held for the
 *  handle's life once a write has asked for it. */
function sqliteSeedKeyOrds(handle) {
  if (handle.sqliteSeedKeyOrds) return handle.sqliteSeedKeyOrds;
  const db = handle.sqliteSeedStore.db;
  const ords = new Map();
  for (const r of statementRowStream(db.prepare("SELECT id, ord FROM individuals"))) ords.set(r.id, r.ord);
  for (const r of statementRowStream(db.prepare("SELECT prop, ord FROM relations"))) ords.set(`${EDGE_GROUP_KEY_PREFIX}${r.prop}`, r.ord);
  for (const row of readUnmappedRows(db)) ords.set(row.rowKey, ordOfRow(row));
  for (const row of handle.sqliteSeedOverlayRows || []) ords.set(row.rowKey, ordOfRow(row));
  handle.sqliteSeedKeyOrds = ords;
  return ords;
}

/** What `payloadToRows` reads off prior rows: the ord each key already carries,
 *  in the smallest row shape that carries one. The session's own rows come
 *  last, so a key both layers hold keeps the session's ord — the precedence
 *  assembly gives it. */
function* sqliteSeedPriorRows(handle) {
  for (const [rowKey, ord] of sqliteSeedKeyOrds(handle)) yield { rowKey, json: `{"ord":${ord}}` };
  yield* handle.storedRows;
}

function* chainedRows(...sources) {
  for (const source of sources) yield* source;
}

/** seed ⊕ overlay ⊕ session, assembled once: the seed streams out of sqlite,
 *  the overlay rows layer over it, and the session's own rows win both. */
function assembleSqliteSeededPayload(handle, meta) {
  const covered = new Set(handle.storedRows.map((row) => row.rowKey));
  const overlay = (handle.sqliteSeedOverlayRows || []).filter((row) => row?.rowKey && !covered.has(row.rowKey));
  for (const row of overlay) covered.add(row.rowKey);
  return rowsToPayload(
    chainedRows(sqliteSeedRowStream(handle.sqliteSeedStore, (key) => covered.has(key)), overlay, handle.storedRows),
    { meta },
  );
}

/** Every distinct subject and object a seed store's facts carry, off the
 *  `facts` projection's own columns — the raw values, folded by whoever needs
 *  them. A caller that would otherwise walk the seed's individuals to collect
 *  its vocabulary asks the database instead and parses no record at all. */
export function* sqliteSeedFactTermValues(store) {
  for (const column of ["subject", "object"]) {
    for (const r of statementRowStream(store.db.prepare(`SELECT DISTINCT ${column} AS value FROM facts`))) {
      if (r.value) yield r.value;
    }
  }
}

/** The seed's own value for one of the two stored scalars, whichever way this
 *  handle holds its seed. */
function seedScalar(handle, key, fallback) {
  if (!handle.sqliteSeedStore) return handle.basePayload?.[key] ?? fallback;
  const row = handle.sqliteSeedStore.db.prepare("SELECT v FROM meta WHERE k = ?").get(key);
  if (!row) return fallback;
  try { return JSON.parse(row.v); } catch { return fallback; }
}

/** Resolve a backend token ("memory" | "sqlite" | anything else) into
 *  `{ dir, close }` — the ONE shared resolver, so every entry point (init's
 *  corpus seed, bin/tmct.mjs, chat) picks the same backend for a repo rather
 *  than silently splitting its memory across two stores. The empty/"default"
 *  token routes to the sqlite store: the flat-file Backend A is retired from
 *  routing (loadMemory/persistMemory still honour a plain dir string for
 *  callers that hold one directly).
 *
 *  `backendChoice` may also be an OBJECT: a row backend, which gets wrapped as
 *  a Backend D handle, or a handle wrapRowBackend already produced (the way a
 *  caller passes a seed overlay in). Either passes through untouched by config
 *  resolution — no repo path is read, nothing is created on disk — and the
 *  returned `close` closes the injected store. */
export async function openMemoryBackend(repoRoot, backendChoice) {
  if (isRowHandle(backendChoice)) {
    return { dir: backendChoice, close: async () => { await backendChoice.impl.close(); } };
  }
  if (isRowBackend(backendChoice)) {
    const handle = wrapRowBackend(backendChoice);
    return { dir: handle, close: async () => { await handle.impl.close(); } };
  }
  if (backendChoice === BACKEND_MEMORY) {
    return { dir: createInMemoryStore(), close: async () => {} };
  }
  const dbPath = join(repoRoot, ".tmct", "memory", "graph.sqlite");
  const exists = (p) => access(p).then(() => true, () => false);
  if (!(await exists(dbPath)) && (await exists(join(repoRoot, MEMORY_GRAPH_REL)))) {
    process.stderr.write("found .tmct/memory/graph.json — the flat-file memory backend is retired; starting a fresh sqlite store (the old file is left untouched)\n");
  }
  await mkdir(dirname(dbPath), { recursive: true });
  const handle = await createSqliteMemoryStore(dbPath);
  return { dir: handle, close: async () => closeSqliteMemoryStore(handle) };
}

/** openMemoryBackend for a caller that only wants to READ what a repo already
 *  holds: null when the repo has no store yet, because opening one creates it.
 *  The cold surfaces (the `cli` tool route) answer over a repo they were merely
 *  pointed at, and must leave a repo with no memory exactly as they found it.
 *  String tokens only — an injected row backend has no repo store to probe for,
 *  so a caller holding one calls openMemoryBackend directly. */
export async function openExistingMemoryBackend(repoRoot, backendChoice = "") {
  if (!repoRoot || typeof repoRoot !== "string") return null;
  const dbPath = join(repoRoot, ".tmct", "memory", "graph.sqlite");
  try { await access(dbPath); } catch { return null; }
  return openMemoryBackend(repoRoot, backendChoice);
}

/** A throwaway in-memory COPY of a store's facts: readers answer from the real
 *  data, and anything a reader writes lands in the copy rather than on disk.
 *  What a surface with no session behind it (the `cli` tool route, the HTTP
 *  messages endpoint) hands a reader that expects a memory handle, so a cold
 *  answer matches a chat answer without the cold call gaining a write. */
export async function readOnlyMemorySnapshot(memoryDir) {
  if (!memoryDir) return null;
  const snapshot = createInMemoryStore();
  applySeedPayload(snapshot, cloneMemoryPayload(await loadMemory(memoryDir)));
  return snapshot;
}

/** openMemoryBackend for an entry point that holds only a repo path and has no
 *  CLI-flag tier (the fold's idle pass, `tmct import --file`): resolve the
 *  backend token the way the chat path does minus the flag —
 *  TMCT_MEMORY_BACKEND env > tmct.toml's [memory] backend > the default. Config
 *  can only name a string backend, so an injected row backend never arrives
 *  here; a caller holding one calls openMemoryBackend directly. */
export async function openConfiguredMemoryBackend(repoRoot, env = process.env) {
  let backend = String(env?.TMCT_MEMORY_BACKEND || "").trim().toLowerCase();
  if (!backend) {
    try {
      const { loadTomlConfig } = await import("../toml-config.mjs");
      backend = String((await loadTomlConfig(repoRoot))?.memory?.backend || "").trim().toLowerCase();
    } catch { backend = ""; }
  }
  return openMemoryBackend(repoRoot, backend);
}

/** Deep-clone a JSON-safe value — keeps every cache read/write from aliasing
 *  the caller's own payload object. */
const cloneJson = (v) => (v === undefined ? v : structuredClone(v));

/** The loadMemory-equivalent read for Backend C: reconstructs from SQL once
 *  per handle (or after a failed write invalidates the cache), then returns a
 *  clone of `handle.cachedPayload` with zero SQL.
 *
 *  PRAGMA data_version guards the cache across CONNECTIONS: it ticks when any
 *  other connection commits to the same file (never for this connection's own
 *  writes, which the cache already mirrors in lockstep). Without the check, a
 *  second writer's rows would be invisible here — and this handle's next
 *  persist would delete them as absent-from-payload. */
function readSqlitePayload(handle) {
  const dataVersion = handle.db.prepare("PRAGMA data_version").get()?.data_version;
  if (handle.cachedPayload && handle.cachedDataVersion !== dataVersion) handle.cachedPayload = null;
  if (!handle.cachedPayload) {
    handle.cachedPayload = buildSqlitePayloadFromRows(handle);
    // The head index rides the same cache lifecycle as the payload it indexes,
    // so another connection's commit invalidates both together and the two can
    // never describe different stores.
    handle.cachedFactHeads = readFactHeadIndex(handle.db);
    handle.cachedDataVersion = dataVersion;
  }
  // Attached AFTER the clone: structuredClone drops symbol-keyed properties, so
  // the index has to be put back on each returned payload rather than copied.
  return attachFactHeads(cloneJson(handle.cachedPayload), handle.cachedFactHeads);
}

/** The actual SQL reconstruction — unchanged from the pre-cache implementation,
 *  just extracted so readSqlitePayload can call it only when the cache is
 *  cold. */
function buildSqlitePayloadFromRows(handle) {
  const db = handle.db;
  const empty = emptyMemory();
  const getMeta = (k, fallback) => {
    const row = db.prepare("SELECT v FROM meta WHERE k = ?").get(k);
    return row ? JSON.parse(row.v) : fallback;
  };

  const individuals = db.prepare("SELECT json FROM individuals ORDER BY ord").all()
    .map((r) => JSON.parse(r.json));

  return {
    generated_at: getMeta("generated_at", empty.generated_at),
    memory: getMeta("memory", empty.memory),
    prefixes: getMeta("prefixes", empty.prefixes),
    vocabulary: getMeta("vocabulary", empty.vocabulary),
    classes: getMeta("classes", empty.classes),
    objectProperties: sqliteEdgeGroups(db).map((entry) => entry.group),
    individuals,
    proseIndex: getMeta("proseIndex", empty.proseIndex),
  };
}

// ---- handle.cachedPayload mirrors: applied in lockstep with each SQL write
// so the cache always matches a fresh SQL reconstruction. ----------------

/** Mirrors `INSERT OR REPLACE INTO individuals(...)`: an existing id is
 *  replaced IN PLACE (same array position, matching how SQL keeps that row's
 *  `ord` — and so its sort position — unchanged on an update); a new id is
 *  appended (matching a fresh row getting the next `ord`). */
function cacheUpsertIndividual(cache, ind) {
  const clone = cloneJson(ind);
  const i = cache.individuals.findIndex((x) => x?.id === ind.id);
  if (i >= 0) cache.individuals[i] = clone;
  else cache.individuals.push(clone);
}

/** Mirrors `DELETE FROM individuals`: drop every cached individual the write
 *  just removed. */
function cacheDropIndividuals(cache, droppedIds) {
  cache.individuals = cache.individuals.filter((i) => !droppedIds.has(i?.id));
}

/** Find-or-create the cached edge group for `prop` — mirrors a relation row
 *  being implicitly created the first time a group is written. */
function cacheGroupFor(cache, prop) {
  let g = cache.objectProperties.find((x) => x?.prop === prop);
  if (!g) {
    g = { predicate: null, prop, count: 0, examples: [] };
    cache.objectProperties.push(g);
  }
  return g;
}

/** Mirrors `INSERT OR REPLACE INTO edges(...)`: a changed/new row sorts LAST
 *  under `ORDER BY rowid`, so this moves the entry to the end of `examples`
 *  rather than replacing it in place. NUL-delimited (subject,object) key,
 *  matching the SQL diff beside it — collision-proof, unlike a space. */
function cacheUpsertEdge(group, edge, extraKeys) {
  const key = `${edge.subject}\u0000${edge.object}`;
  group.examples = group.examples.filter((e) => `${e.subject}\u0000${e.object}` !== key);
  const cached = {
    subject: edge.subject, object: edge.object,
    subjectLabel: edge.subjectLabel ?? null, objectLabel: edge.objectLabel ?? null,
  };
  if (extraKeys.length) Object.assign(cached, cloneJson(Object.fromEntries(extraKeys.map((k) => [k, edge[k]]))));
  group.examples.push(cached);
}

/** Mirrors the per-group edge delete loop: drop any cached edge in this group
 *  whose (subject,object) key isn't in the just-persisted group's key set. */
function cacheDropEdgesExcept(group, newKeys) {
  group.examples = group.examples.filter((e) => newKeys.has(`${e.subject}\u0000${e.object}`));
}

/** Mirrors `DELETE FROM relations`: drop every cached edge group the write just
 *  removed. */
function cacheDropGroups(cache, droppedProps) {
  cache.objectProperties = cache.objectProperties.filter((g) => !droppedProps.has(g?.prop));
}

// ---- Backend C as a row store ---------------------------------------------
// The store's own tables ALREADY hold rows: an individual is a row keyed by its
// id, an edge group a row keyed by its prop, and the payload's scalars are meta
// values. The projection below says so in both directions, so one set of
// writers serves both callers — persistSqlitePayload, which diffs a mutated
// payload into rows, and the published row-backend contract (row-backend.mjs)
// the same handle answers.
//
// A row the tables cannot hand back byte for byte goes to `unmapped_rows`
// verbatim instead: a record whose class no row class covers, an index term the
// record itself does not imply, a bookkeeping entry, anything carrying its own
// TTL. That table is created the first time such a row arrives, so a store
// holding only tmct's own payload never grows one.

const EDGE_GROUP_ROW_CLASS = "edge-group";
const EDGE_GROUP_KEY_PREFIX = "edge-group:";

const ROW_CLASS_BY_INDIVIDUAL_CLASS = new Map([
  [FACT_CLASS, "fact"],
  [SOURCE_CLASS, "source"],
  [UTTERANCE_CLASS, "utterance"],
  [MEMORY_SESSION_CLASS, "session"],
  [RULE_CLASS, "rule"],
  [RETRACTION_CLASS, "retraction"],
]);

const UNMAPPED_ROWS_TABLE = "unmapped_rows";
const UNMAPPED_ROWS_DDL = `CREATE TABLE IF NOT EXISTS ${UNMAPPED_ROWS_TABLE} (
  row_key TEXT PRIMARY KEY, row_class TEXT NOT NULL, term TEXT NOT NULL, json TEXT NOT NULL, expires_at INTEGER
)`;
const UNMAPPED_ROWS_PRESENT_SQL = "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?";

const individualRowJson = (ord, json) => `{"ord":${ord},"individual":${json}}`;
const ROW_ORD_RE = /^\{"ord":(-?\d+),/;

/** The ord a row carries, read off the front of its own json. */
function ordOfRow(row) {
  const match = ROW_ORD_RE.exec(row?.json || "");
  if (match) return Number(match[1]);
  try {
    const ord = Number(JSON.parse(row.json).ord);
    return Number.isFinite(ord) ? ord : 0;
  } catch { return 0; }
}

/** One stored individual as a row. `json` is the blob the `individuals` table
 *  holds, passed in so the row and the table can never disagree about it. */
function individualRow(ind, ord, json) {
  const rowClass = ROW_CLASS_BY_INDIVIDUAL_CLASS.get(ind?.class) || "";
  return {
    rowKey: String(ind.id),
    rowClass,
    term: rowClass === "fact" ? normFactTerm(individualKey(ind, "subject")) : "",
    json: individualRowJson(ord, json),
  };
}

/** One edge with its four columns first and any other key after, so a group
 *  projected from a payload and the same group read back off the tables
 *  serialize to the same bytes. */
function canonicalEdge(edge) {
  const canonical = {
    subject: edge.subject,
    object: edge.object,
    subjectLabel: edge.subjectLabel ?? null,
    objectLabel: edge.objectLabel ?? null,
  };
  for (const key of Object.keys(edge)) if (!STD_EDGE_KEYS.has(key)) canonical[key] = edge[key];
  return canonical;
}

/** One edge group as a row, examples in stored order — that order is recency,
 *  since a changed edge moves to the end of its group. */
function edgeGroupRow(group, ord) {
  const examples = (group.examples || []).map(canonicalEdge);
  return {
    rowKey: `${EDGE_GROUP_KEY_PREFIX}${group.prop}`,
    rowClass: EDGE_GROUP_ROW_CLASS,
    term: "",
    json: JSON.stringify({
      ord,
      group: {
        predicate: group.predicate ?? null,
        prop: group.prop,
        count: Number.isFinite(group.count) ? group.count : examples.length,
        examples,
      },
    }),
  };
}

/** Every edge group in the store, each with the `relations` ord it sorts by.
 *  Edges come back in rowid order, which is the order they were last written. */
function sqliteEdgeGroups(db) {
  const byProp = new Map();
  for (const r of db.prepare("SELECT prop, ord, predicate, count FROM relations ORDER BY ord, prop").all()) {
    byProp.set(r.prop, {
      ord: r.ord,
      group: { predicate: r.predicate, prop: r.prop, count: r.count, examples: [] },
    });
  }
  if (!byProp.size) return [];
  for (const e of db.prepare("SELECT prop, subject, object, subject_label, object_label, extra FROM edges ORDER BY rowid").all()) {
    const entry = byProp.get(e.prop);
    if (!entry) continue;
    const edge = { subject: e.subject, object: e.object, subjectLabel: e.subject_label, objectLabel: e.object_label };
    if (e.extra) Object.assign(edge, JSON.parse(e.extra));
    entry.group.examples.push(edge);
  }
  return [...byProp.values()];
}

/** The rows the store's tables hold for the payload — its individuals and edge
 *  groups, and nothing else. This is what a payload write diffs against, so a
 *  verbatim row a consumer stored beside them is never in the diff and never
 *  deleted as absent-from-payload. Classes and terms come off the columns, so
 *  reading them parses no blob. */
function sqlitePayloadStoreRows(handle) {
  const rows = [];
  const stored = handle.db.prepare(
    "SELECT i.id AS id, i.ord AS ord, i.class AS class, i.json AS json, f.subject AS subject"
    + " FROM individuals i LEFT JOIN facts f ON f.id = i.id ORDER BY i.ord, i.id",
  ).all();
  for (const r of stored) {
    const rowClass = ROW_CLASS_BY_INDIVIDUAL_CLASS.get(r.class) || "";
    rows.push({
      rowKey: r.id,
      rowClass,
      term: rowClass === "fact" ? normFactTerm(r.subject || "") : "",
      json: individualRowJson(r.ord, r.json),
    });
  }
  for (const entry of sqliteEdgeGroups(handle.db)) rows.push(edgeGroupRow(entry.group, entry.ord));
  return rows;
}

/** A mutated payload as rows, plus what a write needs to apply each of them. An
 *  existing key keeps the ord it already had; a new one takes the next free
 *  number in its own sequence, since individuals and relations number
 *  separately, exactly as their tables do. */
function sqlitePayloadRows(payload, priorRows) {
  const priorOrd = new Map();
  let nextIndividualOrd = 0;
  let nextGroupOrd = 0;
  for (const row of priorRows) {
    const ord = ordOfRow(row);
    priorOrd.set(row.rowKey, ord);
    if (row.rowClass === EDGE_GROUP_ROW_CLASS) {
      if (ord >= nextGroupOrd) nextGroupOrd = ord + 1;
    } else if (ord >= nextIndividualOrd) nextIndividualOrd = ord + 1;
  }

  const rows = [];
  const partsByKey = new Map();
  for (const ind of payload.individuals || []) {
    if (!ind?.id) continue;
    const json = JSON.stringify(ind);
    const rowKey = String(ind.id);
    const ord = priorOrd.get(rowKey) ?? nextIndividualOrd++;
    rows.push(individualRow(ind, ord, json));
    partsByKey.set(rowKey, { kind: "individual", ord, individual: ind, json });
  }
  for (const group of payload.objectProperties || []) {
    if (!group?.prop) continue;
    const rowKey = `${EDGE_GROUP_KEY_PREFIX}${group.prop}`;
    const ord = priorOrd.get(rowKey) ?? nextGroupOrd++;
    const row = edgeGroupRow(group, ord);
    rows.push(row);
    partsByKey.set(rowKey, { kind: EDGE_GROUP_ROW_CLASS, ord, group: JSON.parse(row.json).group });
  }
  return { rows, partsByKey };
}

/** What a row is as far as the store's own tables are concerned: an individual
 *  or an edge group when they can hand it back byte for byte, null when only
 *  the verbatim table can hold it. */
function nativeRowParts(row) {
  if (row.expiresAt !== undefined) return null; // no column carries a TTL stamp
  let record;
  try { record = JSON.parse(row.json); } catch { return null; }
  if (!record || typeof record !== "object" || !Number.isFinite(record.ord)) return null;

  if (row.rowClass === EDGE_GROUP_ROW_CLASS) {
    const group = record.group;
    if (!group?.prop) return null;
    const rebuilt = edgeGroupRow(group, record.ord);
    if (rebuilt.rowKey !== row.rowKey || rebuilt.term !== row.term || rebuilt.json !== row.json) return null;
    return { kind: EDGE_GROUP_ROW_CLASS, ord: record.ord, group };
  }

  const ind = record.individual;
  if (!ind?.id) return null;
  const json = JSON.stringify(ind);
  const rebuilt = individualRow(ind, record.ord, json);
  if (rebuilt.rowKey !== row.rowKey || rebuilt.rowClass !== row.rowClass) return null;
  if (rebuilt.term !== row.term || rebuilt.json !== row.json) return null;
  return { kind: "individual", ord: record.ord, individual: ind, json };
}

/** The state one write transaction carries: the statements it reuses, the cache
 *  it patches in lockstep, and the groups and (subject, predicate) pairs it
 *  touched, so the two derived tables re-materialise for exactly what moved and
 *  nothing else. A group whose records are all untouched cannot have moved —
 *  its base carries no recency, so only its own records can change it. */
function sqliteWriteContext(handle, { cache = null } = {}) {
  const db = handle.db;
  return {
    db,
    cache,
    touchedGroups: new Set(),
    touchedPairs: new Set(),
    hasUnmappedRows: !!db.prepare(UNMAPPED_ROWS_PRESENT_SQL).get(UNMAPPED_ROWS_TABLE),
    unmapped: null,
    upsertInd: db.prepare("INSERT OR REPLACE INTO individuals(id, ord, class, label, json) VALUES (?, ?, ?, ?, ?)"),
    upsertFact: db.prepare(FACT_PROJECTION_UPSERT_SQL),
    deleteInd: db.prepare("DELETE FROM individuals WHERE id = ?"),
    deleteFact: db.prepare("DELETE FROM facts WHERE id = ?"),
    getFact: db.prepare("SELECT triple_hash, subject, predicate FROM facts WHERE id = ?"),
    upsertRel: db.prepare("INSERT OR REPLACE INTO relations(prop, ord, predicate, count) VALUES (?, ?, ?, ?)"),
    edgesForProp: db.prepare("SELECT subject, object, subject_label, object_label, extra FROM edges WHERE prop = ?"),
    upsertEdge: db.prepare("INSERT OR REPLACE INTO edges(prop, subject, object, subject_label, object_label, extra) VALUES (?, ?, ?, ?, ?, ?)"),
    deleteEdge: db.prepare("DELETE FROM edges WHERE prop = ? AND subject = ? AND object = ?"),
    deleteGroupEdges: db.prepare("DELETE FROM edges WHERE prop = ?"),
    deleteRel: db.prepare("DELETE FROM relations WHERE prop = ?"),
  };
}

/** The verbatim table's statements, creating the table the first time a write
 *  actually needs it. */
function unmappedStatements(ctx) {
  if (!ctx.unmapped) {
    ctx.db.exec(UNMAPPED_ROWS_DDL);
    ctx.hasUnmappedRows = true;
    ctx.unmapped = {
      upsert: ctx.db.prepare(`INSERT OR REPLACE INTO ${UNMAPPED_ROWS_TABLE}(row_key, row_class, term, json, expires_at) VALUES (?, ?, ?, ?, ?)`),
      remove: ctx.db.prepare(`DELETE FROM ${UNMAPPED_ROWS_TABLE} WHERE row_key = ?`),
    };
  }
  return ctx.unmapped;
}

/** Drop a key from the verbatim table, so no key ever lives in both lanes.
 *  Skipped whole for a store that has never held a verbatim row. */
function dropUnmappedRow(ctx, rowKey) {
  if (ctx.hasUnmappedRows) unmappedStatements(ctx).remove.run(rowKey);
}

function writeIndividualRow(ctx, { ord, individual, json }) {
  ctx.upsertInd.run(individual.id, ord, individual.class ?? null, individual.label ?? null, json);
  // The queryable projection of the blob just written, same transaction — every
  // write path that reaches a Fact (teach, corpus seed, entailment, migration, a
  // trust recompute) lands here, so none can leave the two out of step.
  if (individual.class === FACT_CLASS) {
    ctx.upsertFact.run(...factProjectionValues(individual, json));
    ctx.touchedGroups.add(factGroupId(individual.id));
    ctx.touchedPairs.add(subjectPredicateKey(individualKey(individual, "subject"), individualKey(individual, "predicate")));
  }
  dropUnmappedRow(ctx, String(individual.id));
  if (ctx.cache) cacheUpsertIndividual(ctx.cache, individual);
}

/** A group's edges, diffed WITHIN the group and scoped to its own rows
 *  (edges_by_prop) rather than the whole edges table — a group that gains one
 *  new edge (statedBy, touched by nearly every appendFact call) writes exactly
 *  that one row, not the group's entire history. */
function writeEdgeGroupRow(ctx, { ord, group }) {
  const existingByKey = new Map(
    ctx.edgesForProp.all(group.prop).map((r) => [`${r.subject} ${r.object}`, r]),
  );
  const newKeys = new Set();
  const cacheGroup = ctx.cache ? cacheGroupFor(ctx.cache, group.prop) : null;
  for (const e of group.examples || []) {
    const key = `${e.subject} ${e.object}`;
    newKeys.add(key);
    const extraKeys = Object.keys(e).filter((k) => !STD_EDGE_KEYS.has(k));
    const extra = extraKeys.length ? JSON.stringify(Object.fromEntries(extraKeys.map((k) => [k, e[k]]))) : null;
    const existing = existingByKey.get(key);
    const unchanged = existing
      && (existing.subject_label ?? null) === (e.subjectLabel ?? null)
      && (existing.object_label ?? null) === (e.objectLabel ?? null)
      && (existing.extra ?? null) === (extra ?? null);
    if (unchanged) continue;
    ctx.upsertEdge.run(group.prop, e.subject, e.object, e.subjectLabel ?? null, e.objectLabel ?? null, extra);
    if (cacheGroup) cacheUpsertEdge(cacheGroup, e, extraKeys);
  }
  for (const key of existingByKey.keys()) {
    if (newKeys.has(key)) continue;
    const [s, o] = key.split(" ");
    ctx.deleteEdge.run(group.prop, s, o);
  }
  if (cacheGroup) cacheDropEdgesExcept(cacheGroup, newKeys);
  const count = Number.isFinite(group.count) ? group.count : (group.examples || []).length;
  ctx.upsertRel.run(group.prop, ord, group.predicate ?? null, count);
  dropUnmappedRow(ctx, `${EDGE_GROUP_KEY_PREFIX}${group.prop}`);
  if (cacheGroup) { cacheGroup.predicate = group.predicate ?? null; cacheGroup.count = count; }
}

function writeUnmappedRow(ctx, row) {
  unmappedStatements(ctx).upsert.run(row.rowKey, row.rowClass, row.term, row.json, row.expiresAt ?? null);
}

/** Apply rows to the store's tables. `knownParts` is what the payload
 *  projection already worked out for the rows it minted, so the write path does
 *  not re-derive what it just built. */
function writeSqliteRows(ctx, rows, knownParts = null) {
  for (const row of rows) {
    const parts = knownParts?.get(row.rowKey) || nativeRowParts(row);
    if (!parts) { writeUnmappedRow(ctx, row); continue; }
    if (parts.kind === EDGE_GROUP_ROW_CLASS) writeEdgeGroupRow(ctx, parts);
    else writeIndividualRow(ctx, parts);
  }
}

/** Remove rows by key from whichever lane holds them. A retracted record's own
 *  group and (subject, predicate) are read off the projection BEFORE the row
 *  goes, since once it is gone there is nothing left to read them off. */
function deleteSqliteRows(ctx, rowKeys) {
  const droppedIndividuals = new Set();
  const droppedProps = new Set();
  for (const rowKey of rowKeys) {
    if (rowKey.startsWith(EDGE_GROUP_KEY_PREFIX)) {
      const prop = rowKey.slice(EDGE_GROUP_KEY_PREFIX.length);
      ctx.deleteGroupEdges.run(prop);
      ctx.deleteRel.run(prop);
      droppedProps.add(prop);
    } else {
      const gone = ctx.getFact.get(rowKey);
      if (gone) {
        ctx.touchedGroups.add(gone.triple_hash);
        ctx.touchedPairs.add(subjectPredicateKey(gone.subject, gone.predicate));
      }
      ctx.deleteInd.run(rowKey);
      ctx.deleteFact.run(rowKey); // a no-op for a non-Fact id; keeps the projection from outliving its blob
      droppedIndividuals.add(rowKey);
    }
    dropUnmappedRow(ctx, rowKey);
  }
  if (ctx.cache && droppedIndividuals.size) cacheDropIndividuals(ctx.cache, droppedIndividuals);
  if (ctx.cache && droppedProps.size) cacheDropGroups(ctx.cache, droppedProps);
}

/** Re-materialise the derived tables for what a write touched, inside that
 *  write's own transaction, so no reader can ever see one without the other. */
function recomputeDerivedTables(ctx, foldSource, headIndex) {
  if (!ctx.touchedGroups.size) return;
  const foldCtx = factFoldContext(foldSource);
  recomputeFactHeads(ctx.db, foldCtx, ctx.touchedGroups, headIndex);
  recordObjectSupersessions(ctx.db, foldCtx, ctx.touchedPairs);
}

/** Persist a mutated payload into a Backend C handle: the payload projected to
 *  rows, diffed against the rows already stored, and only the difference
 *  written, in one transaction. Patches `handle.cachedPayload` in lockstep; a
 *  rolled-back write invalidates the cache instead of leaving a partial patch.
 *
 *  The 4 KB wire cap the row contract enforces is not applied here: it protects
 *  a network hop, and a local file store holds a seed's whole statedBy group in
 *  one row. */
function persistSqlitePayload(handle, payload) {
  const db = handle.db;
  const empty = emptyMemory();
  const cache = handle.cachedPayload || null;
  db.exec("BEGIN IMMEDIATE");
  try {
    const setMeta = db.prepare("INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)");
    setMeta.run("generated_at", JSON.stringify(payload.generated_at ?? empty.generated_at));
    setMeta.run("memory", JSON.stringify(payload.memory ?? empty.memory));
    setMeta.run("prefixes", JSON.stringify(payload.prefixes ?? empty.prefixes));
    setMeta.run("vocabulary", JSON.stringify(payload.vocabulary ?? empty.vocabulary));
    setMeta.run("classes", JSON.stringify(payload.classes ?? empty.classes));
    setMeta.run("proseIndex", JSON.stringify(payload.proseIndex ?? empty.proseIndex));
    if (cache) {
      cache.generated_at = cloneJson(payload.generated_at ?? empty.generated_at);
      cache.memory = cloneJson(payload.memory ?? empty.memory);
      cache.prefixes = cloneJson(payload.prefixes ?? empty.prefixes);
      cache.vocabulary = cloneJson(payload.vocabulary ?? empty.vocabulary);
      cache.classes = cloneJson(payload.classes ?? empty.classes);
      cache.proseIndex = cloneJson(payload.proseIndex ?? empty.proseIndex);
    }

    const ctx = sqliteWriteContext(handle, { cache });
    const before = sqlitePayloadStoreRows(handle);
    const { rows: after, partsByKey } = sqlitePayloadRows(payload, before);
    const { puts, deletes } = diffRows(before, after);
    writeSqliteRows(ctx, puts, partsByKey);
    deleteSqliteRows(ctx, deletes);
    recomputeDerivedTables(ctx, payload, handle.cachedFactHeads);

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    // The cache may hold a partially-applied patch at this point (some of the
    // writes above already mutated it before the failure) that was never
    // actually committed to SQLite — never trust it silently. Drop it so the
    // next loadMemory() call does an honest full rebuild instead.
    handle.cachedPayload = undefined;
    handle.cachedFactHeads = undefined;
    throw e;
  }
}

// ---- The row-backend contract, over the same tables ------------------------

/** Every verbatim row still live, expired ones filtered out the way the
 *  reference backend filters its own. */
function readUnmappedRows(db) {
  if (!db.prepare(UNMAPPED_ROWS_PRESENT_SQL).get(UNMAPPED_ROWS_TABLE)) return [];
  const now = Math.floor(Date.now() / 1000);
  const rows = [];
  for (const r of db.prepare(`SELECT row_key, row_class, term, json, expires_at FROM ${UNMAPPED_ROWS_TABLE}`).all()) {
    if (r.expires_at !== null && r.expires_at <= now) continue;
    const row = { rowKey: r.row_key, rowClass: r.row_class, term: r.term, json: r.json };
    if (r.expires_at !== null) row.expiresAt = r.expires_at;
    rows.push(row);
  }
  return rows;
}

/** Run `write` in one transaction, then drop the caches: a row write reaches
 *  the tables without going through the payload those caches mirror, so the
 *  next read rebuilds from the tables rather than from a payload that no longer
 *  describes them. */
function inSqliteRowTransaction(handle, write) {
  const db = handle.db;
  db.exec("BEGIN IMMEDIATE");
  try {
    write(sqliteWriteContext(handle));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    handle.cachedPayload = null;
    handle.cachedFactHeads = null;
  }
}

const SQLITE_TABLES = Object.freeze([
  "meta", "individuals", "relations", "edges", "facts", "fact_heads", "fact_object_supersessions",
]);

/** Give a Backend C handle the published row-backend methods (row-backend.mjs).
 *  They read and write the same seven tables the payload path does, so a
 *  consumer holding the store as a row backend and tmct holding it as a memory
 *  store see one store rather than two. */
function attachSqliteRowMethods(handle) {
  return Object.assign(handle, {
    async readRows() {
      return [...sqlitePayloadStoreRows(handle), ...readUnmappedRows(handle.db)];
    },

    async readRowsByTerm(term) {
      return (await handle.readRows()).filter((row) => row.term === term);
    },

    async putRows(candidateRows) {
      // Validate every row before writing any of them, so a batch carrying one
      // malformed row is refused whole rather than half-applied.
      const validated = (candidateRows || []).map((row) => assertValidRow(row));
      if (!validated.length) return;
      inSqliteRowTransaction(handle, (ctx) => {
        writeSqliteRows(ctx, validated);
        recomputeDerivedTables(ctx, buildSqlitePayloadFromRows(handle), null);
      });
    },

    async deleteRows(rowKeys) {
      const keys = [...(rowKeys || [])];
      if (!keys.length) return;
      inSqliteRowTransaction(handle, (ctx) => {
        deleteSqliteRows(ctx, keys);
        recomputeDerivedTables(ctx, buildSqlitePayloadFromRows(handle), null);
      });
    },

    async readMeta(key) {
      const row = handle.db.prepare("SELECT v FROM meta WHERE k = ?").get(key);
      return row ? row.v : null;
    },

    async putMeta(key, value) {
      handle.db.prepare("INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)").run(key, String(value));
      handle.cachedPayload = null;
      handle.cachedFactHeads = null;
    },

    async deleteAll() {
      const db = handle.db;
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const table of SQLITE_TABLES) db.exec(`DELETE FROM ${table}`);
        if (db.prepare(UNMAPPED_ROWS_PRESENT_SQL).get(UNMAPPED_ROWS_TABLE)) db.exec(`DELETE FROM ${UNMAPPED_ROWS_TABLE}`);
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      } finally {
        handle.cachedPayload = null;
        handle.cachedFactHeads = null;
      }
    },

    async close() {
      closeSqliteMemoryStore(handle);
    },
  });
}

/** A sqlite file as an injectable row backend: the same store
 *  `createSqliteMemoryStore` opens, presented under the published contract. The
 *  connection opens on the first call, so constructing one touches no disk and
 *  needs no await. */
export function createSqliteRowBackend(dbPath) {
  let opening = null;
  let closed = false;
  const handle = () => {
    if (closed) throw new BackendUnavailable("this row backend was closed and can no longer be used");
    opening = opening || createSqliteMemoryStore(dbPath);
    return opening;
  };
  const through = (method) => async (...args) => (await handle())[method](...args);
  return {
    kind: ROW_BACKEND_KIND,
    contractVersion: ROW_BACKEND_CONTRACT_VERSION,
    readRows: through("readRows"),
    readRowsByTerm: through("readRowsByTerm"),
    putRows: through("putRows"),
    deleteRows: through("deleteRows"),
    readMeta: through("readMeta"),
    putMeta: through("putMeta"),
    deleteAll: through("deleteAll"),
    async close() {
      const open = opening ? await opening : null;
      closed = true;
      if (open) closeSqliteMemoryStore(open);
    },
  };
}

/** Atomic write of raw text (temp in the same dir + rename) — the discipline
 *  every writer in this module (and fold.mjs/sessions.mjs's own copies) uses:
 *  a crash never destroys the previous file, a concurrent reader never sees a
 *  torn one. */
async function atomicWriteText(file, text) {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  await writeFile(tmp, text);
  await rename(tmp, file);
}

/** Atomic JSON write (temp in the same dir + rename) — same discipline as
 *  sessions.mjs's graph append: a crash never destroys the previous store. */
async function atomicWriteJson(file, obj) {
  await atomicWriteText(file, JSON.stringify(obj));
}

// ---- Manifest-versioned snapshots (manual trigger only — NOT wired to any ----
// ---- automatic call site; a primitive for a future CLI command/maintenance --
// ---- hook, PLAN item "memory-tree versioning") -------------------------------

export const MEMORY_MANIFEST_REL = join(MEMORY_DIR_REL, "manifest.json");
export const DEFAULT_RETENTION = 5;

const resolveManifestFile = (dir) => join(dir, MEMORY_MANIFEST_REL);

/** Snapshot the current live graph.json into a numbered `graph.v{N}.json`,
 *  advance the manifest, and best-effort prune the snapshot that falls
 *  outside the retention window. graph.json itself is never touched — only a
 *  copy becomes the new version. No graph.json yet -> `{ skipped: true }`.
 *  Once a manifest exists, its retentionVersions is authoritative over
 *  `opts.retentionVersions`. Returns `{ skipped, version, prunedVersion }`. */
export async function snapshotMemory(dir, { retentionVersions } = {}) {
  if (isMemoryOrSqliteHandle(dir)) {
    throw new Error("snapshotMemory only supports the flat-JSON backend (Backend A) — a store handle has no on-disk graph.json to snapshot");
  }
  const graphFile = resolveMemoryGraphFile(dir);
  let graphText;
  try {
    graphText = await readFile(graphFile, "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return { skipped: true, version: null, prunedVersion: null };
    throw e;
  }

  const manifestFile = resolveManifestFile(dir);
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  } catch (e) {
    if (e?.code !== "ENOENT") throw e;
    manifest = { version: 0, retentionVersions: retentionVersions ?? DEFAULT_RETENTION };
  }
  if (!Number.isInteger(manifest.version)) manifest.version = 0;
  if (!Number.isInteger(manifest.retentionVersions)) manifest.retentionVersions = retentionVersions ?? DEFAULT_RETENTION;

  const v = manifest.version; // the version being written THIS call
  const versionedFile = resolveMemoryGraphFile(dir, v);
  await mkdir(dirname(versionedFile), { recursive: true });
  await atomicWriteText(versionedFile, graphText);

  manifest.version = v + 1;

  let prunedVersion = null;
  const pruneTarget = v - manifest.retentionVersions;
  if (pruneTarget >= 0) {
    try {
      await unlink(resolveMemoryGraphFile(dir, pruneTarget));
      prunedVersion = pruneTarget;
    } catch (e) {
      if (e?.code !== "ENOENT") throw e; // best-effort: a vanished snapshot is fine, anything else is not
    }
  }

  await atomicWriteJson(manifestFile, manifest);
  return { skipped: false, version: v, prunedVersion };
}

/** Load the memory graph for a repo dir OR a Backend B/C/D handle (see the
 *  storage-backend seam above `createInMemoryStore`). A missing Backend-A
 *  store is the bootstrap: return the empty payload (uncached — the first
 *  append creates the file). The result is a raw entities payload;
 *  parseEntities() loads it. */
export async function loadMemory(dir) {
  if (isMemoryHandle(dir)) return migrateStoredMemory(dir.payload);
  if (isSqliteHandle(dir)) return migrateStoredMemory(readSqlitePayload(dir));
  if (isRowHandle(dir)) return migrateStoredMemory(await readRowPayload(dir));
  let text;
  try {
    text = await readFile(memoryGraphFile(dir), "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return emptyMemory();
    throw e;
  }
  return migrateStoredMemory(JSON.parse(text));
}

/** The lazy on-load migrations, in order: heal a pre-widening fact id first, so
 *  the assertion re-key that follows content-addresses off the current one.
 *  Both are pure payload transforms and both converge to no-ops. */
const migrateStoredMemory = (payload) => migrateFactAssertionKeys(migrateLegacyFactIds(payload));

// A Fact id written before factIdFor widened to 64 bits — `fact:` + exactly 8
// hex. A current id is 16 hex, so this anchored test never matches one, and a
// migrated store pays only string checks with no rehash on load.
const LEGACY_FACT_ID_RE = /^fact:[0-9a-f]{8}$/;

/** Bring a store written under the old 32-bit fact id up to the current
 *  factIdFor id, in place, on load. Every Fact carries its own (s, p, o) in
 *  rdf:subject/predicate/object, so the current id recomputes from the payload
 *  with no external key. Rewrites the Fact ids and everything that points at
 *  them by id: statedBy/derivedFrom (and every other) edge endpoint, a rule's
 *  mgx:factJustification premise-id list, and derived_from links. Idempotent —
 *  a Fact already on a wide id is skipped by LEGACY_FACT_ID_RE, so a
 *  fully-migrated store makes no change and does no work beyond the shape test.
 *  This is what lets a pre-widening store keep resolving its facts: a lookup by
 *  the current id finds the Fact because load moved it onto that id. */
function migrateLegacyFactIds(payload) {
  if (!Array.isArray(payload?.individuals)) return payload;
  const remap = new Map(); // old fact id -> current fact id
  for (const ind of payload.individuals) {
    if (ind?.class !== FACT_CLASS || !LEGACY_FACT_ID_RE.test(ind.id || "")) continue;
    const get = (k) => (ind.attributes || []).find((a) => a?.key === k)?.value || "";
    const currentId = factIdFor(get("subject"), get("predicate"), get("object"));
    if (currentId === ind.id) continue;
    remap.set(ind.id, currentId);
    ind.id = currentId;
  }
  if (!remap.size) return payload;
  const remapId = (id) => remap.get(id) || id;
  for (const group of payload.objectProperties || []) {
    for (const e of group.examples || []) {
      if (!e) continue;
      if (remap.has(e.subject)) e.subject = remap.get(e.subject);
      if (remap.has(e.object)) e.object = remap.get(e.object);
    }
  }
  for (const ind of payload.individuals) {
    if (Array.isArray(ind?.derived_from) && ind.derived_from.length) ind.derived_from = ind.derived_from.map(remapId);
    const just = (ind?.attributes || []).find((a) => a?.prop === "mgx:factJustification");
    if (just?.value) {
      // Environment-aware: the value is ' | '-separated premise-id lists, one
      // per independent derivation — remap the ids inside each, keep the shape.
      just.value = just.value.split(" | ")
        .map((env) => env.split(" ").filter(Boolean).map(remapId).join(" "))
        .filter(Boolean)
        .join(" | ");
    }
  }
  return payload;
}

/**
 * Re-key every pre-assertion-model Fact — one record per TRIPLE, its provenance
 * a cross-source `" | "` union — into one record per (triple, source), in
 * place, on load. Same slot and same contract as the two migrations above:
 * a pure payload transform, deterministic, and a no-op on a migrated store (a
 * record id carries `@`, so the scan below never picks one up twice).
 *
 * Every OTHER reference to the bare id — a mgx:factJustification premise list,
 * derived_from, an edge endpoint like canonicalisedFrom — is left exactly as it
 * was. A bare `fact:<hash>` IS the group id under this model, so those
 * references keep resolving and the public fact id survives the migration.
 * Only the statedBy edges move, because those are per-record by definition.
 */
function migrateFactAssertionKeys(payload) {
  if (!Array.isArray(payload?.individuals)) return payload;
  const statedGroup = (payload.objectProperties || []).find((g) => g?.prop === STATED_BY_PROP);
  const legacyStatedBy = new Map(); // legacy fact id -> its own statedBy edges
  for (const e of statedGroup?.examples || []) {
    if (!e?.subject) continue;
    const list = legacyStatedBy.get(e.subject);
    if (list) list.push(e);
    else legacyStatedBy.set(e.subject, [e]);
  }
  const replaced = new Set();
  const legacyRecords = new Map(); // legacy fact id -> the record ids it became
  const records = [];
  const carriedEdges = [];
  const individuals = [];
  for (const ind of payload.individuals) {
    if (ind?.class !== FACT_CLASS || String(ind.id || "").includes("@")) { individuals.push(ind); continue; }
    const attr = (prop) => (ind.attributes || []).find((a) => a?.prop === prop)?.value || "";
    const s = attr("rdf:subject");
    const p = attr("rdf:predicate");
    const o = attr("rdf:object");
    if (!s || !p || !o) { individuals.push(ind); continue; } // no readable triple to re-key on
    const groupId = factIdFor(s, p, o);
    const legacyCreated = attr(CREATED_AT_PROP);
    const provenance = attr("mgx:factProvenance");
    const edges = legacyStatedBy.get(ind.id) || [];
    const groups = provenance ? groupTagsBySource(provenance) : [];
    // A store can carry a statedBy edge whose Source no surviving tag names —
    // an early write, or a provenance string that was never backfilled. The
    // edge is the attribution in that case, so it earns its own tagless record
    // rather than being scrubbed along with the row it hung off.
    for (const e of edges) {
      if (!groups.some((g) => g.sourceId === e.object)) groups.push({ sourceId: e.object, sourceType: "", tags: [] });
    }
    if (!groups.length) groups.push({ sourceId: NO_SOURCE_ID, sourceType: "", tags: [] });
    const emitted = [];
    for (const group of groups) {
      const record = {
        id: `${groupId}@${group.sourceId}`,
        label: ind.label,
        class: FACT_CLASS,
        derived_from: cloneJson(ind.derived_from) || [],
        mentions: cloneJson(ind.mentions) || [],
        attributes: [
          { prop: "rdf:type", key: "type", value: "rdf:Statement" },
          { prop: "rdf:subject", key: "subject", value: s },
          { prop: "rdf:predicate", key: "predicate", value: p },
          { prop: "rdf:object", key: "object", value: o },
          // This source's own FIRST assertion of the triple, so a record's
          // createdAt keeps meaning "when this hop said it", never "when the
          // legacy row happened to be written".
          { prop: CREATED_AT_PROP, key: "createdAt", value: assertionTimestampFor(group.tags, legacyCreated, Math.min) || legacyCreated || nowIso() },
          { prop: SOURCE_ID_PROP, key: "sourceId", value: group.sourceId },
          ...(group.tags.length ? [{ prop: "mgx:factProvenance", key: "provenance", value: group.tags.join(" | ") }] : []),
          // Triple-level values, duplicated onto every sibling: a few bytes
          // each, and it keeps every record readable on its own.
          ...(attr("mgx:hasProseTokens") ? [{ prop: "mgx:hasProseTokens", key: "prose_tokens", value: attr("mgx:hasProseTokens") }] : []),
          ...(attr("mgx:factQuantifier") ? [{ prop: "mgx:factQuantifier", key: "quantifier", value: attr("mgx:factQuantifier") }] : []),
          // The justification explains the ENTAILMENT, not the corroborators,
          // so it rides only the entailed record.
          ...(group.sourceType === "entailed" && attr("mgx:factJustification")
            ? [{ prop: "mgx:factJustification", key: "justification", value: attr("mgx:factJustification") }] : []),
        ],
      };
      individuals.push(record);
      records.push(record);
      emitted.push(record.id);
      if (group.sourceId !== NO_SOURCE_ID) {
        const prior = edges.find((e) => e?.object === group.sourceId);
        carriedEdges.push({
          ...(prior || {}), subject: record.id, object: group.sourceId,
          subjectLabel: record.label, objectLabel: sourceLabel(group.sourceId),
        });
      }
    }
    replaced.add(ind.id);
    legacyRecords.set(ind.id, emitted);
  }
  if (!replaced.size) return payload;

  // The legacy row's statedBy edges named a fact that no longer exists; each
  // record inherits the one edge that is actually its own, keeping that edge's
  // original createdAt so a migration never resets when a source first spoke.
  if (statedGroup) {
    statedGroup.examples = (statedGroup.examples || []).filter((e) => !replaced.has(e?.subject));
    statedGroup.examples.push(...carriedEdges);
    statedGroup.count = statedGroup.examples.length;
  } else if (carriedEdges.length) {
    payload.objectProperties = payload.objectProperties || [];
    payload.objectProperties.push({ predicate: "statedBy", prop: STATED_BY_PROP, count: carriedEdges.length, examples: carriedEdges });
  }

  // Every OTHER edge that named a re-keyed fact — canonicalisedFrom, derivedFrom
  // — is redrawn onto the records now holding that triple. An edge endpoint has
  // to be a node a graph walker can dereference, so unlike a justification
  // premise list (which is a reference to the TRIPLE, and resolves through the
  // group id readFactRows still reports) it cannot be left pointing at a group.
  for (const group of payload.objectProperties || []) {
    if (group?.prop === STATED_BY_PROP || !group?.examples?.length) continue;
    const redrawn = [];
    for (const e of group.examples) {
      const subjects = replaced.has(e?.subject) ? (legacyRecords.get(e.subject) || []) : [e?.subject];
      const objects = replaced.has(e?.object) ? (legacyRecords.get(e.object) || []) : [e?.object];
      for (const subject of subjects) {
        for (const object of objects) redrawn.push({ ...e, subject, object });
      }
    }
    group.examples = redrawn;
    group.count = redrawn.length;
  }
  payload.individuals = individuals;
  buildMemoryIndex(payload);
  // The add-only, idempotent path that already exists: rebuild each record's
  // Source, its statedBy edge, and its own single-source trust.
  for (const record of records) syncFactSources(payload, record);
  recountClasses(payload);
  return payload;
}

/** Persist a mutated payload back to `dir`: an atomic file write (Backend A),
 *  a no-op assignment (Backend B, already the live object), a diffed per-row
 *  SQL write (Backend C, persistSqlitePayload), or a diffed row write into an
 *  injected store (Backend D, persistRowPayload). */
async function persistMemory(dir, payload) {
  if (isMemoryHandle(dir)) { dir.payload = payload; return; }
  if (isSqliteHandle(dir)) { persistSqlitePayload(dir, payload); return; }
  if (isRowHandle(dir)) { await persistRowPayload(dir, payload); return; }
  await mkdir(dirname(memoryGraphFile(dir)), { recursive: true });
  await atomicWriteJson(memoryGraphFile(dir), payload);
}

// ---- Syllogise watermark state: a small backend-dispatched sidecar ---------
// { version, factIds, completedAt } — the fact ids at the end of the last
// COMPLETE syllogise pass. syllogise() diffs it against the live store to
// pick delta or full evaluation; a missing/removed-id state means full.

export const SYLLOGISE_STATE_REL = join(MEMORY_DIR_REL, "syllogise-state.json");
const SQLITE_SYLLOGISE_STATE_KEY = "syllogiseState";

/** Load the syllogise watermark for a repo dir OR a Backend B/C/D handle.
 *  Null when no complete pass has recorded one. */
export async function loadSyllogiseState(dir) {
  if (isMemoryHandle(dir)) return dir.syllogiseState ? structuredClone(dir.syllogiseState) : null;
  if (isSqliteHandle(dir)) {
    const row = dir.db.prepare("SELECT v FROM meta WHERE k = ?").get(SQLITE_SYLLOGISE_STATE_KEY);
    return row?.v ? JSON.parse(row.v) : null;
  }
  if (isRowHandle(dir)) return readRowMeta(dir, ROW_SYLLOGISE_STATE_KEY, null);
  try {
    return JSON.parse(await readFile(join(dir, SYLLOGISE_STATE_REL), "utf8"));
  } catch (e) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
}

/** Persist the syllogise watermark — atomic file write (Backend A), a cloned
 *  handle field (Backend B), a meta-table row (Backend C), or a meta value in
 *  the injected store (Backend D). A watermark is one scalar whose worst race
 *  costs a redundant re-syllogise, which is why it travels as meta rather than
 *  as rows. */
export async function saveSyllogiseState(dir, state) {
  if (isMemoryHandle(dir)) { dir.syllogiseState = structuredClone(state); return; }
  if (isSqliteHandle(dir)) {
    dir.db.prepare("INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)").run(SQLITE_SYLLOGISE_STATE_KEY, JSON.stringify(state));
    return;
  }
  if (isRowHandle(dir)) { await dir.impl.putMeta(ROW_SYLLOGISE_STATE_KEY, JSON.stringify(state)); return; }
  const file = join(dir, SYLLOGISE_STATE_REL);
  await mkdir(dirname(file), { recursive: true });
  await atomicWriteJson(file, state);
}

// ---- Node id: the stable per-store P2P identity, a second sidecar ----------
// 16 hex, minted the first time a store joins a room and never regenerated.
// Persisted beside the store rather than inside the graph so it survives a
// store that gets re-seeded, and so nothing about it ever replicates: a node
// id is this store's own name for itself, not a fact about the world.

export const NODE_ID_REL = join(MEMORY_DIR_REL, "node-id.json");
const SQLITE_NODE_ID_KEY = "nodeId";

/** This store's node id, or null when it has never joined a room. */
export async function loadNodeId(dir) {
  if (isMemoryHandle(dir)) return dir.nodeId || null;
  if (isSqliteHandle(dir)) {
    const row = dir.db.prepare("SELECT v FROM meta WHERE k = ?").get(SQLITE_NODE_ID_KEY);
    return row?.v ? JSON.parse(row.v).nodeId || null : null;
  }
  if (isRowHandle(dir)) return (await readRowMeta(dir, ROW_NODE_ID_KEY, null))?.nodeId || null;
  try {
    return JSON.parse(await readFile(join(dir, NODE_ID_REL), "utf8")).nodeId || null;
  } catch (e) {
    if (e?.code === "ENOENT") return null;
    throw e;
  }
}

/** Record this store's node id — atomic file write (Backend A), a handle field
 *  (Backend B), a meta-table row (Backend C), or a meta value in the injected
 *  store (Backend D). Callers mint through resolveStoreNodeId, which never
 *  overwrites an id a store already holds, so this value is written once. */
export async function saveNodeId(dir, nodeId) {
  if (isMemoryHandle(dir)) { dir.nodeId = nodeId; return; }
  if (isSqliteHandle(dir)) {
    dir.db.prepare("INSERT OR REPLACE INTO meta(k, v) VALUES (?, ?)").run(SQLITE_NODE_ID_KEY, JSON.stringify({ nodeId }));
    return;
  }
  if (isRowHandle(dir)) { await dir.impl.putMeta(ROW_NODE_ID_KEY, JSON.stringify({ nodeId })); return; }
  const file = join(dir, NODE_ID_REL);
  await mkdir(dirname(file), { recursive: true });
  await atomicWriteJson(file, { nodeId });
}

/** Fresh read -> mutate -> atomic write. Serialized per call; every public
 *  append goes through here, including the lazy legacy-provenance migration
 *  and actor-level Source reliability recompute. `fn` may be async (the
 *  SHACL ingest gate awaits validation before ever mutating `payload`). */
// Per-call lookup index (individualsById/sourcesById/statedByBySubject),
// attached to payload under a Symbol key (skipped by JSON.stringify) so
// upsertIndividual/upsertSource/upsertEdge/appendFacts get O(1) lookups
// instead of re-scanning; discarded when mutateMemory returns.
const MEMORY_INDEX = Symbol("mutateMemory lookup index");

/** Build the three lookup Maps from the just-loaded payload and attach them
 *  under MEMORY_INDEX. */
function buildMemoryIndex(payload) {
  const individualsById = new Map();
  const sourcesById = new Map();
  const statedByBySubject = new Map();
  // groupId -> the record ids asserting that triple, so a write can ask "is
  // anyone asserting this yet" and an edge can resolve a group id to the real
  // nodes behind it, both without a scan.
  const factRecordsByGroup = new Map();
  // groupId -> the retraction records standing over that triple, so the write
  // path can ask "was this source's assertion retracted" without a scan. Almost
  // always empty, which is why it is read before anything more expensive.
  const retractionsByGroup = new Map();
  for (const ind of payload.individuals || []) {
    if (!ind?.id) continue;
    individualsById.set(ind.id, ind);
    if (ind.class === SOURCE_CLASS) sourcesById.set(ind.id, ind);
    if (ind.class === RETRACTION_CLASS) indexRetraction(retractionsByGroup, ind);
    if (ind.class === FACT_CLASS) {
      const groupId = factGroupId(ind.id);
      const held = factRecordsByGroup.get(groupId);
      if (held) held.push(ind.id);
      else factRecordsByGroup.set(groupId, [ind.id]);
    }
  }
  const statedGroup = (payload.objectProperties || []).find((g) => g?.prop === STATED_BY_PROP);
  for (const e of statedGroup?.examples || []) {
    if (!e?.subject) continue;
    const list = statedByBySubject.get(e.subject);
    if (list) list.push(e.object);
    else statedByBySubject.set(e.subject, [e.object]);
  }
  payload[MEMORY_INDEX] = { individualsById, sourcesById, statedByBySubject, factRecordsByGroup, retractionsByGroup };
  return payload[MEMORY_INDEX];
}

/** File one retraction record under the triple it stands over, replacing any
 *  earlier reference to the same id — upsertIndividual merges in place, so the
 *  index must hold the record the payload holds, not a stale copy of it. */
function indexRetraction(retractionsByGroup, record) {
  const groupId = factGroupId(record.id);
  const held = (retractionsByGroup.get(groupId) || []).filter((r) => r.id !== record.id);
  held.push(record);
  retractionsByGroup.set(groupId, held);
}

/** Every retraction record standing over one triple. Reads the index when there
 *  is one and falls back to a scan for a hand-built fixture, exactly as the
 *  rollup lookup beside it does. */
function retractionsFor(payload, groupId) {
  const idx = memoryIndexOf(payload);
  if (idx) return idx.retractionsByGroup.get(groupId) || [];
  return (payload?.individuals || []).filter((i) => i?.class === RETRACTION_CLASS && factGroupId(i.id) === groupId);
}

/** The active lookup index for this payload, or null when this payload wasn't
 *  built by mutateMemory (a bare test fixture) — callers fall back to a
 *  linear scan in that case. */
const memoryIndexOf = (payload) => payload?.[MEMORY_INDEX] || null;

async function mutateMemory(dir, fn) {
  const payload = await loadMemory(dir);
  buildMemoryIndex(payload);
  const out = (await fn(payload)) ?? payload;
  migrateLegacyProvenance(out);
  recomputeSourceReliability(out);
  out.proseIndex = buildProseIndex(out.individuals);
  await persistMemory(dir, out);
  return out;
}

const labelOf = (text) => (text.length > LABEL_CAP ? text.slice(0, LABEL_CAP - 1) + "…" : text);
const nowIso = () => new Date().toISOString();

/** First-write-wins createdAt: keep the prior individual's timestamp if it has
 *  one (records when a thing was FIRST learned, not when last touched), else the
 *  candidate. */
function firstWriteCreatedAt(prior, candidate) {
  return prior?.attributes?.find((a) => a?.prop === CREATED_AT_PROP)?.value || candidate || nowIso();
}

/** Set (replace-or-append) one attribute on an individual by prop. */
function setAttr(ind, prop, key, value) {
  ind.attributes = (ind.attributes || []).filter((a) => a?.prop !== prop);
  ind.attributes.push({ prop, key, value });
}

// ---- Sources (step (b)): first-class provenance individuals -----------------

/** Deterministic Source id + type over the closed kind set; null for an
 *  unknown kind. operator/teach are session-scoped when `desc.sessionId` is
 *  present, so each session gets its own Source rather than collapsing onto
 *  one singleton. */
function sourceIdFor(desc) {
  switch (desc?.kind) {
    case "operator": return { id: desc.sessionId ? `${OPERATOR_SOURCE_ID}:${desc.sessionId}` : OPERATOR_SOURCE_ID, type: "operator" };
    case "teach": return { id: desc.sessionId ? `${TEACH_SOURCE_ID}:${desc.sessionId}` : TEACH_SOURCE_ID, type: "teach" };
    // One Source per peer NODE, keyed on the stable id the tag carries rather
    // than the display name beside it: names are user-chosen and collidable, so
    // two peers who picked the same one would otherwise collapse into a single
    // Source and corroborate each other for free. Scores at the teach tier —
    // a peer teaching is still a person telling us something.
    case "teachNode": return { id: `${TEACH_NODE_SOURCE_ID}:${desc.nodeId}`, type: "teach" };
    case "provider": return { id: `src:provider:${desc.name}`, type: "provider" };
    case "corpus": return { id: `src:corpus:${desc.name}`, type: "corpus" };
    case "corpusWeak": return { id: `src:corpus-weak:${desc.name}`, type: "corpusWeak" };
    // One Source per pack article (the @revid stays in the article segment),
    // so two facts from the same article corroborate nothing extra.
    case "reference": return { id: `src:reference:${desc.pack}:${desc.article}`, type: "reference" };
    // The live-Wikipedia pack: same per-article Source id, but a lower trust
    // type so a live lookup ranks below the curated revision-pinned pack.
    case "referenceLive": return { id: `src:reference:${desc.pack}:${desc.article}`, type: "referenceLive" };
    // One Source per source-file basename, not per extraction run.
    case "extracted": return { id: `src:extracted:${desc.name}`, type: "extracted" };
    // The fuzzy tier's candidates: one low-trust Source per source label.
    case "optimisticExtract": return { id: `src:optimistic-extract:${desc.name}`, type: "optimisticExtract" };
    case "web": return { id: `src:learned:web:${fnv1aHex(String(desc.url || ""))}`, type: "web", url: String(desc.url || "") };
    case "entailed": return { id: `src:entailed:${desc.rule}`, type: "entailed", rule: String(desc.rule || "") };
    default: return null;
  }
}

const sourceLabel = (id) => String(id).replace(/^src:/, "");

/** The read-side PROV subclass and top class a Source's mgx:sourceType maps to,
 *  or null for an unrecognised type (never force-fit). Mirrors the Source-split
 *  subclasses of tmct:Source in ontology/tmct-core.ttl. */
export function provSourceClassFor(sourceType) {
  return PROV_CLASS_BY_SOURCE_TYPE[sourceType] || null;
}

/** Upsert a Source individual (deterministic id → idempotent, edges never
 *  dangle). createdAt is first-write-wins; a recovered @<ts> (desc.createdAt)
 *  seeds it when present. Returns the Source id, or null for an unknown kind. */
function upsertSource(payload, desc, createdAtCandidate) {
  const info = sourceIdFor(desc);
  if (!info) return null;
  const idx = memoryIndexOf(payload);
  const prior = idx ? idx.individualsById.get(info.id) : payload.individuals.find((i) => i?.id === info.id);
  const created = firstWriteCreatedAt(prior, desc?.createdAt || createdAtCandidate);
  const ind = {
    id: info.id, label: sourceLabel(info.id), class: SOURCE_CLASS,
    derived_from: [], mentions: [],
    attributes: [
      { prop: "rdf:type", key: "type", value: "owl:NamedIndividual" },
      { prop: "mgx:sourceType", key: "sourceType", value: info.type },
      { prop: CREATED_AT_PROP, key: "createdAt", value: created },
      ...(info.url ? [{ prop: "mgx:sourceUrl", key: "sourceUrl", value: info.url }] : []),
      ...(info.rule ? [{ prop: "mgx:sourceRule", key: "sourceRule", value: info.rule }] : []),
    ],
  };
  const stored = upsertIndividual(payload, ind);
  if (idx) idx.sourcesById.set(info.id, stored);
  return info.id;
}

/** Map a payload's Source individuals into the { id: Source } shape computeTrust
 *  resolves against. */
function sourcesByIdMap(payload) {
  const idx = memoryIndexOf(payload);
  const m = {};
  if (idx) {
    // idx.sourcesById is kept incrementally correct by upsertSource, so this
    // is O(distinct Sources) — a handful, roughly one per corpus/provider —
    // never O(all individuals), unlike the fallback rebuild below.
    for (const [id, ind] of idx.sourcesById) m[id] = ind;
    return m;
  }
  for (const i of payload.individuals) if (i?.class === SOURCE_CLASS) m[i.id] = i;
  return m;
}

/** The Source ids a Fact is statedBy, read off the edge group. */
function statedByObjectsFor(payload, factId) {
  const idx = memoryIndexOf(payload);
  if (idx) return (idx.statedByBySubject.get(factId) || []).slice();
  const g = payload.objectProperties.find((x) => x?.prop === STATED_BY_PROP);
  return (g?.examples || []).filter((e) => e?.subject === factId).map((e) => e.object);
}

/** Recompute + materialise a Fact's trust cache (mgx:trustScore/mgx:trustInputs)
 *  and stamp mgx:updatedAt. `trustOpts` optionally threads the entailed hook's
 *  premiseTrusts/ruleConfidence through from appendFact/appendFacts. */
function recomputeFactTrust(payload, fact, nowMs = Date.now(), trustOpts = {}) {
  const sourceIds = statedByObjectsFor(payload, fact.id);
  const createdAt = (fact.attributes || []).find((a) => a?.prop === CREATED_AT_PROP)?.value || "";
  const { score, inputs } = computeTrust({ sourceIds, createdAt }, sourcesByIdMap(payload), {
    now: nowMs,
    ...(Array.isArray(trustOpts?.premiseTrusts) ? { premiseTrusts: trustOpts.premiseTrusts } : {}),
    ...(typeof trustOpts?.ruleConfidence === "number" ? { ruleConfidence: trustOpts.ruleConfidence } : {}),
  });
  setAttr(fact, TRUST_SCORE_PROP, "trustScore", String(score));
  setAttr(fact, TRUST_INPUTS_PROP, "trustInputs", JSON.stringify(inputs));
  setAttr(fact, UPDATED_AT_PROP, "updatedAt", new Date(nowMs).toISOString());
}

/** Materialise ONE assertion record's own trust: its single source's effective
 *  prior, and nothing else. No recency and no corroboration are folded in here
 *  — recency belongs to the reading moment, and corroboration is a property of
 *  the GROUP, computed fresh over its live heads by readFactRows. The entailed
 *  hook still lands write-time, because only the writer knows the premises: a
 *  derivation is worth its weakest premise times the rule's confidence. */
function recomputeAssertionTrust(payload, record, nowMs = Date.now(), trustOpts = {}) {
  const [sourceId] = statedByObjectsFor(payload, record.id);
  const source = sourceId ? sourcesByIdMap(payload)[sourceId] : null;
  const sourceType = (source?.attributes || []).find((a) => a?.prop === "mgx:sourceType")?.value || "";
  let own = assertionPrior(sourceType, source);
  if (sourceType === "entailed" && Array.isArray(trustOpts?.premiseTrusts) && trustOpts.premiseTrusts.length) {
    const ruleConfidence = typeof trustOpts.ruleConfidence === "number" ? trustOpts.ruleConfidence : 1;
    own = Math.max(0, Math.min(1, Math.min(...trustOpts.premiseTrusts) * ruleConfidence));
  }
  const createdAt = (record.attributes || []).find((a) => a?.prop === CREATED_AT_PROP)?.value || "";
  setAttr(record, TRUST_SCORE_PROP, "trustScore", String(own));
  setAttr(record, TRUST_INPUTS_PROP, "trustInputs", JSON.stringify({ sourceType, sourceId: sourceId || "", createdAt }));
  setAttr(record, UPDATED_AT_PROP, "updatedAt", new Date(nowMs).toISOString());
}

/** Re-materialise one individual's stored trust. A Fact is an assertion record
 *  and carries its own single source's prior; a Rule still carries the blended
 *  multi-source score computeTrust has always given it, since a Rule is not
 *  keyed per assertion and has no group to fold. */
function rematerialiseTrust(payload, ind, nowMs, trustOpts) {
  if (ind?.class === FACT_CLASS) recomputeAssertionTrust(payload, ind, nowMs, trustOpts);
  else recomputeFactTrust(payload, ind, nowMs, trustOpts);
}

/** Reconcile a Fact's Sources + statedBy edges with its (unchanged, compat)
 *  mgx:factProvenance string, then recompute its trust. ADD-only over
 *  deterministic Source ids and upsertEdge's subject>object dedupe, so it is
 *  idempotent and NEVER re-keys the fact (its id still hashes only (s,p,o)).
 *  `trustOpts` passes straight through to recomputeFactTrust (see there). */
function syncFactSources(payload, fact, nowMs = Date.now(), trustOpts = {}) {
  const prov = (fact.attributes || []).find((a) => a?.prop === "mgx:factProvenance")?.value || "";
  // a Source's createdAt candidate is the FIRST stating fact's createdAt (its
  // "first seen"), falling back to now — first-write-wins keeps the earliest.
  const factCreated = (fact.attributes || []).find((a) => a?.prop === CREATED_AT_PROP)?.value || new Date(nowMs).toISOString();
  for (const tag of prov.split(" | ").filter(Boolean)) {
    const desc = provenanceTagToSource(tag);
    if (!desc) continue;
    const sid = upsertSource(payload, desc, factCreated);
    if (!sid) continue;
    upsertEdge(payload, { predicate: "statedBy", prop: STATED_BY_PROP }, {
      subject: fact.id, object: sid, subjectLabel: fact.label, objectLabel: sourceLabel(sid),
    });
  }
  rematerialiseTrust(payload, fact, nowMs, trustOpts);
}

/** Lazy, idempotent migration of the legacy provenance union (step (b)): any
 *  Fact that carries the string but has NO statedBy edge yet gets its Sources +
 *  edges + trust materialised. The string is KEPT as a compat shim (readers on
 *  chat.mjs still key on it). New writes stay reconciled via syncFactSources, so
 *  in steady state this scan finds nothing and converges. */
function migrateLegacyProvenance(payload) {
  if (!Array.isArray(payload?.individuals) || !Array.isArray(payload?.objectProperties)) return;
  const statedGroup = payload.objectProperties.find((g) => g?.prop === STATED_BY_PROP);
  const haveEdge = new Set((statedGroup?.examples || []).map((e) => e.subject));
  let changed = false;
  const now = Date.now();
  for (const ind of payload.individuals) {
    if (ind?.class !== FACT_CLASS) continue;
    if (haveEdge.has(ind.id)) continue; // already reconciled (live path or prior run)
    const prov = (ind.attributes || []).find((a) => a?.prop === "mgx:factProvenance")?.value || "";
    if (!prov) continue;
    syncFactSources(payload, ind, now);
    changed = true;
  }
  if (changed) recountClasses(payload);
}

/** A Source id that names one actor and can therefore hold a track record —
 *  the `${SINGLETON}:<id>` shape, for a local operator/teach session or for a
 *  peer NODE across the mesh. A corpus/web/provider/entailed Source names a
 *  document or a derivation, so there is no actor to score.
 *
 *  A peer node counts for the same reason a local session does, and it is the
 *  reason this matters most: a node that asserts junk drags its own every-fact
 *  prior toward half, so minting fresh identities to corroborate yourself stops
 *  being free the moment any of those claims is contradicted. */
const isSessionScopedSourceId = (id) =>
  typeof id === "string"
  && (id.startsWith(`${OPERATOR_SOURCE_ID}:`)
    || id.startsWith(`${TEACH_SOURCE_ID}:`)
    || id.startsWith(`${TEACH_NODE_SOURCE_ID}:`));

/**
 * Recompute + materialise mgx:sourceReliability on every session-scoped
 * operator/teach Source: count facts stated vs. contradicted
 * (findContradictions), run sessionReliabilityFrom, write the bounded result.
 * One pass, no fixed-point iteration. Every individual (Fact or Rule) a
 * recomputed Source touches then gets its own trust re-materialised
 * (recomputeFactTrust) so the shift is visible within this same mutation.
 */
function recomputeSourceReliability(payload) {
  if (!Array.isArray(payload?.individuals) || !Array.isArray(payload?.objectProperties)) return;
  const rows = readFactRows(payload); // Fact-only — contradiction accounting is inherently Fact-shaped
  const contradictedFactIds = new Set();
  for (const group of findContradictions(payload)) for (const r of group) contradictedFactIds.add(r.id);

  const bySource = new Map(); // sessionSourceId -> { factsAsserted, factsContradicted }
  for (const row of rows) {
    for (const sid of row.sourceIds) {
      if (!isSessionScopedSourceId(sid)) continue;
      const bucket = bySource.get(sid) || { factsAsserted: 0, factsContradicted: 0 };
      bucket.factsAsserted += 1;
      if (contradictedFactIds.has(row.id)) bucket.factsContradicted += 1;
      bySource.set(sid, bucket);
    }
  }
  if (!bySource.size) return;

  const idx = memoryIndexOf(payload);
  for (const [sid, counts] of bySource) {
    const source = idx ? idx.individualsById.get(sid) : payload.individuals.find((i) => i?.id === sid);
    if (!source) continue;
    setAttr(source, SOURCE_RELIABILITY_PROP, "sourceReliability", String(sessionReliabilityFrom(counts)));
    // Own-attribute mutation in place — same reasoning as recomputeFactTrust.
    setAttr(source, UPDATED_AT_PROP, "updatedAt", new Date().toISOString());
  }

  // Re-materialise trust for EVERY individual statedBy a recomputed session
  // Source — Fact or Rule alike — via the statedBy edge group directly.
  const statedGroup = payload.objectProperties.find((g) => g?.prop === STATED_BY_PROP);
  const affected = new Set();
  for (const e of statedGroup?.examples || []) if (bySource.has(e?.object)) affected.add(e.subject);
  for (const id of affected) {
    const ind = idx ? idx.individualsById.get(id) : payload.individuals.find((i) => i?.id === id);
    if (ind) rematerialiseTrust(payload, ind);
  }
}

/** Upsert an individual by id (replace-in-place keeps ordering stable).
 *  Returns the stored reference — callers should index THAT, not `ind`. */
/**
 * Two rollup summaries at one id JOIN instead of overwriting: union the ids
 * they absorbed, then re-derive count, bounds and prior from that union. This
 * is what lets two peers that compacted the same group at different moments
 * converge — union, min and max are all joins, so the result is the same in
 * either order and applying it twice changes nothing. Re-writing a summary that
 * already holds everything the incoming one does is therefore a no-op, which is
 * why compaction's own write can go through this path unchanged.
 *
 * Everything that is not a summary keeps plain last-write-wins.
 */
function joinIfRollup(payload, prior, incoming) {
  if (!isRollupId(incoming?.id)) return incoming;
  const sourceType = headRollupTypeOf(incoming.id);
  if (!sourceType) return mergeRollups(prior, incoming);
  const sources = sourcesByIdMap(payload);
  return mergeRollups(prior, incoming, { priorFor: (sid) => assertionPrior(sourceType, sources[sid]) });
}

/** A retraction record joins the same way a summary does, by union of the ids
 *  it carries — the difference is only which ids they are and what the reader
 *  does with them. Everything that is neither keeps plain last-write-wins. */
function joinIfReplicatedRecord(payload, prior, incoming) {
  if (incoming?.class === RETRACTION_CLASS) return mergeRetractions(prior, incoming);
  return joinIfRollup(payload, prior, incoming);
}

function upsertIndividual(payload, ind) {
  const idx = memoryIndexOf(payload);
  if (idx) {
    const prior = idx.individualsById.get(ind.id);
    if (prior) {
      Object.assign(prior, joinIfReplicatedRecord(payload, prior, ind));
      if (prior.class === RETRACTION_CLASS) indexRetraction(idx.retractionsByGroup, prior);
      return prior;
    }
    payload.individuals.push(ind);
    idx.individualsById.set(ind.id, ind);
    if (ind.class === RETRACTION_CLASS) indexRetraction(idx.retractionsByGroup, ind);
    if (ind.class === FACT_CLASS) {
      const groupId = factGroupId(ind.id);
      const held = idx.factRecordsByGroup.get(groupId);
      if (held) held.push(ind.id);
      else idx.factRecordsByGroup.set(groupId, [ind.id]);
    }
    return ind;
  }
  const i = payload.individuals.findIndex((x) => x?.id === ind.id);
  if (i >= 0) {
    payload.individuals[i] = joinIfReplicatedRecord(payload, payload.individuals[i], ind);
    return payload.individuals[i];
  }
  payload.individuals.push(ind);
  return ind;
}

/** Upsert one edge into the named relation group (dedupe by subject>object). Stamps `createdAt`
 *  on the edge, first-write-wins over the same (subject,object) pair — mirrors
 *  `firstWriteCreatedAt`'s discipline: a re-upserted edge keeps its original creation time
 *  rather than resetting to "now" on every write. This is the only place in the codebase edges
 *  get a timestamp at all. */
function upsertEdge(payload, { predicate, prop }, edge) {
  let group = payload.objectProperties.find((g) => g?.prop === prop);
  if (!group) {
    group = { predicate, prop, count: 0, examples: [] };
    payload.objectProperties.push(group);
  }
  // statedBy-only fast path: statedByBySubject tracks, per fact, the small
  // list of Source ids already stated it (almost
  // always 0-1 during a seed), so the overwhelmingly common case — a brand
  // new (subject,object) statedBy pair — can append directly without the
  // find+filter scan of the WHOLE statedBy edge list below. Every other
  // predicate (saidInSession, inReplyTo, ...) is untouched and always takes
  // the original path.
  const idx = prop === STATED_BY_PROP ? memoryIndexOf(payload) : null;
  if (idx) {
    const existing = idx.statedByBySubject.get(edge.subject);
    if (!existing || !existing.includes(edge.object)) {
      group.examples.push({ ...edge, createdAt: edge.createdAt || nowIso() });
      group.count = group.examples.length;
      if (existing) existing.push(edge.object);
      else idx.statedByBySubject.set(edge.subject, [edge.object]);
      return;
    }
    // Rare re-assert of the exact same (subject,object) pair — fall through
    // to the exact original find+filter dance so first-write-wins createdAt
    // is preserved; the index is kept accurate below too.
  }
  // Edges are flat ({subject, object, ...}), not attribute-bearing individuals, so this can't
  // reuse firstWriteCreatedAt (which reads `.attributes`) directly — same discipline, edge shape:
  // the prior edge's OWN createdAt wins if it has one, else the incoming candidate, else now.
  const prior = (group.examples || []).find((e) => e?.subject === edge.subject && e?.object === edge.object);
  const createdAt = prior?.createdAt || edge.createdAt || nowIso();
  group.examples = (group.examples || []).filter(
    (e) => !(e?.subject === edge.subject && e?.object === edge.object),
  );
  group.examples.push({ ...edge, createdAt });
  group.count = group.examples.length;
  if (idx) {
    const list = idx.statedByBySubject.get(edge.subject) || [];
    if (!list.includes(edge.object)) list.push(edge.object);
    idx.statedByBySubject.set(edge.subject, list);
  }
}

/** Recount `classes[]` from the individuals — every memory class stays counted
 *  and sampled the way graph-build.mjs counts the code classes. */
function recountClasses(payload) {
  const names = [MEMORY_SESSION_CLASS, UTTERANCE_CLASS, FACT_CLASS, SOURCE_CLASS, RULE_CLASS];
  payload.classes = (payload.classes || []).filter((c) => !names.includes(c?.name));
  for (const name of names) {
    const of = payload.individuals.filter((i) => i?.class === name);
    if (of.length) payload.classes.push({ name, count: of.length, sample: of.slice(0, 3).map((i) => i.label) });
  }
}

/** Make sure the Session anchor individual exists (edges never dangle). */
function ensureSession(payload, sessionId, started = "") {
  const sid = `session:${sessionId}`;
  if (payload.individuals.some((i) => i?.id === sid)) return sid;
  payload.individuals.push({
    id: sid, label: String(sessionId).slice(0, 8), class: MEMORY_SESSION_CLASS,
    derived_from: [], mentions: [],
    attributes: [
      { prop: "rdf:type", key: "type", value: "owl:NamedIndividual" },
      { prop: CREATED_AT_PROP, key: "createdAt", value: started || nowIso() },
      ...(started ? [{ prop: "mgx:sessionStarted", key: "started", value: started }] : []),
    ],
  });
  return sid;
}

/** Build (don't write) one Utterance individual + its edges; shared by the
 *  single and batch append paths. Returns the utterance id. */
function putUtterance(payload, { role, text, ts, sessionId, sessionStarted = "", parsed = null, replyTo = null, createdAt = "" }) {
  if (!ROLES.has(role)) throw new Error(`utterance role must be "visitor" or "tmct", got ${JSON.stringify(role)}`);
  if (!sessionId) throw new Error("utterance needs a sessionId");
  const cleanTs = String(ts || "");
  const cleanText = normText(text);
  const id = `utt:${sessionId}#${cleanTs}#${role}`;
  const label = labelOf(cleanText) || (role === "visitor" ? "a-visitor-said" : "a-tmct-said");
  const tokens = proseTokensFor({ doc: cleanText });
  const prior = payload.individuals.find((x) => x?.id === id);
  const createdAtVal = firstWriteCreatedAt(prior, createdAt || cleanTs); // first-write-wins
  const ind = {
    id, label, class: UTTERANCE_CLASS,
    derived_from: [], mentions: [],
    attributes: [
      { prop: "rdf:type", key: "type", value: "owl:NamedIndividual" },
      { prop: "mgx:utteranceRole", key: "role", value: role },
      { prop: "mgx:utteranceText", key: "text", value: cleanText },
      { prop: "mgx:utteranceTs", key: "ts", value: cleanTs },
      { prop: CREATED_AT_PROP, key: "createdAt", value: createdAtVal },
      ...(parsed != null ? [{ prop: "mgx:utteranceParsed", key: "parsed", value: JSON.stringify(parsed) }] : []),
      ...(tokens.length ? [{ prop: "mgx:hasProseTokens", key: "prose_tokens", value: tokens.join(" ") }] : []),
    ],
  };
  upsertIndividual(payload, ind);
  const sid = ensureSession(payload, sessionId, sessionStarted);
  upsertEdge(payload, { predicate: "saidInSession", prop: SAID_IN_SESSION_PROP }, {
    subject: id, object: sid, subjectLabel: label, objectLabel: String(sessionId).slice(0, 8),
  });
  if (replyTo) {
    const target = payload.individuals.find((i) => i?.id === replyTo);
    if (target) { // never a dangling reply edge — honest drop, like sessions.mjs
      upsertEdge(payload, { predicate: "inReplyTo", prop: IN_REPLY_TO_PROP }, {
        subject: id, object: replyTo, subjectLabel: label, objectLabel: target.label,
      });
    }
  }
  if (cleanTs && cleanTs > String(payload.generated_at || "")) payload.generated_at = cleanTs;
  return id;
}

/** Append ONE utterance (visitor request or tmct response) to the memory graph.
 *  { role, text, ts, sessionId, sessionStarted?, parsed?, replyTo? } — `parsed`
 *  is the interpretation pipeline's parse of the request (stored as JSON);
 *  `replyTo` a prior utterance id (Q/A pairing). Deterministic id → idempotent.
 *  Returns { id }. */
export async function appendUtterance(dir, utterance) {
  let id;
  await mutateMemory(dir, (payload) => {
    id = putUtterance(payload, utterance);
    recountClasses(payload);
  });
  return { id };
}

/** Batch append — ONE read-modify-write for a whole turn (or session) worth of
 *  utterances; what sessions.mjs's per-turn wiring calls. Returns { ids }. */
export async function appendUtterances(dir, utterances) {
  const ids = [];
  if (!utterances?.length) return { ids };
  await mutateMemory(dir, (payload) => {
    for (const u of utterances) ids.push(putUtterance(payload, u));
    recountClasses(payload);
  });
  return { ids };
}

/** Append mgx:canonicalisedFrom edges (canonical Fact → as-spoken Utterance),
 *  deduped by (subject, object) via upsertEdge — the fold's canonise-link
 *  write, routed through the same backend-dispatched mutate path as every
 *  other append so it lands in whichever store the repo actually uses. */
export async function appendCanonicalisedFromEdges(dir, links) {
  if (!links?.length) return;
  await mutateMemory(dir, (payload) => {
    for (const l of links) {
      // Callers name the fact the way every citation does — by its group id.
      // An edge has to land on a node a walker can dereference, so it resolves
      // to the records asserting that triple; each one really was canonicalised
      // from the same utterance.
      for (const factId of factRecordIdsFor(payload, l.factId)) {
        upsertEdge(payload, { predicate: "canonicalisedFrom", prop: CANONICALISED_FROM_PROP }, {
          subject: factId, object: l.uttId, subjectLabel: l.factLabel, objectLabel: l.uttLabel,
        });
      }
    }
  });
}

/** Every record id asserting one triple, in payload order. The bridge between
 *  the PUBLIC fact id (the group) and the individuals actually holding it, so a
 *  caller that names a fact the way every citation and premise list does still
 *  reaches real nodes. Empty for a triple nothing asserts. */
export function factRecordIdsFor(payload, groupId) {
  const idx = memoryIndexOf(payload);
  if (idx) return (idx.factRecordsByGroup.get(groupId) || []).slice();
  return (payload?.individuals || [])
    .filter((i) => i?.class === FACT_CLASS && factGroupId(i.id) === groupId)
    .map((i) => i.id);
}

/** The assertion groups one write lands, given the triple it targets. Normally
 *  one per Source its provenance names. The `src:none` singleton is the
 *  exception: it exists so a fact nobody can be credited for still HAS a
 *  record, so it is minted only when the triple has no record at all yet. A
 *  provenance-less write onto an already-asserted triple names no new source,
 *  so it files no second, unattributable sibling beside the real ones — its
 *  triple-level payload lands through restateFactGroup instead. */
function assertionGroupsFor(payload, groupId, provenance, createdAt = "") {
  let groups = groupTagsBySource(provenance);
  if (groups.length === 1 && groups[0].sourceId === NO_SOURCE_ID) {
    if (factRecordIdsFor(payload, groupId).length) return [];
  }
  // A source whose assertion was retracted here does not come back on the next
  // sync. This is the ingest half of the enforcement: every delivery path for a
  // fact lands in this function, so a re-sent copy of a retracted assertion is
  // recognized and dropped rather than re-materialized. The comparison is
  // against the assertion's OWN embedded instant, so the same source saying the
  // thing again — a fresh tag, a later moment — still lands.
  const retractions = retractionsFor(payload, groupId);
  if (retractions.length) {
    groups = groups.filter((group) => !isRetractedRecord(
      retractions,
      `${groupId}@${group.sourceId}`,
      assertionTimestampFor(group.tags, createdAt),
    ));
    if (!groups.length) return groups;
  }
  // A source this group has already compacted away stays compacted, for the
  // same reason and at the same point.
  const rollups = headRollupsFor(payload, groupId);
  if (!rollups.length) return groups;
  return groups.filter((group) => !isAbsorbedSource(rollups, group.sourceId));
}

/** A group's pool-1 summaries, one per compacted source type. Reads the index
 *  directly rather than through factRecordIdsFor, because this runs on EVERY
 *  fact write and nearly always finds nothing — the common case must not pay
 *  for an array copy. */
function headRollupsFor(payload, groupId) {
  const idx = memoryIndexOf(payload);
  const ids = idx ? idx.factRecordsByGroup.get(groupId) : factRecordIdsFor(payload, groupId);
  const rollups = [];
  for (const id of ids || []) {
    if (!isHeadRollupId(id)) continue;
    const record = storedIndividual(payload, id);
    if (record) rollups.push(record);
  }
  return rollups;
}

/**
 * Apply a provenance-less write to the records a triple already has. Naming no
 * source, it asserts nothing new — but it can still carry triple-level payload
 * that belongs on the records already there, which is how a caller re-states a
 * derivation's premises without claiming to be a fresh witness.
 *
 * Premise environments are a property of the TRIPLE, and readFactRows unions
 * them across the group, so a re-statement REPLACES the group's whole view of
 * them. That is what lets a retraction actually prune one: writing to a single
 * record would leave a sibling rule's copy behind and the union would put it
 * straight back. They land where they already live when anything holds them,
 * since a justification explains an entailment, not the corroborators beside it.
 *
 * Returns the record ids it touched.
 */
function restateFactGroup(payload, groupId, { quantifier, environments }) {
  const live = factRecordIdsFor(payload, groupId)
    .map((id) => storedIndividual(payload, id))
    .filter((record) => record && !(record.attributes || []).some((a) => a?.prop === SUPERSEDED_BY_PROP));
  const touched = new Set();
  if (environments) {
    const carriers = live.filter((r) => (r.attributes || []).some((a) => a?.prop === "mgx:factJustification"));
    for (const record of carriers.length ? carriers : live) {
      setAttr(record, "mgx:factJustification", "justification", environments.map((e) => e.join(" ")).join(" | "));
      touched.add(record.id);
    }
  }
  if (quantifier) {
    for (const record of live) {
      // first-write-wins, exactly as a tagged re-assert treats it
      if ((record.attributes || []).some((a) => a?.prop === "mgx:factQuantifier")) continue;
      setAttr(record, "mgx:factQuantifier", "quantifier", quantifier);
      touched.add(record.id);
    }
  }
  return [...touched];
}

/** How deep this source's own chain for this triple already runs: the version
 *  counts how many times the source has replaced its own record here, so the
 *  first demotion is `#v1` and the oldest leaf keeps the lowest number. Read
 *  off the head's own backward link, which is O(1) and always names the leaf
 *  immediately behind it. */
function nextChainVersion(head) {
  let deepest = 0;
  const behind = (head.attributes || []).find((a) => a?.prop === SUPERSEDES_PROP)?.value || "";
  for (const id of behind.split(" ").filter(Boolean)) {
    const m = /#v([1-9][0-9]*)$/.exec(id);
    if (m) deepest = Math.max(deepest, Number(m[1]));
  }
  return deepest + 1;
}

/** A write's extraction findings, deduped and codepoint-sorted. The sort is
 *  what keeps the stored string a pure function of the finding SET: two stores
 *  handed the same findings in different orders hold byte-identical records,
 *  and the read-time union below reads the same either way. */
function normalizeExtractionFindings(extraction) {
  if (!Array.isArray(extraction)) return [];
  const names = new Set();
  for (const raw of extraction) {
    const name = normText(raw);
    if (name) names.add(name);
  }
  return [...names].sort();
}

/**
 * Plan ONE source's assertion of one triple: the record it wants to write, plus
 * the demotion that implies when the source is replacing its own earlier belief.
 * Pure — nothing lands until applyFactAssertion — so the SHACL gate gets to
 * reject a malformed record while the payload is still untouched.
 *
 * Three outcomes, and only the first writes anything new:
 *   - a source this triple has never heard from: a fresh record;
 *   - the same source, genuinely newer: a new HEAD at the same stable id, the
 *     record it replaces kept whole under `#v<n>` and linked both ways;
 *   - the same source saying the same thing again: its tags union onto the head
 *     and its first write's stamps stand. An exact re-delivery changes nothing,
 *     which is what keeps a re-seed and a duplicate mesh path idempotent.
 */
function planFactAssertion(payload, spec) {
  const { groupId, s, p, o, label, tokens, group, createdAt, observedAt, quantifier, environments, extraction = [] } = spec;
  const recordId = `${groupId}@${group.sourceId}`;
  const idx = memoryIndexOf(payload);
  const head = idx ? idx.individualsById.get(recordId) : payload.individuals.find((x) => x?.id === recordId);
  const headAttr = (prop) => (head?.attributes || []).find((a) => a?.prop === prop)?.value || "";
  const headTags = headAttr("mgx:factProvenance").split(" | ").filter(Boolean);
  const incoming = { assertedAt: embeddedTagTimestamp(group.tags), observedAt };

  let demote = null;
  let tags = group.tags;
  let createdAtVal = incoming.assertedAt || createdAt || nowIso();
  let observedAtVal = observedAt;
  let supersedes = [];
  let quantifierVal = quantifier;
  let extractionVal = extraction;

  if (head) {
    const current = { assertedAt: embeddedTagTimestamp(headTags), observedAt: headAttr(OBSERVED_AT_PROP) };
    if (supersedesPriorAssertion(incoming, current)) {
      demote = { head, id: `${recordId}#v${nextChainVersion(head)}` };
      supersedes = [demote.id];
      // A fresh belief is read fresh: the new head carries only the findings
      // this write recorded, and the demoted leaf keeps its own.
    } else {
      tags = [...new Set([...headTags, ...group.tags])];
      createdAtVal = headAttr(CREATED_AT_PROP) || createdAtVal;
      observedAtVal = observedAt || headAttr(OBSERVED_AT_PROP);
      supersedes = headAttr(SUPERSEDES_PROP).split(" ").filter(Boolean);
      // The same source saying the same thing again unions its findings on,
      // exactly as its tags union: a re-delivery never erases how the first
      // reading of this assertion went.
      extractionVal = normalizeExtractionFindings([...headAttr(EXTRACTION_FINDING_PROP).split(" "), ...extraction]);
    }
    // A re-assert carrying no quantifier never SILENTLY erases one already
    // recorded — the same first-write-wins discipline createdAt keeps.
    quantifierVal = quantifier || headAttr("mgx:factQuantifier");
  }

  const candidate = {
    id: recordId, label, class: FACT_CLASS,
    derived_from: [], mentions: [],
    attributes: [
      { prop: "rdf:type", key: "type", value: "rdf:Statement" },
      { prop: "rdf:subject", key: "subject", value: s },
      { prop: "rdf:predicate", key: "predicate", value: p },
      { prop: "rdf:object", key: "object", value: o },
      { prop: CREATED_AT_PROP, key: "createdAt", value: createdAtVal },
      { prop: SOURCE_ID_PROP, key: "sourceId", value: group.sourceId },
      ...(tags.length ? [{ prop: "mgx:factProvenance", key: "provenance", value: tags.join(" | ") }] : []),
      ...(observedAtVal ? [{ prop: OBSERVED_AT_PROP, key: "observedAt", value: observedAtVal }] : []),
      ...(extractionVal.length ? [{ prop: EXTRACTION_FINDING_PROP, key: "extraction", value: extractionVal.join(" ") }] : []),
      ...(tokens.length ? [{ prop: "mgx:hasProseTokens", key: "prose_tokens", value: tokens.join(" ") }] : []),
      ...(quantifierVal ? [{ prop: "mgx:factQuantifier", key: "quantifier", value: quantifierVal }] : []),
      ...(environments ? [{ prop: "mgx:factJustification", key: "justification", value: environments.map((e) => e.join(" ")).join(" | ") }] : []),
      ...(supersedes.length ? [{ prop: SUPERSEDES_PROP, key: "supersedes", value: supersedes.join(" ") }] : []),
    ],
  };
  return { candidate, demote };
}

/** Drop a triple's `src:none` record once a real source asserts it. The
 *  singleton exists so a fact nobody can be credited for still HAS a record; it
 *  contributes no Source, no statedBy edge and no trust, so the moment someone
 *  can be credited it is pure clutter. Cheap: the O(1) index check fails for
 *  nearly every write, and only a group that actually holds a placeholder pays
 *  for the removal. */
function absorbAnonymousRecord(payload, groupId) {
  const anonymousId = `${groupId}@${NO_SOURCE_ID}`;
  const idx = memoryIndexOf(payload);
  if (idx ? !idx.individualsById.has(anonymousId) : !payload.individuals.some((i) => i?.id === anonymousId)) return;
  payload.individuals = payload.individuals.filter((i) => i?.id !== anonymousId);
  if (!idx) return;
  idx.individualsById.delete(anonymousId);
  const held = (idx.factRecordsByGroup.get(groupId) || []).filter((id) => id !== anonymousId);
  if (held.length) idx.factRecordsByGroup.set(groupId, held);
  else idx.factRecordsByGroup.delete(groupId);
}

/** Land a planned assertion. The demoted record is never deleted and never
 *  rewritten: it moves to its own id carrying the same bytes, plus the forward
 *  link that makes it a leaf rather than a head. Returns every record id this
 *  touched, so the caller reconciles Sources and trust once per record. */
function applyFactAssertion(payload, { candidate, demote }) {
  const touched = [];
  if (!candidate.id.endsWith(`@${NO_SOURCE_ID}`)) absorbAnonymousRecord(payload, factGroupId(candidate.id));
  if (demote) {
    const leaf = { ...demote.head, id: demote.id, attributes: (demote.head.attributes || []).map((a) => ({ ...a })) };
    setAttr(leaf, SUPERSEDED_BY_PROP, "supersededBy", candidate.id);
    upsertIndividual(payload, leaf); // before the head is overwritten in place
    touched.push(leaf.id);
  }
  upsertIndividual(payload, candidate);
  touched.push(candidate.id);
  return touched;
}

/** The stored individual for a record id — upsertIndividual replaces in place,
 *  so callers must reconcile against what the payload actually holds. */
function storedIndividual(payload, id) {
  const idx = memoryIndexOf(payload);
  return idx ? idx.individualsById.get(id) : payload.individuals.find((x) => x?.id === id);
}

/** Remove absorbed records and scrub any edge that named them, mirroring
 *  removeFacts' own discipline. An orphaned Source is left in place: a source
 *  whose assertion was compacted is still a real source with a track record. */
function dropAbsorbedRecords(payload, ids) {
  const drop = new Set(ids);
  if (!drop.size) return;
  payload.individuals = (payload.individuals || []).filter((ind) => !drop.has(ind?.id));
  for (const group of payload.objectProperties || []) {
    const before = group.examples || [];
    const after = before.filter((e) => !drop.has(e?.subject) && !drop.has(e?.object));
    if (after.length === before.length) continue;
    group.examples = after;
    group.count = after.length;
  }
  const idx = memoryIndexOf(payload);
  if (!idx) return;
  for (const id of drop) {
    idx.individualsById.delete(id);
    idx.statedByBySubject.delete(id);
    const groupId = factGroupId(id);
    const held = (idx.factRecordsByGroup.get(groupId) || []).filter((x) => x !== id);
    if (held.length) idx.factRecordsByGroup.set(groupId, held);
    else idx.factRecordsByGroup.delete(groupId);
  }
}

/**
 * Bound one triple's record growth, on the write that grew it. Two pools, two
 * triggers, two summaries, never mixed:
 *
 *   - pool 1 absorbs the OLDEST live heads of one source TYPE once that type
 *     holds GROUP_ROLLUP_THRESHOLD of them, keeping the newest
 *     ROLLUP_KEEP_PER_TYPE intact. Its summary carries a prior, because every
 *     head it absorbed was a live vote in the group fold and dropping that
 *     contribution would silently under-trust the compacted answer.
 *   - pool 2 absorbs the OLDEST demoted leaves of ONE source's own chain once
 *     that chain holds CHAIN_ROLLUP_THRESHOLD of them, keeping the newest
 *     CHAIN_KEEP_DEPTH. Its summary carries no prior: a demoted leaf counts for
 *     nothing while it stands, and compacting it must not change that.
 *
 * A head absorbed by pool 1 takes its own chain with it. The chain is reachable
 * only through the head, so once the head is summarized its history answers no
 * question this model asks, and leaving it behind would orphan it.
 *
 * Returns the record ids it absorbed rather than removing them, so a batch that
 * compacts many groups pays for one sweep of the payload instead of one per
 * group. Groups are independent, so a still-present absorbed record can never
 * affect another group's planning.
 */
function compactFactGroup(payload, groupId) {
  const idx = memoryIndexOf(payload);
  const ids = (idx ? idx.factRecordsByGroup.get(groupId) : factRecordIdsFor(payload, groupId)) || [];
  // Nearly every fact has no summary in either pool, and the record count says
  // so before anything else is read: pool 2 has the lower trigger, so a group
  // under it can fire neither pool.
  if (ids.length < CHAIN_ROLLUP_THRESHOLD) return [];

  const headsByType = new Map();
  const leavesBySource = new Map();
  const headRollupByType = new Map();
  const chainRollupBySource = new Map();
  for (const id of ids.slice()) {
    const record = storedIndividual(payload, id);
    if (!record) continue;
    const attrOf = (prop) => (record.attributes || []).find((a) => a?.prop === prop)?.value || "";
    if (isHeadRollupId(id)) { headRollupByType.set(headRollupTypeOf(id), record); continue; }
    if (isChainRollupId(id)) { chainRollupBySource.set(attrOf(SOURCE_ID_PROP), record); continue; }
    const provenance = attrOf("mgx:factProvenance");
    const source = primarySourceOf(provenance);
    const tags = provenance.split(" | ").filter(Boolean);
    const entry = {
      id,
      sourceId: attrOf(SOURCE_ID_PROP) || source.id,
      assertedAt: assertionTimestampFor(tags, attrOf(CREATED_AT_PROP)),
      record,
    };
    if (attrOf(SUPERSEDED_BY_PROP)) {
      const chain = leavesBySource.get(entry.sourceId);
      if (chain) chain.push(entry);
      else leavesBySource.set(entry.sourceId, [entry]);
      continue;
    }
    // src:none stands for "no source at all" — it has no type, so it belongs to
    // no per-type pool and is never compacted.
    if (!source.type) continue;
    const heads = headsByType.get(source.type);
    if (heads) heads.push(entry);
    else headsByType.set(source.type, [entry]);
  }

  const sources = sourcesByIdMap(payload);
  const absorbed = [];

  for (const [sourceType, heads] of headsByType) {
    const plan = planHeadRollup({
      groupId, sourceType, heads,
      existing: headRollupByType.get(sourceType) || null,
      priorFor: (sid) => assertionPrior(sourceType, sources[sid]),
    });
    if (!plan) continue;
    upsertIndividual(payload, plan.rollup);
    absorbed.push(...plan.absorbed);
    for (const sourceId of plan.absorbedSourceIds) {
      for (const leaf of leavesBySource.get(sourceId) || []) absorbed.push(leaf.id);
      leavesBySource.delete(sourceId);
      const chainRollup = chainRollupBySource.get(sourceId);
      if (chainRollup) absorbed.push(chainRollup.id);
      chainRollupBySource.delete(sourceId);
    }
  }

  for (const [sourceId, leaves] of leavesBySource) {
    const plan = planChainRollup({
      groupId, sourceId, leaves,
      existing: chainRollupBySource.get(sourceId) || null,
    });
    if (!plan) continue;
    upsertIndividual(payload, plan.rollup);
    absorbed.push(...plan.absorbed);
    // Keep the chain walkable backward: the oldest leaf still standing points
    // at the summary rather than at a record that no longer exists. A walk that
    // reaches it and needs a point inside the absorbed span gets the summary's
    // own bounds, never a fabricated instant.
    const rewired = storedIndividual(payload, plan.rewire);
    if (rewired) setAttr(rewired, SUPERSEDES_PROP, "supersedes", plan.rollup.id);
  }

  return absorbed;
}

/** Append one grammar-derived OWL triple, RDF-reified as a `Fact` individual —
 *  one record per asserting SOURCE, all of them sharing the content-addressed
 *  group id this returns. Same (s,p,o) from the same source resolves onto that
 *  source's own lineage, never a duplicate. `premiseTrusts`/`ruleConfidence`
 *  optionally engage trust.mjs's entailed hook; `observedAt` records when the
 *  asserting party WITNESSED the claim, which is not when this store heard it.
 *  `extraction` is the closed-vocabulary finding list saying how the extractor
 *  read the sentence this assertion came from, recorded on the record rather
 *  than the triple. Validated against ontology/memory-shapes.ttl
 *  (memory/shacl.mjs) before the write. Returns { id } — the group id, the
 *  public fact id every reader uses. */
export async function appendFact(dir, { subject, predicate, object, provenance = "", createdAt = "", observedAt = "", quantifier = "", extraction, premiseTrusts, ruleConfidence } = {}) {
  const s = normFactTerm(subject);
  const p = normFactPredicate(predicate);
  const o = normFactTerm(object);
  if (!s || !p || !o) throw new Error("a fact needs subject, predicate and object");
  const groupId = factIdFor(s, p, o);
  const text = `${s} ${p} ${o}`;
  const tokens = proseTokensFor({ doc: text });
  const q = normText(quantifier);
  const findings = normalizeExtractionFindings(extraction);
  await mutateMemory(dir, async (payload) => {
    const groups = assertionGroupsFor(payload, groupId, normText(provenance), createdAt);
    for (const id of groups.length ? [] : restateFactGroup(payload, groupId, { quantifier: q })) {
      syncFactSources(payload, storedIndividual(payload, id), undefined, { premiseTrusts, ruleConfidence });
    }
    for (const group of groups) {
      const plan = planFactAssertion(payload, {
        groupId, s, p, o, label: labelOf(text), tokens, group, createdAt, observedAt, quantifier: q,
        extraction: findings,
      });
      await assertIndividualValid(plan.candidate); // the SHACL gate -- throws, never writes, on a violation
      for (const id of applyFactAssertion(payload, plan)) {
        // Derive the Source individual + statedBy edge from this record's own
        // tag(s) and materialise its single-source trust. The entailed hook
        // rides the new head only; a demoted leaf keeps the trust it earned.
        syncFactSources(payload, storedIndividual(payload, id), undefined,
          id === plan.candidate.id ? { premiseTrusts, ruleConfidence } : undefined);
      }
    }
    // After the Sources exist, so a summary can price what it absorbs.
    dropAbsorbedRecords(payload, compactFactGroup(payload, groupId));
    recountClasses(payload);
  });
  return { id: groupId };
}

/** Normalize appendFacts' `justification` input — either a flat premise-id
 *  list (one derivation) or a list of premise-id lists (one per independent
 *  derivation) — into the string[][] environment shape: empty/non-string ids
 *  dropped, environments deduped by canonical key (sorted-id join) with
 *  within-environment citation order preserved. Undefined when nothing
 *  storable remains. */
function normalizeJustificationEnvironments(justification) {
  if (!Array.isArray(justification)) return undefined;
  const rawEnvs = justification.some(Array.isArray)
    ? justification.filter(Array.isArray)
    : [justification];
  const envs = [];
  const seen = new Set();
  for (const raw of rawEnvs) {
    const env = raw.filter((id) => typeof id === "string" && id);
    if (!env.length) continue;
    const key = [...env].sort().join(" ");
    if (seen.has(key)) continue;
    seen.add(key);
    envs.push(env);
  }
  return envs.length ? envs : undefined;
}

/** Batch append of grammar/corpus-derived triples — ONE read-modify-write for
 *  a whole seed, collapsing looping appendFact's O(N²) I/O to a single
 *  mutate (same resulting ids/provenance/trust). Malformed facts are skipped,
 *  not thrown. Optional per-fact `premiseTrusts`/`ruleConfidence` (batched
 *  entailed-hook passthrough) and `justification` (premise fact ids — a flat
 *  list, or a list of lists for multiple independent derivations — stored as
 *  mgx:factJustification's ' | '-separated environments, last-write-wins), and
 *  optional per-fact `extraction` (appendFact's finding list, same per-assertion
 *  scoping). Returns { ids, appended, skipped }. */
export async function appendFacts(dir, facts) {
  const prepared = [];
  let skipped = 0;
  for (const f of facts || []) {
    const s = normFactTerm(f?.subject);
    const p = normFactPredicate(f?.predicate);
    const o = normFactTerm(f?.object);
    if (!s || !p || !o) { skipped += 1; continue; } // batch skips, never throws
    const text = `${s} ${p} ${o}`;
    prepared.push({
      id: factIdFor(s, p, o), // NUL-delimited — byte-identical to appendFact's id
      s, p, o, text,
      tokens: proseTokensFor({ doc: text }),
      provenance: normText(f?.provenance),
      createdAt: f?.createdAt || "",
      observedAt: f?.observedAt || "",
      quantifier: normText(f?.quantifier),
      extraction: normalizeExtractionFindings(f?.extraction),
      premiseTrusts: Array.isArray(f?.premiseTrusts) ? f.premiseTrusts : undefined,
      ruleConfidence: typeof f?.ruleConfidence === "number" ? f.ruleConfidence : undefined,
      environments: normalizeJustificationEnvironments(f?.justification),
    });
  }
  const ids = [];
  if (!prepared.length) return { ids, appended: 0, skipped };
  await mutateMemory(dir, (payload) => {
    const touched = [];
    const seen = new Set();
    const trustOptsById = new Map();
    for (const f of prepared) {
      const groups = assertionGroupsFor(payload, f.id, f.provenance, f.createdAt);
      // Naming no source, this write asserts nothing new — but its premise
      // environments and quantifier still belong on the records already there.
      for (const id of groups.length ? [] : restateFactGroup(payload, f.id, { quantifier: f.quantifier, environments: f.environments })) {
        if (!seen.has(id)) { seen.add(id); touched.push(id); }
        if (f.premiseTrusts !== undefined || f.ruleConfidence !== undefined) {
          trustOptsById.set(id, { premiseTrusts: f.premiseTrusts, ruleConfidence: f.ruleConfidence });
        }
      }
      for (const group of groups) {
        const plan = planFactAssertion(payload, {
          groupId: f.id, s: f.s, p: f.p, o: f.o, label: labelOf(f.text), tokens: f.tokens,
          group, createdAt: f.createdAt, observedAt: f.observedAt, quantifier: f.quantifier,
          environments: f.environments, extraction: f.extraction,
        });
        for (const id of applyFactAssertion(payload, plan)) {
          if (seen.has(id)) continue;
          seen.add(id);
          touched.push(id);
        }
        // Last-prepared-row-wins per record for the trust hook opts (mirroring
        // the upsert above, which is also last-wins within one batch), and only
        // ever on the head — a demoted leaf keeps the trust it earned.
        if (f.premiseTrusts !== undefined || f.ruleConfidence !== undefined) {
          trustOptsById.set(plan.candidate.id, { premiseTrusts: f.premiseTrusts, ruleConfidence: f.ruleConfidence });
        }
      }
      ids.push(f.id); // the group id — the public fact id, one per prepared triple
    }
    // Reconcile each touched record's Source + trust once (add-only,
    // idempotent), then recount classes a SINGLE time at the end.
    for (const id of touched) syncFactSources(payload, storedIndividual(payload, id), undefined, trustOptsById.get(id));
    // After the Sources exist, so a summary can price what it absorbs, and once
    // per touched GROUP rather than once per prepared row — a batch that
    // asserts the same triple many times compacts it once.
    const absorbed = [];
    for (const groupId of new Set(ids)) absorbed.push(...compactFactGroup(payload, groupId));
    dropAbsorbedRecords(payload, absorbed);
    recountClasses(payload);
  });
  return { ids, appended: ids.length, skipped };
}

// ---- Rules ------------------------------------------------------------------
// A taught RULE — a composed/filtered/recursive relation SHAPE, distinct from a
// plain Fact triple. Same convention as a Fact's subject/predicate/object: every
// slot is a plain string ATTRIBUTE, never an edge to a per-term individual.

export const RULE_KIND_COMPOSE2 = "compose2";
export const RULE_KIND_FILTER = "filter";
export const RULE_KIND_RECURSIVE = "recursive";
// The action family: one taught sentence = one Rule individual, the family
// sharing one mgx:ruleName. A single flat kind can't hold several
// preconditions under content addressing (one value per slot), so signature,
// precondition and effect are sibling kinds collected by name at plan time.
export const RULE_KIND_ACTION_SIGNATURE = "action-signature";
export const RULE_KIND_ACTION_PRECOND = "action-precond";
export const RULE_KIND_ACTION_EFFECT = "action-effect";
export const RULE_KIND_ACTION_CONSTRAINT = "action-constraint";
const RULE_KINDS = Object.freeze([
  RULE_KIND_COMPOSE2, RULE_KIND_FILTER, RULE_KIND_RECURSIVE,
  RULE_KIND_ACTION_SIGNATURE, RULE_KIND_ACTION_PRECOND, RULE_KIND_ACTION_EFFECT,
  RULE_KIND_ACTION_CONSTRAINT,
]);

const RULE_NAME_PROP = "mgx:ruleName";
export const RULE_KIND_PROP = "mgx:ruleKind";

// Per-kind slot contract: JS slot key -> the mgx: attribute it's written under.
// filter's "base" slot reuses ruleBase1 — the same attribute name compose2's
// first hop already uses, since both play the identical "base relation this
// rule builds on" role. Order within each array is the content-address hash
// order below — fixed and load-bearing. Predicate slots store BARE values
// ("rest-on", "smaller-than"): normFactTerm strips a leading CURIE prefix, so
// an mgx:-prefixed value could never round-trip; readers re-attach mgx:.
const RULE_SLOT_SPEC = {
  [RULE_KIND_COMPOSE2]: [["base1", "mgx:ruleBase1"], ["base2", "mgx:ruleBase2"]],
  [RULE_KIND_FILTER]: [["base", "mgx:ruleBase1"], ["property", "mgx:ruleFilterProperty"]],
  [RULE_KIND_RECURSIVE]: [["baseCase", "mgx:ruleBaseCase"], ["recStep", "mgx:ruleRecStep"]],
  [RULE_KIND_ACTION_SIGNATURE]: [
    ["subjectClass", "mgx:ruleActionSubjectClass"], ["targetClass", "mgx:ruleActionTargetClass"],
  ],
  [RULE_KIND_ACTION_PRECOND]: [
    ["shape", "mgx:ruleActionPrecondShape"], ["predicate", "mgx:ruleActionPrecondPredicate"],
    ["role", "mgx:ruleActionPrecondRole"], ["scope", "mgx:ruleActionPrecondScope"],
    // value/negate: the "fact-value" shape's literal-match and negation
    // slots. Optional (RULE_SLOT_OPTIONAL below) — no-incoming/comparator
    // preconds never set them.
    ["value", "mgx:ruleActionPrecondValue"], ["negate", "mgx:ruleActionPrecondNegate"],
  ],
  [RULE_KIND_ACTION_EFFECT]: [
    ["predicate", "mgx:ruleActionEffectPredicate"], ["subjectRole", "mgx:ruleActionEffectSubject"],
    // objectRole/value: exactly one of these two must be set (enforced
    // below, not by this per-slot spec) — a role-bound effect (Hanoi's
    // "rest-on") supplies objectRole, a literal datatype effect (Ashcombe's
    // is-open = "true") supplies value instead.
    ["objectRole", "mgx:ruleActionEffectObject"], ["value", "mgx:ruleActionEffectValue"],
  ],
  // "the <left> may not be with the <right> without the <guard>" — each slot
  // names a class whose sole member src/domain/domain.mjs resolves at compile time.
  [RULE_KIND_ACTION_CONSTRAINT]: [
    ["left", "mgx:ruleActionConstraintLeft"], ["right", "mgx:ruleActionConstraintRight"],
    ["guard", "mgx:ruleActionConstraintGuard"],
  ],
};

// Slots a kind's RULE_SLOT_SPEC lists but does NOT require non-empty — the
// literal-effect/fact-value extension's slots, added after the original
// four-kind design. A pre-existing rule never sets them, so it reads back
// with these keys simply absent (readRuleRows defaults an absent slot to
// ""), the same "not supplied" signal domain.mjs's compileDomain gives an
// explicit "" — see optionalTerm there.
const RULE_SLOT_OPTIONAL = {
  [RULE_KIND_ACTION_PRECOND]: new Set(["value", "negate"]),
  [RULE_KIND_ACTION_EFFECT]: new Set(["objectRole", "value"]),
};

// Content-addressed over (kind, name, ...slots in RULE_SLOT_SPEC order),
// mirroring factIdFor's NUL-delimited discipline: identical rules upsert,
// different ones coexist. For 2-slot kinds the joined string is byte-identical
// to the historical (kind, name, slot1, slot2) template, so pre-existing rule
// ids never change (pinned by test/adapters/memory-rules-action.test.mjs);
// action-precond/action-effect ids shifted when their optional slots joined
// the spec above (their own round-trip test asserts dedup behavior, never a
// specific hash, so this was never a promise for those two kinds).
const ruleIdFor = (kind, name, slotValues) => `rule:${fnv1aHex([kind, name, ...slotValues].join("\0"))}`;

/** Append one taught RULE — a sibling of appendFact storing a `Rule`
 *  individual, same upsert/provenance/trust/SHACL discipline (neither
 *  pipeline ever checks `individual.class`). `slots` is the matching
 *  per-kind object (RULE_SLOT_SPEC above); a slot named in RULE_SLOT_OPTIONAL
 *  may be omitted. Returns { id }. */
export async function appendRule(dir, { name, kind, slots, provenance = "", createdAt = "" } = {}) {
  const spec = RULE_SLOT_SPEC[kind];
  if (!spec) throw new Error(`a rule kind must be one of ${RULE_KINDS.join(", ")}, got ${JSON.stringify(kind)}`);
  const n = normFactTerm(name);
  if (!n) throw new Error("a rule needs a name");
  const optional = RULE_SLOT_OPTIONAL[kind] || new Set();
  const slotValues = spec.map(([slotKey]) => normFactTerm(slots?.[slotKey]));
  const missing = spec.filter(([slotKey], i) => !optional.has(slotKey) && !slotValues[i]);
  if (missing.length) {
    throw new Error(`a ${kind} rule needs ${missing.map(([slotKey]) => slotKey).join(" + ")}`);
  }
  if (kind === RULE_KIND_ACTION_EFFECT) {
    const objectRole = slotValues[spec.findIndex(([k]) => k === "objectRole")];
    const value = slotValues[spec.findIndex(([k]) => k === "value")];
    if (!objectRole && !value) throw new Error(`a ${kind} rule needs an objectRole or a value`);
  }
  const id = ruleIdFor(kind, n, slotValues);
  const label = labelOf(`${n} = ${kind}(${slotValues.join(", ")})`);
  await mutateMemory(dir, async (payload) => {
    const prior = payload.individuals.find((x) => x?.id === id);
    const priorProv = prior?.attributes?.find((a) => a?.prop === "mgx:factProvenance")?.value || "";
    // Same union-of-tags discipline as appendFact — the compat string stays
    // byte-identical in spirit; the Source edges below are DERIVED from it.
    const provs = [...new Set([...priorProv.split(" | "), normText(provenance)].filter(Boolean))];
    const createdAtVal = firstWriteCreatedAt(prior, createdAt); // first-write-wins
    const candidate = {
      id, label, class: RULE_CLASS,
      derived_from: [], mentions: [],
      attributes: [
        { prop: "rdf:type", key: "type", value: "owl:NamedIndividual" },
        { prop: RULE_NAME_PROP, key: "ruleName", value: n },
        { prop: RULE_KIND_PROP, key: "ruleKind", value: kind },
        // An optional slot left empty stores no attribute at all — the same
        // "never supplied" shape a pre-extension Rule individual already has,
        // rather than a wasted always-"" one.
        ...spec
          .map(([slotKey, prop], i) => ({ prop, key: slotKey, value: slotValues[i], skip: !slotValues[i] && optional.has(slotKey) }))
          .filter((attr) => !attr.skip)
          .map(({ skip, ...attr }) => attr),
        { prop: CREATED_AT_PROP, key: "createdAt", value: createdAtVal },
        ...(provs.length ? [{ prop: "mgx:factProvenance", key: "provenance", value: provs.join(" | ") }] : []),
      ],
    };
    await assertIndividualValid(candidate); // the SHACL gate -- throws, never writes, on a violation
    upsertIndividual(payload, candidate);
    // Same Source-derivation + trust-materialisation call appendFact makes —
    // syncFactSources/recomputeFactTrust only ever touch fact.attributes/id/
    // label, never fact.class, so a Rule individual rides it unmodified.
    syncFactSources(payload, payload.individuals.find((x) => x?.id === id));
    recountClasses(payload);
  });
  return { id };
}

/** Genericity lookup for the query-dispatcher: "what kind of thing is name X"
 *  — scan for the Rule individual whose mgx:ruleName matches, the SAME
 *  lookup serving every taught rule name uniformly (no per-rule-name
 *  branch). Returns the raw individual, or undefined if no Rule has that
 *  name. */
export function findRuleByName(memory, name) {
  const n = normFactTerm(name);
  return (memory?.individuals || []).find(
    (i) => i?.class === RULE_CLASS && (i.attributes || []).find((a) => a?.prop === RULE_NAME_PROP)?.value === n,
  );
}

/** Every Rule individual sharing `name` — an action family's members live as
 *  sibling individuals (one per taught sentence), so consumers collect them
 *  all. Sorted by kind then id for deterministic iteration. */
export function findRulesByName(memory, name) {
  const n = normFactTerm(name);
  const kindOf = (i) => (i.attributes || []).find((a) => a?.prop === RULE_KIND_PROP)?.value || "";
  return (memory?.individuals || [])
    .filter((i) => i?.class === RULE_CLASS
      && (i.attributes || []).find((a) => a?.prop === RULE_NAME_PROP)?.value === n)
    .sort((a, b) => kindOf(a).localeCompare(kindOf(b)) || String(a.id).localeCompare(String(b.id)));
}

/** Every taught Rule as a plain row {id, name, kind, slots, provenance} —
 *  the sibling of readFactRows, so consumers (src/domain/domain.mjs) never touch
 *  raw individuals. Rules whose kind has no RULE_SLOT_SPEC entry are
 *  skipped (unreadable without a slot contract). Sorted by name, kind, id. */
export function readRuleRows(memory) {
  const rows = [];
  for (const ind of memory?.individuals || []) {
    if (ind?.class !== RULE_CLASS) continue;
    const attr = (prop) => (ind.attributes || []).find((a) => a?.prop === prop)?.value;
    const kind = attr(RULE_KIND_PROP);
    const spec = RULE_SLOT_SPEC[kind];
    if (!spec) continue;
    const slots = {};
    for (const [slotKey, prop] of spec) slots[slotKey] = attr(prop) ?? "";
    rows.push({
      id: ind.id,
      name: attr(RULE_NAME_PROP) || "",
      kind,
      slots,
      provenance: attr("mgx:factProvenance") || "",
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name)
    || a.kind.localeCompare(b.kind) || String(a.id).localeCompare(String(b.id)));
  return rows;
}

// ---- Relation chase ---------------------------------------------------------
//
// `resolveRelationChase` and `resolveRelationChaseReverse` are standalone,
// importable functions taking an already-loaded `memory` (a loadMemory()
// payload — callers load it once, not per recursive call) and a `helpers`
// bag (`relationFactsFor`, `renderFactLine`, `factPhrase`, `factTermVariants`,
// `byTrust`, the trust-bearing `rows` array, `HAS_PROPERTY_PREDICATE`, and
// the search kernels `findActionPath`/`findReachableSet` from planning.mjs —
// injected so this store module never imports the domain layer), so callers
// outside chat.mjs's own dispatch context can reuse the same resolution logic.
//
// Dispatch order: direct/alias fact hit → compose2 rule chase → filter rule
// chase → honest miss (OWA discipline: null / [] on a miss, never a guessed
// "no").

/**
 * RELATION CHASE — given a relation/rule NAME and a fixed (subject, object)
 * pair, resolve whether it holds via (i) a direct taught fact, (ii) an
 * alias-chased predicate, (iii) a 2-hop compose2 Rule chase, or (iv) a filter
 * Rule chase. Returns `{ citation: string[] }` on a hit, null on an honest miss.
 */
export async function resolveRelationChase(memory, name, subjectTerm, objectTerm, helpers) {
  const { relationFactsFor, renderFactLine, factPhrase, factTermVariants, byTrust, rows, HAS_PROPERTY_PREDICATE, findActionPath } = helpers;
  const target = String(name || "").trim().toLowerCase();
  // (i)+(ii): direct hit or alias-chased hit for this exact (subject, object)
  // pair under the queried relation name.
  const sv = factTermVariants(normFactTerm, subjectTerm);
  const ov = factTermVariants(normFactTerm, objectTerm);
  const pairHits = relationFactsFor(target).filter((e) => sv.has(e.fact.subject) && ov.has(e.fact.object));
  if (pairHits.length) {
    const hit = pairHits.slice().sort((a, b) => byTrust(a.fact, b.fact))[0];
    return { citation: [renderFactLine(hit.fact), ...hit.aliasFacts.map(
      (af) => `${factPhrase(af)}${af.provenance ? ` (source: ${af.provenance})` : ""}`,
    )] };
  }
  // The queried name may itself be a taught RULE.
  const rule = findRuleByName(memory, target);
  const ruleKind = rule?.attributes?.find((a) => a.prop === RULE_KIND_PROP)?.value;
  // (iii) COMPOSE2 RULE CHASE — a hop-counted findActionPath search over
  // { entity, hopsTaken } states, dispatching base1's edges at hop 0 and
  // base2's edges at hop 1, requiring EXACTLY hopsTaken === 2 at the goal.
  if (rule && ruleKind === RULE_KIND_COMPOSE2) {
    const base1 = rule.attributes.find((a) => a.prop === "mgx:ruleBase1")?.value;
    const base2 = rule.attributes.find((a) => a.prop === "mgx:ruleBase2")?.value;
    const startEntity = normFactTerm(subjectTerm);
    const targetEntity = normFactTerm(objectTerm);
    if (!base1 || !base2 || !startEntity || !targetEntity) return null;
    const applyActions = (state) => {
      if (state.hopsTaken >= 2) return [];
      const relName = state.hopsTaken === 0 ? base1 : base2;
      return relationFactsFor(relName)
        .filter((e) => e.fact.subject === state.entity)
        .map((e) => ({ action: e, nextState: { entity: e.fact.object, hopsTaken: state.hopsTaken + 1 } }));
    };
    const isGoal = (state) => state.hopsTaken === 2 && state.entity === targetEntity;
    const stateKey = (state) => `${state.entity}#${state.hopsTaken}`;
    const found = findActionPath({ entity: startEntity, hopsTaken: 0 }, isGoal, applyActions, { maxDepth: 2, stateKey });
    if (!found) return null;
    const seenAlias = new Set();
    const parts = [];
    for (const e of found.actions) {
      parts.push(renderFactLine(e.fact));
      for (const af of e.aliasFacts) {
        const key = af.id || `${af.subject}|${af.predicate}|${af.object}`;
        if (seenAlias.has(key)) continue;
        seenAlias.add(key);
        parts.push(`${factPhrase(af)}${af.provenance ? ` (source: ${af.provenance})` : ""}`);
      }
    }
    return { citation: parts };
  }
  // (iv) FILTER RULE CHASE — recursively resolve the base (a plain relation OR
  // another rule — this SAME function calls itself), then filter by whether
  // the SUBJECT carries the property literal (mgx:hasProperty, a plain Fact
  // lookup over the already-loaded `rows`).
  if (rule && ruleKind === RULE_KIND_FILTER) {
    const base = rule.attributes.find((a) => a.prop === "mgx:ruleBase1")?.value;
    const property = rule.attributes.find((a) => a.prop === "mgx:ruleFilterProperty")?.value;
    if (!base || !property) return null;
    const baseHit = await resolveRelationChase(memory, base, subjectTerm, objectTerm, helpers);
    if (!baseHit) return null;
    const subjectEntity = normFactTerm(subjectTerm);
    const propertyNorm = normFactTerm(property);
    const propHit = rows.find(
      (f) => f.predicate === HAS_PROPERTY_PREDICATE && f.subject === subjectEntity && normFactTerm(f.object) === propertyNorm,
    );
    if (!propHit) return null; // base relation holds, but the property filter excludes this candidate
    return { citation: [...baseHit.citation, renderFactLine(propHit)] };
  }
  return null; // no remembered fact, alias, or rule (of any kind) reaches this
}

/**
 * RELATION "WHO" REVERSE CHASE — the mirror image of resolveRelationChase:
 * given a relation/rule name and a fixed OBJECT, return every
 * `{ subject, citation }` pair that satisfies it, instead of one yes/no.
 */
export async function resolveRelationChaseReverse(memory, name, objectTerm, helpers) {
  const { relationFactsFor, renderFactLine, factPhrase, factTermVariants, byTrust, rows, HAS_PROPERTY_PREDICATE, findReachableSet } = helpers;
  const target = String(name || "").trim().toLowerCase();
  const ov = factTermVariants(normFactTerm, objectTerm);
  // (i)+(ii): every direct/alias-chased fact under this name whose object
  // matches the target — one result per distinct subject (the highest-trust
  // fact when more than one reaches the same subject).
  const directHits = relationFactsFor(target).filter((e) => ov.has(e.fact.object));
  if (directHits.length) {
    const bySubject = new Map();
    for (const e of directHits) {
      if (!bySubject.has(e.fact.subject)) bySubject.set(e.fact.subject, []);
      bySubject.get(e.fact.subject).push(e);
    }
    return [...bySubject.entries()].map(([subj, hits]) => {
      const hit = hits.slice().sort((a, b) => byTrust(a.fact, b.fact))[0];
      return {
        subject: subj,
        citation: [renderFactLine(hit.fact), ...hit.aliasFacts.map(
          (af) => `${factPhrase(af)}${af.provenance ? ` (source: ${af.provenance})` : ""}`,
        )],
      };
    });
  }
  const rule = findRuleByName(memory, target);
  const ruleKind = rule?.attributes?.find((a) => a.prop === RULE_KIND_PROP)?.value;
  // (iii) COMPOSE2 REVERSE CHASE — the same hop-counted search the forward
  // chase uses, walked BACKWARD: seed from the TARGET object, reverse-hop via
  // base2's edges first (the SECOND forward hop, closest to the object), then
  // base1's edges (the FIRST forward hop) — swapping which side of each fact
  // is queried (object instead of subject) rather than building a new search
  // kernel. Enumerates every subject reachable at EXACTLY 2 reverse hops, via
  // findReachableSet.
  if (rule && ruleKind === RULE_KIND_COMPOSE2) {
    const base1 = rule.attributes.find((a) => a.prop === "mgx:ruleBase1")?.value;
    const base2 = rule.attributes.find((a) => a.prop === "mgx:ruleBase2")?.value;
    const targetEntity = normFactTerm(objectTerm);
    if (!base1 || !base2 || !targetEntity) return [];
    const applyActionsRev = (state) => {
      if (state.hopsTaken >= 2) return [];
      const relName = state.hopsTaken === 0 ? base2 : base1;
      return relationFactsFor(relName)
        .filter((e) => e.fact.object === state.entity)
        .map((e) => ({ action: e, nextState: { entity: e.fact.subject, hopsTaken: state.hopsTaken + 1 } }));
    };
    const stateKeyRev = (state) => `${state.entity}#${state.hopsTaken}`;
    const reached = findReachableSet(
      { entity: targetEntity, hopsTaken: 0 }, applyActionsRev, { maxDepth: 2, stateKey: stateKeyRev },
    );
    return reached.filter((r) => r.node.hopsTaken === 2).map(({ node, path }) => {
      const seenAlias = new Set();
      const parts = [];
      // path.actions was accumulated walking BACKWARD from the object (base2's
      // edge first, base1's edge second) — reversed here so the citation reads
      // in the natural subject-to-object order, matching the forward chase's
      // own citation order rather than exposing the reverse-walk's internal
      // accumulation order to the caller.
      for (const e of path.actions.slice().reverse()) {
        parts.push(renderFactLine(e.fact));
        for (const af of e.aliasFacts) {
          const key = af.id || `${af.subject}|${af.predicate}|${af.object}`;
          if (seenAlias.has(key)) continue;
          seenAlias.add(key);
          parts.push(`${factPhrase(af)}${af.provenance ? ` (source: ${af.provenance})` : ""}`);
        }
      }
      return { subject: node.entity, citation: parts };
    });
  }
  // (iv) FILTER REVERSE CHASE — reverse-chase the base (recursively, same as
  // the forward filter chase — this SAME function calls itself), then filter
  // the resulting subjects by whether EACH carries the taught property.
  if (rule && ruleKind === RULE_KIND_FILTER) {
    const base = rule.attributes.find((a) => a.prop === "mgx:ruleBase1")?.value;
    const property = rule.attributes.find((a) => a.prop === "mgx:ruleFilterProperty")?.value;
    if (!base || !property) return [];
    const baseHits = await resolveRelationChaseReverse(memory, base, objectTerm, helpers);
    const propertyNorm = normFactTerm(property);
    const out = [];
    for (const bh of baseHits) {
      const subjectEntity = normFactTerm(bh.subject);
      const propHit = rows.find(
        (f) => f.predicate === HAS_PROPERTY_PREDICATE && f.subject === subjectEntity && normFactTerm(f.object) === propertyNorm,
      );
      if (propHit) out.push({ subject: bh.subject, citation: [...bh.citation, renderFactLine(propHit)] });
    }
    return out;
  }
  return []; // no remembered fact, alias, or rule (of any kind) reaches this
}

// ---- Chat-facing seams (W4 fact lookup + contradiction) ---------------------
// The W4 fact-lookup THREADING lives in chat.mjs (NOT here); these pure readers
// are the seam it calls so the answer layer ranks candidates by relevance ×
// trust and cites provenance WITHOUT re-walking the graph shape.

/**
 * Fold every reified Fact in a loaded memory payload into one row per TRIPLE —
 * the group of assertion records sharing a content-addressed group id, one
 * record per asserting source. Pure. The exported seam the chat/answer layer
 * consumes for trust-weighted fact ranking.
 *
 * The row surface is deliberately the one every reader already parses: `id` is
 * the bare group id, `provenance` the ' | '-joined union of the members' tags,
 * `sourceIds`/`sourceTypes` the union as before. `assertions` is the addition —
 * the per-record hop list, for a reader that wants to see WHICH source said it
 * and when rather than one blended number.
 *
 * `extraction` joins both levels when any assertion recorded a finding: the
 * row's union for a consumer deciding whether to lean on the triple at all,
 * each hop's own list for one that needs to know which reading produced it.
 * Absent — never empty — when nothing was recorded.
 *
 * The fold reads live HEADS only. A record its own source has since superseded
 * is that source's PAST belief, not a second vote for the present one; folding
 * it back in would let one source's edit history inflate its own corroboration.
 * Demoted records stay walkable through mgx:supersedes/mgx:supersededBy, which
 * answers "what did this source used to say", never "what do I trust now".
 */
export function readFactRows(memory, opts = {}) {
  const ctx = factFoldContext(memory);
  // A materialised head, when the backend keeps one, replaces the group's own
  // fold with the audit trail that fold was last built from — the same records,
  // read back instead of re-derived. It carries no recency by construction, so
  // the aggregate below still lands at THIS reading moment either way; a store
  // that has never materialised a head for this group (a fresh in-memory store,
  // a hand-built fixture, a backend with no head table) simply folds it.
  const heads = factHeadsOf(memory);
  const rows = [];
  for (const [id, members] of ctx.groups) {
    const row = foldFactGroup(id, members, ctx);
    const head = heads?.get(id);
    // Computed fresh, never stored: recency is a function of the reading
    // moment, so a stored aggregate is stale by pure passage of time.
    row.trust = computeAssertionGroupTrust(head ? head.inputs : row.assertions, opts).score;
    rows.push(row);
  }
  return rows;
}

/** Everything a group fold reads out of a payload, gathered in one pass: each
 *  triple group's live head records, the groups each (subject, predicate)
 *  carries, and the two lookups a record's own source resolves through.
 *
 *  Shared by the read fold and by the head materialisation below, deliberately:
 *  a stored aggregate and a computed one folded from different inputs is the
 *  failure a materialised table invites, and one shared builder is what keeps
 *  the two from ever drifting apart. */
function factFoldContext(memory) {
  const individuals = memory?.individuals || [];
  const sourcesById = new Map(individuals.filter((i) => i?.class === SOURCE_CLASS).map((i) => [i.id, i]));
  const statedGroup = (memory?.objectProperties || []).find((g) => g?.prop === STATED_BY_PROP);
  const statedByRecord = new Map();
  for (const e of statedGroup?.examples || []) {
    if (!statedByRecord.has(e.subject)) statedByRecord.set(e.subject, []);
    statedByRecord.get(e.subject).push(e.object);
  }

  const groups = new Map();
  const retractionsByGroup = new Map();
  for (const ind of individuals) {
    if (ind?.class === RETRACTION_CLASS) {
      const groupId = factGroupId(ind.id);
      const held = retractionsByGroup.get(groupId);
      if (held) held.push(ind);
      else retractionsByGroup.set(groupId, [ind]);
      continue;
    }
    if (ind?.class !== FACT_CLASS) continue;
    if ((ind.attributes || []).some((a) => a?.prop === SUPERSEDED_BY_PROP)) continue; // a demoted leaf, not a head
    if (isChainRollupId(ind.id)) continue; // a summary of one source's demoted history, which was never a vote
    const groupId = factGroupId(ind.id);
    const group = groups.get(groupId);
    if (group) group.push(ind);
    else groups.set(groupId, [ind]);
  }

  // The read half of retraction enforcement. A record a peer re-delivered before
  // its retraction arrived is still sitting in the payload, and this is what
  // keeps it out of the answer: the fold is a pure function of the fact set, so
  // both peers read the same row whichever order the two arrived in. Only a
  // group that actually carries a retraction pays anything for the check.
  for (const [groupId, retractions] of retractionsByGroup) {
    const members = groups.get(groupId);
    if (!members) continue;
    const standing = members.filter((ind) => !isRetractedRecord(
      retractions,
      ind.id,
      assertionTimestampFor(individualAttr(ind, "mgx:factProvenance").split(" | ").filter(Boolean), individualAttr(ind, CREATED_AT_PROP)),
    ));
    if (standing.length === members.length) continue;
    if (standing.length) groups.set(groupId, standing);
    else groups.delete(groupId);
  }

  const groupsByPair = new Map();
  for (const [groupId, members] of groups) {
    // Codepoint order on the record id, which sorts by source key — the same
    // locale-free determinism the P2P layer's own sort insists on, so two peers
    // holding the same records read the same row.
    members.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const key = subjectPredicateKey(individualKey(members[0], "subject"), individualKey(members[0], "predicate"));
    const held = groupsByPair.get(key);
    if (held) held.push(groupId);
    else groupsByPair.set(key, [groupId]);
  }

  return {
    groups,
    groupsByPair,
    statedByRecord,
    sourceTypeOf: (id) => (sourcesById.get(id)?.attributes || []).find((a) => a?.prop === "mgx:sourceType")?.value || "",
  };
}

/** One triple group folded into its row, minus the aggregate trust — that is
 *  the caller's, because it is the only part that depends on when you ask. */
function foldFactGroup(id, heads, ctx) {
  const { statedByRecord, sourceTypeOf } = ctx;
  const attrOf = individualAttr;
  const keyOf = individualKey;

  const assertions = [];
  const sourceIds = [];
  const sourceTypes = [];
  const tags = new Set();
  const findings = new Set();
  const environments = [];
  const seenEnvironment = new Set();
  let quantifier = "";
  for (const head of heads) {
    // A pool-1 summary joins the fold as ONE pseudo-record standing for every
    // head it absorbed: its noisy-OR base is their combined contribution, and
    // its recency comes from the newest assertion time it absorbed, so the
    // decay still happens at the reading moment rather than being baked in.
    // The sources it absorbed stay in the union a reader renders — they did
    // vouch for this triple, and the summary is where that record now lives.
    if (isHeadRollupId(head.id)) {
      const rollupType = headRollupTypeOf(head.id);
      const absorbed = absorbedSourceIds(head);
      for (const sid of absorbed) {
        if (sourceIds.includes(sid)) continue;
        sourceIds.push(sid);
        if (rollupType) sourceTypes.push(rollupType);
      }
      assertions.push({
        id: head.id, sourceId: "", sourceType: rollupType,
        provenance: "",
        createdAt: attrOf(head, ROLLUP_EARLIEST_PROP),
        ownTrust: Number(attrOf(head, ROLLUP_PRIOR_PROP)) || 0,
        assertedAt: attrOf(head, ROLLUP_LATEST_PROP),
        rollup: {
          count: Number(attrOf(head, ROLLUP_COUNT_PROP)) || absorbed.length,
          sourceIds: absorbed,
          earliest: attrOf(head, ROLLUP_EARLIEST_PROP),
          latest: attrOf(head, ROLLUP_LATEST_PROP),
        },
      });
      continue;
    }
    const headTags = attrOf(head, "mgx:factProvenance").split(" | ").filter(Boolean);
    for (const tag of headTags) tags.add(tag);
    const [statedBy] = statedByRecord.get(head.id) || [];
    const sourceId = statedBy || attrOf(head, SOURCE_ID_PROP);
    const sourceType = sourceTypeOf(sourceId);
    // src:none stands for "no Source at all", so it stays out of the union a
    // reader renders and out of the corroboration count, exactly as an
    // unattributable fact has always read.
    if (statedBy && !sourceIds.includes(statedBy)) {
      sourceIds.push(statedBy);
      if (sourceType) sourceTypes.push(sourceType);
    }
    const createdAt = attrOf(head, CREATED_AT_PROP);
    const observedAt = attrOf(head, OBSERVED_AT_PROP);
    const extraction = attrOf(head, EXTRACTION_FINDING_PROP).split(" ").filter(Boolean);
    for (const finding of extraction) findings.add(finding);
    assertions.push({
      id: head.id, sourceId, sourceType,
      provenance: headTags.join(" | "),
      createdAt,
      ...(observedAt ? { observedAt } : {}),
      ...(extraction.length ? { extraction } : {}),
      ownTrust: Number(attrOf(head, TRUST_SCORE_PROP)) || 0,
      assertedAt: assertionTimestampFor(headTags, createdAt),
    });
    quantifier = quantifier || keyOf(head, "quantifier");
    // ' | '-separated environments, one premise-id list per independent
    // derivation; a legacy value with no ' | ' parses as one environment.
    for (const chunk of keyOf(head, "justification").split(" | ")) {
      const env = chunk.split(" ").filter(Boolean);
      if (!env.length) continue;
      const key = env.join(" ");
      if (seenEnvironment.has(key)) continue;
      seenEnvironment.add(key);
      environments.push(env);
    }
  }
  const justification = [];
  const seenPremise = new Set();
  for (const env of environments) {
    for (const premise of env) {
      if (seenPremise.has(premise)) continue;
      seenPremise.add(premise);
      justification.push(premise);
    }
  }
  return {
    id,
    subject: keyOf(heads[0], "subject"), predicate: keyOf(heads[0], "predicate"), object: keyOf(heads[0], "object"),
    // The compat union string readers already parse, codepoint-sorted so it
    // does not depend on which order the records happened to arrive in.
    provenance: [...tags].sort().join(" | "),
    quantifier, // "" unless a plural class-membership teach set one
    sourceIds, sourceTypes,
    // Every finding any live assertion of this triple carries, unioned the same
    // way the provenance tags above are, and ABSENT when there are none. A
    // consumer that needs to know which source read it that way reads the
    // per-assertion `extraction` in the hop list instead. Absence means no
    // findings were recorded — never that the sentence read cleanly.
    ...(findings.size ? { extraction: [...findings].sort() } : {}),
    // `environments`: every persisted premise set (empty unless entailed);
    // `justification`: their deduped union in first-occurrence order, for
    // readers that only need "which premises does this fact cite at all".
    environments,
    justification,
    // The hop list the blended number is folded from — one entry per source
    // that asserted this triple, each with its own time and its own weight.
    assertions,
  };
}

/** The source key one record id belongs to: what sits between the `@` and any
 *  chain or summary suffix. A record's own stored key wins when it has one; the
 *  parse covers a demoted leaf and a summary, which carry the same key in their
 *  id but do not all store it. */
function recordSourceIdOf(record) {
  const stored = individualAttr(record, SOURCE_ID_PROP);
  if (stored) return stored;
  const id = String(record?.id || "");
  const at = id.indexOf("@");
  if (at < 0) return "";
  const rest = id.slice(at + 1);
  const hash = rest.indexOf("#");
  return hash < 0 ? rest : rest.slice(0, hash);
}

/** Retract facts by id — a real DELETE (syllogise.mjs's retractability
 *  mechanism). A GROUP id retracts the triple: every source's record for it,
 *  demoted leaves included, since retracting "dogs bark" cannot leave half its
 *  assertions standing. A single record id retracts just that record. Scrubs
 *  any edge referencing a removed id as subject or object; an orphaned Source
 *  is left in place (not a GC pass). Unknown ids are silently skipped.
 *
 *  The delete leaves a RETRACTION RECORD behind, one per (triple, source),
 *  carrying the record ids it suppressed and the moment it did. That record is
 *  what makes the retraction survive a sync: a plain delete against a grow-only
 *  set comes straight back from any peer that still holds the fact. It also
 *  keeps the retraction on record rather than erasing the fact that something
 *  was asserted at all. A retraction record is never itself removed here.
 *
 *  Returns { removed, records } — `removed` the ids asked for that matched, so
 *  it may be smaller than the input and is never longer than it; `records` the
 *  concrete record ids that went, which is what the retraction absorbed. */
export async function removeFacts(dir, ids, { provenance = "", retractedAt = "" } = {}) {
  const idSet = new Set((ids || []).filter(Boolean));
  const removed = [];
  const records = [];
  if (!idSet.size) return { removed, records };
  const retractedAtVal = retractedAt || nowIso();
  await mutateMemory(dir, (payload) => {
    const removedSet = new Set();
    const matched = new Set();
    const retiredByGroupAndSource = new Map(); // `${groupId} ${sourceId}` -> { groupId, sourceId, ids, template }
    payload.individuals = (payload.individuals || []).filter((ind) => {
      if (ind?.class !== FACT_CLASS) return true;
      const groupId = factGroupId(ind.id);
      const asked = idSet.has(ind.id) ? ind.id : (idSet.has(groupId) ? groupId : "");
      if (!asked) return true;
      matched.add(asked);
      removedSet.add(ind.id);
      const sourceId = recordSourceIdOf(ind);
      const key = `${groupId} ${sourceId}`;
      // The record's own tags come along. They are the account of what was
      // asserted and by whom, which a retraction keeps rather than erases, and
      // they are also what lets a broadcast re-key this id onto the Source the
      // receiving store files the same assertion under.
      const tags = individualAttr(ind, "mgx:factProvenance");
      const retired = retiredByGroupAndSource.get(key);
      if (retired) {
        retired.ids.push(ind.id);
        if (tags) retired.tags.push(tags);
      } else {
        retiredByGroupAndSource.set(key, {
          groupId,
          sourceId,
          ids: [ind.id],
          tags: tags ? [tags] : [],
          template: {
            label: ind.label || "",
            subject: individualAttr(ind, "rdf:subject"),
            predicate: individualAttr(ind, "rdf:predicate"),
            object: individualAttr(ind, "rdf:object"),
          },
        });
      }
      return false;
    });
    for (const id of matched) removed.push(id);
    if (!removed.length) return; // honest no-op — nothing matched, no write needed beyond this
    for (const id of removedSet) records.push(id);
    for (const group of payload.objectProperties || []) {
      const before = group.examples || [];
      group.examples = before.filter((e) => !removedSet.has(e?.subject) && !removedSet.has(e?.object));
      group.count = group.examples.length;
    }
    for (const retired of retiredByGroupAndSource.values()) {
      const record = planRetraction({
        groupId: retired.groupId,
        sourceId: retired.sourceId,
        recordIds: retired.ids,
        retractedAt: retractedAtVal,
        template: retired.template,
        provenance: [...retired.tags, provenance].filter(Boolean).join(" | "),
      });
      if (record) upsertIndividual(payload, record);
    }
    recountClasses(payload);
  });
  return { removed, records };
}

/** Every retraction record the store holds, as the wire facts that carry them.
 *  The P2P layer's own diff and sync response read this: a retraction is not a
 *  fact row, so nothing that walks readFactRows would ever find one. */
export function readRetractions(memory) {
  const out = [];
  for (const ind of memory?.individuals || []) {
    if (ind?.class !== RETRACTION_CLASS) continue;
    const fact = retractionWireFact(ind);
    if (fact) out.push(fact);
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Merge received retractions and enforce them. Two steps, and both are
 *  needed: the record joins by union with whatever this store already held for
 *  that (triple, source), then any assertion it now suppresses is dropped. The
 *  second step is what makes a retraction that arrives AFTER the fact converge
 *  with one that arrives before it.
 *
 *  Returns { merged, removed } — how many records landed, and the record ids the
 *  enforcement took out. */
export async function appendRetractions(dir, wireFacts) {
  const incoming = [];
  for (const fact of wireFacts || []) {
    const record = retractionFromWire(fact);
    if (record) incoming.push(record);
  }
  const removed = [];
  if (!incoming.length) return { merged: 0, removed };
  await mutateMemory(dir, (payload) => {
    const suppress = new Map(); // groupId -> the merged retraction records over it
    for (const record of incoming) {
      const stored = upsertIndividual(payload, record);
      const groupId = factGroupId(stored.id);
      const held = suppress.get(groupId);
      if (held) held.push(stored);
      else suppress.set(groupId, [stored]);
    }
    // A retraction that names a triple this store never held is still stored —
    // it has to be, or the fact arriving later would land unopposed.
    const drop = new Set();
    for (const [groupId, retractions] of suppress) {
      for (const recordId of factRecordIdsFor(payload, groupId)) {
        const stored = storedIndividual(payload, recordId);
        if (!stored) continue;
        const tags = individualAttr(stored, "mgx:factProvenance").split(" | ").filter(Boolean);
        if (!isRetractedRecord(retractions, recordId, assertionTimestampFor(tags, individualAttr(stored, CREATED_AT_PROP)))) continue;
        drop.add(recordId);
      }
    }
    if (drop.size) {
      dropAbsorbedRecords(payload, drop);
      for (const id of drop) removed.push(id);
    }
    recountClasses(payload);
  });
  return { merged: incoming.length, removed };
}

/** What this store could retire, and the roster it has to convince first.
 *
 *  `roster` is the world's admission graph, folded to a set of node ids —
 *  replicated, grow-only, and the same on every peer holding the same facts.
 *  `retirable` is the tombstones every peer on that roster is known to hold.
 *  `acknowledgedBy(nodeId)` is what supplies that evidence; nothing produces it
 *  yet, so `retirable` reads empty and this is a report rather than a sweep.
 *  Retiring nothing is the current behaviour, and it is the safe one: a
 *  tombstone dropped one peer early lets that peer's copy resurrect a retracted
 *  fact. See docs/references/papers/crdt.md. */
export function retirableRetractions(memory, { self = "", acknowledgedBy = null } = {}) {
  const roster = admittedNodes(readFactRows(memory));
  const recordIds = [];
  for (const ind of memory?.individuals || []) {
    if (ind?.class === RETRACTION_CLASS && ind.id) recordIds.push(ind.id);
  }
  return { roster, retirable: stableRecordIds({ recordIds, roster, self, acknowledgedBy }) };
}

/** Drop named retraction records. Takes the ids rather than choosing them, so a
 *  caller has to have run the stability rule and passed its answer; ids that are
 *  not retraction records are skipped. Returns the ids that went. */
export async function retireRetractions(dir, ids) {
  const asked = new Set((ids || []).filter(Boolean));
  const retired = [];
  if (!asked.size) return { retired };
  await mutateMemory(dir, (payload) => {
    const drop = new Set();
    payload.individuals = (payload.individuals || []).filter((ind) => {
      if (ind?.class !== RETRACTION_CLASS || !asked.has(ind.id)) return true;
      drop.add(ind.id);
      return false;
    });
    if (!drop.size) return;
    for (const id of drop) retired.push(id);
    const idx = memoryIndexOf(payload);
    if (idx) {
      for (const id of drop) {
        idx.individualsById.delete(id);
        const groupId = factGroupId(id);
        const held = (idx.retractionsByGroup.get(groupId) || []).filter((r) => !drop.has(r.id));
        if (held.length) idx.retractionsByGroup.set(groupId, held);
        else idx.retractionsByGroup.delete(groupId);
      }
    }
    recountClasses(payload);
  });
  return { retired };
}

/** The trust floor a fact must clear before a differing object counts as a real
 *  contradiction (below it the fact is too weak to contradict anything). */
const CONTRADICTION_TRUST_FLOOR = 0.5;

export const HAS_A_PREDICATE = "mgx:hasA";
export const CAPABLE_OF_PREDICATE = "mgx:capableOf";

/** Predicates whose real-world semantics allow many objects at once ("a dog
 *  has legs" AND "a dog has a tail"; "a bird can fly" AND "a bird can sing"),
 *  so a second object is a second fact, never a disagreement. Derived from the
 *  resolver table's `merge` row, so the two can never say different things. */
export const MULTI_VALUED_PREDICATES = MERGE_PREDICATES;

/** Facts that CONTRADICT: same (subject, predicate), different object, each
 *  above the trust floor. Returns groups (trust-desc) so callers surface both,
 *  never silently pick one.
 *
 *  Two stages, and only the second one is here. Stage 1 — the records inside
 *  one triple group — is readFactRows' own fold: same (s,p,o) is corroboration,
 *  and a group is internally agreeing by construction. Stage 2 is this: across
 *  the OBJECTS one (subject, predicate) carries, under the resolver table.
 *  A merge predicate never reports; a state or registration predicate reports
 *  only what its own clock could not order (the resolver's trust and codepoint
 *  tie-breaks — see resolveSiblingGroups), so ordinary succession stops reading
 *  as disagreement; every other predicate keeps the full keep-both contract. */
export function findContradictions(memory, { floor = CONTRADICTION_TRUST_FLOOR } = {}) {
  const rows = readFactRows(memory).filter((r) => r.trust >= floor);
  const byKey = new Map();
  for (const r of rows) {
    if (resolutionStrategyFor(r.predicate) === RESOLUTION_MERGE) continue;
    const key = `${r.subject} ${r.predicate}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }
  const out = [];
  for (const group of byKey.values()) {
    if (new Set(group.map((r) => r.object)).size < 2) continue;
    const strategy = resolutionStrategyFor(group[0].predicate);
    if (strategy !== RESOLUTION_CONTRADICTION && !resolveSiblingGroups(group, strategy).contested) continue;
    out.push(group.slice().sort((a, b) => b.trust - a.trust || a.object.localeCompare(b.object)));
  }
  return out.sort((a, b) => `${a[0].subject} ${a[0].predicate}`.localeCompare(`${b[0].subject} ${b[0].predicate}`));
}
