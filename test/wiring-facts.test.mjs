// W4 seam tests — asserted Facts → answers (ROADMAP Phase 4).
//
//   - assert-then-ask round-trip in a session: "every module is a component" →
//     "is a module a component" answers YES from the remembered fact, cited with
//     its ace:chat provenance verbatim; "what is a module" answers from the same
//     fact when schema-docs has nothing;
//   - corpus-seeded facts (the W3 seed) answer "what is a cache?"-style
//     vocabulary questions, cited corpus:conceptnet;
//   - a schema-docs hit is EXTENDED (fact lines appended), never replaced;
//   - no-fact questions stay byte-unchanged honest misses.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn } from "../src/chat.mjs";
import { appendFact, loadMemory, readFactRows } from "../src/memory/core.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import { ingestSchemaDocs } from "../src/schema-docs.mjs";
import { clearCache } from "../src/source.mjs";
import { freshConceptNetRepo } from "./helpers/seeded-fixture.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };
// The loaded graph lets the class↔instance bridge walk the inherits chain.
const GRAPH = parseEntities(JSON.parse(readFileSync(FIXTURE, "utf8")));

test("W4: assert-then-ask round-trip — the remembered fact answers, provenance verbatim", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-w4-roundtrip-"));
  try {
    const asserted = await runTurn("every module is a component", {
      config: CONFIG, memoryDir: dir, sessionId: "w4-session",
    });
    assert.match(asserted.answer, /noted — remembered 1 fact/);
    assert.equal(asserted.record.via, "assert");

    const yesNo = await runTurn("is a module a component", { config: CONFIG, memoryDir: dir });
    assert.match(yesNo.answer, /^yes — you told me: module is a kind of component \(source: ace:chat:w4-session@/);
    assert.equal(yesNo.record.via, "fact");
    assert.equal(yesNo.record.miss, false);

    // the definition form answers from the same fact (no schema docs in the raw fixture)
    const whatIs = await runTurn("what is a module", { config: CONFIG, memoryDir: dir });
    assert.match(whatIs.answer, /^you told me: module is a kind of component \(source: ace:chat:/);
    assert.equal(whatIs.record.via, "fact");
    assert.equal(whatIs.record.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("W4: corpus-seeded facts (the W3 seed) answer vocabulary questions, cited to the corpus", async () => {
  // Shared fixture (test/helpers/seeded-fixture.mjs): the corpus parse+write is
  // the expensive part and doesn't change between runs (content-addressed,
  // deterministic), so it's built ONCE per process and copied here — this test
  // only cares that the resulting facts answer vocabulary questions, not that
  // THIS call is the one that performed the seed.
  const { dir, seedResult: res } = await freshConceptNetRepo("tmct-w4-corpus-");
  try {
    // the ConceptNet band of the W3 bootstrap — now UNCAPPED (0.7.0 "seed all"), so
    // res.appended is the whole seedable slice (thousands), not a finite cap.
    assert.ok(res.appended > 1000, `the whole ConceptNet band seeds uncapped (got ${res.appended})`);
    const config = { graphFile: join(dir, ".tmct", "graph.json") }; // empty bootstrap graph

    // Rendered as clean data + provenance — the "i learned:" prefix was dropped in 0.7.0
    // (an anthropomorphism; corpus facts are just facts). Provenance stays verbatim.
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

test("W4: a schema-docs hit is EXTENDED by remembered facts, not replaced", async () => {
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

// ---- 0.8.2 teach-lane widening + the class↔instance bridge ----

test("teach: 'remember that <X> is <adjective>' reifies mgx:hasProperty with teach provenance + trust prior", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-teach-prop-"));
  try {
    const taught = await runTurn("remember that saveStore is deprecated", {
      config: CONFIG, memoryDir: dir, sessionId: "t-prop",
    });
    assert.match(taught.answer, /noted — remembered: savestore is deprecated/i);
    assert.equal(taught.record.via, "assert");
    assert.equal(taught.record.miss, false);

    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 1, "exactly one fact stored");
    assert.equal(rows[0].subject, "savestore");
    assert.equal(rows[0].predicate, "mgx:hasProperty");
    assert.equal(rows[0].object, "deprecated");
    assert.match(rows[0].provenance, /^teach:chat:t-prop@/, "distinct teach:chat provenance tag");
    assert.deepEqual(rows[0].sourceTypes, ["teach"], "a first-class teach Source");
    assert.ok(rows[0].trust >= 0.9 && rows[0].trust < 1, `teach trust prior applied (got ${rows[0].trust})`);

    // read-back surfaces the fact WITH its source receipt
    const know = await runTurn("what do you know about saveStore", { config: CONFIG, memoryDir: dir });
    assert.match(know.answer, /you told me: savestore is deprecated \(source: teach:chat:t-prop@/);
    assert.equal(know.record.via, "fact");
    assert.equal(know.record.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("teach: a BARE 'X is <unrecognized word>' with a KNOWN subject (no remember/note wrapper) is still never silently reified", async () => {
  // 'module' IS a declared lexicon noun (so it never reaches the unknown-SUBJECT
  // free pass, Feature A point 2's bare-property extension) and 'banana' is
  // neither a declared noun nor a declared adjective — the ACE grammar itself
  // declines too, so this stays an honest miss exactly as before this feature.
  // (NOTE: a known subject bare-paired with a KNOWN adjective, e.g. "module is
  // deprecated", already stores via the ACE grammar's OWN bare adjective-copula
  // pattern — pattern 8's copula arm, grammar/ace.mjs — which is pre-existing,
  // unrelated to Feature A, and out of scope here.)
  const dir = await mkdtemp(join(tmpdir(), "tmct-teach-bare-"));
  try {
    const bare = await runTurn("module is banana", { config: CONFIG, memoryDir: dir, sessionId: "t-bare" });
    assert.doesNotMatch(bare.answer, /noted — remembered/i, "not swallowed into memory");
    assert.equal(bare.record.miss, true, "still an honest (teach-miss) turn");
    assert.equal(readFactRows(await loadMemory(dir)).length, 0, "nothing stored");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("teach (Feature A): a BARE 'X is deprecated' with an UNKNOWN subject now stores too — the same free pass the class-membership shape gets, reusing mgx:hasProperty", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-teach-bare-unknown-"));
  try {
    const bare = await runTurn("saveStore is deprecated", { config: CONFIG, memoryDir: dir, sessionId: "t-bare-unk" });
    assert.match(bare.answer, /noted — remembered: savestore is deprecated/i);
    assert.equal(bare.record.miss, false, "an unknown-subject bare property teach is no longer swallowed silently");
    const rows = readFactRows(await loadMemory(dir));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].subject, "savestore");
    assert.equal(rows[0].predicate, "mgx:hasProperty");
    assert.equal(rows[0].object, "deprecated");
    assert.equal(rows[0].quantifier, "", "a property assertion is about ONE entity — never a quantifier");

    // an object that resolves as neither a known noun nor a known adjective still
    // declines honestly — the free pass is only about the SUBJECT, never the object.
    const dir2 = await mkdtemp(join(tmpdir(), "tmct-teach-bare-unknown2-"));
    try {
      const stillMiss = await runTurn("saveStore is banana", { config: CONFIG, memoryDir: dir2, sessionId: "t-bare-unk2" });
      assert.doesNotMatch(stillMiss.answer, /noted — remembered/i, "an unrecognized OBJECT is never guessed at");
      assert.equal(stillMiss.record.miss, true);
      assert.equal(readFactRows(await loadMemory(dir2)).length, 0);
    } finally {
      await rm(dir2, { recursive: true, force: true });
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("teach: '<Name> owns <X>' stores mgx:ownedBy; 'who owns <X>' reads it back, cited to the teach source", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-teach-own-"));
  try {
    const taught = await runTurn("Priya owns tasks.mjs", { config: CONFIG, memoryDir: dir, sessionId: "t-own" });
    assert.match(taught.answer, /noted — remembered: tasks\.mjs is owned by priya/i);
    assert.equal(taught.record.via, "assert");
    assert.equal(taught.record.miss, false);

    const who = await runTurn("who owns tasks.mjs", { config: CONFIG, memoryDir: dir });
    assert.match(who.answer, /you told me: tasks\.mjs is owned by priya \(source: teach:chat:t-own@/);
    assert.equal(who.record.via, "fact");
    assert.equal(who.record.miss, false);

    // "maintains" is the same frame, and the wrapped form works too
    const m = await runTurn("remember that Sam maintains src/handlers/render.mjs", {
      config: CONFIG, memoryDir: dir, sessionId: "t-own",
    });
    assert.match(m.answer, /noted — remembered: src\/handlers\/render\.mjs is owned by sam/i);
    const whoM = await runTurn("who maintains src/handlers/render.mjs", { config: CONFIG, memoryDir: dir });
    assert.match(whoM.answer, /you told me: src\/handlers\/render\.mjs is owned by sam/);

    // "what do you know about <Name>" surfaces the ownership fact from the Name side
    const know = await runTurn("what do you know about Priya", { config: CONFIG, memoryDir: dir });
    assert.match(know.answer, /you told me: tasks\.mjs is owned by priya \(source: teach:chat:t-own@/);
    assert.equal(know.record.via, "fact");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("teach: 'who owns <X>' with nothing stored stays an honest miss — never a guessed owner", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-teach-noown-"));
  try {
    const who = await runTurn("who owns billing.mjs", { config: CONFIG, memoryDir: dir, sessionId: "t-no" });
    assert.equal(who.record.miss, true);
    assert.notEqual(who.record.via, "fact");
    assert.doesNotMatch(who.answer, /is owned by/);
    assert.equal(readFactRows(await loadMemory(dir)).length, 0, "the question itself stores nothing");
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

    // the ISA ask accepts the proper-noun subject WITHOUT an article (kind keeps its article)
    // — proven by the very shape above; multi-hop walks the chain past one ancestor:
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

// ---- PLAN_INFERENCE_TESTING.md §4 stage 1: cax-sco / scm-sco LIVE chase ----
// (INF-A2's measured chat gap — INFBENCH_0.8.2.md: "chat/A2 taught-only …
// every case observed unproven"). A direct isa fact and the graph bridge both
// miss, so factReadBack chases a bounded 2-hop chain over the TAUGHT facts
// themselves, reusing syllogise.mjs's pure rule kernels live and read-only,
// and renders the two premises as a proof-chain receipt.

test("cax-sco: 'X is a C', 'every C is a D' → 'is X a D' answers YES with the 2-step chain, both premises cited", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-caxsco-"));
  try {
    await runTurn("redis.mjs is a cache", { config: CONFIG, memoryDir: dir, sessionId: "cax" });
    await runTurn("every cache is a component", { config: CONFIG, memoryDir: dir, sessionId: "cax" });
    const r = await runTurn("is redis.mjs a component", { config: CONFIG, memoryDir: dir });
    assert.match(
      r.answer,
      /^yes — redis\.mjs is a cache \(source: ace:chat:cax@.*\); cache is a kind of component \(source: ace:chat:cax@.*\); so redis\.mjs is a component$/i,
      "both premises cited, chained into one derivation",
    );
    assert.equal(r.record.via, "fact");
    assert.equal(r.record.miss, false);

    // a DIRECT one-hop taught fact still answers without the chase (unaffected)
    await runTurn("bolt.mjs is a component", { config: CONFIG, memoryDir: dir, sessionId: "cax" });
    const direct = await runTurn("is bolt.mjs a component", { config: CONFIG, memoryDir: dir });
    assert.match(direct.answer, /^yes — you told me: bolt\.mjs is a component/i);
    assert.doesNotMatch(direct.answer, /so bolt\.mjs is a component$/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("scm-sco (chat-wired): 'every N1 is a N2', 'every N2 is a N3' → 'is a N1 a N3' answers YES with the 2-step chain", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-scmsco-"));
  try {
    await runTurn("every controller is a handler", { config: CONFIG, memoryDir: dir, sessionId: "scm" });
    await runTurn("every handler is a component", { config: CONFIG, memoryDir: dir, sessionId: "scm" });
    const r = await runTurn("is a controller a component", { config: CONFIG, memoryDir: dir });
    assert.match(
      r.answer,
      /^yes — controller is a kind of handler \(source: ace:chat:scm@.*\); handler is a kind of component \(source: ace:chat:scm@.*\); so controller is a component$/i,
    );
    assert.equal(r.record.via, "fact");
    assert.equal(r.record.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("cax-sco/scm-sco chase: a chain that ISN'T there stays an honest miss — never a guessed 'yes'", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-nochase-"));
  try {
    // only ONE premise of the pair is taught — no chain to close
    await runTurn("redis.mjs is a cache", { config: CONFIG, memoryDir: dir, sessionId: "nc" });
    const r = await runTurn("is redis.mjs a component", { config: CONFIG, memoryDir: dir });
    assert.equal(r.record.miss, true, "no 'cache ⊑ component' premise — the honest miss stands");
    assert.doesNotMatch(r.answer, /^yes/i);

    // both premises taught, but for an UNRELATED target class
    await runTurn("every cache is a store", { config: CONFIG, memoryDir: dir, sessionId: "nc" });
    const unrelated = await runTurn("is redis.mjs a gizmo", { config: CONFIG, memoryDir: dir });
    assert.equal(unrelated.record.miss, true);
    assert.doesNotMatch(unrelated.answer, /^yes/i);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("W4: no-fact questions stay byte-unchanged honest misses", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-w4-nofact-"));
  try {
    // "is a zebra a mammal" (ISA_ASK_RE's own territory) is genuinely
    // untouched by memory either way.
    const withMemory1 = await runTurn("is a zebra a mammal", { config: CONFIG, memoryDir: dir });
    const bare1 = await runTurn("is a zebra a mammal", { config: CONFIG });
    assert.equal(withMemory1.answer, bare1.answer, "\"is a zebra a mammal\" unchanged");
    assert.equal(withMemory1.record.miss, true);
    assert.notEqual(withMemory1.record.via, "fact");

    // "what do you know about giraffes" — Tier-5 playtest fix (cycle 3):
    // genuinely nothing about "giraffes" anywhere in memory now gets a
    // TEACH-OFFER appended (never replacing the wall), only when memoryDir
    // exists — this is a deliberate divergence from `bare`, unlike the
    // zebra case above, which no lane in this file touches at all.
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

// ---- BUG 1 fix (2026-07-08 chat.mjs dispatch): "what is a X <predicate-phrase>"
// filters to ONLY that relation, instead of grammar.mjs's meta-whatis
// template's lazy tail swallowing the whole "X <predicate-phrase>" as one
// literal (unmatchable) term. ----

test("BUG 1: 'what is a X used for' filters to ONLY the UsedFor facts, not every relation", async () => {
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

test("BUG 1: 'what is a X <predicate>' for a known subject with NO facts under that relation is an honest, specific miss", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-bug1-predicate-empty-"));
  try {
    await appendFact(dir, { subject: "widget", predicate: "mgx:usedFor", object: "testing", provenance: "test:manual" });
    const r = await runTurn("what is a widget made of", { config: CONFIG, memoryDir: dir });
    assert.match(r.answer, /I don't have any "is made of" facts about widget/);
    // a specific, honest "no data under this relation" — not the misleading
    // generic vocabulary-wall miss ("widget made of" isn't a term...), and (like
    // every other factAnswer hit) recorded as an answered turn, not a miss.
    assert.equal(r.record.miss, false);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- PLAN_ontology-hierarchies.md §3 tracks (a)+(b) — query-time synonym
// expansion consuming the two already-parsed-but-inert resources: ConceptNet's
// /r/Synonym rows (gated ace:"none" in conceptnet-map.toml — never a memory
// FACT, but the raw slice data is real) and loadPhrasebook()'s already-parsed
// `synonyms` families (corpus/templates.mjs, parsed but never consumed until
// now). A direct term miss retries via known synonyms and, on a hit, ALWAYS
// cites the synonym term AND its licensing corpus source — never a silent
// substitution. ----

test("ontology (a): a ConceptNet /r/Synonym pair resolves a vocabulary term that had NO direct facts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-ontology-syn-"));
  try {
    // the committed slice carries a real bidirectional "argument"~"parameter"
    // /r/Synonym row (weight 2) — no fact is ever taught about "argument"
    // itself, only about its synonym "parameter".
    await appendFact(dir, {
      subject: "parameter", predicate: "rdfs:subClassOf", object: "value",
      provenance: "ace:chat:t-syn@2026-07-07T00:00:00.000Z",
    });
    // control: a direct hit on the taught term needs no synonym detour
    const direct = await runTurn("what is a parameter", { config: CONFIG, memoryDir: dir });
    assert.match(direct.answer, /^you told me: parameter is a kind of value/);
    assert.doesNotMatch(direct.answer, /known synonym/);

    // the synonym-expanded miss: "argument" has no direct facts, but its
    // known synonym "parameter" does — the source is cited, never silent.
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

test("ontology (b): a phrasebook synonym family resolves a vocabulary term that had NO direct facts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-ontology-phrasebook-"));
  try {
    // data/phrasebook/software-phrases.txt carries "~ caller, call site, consumer,
    // client" — "client" itself is neither a SEON concept nor a graph noun (a
    // genuine composed miss, unlike "module" which the concept force already
    // answers for real and must not be shadowed by an unrelated synonym).
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

test("ontology: a real concept-force answer never sprouts an unrelated synonym aside", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-ontology-nonmiss-"));
  try {
    await appendFact(dir, {
      subject: "unit", predicate: "rdfs:subClassOf", object: "artifact",
      provenance: "ace:chat:t-syn3@2026-07-07T00:00:00.000Z",
    });
    // "module" is a KNOWN, instance-bearing SEON concept over the real fixture
    // graph — conceptForceAnswer already answers it for real (via:"corpus/seon"),
    // so the synonym lane (a LAST-RESORT, only once composed/fact/corpus-seon
    // have ALL declined) must never fire even though "unit" (module's
    // phrasebook synonym) has an unrelated taught fact sitting in memory.
    const r = await runTurn("what is a module", { config: CONFIG, graph: GRAPH, memoryDir: dir });
    assert.equal(r.record.via, "corpus/seon");
    assert.doesNotMatch(r.answer, /known synonym/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("ontology: no known synonym anywhere → the honest miss stands, byte-unchanged (aside from the TEACH-OFFER)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-ontology-none-"));
  try {
    const q = "what is a zzzznonexistentword";
    const withMemory = await runTurn(q, { config: CONFIG, memoryDir: dir });
    const bare = await runTurn(q, { config: CONFIG });
    // Tier-5 playtest fix (this session): a genuinely-unknown-everywhere miss
    // now gets a TEACH-OFFER appended under the unchanged wall text, only when
    // memoryDir exists — this test's own original point (no known synonym →
    // the ontology-synonym lane never fires) is the WALL TEXT itself, which
    // stays byte-identical; the two answers now deliberately diverge only on
    // that trailing offer line.
    assert.equal(withMemory.answer.split("\n")[0], bare.answer.split("\n")[0], "the wall text itself is unchanged — no synonym lane fired");
    assert.match(withMemory.answer, /I don't know "zzzznonexistentword" yet — teach me directly/);
    assert.doesNotMatch(bare.answer, /teach me directly/, "no memoryDir -> no teach-offer (nowhere to store it)");
    assert.equal(withMemory.record.miss, true);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("ontology (a) precision follow-up: SYNONYM_DENYLIST blocks a confirmed in-domain false pair ('interpreter'~'compiler')", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-ontology-denylist-"));
  try {
    // The raw ConceptNet slice really does carry an "interpreter"~"compiler"
    // /r/SimilarTo row that survives the single-word-alpha heuristic filter —
    // but the two are NOT interchangeable (different execution strategies),
    // the exact "confidently wrong within the domain" failure this codebase's
    // ground rules treat as worse than an honest miss (a follow-up precision
    // spot check over the already-shipped ontology tracks a+b, PLAN
    // §3 track a's own risk note). SYNONYM_DENYLIST (chat.mjs) blocks it.
    await appendFact(dir, {
      subject: "compiler", predicate: "rdfs:subClassOf", object: "tool",
      provenance: "ace:chat:t-deny@2026-07-07T00:00:00.000Z",
    });
    const r = await runTurn("what is an interpreter", { config: CONFIG, memoryDir: dir });
    assert.equal(r.record.miss, true);
    assert.doesNotMatch(r.answer, /known synonym/);
    assert.doesNotMatch(r.answer, /compiler/);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
