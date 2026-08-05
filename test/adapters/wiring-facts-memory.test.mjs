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

test("'list facts' enumerates the stored Facts from chat, reading each back with its provenance", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-memclass-list-"));
  try {
    await appendFact(dir, { subject: "dog", predicate: "rdfs:subClassOf", object: "animal", provenance: "ace:chat:t1@2026-07-07T00:00:00.000Z" });
    await appendFact(dir, { subject: "cat", predicate: "rdfs:subClassOf", object: "animal", provenance: "ace:chat:t2@2026-07-07T00:00:00.000Z" });
    const r = await runTurn("list facts", { config: CONFIG, memoryDir: dir });
    assert.equal(r.record.miss, false);
    assert.match(r.answer, /dog is a kind of animal/);
    assert.match(r.answer, /cat is a kind of animal/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("'list sources' reads the memory store's Source individuals, not the code graph", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-memclass-sources-"));
  try {
    await appendFact(dir, { subject: "dog", predicate: "rdfs:subClassOf", object: "animal", provenance: "ace:chat:t1@2026-07-07T00:00:00.000Z" });
    const count = await runTurn("how many sources are there", { config: CONFIG, memoryDir: dir });
    assert.equal(count.record.miss, false);
    assert.match(count.answer, /^\d+ sources?\.$/);
    const list = await runTurn("list sources", { config: CONFIG, memoryDir: dir });
    assert.equal(list.record.miss, false);
    assert.ok(list.answer.trim().length > 0);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("an empty memory meta-class lists an honest 'none stored yet', never a fabricated line", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-memclass-empty-"));
  try {
    await appendFact(dir, { subject: "dog", predicate: "rdfs:subClassOf", object: "animal", provenance: "ace:chat:t1@2026-07-07T00:00:00.000Z" });
    const r = await runTurn("list utterances", { config: CONFIG, memoryDir: dir });
    assert.equal(r.record.miss, true);
    assert.match(r.answer, /don't have any utterances stored yet/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a memory-class query with a real restrictor tail declines rather than answering a shorter question", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-memclass-restrict-"));
  try {
    await appendFact(dir, { subject: "dog", predicate: "rdfs:subClassOf", object: "animal", provenance: "ace:chat:t1@2026-07-07T00:00:00.000Z" });
    const r = await runTurn("list facts that mention widgets", { config: CONFIG, memoryDir: dir });
    assert.equal(r.record.miss, true);
    assert.match(r.answer, /won't answer as if you hadn't asked it/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("'how many animals are there' counts a taught class's members, past the quantifier lane", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-taught-count-"));
  try {
    for (const s of ["dog", "cat", "horse"]) {
      await appendFact(dir, { subject: s, predicate: "rdfs:subClassOf", object: "animal", provenance: `ace:chat:${s}@2026-07-07T00:00:00.000Z` });
    }
    const there = await runTurn("how many animals are there", { config: CONFIG, memoryDir: dir });
    assert.equal(there.record.miss, false);
    assert.match(there.answer, /^3 animals\. Say "list animals" to see them\.$/);
    const know = await runTurn("how many animals do you know", { config: CONFIG, memoryDir: dir });
    assert.match(know.answer, /^3 animals\. Say "list animals" to see them\.$/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("'list all animals' / 'list the animals' enumerate the taught members from their own trigger", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-member-list-"));
  try {
    for (const s of ["dog", "cat", "horse"]) {
      await appendFact(dir, { subject: s, predicate: "rdfs:subClassOf", object: "animal", provenance: `ace:chat:${s}@2026-07-07T00:00:00.000Z` });
    }
    for (const q of ["list all animals", "list the animals"]) {
      const r = await runTurn(q, { config: CONFIG, memoryDir: dir });
      assert.equal(r.record.miss, false, q);
      assert.match(r.answer, /dog is a kind of animal/, q);
      assert.match(r.answer, /horse is a kind of animal/, q);
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("'give me an example of a letter' and its phrasings answer with one taught member and a list pointer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-member-example-"));
  try {
    for (const s of ["a", "b", "c"]) {
      await appendFact(dir, { subject: s, predicate: "rdfs:subClassOf", object: "letter", provenance: `ace:chat:${s}@2026-07-07T00:00:00.000Z` });
    }
    for (const q of [
      "give me an example of a letter",
      "an example of a letter",
      "example of a letter",
      "name a letter",
      "what's an example of a letter",
    ]) {
      const r = await runTurn(q, { config: CONFIG, memoryDir: dir });
      assert.equal(r.record.miss, false, q);
      assert.match(r.answer, /is a kind of letter/, q);
      assert.match(r.answer, /Say "list letter" for all 3\./, q);
      // exactly one member line, not the whole enumeration
      assert.equal((r.answer.match(/is a kind of letter/g) || []).length, 1, q);
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("an example request for an untaught class declines the way the list lane does", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-member-example-miss-"));
  try {
    const r = await runTurn("name a widget", { config: CONFIG, memoryDir: dir });
    assert.equal(r.record.miss, true);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("'list letters but not greek letters' subtracts the excluded taught subclass's members", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-list-exclude-"));
  try {
    for (const s of ["vee", "double-u", "zed", "alpha", "beta"]) {
      await appendFact(dir, { subject: s, predicate: "rdfs:subClassOf", object: "letter", provenance: `ace:chat:${s}L@2026-07-07T00:00:00.000Z` });
    }
    for (const s of ["alpha", "beta"]) {
      await appendFact(dir, { subject: s, predicate: "rdfs:subClassOf", object: "greek letter", provenance: `ace:chat:${s}G@2026-07-07T00:00:00.000Z` });
    }
    const r = await runTurn("list letters but not greek letters", { config: CONFIG, memoryDir: dir });
    assert.equal(r.record.miss, false);
    assert.match(r.answer, /vee is a kind of letter/);
    assert.match(r.answer, /double-u is a kind of letter/);
    assert.match(r.answer, /zed is a kind of letter/);
    assert.doesNotMatch(r.answer, /alpha is a kind of letter/);
    assert.doesNotMatch(r.answer, /beta is a kind of letter/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("an exclusion with zero overlap still answers the full list, with an honest note rather than a silent no-op", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-list-exclude-none-"));
  try {
    for (const s of ["vee", "double-u", "zed"]) {
      await appendFact(dir, { subject: s, predicate: "rdfs:subClassOf", object: "letter", provenance: `ace:chat:${s}@2026-07-07T00:00:00.000Z` });
    }
    await appendFact(dir, { subject: "dog", predicate: "rdfs:subClassOf", object: "animal", provenance: "ace:chat:dog@2026-07-07T00:00:00.000Z" });
    const r = await runTurn("list letters but not animals", { config: CONFIG, memoryDir: dir });
    assert.equal(r.record.miss, false);
    assert.match(r.answer, /vee is a kind of letter/);
    assert.match(r.answer, /double-u is a kind of letter/);
    assert.match(r.answer, /zed is a kind of letter/);
    assert.match(r.answer, /none of the letters I know are marked as animals yet/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("an exclusion phrase naming no taught class declines rather than answering as if it weren't there", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-list-exclude-unknown-"));
  try {
    for (const s of ["a", "b", "c"]) {
      await appendFact(dir, { subject: s, predicate: "rdfs:subClassOf", object: "letter", provenance: `ace:chat:${s}@2026-07-07T00:00:00.000Z` });
    }
    const r = await runTurn("list letters excluding vowels", { config: CONFIG, memoryDir: dir });
    assert.equal(r.record.miss, true);
    assert.match(r.answer, /won't answer as if you hadn't asked it/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("'count all facts about horses' reads 'all' as a filler, not the counted noun", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-count-all-"));
  try {
    await appendFact(dir, { subject: "horse", predicate: "rdfs:subClassOf", object: "animal", provenance: "ace:chat:t1@2026-07-07T00:00:00.000Z" });
    await appendFact(dir, { subject: "horse", predicate: "mgx:eats", object: "hay", provenance: "ace:chat:t2@2026-07-07T00:00:00.000Z" });
    const r = await runTurn("count all facts about horses", { config: CONFIG, memoryDir: dir });
    assert.equal(r.record.miss, false);
    assert.match(r.answer, /^2 facts\. \(about "horses"\)$/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a code-graph count is unaffected when the same noun was also asserted as a class ('every class is a component')", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-count-defer-"));
  try {
    const payload = JSON.parse(await readFile(FIXTURE, "utf8"));
    await mkdir(join(dir, ".tmct"), { recursive: true });
    await writeFile(join(dir, ".tmct", "graph.json"), JSON.stringify(payload));
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    const graph = parseEntities(payload);
    const classCount = graph.individuals.filter((i) => i.class === "Class").length;
    await appendFact(dir, { subject: "class", predicate: "rdfs:subClassOf", object: "component", provenance: "ace:chat:t1@2026-07-07T00:00:00.000Z" });
    clearCache();
    const r = await runTurn("how many components are there", { config, graph, memoryDir: dir });
    assert.equal(r.record.miss, false);
    assert.match(r.answer, new RegExp(`^${classCount} components\\.$`), "counts the asserted class's cardinality, not the one class-level fact");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a pristine store's FIRST isa question warms to the specific closer; an unknown-term recall collapses its generic wall to the teach offer alone", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-w4-nofact-"));
  try {
    // With a store present (even an empty one), the very first "is X a Y" now
    // names the unknown subject and offers to be taught, rather than the generic
    // grammar wall. With NO store at all there is nowhere to teach to, so the
    // bare wall still stands.
    const withMemory1 = await runTurn("is a zebra a mammal", { config: CONFIG, memoryDir: dir });
    const bare1 = await runTurn("is a zebra a mammal", { config: CONFIG });
    assert.match(withMemory1.answer, /I can't confirm that — I don't know "zebra" at all yet\. If it's true, teach me: "zebra is a kind of mammal"\./);
    assert.doesNotMatch(withMemory1.answer, /couldn't parse this as a graph question/);
    assert.match(bare1.answer, /couldn't parse this as a graph question/, "no store at all -> the bare wall stands");
    assert.equal(withMemory1.record.miss, true, "still an honest miss, never a guessed answer");
    assert.notEqual(withMemory1.record.via, "fact");

    const withMemory2 = await runTurn("what do you know about giraffes", { config: CONFIG, memoryDir: dir });
    const bare2 = await runTurn("what do you know about giraffes", { config: CONFIG });
    assert.match(withMemory2.answer, /^I don't know "giraffes" yet — teach me directly/, "the generic wall collapses to the offer — one coherent miss, not a stack");
    assert.doesNotMatch(withMemory2.answer, /couldn't parse this as a graph question/);
    assert.match(bare2.answer, /couldn't parse this as a graph question/, "no memoryDir -> no teach-offer (nowhere to store it), so the wall stands");
    assert.doesNotMatch(bare2.answer, /teach me directly/);
    assert.equal(withMemory2.record.miss, true);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("teaching the fact then re-asking flips a first-turn isa miss to a cited yes — the empty-store fall-through never shadows the taught path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-w4-firstisa-teach-"));
  try {
    const first = await runTurn("is a zebra a mammal", { config: CONFIG, memoryDir: dir });
    assert.match(first.answer, /I don't know "zebra" at all yet/, "first turn: the specific closer");
    assert.equal(first.record.miss, true);

    await appendFact(dir, {
      subject: "zebra", predicate: "rdfs:subClassOf", object: "mammal",
      provenance: "teach:chat:t-firstisa@2026-07-23T00:00:00.000Z",
    });
    clearCache();
    const reask = await runTurn("is a zebra a mammal", { config: CONFIG, memoryDir: dir });
    assert.match(reask.answer, /yes — you told me: zebra is a kind of mammal \(source: teach:chat:t-firstisa@/);
    assert.equal(reask.record.miss, false);
    assert.equal(reask.record.via, "fact");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the empty-store isa fall-through is scoped: a graph-entity subject still defers, and a non-isa yes/no keeps its bail-out offer byte-identical", async () => {
  // A graph entity as the isa subject is deferred by the isa reader's own
  // graph-entity guard, so factReadBack returns null and the turn lands where it
  // did before — the fall-through only rescues plain-vocabulary subjects, never
  // starts answering (or vocab-teach-offering) a code entity.
  const gDir = await mkdtemp(join(tmpdir(), "tmct-w4-graphsubj-"));
  try {
    const g = await runTurn("is app/lib/a.mjs a component", { config: CONFIG, graph: GRAPH, memoryDir: gDir });
    assert.equal(g.record.miss, true);
    assert.doesNotMatch(g.answer, /I don't know "app\/lib\/a\.mjs" at all yet/, "a graph entity keeps its deliberate deferral, no vocab-teach offer");
  } finally {
    clearCache();
    await rm(gDir, { recursive: true, force: true });
  }

  // Control: a NON-isa shape (an adjective yes/no) never enters the isa
  // fall-through; its empty-store bail-out offer is unchanged and deterministic
  // across two independent pristine stores.
  const dirA = await mkdtemp(join(tmpdir(), "tmct-w4-ctrl-a-"));
  const dirB = await mkdtemp(join(tmpdir(), "tmct-w4-ctrl-b-"));
  try {
    const a = await runTurn("is the checkout flow deprecated", { config: CONFIG, memoryDir: dirA });
    const b = await runTurn("is the checkout flow deprecated", { config: CONFIG, memoryDir: dirB });
    assert.equal(a.answer, b.answer, "the non-isa empty-store bail-out is unchanged and deterministic");
    assert.match(a.answer, /I don't know anything about "the checkout flow" yet — teach me directly/);
  } finally {
    clearCache();
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  }
});
