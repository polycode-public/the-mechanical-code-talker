// memory/core.mjs — tmct's OWN conversational memory graph: a dedicated
// OWL-labelled store at <repo>/.tmct/memory/graph.json, distinct from any
// provider-supplied code graph. Utterances, Facts (reified RDF triples via
// appendFact), and Sessions are all typed twice — payload `class` and an
// `rdf:type` attribute. Every append is crash-safe and idempotent (utterance
// ids are deterministic, fact ids hash the triple).

import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { proseTokensFor, buildProseIndex } from "./prose-tokens.mjs";
import { fnv1aHex, normText, normFactTerm, factIdFor, factIdForTriple } from "../../hash.mjs";

// Fact identity (normalization + id derivation) lives in hash.mjs — the one
// content-address contract — and is re-exported here so store consumers keep
// a single import site for read/write plus identity.
export { normFactTerm, factIdForTriple } from "../../hash.mjs";
import {
  computeTrust, sessionReliabilityFrom, TRUST_SCORE_PROP, TRUST_INPUTS_PROP,
  CREATED_AT_PROP, UPDATED_AT_PROP, provenanceTagToSource,
} from "../../memory/trust.mjs";

// The createdAt/updatedAt vocabulary and the provenance-tag Source parser live
// with the trust layer (they are its inputs); re-exported here so store
// consumers keep one import site.
export { CREATED_AT_PROP, UPDATED_AT_PROP, provenanceTagToSource } from "../../memory/trust.mjs";
import { assertIndividualValid } from "../../memory/shacl.mjs";

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
export const DERIVED_FROM_PROP = "mgx:derivedFrom";        // umbrella: Fact → Source|Fact
export const STATED_BY_PROP = "mgx:statedBy";              // a Source directly asserts a Fact
export const CANONICALISED_FROM_PROP = "mgx:canonicalisedFrom"; // a canonical Fact ← its raw form
export const SOURCE_RELIABILITY_PROP = "mgx:sourceReliability"; // actor-level (session-scoped) trust nudge on a Source, [0.5,1.5]

// Bare (session-less) singleton Source ids — fallback for a provenance tag
// with no session-id segment. A tag that does carry one mints its own
// per-session Source instead (`${ID}:<sessionId>`, sourceIdFor below).
export const OPERATOR_SOURCE_ID = "src:operator-chat";
export const TEACH_SOURCE_ID = "src:teach-chat";

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

/** Resolve the on-disk path of a memory graph file for `dir`. `version` null
 *  (default) is the live graph; a numeric version resolves a snapshot copy
 *  (see snapshotMemory below). The single source of truth for this path. */
export function resolveMemoryGraphFile(dir, version = null) {
  if (isMemoryHandle(dir) || isSqliteHandle(dir)) {
    throw new Error("resolveMemoryGraphFile: dir is a memory/sqlite handle, not a file path (Backend A only)");
  }
  if (version === null) return join(dir, MEMORY_GRAPH_REL);
  return join(dir, MEMORY_DIR_REL, `graph.v${version}.json`);
}

const memoryGraphFile = (dir) => resolveMemoryGraphFile(dir);

// ---- Storage-backend seam --------------------------------------------------
// `dir` is either a plain repo-path string (Backend A, file-backed) or a
// handle from createInMemoryStore() (Backend B) or createSqliteMemoryStore()
// (Backend C). Only loadMemory/mutateMemory dispatch on backend; every other
// function operates on the plain payload object they hand back.

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

/** Backend B — pure in-memory store: `{ backend: "memory", payload }` held by
 *  the caller (never module-global). Zero file I/O; distinct from
 *  `--ephemeral`, which still round-trips a throwaway temp dir. */
