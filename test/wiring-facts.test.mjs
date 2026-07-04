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
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn, SEED_PREFER, SEED_LIMIT } from "../src/chat.mjs";
import { appendFact } from "../src/memory/core.mjs";
import { seedMemory } from "../src/corpus/conceptnet.mjs";
import { ingestSchemaDocs } from "../src/schema-docs.mjs";
import { clearCache } from "../src/source.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };

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
    // the exact seed the W3 bootstrap performs
    const res = await seedMemory(dir, { limit: SEED_LIMIT, prefer: SEED_PREFER });
    assert.equal(res.appended, SEED_LIMIT);
    const config = { graphFile: join(dir, ".tmct", "graph.json") }; // empty bootstrap graph

    const whatIs = await runTurn("what is a cache?", { config, memoryDir: dir });
    assert.match(whatIs.answer, /i learned: cache is a kind of \w+/);
    assert.match(whatIs.answer, /\(source: corpus:conceptnet \/r\/IsA\)/, "provenance verbatim from the fact");
    assert.equal(whatIs.record.via, "fact");
    assert.equal(whatIs.record.miss, false);

    const know = await runTurn("what do you know about caches", { config, memoryDir: dir });
    assert.match(know.answer, /^\d+ remembered facts? about cache:/);
    assert.match(know.answer, /i learned: cache/);
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
