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

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { proseTokensFor, buildProseIndex } from "../prose.mjs";
import { fnv1aHex } from "../hash.mjs";

export const MEMORY_DIR_REL = join(".tmct", "memory");
export const MEMORY_GRAPH_REL = join(MEMORY_DIR_REL, "graph.json");

export const UTTERANCE_CLASS = "Utterance";
export const FACT_CLASS = "Fact";
export const MEMORY_SESSION_CLASS = "Session";

export const SAID_IN_SESSION_PROP = "mgx:saidInSession";
export const IN_REPLY_TO_PROP = "mgx:inReplyTo";

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
  { prop: "mgx:factProvenance", note: "where a fact came from (a session/turn ref, a corpus block id, an ACE parse)" },
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

const memoryGraphFile = (dir) => join(dir, MEMORY_GRAPH_REL);

/** Atomic JSON write (temp in the same dir + rename) — same discipline as
 *  sessions.mjs's graph append: a crash never destroys the previous store. */
async function atomicWriteJson(file, obj) {
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
  await writeFile(tmp, JSON.stringify(obj));
  await rename(tmp, file);
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
 *  goes through here so a concurrent reader never sees a torn store. */
async function mutateMemory(dir, fn) {
  const payload = await loadMemory(dir);
  const out = fn(payload) ?? payload;
  out.proseIndex = buildProseIndex(out.individuals);
  await mkdir(dirname(memoryGraphFile(dir)), { recursive: true });
  await atomicWriteJson(memoryGraphFile(dir), out);
  return out;
}

const normText = (t) => String(t ?? "").replace(/\s+/g, " ").trim().slice(0, TEXT_CAP);
const labelOf = (text) => (text.length > LABEL_CAP ? text.slice(0, LABEL_CAP - 1) + "…" : text);

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
  const names = [MEMORY_SESSION_CLASS, UTTERANCE_CLASS, FACT_CLASS];
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
      ...(started ? [{ prop: "mgx:sessionStarted", key: "started", value: started }] : []),
    ],
  });
  return sid;
}

/** Build (don't write) one Utterance individual + its edges; shared by the
 *  single and batch append paths. Returns the utterance id. */
function putUtterance(payload, { role, text, ts, sessionId, sessionStarted = "", parsed = null, replyTo = null }) {
  if (!ROLES.has(role)) throw new Error(`utterance role must be "visitor" or "tmct", got ${JSON.stringify(role)}`);
  if (!sessionId) throw new Error("utterance needs a sessionId");
  const cleanTs = String(ts || "");
  const cleanText = normText(text);
  const id = `utt:${sessionId}#${cleanTs}#${role}`;
  const label = labelOf(cleanText) || (role === "visitor" ? "a-visitor-said" : "a-tmct-said");
  const tokens = proseTokensFor({ doc: cleanText });
  const ind = {
    id, label, class: UTTERANCE_CLASS,
    derived_from: [], mentions: [],
    attributes: [
      { prop: "rdf:type", key: "type", value: "owl:NamedIndividual" },
      { prop: "mgx:utteranceRole", key: "role", value: role },
      { prop: "mgx:utteranceText", key: "text", value: cleanText },
      { prop: "mgx:utteranceTs", key: "ts", value: cleanTs },
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
 *  vocabulary term (rdfs:subClassOf) whose casing is meaningful. */
export function normFactTerm(t) {
  let s = normText(t);
  s = s.replace(/^\/c\/[a-z]{2,3}\//i, "");
  s = s.replace(/^[a-z][\w.-]*:/i, "");
  s = s.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  return s.toLowerCase();
}

/** Append one grammar-derived OWL triple, RDF-reified: a `Fact` individual
 *  carrying rdf:subject / rdf:predicate / rdf:object (+ provenance). The
 *  Phase-2 ACE parser's write point. Same (s,p,o) → same id → upsert, never a
 *  duplicate. Returns { id }. */
export async function appendFact(dir, { subject, predicate, object, provenance = "" } = {}) {
  const s = normFactTerm(subject);
  const p = normText(predicate);
  const o = normFactTerm(object);
  if (!s || !p || !o) throw new Error("a fact needs subject, predicate and object");
  const id = `fact:${fnv1aHex(`${s} ${p} ${o}`)}`;
  const text = `${s} ${p} ${o}`;
  const tokens = proseTokensFor({ doc: text });
  await mutateMemory(dir, (payload) => {
    const prior = payload.individuals.find((x) => x?.id === id);
    const priorProv = prior?.attributes?.find((a) => a?.prop === "mgx:factProvenance")?.value || "";
    const provs = [...new Set([...priorProv.split(" | "), normText(provenance)].filter(Boolean))];
    upsertIndividual(payload, {
      id, label: labelOf(text), class: FACT_CLASS,
      derived_from: [], mentions: [],
      attributes: [
        { prop: "rdf:type", key: "type", value: "rdf:Statement" },
        { prop: "rdf:subject", key: "subject", value: s },
        { prop: "rdf:predicate", key: "predicate", value: p },
        { prop: "rdf:object", key: "object", value: o },
        ...(provs.length ? [{ prop: "mgx:factProvenance", key: "provenance", value: provs.join(" | ") }] : []),
        ...(tokens.length ? [{ prop: "mgx:hasProseTokens", key: "prose_tokens", value: tokens.join(" ") }] : []),
      ],
    });
    recountClasses(payload);
  });
  return { id };
}