export function createInMemoryStore() {
  return { backend: BACKEND_MEMORY, payload: emptyMemory() };
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
`;

// Edge keys with dedicated columns; any other key round-trips via `extra`.
const STD_EDGE_KEYS = new Set(["subject", "object", "subjectLabel", "objectLabel"]);

/** Open (creating if absent) a resident node:sqlite connection: a Backend C
 *  handle `{ backend: "sqlite", db, dbPath }`. `node:sqlite` is imported
 *  lazily — only opting into this backend ever loads it. Meant to be opened
 *  once per session; close via closeSqliteMemoryStore at session end. */
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

/** Resolve a backend token ("memory" | "sqlite" | anything else) into
 *  `{ dir, close }` — the ONE shared resolver, so every entry point (init's
 *  corpus seed, bin/tmct.mjs, chat) picks the same backend for a repo rather
 *  than silently splitting its memory across two stores. */
export async function openMemoryBackend(repoRoot, backendChoice) {
  if (backendChoice === BACKEND_MEMORY) {
    return { dir: createInMemoryStore(), close: async () => {} };
  }
  if (backendChoice === BACKEND_SQLITE) {
    const dbPath = join(repoRoot, ".tmct", "memory", "graph.sqlite");
    await mkdir(dirname(dbPath), { recursive: true });
    const handle = await createSqliteMemoryStore(dbPath);
    return { dir: handle, close: async () => closeSqliteMemoryStore(handle) };
  }
  return { dir: repoRoot, close: async () => {} };
}

/** Deep-clone a JSON-safe value — keeps every cache read/write from aliasing
 *  the caller's own payload object. */
const cloneJson = (v) => (v === undefined ? v : structuredClone(v));

/** The loadMemory-equivalent read for Backend C: reconstructs from SQL once
 *  per handle (or after a failed write invalidates the cache), then returns a
 *  clone of `handle.cachedPayload` with zero SQL. */
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

/** Mirrors the relations delete loop: drop any cached edge group whose prop
 *  wasn't in the just-persisted payload's `objectProperties`. */
function cacheDropGroupsExcept(cache, seenProps) {
  cache.objectProperties = cache.objectProperties.filter((g) => seenProps.has(g?.prop));
}

/** Persist a mutated payload into a Backend C handle: per-row
 *  INSERT/REPLACE/DELETE diffed against what's already stored, in one
 *  transaction. Patches `handle.cachedPayload` in lockstep; a rolled-back
 *  write invalidates the cache instead of leaving a partial patch. */
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

/** Snapshot the current live graph.json into a numbered `graph.v{N}.json`,
 *  advance the manifest, and best-effort prune the snapshot that falls
 *  outside the retention window. graph.json itself is never touched — only a
 *  copy becomes the new version. No graph.json yet -> `{ skipped: true }`.
 *  Once a manifest exists, its retentionVersions is authoritative over
 *  `opts.retentionVersions`. Returns `{ skipped, version, prunedVersion }`. */
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

/** Persist a mutated payload back to `dir`: an atomic file write (Backend A),
 *  a no-op assignment (Backend B, already the live object), or a diffed
 *  per-row SQL write (Backend C, persistSqlitePayload). */
async function persistMemory(dir, payload) {
  if (isMemoryHandle(dir)) { dir.payload = payload; return; }
  if (isSqliteHandle(dir)) { persistSqlitePayload(dir, payload); return; }
  await mkdir(dirname(memoryGraphFile(dir)), { recursive: true });
  await atomicWriteJson(memoryGraphFile(dir), payload);
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
  for (const ind of payload.individuals || []) {
    if (!ind?.id) continue;
    individualsById.set(ind.id, ind);
    if (ind.class === SOURCE_CLASS) sourcesById.set(ind.id, ind);
  }
  const statedGroup = (payload.objectProperties || []).find((g) => g?.prop === STATED_BY_PROP);
  for (const e of statedGroup?.examples || []) {
    if (!e?.subject) continue;
    const list = statedByBySubject.get(e.subject);
    if (list) list.push(e.object);
    else statedByBySubject.set(e.subject, [e.object]);
  }
  payload[MEMORY_INDEX] = { individualsById, sourcesById, statedByBySubject };
  return payload[MEMORY_INDEX];
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
    case "provider": return { id: `src:provider:${desc.name}`, type: "provider" };
    case "corpus": return { id: `src:corpus:${desc.name}`, type: "corpus" };
    // One Source per source-file basename, not per extraction run.
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
    if (ind) recomputeFactTrust(payload, ind);
  }
}

/** Upsert an individual by id (replace-in-place keeps ordering stable).
 *  Returns the stored reference — callers should index THAT, not `ind`. */
function upsertIndividual(payload, ind) {
  const idx = memoryIndexOf(payload);
  if (idx) {
    const prior = idx.individualsById.get(ind.id);
    if (prior) {
      Object.assign(prior, ind);
      return prior;
    }
    payload.individuals.push(ind);
    idx.individualsById.set(ind.id, ind);
    return ind;
  }
  const i = payload.individuals.findIndex((x) => x?.id === ind.id);
  if (i >= 0) { payload.individuals[i] = ind; return ind; }
  payload.individuals.push(ind);
  return ind;
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

/** Append one grammar-derived OWL triple, RDF-reified as a `Fact` individual.
 *  Same (s,p,o) -> same id -> upsert, never a duplicate. `premiseTrusts`/
 *  `ruleConfidence` optionally engage trust.mjs's entailed hook. Validated
 *  against ontology/memory-shapes.ttl (memory/shacl.mjs) before the write.
 *  Returns { id }. */
export async function appendFact(dir, { subject, predicate, object, provenance = "", createdAt = "", quantifier = "", premiseTrusts, ruleConfidence } = {}) {
  const s = normFactTerm(subject);
  const p = normText(predicate);
  const o = normFactTerm(object);
  if (!s || !p || !o) throw new Error("a fact needs subject, predicate and object");
  const id = factIdFor(s, p, o);
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

/** Batch append of grammar/corpus-derived triples — ONE read-modify-write for
 *  a whole seed, collapsing looping appendFact's O(N²) I/O to a single
 *  mutate (same resulting ids/provenance/trust). Malformed facts are skipped,
 *  not thrown. Optional per-fact `premiseTrusts`/`ruleConfidence` (batched
 *  entailed-hook passthrough) and `justification` (premise fact ids, stored
 *  as mgx:factJustification, last-write-wins). Returns
 *  { ids, appended, skipped }. */
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
    // When mutateMemory already built the Symbol-keyed lookup index, reuse
    // THAT Map directly (same object) instead of rescanning payload.individuals
    // a second time — every `byId.set` below then also keeps
    // idx.individualsById correct for upsertSource/recomputeSourceReliability's
    // later lookups in this same mutation, with no extra write.
    const idx = memoryIndexOf(payload);
    const byId = idx ? idx.individualsById : new Map(payload.individuals.map((i) => [i?.id, i]));
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
      // Upsert via the shared helper — O(1) via the index (Object.assign in
      // place when `prior` exists, push+index when it's new), same as every
      // other upsert path now. Previously this did its own inline
      // `payload.individuals.indexOf(prior)` array scan on a re-assert within
      // the same batch — an O(n) fallback that could still blow up a batch
      // heavy with within-file duplicate triples; upsertIndividual has no
      // such case left.
      const stored = upsertIndividual(payload, ind);
      byId.set(f.id, stored);
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
export const RULE_KINDS = Object.freeze([
  RULE_KIND_COMPOSE2, RULE_KIND_FILTER, RULE_KIND_RECURSIVE,
  RULE_KIND_ACTION_SIGNATURE, RULE_KIND_ACTION_PRECOND, RULE_KIND_ACTION_EFFECT,
  RULE_KIND_ACTION_CONSTRAINT,
]);

export const RULE_NAME_PROP = "mgx:ruleName";
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
  ],
  [RULE_KIND_ACTION_EFFECT]: [
    ["predicate", "mgx:ruleActionEffectPredicate"], ["subjectRole", "mgx:ruleActionEffectSubject"],
    ["objectRole", "mgx:ruleActionEffectObject"],
  ],
  // "the <left> may not be with the <right> without the <guard>" — each slot
  // names a class whose sole member src/domain.mjs resolves at compile time.
  [RULE_KIND_ACTION_CONSTRAINT]: [
    ["left", "mgx:ruleActionConstraintLeft"], ["right", "mgx:ruleActionConstraintRight"],
    ["guard", "mgx:ruleActionConstraintGuard"],
  ],
};

// Content-addressed over (kind, name, ...slots in RULE_SLOT_SPEC order),
// mirroring factIdFor's NUL-delimited discipline: identical rules upsert,
// different ones coexist. For 2-slot kinds the joined string is byte-identical
// to the historical (kind, name, slot1, slot2) template, so pre-existing rule
// ids never change (pinned by test/memory-rules-action.test.mjs).
const ruleIdFor = (kind, name, slotValues) => `rule:${fnv1aHex([kind, name, ...slotValues].join("\0"))}`;

/** Append one taught RULE — a sibling of appendFact storing a `Rule`
 *  individual, same upsert/provenance/trust/SHACL discipline (neither
 *  pipeline ever checks `individual.class`). `slots` is the matching
 *  per-kind object (RULE_SLOT_SPEC above). Returns { id }. */
export async function appendRule(dir, { name, kind, slots, provenance = "", createdAt = "" } = {}) {
  const spec = RULE_SLOT_SPEC[kind];
  if (!spec) throw new Error(`a rule kind must be one of ${RULE_KINDS.join(", ")}, got ${JSON.stringify(kind)}`);
  const n = normFactTerm(name);
  if (!n) throw new Error("a rule needs a name");
  const slotValues = spec.map(([slotKey]) => normFactTerm(slots?.[slotKey]));
  if (slotValues.some((v) => !v)) {
    throw new Error(`a ${kind} rule needs ${spec.map(([slotKey]) => slotKey).join(" + ")}`);
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
 *  the sibling of readFactRows, so consumers (src/domain.mjs) never touch
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
      quantifier: get("quantifier"), // "" unless a plural class-membership teach set one
      sourceIds, sourceTypes,
      trust: Number((ind.attributes || []).find((a) => a?.prop === TRUST_SCORE_PROP)?.value) || 0,
      // [] unless a rule persisted its premise fact ids (justification-tracking,
      // scm-sco only today; see syllogise.mjs).
      justification: justificationRaw ? justificationRaw.split(" ").filter(Boolean) : [],
    });
  }
  return rows;
}

/** Retract Fact individuals by id — a real DELETE (syllogise.mjs's
 *  retractability mechanism). Scrubs any edge referencing the id as subject
 *  or object; an orphaned Source is left in place (not a GC pass). Unknown
 *  ids are silently skipped. Returns { removed } (may be smaller than input). */
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

export const HAS_A_PREDICATE = "mgx:hasA";
export const CAPABLE_OF_PREDICATE = "mgx:capableOf";

/** Predicates whose real-world semantics allow many objects at once ("a dog
 *  has legs" AND "a dog has a tail"; "a bird can fly" AND "a bird can sing"),
 *  so a second object is a second fact, never a disagreement. A closed list:
 *  every predicate outside it keeps the full contradiction contract. */
export const MULTI_VALUED_PREDICATES = new Set([HAS_A_PREDICATE, CAPABLE_OF_PREDICATE]);

/** Facts that CONTRADICT: same (subject, predicate), different object, each
 *  above the trust floor. Returns groups (trust-desc) so callers surface both,
 *  never silently pick one. Same (s,p,o) is corroboration, not contradiction,
 *  and a MULTI_VALUED_PREDICATES predicate never contradicts on object count. */
export function findContradictions(memory, { floor = CONTRADICTION_TRUST_FLOOR } = {}) {
  const rows = readFactRows(memory).filter((r) => r.trust >= floor);
  const byKey = new Map();
  for (const r of rows) {
    if (MULTI_VALUED_PREDICATES.has(r.predicate)) continue;
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
