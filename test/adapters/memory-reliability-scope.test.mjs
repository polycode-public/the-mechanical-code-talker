// The reliability pass reads a slice of the graph rather than all of it. What
// this suite holds:
//
//   - the slice gives every actor the same number a whole-graph fold gives,
//     over a fact set carrying corroborations, contradictions, a supersession
//     and a retraction;
//   - two stores fed the same facts in different orders agree on every number,
//     so nothing in the pass depends on arrival order;
//   - a store whose writers are all documents scores nobody, exactly as a
//     whole-graph fold scores nobody.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendFact, removeFacts, loadMemory, readFactRows, findContradictions,
  SOURCE_CLASS, SOURCE_RELIABILITY_PROP,
} from "../../src/adapters/memory/core.mjs";
import { sessionReliabilityFrom } from "../../src/domain/memory/trust.mjs";

const tmpRepo = () => mkdtemp(join(tmpdir(), "tmct-mem-relscope-"));
const attr = (ind, prop) => (ind?.attributes || []).find((a) => a?.prop === prop)?.value;

const SESSION_A = "0189ffff-0000-7000-8000-0000000000a1";
const SESSION_B = "0189ffff-0000-7000-8000-0000000000b2";
const NODE_C = "5c5c5c5c5c5c5c5c";

// A functional relation — one subject has one — so a differing object is a real
// disagreement the tally can count.
const SINGLE_VALUED = "mgx:father";

const teach = (session, at) => (subject, object) => ({
  subject, predicate: SINGLE_VALUED, object, provenance: `teach:chat:${session}@${at}`,
});
const peer = (node, at) => (subject, object) => ({
  subject, predicate: SINGLE_VALUED, object, provenance: `teach:peer:amber-fox#node:${node}@${at}`,
});
const corpus = (subject, object) => ({
  subject, predicate: SINGLE_VALUED, object, provenance: "corpus:conceptnet /r/IsA",
});
const web = (subject, object) => ({
  subject, predicate: SINGLE_VALUED, object, provenance: "news:wikimedia-featured@item-7",
});

const isActorSource = (id) => /^src:(operator-chat|teach-chat|teach-node):/.test(id);

/** The whole-graph answer, re-derived here from the fold and the contradiction
 *  finder directly: fold every group, count what each actor stated and how much
 *  of it stands contradicted, run the same pure formula. This is the reference
 *  the shipped pass has to match. */
function reliabilityByWholeGraphFold(memory) {
  const rows = readFactRows(memory);
  const contradicted = new Set();
  for (const group of findContradictions(memory, { factRows: rows })) for (const r of group) contradicted.add(r.id);
  const tally = new Map();
  for (const row of rows) {
    for (const sourceId of row.sourceIds) {
      if (!isActorSource(sourceId)) continue;
      const bucket = tally.get(sourceId) || { factsAsserted: 0, factsContradicted: 0 };
      bucket.factsAsserted += 1;
      if (contradicted.has(row.id)) bucket.factsContradicted += 1;
      tally.set(sourceId, bucket);
    }
  }
  const out = {};
  for (const [sourceId, counts] of tally) out[sourceId] = sessionReliabilityFrom(counts);
  return out;
}

/** What the store actually materialised, as a plain object so a mismatch prints
 *  both sides whole. */
function materialisedReliability(memory) {
  const out = {};
  for (const ind of memory.individuals) {
    if (ind?.class !== SOURCE_CLASS || !isActorSource(ind.id)) continue;
    const value = attr(ind, SOURCE_RELIABILITY_PROP);
    if (value !== undefined) out[ind.id] = Number(value);
  }
  return out;
}

const trustBySubject = (memory) => Object.fromEntries(
  readFactRows(memory).map((row) => [`${row.subject} ${row.object}`, row.trust]),
);

/** A fact set with everything the tally can trip over: two chat sessions and a
 *  peer node, corroboration between two of them, contradictions from a
 *  non-actor source, a triple one session re-stated later, and a retraction. */
