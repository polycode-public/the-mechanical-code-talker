// memory/core.mjs tests — tmct's own OWL-labelled conversational memory graph:
// bootstrap load, utterance/fact appends (idempotent, crash-safe), the OWL/RDF
// labelling, and the guarantee that parseEntities loads the store unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  MEMORY_GRAPH_REL, UTTERANCE_CLASS, FACT_CLASS,
  SAID_IN_SESSION_PROP, IN_REPLY_TO_PROP,
  emptyMemory, loadMemory, appendUtterance, appendUtterances, appendFact, appendFacts,
  appendRule, findRuleByName, readFactRows, normFactTerm,
  resolveRelationChase, resolveRelationChaseReverse,
} from "../../src/adapters/memory/core.mjs";
import { factIdForTriple, legacyFactIdFor } from "../../src/domain/hash.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { lookupByProseTokens } from "../../src/domain/prose.mjs";
import { findActionPath, findReachableSet } from "../../src/domain/planning.mjs";

const SESSION = "01890000-0000-7000-8000-00000000abcd";
const TS1 = "2026-07-03T10:01:00.000Z";
const TS2 = "2026-07-03T10:02:00.000Z";

const attr = (ind, key) => (ind?.attributes || []).find((a) => a.key === key)?.value;

async function tmpRepo() {
  return mkdtemp(join(tmpdir(), "tmct-mem-core-"));
}

