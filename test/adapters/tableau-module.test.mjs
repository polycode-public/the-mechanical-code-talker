// tableau-module.test.mjs — extractTableauModule: the hop-bounded,
// signature-connected slice a real question restricts the store to before
// buildTableauKb ever sees it, so a step/branch/node budget means something
// against a real corpus instead of exhausting on TBox internalization before
// an interesting rule fires. Covers both structural edges (subClassOf,
// restriction fillers, union/complement/oneOf membership) and asserted ABox
// role edges between two named individuals.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractTableauModule } from "../../src/domain/tableau.mjs";

function rowKey(r) { return `${r.id}`; }

test("extracts only the signature-connected slice around two seed terms, by row count and content", () => {
  const slice = [
    { id: "s1", subject: "heart", predicate: "rdfs:subClassOf", object: "organ" },
    { id: "s2", subject: "organ", predicate: "rdfs:subClassOf", object: "body-part" },
    { id: "s3", subject: "valve", predicate: "rdfs:subClassOf", object: "part" },
  ];
  const noise = Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, subject: `noise-${i}`, predicate: "rdfs:subClassOf", object: `noise-parent-${i}` }));
  const rows = [...slice, ...noise];

  const extracted = extractTableauModule(rows, ["heart", "valve"], { hops: 4 });
  const extractedIds = new Set(extracted.map(rowKey));

  for (const r of slice) assert.ok(extractedIds.has(r.id), `expected ${r.id} in the extracted module`);
  for (const r of noise) assert.ok(!extractedIds.has(r.id), `did not expect ${r.id} (unrelated noise) in the extracted module`);
  assert.equal(extracted.length, slice.length);
});

test("a chain of restrictions longer than the hop budget still extracts — each restriction re-seeds its own walk", () => {
  // heart ⊑ ∃has.valve ⊑ ∃has.hinge ⊑ ∃has.pin ⊑ ∃has.washer ⊑ ∃has.nut —
  // five chained restrictions, deeper than a hops:2 budget would reach
  // without the restriction-filler hop resetting to the full budget at
  // every new filler.
  const chain = ["valve", "hinge", "pin", "washer", "nut"];
  const rows = [];
  let prev = "heart";
  chain.forEach((filler, i) => {
    const restriction = `some-has-${filler}`;
    rows.push({ id: `r${i}a`, subject: prev, predicate: "rdfs:subClassOf", object: restriction });
    rows.push({ id: `r${i}b`, subject: restriction, predicate: "owl:onProperty", object: "has" });
    rows.push({ id: `r${i}c`, subject: restriction, predicate: "owl:someValuesFrom", object: filler });
    prev = filler;
  });

  const extracted = extractTableauModule(rows, ["heart"], { hops: 2 });
  const extractedIds = new Set(extracted.map(rowKey));
  for (const r of rows) assert.ok(extractedIds.has(r.id), `expected ${r.id} (deep in the restriction chain) in the extracted module`);
});

test("a universal restriction's filler is inside the extracted module", () => {
  const rows = [
    { id: "r1", subject: "heart", predicate: "rdfs:subClassOf", object: "all-contains-valve" },
    { id: "r2", subject: "all-contains-valve", predicate: "owl:onProperty", object: "contains" },
    { id: "r3", subject: "all-contains-valve", predicate: "owl:allValuesFrom", object: "valve" },
    { id: "n1", subject: "noise", predicate: "rdfs:subClassOf", object: "noise-parent" },
  ];
  const extracted = extractTableauModule(rows, ["heart"], { hops: 4 });
  const extractedIds = new Set(extracted.map(rowKey));
  assert.ok(extractedIds.has("r1") && extractedIds.has("r2") && extractedIds.has("r3"));
  assert.ok(!extractedIds.has("n1"));
});

