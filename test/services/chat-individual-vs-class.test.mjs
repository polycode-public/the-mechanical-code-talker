// The individual-vs-class predicate choice at the teach lane: a bare
// single-token subject that reads as a named individual (readsAsIndividualName
// — a capitalized surface, a lexicon-absent word, or a plural-fold-only hit)
// stores rdf:type instead of rdfs:subClassOf. Pure-grammar cases (a
// capitalized/lowercase/quantified/articled subject through the ACE copula
// pattern directly) live in test/adapters/grammar-ace.test.mjs; this file
// covers the chat-lane paths the grammar alone doesn't reach — the bare-
// plural surface, the article-led kind-of infix, the lexicon-absent and
// hyphenated-coinage mint fallbacks, the closure/chain/count/retraction
// machinery on the read side, and the migration path for a fact taught
// before this predicate split existed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn } from "../../src/services/chat.mjs";
import { appendFacts, loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";

async function withStore(fn) {
  const dir = await mkdtemp(join(tmpdir(), "tmct-individual-vs-class-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
async function rows(dir) {
  return readFactRows(await loadMemory(dir));
}

test("a bare plural surface ('Rovers are dogs') stores the singular subject as rdfs:subClassOf, never rdf:type", async () => {
  await withStore(async (dir) => {
    const turn = await runTurn("Rovers are dogs", { memoryDir: dir, sessionId: "s1" });
    assert.match(turn.answer, /^noted — remembered/);
    const stored = await rows(dir);
    assert.ok(stored.some((f) => f.subject === "rover" && f.predicate === "rdfs:subClassOf" && f.object === "dog"));
  });
});

test("an article-led 'a X is a kind of Y' teach keeps a capitalized subject class-level, unconditionally", async () => {
  await withStore(async (dir) => {
    const turn = await runTurn("A Rover is a kind of dog.", { memoryDir: dir, sessionId: "s1" });
    assert.match(turn.answer, /^noted — remembered: rover is a kind of dog/);
    const stored = await rows(dir);
    assert.ok(stored.some((f) => f.subject === "rover" && f.predicate === "rdfs:subClassOf" && f.object === "dog"));
  });
});

test("a lexicon-absent bare subject ('fido is a dog') stores rdf:type", async () => {
  await withStore(async (dir) => {
    const turn = await runTurn("fido is a dog", { memoryDir: dir, sessionId: "s1" });
    assert.match(turn.answer, /^noted — remembered: fido is a dog\n/);
    const stored = await rows(dir);
    assert.ok(stored.some((f) => f.subject === "fido" && f.predicate === "rdf:type" && f.object === "dog"));
  });
});

test("a subject the lexicon only matches through its plural fold ('whiskers is a cat') stores rdf:type", async () => {
  await withStore(async (dir) => {
    const turn = await runTurn("whiskers is a cat", { memoryDir: dir, sessionId: "s1" });
    assert.match(turn.answer, /^noted — remembered: whiskers is a cat\n/);
    const stored = await rows(dir);
    assert.ok(stored.some((f) => f.subject === "whiskers" && f.predicate === "rdf:type" && f.object === "cat"));
  });
});

test("a hyphenated coinage subject ('groundhog-1 is a peg') stores rdf:type", async () => {
  await withStore(async (dir) => {
    const turn = await runTurn("groundhog-1 is a peg", { memoryDir: dir, sessionId: "s1" });
    assert.match(turn.answer, /^noted — remembered: groundhog-1 is a peg\n/);
    const stored = await rows(dir);
    assert.ok(stored.some((f) => f.subject === "groundhog-1" && f.predicate === "rdf:type" && f.object === "peg"));
  });
});

test("rdf:type never enters the subclass closure — a class taught 'a kind of' a named individual gains none of its types", async () => {
  await withStore(async (dir) => {
    await runTurn("Rover is a dog.", { memoryDir: dir, sessionId: "s1" });
    await runTurn("every button is a Rover", { memoryDir: dir, sessionId: "s1" });
    const answer = await runTurn("is button a dog", { memoryDir: dir, sessionId: "s1" });
    assert.doesNotMatch(answer.answer, /^yes/i, "button never inherits dog-ness through rover's own rdf:type edge");
  });
});

test("a taught individual type chains two hops through a taught class hierarchy", async () => {
  await withStore(async (dir) => {
    await runTurn("Rover is a dog.", { memoryDir: dir, sessionId: "s1" });
    await runTurn("every dog is a mammal", { memoryDir: dir, sessionId: "s1" });
    const answer = await runTurn("is Rover a mammal", { memoryDir: dir, sessionId: "s1" });
    assert.match(answer.answer, /^yes/);
    assert.match(answer.answer, /rover is a dog/);
    assert.match(answer.answer, /dog is a kind of mammal/);
  });
});

test("a taught individual counts and lists as a class member", async () => {
  await withStore(async (dir) => {
    await runTurn("Rover is a dog.", { memoryDir: dir, sessionId: "s1" });
    await runTurn("Fido is a dog.", { memoryDir: dir, sessionId: "s1" });
    const count = await runTurn("how many dogs are there", { memoryDir: dir, sessionId: "s1" });
    assert.match(count.answer, /^2 dogs\./);
    const list = await runTurn("list dogs", { memoryDir: dir, sessionId: "s1" });
    assert.match(list.answer, /rover is a dog/);
    assert.match(list.answer, /fido is a dog/);
  });
});

test("a read-back names a taught individual type with its own subclass chain", async () => {
  await withStore(async (dir) => {
    await runTurn("Rover is a dog.", { memoryDir: dir, sessionId: "s1" });
    await runTurn("every dog is a mammal", { memoryDir: dir, sessionId: "s1" });
    const readback = await runTurn("what do you know about Rover", { memoryDir: dir, sessionId: "s1" });
    assert.match(readback.answer, /rover is a dog/);
  });
});

test("a bare negative pairs with a stored rdf:type positive, citing the matched predicate's own phrase", async () => {
  await withStore(async (dir) => {
    await runTurn("Rover is a dog.", { memoryDir: dir, sessionId: "s1" });
    const negated = await runTurn("Rover is not a dog", { memoryDir: dir, sessionId: "s1" });
    assert.match(negated.answer, /you told me earlier that rover is a dog\b/);
    assert.doesNotMatch(negated.answer, /is a kind of/);
  });
});

test("forget retracts a taught rdf:type fact", async () => {
  await withStore(async (dir) => {
    await runTurn("Rover is a dog.", { memoryDir: dir, sessionId: "s1" });
    const forgotten = await runTurn("forget that Rover is a dog", { memoryDir: dir, sessionId: "s1" });
    assert.match(forgotten.answer, /^noted — forgotten: "Rover is a dog" is no longer stored/);
    assert.deepEqual(await rows(dir), []);
  });
});

test("forget still retracts a pre-existing rdfs:subClassOf fact about an individual — the old-store migration path", async () => {
  await withStore(async (dir) => {
    // A fact taught before the individual-vs-class split shipped, still
    // sitting in a store under the old-default predicate.
    await appendFacts(dir, [
      { subject: "rover", predicate: "rdfs:subClassOf", object: "dog", provenance: "teach:chat:s1@2000-01-01T00:00:00.000Z" },
    ]);
    const forgotten = await runTurn("forget that Rover is a dog", { memoryDir: dir, sessionId: "s1" });
    assert.match(forgotten.answer, /^noted — forgotten/);
    assert.deepEqual(await rows(dir), []);
  });
});

test("re-teaching the same individual type twice merges onto one fact, no contradiction", async () => {
  await withStore(async (dir) => {
    await runTurn("Rover is a dog.", { memoryDir: dir, sessionId: "s1" });
    await runTurn("Rover is a dog.", { memoryDir: dir, sessionId: "s1" });
    const stored = await rows(dir);
    assert.equal(stored.length, 1, "the same (subject, predicate, object) triple upserts, never duplicates");
    assert.equal(stored[0].predicate, "rdf:type");
  });
});
