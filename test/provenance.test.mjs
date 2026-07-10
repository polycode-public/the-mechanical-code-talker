// provenance.test.mjs — the cross-cutting Provenance & Trust primitive
// (PLAN_PROVENANCE_TRUST): universal mgx:createdAt first-write-wins (a), Source
// individuals + statedBy edges derived from the compat provenance union without
// re-keying facts + the lazy idempotent migration (b), materialised trust (c),
// and trust-weighted retrieval + contradiction surfacing (d).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  MEMORY_GRAPH_REL, MEMORY_DIR_REL, FACT_CLASS, SOURCE_CLASS,
  STATED_BY_PROP, CREATED_AT_PROP, OPERATOR_SOURCE_ID,
  emptyMemory, loadMemory, appendFact, appendUtterance,
  provenanceTagToSource, readFactRows, findContradictions,
} from "../src/memory/core.mjs";
import { saveBlock, retrieveBlocks } from "../src/memory/blocks.mjs";
import { renderMemory } from "../src/memory/inspect.mjs";

const tmpRepo = () => mkdtemp(join(tmpdir(), "tmct-prov-"));
const attr = (ind, prop) => (ind?.attributes || []).find((a) => a?.prop === prop)?.value;
const factsOf = (m) => m.individuals.filter((i) => i.class === FACT_CLASS);
const sourcesOf = (m) => m.individuals.filter((i) => i.class === SOURCE_CLASS);
const statedEdges = (m) => (m.objectProperties.find((g) => g.prop === STATED_BY_PROP)?.examples || []);

// ---- (a) mgx:createdAt first-write-wins -------------------------------------

