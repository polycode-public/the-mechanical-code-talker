// The learn-on-miss chat lane over the CHILD triples pack: the same
// cleanest-miss gate the reference hook uses, consulted FIRST — a hit appends
// the term's triples under child provenance and the question is re-answered
// from the store; a pack miss falls through to the reference article; both
// missing leaves the honest miss byte-identical. The negatives are the
// load-bearing half — each proves the pack is never even consulted (a spy
// provider counts lookups).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runTurn } from "../../src/services/chat.mjs";
import { loadMemory, readFactRows, appendRule, appendFact } from "../../src/adapters/memory/core.mjs";
import { registerChildPackProvider, clearChildPackCache } from "../../src/adapters/corpus/child-pack.mjs";
import { registerReferencePackProvider } from "../../src/adapters/corpus/reference-pack.mjs";

const CHILD_FIXTURE = fileURLToPath(new URL("../fixtures/child-pack", import.meta.url));
const REFERENCE_FIXTURE = fileURLToPath(new URL("../fixtures/reference-pack", import.meta.url));

const fixtureEnv = {
  TMCT_CHILD_PACK_DIR: CHILD_FIXTURE,
  TMCT_REFERENCE_PACK_DIR: REFERENCE_FIXTURE,
};

async function freshRepo() {
  return mkdtemp(join(tmpdir(), "tmct-child-lane-"));
}

async function turn(line, { memoryDir, env = fixtureEnv, last = null } = {}) {
  return runTurn(line, { config: null, memoryDir, env, last });
}

const factLines = async (dir) => readFactRows(await loadMemory(dir))
  .map((f) => `${f.subject} ${f.predicate} ${f.object} [${f.provenance}]`);

/** A provider that counts every lookup and never answers — registered so a
 *  negative can prove the pack was not consulted at all. */
function spyProvider() {
  const spy = { calls: 0, lookup: async () => { spy.calls += 1; return null; } };
  return spy;
}

