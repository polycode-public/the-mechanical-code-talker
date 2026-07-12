// memory/core.mjs — tmct's OWN conversational memory graph (ROADMAP item 9).
//
// A dedicated OWL-labelled store at <repo>/.tmct/memory/graph.json — raw JSON in
// the exact `entities` shape buildEntities produces, so codegraph.mjs's
// parseEntities() loads it unchanged ({ individuals, byId, relations, proseIndex }).
// It is DISTINCT from any provider-supplied code graph: tmct never writes a
// provider's graph (docs/adapter-contract.md); memory writes land ONLY here.
//
// What goes in:
//   - every parsed inbound request becomes an "a-visitor-said" individual
//     (class `Utterance`, role=visitor) and every response an "a-tmct-said"
//     individual (role=tmct), each carrying text/ts/role attributes, an
//     `mgx:saidInSession` edge to its Session anchor, and — for a response —
//     an `mgx:inReplyTo` edge to the visitor utterance it answers;
//   - grammar-derived OWL triples via appendFact() (subject/predicate/object +
//     provenance), reified RDF-style (rdf:subject / rdf:predicate / rdf:object
//     on a `Fact` individual) — the Phase-2 ACE parser's write point.
//
// OWL labelling: individuals are rdf-ish typed twice — the payload-level `class`
// field (Utterance / Fact / Session, counted in `classes[]` like every other
// graph class) AND an `rdf:type` attribute naming the OWL term
// (owl:NamedIndividual for utterances, rdf:Statement for reified facts), with
// the owl/rdf/rdfs prefixes declared in the payload's `prefixes` block —
// consistent with graph-build.mjs's JSON-label-only vocabulary style.
//
// Every append is crash-safe (fresh read → mutate → temp-file + rename, the
// sessions.mjs discipline) and IDEMPOTENT: utterance ids are deterministic
// (utt:<session>#<ts>#<role>) and fact ids hash the triple, so the per-turn
// re-append sessions.mjs performs replaces rather than duplicates.

import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { proseTokensFor, buildProseIndex } from "../prose.mjs";
import { fnv1aHex } from "../hash.mjs";
import { computeTrust, sessionReliabilityFrom, TRUST_SCORE_PROP, TRUST_INPUTS_PROP } from "./trust.mjs";
import { assertIndividualValid } from "./shacl.mjs";
import { findActionPath, findReachableSet } from "../planning.mjs";

export const MEMORY_DIR_REL = join(".tmct", "memory");
export const MEMORY_GRAPH_REL = join(MEMORY_DIR_REL, "graph.json");

export const UTTERANCE_CLASS = "Utterance";
export const FACT_CLASS = "Fact";
export const MEMORY_SESSION_CLASS = "Session";
export const SOURCE_CLASS = "Source";
// PLAN_TAUGHT_RELATIONS.md Phase 3: a taught RULE (a composed/filtered/
// recursive relation-shape) — a sibling of Fact, never a taught concept itself.
export const RULE_CLASS = "Rule";

export const SAID_IN_SESSION_PROP = "mgx:saidInSession";
export const IN_REPLY_TO_PROP = "mgx:inReplyTo";

// The provenance-link predicate family (PLAN_PROVENANCE_TRUST step (b)): one
// umbrella object property with two workhorse subproperties, minted in the owned
// mgx: namespace to match tmct-core.ttl's object-property style.
export const DERIVED_FROM_PROP = "mgx:derivedFrom";        // umbrella: Fact → Source|Fact
export const STATED_BY_PROP = "mgx:statedBy";              // a Source directly asserts a Fact
export const CANONICALISED_FROM_PROP = "mgx:canonicalisedFrom"; // a canonical Fact ← its raw form
export const CREATED_AT_PROP = "mgx:createdAt";           // first-write-wins ISO-8601 on every individual
// DERIVED at read/render time for most individuals (codegraph.mjs's derivedUpdatedAt: an
// individual's own createdAt, or the max createdAt over every edge touching it) — this constant
// exists for the handful of call sites that mutate an individual's OWN attributes in place
// without necessarily touching an edge (upsertSession, recomputeFactTrust,
// recomputeSourceReliability), where the derived rule alone can't see the change (PLAN_VIZ.md §2).
export const UPDATED_AT_PROP = "mgx:updatedAt";
export const SOURCE_RELIABILITY_PROP = "mgx:sourceReliability"; // actor-level (session-scoped) trust nudge on a Source, [0.5,1.5]

// The bare (session-less) singleton Source ids — the fallback for an
// operator/teach provenance tag that carries no session-id segment (e.g. a
// hand-authored "chat:"/"session:"/"operator" tag, or a direct API caller
// that never threaded a session id through). Once a provenance tag DOES carry
// a session-id segment (every real chat/teach write does — see
// grammar/assert.mjs's provenanceTag / chat.mjs's teachProvenanceTag), each
// session mints its OWN Source individual instead: `${ID}:<sessionId>`
// (sourceIdFor below) — actor-level (session-scoped) trust, unconditional,
// no config flag (PLAN_PROVENANCE_TRUST Part B).
export const OPERATOR_SOURCE_ID = "src:operator-chat";
export const TEACH_SOURCE_ID = "src:teach-chat";

const ROLES = new Set(["visitor", "tmct"]);
const LABEL_CAP = 48;    // utterance/fact labels stay skimmable in renders
const TEXT_CAP = 2000;   // an utterance's stored text (a whole answer fits; a pasted book doesn't)

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
  { prop: "mgx:factQuantifier", note: "OPTIONAL: the quantifier word a plural class-membership teach used ('every'/'some'/'a few'), for literal recall by 'how many Xs are Ys' — never real cardinality counting" },
  { prop: "mgx:ruleName", note: "a taught Rule's own name (e.g. 'grandparent') — the query-dispatcher's lookup key, PLAN_TAUGHT_RELATIONS.md §2/§3" },
  { prop: "mgx:ruleKind", note: "a taught Rule's SHAPE tag — the closed vocabulary compose2 | filter | recursive (structural, like 'Fact'/'Rule' themselves, never a domain word)" },
  { prop: "mgx:ruleBase1", note: "compose2: the first hop's base relation name; filter: the base rule/relation being filtered (same 'base relation' role in both kinds, so the name is shared)" },
  { prop: "mgx:ruleBase2", note: "compose2 only: the second hop's base relation name" },
  { prop: "mgx:ruleFilterProperty", note: "filter only: the property literal candidates are filtered by (an mgx:hasProperty-shaped Fact lookup)" },
  { prop: "mgx:ruleBaseCase", note: "recursive only: the base-case relation name (hop zero)" },
  { prop: "mgx:ruleRecStep", note: "recursive only: the self-referential recursive-step relation name" },
  { prop: CREATED_AT_PROP, note: "when an individual was FIRST written, ISO-8601 (first-write-wins on upsert); the audit 'when', the recency input to trust, the novelty signal" },
  { prop: UPDATED_AT_PROP, note: "when an individual's OWN attributes were last mutated in place (upsertSession, recomputeFactTrust, recomputeSourceReliability) — most individuals never carry this and instead derive 'updated' from codegraph.mjs's derivedUpdatedAt (max createdAt over their edges)" },
  { prop: DERIVED_FROM_PROP, predicate: "derivedFrom", note: "umbrella: a Fact derived from a Source (or another Fact). ext ref prov:wasDerivedFrom (UNVERIFIED-pending-web-check)" },
  { prop: STATED_BY_PROP, predicate: "statedBy", note: "subPropertyOf derivedFrom: a Source directly asserts this Fact (one edge per independent source — replaces the factProvenance union)" },
  { prop: CANONICALISED_FROM_PROP, predicate: "canonicalisedFrom", note: "subPropertyOf derivedFrom: a canonical Fact cleaned from a raw Block/Source, never replacing it" },
  { prop: "mgx:sourceType", note: "a Source's kind: operator | teach | provider | corpus | corpusWeak | extracted | web | entailed (the trust-prior key)" },
  { prop: "mgx:sourceUrl", note: "a web Source's URL" },
  { prop: "mgx:sourceRule", note: "an entailed Source's rule id" },
  { prop: "mgx:sourceReliability", note: "actor-level (session-scoped) trust nudge in [0.5,1.5], neutral 1.0 when absent — materialised by recomputeSourceReliability from a session's asserted-vs-contradicted track record (memory/trust.mjs's sessionReliabilityFrom); folds into computeTrust's per-source prior" },
  { prop: TRUST_SCORE_PROP, note: "materialised trust cache in [0,1] — pure function of a fact's Sources + createdAt (memory/trust.mjs); invalidated when a statedBy edge is added" },
  { prop: TRUST_INPUTS_PROP, note: "JSON of the inputs the trust score was computed from (source-type multiset, corroboration count, createdAt, recency) — makes the score auditable" },
  { prop: "mgx:hasProseTokens", note: "prose tokens (prose.mjs tokenizer) backing the payload's proseIndex" },
  { prop: "mgx:sessionStarted", note: "session anchor: when the session started, ISO-8601" },
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
    },
    vocabulary: MEMORY_VOCABULARY.map((v) => ({ ...v })),
    classes: [],
    objectProperties: [],
    individuals: [],
    proseIndex: {},
  };
}

