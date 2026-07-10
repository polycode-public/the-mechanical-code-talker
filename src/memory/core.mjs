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
import { computeTrust, TRUST_SCORE_PROP, TRUST_INPUTS_PROP } from "./trust.mjs";

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
  { prop: DERIVED_FROM_PROP, predicate: "derivedFrom", note: "umbrella: a Fact derived from a Source (or another Fact). ext ref prov:wasDerivedFrom (UNVERIFIED-pending-web-check)" },
  { prop: STATED_BY_PROP, predicate: "statedBy", note: "subPropertyOf derivedFrom: a Source directly asserts this Fact (one edge per independent source — replaces the factProvenance union)" },
  { prop: CANONICALISED_FROM_PROP, predicate: "canonicalisedFrom", note: "subPropertyOf derivedFrom: a canonical Fact cleaned from a raw Block/Source, never replacing it" },
  { prop: "mgx:sourceType", note: "a Source's kind: operator | teach | provider | corpus | web | entailed (the trust-prior key)" },
  { prop: "mgx:sourceUrl", note: "a web Source's URL" },
  { prop: "mgx:sourceRule", note: "an entailed Source's rule id" },
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
  if (version === null) return join(dir, MEMORY_GRAPH_REL);
  return join(dir, MEMORY_DIR_REL, `graph.v${version}.json`);
}

const memoryGraphFile = (dir) => resolveMemoryGraphFile(dir);

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

/** Load the memory graph for a repo dir. A missing store is the bootstrap:
 *  return the empty payload (uncached — the first append creates the file).
 *  The result is a raw entities payload; parseEntities() loads it. */
export async function loadMemory(dir) {
  let text;
  try {
    text = await readFile(memoryGraphFile(dir), "utf8");
  } catch (e) {
    if (e?.code === "ENOENT") return emptyMemory();
    throw e;
  }
  return JSON.parse(text);
}

/** Fresh read → mutate → atomic write. Serialized per call; every public append
 *  goes through here so a concurrent reader never sees a torn store. The lazy,
 *  idempotent legacy-provenance migration rides this same cycle (step (b)): any
 *  Fact still carrying only the old mgx:factProvenance string gets its Sources +
 *  statedBy edges + trust materialised on the next write of any kind. */