test("a chain of universal restrictions longer than the hop budget still extracts — each re-seeds its own walk", () => {
  const chain = ["valve", "hinge", "pin", "washer", "nut"];
  const rows = [];
  let prev = "heart";
  chain.forEach((filler, i) => {
    const restriction = `all-contains-${filler}`;
    rows.push({ id: `u${i}a`, subject: prev, predicate: "rdfs:subClassOf", object: restriction });
    rows.push({ id: `u${i}b`, subject: restriction, predicate: "owl:onProperty", object: "contains" });
    rows.push({ id: `u${i}c`, subject: restriction, predicate: "owl:allValuesFrom", object: filler });
    prev = filler;
  });

  const extracted = extractTableauModule(rows, ["heart"], { hops: 2 });
  const extractedIds = new Set(extracted.map(rowKey));
  for (const r of rows) assert.ok(extractedIds.has(r.id), `expected ${r.id} (deep in the universal-restriction chain) in the extracted module`);
});

test("a seed term with nothing in the store extracts to an empty module, never a crash", () => {
  const rows = [{ id: "a1", subject: "cat", predicate: "rdfs:subClassOf", object: "animal" }];
  assert.doesNotThrow(() => extractTableauModule(rows, ["nonexistent-term"], { hops: 4 }));
  const extracted = extractTableauModule(rows, ["nonexistent-term"], { hops: 4 });
  assert.deepEqual(extracted, []);
});

test("an empty row set with a seed term extracts to nothing, never a crash", () => {
  assert.doesNotThrow(() => extractTableauModule([], ["anything"], { hops: 4 }));
  assert.deepEqual(extractTableauModule([], ["anything"], { hops: 4 }), []);
});

test("the unbounded subClassOf ancestor/descendant closure is always included, regardless of hop count", () => {
  const rows = [
    { id: "a1", subject: "heart", predicate: "rdfs:subClassOf", object: "organ" },
    { id: "a2", subject: "organ", predicate: "rdfs:subClassOf", object: "body-part" },
    { id: "a3", subject: "body-part", predicate: "rdfs:subClassOf", object: "anatomical-thing" },
    { id: "a4", subject: "chamber", predicate: "rdfs:subClassOf", object: "heart" }, // a descendant of heart
  ];
  const extracted = extractTableauModule(rows, ["heart"], { hops: 0 });
  const extractedIds = new Set(extracted.map(rowKey));
  for (const r of rows) assert.ok(extractedIds.has(r.id), `${r.id} is a subClassOf ancestor/descendant and must be included even at hops:0`);
});

test("union/complement/oneOf membership hops decrement the budget and do not reseed", () => {
  const rows = [
    { id: "u1", subject: "cat-or-dog", predicate: "owl:unionOf", object: "cat" },
    { id: "u2", subject: "cat-or-dog", predicate: "owl:unionOf", object: "dog" },
    // one hop past "dog" (a row that names neither the seed nor a subClassOf
    // relative of it, only reachable by crossing the union-membership edge)
    { id: "u3", subject: "dog", predicate: "owl:disjointWith", object: "cat" },
  ];
  const withOneHop = new Set(extractTableauModule(rows, ["cat-or-dog"], { hops: 1 }).map(rowKey));
  assert.ok(withOneHop.has("u1") && withOneHop.has("u2") && withOneHop.has("u3"));

  const withZeroHops = new Set(extractTableauModule(rows, ["cat-or-dog"], { hops: 0 }).map(rowKey));
  assert.ok(withZeroHops.has("u1") && withZeroHops.has("u2"), "the union node's own rows are included regardless — their subject IS the seed");
  assert.ok(!withZeroHops.has("u3"), "a membership hop costs budget, so hops:0 must not reach a row that only names a member");
});

