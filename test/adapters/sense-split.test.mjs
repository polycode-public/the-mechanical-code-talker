// The pure sense-cluster utility: superclass ancestries decide whether two
// is-a end classes under one label name the same concept or two. Every case
// here is deterministic over a hand-built hierarchy — no store, no model.
import { test } from "node:test";
import assert from "node:assert/strict";

import { subClassParents, ancestryChain, ancestorSet, clusterSenses } from "../../src/domain/sense-split.mjs";

// A small taxonomy shared by several cases:
//   dog  -> canine -> mammal -> animal
//   scout -> person -> agent
//   cat  -> mammal
//   snake -> reptile -> animal
const TAXONOMY = [
  ["dog", "canine"], ["canine", "mammal"], ["mammal", "animal"],
  ["cat", "mammal"],
  ["snake", "reptile"], ["reptile", "animal"],
  ["scout", "person"], ["person", "agent"],
];

test("ancestryChain walks one deterministic path up to the cap", () => {
  const parents = subClassParents(TAXONOMY);
  assert.deepEqual(ancestryChain("dog", parents), ["dog", "canine", "mammal", "animal"]);
  assert.deepEqual(ancestryChain("dog", parents, { cap: 2 }), ["dog", "canine"]);
  assert.deepEqual(ancestryChain("animal", parents), ["animal"]);
});

test("ancestorSet includes the term and every reachable superclass", () => {
  const parents = subClassParents(TAXONOMY);
  assert.deepEqual([...ancestorSet("dog", parents)].sort(), ["animal", "canine", "dog", "mammal"]);
});

test("wholly non-intersecting ancestries split into two senses", () => {
  const { split, clusters, pairs } = clusterSenses(["dog", "scout"], { subClassEdges: TAXONOMY });
  assert.equal(split, true);
  assert.equal(clusters.length, 2);
  assert.deepEqual(clusters.map((c) => c.label).sort(), ["dog", "scout"]);
  assert.equal(pairs[0].reason, "non-intersecting");
  assert.equal(pairs[0].distinct, true);
});

test("a deep shared subsumer keeps two classes in one sense (inconclusive -> flat)", () => {
  const { split, clusters, pairs } = clusterSenses(["dog", "cat"], { subClassEdges: TAXONOMY });
  assert.equal(split, false);
  assert.equal(clusters.length, 1);
  assert.equal(pairs[0].reason, "shared-lineage");
  assert.equal(pairs[0].lcs, "mammal");
});

test("one class subsuming the other stays a single sense, labelled by the most specific", () => {
  const { split, clusters, pairs } = clusterSenses(["dog", "animal"], { subClassEdges: TAXONOMY });
  assert.equal(split, false);
  assert.equal(pairs[0].reason, "subsumes");
  assert.equal(clusters[0].label, "dog");
});

test("a stored disjointness between ancestors vetoes any shared root", () => {
  // living and machine share the root `thing`, but are disjoint — so their
  // members are distinct senses despite the shared top.
  const edges = [
    ["dog", "living"], ["living", "thing"],
    ["robot", "machine"], ["machine", "thing"],
  ];
  const { split, pairs } = clusterSenses(["dog", "robot"], {
    subClassEdges: edges,
    disjointEdges: [["living", "machine"]],
  });
  assert.equal(split, true);
  assert.equal(pairs[0].reason, "disjoint");
});

test("a subsumer at the root splits even when the ancestries technically meet at the top", () => {
  const edges = [
    ["dog", "animal"], ["animal", "thing"],
    ["car", "vehicle"], ["vehicle", "thing"],
  ];
  const { split, pairs } = clusterSenses(["dog", "car"], { subClassEdges: edges });
  assert.equal(split, true);
  assert.equal(pairs[0].reason, "root-subsumer");
  assert.equal(pairs[0].lcs, "thing");
});

// A deeper taxonomy where `animal` sits BELOW a `thing` root, so the least
// common subsumer of two animals is mid-hierarchy rather than the root.
//   dog  -> mammal -> animal -> thing
//   snake -> reptile -> animal -> thing
//   cat  -> mammal
const DEEP = [
  ["dog", "mammal"], ["mammal", "animal"], ["animal", "thing"],
  ["snake", "reptile"], ["reptile", "animal"],
  ["cat", "mammal"],
];

test("a shallow-but-non-root subsumer splits once the Wu-Palmer ratio drops below threshold", () => {
  // dog and snake meet at `animal` (depth 2 of 4) — ratio 0.5. Below a 0.6
  // threshold that reads as two senses; at the 0.5 default it does not.
  const strict = clusterSenses(["dog", "snake"], { subClassEdges: DEEP, threshold: 0.6 });
  assert.equal(strict.split, true);
  assert.equal(strict.pairs[0].reason, "shallow-subsumer");
  assert.equal(strict.pairs[0].lcs, "animal");

  const lenient = clusterSenses(["dog", "snake"], { subClassEdges: DEEP });
  assert.equal(lenient.split, false);
});

test("a supplied Resnik information-content map scores the least common subsumer", () => {
  // Score the LCS by IC instead of depth: a low-IC (very general) subsumer
  // reads as two senses.
  const icByTerm = new Map([["animal", 0.2], ["mammal", 2.5]]);
  const distinct = clusterSenses(["dog", "snake"], { subClassEdges: DEEP, icByTerm, threshold: 1.0 });
  assert.equal(distinct.split, true);
  assert.equal(distinct.pairs[0].reason, "low-ic");

  const together = clusterSenses(["dog", "cat"], { subClassEdges: DEEP, icByTerm, threshold: 1.0 });
  assert.equal(together.split, false);
  assert.equal(together.pairs[0].reason, "shared-lineage");
});

test("non-intersection with no ancestry evidence on one side stays inconclusive (flat)", () => {
  // `storage-space` has no recorded superclass, so `cache is a storage-space`
  // and `cache is a buffer` must not read as two concepts just because a
  // sparse taxonomy never linked them.
  const edges = [["buffer", "compound"]];
  const { split, pairs } = clusterSenses(["buffer", "storage-space"], { subClassEdges: edges });
  assert.equal(split, false);
  assert.equal(pairs[0].reason, "inconclusive");
});

test("a single end object never splits", () => {
  const { split, clusters } = clusterSenses(["dog"], { subClassEdges: TAXONOMY });
  assert.equal(split, false);
  assert.equal(clusters.length, 1);
});

test("three senses partition into three clusters", () => {
  const edges = [
    ["dog", "canine"], ["canine", "mammal"], ["mammal", "animal"],
    ["scout", "person"],
    ["chair", "furniture"],
  ];
  const { split, clusters } = clusterSenses(["dog", "scout", "chair"], { subClassEdges: edges });
  assert.equal(split, true);
  assert.equal(clusters.length, 3);
  assert.deepEqual(clusters.map((c) => c.label), ["chair", "dog", "scout"]);
});
