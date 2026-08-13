// The pure sense-cluster utility: superclass ancestries decide whether two
// is-a end classes under one label name the same concept or two. Every case
// here is deterministic over a hand-built hierarchy — no store, no model.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  subClassParents, subClassChildren, descendantSet, ancestryChain, ancestorSet, clusterSenses, STOP_SET,
} from "../../src/domain/sense-split.mjs";
import { ANSWER_STOP_SET } from "../../src/domain/hub-terms.mjs";

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

test("ancestryChain with a stopAt set truncates before an abstraction-tier ancestor", () => {
  const parents = subClassParents(TAXONOMY);
  // dog -> canine -> mammal -> animal; "animal" is a hub-terms.mjs stop word,
  // so the walk halts before climbing into it, leaving the two concrete hops.
  assert.deepEqual(ancestryChain("dog", parents, { stopAt: STOP_SET }), ["dog", "canine", "mammal"]);
});

test("ancestryChain still renders one hop when the term's own direct parent is a stop word", () => {
  const parents = subClassParents([["gadget", "object"], ["object", "artifact"]]);
  // "object" is a hub-terms.mjs stop word and gadget's ONLY recorded parent —
  // the walk shows that one direct parent (it is already the plain "gadget is
  // a kind of object" fact) rather than truncating to an empty chain.
  assert.deepEqual(ancestryChain("gadget", parents, { stopAt: STOP_SET }), ["gadget", "object"]);
});

test("ancestryChain with a stopAt set still stops right after a first-hop stop word even when a further, non-hub ancestor exists", () => {
  const parents = subClassParents(TAXONOMY);
  // scout -> person -> agent; "person" is a hub-terms.mjs stop word and
  // scout's direct parent, so it renders but the walk does not continue on
  // to "agent" even though "agent" is not itself a stop word.
  assert.deepEqual(ancestryChain("scout", parents, { stopAt: STOP_SET }), ["scout", "person"]);
});

test("ANSWER_STOP_SET widens STOP_SET with the extra abstraction-tier hubs an answer chain needs, leaving STOP_SET itself untouched", () => {
  for (const w of ["property", "concept", "idea", "content"]) {
    assert.ok(ANSWER_STOP_SET.has(w));
    assert.ok(!STOP_SET.has(w));
  }
  for (const w of STOP_SET) assert.ok(ANSWER_STOP_SET.has(w));
});

test("ancestryChain under the wider ANSWER_STOP_SET halts a hop earlier than the plain STOP_SET on the same chain", () => {
  const parents = subClassParents([
    ["letter", "character"], ["character", "property"], ["property", "concept"], ["concept", "idea"],
  ]);
  assert.deepEqual(ancestryChain("letter", parents, { stopAt: STOP_SET }), ["letter", "character", "property", "concept", "idea"]);
  assert.deepEqual(ancestryChain("letter", parents, { stopAt: ANSWER_STOP_SET }), ["letter", "character"]);
});

test("ancestryChain steered toward a target picks the parent that reaches it, and stops once it does", () => {
  // dog has two parents: "aardvark-path" (a dead end, sorts first) and
  // "canine" (which reaches "mammal"). With no target the walk would follow
  // the lowest-sorted parent into the dead end; steered toward "mammal" it
  // follows canine instead, and halts the moment it arrives.
  const parents = subClassParents([...TAXONOMY, ["dog", "aardvark-path"]]);
  assert.deepEqual(ancestryChain("dog", parents, { toward: "mammal" }), ["dog", "canine", "mammal"]);
});

test("ancestorSet includes the term and every reachable superclass", () => {
  const parents = subClassParents(TAXONOMY);
  assert.deepEqual([...ancestorSet("dog", parents)].sort(), ["animal", "canine", "dog", "mammal"]);
});

// child -> parent edges below "animal", the mirror of the TAXONOMY above's
// parent direction, for the descendant-walk primitives.
const DESCENDANT_EDGES = [
  ["dog", "canine"], ["canine", "mammal"], ["cat", "mammal"], ["mammal", "animal"],
  ["snake", "reptile"], ["reptile", "animal"],
];

test("descendantSet returns the same set regardless of the edge array's order", () => {
  const forward = descendantSet("animal", subClassChildren(DESCENDANT_EDGES));
  const reversed = descendantSet("animal", subClassChildren([...DESCENDANT_EDGES].reverse()));
  const shuffled = descendantSet("animal", subClassChildren([
    DESCENDANT_EDGES[3], DESCENDANT_EDGES[1], DESCENDANT_EDGES[5], DESCENDANT_EDGES[0], DESCENDANT_EDGES[4], DESCENDANT_EDGES[2],
  ]));
  const expected = ["animal", "canine", "cat", "dog", "mammal", "reptile", "snake"];
  assert.deepEqual([...forward].sort(), expected);
  assert.deepEqual([...reversed].sort(), expected);
  assert.deepEqual([...shuffled].sort(), expected);
});

test("descendantSet terminates on a cycle instead of looping forever", () => {
  const children = subClassChildren([["a", "b"], ["b", "a"]]);
  assert.deepEqual([...descendantSet("a", children)].sort(), ["a", "b"]);
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

test("clusters come out in codepoint label order, not locale order, whichever way the objects arrived", () => {
  // "zebra" sorts BEFORE "élan" in codepoint order (z=0x7A < é=0xE9) but AFTER
  // it under locale-aware collation, so this only holds under codepoint order.
  const edges = [["zebra", "zclass"], ["élan", "eclass"]];
  const forward = clusterSenses(["zebra", "élan"], { subClassEdges: edges });
  const reversed = clusterSenses(["élan", "zebra"], { subClassEdges: edges });
  assert.deepEqual(forward.clusters.map((c) => c.label), ["zebra", "élan"]);
  assert.deepEqual(reversed.clusters.map((c) => c.label), forward.clusters.map((c) => c.label),
    "the order the two objects were asked about never changes the cluster order");
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