test("a role axiom naming a role an included restriction uses is always included", () => {
  const rows = [
    { id: "r1", subject: "heart", predicate: "rdfs:subClassOf", object: "some-has-valve" },
    { id: "r2", subject: "some-has-valve", predicate: "owl:onProperty", object: "has" },
    { id: "r3", subject: "some-has-valve", predicate: "owl:someValuesFrom", object: "valve" },
    { id: "r4", subject: "has", predicate: "rdf:type", object: "transitiveproperty" },
    { id: "r5", subject: "unrelated-role", predicate: "rdf:type", object: "transitiveproperty" },
  ];
  const extracted = new Set(extractTableauModule(rows, ["heart"], { hops: 4 }).map(rowKey));
  assert.ok(extracted.has("r4"), "the transitive-role axiom for a used role must be included");
  assert.ok(!extracted.has("r5"), "a role axiom for an unrelated role must not be pulled in");
});

// ---- ABox role assertions ---------------------------------------------------

test("a role-assertion row is kept when the seed is the object side, not just the subject, and the far endpoint's own facts are reached", () => {
  const rows = [
    { id: "t1", subject: "hub", predicate: "rdf:type", object: "module" },
    { id: "t2", subject: "spoke", predicate: "rdf:type", object: "module" },
    { id: "e1", subject: "hub", predicate: "tmct:contains", object: "spoke" },
  ];
  const extracted = new Set(extractTableauModule(rows, ["spoke"], { hops: 4 }).map(rowKey));
  assert.ok(extracted.has("e1"), "the role-assertion row must be kept when only its object is the seed");
  assert.ok(extracted.has("t1"), "the far endpoint (hub, the subject side) is reached and its own facts are included too");
});

test("a chain of role-assertion edges longer than the hop budget still extracts — each edge re-seeds its own walk", () => {
  const chain = ["m0", "m1", "m2", "m3", "m4", "m5"];
  const rows = chain.map((m) => ({ id: `type-${m}`, subject: m, predicate: "rdf:type", object: "module" }));
  for (let i = 0; i < chain.length - 1; i += 1) {
    rows.push({ id: `edge${i}`, subject: chain[i], predicate: "tmct:contains", object: chain[i + 1] });
  }
  const extracted = new Set(extractTableauModule(rows, ["m0"], { hops: 2 }).map(rowKey));
  for (const r of rows) assert.ok(extracted.has(r.id), `expected ${r.id} (deep in the role-assertion chain) in the extracted module`);
});

test("a class-level relation does not reseed its far endpoint's own walk — only a role assertion between two individuals does", () => {
  const rows = [
    { id: "c1", subject: "human", predicate: "mgx:capableOf", object: "think" },
    { id: "c2", subject: "think", predicate: "rdfs:subClassOf", object: "cognition" },
  ];
  const extracted = new Set(extractTableauModule(rows, ["human"], { hops: 4 }).map(rowKey));
  assert.ok(extracted.has("c1"), "c1 itself is kept regardless — its subject IS the seed");
  assert.ok(!extracted.has("c2"), "human/think are not declared individuals, so 'think' is never reseeded as a role-assertion endpoint");
});

test("a role-hierarchy row for a role that only appears via a role-assertion edge is still pulled into the module", () => {
  const rows = [
    { id: "t1", subject: "hub", predicate: "rdf:type", object: "module" },
    { id: "t2", subject: "spoke", predicate: "rdf:type", object: "module" },
    { id: "e1", subject: "hub", predicate: "tmct:contains", object: "spoke" },
    { id: "h1", subject: "tmct:contains", predicate: "rdfs:subPropertyOf", object: "tmct:touches" },
  ];
  const extracted = new Set(extractTableauModule(rows, ["hub"], { hops: 4 }).map(rowKey));
  assert.ok(extracted.has("h1"), "the role-hierarchy row for a role used only via a role assertion must still be pulled into the module");
});

test("preserves the input row order in its output", () => {
  const rows = [
    { id: "z", subject: "heart", predicate: "rdfs:subClassOf", object: "organ" },
    { id: "a", subject: "organ", predicate: "rdfs:subClassOf", object: "body-part" },
  ];
  const extracted = extractTableauModule(rows, ["heart"], { hops: 4 });
  assert.deepEqual(extracted.map((r) => r.id), ["z", "a"]);
});