test("(a) createdAt first-write-wins: re-writing a fact id preserves its earliest createdAt", async () => {
  const dir = await tmpRepo();
  try {
    await appendFact(dir, { subject: "cache", predicate: "rdfs:subClassOf", object: "buffer", createdAt: "2026-01-01T00:00:00.000Z" });
    await appendFact(dir, { subject: "cache", predicate: "rdfs:subClassOf", object: "buffer", createdAt: "2026-09-09T00:00:00.000Z" });
    const [f] = factsOf(await loadMemory(dir));
    assert.equal(attr(f, CREATED_AT_PROP), "2026-01-01T00:00:00.000Z", "the FIRST write wins, not the latest");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("(a) createdAt first-write-wins on an utterance; a Source keeps its first-seen timestamp too", async () => {
  const dir = await tmpRepo();
  const SESSION = "0189bbbb-0000-7000-8000-000000000000";
  try {
    const first = { role: "visitor", text: "hi", ts: "2026-02-02T00:00:00.000Z", sessionId: SESSION };
    const { id } = await appendUtterance(dir, first);
    await appendUtterance(dir, { ...first, text: "hi again (same id)" }); // same id (session#ts#role)
    const m = await loadMemory(dir);
    const utt = m.individuals.find((i) => i.id === id);
    assert.equal(attr(utt, CREATED_AT_PROP), "2026-02-02T00:00:00.000Z");
    // its Session anchor also carries createdAt
    const sess = m.individuals.find((i) => i.id === `session:${SESSION}`);
    assert.ok(attr(sess, CREATED_AT_PROP), "the Session anchor is timestamped");

    // a Source's createdAt is first-write-wins across re-assertions
    await appendFact(dir, { subject: "a", predicate: "isa", object: "b", provenance: "corpus:conceptnet", createdAt: "2026-03-03T00:00:00.000Z" });
    await appendFact(dir, { subject: "c", predicate: "isa", object: "d", provenance: "corpus:conceptnet", createdAt: "2026-08-08T00:00:00.000Z" });
    const src = sourcesOf(await loadMemory(dir)).find((s) => s.id === "src:corpus:conceptnet");
    assert.equal(attr(src, CREATED_AT_PROP), "2026-03-03T00:00:00.000Z", "the corpus Source keeps its first-seen createdAt");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- (b) Sources + statedBy edges, deterministic ids, no re-keying ----------

test("(b) provenanceTagToSource: parses the closed kind set; unknown → null", () => {
  assert.deepEqual(provenanceTagToSource("corpus:conceptnet /r/IsA"), { kind: "corpus", name: "conceptnet" });
  assert.deepEqual(provenanceTagToSource("ace:chat:sess-1@2026-07-01T00:00:00.000Z"), { kind: "operator", createdAt: "2026-07-01T00:00:00.000Z" });
  assert.deepEqual(provenanceTagToSource("ace:chat"), { kind: "operator", createdAt: "" });
  assert.deepEqual(provenanceTagToSource("web:https://x.example/p"), { kind: "web", url: "https://x.example/p" });
  assert.deepEqual(provenanceTagToSource("entailed:transitivity"), { kind: "entailed", rule: "transitivity" });
  assert.deepEqual(provenanceTagToSource("session:abc"), { kind: "operator" });
  assert.equal(provenanceTagToSource("test:manual"), null);
  assert.equal(provenanceTagToSource(""), null);
});

test("(b) appendFact derives Source individuals + statedBy edges — WITHOUT re-keying the (s,p,o) fact id", async () => {
  const dir = await tmpRepo();
  try {
    const bare = await appendFact(dir, { subject: "cache", predicate: "rdfs:subClassOf", object: "buffer" });
    // a content-addressed fact id (the (s,p,o) keying is owned elsewhere; here we
    // only pin that Source edges are ADDITIVE and never re-key it)
    assert.match(bare.id, /^fact:[0-9a-f]{8}$/);

    // adding Source edges via provenance must NOT change the id
    const withProv = await appendFact(dir, { subject: "cache", predicate: "rdfs:subClassOf", object: "buffer", provenance: "corpus:conceptnet /r/IsA" });
    assert.equal(withProv.id, bare.id, "Source edges never re-key a fact");

    const m = await loadMemory(dir);
    assert.equal(factsOf(m).length, 1, "still one fact");
    const src = sourcesOf(m).find((s) => s.id === "src:corpus:conceptnet");
    assert.ok(src, "the corpus Source individual exists (deterministic id)");
    assert.equal(attr(src, "mgx:sourceType"), "corpus");
    assert.deepEqual(statedEdges(m).map((e) => [e.subject, e.object]), [[bare.id, "src:corpus:conceptnet"]]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("(b) the ' | '-union becomes N statedBy edges (one per independent source); the compat string stays byte-identical", async () => {
  const dir = await tmpRepo();
  try {
    await appendFact(dir, { subject: "module", predicate: "rdfs:subClassOf", object: "artifact", provenance: "corpus:conceptnet /r/IsA" });
    await appendFact(dir, { subject: "module", predicate: "rdfs:subClassOf", object: "artifact", provenance: "ace:chat:s1@2026-07-01T00:00:00.000Z" });
    const m = await loadMemory(dir);
    const [f] = factsOf(m);
    // the legacy compat shim is preserved verbatim (chat.mjs readers key on it)
    assert.equal(attr(f, "mgx:factProvenance"), "corpus:conceptnet /r/IsA | ace:chat:s1@2026-07-01T00:00:00.000Z");
    // and two real statedBy edges now exist, one per distinct Source
    const objs = statedEdges(m).filter((e) => e.subject === f.id).map((e) => e.object).sort();
    assert.deepEqual(objs, ["src:corpus:conceptnet", OPERATOR_SOURCE_ID].sort());
    // recovered @ts seeds the operator Source's createdAt
    const op = sourcesOf(m).find((s) => s.id === OPERATOR_SOURCE_ID);
    assert.equal(attr(op, CREATED_AT_PROP), "2026-07-01T00:00:00.000Z");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("(b) lazy migration: a legacy store (factProvenance string, no edges) gains Sources + edges + trust on the next write, idempotently, string preserved", async () => {
  const dir = await tmpRepo();
  try {
    // hand-build a pre-Source legacy store. The id is opaque (migration must
    // NEVER recompute it — it only adds edges), so a fixed literal proves the
    // non-re-keying guarantee independently of the (s,p,o) keying scheme.
    const legacy = emptyMemory();
    const factId = "fact:aaaaaaaa";
    legacy.individuals.push({
      id: factId, label: "widget rdfs:subClassOf gadget", class: FACT_CLASS,
      derived_from: [], mentions: [],
      attributes: [
        { prop: "rdf:type", key: "type", value: "rdf:Statement" },
        { prop: "rdf:subject", key: "subject", value: "widget" },
        { prop: "rdf:predicate", key: "predicate", value: "rdfs:subClassOf" },
        { prop: "rdf:object", key: "object", value: "gadget" },
        { prop: "mgx:factProvenance", key: "provenance", value: "corpus:conceptnet /r/IsA | ace:chat:s0@2026-06-01T00:00:00.000Z" },
      ],
    });
    const file = join(dir, MEMORY_GRAPH_REL);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(legacy));

    // ANY subsequent write drives the in-mutateMemory migration (here: an unrelated utterance)
    await appendUtterance(dir, { role: "visitor", text: "trigger", ts: "2026-07-05T00:00:00.000Z", sessionId: "0189cccc-0000-7000-8000-000000000000" });

    const m1 = await loadMemory(dir);
    const f1 = factsOf(m1).find((f) => f.id === factId);
    assert.equal(attr(f1, "mgx:factProvenance"), "corpus:conceptnet /r/IsA | ace:chat:s0@2026-06-01T00:00:00.000Z", "string kept, never dropped");
    const objs1 = statedEdges(m1).filter((e) => e.subject === factId).map((e) => e.object).sort();
    assert.deepEqual(objs1, ["src:corpus:conceptnet", OPERATOR_SOURCE_ID].sort(), "both Sources linked");
    assert.ok(attr(f1, "mgx:trustScore"), "trust materialised on migration");
    assert.equal(f1.id, "fact:aaaaaaaa", "fact id never re-keyed by migration");

    // idempotent: another write does not duplicate edges/sources
    await appendUtterance(dir, { role: "visitor", text: "again", ts: "2026-07-05T00:01:00.000Z", sessionId: "0189cccc-0000-7000-8000-000000000000" });
    const m2 = await loadMemory(dir);
    assert.equal(statedEdges(m2).filter((e) => e.subject === factId).length, 2, "no duplicate statedBy edges");
    assert.equal(sourcesOf(m2).length, 2, "no duplicate Source individuals");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- (c) materialised trust -------------------------------------------------

test("(c) trust is materialised + auditable: a corroborated operator+corpus fact outranks a lone corpus fact", async () => {
  const dir = await tmpRepo();
  try {
    await appendFact(dir, { subject: "cache", predicate: "rdfs:subClassOf", object: "buffer", provenance: "corpus:conceptnet /r/IsA" });
    await appendFact(dir, { subject: "cache", predicate: "rdfs:subClassOf", object: "buffer", provenance: "ace:chat:s1@2026-07-05T00:00:00.000Z" });
    await appendFact(dir, { subject: "lonely", predicate: "rdfs:subClassOf", object: "thing", provenance: "corpus:conceptnet /r/IsA" });
    const rows = readFactRows(await loadMemory(dir));
    const corroborated = rows.find((r) => r.subject === "cache");
    const lone = rows.find((r) => r.subject === "lonely");
    assert.ok(corroborated.trust > lone.trust, `${corroborated.trust} > ${lone.trust}`);
    assert.deepEqual(corroborated.sourceTypes.sort(), ["corpus", "operator"]);
    // the inputs are stored so the score is reproducible
    const m = await loadMemory(dir);
    const f = factsOf(m).find((x) => attr(x, "rdf:subject") === "cache");
    const inputs = JSON.parse(attr(f, "mgx:trustInputs"));
    assert.equal(inputs.corroboration, 2);
    assert.deepEqual(inputs.sourceTypes, ["corpus", "operator"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- (d) trust-weighted retrieval + contradiction surfacing -----------------

test("(d) retrieveBlocks weights relevance × trust: on an IDF tie the higher-trust block wins", async () => {
  const dir = await tmpRepo();
  try {
    // two blocks sharing the rare query token "zebra"; identical relevance, no
    // similarity edges (isolated → equal rank) — only their source trust differs.
    await saveBlock(dir, { id: "operator-block", text: "zebra", sourceType: "operator" });
    await saveBlock(dir, { id: "web-block", text: "zebra", sourceType: "web" });
    const hits = await retrieveBlocks(dir, "zebra", 2);
    assert.deepEqual(hits.map((h) => h.id), ["operator-block", "web-block"], "the operator-trust block outranks the web block");
    assert.ok(hits[0].score > hits[1].score, "trust factor breaks the relevance tie");
    assert.ok(hits[0].trust > hits[1].trust);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("(d) contradictions are surfaced, both kept with provenance, never silently resolved", async () => {
  const dir = await tmpRepo();
  try {
    // same (subject, predicate), DIFFERENT object, both above the trust floor
    // (subject "sky", not "the sky" — normFactTerm now strips a leading article,
    // a Tier-5 playtest fix so a recall query like "who maintains the tasks
    // handler" matches a fact taught as "the tasks handler …"; the article was
    // never load-bearing to this contradiction-surfacing feature itself)
    await appendFact(dir, { subject: "sky", predicate: "mgx:hasProperty", object: "blue", provenance: "ace:chat:s1@2026-07-05T00:00:00.000Z" });
    await appendFact(dir, { subject: "sky", predicate: "mgx:hasProperty", object: "grey", provenance: "corpus:conceptnet /r/HasProperty" });
    const m = await loadMemory(dir);
    const groups = findContradictions(m);
    assert.equal(groups.length, 1, "one contradiction detected");
    assert.deepEqual(groups[0].map((r) => r.object), ["blue", "grey"], "both objects present, higher-trust first");
    // the inspector surfaces BOTH with provenance
    const text = renderMemory({ memory: m, blocks: { blocks: {} } });
    assert.match(text, /contradictions \(1 — both kept, never silently resolved\):/);
    assert.match(text, /sky mgx:hasProperty\?/);
    assert.match(text, /blue \(trust /);
    assert.match(text, /grey \(trust /);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("(d) same (s,p,o) from two writers is CORROBORATION, not a contradiction", async () => {
  const dir = await tmpRepo();
  try {
    await appendFact(dir, { subject: "the sky", predicate: "mgx:hasProperty", object: "blue", provenance: "ace:chat:s1@2026-07-05T00:00:00.000Z" });
    await appendFact(dir, { subject: "the sky", predicate: "mgx:hasProperty", object: "blue", provenance: "corpus:conceptnet /r/HasProperty" });
    const m = await loadMemory(dir);
    assert.equal(factsOf(m).length, 1, "one fact id, two statedBy edges");
    assert.equal(findContradictions(m).length, 0, "agreement is never a contradiction");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- Part 5 (extension-pack batch): namespacing/provenance across BUNDLES ---
// Mostly confirming EXISTING, UNTOUCHED machinery (findContradictions,
// syncFactSources) already does the right thing once two different EXTENSION
// BUNDLES (not just two ad hoc provenance tags) assert conflicting facts via
// the real seedMemory() seeding path — never a hand-built payload.

test("(e) two extension bundles asserting a conflicting fact: distinct Fact/Source individuals, never silently overwritten, findContradictions surfaces it", async () => {
  const dir = await tmpRepo();
  try {
    const sliceA = join(dir, "bundle-a.jsonl");
    const sliceB = join(dir, "bundle-b.jsonl");
    // same (subject, predicate) — /r/HasProperty maps to mgx:hasProperty in the
    // committed conceptnet-map.toml — DIFFERENT object, from two DIFFERENT
    // provenancePrefixes (the exact shape a tier2-aws bundle and a seon bundle
    // would each pass to seedMemory via src/extensions.mjs's resolved entries).
    await writeFile(sliceA, JSON.stringify({ start: "/c/en/widget_x", rel: "/r/HasProperty", end: "/c/en/red", weight: 1 }) + "\n");
    await writeFile(sliceB, JSON.stringify({ start: "/c/en/widget_x", rel: "/r/HasProperty", end: "/c/en/blue", weight: 1 }) + "\n");
    const { seedMemory } = await import("../src/corpus/conceptnet.mjs");
    await seedMemory(dir, { slicePath: sliceA, provenancePrefix: "corpus:tier2-aws" });
    await seedMemory(dir, { slicePath: sliceB, provenancePrefix: "corpus:seon" });

    const m = await loadMemory(dir);
    const facts = factsOf(m).filter((f) => attr(f, "rdf:subject") === "widget x");
    assert.equal(facts.length, 2, "two DISTINCT Fact individuals — the second bundle's fact never overwrote the first's");
    assert.deepEqual(facts.map((f) => attr(f, "rdf:object")).sort(), ["blue", "red"]);

    // distinct, correctly-typed Source individuals — one per bundle, deterministic id
    const sources = sourcesOf(m);
    const awsSrc = sources.find((s) => s.id === "src:corpus:tier2-aws");
    const seonSrc = sources.find((s) => s.id === "src:corpus:seon");
    assert.ok(awsSrc, "a src:corpus:tier2-aws Source individual exists");
    assert.ok(seonSrc, "a src:corpus:seon Source individual exists");
    assert.equal(attr(awsSrc, "mgx:sourceType"), "corpus");
    assert.equal(attr(seonSrc, "mgx:sourceType"), "corpus");

    // the EXISTING, UNTOUCHED findContradictions surfaces the conflict rather
    // than either fact silently winning.
    const groups = findContradictions(m);
    const group = groups.find((g) => g[0].subject === "widget x");
    assert.ok(group, "findContradictions surfaces the cross-bundle conflict");
    assert.deepEqual(group.map((r) => r.object).sort(), ["blue", "red"], "both facts kept, never silently resolved");
    assert.ok(group.every((r) => r.trust > 0), "both facts clear the trust floor (corpus-sourced)");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ensure the memory dir constant is exercised (kept honest, no unused import)
test("MEMORY_DIR_REL points under .tmct/memory", () => {
  assert.equal(MEMORY_DIR_REL, join(".tmct", "memory"));
});
