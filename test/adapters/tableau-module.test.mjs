// tableau-module.test.mjs — extractTableauModule: the hop-bounded,
// signature-connected slice a real question restricts the store to before
// buildTableauKb ever sees it, so a step/branch/node budget means something
// against a real corpus instead of exhausting on TBox internalization before
// an interesting rule fires.
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

test("preserves the input row order in its output", () => {
  const rows = [
    { id: "z", subject: "heart", predicate: "rdfs:subClassOf", object: "organ" },
    { id: "a", subject: "organ", predicate: "rdfs:subClassOf", object: "body-part" },
  ];
  const extracted = extractTableauModule(rows, ["heart"], { hops: 4 });
  assert.deepEqual(extracted.map((r) => r.id), ["z", "a"]);
});