async function mutateMemory(dir, fn) {
  const payload = await loadMemory(dir);
  const out = fn(payload) ?? payload;
  migrateLegacyProvenance(out);
  out.proseIndex = buildProseIndex(out.individuals);
  await mkdir(dirname(memoryGraphFile(dir)), { recursive: true });
  await atomicWriteJson(memoryGraphFile(dir), out);
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
 *   ace:chat:<session>@<ts>    → { kind:"operator",  createdAt:<ts>, sessionId:<session> }
 *   teach:chat:<session>@<ts>  → { kind:"teach",     createdAt:<ts>, sessionId:<session> }
 *   web:<url> | url:<url>      → { kind:"web",       url:<url> }
 *   entailed:<rule>            → { kind:"entailed",  rule:<rule> }
 * chat:/session: refs map to the operator; an unknown tag → null (no Source).
 * The session-id segment (Part B: session-scoped actor-level trust) feeds
 * sourceIdFor, which mints a PER-SESSION Source id when present, instead of
 * collapsing every session onto one singleton operator/teach Source.
 */
export function provenanceTagToSource(tag) {
  const t = String(tag || "").trim();
  if (!t) return null;
  const head = t.split(/\s+/)[0]; // drop trailing " /r/IsA" etc.
  if (head.startsWith("corpus:")) return { kind: "corpus", name: head.slice("corpus:".length) || "unknown" };
  if (head.startsWith("ace:")) return { kind: "operator", ...parseChatTagRest(head.slice("ace:".length)) };
  if (head.startsWith("teach:")) {
    // the chat teach lane's natural frames — chat.mjs's teachProvenanceTag
    return { kind: "teach", ...parseChatTagRest(head.slice("teach:".length)) };
  }
  if (head.startsWith("web:")) return { kind: "web", url: head.slice("web:".length) };
  if (head.startsWith("url:")) return { kind: "web", url: head.slice("url:".length) };
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
 *  mgx:trustInputs). Called exactly where a statedBy edge could have changed. */
function recomputeFactTrust(payload, fact, nowMs = Date.now()) {
  const sourceIds = statedByObjectsFor(payload, fact.id);
  const createdAt = (fact.attributes || []).find((a) => a?.prop === CREATED_AT_PROP)?.value || "";
  const { score, inputs } = computeTrust({ sourceIds, createdAt }, sourcesByIdMap(payload), { now: nowMs });
  setAttr(fact, TRUST_SCORE_PROP, "trustScore", String(score));
  setAttr(fact, TRUST_INPUTS_PROP, "trustInputs", JSON.stringify(inputs));
}

/** Reconcile a Fact's Sources + statedBy edges with its (unchanged, compat)
 *  mgx:factProvenance string, then recompute its trust. ADD-only over
 *  deterministic Source ids and upsertEdge's subject>object dedupe, so it is
 *  idempotent and NEVER re-keys the fact (its id still hashes only (s,p,o)). */
function syncFactSources(payload, fact, nowMs = Date.now()) {
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
  recomputeFactTrust(payload, fact, nowMs);
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

/** Upsert an individual by id (replace-in-place keeps ordering stable). */
function upsertIndividual(payload, ind) {
  const i = payload.individuals.findIndex((x) => x?.id === ind.id);
  if (i >= 0) payload.individuals[i] = ind;
  else payload.individuals.push(ind);
}

/** Upsert one edge into the named relation group (dedupe by subject>object). */
function upsertEdge(payload, { predicate, prop }, edge) {
  let group = payload.objectProperties.find((g) => g?.prop === prop);
  if (!group) {
    group = { predicate, prop, count: 0, examples: [] };
    payload.objectProperties.push(group);
  }
  group.examples = (group.examples || []).filter(
    (e) => !(e?.subject === edge.subject && e?.object === edge.object),
  );
  group.examples.push(edge);
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

/** Append one grammar-derived OWL triple, RDF-reified: a `Fact` individual
 *  carrying rdf:subject / rdf:predicate / rdf:object (+ provenance). The
 *  Phase-2 ACE parser's write point. Same (s,p,o) → same id → upsert, never a
 *  duplicate. Returns { id }. */
export async function appendFact(dir, { subject, predicate, object, provenance = "", createdAt = "", quantifier = "" } = {}) {
  const s = normFactTerm(subject);
  const p = normText(predicate);
  const o = normFactTerm(object);
  if (!s || !p || !o) throw new Error("a fact needs subject, predicate and object");
  const id = `fact:${fnv1aHex(`${s} ${p} ${o}`)}`;
  const text = `${s} ${p} ${o}`;
  const tokens = proseTokensFor({ doc: text });
  const q = normText(quantifier);
  await mutateMemory(dir, (payload) => {
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
    upsertIndividual(payload, {
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
    });
    // Derive Source individuals + statedBy edges from the provenance union and
    // (re)materialise this fact's trust — the live half of steps (b)/(c).
    syncFactSources(payload, payload.individuals.find((x) => x?.id === id));
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
    });
  }
  const ids = [];
  if (!prepared.length) return { ids, appended: 0, skipped };
  await mutateMemory(dir, (payload) => {
    // id → individual index for O(1) upsert (the array grows to thousands).
    const byId = new Map(payload.individuals.map((i) => [i?.id, i]));
    const touched = [];
    const seen = new Set();
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
        ],
      };
      // Upsert into BOTH the array (replace-in-place keeps order) and the index.
      if (prior) payload.individuals[payload.individuals.indexOf(prior)] = ind;
      else payload.individuals.push(ind);
      byId.set(f.id, ind);
      ids.push(f.id);
      if (!seen.has(f.id)) { seen.add(f.id); touched.push(f.id); }
    }
    // Reconcile each touched fact's Sources + trust once (add-only, idempotent),
    // then recount classes a SINGLE time at the end.
    for (const id of touched) syncFactSources(payload, byId.get(id));
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
 *  ordinary Fact would. Returns { id }. */
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
  await mutateMemory(dir, (payload) => {
    const prior = payload.individuals.find((x) => x?.id === id);
    const priorProv = prior?.attributes?.find((a) => a?.prop === "mgx:factProvenance")?.value || "";
    // Same union-of-tags discipline as appendFact — the compat string stays
    // byte-identical in spirit; the Source edges below are DERIVED from it.
    const provs = [...new Set([...priorProv.split(" | "), normText(provenance)].filter(Boolean))];
    const createdAtVal = firstWriteCreatedAt(prior, createdAt); // first-write-wins
    upsertIndividual(payload, {
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
    });
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
    rows.push({
      id: ind.id,
      subject: get("subject"), predicate: get("predicate"), object: get("object"),
      provenance: get("provenance"), // legacy compat string, verbatim
      quantifier: get("quantifier"), // "" unless a plural class-membership teach set one (Feature A pt.3)
      sourceIds, sourceTypes,
      trust: Number((ind.attributes || []).find((a) => a?.prop === TRUST_SCORE_PROP)?.value) || 0,
    });
  }
  return rows;
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