test("a clean miss on a child-pack term appends its triples and answers from the store, cited", async () => {
  const dir = await freshRepo();
  try {
    const r = await turn("what is a robin", { memoryDir: dir });
    assert.match(r.answer, /robin can fly \(source: child:conceptnet:robin\)/);
    assert.match(r.answer, /robin is a kind of bird \(source: child:conceptnet:robin\)/);
    assert.equal(r.record.via, "fact", "the answer is served from memory, not rendered pack prose");
    assert.equal(r.record.miss, false);
    const stored = await factLines(dir);
    assert.ok(stored.includes("robin mgx:capableOf fly [child:conceptnet:robin]"), "the capability triple lands");
    assert.ok(stored.includes("robin rdfs:subClassOf bird [child:conceptnet:robin]"), "the isa triple lands");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the second ask answers from memory without another pack lookup", async () => {
  const dir = await freshRepo();
  const row = {
    term: "robin",
    facts: [
      { subject: "robin", predicate: "mgx:capableOf", object: "fly" },
      { subject: "robin", predicate: "rdfs:subClassOf", object: "bird" },
    ],
  };
  const spy = { calls: 0, lookup: async () => { spy.calls += 1; return row; } };
  registerChildPackProvider(spy);
  try {
    const first = await turn("what is a robin", { memoryDir: dir });
    assert.match(first.answer, /robin is a kind of bird/);
    const second = await turn("what is a robin", { memoryDir: dir, last: first.last });
    assert.match(second.answer, /robin is a kind of bird \(source: child:conceptnet:robin\)/);
    assert.equal(spy.calls, 1, "the stored facts block the gate, so the pack is read once");
  } finally {
    registerChildPackProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("a child-pack load auto-synthesises: the new isa connects to a remembered superclass, deriving an entailed fact", async () => {
  const dir = await freshRepo();
  // remembered: a bird is an animal. The child pack will teach robin -> bird.
  await appendFact(dir, { subject: "bird", predicate: "rdfs:subClassOf", object: "animal", provenance: "teach:chat:seed@2026-01-01T00:00:00.000Z" });
  const row = { term: "robin", facts: [{ subject: "robin", predicate: "rdfs:subClassOf", object: "bird" }] };
  registerChildPackProvider({ lookup: async () => row });
  try {
    await turn("what is a robin", { memoryDir: dir });
    const rows = readFactRows(await loadMemory(dir));
    const entailed = rows.find((f) => f.subject === "robin" && f.object === "animal");
    assert.ok(entailed, "the transitive robin -> animal is materialised after the load");
    assert.match(entailed.provenance, /^entailed:/, "the derived fact carries entailed provenance, retractable and low-trust");
  } finally {
    registerChildPackProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("a taught rule that owns the term outranks the child pack: the load is declined, not answered from conceptnet", async () => {
  const dir = await freshRepo();
  await appendRule(dir, { name: "robin", kind: "compose2", slots: { base1: "parent", base2: "parent" } });
  const spy = { calls: 0, lookup: async () => { spy.calls += 1; return { term: "robin", facts: [{ subject: "robin", predicate: "rdfs:subClassOf", object: "bird" }] }; } };
  registerChildPackProvider(spy);
  try {
    const r = await turn("what is a robin", { memoryDir: dir });
    assert.equal(spy.calls, 0, "the user's own taught concept blocks the pack load entirely");
    assert.ok(!(await factLines(dir)).some((l) => /child:conceptnet:robin/.test(l)), "no conceptnet content is pulled over the taught rule");
  } finally {
    registerChildPackProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("the bare form 'what is robin' reaches the child pack under the same gate", async () => {
  const dir = await freshRepo();
  try {
    const r = await turn("what is robin", { memoryDir: dir });
    assert.match(r.answer, /robin is a kind of bird \(source: child:conceptnet:robin\)/);
    assert.equal(r.record.via, "fact");
    assert.equal(r.record.miss, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("triples outrank prose: with both packs able to answer, the child facts speak and the article is never consulted", async () => {
  const dir = await freshRepo();
  const refSpy = spyProvider();
  registerReferencePackProvider(refSpy);
  try {
    const r = await turn("what is a robin", { memoryDir: dir });
    assert.match(r.answer, /child:conceptnet:robin/);
    assert.doesNotMatch(r.answer, /reference article/);
    assert.equal(refSpy.calls, 0, "the article hook never runs once the store answers");
  } finally {
    registerReferencePackProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("a child-pack miss falls through to the reference article, cited exactly as before", async () => {
  const dir = await freshRepo();
  try {
    const r = await turn("what is an otter", { memoryDir: dir });
    assert.match(r.answer, /^otter — An otter is an animal/);
    assert.match(r.answer, /\(source: reference article "Otter"/);
    assert.equal(r.record.via, "reference");
    assert.doesNotMatch(r.answer, /child:conceptnet/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an unknown word never consults the child pack, and the teach offer stands", async () => {
  const dir = await freshRepo();
  const spy = spyProvider();
  registerChildPackProvider(spy);
  try {
    const r = await turn("what is a zorblatt", { memoryDir: dir });
    assert.equal(spy.calls, 0, "a non-lexicon word is not a clean miss");
    assert.equal(r.record.miss, true);
    assert.match(r.answer, /I don't know "zorblatt" yet — teach me directly/);
    assert.deepEqual(await factLines(dir), [], "no fact is appended on the miss path");
  } finally {
    registerChildPackProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("a parse miss with no definition-shaped term never consults the child pack", async () => {
  const dir = await freshRepo();
  const spy = spyProvider();
  registerChildPackProvider(spy);
  try {
    const r = await turn("wibble the wobble sideways maybe?", { memoryDir: dir });
    assert.equal(spy.calls, 0, "no metaTermOf shape means no pack lookup");
    assert.equal(r.record.miss, true);
    assert.deepEqual(await factLines(dir), [], "no fact is appended on the miss path");
  } finally {
    registerChildPackProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("a relation term keeps its established answer and never consults the child pack", async () => {
  const dir = await freshRepo();
  const spy = spyProvider();
  registerChildPackProvider(spy);
  try {
    await turn("what is imports", { memoryDir: dir });
    assert.equal(spy.calls, 0, "a RELATION_TERM touch is not a clean vocabulary miss");
  } finally {
    registerChildPackProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("a taught fact wins: the fact lane answers and the child pack is never consulted", async () => {
  const dir = await freshRepo();
  const spy = spyProvider();
  try {
    const taught = await turn("every robin is a bird", { memoryDir: dir });
    assert.match(taught.answer, /robin rdfs:subClassOf bird/);
    registerChildPackProvider(spy);
    const r = await turn("what is a robin", { memoryDir: dir });
    assert.equal(spy.calls, 0, "a remembered fact about the term blocks the gate");
    assert.match(r.answer, /robin is a kind of bird/);
    assert.doesNotMatch(r.answer, /child:conceptnet/);
  } finally {
    registerChildPackProvider(null);
    await rm(dir, { recursive: true, force: true });
  }
});

test("an absent child pack leaves the turn byte-identical to a pack that misses the term", async () => {
  clearChildPackCache();
  const dirA = await freshRepo();
  const dirB = await freshRepo();
  const noRef = { TMCT_REFERENCE_PACK_DIR: "/nonexistent-reference-pack" };
  try {
    const absent = await turn("what is a badger", {
      memoryDir: dirA, env: { ...noRef, TMCT_CHILD_PACK_DIR: "/nonexistent-child-pack" },
    });
    const missing = await turn("what is a badger", {
      memoryDir: dirB, env: { ...noRef, TMCT_CHILD_PACK_DIR: CHILD_FIXTURE },
    });
    assert.equal(absent.answer, missing.answer, "the answer is byte-identical either way");
    assert.equal(absent.record.miss, true);
    assert.deepEqual(await factLines(dirA), [], "no fact is appended when the pack is absent");
    assert.deepEqual(await factLines(dirB), [], "no fact is appended when the term is not in the pack");
  } finally {
    clearChildPackCache();
    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  }
});
