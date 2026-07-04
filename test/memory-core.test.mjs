// memory/core.mjs tests — tmct's own OWL-labelled conversational memory graph:
// bootstrap load, utterance/fact appends (idempotent, crash-safe), the OWL/RDF
// labelling, and the guarantee that parseEntities loads the store unchanged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MEMORY_GRAPH_REL, UTTERANCE_CLASS, FACT_CLASS,
  SAID_IN_SESSION_PROP, IN_REPLY_TO_PROP,
  emptyMemory, loadMemory, appendUtterance, appendUtterances, appendFact,
} from "../src/memory/core.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import { lookupByProseTokens } from "../src/prose.mjs";

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
    await appendUtterances(dir, turn); // per-turn re-append (sessions.mjs replays all turns)

    const m = await loadMemory(dir);
    assert.equal(m.individuals.filter((i) => i.class === UTTERANCE_CLASS).length, 2, "no duplicates");
    const reply = m.objectProperties.find((g) => g.prop === IN_REPLY_TO_PROP);
    assert.equal(reply.count, 1, "one Q/A pairing edge, not re-added");
    assert.deepEqual(reply.examples[0], {
      subject: `utt:${SESSION}#${TS1}#tmct`, object: visitorId,
      subjectLabel: "helper is called by app/lib/b.mjs.", objectLabel: "who calls helper?",
    });
    const said = m.objectProperties.find((g) => g.prop === SAID_IN_SESSION_PROP);
    assert.equal(said.count, 2);
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
    assert.match(id, /^fact:[0-9a-f]{8}$/);

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

test("emptyMemory: distinct from source.mjs's provider bootstrap — memory-marked, never bootstrap-marked", () => {
  const m = emptyMemory();
  assert.equal(m.memory, true);
  assert.equal(m.bootstrap, undefined, "not a provider payload");
});