/** Resolve the on-disk path of a memory graph file for `dir`. `version === null`
 *  (the default) is the LIVE graph (`graph.json`) — the one path every mutator
 *  funnels through (mutateMemory here, writeMemoryGraph in fold.mjs). A numeric
 *  `version` resolves a SNAPSHOT copy (`graph.v{version}.json`, see
 *  snapshotMemory below) — never the live file. The single source of truth for
 *  "where does the memory graph live on disk", closing the desync risk of two
 *  independent path-resolution copies (core.mjs's mutateMemory and fold.mjs's
 *  writeMemoryGraph used to compute this path separately). */
export function resolveMemoryGraphFile(dir, version = null) {
  if (isMemoryHandle(dir) || isSqliteHandle(dir)) {
    throw new Error("resolveMemoryGraphFile: dir is a memory/sqlite handle, not a file path (Backend A only)");
  }
  if (version === null) return join(dir, MEMORY_GRAPH_REL);
  return join(dir, MEMORY_DIR_REL, `graph.v${version}.json`);
}

const memoryGraphFile = (dir) => resolveMemoryGraphFile(dir);

// ---- Storage-backend seam (PLAN_SEED.md §6) ---------------------------------
//
// Every dir-taking export in this file historically assumed `dir` was a plain
// string repo path that resolveMemoryGraphFile joins into an on-disk file
// (Backend A, unchanged below — still the exact byte-identical default for
// every existing caller that never opts into anything else).
//
// `dir` may now ALSO be a memory HANDLE: a small tagged object created by
// createInMemoryStore() (Backend B, pure in-memory, zero disk I/O) or
// createSqliteMemoryStore() (Backend C, a live node:sqlite connection kept
// open for the session's lifetime). loadMemory/mutateMemory below recognize
// both and dispatch the LOAD/PERSIST steps only; every other function in this
// file (appendFact, appendFacts, appendUtterance(s), appendRule,
// readFactRows, findRuleByName, resolveRelationChase(Reverse),
// findContradictions) takes `memory`/`dir` exactly as before and never
// branches on backend — they operate on the plain JS payload object
// mutateMemory hands them, regardless of where it came from or where it goes
// next. That is the whole point of the seam: id hashing, provenance/trust
// computation, migrateLegacyProvenance, recomputeSourceReliability and
// buildProseIndex are backend-agnostic logic, unchanged either way.
//
// snapshotMemory (manifest-versioned snapshots) and resolveMemoryGraphFile
// stay Backend-A-only (a handle has no on-disk file to snapshot) — both throw
// a clear error if given a handle rather than silently doing the wrong thing.

const BACKEND_MEMORY = "memory";
const BACKEND_SQLITE = "sqlite";

function isMemoryHandle(dir) {
  return !!dir && typeof dir === "object" && dir.backend === BACKEND_MEMORY;
}
function isSqliteHandle(dir) {
  return !!dir && typeof dir === "object" && dir.backend === BACKEND_SQLITE;
}
function isMemoryOrSqliteHandle(dir) {
  return isMemoryHandle(dir) || isSqliteHandle(dir);
}

/**
 * Backend B — pure in-memory store (new). A plain JS object held by the
 * CALLER (never module-global state, which would break multiple concurrent
 * sessions in one process): `{ backend: "memory", payload }`. loadMemory
 * returns `payload` directly (the live reference, not a fresh parse — there
 * is nothing to parse); mutateMemory's persist step is a no-op assignment
 * (`handle.payload = out` — already the same object in every real caller,
 * since none of appendFact/appendFacts/appendUtterance(s)/appendRule ever
 * return a NEW object from their mutateMemory callback, they all mutate the
 * payload in place). ZERO readFile/writeFile/JSON.parse/JSON.stringify calls
 * ever happen for this backend — verified directly by this module's own
 * dispatch (no fs import is even reachable from this path) and by
 * test/memory-backend-memory.test.mjs's fs-spy assertions.
 *
 * Distinct from `--ephemeral` (createSession): ephemeral mode still does real
 * readFile/JSON.parse/writeFile round-trips against a throwaway mkdtemp temp
 * dir every turn — "disposable disk," not "no disk." Backend B is genuinely
 * disk-free.
 */
export function createInMemoryStore() {
  return { backend: BACKEND_MEMORY, payload: emptyMemory() };
}

// ---- Backend C — SQLite (new; schema shape adapted from seonix's src/store.mjs,
// write model is NOT) ----------------------------------------------------------
//
// seonix (a sibling repo consuming tmct as a library) already has a working,
// opt-in node:sqlite store (SEONIX_STORE=sqlite, node:sqlite lazily imported,
// zero external dependency): an `ids`/`nodes`/`relations`/`edges`/`meta` table
// set. Its WRITE MODEL is a full rebuild-and-atomic-swap on every write — correct
// for seonix's problem (read-latency on a relatively static, rebuild-on-change
// code graph), wrong for tmct's (write-heavy, one-fact-at-a-time accumulation
// across a session's lifetime): lifting it as-is would just replace "rewrite the
// whole JSON file per turn" with "rebuild the whole SQLite file per turn."
//
// tmct's Backend C reuses the SHAPE, not the write model: real per-row
// INSERT/REPLACE/DELETE against a LIVE, OPEN connection kept for the session's
// lifetime (see createSqliteMemoryStore/closeSqliteMemoryStore below),
// diffed against whatever is already on that row so only touched
// individuals/edges are ever written — not seonix's rebuild-and-swap.
//
// Schema, adapted (not ported) to tmct's actual payload shape (emptyMemory(),
// above — { generated_at, memory, prefixes, vocabulary, classes,
// objectProperties, individuals, proseIndex }, distinct from seonix's code-graph
// `entities` shape): seonix's separate integer-interning `ids` table exists to
// cover edge endpoints that AREN'T always node ids (e.g. an `inherits` edge's
// `ext:<Base>` target). tmct's own edge groups (saidInSession, inReplyTo,
// statedBy, canonicalisedFrom) only ever link two individuals-table ids, so
// that interning table is dropped here — individuals/edges reference each
// other by their natural TEXT id directly, a deliberate simplification over a
// literal port. A Fact's reified rdf:subject/rdf:predicate/rdf:object live as
// ATTRIBUTES on the individual (tmct's own reification style, no seonix
// equivalent), so they ride inside that individual's own JSON blob column —
// no separate fact-triple columns needed.
//
// Cached, incrementally patched reads (closes the PLAN_SEED.md §6 gap the
// prior "honest shortcut" comment used to flag here): the READ side
// (readSqlitePayload) reconstructs the FULL in-memory payload shape from real
// SQL SELECTs only ONCE — the first call for a given handle, or the first
// call after a failed/rolled-back write — and stashes the result on
// `handle.cachedPayload`. Every later call returns a deep clone of that cache
// directly, with ZERO SQL queries: no re-SELECT of individuals, no
// per-relation edge SELECT. The WRITE side (persistSqlitePayload) was never a
// shortcut: it already diffs the incoming payload against what is already in
// each row/edge-group and only issues a real INSERT/REPLACE/DELETE for what
// actually changed (write cost proportional to what changed this turn, not to
// the total store size). It now ALSO applies that exact same diff to
// `handle.cachedPayload` in lockstep — patching only the individuals/edges it
// actually wrote to SQLite, in the same order SQLite itself would reorder
// them (a changed row gets a fresh rowid and sorts last) — so the cache never
// goes stale, and never needs a re-query to catch up either. If a write fails
// mid-transaction (ROLLBACK), the partially-patched cache is not trusted: it
// is invalidated so the NEXT read does an honest full rebuild instead of
// risking a state that was never actually committed.

const SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS individuals (id TEXT PRIMARY KEY, ord INTEGER NOT NULL, class TEXT, label TEXT, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS relations (prop TEXT PRIMARY KEY, ord INTEGER NOT NULL, predicate TEXT, count INTEGER);
CREATE TABLE IF NOT EXISTS edges (prop TEXT NOT NULL, subject TEXT NOT NULL, object TEXT NOT NULL, subject_label TEXT, object_label TEXT, extra TEXT, PRIMARY KEY (prop, subject, object));
CREATE INDEX IF NOT EXISTS edges_by_prop ON edges(prop);
`;

// Edge keys with dedicated columns; any other key on an edge example object
// (none exist in core.mjs's own edge groups today, but a future/external
// writer might add one) round-trips via the `extra` JSON column, same
// discipline as seonix's own STD_EDGE_KEYS.
const STD_EDGE_KEYS = new Set(["subject", "object", "subjectLabel", "objectLabel"]);

/**
 * Open (creating if absent) a resident node:sqlite connection for `dbPath` and
 * return a Backend C handle: `{ backend: "sqlite", db, dbPath }`. `node:sqlite`
 * is imported LAZILY here — calling this function is the ONLY way it is ever
 * loaded, so a caller that never opts into this backend never even imports it
 * (matching seonix's own SEONIX_STORE=sqlite gating discipline, and tmct's
 * minimal-deps philosophy: zero external dependency either way).
 *
 * The connection is meant to be opened ONCE per session and kept open for the
 * session's lifetime (not re-opened per call) — close it via
 * closeSqliteMemoryStore when the session ends.
 */
export async function createSqliteMemoryStore(dbPath) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec(SQLITE_DDL);
  return { backend: BACKEND_SQLITE, db, dbPath };
}

/** Close a Backend C handle's connection. A no-op for anything else (so a
 *  caller that doesn't know which backend it has can call this unconditionally
 *  at session end). */
export function closeSqliteMemoryStore(handle) {
  if (isSqliteHandle(handle)) handle.db.close();
}

/** Deep-clone a JSON-safe value. Used two ways here: (1) readSqlitePayload
 *  hands every CALLER a clone of the cache, never the live cached object
 *  itself, so this backend keeps the same "fresh object every call" contract
 *  Backend A's JSON.parse(readFile()) always had — nothing outside this
 *  module can mutate handle.cachedPayload by mutating what loadMemory
 *  returned; and (2) persistSqlitePayload clones a value INTO the cache so
 *  the cache never ends up aliasing a piece of the caller's own payload
 *  object (which mutateMemory's caller may go on to mutate further). */
const cloneJson = (v) => (v === undefined ? v : structuredClone(v));

/** The loadMemory-equivalent read for Backend C. First call for a handle (or
 *  first call after a failed write invalidated the cache): a real, full
 *  reconstruction from SQL SELECTs, same as before — then it is stashed on
 *  `handle.cachedPayload`. Every later call, with no write in between, skips
 *  SQL entirely and returns a clone of that cache (see the module-comment
 *  above SQLITE_DDL for the full mechanism). A brand-new store (no meta rows
 *  written yet) reconstructs to the same shape emptyMemory() returns, so a
 *  fresh handle behaves like Backend A's ENOENT-bootstrap and Backend B's
 *  fresh createInMemoryStore(). */
function readSqlitePayload(handle) {
  if (!handle.cachedPayload) handle.cachedPayload = buildSqlitePayloadFromRows(handle);
  return cloneJson(handle.cachedPayload);
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

  const edgesForProp = db.prepare(
    "SELECT subject, object, subject_label, object_label, extra FROM edges WHERE prop = ? ORDER BY rowid",
  );
  const objectProperties = db.prepare("SELECT prop, predicate, count FROM relations ORDER BY ord").all()
    .map((r) => ({
      predicate: r.predicate,
      prop: r.prop,
      count: r.count,
      examples: edgesForProp.all(r.prop).map((e) => {
        const edge = { subject: e.subject, object: e.object, subjectLabel: e.subject_label, objectLabel: e.object_label };
        if (e.extra) Object.assign(edge, JSON.parse(e.extra));
        return edge;
      }),
    }));

  return {
    generated_at: getMeta("generated_at", empty.generated_at),
    memory: getMeta("memory", empty.memory),
    prefixes: getMeta("prefixes", empty.prefixes),
    vocabulary: getMeta("vocabulary", empty.vocabulary),
    classes: getMeta("classes", empty.classes),
    objectProperties,
    individuals,
    proseIndex: getMeta("proseIndex", empty.proseIndex),
  };
}

// ---- handle.cachedPayload mirrors --------------------------------------
// Applied by persistSqlitePayload in LOCKSTEP with the SQL statement sitting
// right beside each call — same condition (only when the SQL write actually
// runs), same effect, so the cache always ends up holding exactly what a
// fresh SQL reconstruction would now produce. `cache.individuals`/
// `cache.objectProperties` are mutated in place; persistSqlitePayload is
// responsible for invalidating the whole cache on a rolled-back write (these
// helpers assume the surrounding transaction succeeds).

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

/** Mirrors the individuals delete loop: drop any cached individual whose id
 *  isn't in the just-persisted payload's full id set. */
function cacheDropIndividualsExcept(cache, seenIds) {
  cache.individuals = cache.individuals.filter((i) => seenIds.has(i?.id));
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

/** Mirrors `INSERT OR REPLACE INTO edges(...)`: SQLite deletes-then-reinserts
 *  a changed/new row on conflict, so it gets a fresh (highest) rowid and sorts
 *  LAST under readSqlitePayload's `ORDER BY rowid` — moving the entry to the
 *  end of `examples` here (rather than replacing it in place) reproduces that
 *  ordering exactly, without a re-SELECT. Rebuilds the cached edge shape the
 *  same way buildSqlitePayloadFromRows does (subject/object/labels + any
 *  extra keys), from the same `extraKeys` persistSqlitePayload already
 *  computed for the SQL `extra` column, so it never re-derives them. Same
 *  NUL-delimited (subject,object) key discipline as the SQL diff beside it
 *  (a space could be forged by a term that contains one; NUL never occurs in
 *  a normalized term). */
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

/** Mirrors the relations delete loop: drop any cached edge group whose prop
 *  wasn't in the just-persisted payload's `objectProperties`. */
function cacheDropGroupsExcept(cache, seenProps) {
  cache.objectProperties = cache.objectProperties.filter((g) => seenProps.has(g?.prop));
}

/** Persist a mutated payload into a Backend C handle: real per-row
 *  INSERT/REPLACE/DELETE, diffed against whatever is ALREADY in the table for
 *  that individual id / (prop,subject,object) edge key — not seonix's
 *  rebuild-and-swap. Every statement runs inside one transaction so a session
 *  never observes (or leaves on disk) a half-applied mutation.
 *
 *  Also patches `handle.cachedPayload` (if one exists yet — it always will in
 *  practice, since mutateMemory always calls loadMemory before this) in the
 *  same lockstep as the SQL diff below, so a subsequent loadMemory() never has
 *  to re-query SQLite to see this write (see the module comment above
 *  SQLITE_DDL). On a rolled-back write, the cache is invalidated rather than
 *  left holding a partially-applied patch — the next read does an honest
 *  full rebuild instead. */
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

    // individuals: a real per-row upsert, only for an id that is new or whose
    // JSON actually changed since the last persist — every other row is left
    // untouched (no whole-table rewrite).
    const getInd = db.prepare("SELECT ord, json FROM individuals WHERE id = ?");
    const maxOrd = db.prepare("SELECT COALESCE(MAX(ord), -1) AS m FROM individuals").get().m;
    let nextOrd = maxOrd + 1;
    const upsertInd = db.prepare("INSERT OR REPLACE INTO individuals(id, ord, class, label, json) VALUES (?, ?, ?, ?, ?)");
    const seenIds = new Set();
    for (const ind of payload.individuals || []) {
      seenIds.add(ind.id);
      const json = JSON.stringify(ind);
      const existing = getInd.get(ind.id);
      if (existing && existing.json === json) continue; // unchanged — skip the write entirely (cache already matches)
      const ord = existing ? existing.ord : nextOrd++;
      upsertInd.run(ind.id, ord, ind.class ?? null, ind.label ?? null, json);
      if (cache) cacheUpsertIndividual(cache, ind);
    }
    // Removal (no appendX function in this file ever removes an individual
    // today — dead code path in practice, kept for correctness): a cheap
    // index-only scan of the primary-key column only, never the JSON payload.
    const deleteInd = db.prepare("DELETE FROM individuals WHERE id = ?");
    for (const row of db.prepare("SELECT id FROM individuals").all()) {
      if (!seenIds.has(row.id)) deleteInd.run(row.id);
    }
    if (cache) cacheDropIndividualsExcept(cache, seenIds);

    // objectProperties/edges: per-edge diff WITHIN each group, scoped to that
    // group's own rows (edges_by_prop) rather than the whole edges table — a
    // group that gains one new edge (e.g. statedBy, touched by nearly every
    // appendFact call) writes exactly that one new row, not the group's
    // entire history.
    const getRelOrd = db.prepare("SELECT ord FROM relations WHERE prop = ?");
    const maxRelOrd = db.prepare("SELECT COALESCE(MAX(ord), -1) AS m FROM relations").get().m;
    let nextRelOrd = maxRelOrd + 1;
    const upsertRel = db.prepare("INSERT OR REPLACE INTO relations(prop, ord, predicate, count) VALUES (?, ?, ?, ?)");
    const edgesForProp = db.prepare("SELECT subject, object, subject_label, object_label, extra FROM edges WHERE prop = ?");
    const upsertEdge = db.prepare("INSERT OR REPLACE INTO edges(prop, subject, object, subject_label, object_label, extra) VALUES (?, ?, ?, ?, ?, ?)");
    const deleteEdge = db.prepare("DELETE FROM edges WHERE prop = ? AND subject = ? AND object = ?");
    const seenProps = new Set();
    for (const group of payload.objectProperties || []) {
      seenProps.add(group.prop);
      const existingRows = edgesForProp.all(group.prop);
      const existingByKey = new Map(existingRows.map((r) => [`${r.subject}\u0000${r.object}`, r]));
      const newKeys = new Set();
      const cacheGroup = cache ? cacheGroupFor(cache, group.prop) : null;
      for (const e of group.examples || []) {
        const key = `${e.subject}\u0000${e.object}`;
        newKeys.add(key);
        const extraKeys = Object.keys(e).filter((k) => !STD_EDGE_KEYS.has(k));
        const extra = extraKeys.length ? JSON.stringify(Object.fromEntries(extraKeys.map((k) => [k, e[k]]))) : null;
        const existing = existingByKey.get(key);
        const unchanged = existing
          && (existing.subject_label ?? null) === (e.subjectLabel ?? null)
          && (existing.object_label ?? null) === (e.objectLabel ?? null)
          && (existing.extra ?? null) === (extra ?? null);
        if (unchanged) continue;
        upsertEdge.run(group.prop, e.subject, e.object, e.subjectLabel ?? null, e.objectLabel ?? null, extra);
        if (cacheGroup) cacheUpsertEdge(cacheGroup, e, extraKeys);
      }
      for (const key of existingByKey.keys()) {
        if (newKeys.has(key)) continue;
        const [s, o] = key.split("\u0000");
        deleteEdge.run(group.prop, s, o);
      }
      if (cacheGroup) cacheDropEdgesExcept(cacheGroup, newKeys);
      const relCount = Number.isFinite(group.count) ? group.count : (group.examples || []).length;
      const relOrd = getRelOrd.get(group.prop)?.ord ?? nextRelOrd++;
      upsertRel.run(group.prop, relOrd, group.predicate ?? null, relCount);
      if (cacheGroup) { cacheGroup.predicate = group.predicate ?? null; cacheGroup.count = relCount; }
    }
    for (const row of db.prepare("SELECT prop FROM relations").all()) {
      if (seenProps.has(row.prop)) continue;
      db.prepare("DELETE FROM edges WHERE prop = ?").run(row.prop);
      db.prepare("DELETE FROM relations WHERE prop = ?").run(row.prop);
    }
    if (cache) cacheDropGroupsExcept(cache, seenProps);

    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    // The cache may hold a partially-applied patch at this point (some of the
    // loop bodies above already mutated it before the failure) that was never
    // actually committed to SQLite — never trust it silently. Drop it so the
    // next loadMemory() call does an honest full rebuild instead.
    handle.cachedPayload = undefined;
    throw e;
  }
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

/** Snapshot the CURRENT live graph.json into a numbered `graph.v{N}.json`
 *  (N = the manifest's version BEFORE this call increments it), then advance
 *  the manifest and best-effort prune the oldest snapshot that falls outside
 *  the retention window.
 *
 *  `graph.json` itself is NEVER touched or renamed here — it stays the one
 *  live file every mutator (mutateMemory / fold.mjs's writeMemoryGraph) reads
 *  and writes; only a COPY of its pre-snapshot content becomes the new
 *  numbered version. NOT called from mutateMemory, writeMemoryGraph, or
 *  anywhere else in this codebase — it has zero callers today by design; a
 *  future CLI command or maintenance hook calls it explicitly.
 *
 *  Manifest bootstrap (no manifest.json yet): `{ version: 0, retentionVersions:
 *  opts.retentionVersions ?? DEFAULT_RETENTION }` — the optional
 *  `retentionVersions` lets a caller that already loaded tmct.toml's
 *  `[memory] retention_versions` seed the bootstrap default without this
 *  module doing its own config I/O (core.mjs has no toml-loading precedent;
 *  toml-config.mjs stays the one place that reads tmct.toml). Once a
 *  manifest.json exists on disk, ITS retentionVersions is authoritative and a
 *  later opts.retentionVersions is ignored (the persisted setting wins over a
 *  possibly-stale caller default).
 *
 *  "No graph.json exists yet" is handled as a clean no-op: `{ skipped: true,
 *  version: null }` — nothing to snapshot is not an error, it is the honest
 *  bootstrap state (a brand-new repo that has never written a memory graph).
 *
 *  Retention: after writing `graph.v{N}.json` and bumping the manifest to
 *  N+1, the snapshot at `graph.v{N - retentionVersions}.json` (if it exists)
 *  is deleted (best-effort — ENOENT is swallowed). Using N (the version just
 *  written), not N+1, for the prune target keeps a clean sliding window of
 *  exactly `retentionVersions` files on disk at all times, with no orphaned
 *  v0 ever left behind once the window starts sliding.
 *
 *  Returns `{ skipped, version, prunedVersion }` — `version` is the number of
 *  the snapshot just written (or null if skipped); `prunedVersion` is the
 *  number pruned, or null if nothing was in range to prune yet. */
export async function snapshotMemory(dir, { retentionVersions } = {}) {
  if (isMemoryOrSqliteHandle(dir)) {
    throw new Error("snapshotMemory only supports the flat-JSON backend (Backend A) — a memory/sqlite handle has no on-disk graph.json to snapshot");
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

/** Load the memory graph for a repo dir OR a Backend B/C handle (see the
 *  storage-backend seam above `createInMemoryStore`). A missing Backend-A
 *  store is the bootstrap: return the empty payload (uncached — the first
 *  append creates the file). The result is a raw entities payload;
 *  parseEntities() loads it. */
export async function loadMemory(dir) {
  if (isMemoryHandle(dir)) return dir.payload;
  if (isSqliteHandle(dir)) return readSqlitePayload(dir);
  let text;
  try {
    text = await readFile(memoryGraphFile(dir), "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return emptyMemory();
    throw e;
  }
  return JSON.parse(text);
}

/** Persist a mutated payload back to `dir` — the seam's other half. Backend A
 *  (unchanged): atomic write of the whole file. Backend B: the payload IS the
 *  handle's live object already (every real caller mutates in place); this
 *  assignment is a documented no-op safety net, never I/O. Backend C: a real,
 *  diffed per-row INSERT/UPDATE/DELETE against the live connection — see
 *  persistSqlitePayload. */
async function persistMemory(dir, payload) {
  if (isMemoryHandle(dir)) { dir.payload = payload; return; }
  if (isSqliteHandle(dir)) { persistSqlitePayload(dir, payload); return; }
  await mkdir(dirname(memoryGraphFile(dir)), { recursive: true });
  await atomicWriteJson(memoryGraphFile(dir), payload);
}

/** Fresh read → mutate → atomic write. Serialized per call; every public append
 *  goes through here so a concurrent reader never sees a torn store. The lazy,
 *  idempotent legacy-provenance migration rides this same cycle (step (b)): any
 *  Fact still carrying only the old mgx:factProvenance string gets its Sources +
 *  statedBy edges + trust materialised on the next write of any kind. Part B3's
 *  actor-level (session-scoped) Source reliability rides the SAME cycle, after
 *  migration (so it sees every Fact's Sources, migrated or not).
 *
 *  `fn` may be async (PLAN_AGENTS.md §2.1's SHACL ingest gate: appendFact/
 *  appendRule build their candidate individual, `await assertIndividualValid`
 *  it, and only then upsert — all inside `fn`, so a rejection throws before
 *  ANY mutation of `payload` happens and this function's write is never
 *  reached). `await fn(payload)` is a documented no-op for every existing
 *  SYNC caller (appendUtterance(s), appendFacts) — awaiting a non-Promise
 *  value just resolves to it, byte-identical behaviour to calling it plain. */
async function mutateMemory(dir, fn) {
  const payload = await loadMemory(dir);
  const out = (await fn(payload)) ?? payload;
  migrateLegacyProvenance(out);
  recomputeSourceReliability(out);
  out.proseIndex = buildProseIndex(out.individuals);
  await persistMemory(dir, out);
  return out;
}

const normText = (t) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, TEXT_CAP);
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

/** Deterministic Source id + type over the closed kind set. Returns null for an
 *  unknown kind (an unmappable provenance tag → no Source, honestly).
 *
 *  operator/teach kinds are SESSION-SCOPED when `desc.sessionId` is present
 *  (unconditional — every real chat/teach provenance tag carries one; see
 *  provenanceTagToSource): `${OPERATOR_SOURCE_ID}:<sessionId>` /
 *  `${TEACH_SOURCE_ID}:<sessionId>` instead of the bare singleton, so each
 *  session's operator/teach facts attach to their OWN Source individual
 *  rather than every session ever collapsing onto one. Session ids are
 *  uuidv7s (hex + hyphens only — see uuid.mjs), so `:`/`@` never collide with
 *  this id scheme's own delimiters. */
function sourceIdFor(desc) {
  switch (desc?.kind) {
    case "operator": return { id: desc.sessionId ? `${OPERATOR_SOURCE_ID}:${desc.sessionId}` : OPERATOR_SOURCE_ID, type: "operator" };
    case "teach": return { id: desc.sessionId ? `${TEACH_SOURCE_ID}:${desc.sessionId}` : TEACH_SOURCE_ID, type: "teach" };
    case "provider": return { id: `src:provider:${desc.name}`, type: "provider" };
    case "corpus": return { id: `src:corpus:${desc.name}`, type: "corpus" };
    // One Source per source-file basename (the corpus precedent above), not per
    // extraction run — re-running scripts/extract-facts-from-text.mjs over the
    // SAME file collapses onto the same Source instead of minting a new one
    // every time, matching corpus's "one Source per named dataset" idiom.
    case "extracted": return { id: `src:extracted:${desc.name}`, type: "extracted" };
    case "web": return { id: `src:learned:web:${fnv1aHex(String(desc.url || ""))}`, type: "web", url: String(desc.url || "") };
    case "entailed": return { id: `src:entailed:${desc.rule}`, type: "entailed", rule: String(desc.rule || "") };
    default: return null;
  }
}

const sourceLabel = (id) => String(id).replace(/^src:/, "");

/** Upsert a Source individual (deterministic id → idempotent, edges never
 *  dangle). createdAt is first-write-wins; a recovered @<ts> (desc.createdAt)
 *  seeds it when present. Returns the Source id, or null for an unknown kind. */
function upsertSource(payload, desc, createdAtCandidate) {
  const info = sourceIdFor(desc);
  if (!info) return null;
  const prior = payload.individuals.find((i) => i?.id === info.id);
  const created = firstWriteCreatedAt(prior, desc?.createdAt || createdAtCandidate);
  upsertIndividual(payload, {
    id: info.id, label: sourceLabel(info.id), class: SOURCE_CLASS,
    derived_from: [], mentions: [],
    attributes: [
      { prop: "rdf:type", key: "type", value: "owl:NamedIndividual" },
      { prop: "mgx:sourceType", key: "sourceType", value: info.type },
      { prop: CREATED_AT_PROP, key: "createdAt", value: created },
      ...(info.url ? [{ prop: "mgx:sourceUrl", key: "sourceUrl", value: info.url }] : []),
      ...(info.rule ? [{ prop: "mgx:sourceRule", key: "sourceRule", value: info.rule }] : []),
    ],
  });
  return info.id;
}

/** Parse the "chat" shape both provenanceTag (grammar/assert.mjs) and
 *  teachProvenanceTag (chat.mjs) emit — `<source>[:<sessionId>][@<ts>]` after
 *  their kind prefix has already been stripped — into { createdAt, sessionId? }.
 *  `sessionId` is present only when the tag actually carried one (every real
 *  chat/teach write does; a hand-authored/legacy tag without one degrades to
 *  the bare singleton Source, honestly — see sourceIdFor). */
function parseChatTagRest(rest) {
  const at = rest.indexOf("@");
  const beforeAt = at >= 0 ? rest.slice(0, at) : rest;
  const createdAt = at >= 0 ? rest.slice(at + 1) : "";
  const colon = beforeAt.indexOf(":");
  const sessionId = colon >= 0 ? beforeAt.slice(colon + 1) : "";
  return { createdAt, ...(sessionId ? { sessionId } : {}) };
}

/**
 * Parse one legacy provenance TAG into a Source descriptor over the closed kind
 * set — the inverse the migration and the live write path both name Sources
 * through. The tag formats are exactly what the writers produce:
 *   corpus:conceptnet /r/IsA   → { kind:"corpus",   name:"conceptnet" }
 *   corpus-weak:conceptnet /r/RelatedTo → { kind:"corpusWeak", name:"conceptnet" }
 *   ace:chat:<session>@<ts>    → { kind:"operator",  createdAt:<ts>, sessionId:<session> }
 *   teach:chat:<session>@<ts>  → { kind:"teach",     createdAt:<ts>, sessionId:<session> }
 *   web:<url> | url:<url>      → { kind:"web",       url:<url> }
 *   extracted:<file-basename>  → { kind:"extracted", name:<file-basename> }
 *   entailed:<rule>            → { kind:"entailed",  rule:<rule> }
 * chat:/session: refs map to the operator; an unknown tag → null (no Source).
 * `corpus-weak:` is the SAME corpus provenance shape as `corpus:`, just naming
 * a lower trust-prior kind (memory/trust.mjs SOURCE_PRIOR.corpusWeak) for
 * facts whose underlying relation is real but low-precision (e.g. ConceptNet's
 * undirected /r/RelatedTo) — trust stays computed from the Source's kind, never
 * hand-set on the Fact.
 * The session-id segment (Part B: session-scoped actor-level trust) feeds
 * sourceIdFor, which mints a PER-SESSION Source id when present, instead of
 * collapsing every session onto one singleton operator/teach Source.
 * `extracted:` is scripts/extract-facts-from-text.mjs's own audit tag, layered
 * ADDITIVELY (via appendFact's provenance union) on top of whatever the
 * runTurn recognizer already wrote (ace:/teach:) — see that script for why:
 * it distinguishes "this document evidenced this fact" from ordinary chat
 * speech, at its own trust-prior tier (memory/trust.mjs SOURCE_PRIOR.extracted).
 */
export function provenanceTagToSource(tag) {
  const t = String(tag || "").trim();
  if (!t) return null;
  const head = t.split(/\s+/)[0]; // drop trailing " /r/IsA" etc.
  if (head.startsWith("corpus-weak:")) return { kind: "corpusWeak", name: head.slice("corpus-weak:".length) || "unknown" };
  if (head.startsWith("corpus:")) return { kind: "corpus", name: head.slice("corpus:".length) || "unknown" };
  if (head.startsWith("ace:")) return { kind: "operator", ...parseChatTagRest(head.slice("ace:".length)) };
  if (head.startsWith("teach:")) {
    // the chat teach lane's natural frames — chat.mjs's teachProvenanceTag
    return { kind: "teach", ...parseChatTagRest(head.slice("teach:".length)) };
  }
  if (head.startsWith("web:")) return { kind: "web", url: head.slice("web:".length) };
  if (head.startsWith("url:")) return { kind: "web", url: head.slice("url:".length) };
  if (head.startsWith("extracted:")) return { kind: "extracted", name: head.slice("extracted:".length) || "unknown" };
  if (head.startsWith("entailed:")) return { kind: "entailed", rule: head.slice("entailed:".length) };
  if (head.startsWith("chat:") || head.startsWith("session:") || head.startsWith("operator")) return { kind: "operator" };
  return null;
}

/** Map a payload's Source individuals into the { id: Source } shape computeTrust
 *  resolves against. */
function sourcesByIdMap(payload) {
  const m = {};
  for (const i of payload.individuals) if (i?.class === SOURCE_CLASS) m[i.id] = i;
  return m;
}

/** The Source ids a Fact is statedBy, read off the edge group. */
function statedByObjectsFor(payload, factId) {
  const g = payload.objectProperties.find((x) => x?.prop === STATED_BY_PROP);
  return (g?.examples || []).filter((e) => e?.subject === factId).map((e) => e.object);
}

/** Recompute + materialise a Fact's trust cache (mgx:trustScore + the auditable
 *  mgx:trustInputs). Called exactly where a statedBy edge could have changed.
 *  `trustOpts` (optional) is the entailed hook (trust.mjs `computeTrust`'s
 *  `premiseTrusts`/`ruleConfidence`) — threaded through from appendFact/
 *  appendFacts's own opts so a rule (e.g. syllogise.mjs's cax-dw) can make its
 *  conclusion's trust premise-derived (`min(premiseTrusts) × ruleConfidence`)
 *  instead of riding the bare entailed prior. Absent (the default, `{}`), this
 *  is a no-op passthrough — every existing caller's score is byte-identical
 *  (PLAN_INFERENCE_TESTING.md §4 stage 2's exit criterion). Also stamps
 *  `mgx:updatedAt` (PLAN_VIZ.md §2) — this mutates the Fact's own attributes in place without
 *  necessarily touching an edge, so the derived "max over edges" updatedAt rule can't see it. */
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
  recomputeFactTrust(payload, fact, nowMs, trustOpts);
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

/** A session-scoped operator/teach Source id (Part B2's `${SINGLETON}:<sessionId>`
 *  shape) — the only Source kind actor-level reliability applies to; a corpus/
 *  web/provider/entailed Source has no "session" to hold a track record for. */
const isSessionScopedSourceId = (id) =>
  typeof id === "string" && (id.startsWith(`${OPERATOR_SOURCE_ID}:`) || id.startsWith(`${TEACH_SOURCE_ID}:`));

/**
 * Recompute + materialise mgx:sourceReliability on every session-scoped
 * operator/teach Source (Part B3): for each such Source, count the facts it
 * stated (`factsAsserted`) and how many of those are part of a live
 * contradiction (`factsContradicted`, via findContradictions — its own
 * detection logic is untouched, this only READS its result), run
 * sessionReliabilityFrom, and write the bounded result onto the Source.
 *
 * Contradiction membership is evaluated against the CURRENT trust scores at
 * the point this runs (already materialised by this same mutation's
 * syncFactSources/migrateLegacyProvenance calls) — it does NOT recursively
 * re-evaluate contradictions after reliability changes shift trust scores
 * (no fixed-point iteration; one pass is enough for a monotonic, self-
 * correcting signal that only ever gets more accurate on the NEXT write).
 *
 * Every individual (Fact OR RULE) touched by a recomputed Source then has its
 * OWN trust re-materialised (recomputeFactTrust — class-agnostic, same as
 * syncFactSources: neither ever checks `.class`) so mgx:trustScore reflects
 * the fresh reliability within THIS SAME mutation cycle — a session's
 * reliability shift is visible immediately, not just on some future
 * unrelated re-write. This refresh is scanned off the statedBy edge group
 * DIRECTLY (every individual it names, any class), not off readFactRows
 * (Fact-only) — a Rule can never be "contradicted" (findContradictions is a
 * Fact-shape concept, so contradiction ACCOUNTING stays Fact-scoped above),
 * but it rides the identical Source-derivation + trust pipeline a Fact does
 * (appendRule's own doc comment), so it must not go stale here either.
 *
 * Called from mutateMemory itself (below), riding every mutation's existing
 * bookkeeping cycle — not a separate write path.
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

  for (const [sid, counts] of bySource) {
    const source = payload.individuals.find((i) => i?.id === sid);
    if (!source) continue;
    setAttr(source, SOURCE_RELIABILITY_PROP, "sourceReliability", String(sessionReliabilityFrom(counts)));
    // Own-attribute mutation in place (PLAN_VIZ.md §2) — same reasoning as recomputeFactTrust.
    setAttr(source, UPDATED_AT_PROP, "updatedAt", new Date().toISOString());
  }

  // Re-materialise trust for EVERY individual statedBy a recomputed session
  // Source — Fact or Rule alike — via the statedBy edge group directly.
  const statedGroup = payload.objectProperties.find((g) => g?.prop === STATED_BY_PROP);
  const affected = new Set();
  for (const e of statedGroup?.examples || []) if (bySource.has(e?.object)) affected.add(e.subject);
  for (const id of affected) {
    const ind = payload.individuals.find((i) => i?.id === id);
    if (ind) recomputeFactTrust(payload, ind);
  }
}

/** Upsert an individual by id (replace-in-place keeps ordering stable). */
function upsertIndividual(payload, ind) {
  const i = payload.individuals.findIndex((x) => x?.id === ind.id);
  if (i >= 0) payload.individuals[i] = ind;
  else payload.individuals.push(ind);
}

/** Upsert one edge into the named relation group (dedupe by subject>object). Stamps `createdAt`
 *  on the edge, first-write-wins over the same (subject,object) pair — mirrors
 *  `firstWriteCreatedAt`'s discipline: a re-upserted edge keeps its original creation time
 *  rather than resetting to "now" on every write. This is the only place in the codebase edges
 *  get a timestamp at all — `codegraph.mjs`'s `derivedUpdatedAt` reads it back. */
function upsertEdge(payload, { predicate, prop }, edge) {
  let group = payload.objectProperties.find((g) => g?.prop === prop);
  if (!group) {
    group = { predicate, prop, count: 0, examples: [] };
    payload.objectProperties.push(group);
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
}

/** Recount `classes[]` from the individuals — every memory class stays counted
 *  and sampled the way graph-build.mjs counts the code classes. */
function recountClasses(payload) {
  const names = [MEMORY_SESSION_CLASS, UTTERANCE_CLASS, FACT_CLASS, SOURCE_CLASS, RULE_CLASS];
  payload.classes = payload.classes.filter((c) => !names.includes(c?.name));
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

/** Normalize a fact TERM (subject/object) so every writer converges on one
 *  spelling and the graph stays queryable: ConceptNet's /c/en/foo_bar, a
 *  grammar's tmct:Foo_bar and a bare "Foo bar" all become "foo bar". The
 *  PREDICATE is deliberately NOT normalized this way - it is a controlled
 *  vocabulary term (rdfs:subClassOf) whose casing is meaningful.
 *
 *  Tier-5 playtest fix (2026-07-09): also strips a leading "the"/"a"/"an" —
 *  found live via "remember that THE logger module is deprecated" (teach-side
 *  already stripped it before this ran, so storage was unaffected) followed by
 *  "what do you know about THE logger module" / "who maintains THE tasks
 *  handler" (recall-side queries, which do NOT pre-strip their own captured
 *  term before calling this) genuinely missing the just-taught fact — every
 *  recall regex in chat.mjs (KNOW_ABOUT_RE, WHO_OWNS_RE, ISA_ASK_RE, …) calls
 *  factTermVariants -> normFactTerm on the raw captured term, so fixing it
 *  ONCE here closes the gap for all of them instead of patching each site.
 *  Safe for storage too (idempotent — an already-stripped subject is
 *  unaffected); the article is a determiner, never semantically distinguishing
 *  for a code-entity or common-noun term in this domain. */
export function normFactTerm(t) {
  let s = normText(t);
  s = s.replace(/^\/c\/[a-z]{2,3}\//i, "");
  s = s.replace(/^[a-z][\w.-]*:/i, "");
  s = s.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  s = s.replace(/^(?:the|an?)\s+/i, "");
  return s.toLowerCase();
}

// The fact-id contract: a Fact is content-addressed by its NUL-DELIMITED
// (s, p, o). NUL never occurs in a normalized term or a predicate URI, so it is
// a collision-proof separator (a space could be forged by a term that contains
// one). appendFact hashes the SAME `${s}\0${p}\0${o}` inline; appendFacts routes
// through here so the batch path can never drift to a space and silently re-key
// every seeded fact — the golden-equivalence test pins the two paths together.
const factIdFor = (s, p, o) => `fact:${fnv1aHex(`${s}\0${p}\0${o}`)}`;

/** Content-address a fact's id from its (subject, predicate, object) WITHOUT
 *  writing it — the SAME normalize+NUL-join+hash contract appendFact/
 *  appendFacts use internally (factIdFor, above). Exposed so a caller that
 *  needs to name a premise's or a not-yet-written conclusion's id (e.g.
 *  syllogise.mjs's justification-tracking retraction machinery, PLAN_SYLLOGIST.md
 *  §3) can compute it deterministically without an extra read — ids are
 *  content-addressed, never sequence-assigned, so this is safe to call
 *  before, instead of, or in place of an actual append. Pure, no I/O. */
export function factIdForTriple(subject, predicate, object) {
  return factIdFor(normFactTerm(subject), normText(predicate), normFactTerm(object));
}

/** Append one grammar-derived OWL triple, RDF-reified: a `Fact` individual
 *  carrying rdf:subject / rdf:predicate / rdf:object (+ provenance). The
 *  Phase-2 ACE parser's write point. Same (s,p,o) → same id → upsert, never a
 *  duplicate. `premiseTrusts`/`ruleConfidence` (optional) engage trust.mjs's
 *  entailed hook — see recomputeFactTrust; a rule-derived write (e.g.
 *  syllogise.mjs) passes these, a plain taught/asserted write omits them and
 *  is byte-identical to before.
 *
 *  PLAN_AGENTS.md 2.1's SHACL ingest gate: the candidate Fact individual is
 *  validated against ontology/memory-shapes.ttl (memory/shacl.mjs) BEFORE
 *  upsertIndividual runs -- a violation throws here, inside mutateMemory's
 *  `fn`, so the write never happens (mutateMemory's atomic write is never
 *  reached; the on-disk graph is untouched). Returns { id }. */
export async function appendFact(dir, { subject, predicate, object, provenance = "", createdAt = "", quantifier = "", premiseTrusts, ruleConfidence } = {}) {
  const s = normFactTerm(subject);
  const p = normText(predicate);
  const o = normFactTerm(object);
  if (!s || !p || !o) throw new Error("a fact needs subject, predicate and object");
  const id = `fact:${fnv1aHex(`${s} ${p} ${o}`)}`;
  const text = `${s} ${p} ${o}`;
  const tokens = proseTokensFor({ doc: text });
  const q = normText(quantifier);
  await mutateMemory(dir, async (payload) => {
    const prior = payload.individuals.find((x) => x?.id === id);
    const priorProv = prior?.attributes?.find((a) => a?.prop === "mgx:factProvenance")?.value || "";
    // The mgx:factProvenance union stays BYTE-IDENTICAL (a compat shim readers
    // still key on); the Source edges below are DERIVED from it, purely additive.
    const provs = [...new Set([...priorProv.split(" | "), normText(provenance)].filter(Boolean))];
    const createdAtVal = firstWriteCreatedAt(prior, createdAt); // first-write-wins
    // first-write-wins for the quantifier too (a re-assert with none, e.g. a
    // plain re-teach, never SILENTLY erases an already-recorded quantifier).
    const priorQ = prior?.attributes?.find((a) => a?.prop === "mgx:factQuantifier")?.value || "";
    const qVal = q || priorQ;
    const candidate = {
      id, label: labelOf(text), class: FACT_CLASS,
      derived_from: [], mentions: [],
      attributes: [
        { prop: "rdf:type", key: "type", value: "rdf:Statement" },
        { prop: "rdf:subject", key: "subject", value: s },
        { prop: "rdf:predicate", key: "predicate", value: p },
        { prop: "rdf:object", key: "object", value: o },
        { prop: CREATED_AT_PROP, key: "createdAt", value: createdAtVal },
        ...(provs.length ? [{ prop: "mgx:factProvenance", key: "provenance", value: provs.join(" | ") }] : []),
        ...(tokens.length ? [{ prop: "mgx:hasProseTokens", key: "prose_tokens", value: tokens.join(" ") }] : []),
        ...(qVal ? [{ prop: "mgx:factQuantifier", key: "quantifier", value: qVal }] : []),
      ],
    };
    await assertIndividualValid(candidate); // the SHACL gate -- throws, never writes, on a violation
    upsertIndividual(payload, candidate);
    // Derive Source individuals + statedBy edges from the provenance union and
    // (re)materialise this fact's trust — the live half of steps (b)/(c).
    syncFactSources(payload, payload.individuals.find((x) => x?.id === id), undefined, { premiseTrusts, ruleConfidence });
    recountClasses(payload);
  });
  return { id };
}

/** Batch append of grammar/corpus-derived triples — ONE read-modify-write for a
 *  whole seed (the appendUtterances precedent, for facts). The per-fact
 *  appendFact does a full read → mutate → prose-reindex → atomic-write PER FACT,
 *  so seeding N facts is O(N²) I/O (6 k facts ≈ 7 min); this collapses it to a
 *  single mutate.
 *
 *  Every fact is normalized + prose-tokenized OUTSIDE the mutate, then a SINGLE
 *  mutateMemory upserts each Fact through an id→individual Map (O(1) upsert, so
 *  the growing individuals array is never rescanned per fact), reconciles each
 *  touched fact's Sources + trust via the SAME syncFactSources appendFact uses,
 *  and recountClasses ONCE at the end. The result is deep-equal (modulo array
 *  order) to looping appendFact: same fact ids, same mgx:factProvenance union,
 *  same statedBy Source edges, same mgx:trustScore, same first-write-wins
 *  createdAt. Malformed facts (missing subject/predicate/object) are SKIPPED (a
 *  bad row never aborts a 6 k-fact seed), not thrown as appendFact does.
 *  Each fact may also carry `premiseTrusts`/`ruleConfidence` (optional) —
 *  appendFact's own entailed-hook passthrough, batched: syllogise.mjs's
 *  materializing pass is this function's main caller, so this is the write
 *  path a rule's conclusion trust actually rides (recomputeFactTrust, above).
 *  A fact may also carry `justification` (optional, array of premise fact
 *  ids — PLAN_SYLLOGIST.md §3's persisted-justification step): stored
 *  verbatim as `mgx:factJustification` (space-joined; fact ids never contain
 *  a space), last-write-wins per id (a re-derivation via a DIFFERENT premise
 *  pair, after the original was retracted and this fact re-earned its place
 *  some other way, should overwrite the stale justification, not keep it) —
 *  never written at all for a plain taught/asserted fact (`justification`
 *  omitted), which stays byte-identical to before this field existed.
 *  Returns { ids, appended, skipped } — ids one per applied fact (in order),
 *  appended = ids.length, skipped = malformed count. */
export async function appendFacts(dir, facts) {
  const prepared = [];
  let skipped = 0;
  for (const f of facts || []) {
    const s = normFactTerm(f?.subject);
    const p = normText(f?.predicate);
    const o = normFactTerm(f?.object);
    if (!s || !p || !o) { skipped += 1; continue; } // batch skips, never throws
    const text = `${s} ${p} ${o}`;
    prepared.push({
      id: factIdFor(s, p, o), // NUL-delimited — byte-identical to appendFact's id
      s, p, o, text,
      tokens: proseTokensFor({ doc: text }),
      provenance: normText(f?.provenance),
      createdAt: f?.createdAt || "",
      quantifier: normText(f?.quantifier),
      premiseTrusts: Array.isArray(f?.premiseTrusts) ? f.premiseTrusts : undefined,
      ruleConfidence: typeof f?.ruleConfidence === "number" ? f.ruleConfidence : undefined,
      justification: Array.isArray(f?.justification) ? f.justification.filter(Boolean) : undefined,
    });
  }
  const ids = [];
  if (!prepared.length) return { ids, appended: 0, skipped };
  await mutateMemory(dir, (payload) => {
    // id → individual index for O(1) upsert (the array grows to thousands).
    const byId = new Map(payload.individuals.map((i) => [i?.id, i]));
    const touched = [];
    const seen = new Set();
    const trustOptsById = new Map();
    for (const f of prepared) {
      const prior = byId.get(f.id);
      const priorProv = prior?.attributes?.find((a) => a?.prop === "mgx:factProvenance")?.value || "";
      // Same as appendFact: the mgx:factProvenance union stays byte-identical (a
      // compat shim); the Source edges below are DERIVED from it, purely additive.
      const provs = [...new Set([...priorProv.split(" | "), f.provenance].filter(Boolean))];
      const createdAtVal = firstWriteCreatedAt(prior, f.createdAt); // first-write-wins
      // first-write-wins for the quantifier too — same discipline as appendFact.
      const priorQ = prior?.attributes?.find((a) => a?.prop === "mgx:factQuantifier")?.value || "";
      const qVal = f.quantifier || priorQ;
      const ind = {
        id: f.id, label: labelOf(f.text), class: FACT_CLASS,
        derived_from: [], mentions: [],
        attributes: [
          { prop: "rdf:type", key: "type", value: "rdf:Statement" },
          { prop: "rdf:subject", key: "subject", value: f.s },
          { prop: "rdf:predicate", key: "predicate", value: f.p },
          { prop: "rdf:object", key: "object", value: f.o },
          { prop: CREATED_AT_PROP, key: "createdAt", value: createdAtVal },
          ...(provs.length ? [{ prop: "mgx:factProvenance", key: "provenance", value: provs.join(" | ") }] : []),
          ...(f.tokens.length ? [{ prop: "mgx:hasProseTokens", key: "prose_tokens", value: f.tokens.join(" ") }] : []),
          ...(qVal ? [{ prop: "mgx:factQuantifier", key: "quantifier", value: qVal }] : []),
          ...(f.justification && f.justification.length ? [{ prop: "mgx:factJustification", key: "justification", value: f.justification.join(" ") }] : []),
        ],
      };
      // Upsert into BOTH the array (replace-in-place keeps order) and the index.
      if (prior) payload.individuals[payload.individuals.indexOf(prior)] = ind;
      else payload.individuals.push(ind);
      byId.set(f.id, ind);
      ids.push(f.id);
      if (!seen.has(f.id)) { seen.add(f.id); touched.push(f.id); }
      // Last-prepared-row-wins per id for the trust hook opts (mirrors the
      // provenance/quantifier/ind upsert above, which is also last-wins per id
      // within one batch — a duplicate id inside the same call is rare, but
      // when it happens the SAME single-write-per-id discipline applies here).
      if (f.premiseTrusts !== undefined || f.ruleConfidence !== undefined) {
        trustOptsById.set(f.id, { premiseTrusts: f.premiseTrusts, ruleConfidence: f.ruleConfidence });
      }
    }
    // Reconcile each touched fact's Sources + trust once (add-only, idempotent),
    // then recount classes a SINGLE time at the end. trustOptsById threads the
    // entailed hook (recomputeFactTrust, above) per fact — absent for a fact
    // that didn't declare premiseTrusts, so its trust is unchanged from before.
    for (const id of touched) syncFactSources(payload, byId.get(id), undefined, trustOptsById.get(id));
    recountClasses(payload);
  });
  return { ids, appended: ids.length, skipped };
}

// ---- Rules (PLAN_TAUGHT_RELATIONS.md Phase 3: storage foundation) -----------
// A taught RULE — a composed/filtered/recursive relation SHAPE, distinct from a
// plain Fact triple. Same convention as a Fact's subject/predicate/object: every
// slot is a plain string ATTRIBUTE, never an edge to a per-term individual.

export const RULE_KIND_COMPOSE2 = "compose2";
export const RULE_KIND_FILTER = "filter";
export const RULE_KIND_RECURSIVE = "recursive";
export const RULE_KINDS = Object.freeze([RULE_KIND_COMPOSE2, RULE_KIND_FILTER, RULE_KIND_RECURSIVE]);

export const RULE_NAME_PROP = "mgx:ruleName";
export const RULE_KIND_PROP = "mgx:ruleKind";

// Per-kind slot contract: JS slot key -> the mgx: attribute it's written under.
// filter's "base" slot deliberately reuses ruleBase1 (not a fresh "ruleBase") —
// §3's own query-dispatcher design chases a filter rule's candidate set via
// "ruleBase1's candidate set (step (a) or (b) again)", the exact same attribute
// name compose2's first hop already uses, since both play the identical "base
// relation this rule builds on" role. Order within each array is the (slot1,
// slot2) order the content-address hash below uses — fixed and load-bearing.
const RULE_SLOT_SPEC = {
  [RULE_KIND_COMPOSE2]: [["base1", "mgx:ruleBase1"], ["base2", "mgx:ruleBase2"]],
  [RULE_KIND_FILTER]: [["base", "mgx:ruleBase1"], ["property", "mgx:ruleFilterProperty"]],
  [RULE_KIND_RECURSIVE]: [["baseCase", "mgx:ruleBaseCase"], ["recStep", "mgx:ruleRecStep"]],
};

// The rule-id contract, mirroring factIdFor's (:456) NUL-delimited discipline
// exactly: content-addressed over (kind, name, slot1, slot2), so re-teaching an
// IDENTICAL rule (same kind + name + slots) upserts, never duplicates; teaching
// a DIFFERENT rule under the SAME name (different slots) hashes to a distinct
// id — both individuals exist side by side, the same way two different Facts
// sharing a subject are two distinct Fact individuals, never a silent overwrite.
const ruleIdFor = (kind, name, slot1, slot2) => `rule:${fnv1aHex(`${kind}\0${name}\0${slot1}\0${slot2}`)}`;

/** Append one taught RULE (compose2 | filter | recursive) — a sibling of
 *  appendFact (:462) for the relation-composition shapes PLAN_TAUGHT_RELATIONS.md
 *  items 3/4/6 need, storing a `Rule` individual instead of a `Fact`. Same
 *  load→mutate→write discipline via mutateMemory, same content-addressed-id
 *  upsert convention as appendFact.
 *
 *  { name, kind, slots, provenance = "", createdAt = "" }: `kind` is the ONE
 *  closed vocabulary this store needs to know — compose2 | filter | recursive,
 *  three STRUCTURAL tags describing the SHAPE of what was taught (never a
 *  domain word, the same way "Fact"/"Rule" describe the store's own shape, not
 *  what's stored in it). `slots` is the matching per-kind object (RULE_SLOT_SPEC
 *  above). `name` and every slot value are normFactTerm-normalized, exactly like
 *  a Fact's subject/object.
 *
 *  Provenance/trust ride the EXACT SAME syncFactSources/recomputeFactTrust
 *  pipeline appendFact uses, unmodified — neither function ever checks
 *  `individual.class`, so a Rule carrying the same mgx:factProvenance compat
 *  attribute + CREATED_AT_PROP gets the same Source-derivation + trust score an
 *  ordinary Fact would.
 *
 *  PLAN_AGENTS.md 2.1's SHACL ingest gate: the candidate Rule individual is
 *  validated against ontology/memory-shapes.ttl (memory/shacl.mjs) BEFORE
 *  upsertIndividual runs, same discipline as appendFact -- a violation
 *  throws before mutateMemory's write is ever reached. Returns { id }. */
export async function appendRule(dir, { name, kind, slots, provenance = "", createdAt = "" } = {}) {
  const spec = RULE_SLOT_SPEC[kind];
  if (!spec) throw new Error(`a rule kind must be one of ${RULE_KINDS.join(", ")}, got ${JSON.stringify(kind)}`);
  const n = normFactTerm(name);
  if (!n) throw new Error("a rule needs a name");
  const slotValues = spec.map(([slotKey]) => normFactTerm(slots?.[slotKey]));
  if (slotValues.some((v) => !v)) {
    throw new Error(`a ${kind} rule needs ${spec.map(([slotKey]) => slotKey).join(" + ")}`);
  }
  const id = ruleIdFor(kind, n, slotValues[0], slotValues[1]);
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
        ...spec.map(([slotKey, prop], i) => ({ prop, key: slotKey, value: slotValues[i] })),
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

/** Genericity lookup for the future query-dispatcher (PLAN_TAUGHT_RELATIONS.md
 *  §2's closing paragraph / §3 step (b)): "what kind of thing is name X" — scan
 *  for the Rule individual whose mgx:ruleName matches, the SAME lookup serving
 *  every taught rule name uniformly (no per-rule-name branch). This phase only
 *  proves the stored shape supports the lookup correctly; Phase 4/5/6 build the
 *  actual kind-dispatch (compose2/filter/recursive branching) on top of this.
 *  Returns the raw individual, or undefined if no Rule has that name. */
export function findRuleByName(memory, name) {
  const n = normFactTerm(name);
  return (memory?.individuals || []).find(
    (i) => i?.class === RULE_CLASS && (i.attributes || []).find((a) => a?.prop === RULE_NAME_PROP)?.value === n,
  );
}

// ---- Relation chase (extracted from chat.mjs's (a0)/(a0.2) blocks,
// PLAN_TAUGHT_RELATIONS.md Phase 2/4/5; PLAN_COMPLETIONS.md Stage 1
// prerequisite) --------------------------------------------------------------
//
// `resolveRelationChase` and `resolveRelationChaseReverse` were originally
// unexported closures inside chat.mjs's factReadBack, coupled to its own
// local `rows`/`memoryDir`/`byTrust`/`renderFactLine`/`factPhrase`/
// `factTermVariants` variables. Moved here — findRuleByName's natural
// sibling, since this file already owns Rule storage/lookup — as plain,
// standalone, importable functions so Stage 1's cross-group inference can
// reuse the SAME resolution logic outside chat.mjs's dispatch context. The
// closures they used to capture are now explicit parameters: `memory` (an
// already-loaded loadMemory() payload — callers load it once, not per
// recursive call) and a `helpers` bag carrying every chat.mjs-local piece
// they relied on (`relationFactsFor`, `renderFactLine`, `factPhrase`,
// `factTermVariants`, `byTrust`, the trust-bearing `rows` array, and
// `HAS_PROPERTY_PREDICATE`). No other chat.mjs coupling remains — dynamic
// imports of this file's own findRuleByName/RULE_KIND_* and of
// planning.mjs's findActionPath/findReachableSet are now direct references/
// static imports, since both now live alongside or are reachable from here
// without a cycle (planning.mjs imports nothing).
//
// Behavior is unchanged from the original closures: same dispatch order
// (direct/alias fact hit → compose2 rule chase → filter rule chase → honest
// miss), same OWA discipline (null / [] on a miss, never a guessed "no").

/**
 * RELATION CHASE (chat.mjs's (a0) block) — given a relation/rule NAME and a
 * fixed (subject, object) pair, resolve whether it holds: (i) a direct taught
 * fact, (ii) the same pair reached via an alias-chased predicate (rdfs:subClassOf
 * over relation-name strings, folded into `relationFactsFor`'s own candidate
 * list), (iii) a hop-counted compose2 Rule chase (exactly 2 hops: base1 then
 * base2), or (iv) a filter Rule chase (recursively resolve the base, then
 * require the subject also carry the taught property). Returns
 * `{ citation: string[] }` on a genuine hit, or null on an honest miss.
 */
export async function resolveRelationChase(memory, name, subjectTerm, objectTerm, helpers) {
  const { relationFactsFor, renderFactLine, factPhrase, factTermVariants, byTrust, rows, HAS_PROPERTY_PREDICATE } = helpers;
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
 * RELATION "WHO" REVERSE CHASE (chat.mjs's (a0.2) block) — the mirror image of
 * resolveRelationChase: given a relation/rule name and a FIXED OBJECT, return
 * every `{ subject, citation }` pair that satisfies it, instead of a single
 * yes/no for a fixed (subject, object) pair. Recursion is bounded the SAME way
 * resolveRelationChase's own filter chase is: a filter rule's base is always
 * either a plain relation (terminal) or another rule (one level deeper), never
 * itself.
 */
export async function resolveRelationChaseReverse(memory, name, objectTerm, helpers) {
  const { relationFactsFor, renderFactLine, factPhrase, factTermVariants, byTrust, rows, HAS_PROPERTY_PREDICATE } = helpers;
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
 * Resolve every reified Fact in a loaded memory payload into a row carrying its
 * Source ids + source-type multiset, the legacy provenance string (compat), and
 * the cached trust score. Pure. The exported seam the chat/answer layer consumes
 * for trust-weighted fact ranking.
 */
export function readFactRows(memory) {
  const individuals = memory?.individuals || [];
  const sourcesById = new Map(individuals.filter((i) => i?.class === SOURCE_CLASS).map((i) => [i.id, i]));
  const statedGroup = (memory?.objectProperties || []).find((g) => g?.prop === STATED_BY_PROP);
  const byFact = new Map();
  for (const e of statedGroup?.examples || []) {
    if (!byFact.has(e.subject)) byFact.set(e.subject, []);
    byFact.get(e.subject).push(e.object);
  }
  const rows = [];
  for (const ind of individuals) {
    if (ind?.class !== FACT_CLASS) continue;
    const get = (k) => (ind.attributes || []).find((a) => a?.key === k)?.value || "";
    const sourceIds = byFact.get(ind.id) || [];
    const sourceTypes = sourceIds
      .map((id) => (sourcesById.get(id)?.attributes || []).find((a) => a?.prop === "mgx:sourceType")?.value)
      .filter(Boolean);
    const justificationRaw = get("justification");
    rows.push({
      id: ind.id,
      subject: get("subject"), predicate: get("predicate"), object: get("object"),
      provenance: get("provenance"), // legacy compat string, verbatim
      quantifier: get("quantifier"), // "" unless a plural class-membership teach set one (Feature A pt.3)
      sourceIds, sourceTypes,
      trust: Number((ind.attributes || []).find((a) => a?.prop === TRUST_SCORE_PROP)?.value) || 0,
      // [] unless a rule persisted its premise fact ids (PLAN_SYLLOGIST.md §3's
      // justification-tracking step — scm-sco only, today; see syllogise.mjs).
      justification: justificationRaw ? justificationRaw.split(" ").filter(Boolean) : [],
    });
  }
  return rows;
}

/**
 * Retract Fact individuals by id — a real DELETE, the mechanism `syllogise.mjs`'s
 * own header comment has always PROMISED ("fully RETRACTABLE by provenance when
 * the source graph moves") but that, until PLAN_SYLLOGIST.md §3's retraction
 * build, nothing in this file actually implemented: un-believing something used
 * to mean re-running the whole batch pass and hoping dedup naturally sorted it
 * out, with no targeted removal at all. Drops each matching Fact individual and
 * scrubs any edge group (`statedBy`, etc.) that referenced it as subject OR
 * object, so no dangling edge survives the delete — then recounts classes once.
 * A Source left with zero remaining statedBy edges is NOT itself deleted (an
 * orphaned Source individual is harmless — it materialises nothing and costs
 * nothing to leave — so this stays a pure, minimal retraction, not a GC pass).
 * Ids that don't resolve to a live Fact are silently skipped (an idempotent,
 * honest no-op — never an error: a caller may retry a retraction against a
 * concurrently-mutated store). Returns { removed } — the ids ACTUALLY deleted,
 * a possibly-smaller set than the input. */
export async function removeFacts(dir, ids) {
  const idSet = new Set((ids || []).filter(Boolean));
  const removed = [];
  if (!idSet.size) return { removed };
  await mutateMemory(dir, (payload) => {
    payload.individuals = (payload.individuals || []).filter((ind) => {
      if (ind?.class === FACT_CLASS && idSet.has(ind.id)) { removed.push(ind.id); return false; }
      return true;
    });
    if (!removed.length) return; // honest no-op — nothing matched, no write needed beyond this
    const removedSet = new Set(removed);
    for (const group of payload.objectProperties || []) {
      const before = group.examples || [];
      group.examples = before.filter((e) => !removedSet.has(e?.subject) && !removedSet.has(e?.object));
      group.count = group.examples.length;
    }
    recountClasses(payload);
  });
  return { removed };
}

/** The trust floor a fact must clear before a differing object counts as a real
 *  contradiction (below it the fact is too weak to contradict anything). */
export const CONTRADICTION_TRUST_FLOOR = 0.5;

/**
 * Facts that CONTRADICT: same (subject, predicate), DIFFERENT object, each above
 * the trust floor. Returns groups (each a [rows] sorted by trust desc) so the
 * answer/inspection layer surfaces BOTH with their provenance and NEVER silently
 * picks the higher-trust one. Same (s,p,o) from two writers is corroboration,
 * not contradiction — one Fact id, N statedBy edges — so it never appears here.
 */
export function findContradictions(memory, { floor = CONTRADICTION_TRUST_FLOOR } = {}) {
  const rows = readFactRows(memory).filter((r) => r.trust >= floor);
  const byKey = new Map();
  for (const r of rows) {
    const key = `${r.subject} ${r.predicate}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r);
  }
  const out = [];
  for (const group of byKey.values()) {
    if (new Set(group.map((r) => r.object)).size > 1) {
      out.push(group.slice().sort((a, b) => b.trust - a.trust || a.object.localeCompare(b.object)));
    }
  }
  return out.sort((a, b) => `${a[0].subject} ${a[0].predicate}`.localeCompare(`${b[0].subject} ${b[0].predicate}`));
}
