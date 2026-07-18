// The learn-on-miss chat lane over the reference pack: only the CLEANEST
// miss reaches the pack — a definition-shaped, lexicon-known term with no
// graph entity and no remembered fact. A hit answers with the article's
// summary, always cited, records no miss, and stores the article's isa as a
// subClassOf fact with reference provenance so the next ask answers from
// memory. Every other miss class leaves the turn byte-identical: unknown
// word, parse miss, relation term, taught term, curated corpus term. The
// negatives are the load-bearing half — each proves the pack is never even
// consulted (a spy provider counts lookups).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runTurn } from "../../src/services/chat.mjs";
import { appendFact, loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";
import { registerReferencePackProvider, clearReferencePackCache } from "../../src/adapters/corpus/reference-pack.mjs";

const FIXTURE_PACK = fileURLToPath(new URL("../fixtures/reference-pack", import.meta.url));

async function freshRepo() {
  return mkdtemp(join(tmpdir(), "tmct-ref-lane-"));
}

// The child pack is pinned absent: these tests exercise the REFERENCE hook in
// isolation, and a fixture term the shipped child pack also carries (falcon)
// would otherwise be answered from triples before the article ever speaks.
const fixtureEnv = { TMCT_REFERENCE_PACK_DIR: FIXTURE_PACK, TMCT_CHILD_PACK_DIR: "/nonexistent-child-pack" };

async function turn(line, { memoryDir, env = fixtureEnv, last = null } = {}) {
  return runTurn(line, { config: null, memoryDir, env, last });
}

const factLines = async (dir) => readFactRows(await loadMemory(dir))
  .map((f) => `${f.subject} ${f.predicate} ${f.object}`);

/** A provider that counts every lookup and never answers — registered so a
 *  negative can prove the pack was not consulted at all. */
function spyProvider() {
  const spy = { calls: 0, lookup: async () => { spy.calls += 1; return null; } };
  return spy;
}

test("a clean miss on a pack term answers from the article, cited, and records no miss", async () => {
  const dir = await freshRepo();
  try {
    const r = await turn("what is an otter", { memoryDir: dir });
    assert.match(r.answer, /^otter — An otter is an animal/);
    assert.match(r.answer, /\(source: reference article "Otter", Simple English Wikipedia, CC BY-SA 4\.0 — https:\/\/simple\.wikipedia\.org\/wiki\/Otter\?oldid=9184482\)/);
    assert.equal(r.record.via, "reference");
    assert.equal(r.record.miss, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the article's isa lands as a subClassOf fact with reference provenance, and the second ask answers from memory citing it", async () => {
  const dir = await freshRepo();
  try {
    const first = await turn("what is an otter", { memoryDir: dir });
    const rows = readFactRows(await loadMemory(dir));
    const stored = rows.find((f) => f.subject === "otter" && f.predicate === "rdfs:subClassOf" && f.object === "animal");
    assert.ok(stored, "the isa fact is stored");
    assert.match(stored.provenance, /reference:simplewiki:Otter@9184482/);
    const second = await turn("what is an otter", { memoryDir: dir, last: first.last });
    assert.equal(second.record.via, "fact", "the second ask answers from memory, not the pack");
    assert.match(second.answer, /otter is a kind of animal/);
    assert.match(second.answer, /source: reference:simplewiki:Otter@9364353|source: reference:simplewiki:Otter@9184482/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the bare form 'what is otter' reaches the pack under the same gate", async () => {
  const dir = await freshRepo();
  try {
    const r = await turn("what is otter", { memoryDir: dir });
    assert.match(r.answer, /^otter — An otter is an animal/);
    assert.match(r.answer, /\(source: reference article "Otter"/);
    assert.equal(r.record.via, "reference");
    assert.equal(r.record.miss, false);
    assert.ok((await factLines(dir)).includes("otter rdfs:subClassOf animal"), "the bare form stores the isa fact too");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an article with no isa answers cited and stores nothing", async () => {
  const dir = await freshRepo();
  try {
    const r = await turn("what is a falcon", { memoryDir: dir });
    assert.equal(r.record.via, "reference");
    assert.match(r.answer, /\(source: reference article "Falcon"/);
    assert.deepEqual(await factLines(dir), [], "no fact is appended when the article carries no isa");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unknown word never consults the pack, and the teach offer stands", async () => {
  const dir = await freshRepo();
  const spy = spyProvider();
  registerReferencePackProvider(spy);
  try {
    const r = await turn("what is a zorblatt", { memoryDir: dir });
    assert.equal(spy.calls, 0, "the pack is never consulted for a non-lexicon word");
    assert.equal(r.record.miss, true);
    assert.match(r.answer, /I don't know "zorblatt" yet — teach me directly/);
    assert.deepEqual(await factLines(dir), [], "no fact is appended on the miss path");
  } finally {
    registerReferencePackProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("a parse miss with no definition-shaped term never consults the pack", async () => {
  const dir = await freshRepo();
  const spy = spyProvider();
  registerReferencePackProvider(spy);
  try {
    const r = await turn("wibble the wobble sideways maybe?", { memoryDir: dir });
    assert.equal(spy.calls, 0, "no metaTermOf shape means no pack lookup");
    assert.equal(r.record.miss, true);
    assert.deepEqual(await factLines(dir), [], "no fact is appended on the miss path");
  } finally {
    registerReferencePackProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("a relation term keeps its established answer and never consults the pack", async () => {
  const dir = await freshRepo();
  const spy = spyProvider();
  registerReferencePackProvider(spy);
  try {
    await turn("what is imports", { memoryDir: dir });
    assert.equal(spy.calls, 0, "a RELATION_TERM touch is not a clean vocabulary miss");
  } finally {
    registerReferencePackProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("a taught fact wins: the fact lane answers and the pack is never consulted", async () => {
  const dir = await freshRepo();
  const spy = spyProvider();
  try {
    const taught = await turn("every otter is a bird", { memoryDir: dir });
    assert.match(taught.answer, /otter is a kind of bird/);
    registerReferencePackProvider(spy);
    const r = await turn("what is an otter", { memoryDir: dir });
    assert.equal(spy.calls, 0, "a remembered fact about the term blocks the pack gate");
    assert.match(r.answer, /otter is a kind of bird/);
    assert.doesNotMatch(r.answer, /reference article/);
  } finally {
    registerReferencePackProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("a curated SEON definition wins over the pack for its own terms", async () => {
  const dir = await freshRepo();
  const spy = spyProvider();
  try {
    await appendFact(dir, { subject: "cache", predicate: "rdfs:subClassOf", object: "component", provenance: "corpus:seon" });
    registerReferencePackProvider(spy);
    const r = await turn("what is a cache", { memoryDir: dir });
    assert.match(r.answer, /\(source: corpus\/seon\)/);
    assert.equal(spy.calls, 0, "the curated definition answers before the pack gate is reached");
  } finally {
    registerReferencePackProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("an absent pack leaves the turn byte-identical to a pack that misses the term", async () => {
  clearReferencePackCache();
  const dirA = await freshRepo();
  const dirB = await freshRepo();
  try {
    // "meadow" is in the fixture pack, "harvest" is not — both runs below ask
    // for a lexicon noun the pack cannot answer, one because the dir does not
    // exist, one because the term has no article. Identical bytes prove the
    // fallback path never leaks a trace of the failed lookup.
    const absent = await turn("what is a harvest", { memoryDir: dirA, env: { TMCT_REFERENCE_PACK_DIR: "/nonexistent-reference-pack", TMCT_CHILD_PACK_DIR: "/nonexistent-child-pack" } });
    const missing = await turn("what is a harvest", { memoryDir: dirB, env: fixtureEnv });
    assert.equal(absent.answer, missing.answer, "the answer is byte-identical either way");
    assert.equal(absent.record.miss, true);
    assert.deepEqual(await factLines(dirA), [], "no fact is appended when the pack is absent");
    assert.deepEqual(await factLines(dirB), [], "no fact is appended when the term is not in the pack");
  } finally {
    clearReferencePackCache();
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  }
});
