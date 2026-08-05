// The selector scores a term's candidate fact rows and cuts them to a budget:
// provenance tier, chain depth, store-relative informativeness, relation
// coverage and sense agreement, with nothing discarded silently.
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectFacts, FAMILY_OF } from "../../src/domain/digest/select.mjs";

const row = (predicate, object, over = {}) => ({
  id: `${predicate}:${object}`, subject: "aardvark", predicate, object,
  provenance: over.provenance || "", sourceTypes: over.sourceTypes || ["referenceLive"],
  trust: over.trust ?? 0.5, environments: over.environments || [], ...over,
});

test("a taught isa outranks an entailed one of the same class", () => {
  const rows = [
    row("rdfs:subClassOf", "mammal", { sourceTypes: ["teach"] }),
    row("rdfs:subClassOf", "creature", { sourceTypes: ["entailed"], environments: [["p1"]] }),
  ];
  const out = selectFacts("aardvark", rows, { totalSubjects: 3, classSubjectCounts: {} }, { budget: 5 });
  assert.equal(out.selected[0].row.object, "mammal");
  assert.ok(out.selected[0].score > out.selected[1].score);
});

test("an uninformative class shared by most of the store is cut, not ranked", () => {
  const rows = [
    row("rdfs:subClassOf", "mammal", { sourceTypes: ["reference"] }),
    row("rdfs:subClassOf", "entity", { sourceTypes: ["entailed"], environments: [["p"]] }),
  ];
  const store = { totalSubjects: 100, classSubjectCounts: { entity: 95, mammal: 4 } };
  const out = selectFacts("aardvark", rows, store, { budget: 5 });
  const objects = out.selected.map((s) => s.row.object);
  assert.ok(objects.includes("mammal"));
  assert.ok(!objects.includes("entity"));
  assert.ok(out.cut.some((c) => c.row.object === "entity" && c.reason === "uninformative-class"));
});

test("the uninformative cut stays off in a store too small for the share to mean anything", () => {
  const rows = [row("rdfs:subClassOf", "animal", { sourceTypes: ["reference"] })];
  const store = { totalSubjects: 3, classSubjectCounts: { animal: 3 } };
  const out = selectFacts("aardvark", rows, store, { budget: 5 });
  assert.deepEqual(out.selected.map((s) => s.row.object), ["animal"]);
});

test("relation coverage: one fact of each family leads before a second of any", () => {
  const rows = [
    row("rdfs:subClassOf", "mammal", { sourceTypes: ["reference"] }),
    row("rdfs:subClassOf", "vertebrate", { sourceTypes: ["reference"] }),
    row("mgx:atLocation", "Africa", { sourceTypes: ["reference"] }),
    row("mgx:capableOf", "dig", { sourceTypes: ["reference"] }),
  ];
  const out = selectFacts("aardvark", rows, { totalSubjects: 5, classSubjectCounts: {} }, { budget: 3 });
  const families = out.selected.map((s) => s.family);
  assert.deepEqual([...new Set(families)].sort(), ["capableOf", "isa", "location"]);
});

test("a minority-sense isa branch is demoted below the dominant sense", () => {
  const rows = [
    row("rdfs:subClassOf", "mammal", { sourceTypes: ["reference"] }),
    row("rdfs:subClassOf", "medium", { sourceTypes: ["extracted"] }),
  ];
  const store = {
    totalSubjects: 20, classSubjectCounts: { mammal: 2, medium: 2 },
    subClassEdges: [["mammal", "vertebrate"], ["vertebrate", "animal"], ["medium", "environment"], ["environment", "region"]],
  };
  const out = selectFacts("aardvark", rows, store, { budget: 5 });
  assert.equal(out.selected[0].row.object, "mammal");
  assert.ok(!out.selected.some((s) => s.row.object === "medium"), "the mis-sensed branch never leads");
});

test("nothing is destroyed: every candidate lands in selected or cut", () => {
  const rows = [
    row("rdfs:subClassOf", "mammal"),
    row("rdfs:subClassOf", "entity", { sourceTypes: ["entailed"], environments: [["p"]] }),
    row("mgx:capableOf", "dig"),
  ];
  const store = { totalSubjects: 50, classSubjectCounts: { entity: 48, mammal: 2 } };
  const out = selectFacts("aardvark", rows, store, { budget: 2 });
  const seen = new Set([...out.selected.map((s) => s.row.id), ...out.cut.map((c) => c.row.id)]);
  assert.equal(seen.size, rows.length);
});

test("the family map keys the starting relation set", () => {
  assert.equal(FAMILY_OF["rdfs:subClassOf"], "isa");
  assert.equal(FAMILY_OF["mgx:partOf"], "partOf");
  assert.equal(FAMILY_OF["mgx:capableOf"], "capableOf");
});

test("membership narrates through the same family as part-of, sharing its structures", () => {
  assert.equal(FAMILY_OF["mgx:memberOf"], "partOf");
});
