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
import { runTurn, SEED_PREFER, SEED_LIMIT } from "../src/chat.mjs";
import { appendFact, loadMemory, readFactRows } from "../src/memory/core.mjs";
import { parseEntities } from "../src/codegraph.mjs";
import { seedMemory } from "../src/corpus/conceptnet.mjs";
import { ingestSchemaDocs } from "../src/schema-docs.mjs";
import { clearCache } from "../src/source.mjs";

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
  const dir = await mkdtemp(join(tmpdir(), "tmct-w4-corpus-"));
  try {
    // the ConceptNet band of the W3 bootstrap — now UNCAPPED (0.7.0 "seed all"), so
    // res.appended is the whole seedable slice (thousands), not a finite cap.
    const res = await seedMemory(dir, { limit: SEED_LIMIT, prefer: SEED_PREFER });
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

test("teach: a BARE 'X is deprecated' (no remember/note wrapper) is never silently reified", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-teach-bare-"));
  try {
    const bare = await runTurn("saveStore is deprecated", { config: CONFIG, memoryDir: dir, sessionId: "t-bare" });
    assert.doesNotMatch(bare.answer, /noted — remembered/i, "not swallowed into memory");
    assert.equal(bare.record.miss, true, "still an honest (teach-miss) turn");
    assert.equal(readFactRows(await loadMemory(dir)).length, 0, "nothing stored");
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

test("W4: no-fact questions stay byte-unchanged honest misses", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-w4-nofact-"));
  try {
    for (const q of ["is a zebra a mammal", "what do you know about giraffes"]) {
      const withMemory = await runTurn(q, { config: CONFIG, memoryDir: dir });
      const bare = await runTurn(q, { config: CONFIG });
      assert.equal(withMemory.answer, bare.answer, `"${q}" unchanged`);
      assert.equal(withMemory.record.miss, true);
      assert.notEqual(withMemory.record.via, "fact");
    }
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