test("loadMemory: no store → the empty bootstrap payload (buildEntities shape, owl/rdf prefixes, memory-marked)", async () => {
  const dir = await tmpRepo();
  try {
    const m = await loadMemory(dir);
    assert.equal(m.memory, true);
    assert.deepEqual(m.individuals, []);
    assert.deepEqual(m.classes, []);
    assert.deepEqual(m.objectProperties, []);
    assert.deepEqual(m.proseIndex, {});
    assert.ok(m.prefixes.owl.includes("owl"), "owl prefix declared");
    assert.ok(m.prefixes.rdf.includes("rdf-syntax"), "rdf prefix declared");
    assert.ok(m.vocabulary.some((v) => v.prop === SAID_IN_SESSION_PROP));
    // the shape is loadable by the same parser as any provider graph
    const g = parseEntities(m);
    assert.deepEqual(g.individuals, []);
    assert.deepEqual(g.relations, []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendUtterance: an a-visitor-said item — Utterance individual, OWL typing, session anchor, saidInSession edge", async () => {
  const dir = await tmpRepo();
  try {
    const { id } = await appendUtterance(dir, {
      role: "visitor", text: "which modules import   config.mjs?", ts: TS1,
      sessionId: SESSION, sessionStarted: TS1, parsed: { object: "config.mjs" },
    });
    assert.equal(id, `utt:${SESSION}#${TS1}#visitor`);

    const m = JSON.parse(await readFile(join(dir, MEMORY_GRAPH_REL), "utf8"));
    const utt = m.individuals.find((i) => i.id === id);
    assert.equal(utt.class, UTTERANCE_CLASS);
    assert.equal(attr(utt, "type"), "owl:NamedIndividual", "rdf:type attribute labels the individual");
    assert.equal(utt.attributes.find((a) => a.key === "type").prop, "rdf:type");
    assert.equal(attr(utt, "role"), "visitor");
    assert.equal(attr(utt, "text"), "which modules import config.mjs?", "whitespace normalized");
    assert.equal(attr(utt, "ts"), TS1);
    assert.deepEqual(JSON.parse(attr(utt, "parsed")), { object: "config.mjs" });

    // session anchor exists and the edge points at it — never dangling
    const sess = m.individuals.find((i) => i.id === `session:${SESSION}`);
    assert.ok(sess, "Session anchor individual created");
    assert.equal(attr(sess, "started"), TS1);
    const group = m.objectProperties.find((g) => g.prop === SAID_IN_SESSION_PROP);
    assert.deepEqual(group.examples.map((e) => [e.subject, e.object]), [[id, sess.id]]);
    assert.equal(group.count, 1);

    // classes[] counts memory classes like graph-build counts code classes
    assert.equal(m.classes.find((c) => c.name === UTTERANCE_CLASS).count, 1);
    assert.equal(m.classes.find((c) => c.name === "Session").count, 1);

    // the store is a real graph: prose-indexed and parseEntities-loadable
    const g = parseEntities(m);
    assert.ok(g.byId.has(id));
    const hits = lookupByProseTokens(g.proseIndex, "import config");
    assert.ok(hits.some((h) => h.id === id), "the utterance is findable by its words");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendUtterances: the tmct response pairs to the visitor request via inReplyTo; re-append replaces (idempotent)", async () => {
  const dir = await tmpRepo();
  try {
    const visitorId = `utt:${SESSION}#${TS1}#visitor`;
    const turn = [
      { role: "visitor", text: "who calls helper?", ts: TS1, sessionId: SESSION },
      { role: "tmct", text: "helper is called by app/lib/b.mjs.", ts: TS1, sessionId: SESSION, replyTo: visitorId },
    ];
    const { ids } = await appendUtterances(dir, turn);
    assert.deepEqual(ids, [visitorId, `utt:${SESSION}#${TS1}#tmct`]);
    await appendUtterances(dir, turn); // first re-append (sessions.mjs replays all turns)

    const m = await loadMemory(dir);
    assert.equal(m.individuals.filter((i) => i.class === UTTERANCE_CLASS).length, 2, "no duplicates");
    const reply = m.objectProperties.find((g) => g.prop === IN_REPLY_TO_PROP);
    assert.equal(reply.count, 1, "one Q/A pairing edge, not re-added");
    // upsertEdge now stamps createdAt (first-write-wins) — assert its shape/format separately
    // rather than folding it into the strict shape deepEqual below.
    const { createdAt, ...rest } = reply.examples[0];
    assert.match(createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "edge createdAt is ISO-8601");
    assert.deepEqual(rest, {
      subject: `utt:${SESSION}#${TS1}#tmct`, object: visitorId,
      subjectLabel: "helper is called by app/lib/b.mjs.", objectLabel: "who calls helper?",
    });
    const said = m.objectProperties.find((g) => g.prop === SAID_IN_SESSION_PROP);
    assert.equal(said.count, 2);

    // re-append-preserves-createdAt: a THIRD append of the exact same turn must not reset the
    // inReplyTo edge's createdAt to "now" — first-write-wins over the same (subject,object) pair.
    await appendUtterances(dir, turn); // second re-append
    const m2 = await loadMemory(dir);
    const reply2 = m2.objectProperties.find((g) => g.prop === IN_REPLY_TO_PROP);
    assert.equal(reply2.examples[0].createdAt, createdAt, "re-appending the same edge keeps its original createdAt");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendUtterance: a reply to an unknown utterance drops the edge (honest), never dangles; bad role throws", async () => {
  const dir = await tmpRepo();
  try {
    await appendUtterance(dir, { role: "tmct", text: "orphan answer", ts: TS2, sessionId: SESSION, replyTo: "utt:nope" });
    const m = await loadMemory(dir);
    assert.equal(m.objectProperties.find((g) => g.prop === IN_REPLY_TO_PROP), undefined);
    await assert.rejects(
      () => appendUtterance(dir, { role: "narrator", text: "x", ts: TS2, sessionId: SESSION }),
      /role must be "visitor" or "tmct"/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendFact: an RDF-reified triple with provenance; same (s,p,o) → same id, no duplicate", async () => {
  const dir = await tmpRepo();
  try {
    const triple = { subject: "chat.mjs", predicate: "uses", object: "sessions.mjs", provenance: `session:${SESSION}` };
    const { id } = await appendFact(dir, triple);
    const again = await appendFact(dir, triple);
    assert.equal(again.id, id, "content-addressed fact id");
    assert.match(id, /^fact:[0-9a-f]{16}$/);

    const m = await loadMemory(dir);
    const facts = m.individuals.filter((i) => i.class === FACT_CLASS);
    assert.equal(facts.length, 1);
    assert.equal(attr(facts[0], "type"), "rdf:Statement", "reified RDF statement typing");
    assert.equal(facts[0].attributes.find((a) => a.key === "subject").prop, "rdf:subject");
    assert.equal(attr(facts[0], "subject"), "chat.mjs");
    assert.equal(attr(facts[0], "predicate"), "uses");
    assert.equal(attr(facts[0], "object"), "sessions.mjs");
    assert.equal(attr(facts[0], "provenance"), `session:${SESSION}`);
    assert.equal(m.classes.find((c) => c.name === FACT_CLASS).count, 1);

    await assert.rejects(() => appendFact(dir, { subject: "x", predicate: "", object: "y" }), /needs subject/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appends are atomic: no temp litter in .tmct/memory, and the store survives interleaved appends", async () => {
  const dir = await tmpRepo();
  try {
    await appendUtterance(dir, { role: "visitor", text: "first", ts: TS1, sessionId: SESSION });
    await appendFact(dir, { subject: "a", predicate: "isa", object: "thing" });
    await appendUtterance(dir, { role: "visitor", text: "second", ts: TS2, sessionId: SESSION });
    const names = await readdir(join(dir, ".tmct", "memory"));
    assert.ok(!names.some((n) => n.includes(".tmp-")), `atomic write leaves no temp files: ${names}`);
    const m = await loadMemory(dir);
    assert.equal(m.individuals.filter((i) => i.class === UTTERANCE_CLASS).length, 2);
    assert.equal(m.individuals.filter((i) => i.class === FACT_CLASS).length, 1);
    assert.equal(m.generated_at, TS2, "generated_at tracks the latest utterance");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendFacts: ONE write for a whole batch — Fact individuals, provenance, trust; malformed rows skipped not thrown", async () => {
  const dir = await tmpRepo();
  try {
    const res = await appendFacts(dir, [
      { subject: "/c/en/cache", predicate: "rdfs:subClassOf", object: "buffer", provenance: "corpus:conceptnet /r/IsA" },
      { subject: "module", predicate: "rdfs:subClassOf", object: "artifact", provenance: "corpus:conceptnet /r/IsA" },
      { subject: "bad", predicate: "", object: "row" },       // malformed — skipped
      { subject: "", predicate: "isa", object: "thing" },      // malformed — skipped
    ]);
    assert.deepEqual({ appended: res.appended, skipped: res.skipped }, { appended: 2, skipped: 2 });
    assert.equal(res.ids.length, 2);

    const m = await loadMemory(dir);
    const facts = m.individuals.filter((i) => i.class === FACT_CLASS);
    assert.equal(facts.length, 2, "two facts, malformed rows never landed");
    const cache = facts.find((f) => attr(f, "subject") === "cache");
    assert.equal(attr(cache, "type"), "rdf:Statement");
    assert.equal(attr(cache, "object"), "buffer");
    assert.equal(attr(cache, "provenance"), "corpus:conceptnet /r/IsA");
    // provenance derived a Source + statedBy edge + a trust score (same seam as appendFact)
    assert.ok(m.individuals.some((i) => i.class === "Source"), "a Source individual was derived");
    assert.ok(Number(attr(cache, "trustScore")) > 0, "trust materialised");
    assert.equal(m.classes.find((c) => c.name === FACT_CLASS).count, 2);

    // empty batch is a no-op
    const none = await appendFacts(dir, []);
    assert.deepEqual(none, { ids: [], appended: 0, skipped: 0 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendFacts: GOLDEN EQUIVALENCE — byte-identical to looping appendFact (incl. duplicate-provenance arrival order)", async () => {
  // Injected fixed clock: every fact carries the SAME explicit createdAt, so
  // first-write-wins createdAt (and the recency it feeds) is reproducible across
  // the two independent seeds — without this the two live seeds would stamp
  // different wall-clock timestamps and the equivalence would be vacuous.
  const CREATED = "2026-01-02T03:04:05.000Z";
  const facts = [
    { subject: "/c/en/cache", predicate: "rdfs:subClassOf", object: "/c/en/buffer", provenance: "corpus:conceptnet /r/IsA", createdAt: CREATED },
    { subject: "the sky", predicate: "mgx:hasProperty", object: "blue", provenance: "ace:chat:s1@2026-07-05T00:00:00.000Z", createdAt: CREATED },
    // SAME (s,p,o) id as row 0, a DIFFERENT provenance tag — the union must read
    // in ARRIVAL order ("corpus… | web…"), never sorted/reordered.
    { subject: "cache", predicate: "rdfs:subClassOf", object: "buffer", provenance: "web:https://ex.org/x", createdAt: CREATED },
    { subject: "module", predicate: "rdfs:subClassOf", object: "artifact", provenance: "corpus:conceptnet /r/IsA", createdAt: CREATED },
    { subject: "bad", predicate: "", object: "row", createdAt: CREATED }, // malformed — batch skips, appendFact would throw
  ];
  const valid = facts.filter((f) => f.subject && f.predicate && f.object);

  // Sort the arrays whose ORDER legitimately differs between the two paths
  // (individuals / edge examples / class samples), but NEVER touch attribute
  // order or the provenance STRING — those must already be identical.
  //
  // Two fields are genuinely LIVE-CLOCK (real wall-clock "now", not the injected
  // fixed CREATED above) and so legitimately differ by a millisecond or two between
  // the two independently-timed seeds: mgx:updatedAt (recomputeFactTrust/
  // recomputeSourceReliability re-stamp it every mutation) and an
  // edge's own createdAt (upsertEdge stamps "now" when the caller passes none —
  // syncFactSources's statedBy edges never thread the fact's own createdAt through,
  // an edge's creation moment is its own, not necessarily its subject's).
  // Redact both to a placeholder before the structural comparison; still asserted
  // present/well-formed further down.
  const REDACT_TS = "<ts>";
  const norm = (g) => ({
    ...g,
    individuals: [...g.individuals]
      .map((i) => ({
        ...i,
        attributes: (i.attributes || []).map((a) => (a.prop === "mgx:updatedAt" ? { ...a, value: REDACT_TS } : a)),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    objectProperties: [...g.objectProperties]
      .map((grp) => ({
        ...grp,
        examples: [...grp.examples]
          .map((e) => (e.createdAt ? { ...e, createdAt: REDACT_TS } : e))
          .sort((a, b) => `${a.subject}>${a.object}`.localeCompare(`${b.subject}>${b.object}`)),
      }))
      .sort((a, b) => a.prop.localeCompare(b.prop)),
    classes: [...g.classes].map((c) => ({ ...c, sample: [...(c.sample || [])].sort() })).sort((a, b) => a.name.localeCompare(b.name)),
  });

  const dirA = await tmpRepo();
  const dirB = await tmpRepo();
  try {
    for (const f of valid) await appendFact(dirA, f); // per-fact path (throws on malformed → feed only valid)
    const res = await appendFacts(dirB, facts);       // batch path (skips malformed)
    assert.deepEqual({ appended: res.appended, skipped: res.skipped }, { appended: 4, skipped: 1 });

    const a = JSON.parse(await readFile(join(dirA, MEMORY_GRAPH_REL), "utf8"));
    const b = JSON.parse(await readFile(join(dirB, MEMORY_GRAPH_REL), "utf8"));

    // the load-bearing assertion: the two graphs are structurally identical
    assert.deepEqual(norm(b), norm(a), "batch graph == per-fact graph (modulo array order)");

    // and prove the duplicate-fact provenance union is arrival-ordered in BOTH
    const provOf = (g) => attr(g.individuals.find((i) => i.class === FACT_CLASS && attr(i, "subject") === "cache"), "provenance");
    assert.equal(provOf(a), "corpus:conceptnet /r/IsA | web:https://ex.org/x", "per-fact: arrival-ordered union");
    assert.equal(provOf(b), provOf(a), "batch: byte-identical arrival-ordered union");
  } finally {
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  }
});

test("emptyMemory: distinct from source.mjs's provider bootstrap — memory-marked, never bootstrap-marked", () => {
  const m = emptyMemory();
  assert.equal(m.memory, true);
  assert.equal(m.bootstrap, undefined, "not a provider payload");
});

test("appendFact: term normalization converges ConceptNet/CURIE/bare spellings on ONE fact id", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mem-"));
  try {
    const a = await appendFact(dir, { subject: "/c/en/software_bug", predicate: "rdfs:subClassOf", object: "/c/en/defect" });
    const b = await appendFact(dir, { subject: "tmct:Software_bug", predicate: "rdfs:subClassOf", object: "Defect" });
    const c = await appendFact(dir, { subject: "software bug", predicate: "rdfs:subClassOf", object: "defect" });
    assert.equal(a.id, b.id, "ConceptNet and CURIE spellings share an id");
    assert.equal(b.id, c.id, "bare lowercase spelling shares it too");
    const m = await loadMemory(dir);
    const facts = m.individuals.filter((i) => i.class === FACT_CLASS);
    assert.equal(facts.length, 1, "one fact, not three");
    const attr = (k) => facts[0].attributes.find((x) => x.key === k)?.value;
    assert.equal(attr("subject"), "software bug");
    assert.equal(attr("predicate"), "rdfs:subClassOf", "predicate casing preserved");
    assert.equal(attr("object"), "defect");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("appendFact: provenance is UNIONED across writers, never overwritten", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mem-"));
  try {
    await appendFact(dir, { subject: "module", predicate: "rdfs:subClassOf", object: "artifact", provenance: "corpus:conceptnet" });
    await appendFact(dir, { subject: "module", predicate: "rdfs:subClassOf", object: "artifact", provenance: "chat:session-1" });
    await appendFact(dir, { subject: "module", predicate: "rdfs:subClassOf", object: "artifact", provenance: "chat:session-1" });
    const m = await loadMemory(dir);
    const facts = m.individuals.filter((i) => i.class === FACT_CLASS);
    assert.equal(facts.length, 1);
    const prov = facts[0].attributes.find((x) => x.key === "provenance")?.value;
    assert.equal(prov, "corpus:conceptnet | chat:session-1", "both provenances kept, deduped");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- resolveRelationChase / resolveRelationChaseReverse ---------------------
// These used to be unexported closures inside chat.mjs's factReadBack (the
// (a0)/(a0.2) blocks). Extracted here as plain, standalone, importable
// functions (a Stage 1 prerequisite). Called DIRECTLY here —
// never through chat.mjs — with minimal, self-contained helper implementations
// (not chat.mjs's own renderFactLine/factPhrase/factTermVariants) to prove the
// functions carry no hidden chat.mjs coupling: any caller supplying a
// conforming `helpers` bag gets identical dispatch behavior.
const testByTrust = (a, b) => b.trust - a.trust;
const testRenderFactLine = (f) => `${f.subject} ${f.predicate} ${f.object}`;
const testFactPhrase = (f) => `${f.subject} ${f.predicate} ${f.object}`;
const testFactTermVariants = (normFn, term) => new Set([normFn(term)]);
const testHasPropertyPredicate = "mgx:hasProperty";
// A minimal candidate-list builder — direct-predicate match only (no alias
// chase — resolveRelationChase/Reverse never call the alias substrate
// themselves; that's entirely inside the caller's own relationFactsFor, which
// is exactly what this test proves by supplying a deliberately simpler one).
function testRelationFactsFor(rows) {
  return (name) => rows
    .filter((f) => f.predicate === `mgx:${name}`)
    .map((f) => ({ fact: f, aliasFacts: [] }));
}

test("resolveRelationChase: direct fact hit — a plain taught relation resolves to a citation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mem-relchase-"));
  try {
    await appendFact(dir, { subject: "ahab", predicate: "mgx:father", object: "john", provenance: "teach:chat" });
    const memory = await loadMemory(dir);
    const rows = readFactRows(memory);
    const helpers = {
      relationFactsFor: testRelationFactsFor(rows),
      renderFactLine: testRenderFactLine, factPhrase: testFactPhrase,
      factTermVariants: testFactTermVariants, byTrust: testByTrust,
      rows, HAS_PROPERTY_PREDICATE: testHasPropertyPredicate,
      findActionPath, findReachableSet,
    };
    const hit = await resolveRelationChase(memory, "father", "ahab", "john", helpers);
    assert.ok(hit, "direct fact resolves");
    assert.deepEqual(hit.citation, ["ahab mgx:father john"]);

    const miss = await resolveRelationChase(memory, "father", "ahab", "ishmael", helpers);
    assert.equal(miss, null, "honest miss — never a guessed no");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveRelationChase: compose2 rule chase — a 2-hop rule resolves via the SAME relationFactsFor candidate list, recursively", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mem-relchase-"));
  try {
    await appendFact(dir, { subject: "ahab", predicate: "mgx:father", object: "john", provenance: "teach:chat" });
    await appendFact(dir, { subject: "john", predicate: "mgx:father", object: "ishmael", provenance: "teach:chat" });
    await appendRule(dir, { name: "grandparent", kind: "compose2", slots: { base1: "father", base2: "father" }, provenance: "teach:chat" });
    const memory = await loadMemory(dir);
    const rows = readFactRows(memory);
    const helpers = {
      relationFactsFor: testRelationFactsFor(rows),
      renderFactLine: testRenderFactLine, factPhrase: testFactPhrase,
      factTermVariants: testFactTermVariants, byTrust: testByTrust,
      rows, HAS_PROPERTY_PREDICATE: testHasPropertyPredicate,
      findActionPath, findReachableSet,
    };
    const hit = await resolveRelationChase(memory, "grandparent", "ahab", "ishmael", helpers);
    assert.ok(hit, "2-hop compose2 chase resolves");
    assert.deepEqual(hit.citation, ["ahab mgx:father john", "john mgx:father ishmael"]);

    // hop-count discipline: a 1-hop path must NOT satisfy the 2-hop rule
    const oneHop = await resolveRelationChase(memory, "grandparent", "ahab", "john", helpers);
    assert.equal(oneHop, null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveRelationChase: filter rule chase — recurses into its own base (itself), then requires the taught property", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mem-relchase-"));
  try {
    await appendFact(dir, { subject: "ahab", predicate: "mgx:father", object: "john", provenance: "teach:chat" });
    await appendFact(dir, { subject: "john", predicate: "mgx:father", object: "ishmael", provenance: "teach:chat" });
    await appendFact(dir, { subject: "ahab", predicate: testHasPropertyPredicate, object: "male", provenance: "teach:chat" });
    await appendRule(dir, { name: "grandparent", kind: "compose2", slots: { base1: "father", base2: "father" }, provenance: "teach:chat" });
    await appendRule(dir, { name: "grandfather", kind: "filter", slots: { base: "grandparent", property: "male" }, provenance: "teach:chat" });
    const memory = await loadMemory(dir);
    const rows = readFactRows(memory);
    const helpers = {
      relationFactsFor: testRelationFactsFor(rows),
      renderFactLine: testRenderFactLine, factPhrase: testFactPhrase,
      factTermVariants: testFactTermVariants, byTrust: testByTrust,
      rows, HAS_PROPERTY_PREDICATE: testHasPropertyPredicate,
      findActionPath, findReachableSet,
    };
    const hit = await resolveRelationChase(memory, "grandfather", "ahab", "ishmael", helpers);
    assert.ok(hit, "filter chase resolves when base holds AND the property is taught");
    assert.deepEqual(hit.citation, [
      "ahab mgx:father john", "john mgx:father ishmael", `ahab ${testHasPropertyPredicate} male`,
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveRelationChaseReverse: given a name + fixed object, returns every satisfying subject — direct, compose2, and unknown-name cases", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mem-relchase-"));
  try {
    await appendFact(dir, { subject: "ahab", predicate: "mgx:father", object: "john", provenance: "teach:chat" });
    await appendFact(dir, { subject: "john", predicate: "mgx:father", object: "ishmael", provenance: "teach:chat" });
    await appendRule(dir, { name: "grandparent", kind: "compose2", slots: { base1: "father", base2: "father" }, provenance: "teach:chat" });
    const memory = await loadMemory(dir);
    const rows = readFactRows(memory);
    const helpers = {
      relationFactsFor: testRelationFactsFor(rows),
      renderFactLine: testRenderFactLine, factPhrase: testFactPhrase,
      factTermVariants: testFactTermVariants, byTrust: testByTrust,
      rows, HAS_PROPERTY_PREDICATE: testHasPropertyPredicate,
      findActionPath, findReachableSet,
    };
    const direct = await resolveRelationChaseReverse(memory, "father", "john", helpers);
    assert.deepEqual(direct.map((h) => h.subject), ["ahab"]);

    const reverse2Hop = await resolveRelationChaseReverse(memory, "grandparent", "ishmael", helpers);
    assert.deepEqual(reverse2Hop.map((h) => h.subject), ["ahab"]);
    assert.deepEqual(reverse2Hop[0].citation, ["ahab mgx:father john", "john mgx:father ishmael"]);

    const unknown = await resolveRelationChaseReverse(memory, "grandmother", "ishmael", helpers);
    assert.deepEqual(unknown, [], "unknown relation/rule name — honest empty, never a guess");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("resolveRelationChase / resolveRelationChaseReverse: genuinely standalone — findRuleByName + normFactTerm confirm the same memory payload underneath, called with NO chat.mjs import anywhere in this file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mem-relchase-"));
  try {
    await appendRule(dir, { name: "grandparent", kind: "compose2", slots: { base1: "father", base2: "father" }, provenance: "teach:chat" });
    const memory = await loadMemory(dir);
    assert.ok(findRuleByName(memory, "grandparent"), "the same loaded memory the chase functions consume is independently queryable");
    assert.equal(normFactTerm("Grandparent"), "grandparent");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("two triples that collided under the old 32-bit id now store as two separate facts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mem-collide-"));
  try {
    // Both hashed to fact:495ee929 under the old FNV-1a scheme — one would have
    // silently overwritten the other on the upsert path.
    const a = { subject: "thing23102", predicate: "mgx:atLocation", object: "value3156" };
    const b = { subject: "thing26033", predicate: "mgx:causes", object: "value6087" };
    assert.equal(legacyFactIdFor(a.subject, a.predicate, a.object), legacyFactIdFor(b.subject, b.predicate, b.object));

    const { appended } = await appendFacts(dir, [a, b]);
    assert.equal(appended, 2, "both facts written");
    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 2, "both facts stored — no silent merge");
    assert.equal(new Set(rows.map((r) => r.id)).size, 2, "two distinct fact ids on disk");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a store written under the old 32-bit fact id keeps resolving after the widening", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mem-legacy-"));
  try {
    // A pre-widening store: the Fact and its statedBy edge are keyed by the old
    // 32-bit id, computed from the real (s,p,o) the way an old writer would.
    const [s, p, o] = ["widget", "rdfs:subClassOf", "gadget"];
    const oldId = legacyFactIdFor(s, p, o);
    const legacy = emptyMemory();
    legacy.individuals.push({
      id: oldId, label: "widget rdfs:subClassOf gadget", class: FACT_CLASS,
      derived_from: [], mentions: [],
      attributes: [
        { prop: "rdf:type", key: "type", value: "rdf:Statement" },
        { prop: "rdf:subject", key: "subject", value: s },
        { prop: "rdf:predicate", key: "predicate", value: p },
        { prop: "rdf:object", key: "object", value: o },
      ],
    });
    legacy.objectProperties.push({
      prop: "mgx:statedBy", predicate: "statedBy", count: 1,
      examples: [{ subject: oldId, object: "src:corpus:conceptnet" }],
    });
    const file = join(dir, MEMORY_GRAPH_REL);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(legacy));

    // On load the Fact is migrated onto its current id, and the statedBy edge
    // moved with it — a lookup by the current id finds both.
    const currentId = factIdForTriple(s, p, o);
    assert.notEqual(currentId, oldId, "the id genuinely widened");
    const rows = readFactRows(await loadMemory(dir));
    const row = rows.find((r) => r.id === currentId);
    assert.ok(row, "the pre-widening fact resolves under its current id");
    assert.deepEqual(row.sourceIds, ["src:corpus:conceptnet"], "its statedBy edge migrated with it");

    // Re-teaching the same triple upserts onto the migrated fact — no duplicate.
    await appendFact(dir, { subject: s, predicate: p, object: o, provenance: "teach:chat" });
    const after = readFactRows(await loadMemory(dir)).filter((r) => r.subject === s && r.predicate === p && r.object === o);
    assert.equal(after.length, 1, "the re-teach upserts the migrated fact, never a second copy");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