function mixedFacts() {
  const a = teach(SESSION_A, "2026-07-09T00:00:00.000Z");
  const aLater = teach(SESSION_A, "2026-07-19T00:00:00.000Z");
  const b = teach(SESSION_B, "2026-07-10T00:00:00.000Z");
  const c = peer(NODE_C, "2026-07-11T00:00:00.000Z");
  return [
    a("alpha", "bruno"), corpus("alpha", "rex"), // contradicted
    a("beta", "bruno"), corpus("beta", "rex"), // contradicted
    a("mu", "bruno"), corpus("mu", "rex"), // contradicted
    a("gamma", "bruno"), b("gamma", "bruno"), // corroborated across two sessions
    a("delta", "bruno"),
    a("epsilon", "bruno"), aLater("epsilon", "bruno"), // the same session re-stating itself
    b("zeta", "bruno"), web("zeta", "carla"), // contradicted by a document
    b("eta", "bruno"),
    c("theta", "bruno"), corpus("theta", "rex"), // contradicted
    c("iota", "bruno"), c("kappa", "bruno"),
    corpus("lambda", "rex"), web("lambda", "carla"), // no actor anywhere near it
  ];
}

async function writeAll(dir, facts) {
  for (const fact of facts) await appendFact(dir, fact);
}

test("the scoped reliability pass lands on the whole-graph fold's numbers, over corroborations, contradictions, a supersession and a retraction", async () => {
  const dir = await tmpRepo();
  try {
    await writeAll(dir, mixedFacts());
    // A retraction standing over one of session A's own triples: the pass must
    // stop counting it, and the scoped fold has to see the retraction to know.
    const rowsBefore = readFactRows(await loadMemory(dir));
    const retractedId = rowsBefore.find((r) => r.subject === "delta")?.id;
    assert.ok(retractedId, "the fixture wrote the triple the retraction stands over");
    await removeFacts(dir, [retractedId]);

    const memory = await loadMemory(dir);
    const materialised = materialisedReliability(memory);
    assert.ok(Object.keys(materialised).length >= 3, "every actor in the fixture carries a score");
    // The numbers have to be doing work: a run that missed every contradiction
    // would still deep-equal a reference that missed them the same way, so the
    // fixture is pinned as one where some actor is above neutral and some below.
    const scores = Object.values(materialised);
    assert.ok(scores.some((n) => n > 1), "an actor nothing contradicted rises above neutral");
    assert.ok(scores.some((n) => n < 1), "an actor a document contradicted falls below neutral");
    assert.deepEqual(materialised, reliabilityByWholeGraphFold(memory));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("two stores fed the same facts in different orders agree on every reliability and every trust score", async () => {
  const forward = await tmpRepo();
  const reversed = await tmpRepo();
  try {
    const facts = mixedFacts();
    await writeAll(forward, facts);
    await writeAll(reversed, facts.slice().reverse());

    const forwardMemory = await loadMemory(forward);
    const reversedMemory = await loadMemory(reversed);
    assert.deepEqual(materialisedReliability(reversedMemory), materialisedReliability(forwardMemory));
    assert.deepEqual(trustBySubject(reversedMemory), trustBySubject(forwardMemory));
  } finally {
    await rm(forward, { recursive: true, force: true });
    await rm(reversed, { recursive: true, force: true });
  }
});

test("a store every one of whose writers is a document scores nobody, and folds nothing to find that out", async () => {
  const dir = await tmpRepo();
  try {
    await writeAll(dir, [
      corpus("alpha", "rex"), web("alpha", "carla"),
      corpus("beta", "rex"),
      { subject: "gamma", predicate: SINGLE_VALUED, object: "rex", provenance: "reference:simplewiki:Gamma@912" },
    ]);
    const memory = await loadMemory(dir);
    assert.deepEqual(materialisedReliability(memory), {});
    assert.deepEqual(reliabilityByWholeGraphFold(memory), {});
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
