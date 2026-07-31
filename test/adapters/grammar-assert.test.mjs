// grammar/assert.mjs tests — the grammar→memory bridge: parsed sentences land
// as reified Fact individuals in .tmct/memory/graph.json (normFactTerm-
// normalized terms, provenance tagged and unioned), survive reload via
// loadMemory, and misses/residues write NOTHING.
import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertSentence as assertSentenceSeam, provenanceTag } from "../../src/domain/grammar/assert.mjs";
import { loadLexicon } from "../../src/domain/grammar/lexicon.mjs";
import { FACT_CLASS, MEMORY_DIR_REL, appendFact, factGroupId, loadMemory, normFactTerm, readFactRows } from "../../src/adapters/memory/core.mjs";

// assertSentence takes the store's writer injected; every call in this file
// wires the real memory/core.mjs appendFact once here.
const assertSentence = (dir, sentence, opts = {}) => assertSentenceSeam(dir, sentence, { appendFact, ...opts });
import { parseEntities } from "../../src/domain/codegraph.mjs";

const SESSION = "01890000-0000-7000-8000-00000000abcd";
const TS = "2026-07-04T09:00:00.000Z";
const PROV = { source: "chat", sessionId: SESSION, ts: TS };

const attr = (ind, key) => (ind?.attributes || []).find((a) => a.key === key)?.value;
const tmpRepo = () => mkdtemp(join(tmpdir(), "tmct-grammar-assert-"));

test("provenanceTag: deterministic compact tag; bare default is ace:chat", () => {
  assert.equal(provenanceTag(PROV), `ace:chat:${SESSION}@${TS}`);
  assert.equal(provenanceTag({ source: "corpus" }), "ace:corpus");
  assert.equal(provenanceTag(), "ace:chat");
});

