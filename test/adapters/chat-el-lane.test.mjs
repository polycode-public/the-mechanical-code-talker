// Wiring the EL classifier into the ask lanes: the auto-fold hook that runs
// classifyEl beside the existing syllogise fold after a learn-on-miss load,
// the ask-lane reader that answers a class-level existential question from a
// taught or entailed someValuesFrom restriction, and the entailed:elSubsumption/
// entailed:elRestriction provenance tags reading cleanly in a cited line.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runTurn } from "../../src/services/chat.mjs";
import { loadMemory, readFactRows, appendFacts } from "../../src/adapters/memory/core.mjs";
import { registerChildPackProvider, clearChildPackCache } from "../../src/adapters/corpus/child-pack.mjs";

async function tmpRepo() {
  return mkdtemp(join(tmpdir(), "tmct-chat-el-lane-"));
}

test("the auto-fold hook EL-classifies a learn-on-miss load's chained restriction, and the ask lane reads it back citing both premises", async () => {
  const dir = await tmpRepo();
  const row = {
    term: "heart",
    facts: [
      { subject: "heart", predicate: "rdfs:subClassOf", object: "some-has-valve" },
      { subject: "some-has-valve", predicate: "owl:onProperty", object: "has" },
      { subject: "some-has-valve", predicate: "owl:someValuesFrom", object: "valve" },
      { subject: "valve", predicate: "rdfs:subClassOf", object: "flap" },
    ],
  };
  try {
    registerChildPackProvider({ lookup: async (t) => (t === "heart" ? row : null) });
    await runTurn("what is a heart", { memoryDir: dir, env: {} });
    const rows = readFactRows(await loadMemory(dir));
    const restriction = rows.find((f) => f.subject === "heart" && f.predicate === "rdfs:subClassOf" && f.object === "some-has-flap");
    assert.ok(restriction, "the auto-fold hook wrote the composed restriction");
    assert.equal(restriction.provenance, "entailed:elRestriction");

    const { answer } = await runTurn("does a heart have a flap", { memoryDir: dir, sessionId: "ask" });
    assert.match(answer, /^yes —/);
    assert.match(answer, /heart is a kind of some-has-valve/, "the immediate restriction premise is cited");
    assert.match(answer, /valve is a kind of flap/, "the chained premise is cited too");
  } finally {
    registerChildPackProvider(null);
    clearChildPackCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("the auto-fold hook writes nothing when a learn-on-miss load has no existential chain to classify", async () => {
  const dir = await tmpRepo();
  const row = { term: "dog", facts: [{ subject: "dog", predicate: "rdfs:subClassOf", object: "animal" }] };
  try {
    registerChildPackProvider({ lookup: async (t) => (t === "dog" ? row : null) });
    await runTurn("what is a dog", { memoryDir: dir, env: {} });
    const rows = readFactRows(await loadMemory(dir));
    assert.ok(!rows.some((f) => String(f.provenance || "").startsWith("entailed:el")), "nothing EL-derived to write, so nothing is written");
  } finally {
    registerChildPackProvider(null);
    clearChildPackCache();
    await rm(dir, { recursive: true, force: true });
  }
});

test("a taught someValuesFrom restriction answers a class-level existential question directly, with no classify pass needed", async () => {
  const dir = await tmpRepo();
  try {
    await runTurn("every heart has a valve", { memoryDir: dir, sessionId: "direct" });
    const { answer } = await runTurn("does a heart have a valve", { memoryDir: dir, sessionId: "direct" });
    assert.match(answer, /^yes — you told me: heart is a kind of some-has-valve \(source: ace:chat:[^)]+\)$/);
    assert.doesNotMatch(answer, /#node:/, "the stable node-id segment never reaches a rendered citation");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("/classify's entailed:elRestriction rows render cleanly in the ask lane's citation, and /memory names the provenance verbatim", async () => {
  const dir = await tmpRepo();
  try {
    await runTurn("every heart has a valve", { memoryDir: dir, sessionId: "cite" });
    await runTurn("every valve is a flap", { memoryDir: dir, sessionId: "cite" });
    await runTurn("/classify heart", { memoryDir: dir, sessionId: "cite" });

    const memory = await runTurn("/memory", { memoryDir: dir, sessionId: "cite" });
    assert.match(memory.answer, /entailed:elRestriction/, "the entailed tag names itself verbatim, unlike the operator's node-scoped tags");
    assert.doesNotMatch(memory.answer, /entailed:elRestriction#node:/);

    const { answer } = await runTurn("does a heart have a flap", { memoryDir: dir, sessionId: "cite" });
    assert.match(answer, /^yes —/);
    assert.doesNotMatch(answer, /#node:/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the class-level existential reader answers on shape alone, not the taught verb, for a stored restriction the classifier composed through a transitive role", async () => {
  const dir = await tmpRepo();
  try {
    await runTurn("every heart has a valve", { memoryDir: dir, sessionId: "chain" });
    await runTurn("every valve has a hinge", { memoryDir: dir, sessionId: "chain" });
    await runTurn("having is transitive", { memoryDir: dir, sessionId: "chain" });
    await runTurn("/classify heart", { memoryDir: dir, sessionId: "chain" });

    const { answer } = await runTurn("does a heart contain a hinge", { memoryDir: dir, sessionId: "chain" });
    assert.match(answer, /^yes —/);
    assert.match(answer, /heart is a kind of some-has-valve/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an untaught filler with nothing composed onto the subject stays an honest miss", async () => {
  const dir = await tmpRepo();
  try {
    await runTurn("every heart has a valve", { memoryDir: dir, sessionId: "miss" });
    const { answer, record } = await runTurn("does a heart have a flap", { memoryDir: dir, sessionId: "miss" });
    assert.doesNotMatch(answer, /^yes —/);
    assert.equal(record.miss, true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
