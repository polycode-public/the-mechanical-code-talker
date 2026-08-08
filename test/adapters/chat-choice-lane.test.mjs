// The closed multiple-choice chat lane (choice-question.mjs's splitter, wired
// into dispatchTurn ahead of the write boundary): pair-level grounding against
// the fact store decides between "answer and cite", "refuse and list every
// grounded option" and "the honest miss naming the source term". Every case
// here disables the real child-triples pack (a bogus TMCT_CHILD_PACK_DIR) so
// the outcome is decided entirely by the facts each test teaches, never by
// what the shipped corpus happens to know about a real-world term.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runTurn, WALL_MISS_RE } from "../../src/services/chat.mjs";
import { appendFacts, loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";

const NO_CHILD_PACK_ENV = { TMCT_CHILD_PACK_DIR: fileURLToPath(new URL("../fixtures/no-such-child-pack", import.meta.url)) };

async function freshRepo() {
  return mkdtemp(join(tmpdir(), "tmct-choice-lane-"));
}

const turn = (line, { memoryDir, env = NO_CHILD_PACK_ENV, last } = {}) =>
  runTurn(line, { config: null, memoryDir, env, last });

// The rig's own enumerated shape: "find magazines" gives the probe its source
// term ("magazines"), and the five lettered options are the ones section 6.3
// of the design worked through by hand.
const MAGAZINE_Q = "Where would you find magazines along side many other printed works?\n"
  + "A) doctor B) bookstore C) market D) train station E) mortuary";

test("a choice question with one grounded option answers and cites the source fact", async () => {
  const dir = await freshRepo();
  try {
    await appendFacts(dir, [
      { subject: "magazine", predicate: "mgx:atLocation", object: "bookstore", provenance: "corpus:test" },
    ]);
    const r = await turn(MAGAZINE_Q, { memoryDir: dir });
    assert.equal(r.record.miss, false);
    assert.equal(r.lane, "ask-choice");
    assert.match(r.answer, /^bookstore — magazine is found in bookstore \(source: corpus:test\)\./);
    assert.equal(r.detail.selectedLabel, "B");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a choice question with several grounded options refuses and lists every one of them", async () => {
  const dir = await freshRepo();
  try {
    await appendFacts(dir, [
      { subject: "magazine", predicate: "mgx:atLocation", object: "bookstore", provenance: "corpus:test" },
      { subject: "magazine", predicate: "mgx:atLocation", object: "market", provenance: "corpus:test" },
      { subject: "magazine", predicate: "mgx:atLocation", object: "train station", provenance: "corpus:test" },
    ]);
    const r = await turn(MAGAZINE_Q, { memoryDir: dir });
    assert.equal(r.record.miss, false);
    assert.equal(r.lane, "ask-choice");
    assert.match(r.answer, /More than one of those grounds: bookstore, market, or train station\./);
    assert.equal(r.answer.includes("doctor"), false, "an ungrounded option is never listed in the refusal");
    assert.equal(r.answer.includes("mortuary"), false, "an ungrounded option is never listed in the refusal");
    assert.equal(r.detail.selectedLabel, undefined, "nothing was selected — a tie is reported, never broken");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a choice question with no grounded option returns the miss naming the source term", async () => {
  const dir = await freshRepo();
  try {
    const r = await turn(MAGAZINE_Q, { memoryDir: dir });
    assert.equal(r.record.miss, true);
    assert.match(r.answer, /I don't know how "magazines" relates to any of doctor, bookstore, market, train station, or mortuary\./);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a choice question never reaches the teach lane, even without a trailing question mark", async () => {
  const dir = await freshRepo();
  try {
    await appendFacts(dir, [
      { subject: "whale", predicate: "rdfs:subClassOf", object: "mammal", provenance: "corpus:test" },
    ]);
    const before = readFactRows(await loadMemory(dir)).length;
    const r = await turn("is a whale a fish or a mammal", { memoryDir: dir });
    assert.equal(r.record.miss, false);
    assert.equal(r.lane, "ask-choice");
    assert.equal(r.detail.selectedLabel, "2");
    const after = readFactRows(await loadMemory(dir)).length;
    assert.equal(after, before, "the write boundary held — nothing extra was stored as a side effect");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a disjunctive teach sentence still teaches and is not read as a choice question", async () => {
  const dir = await freshRepo();
  try {
    const r = await turn("every pet is a cat or a dog", { memoryDir: dir });
    assert.notEqual(r.lane, "ask-choice", "the choice lane never claims a disjunctive teach sentence");
    assert.equal(r.detail?.selectedLabel, undefined, "the turn never reached probeChoiceOptions");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an enumerated five-choice question answers from the same probe as the inline form", async () => {
  const dir = await freshRepo();
  try {
    await appendFacts(dir, [
      { subject: "magazine", predicate: "mgx:atLocation", object: "bookstore", provenance: "corpus:test" },
    ]);
    const enumerated = await turn(MAGAZINE_Q, { memoryDir: dir });
    const inline = await turn("is a magazine a bookstore or a doctor", { memoryDir: dir });
    assert.equal(enumerated.record.miss, false);
    assert.equal(inline.record.miss, false);
    assert.match(enumerated.answer, /magazine is found in bookstore \(source: corpus:test\)/);
    assert.match(inline.answer, /magazine is found in bookstore \(source: corpus:test\)/);
    assert.equal(enumerated.detail.matches[0].object, inline.detail.matches[0].object);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the refusal lists the options in the order they were asked", async () => {
  const dir = await freshRepo();
  try {
    // Taught out of asked order on purpose: the refusal's own order must
    // follow the OPTIONS as asked, not the order the facts were stored in.
    await appendFacts(dir, [
      { subject: "magazine", predicate: "mgx:atLocation", object: "train station", provenance: "corpus:test" },
      { subject: "magazine", predicate: "mgx:atLocation", object: "bookstore", provenance: "corpus:test" },
      { subject: "magazine", predicate: "mgx:atLocation", object: "market", provenance: "corpus:test" },
    ]);
    const r = await turn(MAGAZINE_Q, { memoryDir: dir });
    assert.match(r.answer, /More than one of those grounds: bookstore, market, or train station\./);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the lane's miss is not rewritten by the generic grammar wall", async () => {
  const dir = await freshRepo();
  try {
    const r = await turn(MAGAZINE_Q, { memoryDir: dir });
    assert.equal(r.record.miss, true);
    assert.equal(WALL_MISS_RE.test(r.answer), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("two grounded options tie and the lane picks neither, whatever their edge weights", async () => {
  const dir = await freshRepo();
  try {
    // Different provenance heads carry different trust priors (corpus vs.
    // corpus-weak) — the tie fires on COUNT alone, never on which option's
    // fact happens to carry more trust.
    await appendFacts(dir, [
      { subject: "magazine", predicate: "mgx:atLocation", object: "bookstore", provenance: "corpus-weak:test" },
      { subject: "magazine", predicate: "mgx:atLocation", object: "market", provenance: "corpus:test" },
    ]);
    const r = await turn(MAGAZINE_Q, { memoryDir: dir });
    assert.equal(r.record.miss, false);
    assert.match(r.answer, /More than one of those grounds: bookstore or market\./);
    assert.equal(r.detail.selectedLabel, undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