test("assertSentence: a subclass sentence lands as one Fact, normFactTerm-normalized, and survives reload", async () => {
  const dir = await tmpRepo();
  try {
    const r = await assertSentence(dir, "every module is a unit", { provenance: PROV });
    assert.equal(r.pattern, "subClassOf");
    assert.equal(r.ids.length, 1);
    assert.match(r.ids[0], /^fact:[0-9a-f]{16}$/);

    const m = await loadMemory(dir);
    const facts = m.individuals.filter((i) => i.class === FACT_CLASS);
    assert.equal(facts.length, 1);
    // terms read back NORMALIZED (tmct: prefix stripped, lowercased); predicate keeps its casing
    assert.equal(attr(facts[0], "subject"), normFactTerm("tmct:module"));
    assert.equal(attr(facts[0], "subject"), "module");
    assert.equal(attr(facts[0], "predicate"), "rdfs:subClassOf");
    assert.equal(attr(facts[0], "object"), "unit");
    assert.equal(attr(facts[0], "provenance"), `ace:chat:${SESSION}@${TS}`);

    // the store is a real graph: parseEntities loads it and the fact is
    // queryable. assertSentence reports the PUBLIC fact id — the group — while
    // the node holding it is that group's one assertion record.
    const g = parseEntities(m);
    assert.ok([...g.byId.keys()].some((k) => factGroupId(k) === r.ids[0]));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("assertSentence: a multi-triple restriction sentence lands one Fact per triple, same order", async () => {
  const dir = await tmpRepo();
  try {
    const r = await assertSentence(dir, "every module that imports a database is a service", { provenance: PROV });
    assert.equal(r.pattern, "someValuesFrom");
    assert.equal(r.ids.length, r.triples.length);
    assert.equal(r.ids.length, 6);

    const m = await loadMemory(dir);
    const facts = m.individuals.filter((i) => i.class === FACT_CLASS);
    assert.equal(facts.length, 6);
    const byId = new Map(facts.map((f) => [factGroupId(f.id), f]));
    r.triples.forEach((t, i) => {
      const f = byId.get(r.ids[i]);
      assert.equal(attr(f, "subject"), normFactTerm(t.subject), `triple ${i} subject`);
      assert.equal(attr(f, "predicate"), t.predicate, `triple ${i} predicate keeps vocabulary casing`);
      assert.equal(attr(f, "object"), normFactTerm(t.object), `triple ${i} object`);
    });
    // spot-check the restriction landed queryably: onProperty → "imports"
    const onProp = facts.find((f) => attr(f, "predicate") === "owl:onProperty");
    assert.equal(attr(onProp, "subject"), "some-imports-database");
    assert.equal(attr(onProp, "object"), "imports");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("assertSentence: re-assert upserts (same ids, no duplicates); a second writer's provenance unions", async () => {
  const dir = await tmpRepo();
  try {
    const a = await assertSentence(dir, "tmct's license is MPL-2.0", { provenance: PROV });
    const b = await assertSentence(dir, "TMCT's  license is MPL-2.0.", { provenance: { source: "corpus" } });
    assert.deepEqual(b.ids, a.ids, "case/whitespace variants converge on the same fact id");

    const m = await loadMemory(dir);
    const facts = m.individuals.filter((i) => i.class === FACT_CLASS);
    assert.equal(facts.length, 2, "one record per asserting source, both under the one fact id");
    assert.equal(new Set(facts.map((f) => factGroupId(f.id))).size, 1, "upsert, never a duplicate triple");
    assert.equal(attr(facts[0], "subject"), "tmct");
    assert.equal(attr(facts[0], "predicate"), "tmct:license");
    assert.equal(attr(facts[0], "object"), normFactTerm("MPL-2.0"));
    // Each record carries only its own writer's tag; the union is synthesized
    // over the group at read time, codepoint-sorted.
    assert.deepEqual(
      facts.map((f) => attr(f, "provenance")).sort(),
      [`ace:chat:${SESSION}@${TS}`, "ace:corpus"].sort(),
    );
    const [row] = readFactRows(m);
    assert.equal(row.provenance, `ace:chat:${SESSION}@${TS} | ace:corpus`, "provenance unions across writers");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("assertSentence: a grammar miss returns null and writes NOTHING (no .tmct dir appears)", async () => {
  const dir = await tmpRepo();
  try {
    assert.equal(await assertSentence(dir, "most modules are tested", { provenance: PROV }), null);
    await assert.rejects(() => access(join(dir, MEMORY_DIR_REL)), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("assertSentence: unknown words return the residue parse with empty ids and write NOTHING", async () => {
  const dir = await tmpRepo();
  try {
    const r = await assertSentence(dir, "every widget is a gadget", { provenance: PROV });
    assert.equal(r.pattern, "subClassOf");
    assert.deepEqual(r.residue, ["widget", "gadget"]);
    assert.deepEqual(r.ids, []);
    await assert.rejects(() => access(join(dir, MEMORY_DIR_REL)), { code: "ENOENT" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("assertSentence: an observedAt option passes through to every appended triple's mgx:observedAt", async () => {
  const dir = await tmpRepo();
  try {
    const r = await assertSentence(dir, "every module is a unit", { provenance: PROV, observedAt: "2019-03-01T00:00:00.000Z" });
    const m = await loadMemory(dir);
    const [fact] = m.individuals.filter((i) => i.class === FACT_CLASS);
    assert.equal(attr(fact, "observedAt"), "2019-03-01T00:00:00.000Z");
    const [row] = readFactRows(m);
    assert.equal(row.assertions[0].observedAt, "2019-03-01T00:00:00.000Z");
    assert.equal(row.id, r.ids[0]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("assertSentence: no observedAt option stores no mgx:observedAt at all — never fabricated", async () => {
  const dir = await tmpRepo();
  try {
    await assertSentence(dir, "every module is a unit", { provenance: PROV });
    const m = await loadMemory(dir);
    const [fact] = m.individuals.filter((i) => i.class === FACT_CLASS);
    assert.equal(attr(fact, "observedAt"), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("assertSentence: honors a caller-extended lexicon end-to-end", async () => {
  const dir = await tmpRepo();
  try {
    const lexicon = loadLexicon({ properNames: ["Seonix"], nouns: { provider: {} } });
    const r = await assertSentence(dir, "Seonix is a provider", { lexicon, provenance: { source: "chat" } });
    assert.equal(r.pattern, "typeAssertion");
    const m = await loadMemory(dir);
    const fact = m.individuals.find((i) => i.class === FACT_CLASS);
    assert.equal(attr(fact, "subject"), "seonix", "proper name reads back normFactTerm-lowercased");
    assert.equal(attr(fact, "predicate"), "rdf:type");
    assert.equal(attr(fact, "object"), "provider");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
