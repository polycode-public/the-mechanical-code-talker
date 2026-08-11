// Perf guard for the relation-alias chase (src/services/chat.mjs's
// relationFactsFor family, over src/domain/syllogise.mjs's findIsaChain).
//
// "who is the president of France" refuses correctly — 'president' is not a
// relation anything taught. Reaching that refusal used to run one bounded
// breadth-first search per stored fact, and each search rebuilt its adjacency
// index over the whole subClassOf edge set first, so the work grew with the
// square of the store. On a seeded browser page it took seventeen minutes and
// locked the tab.
//
// Two things fix it and both are asserted here: the adjacency is built once per
// query rather than once per fact, and a target no subClassOf edge points at is
// unreachable by construction, so the searches are skipped outright.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryStore, appendFacts } from "../../src/adapters/memory/core.mjs";
import { factReadBack } from "../../src/services/chat.mjs";
import { findIsaChain, buildSubClassSuccessors } from "../../src/domain/syllogise.mjs";

// Big enough that a per-fact whole-graph rebuild costs seconds, small enough to
// seed in a moment. The gap widens with store size, so a bigger seed would only
// make the assertion easier to pass.
const SEED_FACTS = 8000;
const RELATIONS = ["mgx:hasA", "mgx:capableOf", "mgx:usedFor", "mgx:atLocation", "mgx:partOf"];

/** A store shaped like the seeded corpus: a subClassOf backbone plus relation
 *  facts whose role words the chase has to consider one by one. */
async function seededStore() {
  const store = createInMemoryStore();
  const rows = [];
  for (let i = 0; i < SEED_FACTS; i += 1) {
    rows.push(i % 5 < 2
      ? { subject: `term${i}`, predicate: "rdfs:subClassOf", object: `kind${i % 900}`, provenance: "corpus:conceptnet /r/IsA" }
      : { subject: `term${i}`, predicate: RELATIONS[i % RELATIONS.length], object: `thing${i % 700}`, provenance: "corpus:conceptnet /r/HasA" });
  }
  await appendFacts(store, rows);
  return store;
}

// Best of two runs: a loaded CI runner can smear one measurement past the
// bound (observed 1003ms on a shared runner for a path that measures <100ms
// alone), but the minimum of two stays near the true cost, while the broken
// whole-store chase stays ~2.9s on every run at this size.
async function minRefusalMs(store, question) {
  let best = Infinity;
  let out;
  for (let run = 0; run < 2; run += 1) {
    const t0 = performance.now();
    out = await factReadBack(store, question, null, true);
    best = Math.min(best, performance.now() - t0);
  }
  return { out, best };
}

test("an unknown relation name in 'who is the <role> of <thing>' refuses in well under a second over a seed-sized store", async () => {
  const store = await seededStore();
  const { out, best } = await minRefusalMs(store, "who is the president of France");
  assert.match(out.text, /I don't know a relation or rule called 'president' yet\./);
  // The pre-fix path measured ~2.9s at this size and grew with the square of
  // the store; the fixed path measures under 100ms. A second is far above the
  // fixed cost and far below the broken one, so this fails on the slow path
  // without being sensitive to a loaded machine.
  assert.ok(best < 1000, `the refusal took ${best.toFixed(0)}ms — the whole-store chase is back`);
});

test("the same refusal for a 'what is the <role> of <thing>' phrasing is equally cheap", async () => {
  const store = await seededStore();
  const { out, best } = await minRefusalMs(store, "what is the capital of Peru");
  assert.match(out.text, /I don't know a relation or rule called 'capital' yet\./);
  assert.ok(best < 1000, `the refusal took ${best.toFixed(0)}ms — the whole-store chase is back`);
});

test("findIsaChain takes a prebuilt successor index and finds the same chain as it does from the edge list", () => {
  const edges = [["father", "parent"], ["parent", "relative"], ["dog", "animal"]];
  const targets = new Set(["relative"]);
  const fromEdges = findIsaChain("father", targets, [], edges, { maxHops: 3 });
  const fromIndex = findIsaChain("father", targets, [], buildSubClassSuccessors(edges), { maxHops: 3 });
  assert.deepEqual(fromIndex, fromEdges);
  assert.equal(fromEdges.length, 2, "the two-hop chain is found either way");
  assert.equal(findIsaChain("dog", targets, [], buildSubClassSuccessors(edges), { maxHops: 3 }), null);
});

test("buildSubClassSuccessors drops self-edges and empty endpoints, the way the inline build did", () => {
  const succ = buildSubClassSuccessors([["a", "b"], ["a", "a"], ["", "c"], ["d", ""], ["a", "c"]]);
  assert.deepEqual([...succ.get("a")].sort(), ["b", "c"]);
  assert.equal(succ.has("d"), false);
  assert.equal(succ.has(""), false);
});
