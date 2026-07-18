// Fact-answer paths that need memory rows injected at a specific provenance
// tier (appendFact), the process-shared seeded-corpus fixture, or a
// with/without-memory byte comparison — none of which the corpus lane's
// scripted-session rows can set up. The purely chat-drivable halves of the
// old wiring-facts suite live as rows in test/corpus/inference.jsonl.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn } from "../../src/services/chat.mjs";
import { appendFact } from "../../src/adapters/memory/core.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { ingestSchemaDocs } from "../../src/tools/schema-docs.mjs";
import { clearCache } from "../../src/adapters/source.mjs";
import { freshConceptNetRepo } from "../helpers/seeded-fixture.mjs";

const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };
// The loaded graph lets the class↔instance bridge walk the inherits chain.
const GRAPH = parseEntities(JSON.parse(readFileSync(FIXTURE, "utf8")));

test("corpus-seeded facts (the bootstrap seed) answer vocabulary questions, cited to the corpus", async () => {
  // Shared fixture (test/helpers/seeded-fixture.mjs): the corpus parse+write is
  // built ONCE per process and copied here — this test only cares that the
  // resulting facts answer vocabulary questions.
  const { dir, seedResult: res } = await freshConceptNetRepo("tmct-w4-corpus-");
  try {
    assert.ok(res.appended > 1000, `the whole ConceptNet band seeds uncapped (got ${res.appended})`);
    const config = { graphFile: join(dir, ".tmct", "graph.json") }; // empty bootstrap graph

    const whatIs = await runTurn("what is a cache?", { config, memoryDir: dir });
    assert.match(whatIs.answer, /^cache is a kind of \w+/);
    assert.doesNotMatch(whatIs.answer, /i learned:/, "no anthropomorphising prefix on corpus facts");
    assert.match(whatIs.answer, /\(source: corpus:conceptnet \/r\/IsA\)/, "provenance verbatim from the fact");
    assert.equal(whatIs.record.via, "fact");
    assert.equal(whatIs.record.miss, false);

    const know = await runTurn("what do you know about caches", { config, memoryDir: dir });
    assert.match(know.answer, /^\d+ remembered facts? about cache:/);
    assert.match(know.answer, /cache is a kind of/);
    assert.doesNotMatch(know.answer, /i learned:/);
    assert.equal(know.record.via, "fact");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a schema-docs hit is EXTENDED by remembered facts, not replaced", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-w4-schema-"));
  try {
    const payload = JSON.parse(await readFile(FIXTURE, "utf8"));
    ingestSchemaDocs(payload);
    await mkdir(join(dir, ".tmct"), { recursive: true });
    await writeFile(join(dir, ".tmct", "graph.json"), JSON.stringify(payload));
    await appendFact(dir, { subject: "commit", predicate: "rdfs:subClassOf", object: "artifact", provenance: "test:manual" });

    clearCache();
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    const r = await runTurn("what is a Commit", { config, memoryDir: dir });
    assert.match(r.answer, /Commit is a class in the graph's schema/, "the schema-docs answer still leads");
    assert.match(r.answer, /i learned: commit is a kind of artifact \(source: test:manual\)/, "the fact line is appended");
    assert.equal(r.record.via, "fact");
    assert.equal(r.record.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("bridge: taught vocab composes with the graph inherits chain — YES naming BOTH sources", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-bridge-"));
  try {
    // taught: widget ⊑ handler (fixture graph: Button inherits Widget inherits Base)
    await appendFact(dir, {
      subject: "widget", predicate: "rdfs:subClassOf", object: "handler",
      provenance: "teach:chat:t-bridge@2026-07-07T00:00:00.000Z",
    });
    const r = await runTurn("is Button a handler", { config: CONFIG, graph: GRAPH, memoryDir: dir });
    assert.match(r.answer,
      /yes — the code graph says Button inherits Widget, and you told me: widget is a kind of handler \(source: teach:chat:t-bridge@/i,
      "both sources named: the graph edge AND the taught fact with provenance");
    assert.equal(r.record.via, "fact");
    assert.equal(r.record.miss, false);

    // multi-hop walks the chain past one ancestor:
    await appendFact(dir, {
      subject: "base", predicate: "rdfs:subClassOf", object: "artifact",
      provenance: "teach:chat:t-bridge@2026-07-07T00:01:00.000Z",
    });
    const hop2 = await runTurn("is Button an artifact", { config: CONFIG, graph: GRAPH, memoryDir: dir });
    assert.match(hop2.answer, /yes — the code graph says Button inherits Base, and you told me: base is a kind of artifact/i);

    // no taught fact anywhere on the chain → the honest miss stands (never a guessed "no")
    const miss = await runTurn("is Button a gizmo", { config: CONFIG, graph: GRAPH, memoryDir: dir });
    assert.equal(miss.record.miss, true);
    assert.doesNotMatch(miss.answer, /^yes/i);

    // a DIRECT taught fact on the entity's own label still answers without the bridge frame
    const direct = await runTurn("is Widget a handler", { config: CONFIG, graph: GRAPH, memoryDir: dir });
    assert.match(direct.answer, /yes — you told me: widget is a kind of handler/i);
    assert.doesNotMatch(direct.answer, /the code graph says/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("'what is a X used for' filters to ONLY the UsedFor facts, not every relation", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-bug1-predicate-"));
  try {
    await appendFact(dir, { subject: "widget", predicate: "mgx:usedFor", object: "testing", provenance: "test:manual" });
    await appendFact(dir, { subject: "widget", predicate: "mgx:partOf", object: "toolkit", provenance: "test:manual" });

    const filtered = await runTurn("what is a widget used for", { config: CONFIG, memoryDir: dir });
    assert.match(filtered.answer, /widget is used for testing/);
    assert.doesNotMatch(filtered.answer, /part of/, "the partOf fact is filtered OUT, not dumped alongside");
    assert.equal(filtered.record.via, "fact");
    assert.equal(filtered.record.miss, false);

    const undifferentiated = await runTurn("what is a widget", { config: CONFIG, memoryDir: dir });
    assert.match(undifferentiated.answer, /widget is used for testing/);
    assert.match(undifferentiated.answer, /widget is part of toolkit/, "the bare (no-predicate) form still lists every relation");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("'what is a X <predicate>' for a known subject with NO facts under that relation is an honest, specific miss", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-bug1-predicate-empty-"));
  try {
    await appendFact(dir, { subject: "widget", predicate: "mgx:usedFor", object: "testing", provenance: "test:manual" });
    const r = await runTurn("what is a widget made of", { config: CONFIG, memoryDir: dir });
    assert.match(r.answer, /I don't have any "is made of" facts about widget/);
    assert.equal(r.record.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a ConceptNet /r/Synonym pair resolves a vocabulary term that had NO direct facts, source cited", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-ontology-syn-"));
  try {
    // the committed slice carries a real bidirectional "argument"~"parameter"
    // /r/Synonym row — no fact is ever taught about "argument" itself.
    await appendFact(dir, {
      subject: "parameter", predicate: "rdfs:subClassOf", object: "value",
      provenance: "ace:chat:t-syn@2026-07-07T00:00:00.000Z",
    });
    // control: a direct hit on the taught term needs no synonym detour
    const direct = await runTurn("what is a parameter", { config: CONFIG, memoryDir: dir });
    assert.match(direct.answer, /^you told me: parameter is a kind of value/);
    assert.doesNotMatch(direct.answer, /known synonym/);

    const viaSyn = await runTurn("what is an argument", { config: CONFIG, memoryDir: dir });
    assert.equal(viaSyn.record.via, "fact");
    assert.equal(viaSyn.record.miss, false);
    assert.match(viaSyn.answer,
      /^no direct facts about "argument" — showing its known synonym "parameter" \(source: corpus:conceptnet \/r\/Synonym\):/);
    assert.match(viaSyn.answer, /you told me: parameter is a kind of value/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a phrasebook synonym family resolves a vocabulary term that had NO direct facts, source cited", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-ontology-phrasebook-"));
  try {
    await appendFact(dir, {
      subject: "caller", predicate: "rdfs:subClassOf", object: "artifact",
      provenance: "ace:chat:t-syn2@2026-07-07T00:00:00.000Z",
    });
    const r = await runTurn("what is a client", { config: CONFIG, memoryDir: dir });
    assert.equal(r.record.via, "fact");
    assert.match(r.answer,
      /^no direct facts about "client" — showing its known synonym "caller" \(source: corpus:phrasebook\):/);
    assert.match(r.answer, /you told me: caller is a kind of artifact/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a real concept-force answer never sprouts an unrelated synonym aside", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-ontology-nonmiss-"));
  try {
    await appendFact(dir, {
      subject: "unit", predicate: "rdfs:subClassOf", object: "artifact",
      provenance: "ace:chat:t-syn3@2026-07-07T00:00:00.000Z",
    });
    // "module" is a KNOWN, instance-bearing SEON concept over the real fixture
    // graph — conceptForceAnswer already answers it for real, so the synonym
    // lane (a LAST RESORT) must never fire even though "unit" (module's
    // phrasebook synonym) has an unrelated taught fact sitting in memory.
    const r = await runTurn("what is a module", { config: CONFIG, graph: GRAPH, memoryDir: dir });
    assert.equal(r.record.via, "corpus/seon");
    assert.doesNotMatch(r.answer, /known synonym/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("no known synonym anywhere → the honest miss stands, byte-unchanged aside from the memory-only TEACH-OFFER", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-ontology-none-"));
  try {
    const q = "what is a zzzznonexistentword";
    const withMemory = await runTurn(q, { config: CONFIG, memoryDir: dir });
    const bare = await runTurn(q, { config: CONFIG });
    assert.equal(withMemory.answer.split("\n")[0], bare.answer.split("\n")[0], "the wall text itself is unchanged — no synonym lane fired");
    assert.match(withMemory.answer, /I don't know "zzzznonexistentword" yet — teach me directly/);
    assert.doesNotMatch(bare.answer, /teach me directly/, "no memoryDir -> no teach-offer (nowhere to store it)");
    assert.equal(withMemory.record.miss, true);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("SYNONYM_DENYLIST blocks a confirmed in-domain false pair ('interpreter'~'compiler')", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-ontology-denylist-"));
  try {
    // The raw ConceptNet slice really does carry an "interpreter"~"compiler"
    // /r/SimilarTo row that survives the single-word-alpha heuristic filter —
    // but the two are NOT interchangeable: confidently wrong within the
    // domain is worse than an honest miss.
    await appendFact(dir, {
      subject: "compiler", predicate: "rdfs:subClassOf", object: "tool",
      provenance: "ace:chat:t-deny@2026-07-07T00:00:00.000Z",
    });
    // Both shipped packs are pointed away: this test guards the synonym path,
    // and a pack article or triple set for "interpreter" would legitimately
    // answer the turn.
    const env = {
      TMCT_REFERENCE_PACK_DIR: join(dir, "no-pack-here"),
      TMCT_CHILD_PACK_DIR: join(dir, "no-pack-here"),
    };
    const r = await runTurn("what is an interpreter", { config: CONFIG, memoryDir: dir, env });
    assert.equal(r.record.miss, true);
    assert.doesNotMatch(r.answer, /known synonym/);
    assert.doesNotMatch(r.answer, /compiler/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("no-fact questions stay byte-unchanged honest misses, with and without memory", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-w4-nofact-"));
  try {
    const withMemory1 = await runTurn("is a zebra a mammal", { config: CONFIG, memoryDir: dir });
    const bare1 = await runTurn("is a zebra a mammal", { config: CONFIG });
    assert.equal(withMemory1.answer, bare1.answer, "\"is a zebra a mammal\" unchanged");
    assert.equal(withMemory1.record.miss, true);
    assert.notEqual(withMemory1.record.via, "fact");

    const withMemory2 = await runTurn("what do you know about giraffes", { config: CONFIG, memoryDir: dir });
    const bare2 = await runTurn("what do you know about giraffes", { config: CONFIG });
    assert.equal(withMemory2.answer.split("\n")[0], bare2.answer.split("\n")[0], "the wall text itself is unchanged");
    assert.match(withMemory2.answer, /I don't know "giraffes" yet — teach me directly/);
    assert.doesNotMatch(bare2.answer, /teach me directly/, "no memoryDir -> no teach-offer (nowhere to store it)");
    assert.equal(withMemory2.record.miss, true);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
