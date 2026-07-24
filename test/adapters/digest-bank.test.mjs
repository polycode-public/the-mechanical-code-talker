// The stage-5 wiring seam: the committed bank builds a non-empty structure
// table, one pass over fact rows produces the store-relative statistics the
// selector needs, and digestTermFromRows reduces a term's fan-out to a bounded,
// sourced paragraph with the full fact list still reachable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadDigestStructureTable, readDigestStructures, digestTermFromRows } from "../../src/adapters/corpus/digest-bank.mjs";
import { digestStoreStats, chainsForObjects, isaObjectsOf } from "../../src/domain/digest/store-stats.mjs";

const row = (subject, predicate, object, sourceTypes, over = {}) => ({
  id: `${subject}:${predicate}:${object}`, subject, predicate, object,
  sourceTypes, provenance: over.provenance || sourceTypes[0], trust: over.trust ?? 0.4,
  environments: sourceTypes.includes("entailed") ? [["premise"]] : [],
});

test("the committed bank builds a non-empty structure table", () => {
  assert.ok(readDigestStructures().length > 0);
  assert.ok(loadDigestStructureTable().size > 0);
});

test("digestStoreStats counts distinct subjects per class over one row scan", () => {
  const rows = [
    row("dog", "rdfs:subClassOf", "animal", ["taught"]),
    row("cat", "rdfs:subClassOf", "animal", ["taught"]),
    row("dog", "rdfs:subClassOf", "animal", ["taught"]), // duplicate subject → counted once
    row("animal", "rdfs:subClassOf", "organism", ["taught"]),
    row("dog", "owl:disjointWith", "cat", ["taught"]),
  ];
  const stats = digestStoreStats(rows);
  assert.equal(stats.classSubjectCounts.animal, 2);
  assert.equal(stats.classSubjectCounts.organism, 1);
  assert.equal(stats.totalSubjects, 3); // dog, cat, animal
  assert.deepEqual(stats.disjointEdges, [["dog", "cat"]]);
});

test("chainsForObjects walks the store's subClassOf edges to an ancestry chain", () => {
  const edges = [["mammal", "vertebrate"], ["vertebrate", "animal"]];
  const chains = chainsForObjects(edges, ["mammal"]);
  assert.deepEqual(chains.mammal, ["mammal", "vertebrate", "animal"]);
});

test("isaObjectsOf returns the isa objects in first-seen order, deduped", () => {
  const rows = [
    row("aardvark", "rdfs:subClassOf", "mammal", ["taught"]),
    row("aardvark", "mgx:atLocation", "Africa", ["taught"]),
    row("aardvark", "rdfs:subClassOf", "mammal", ["taught"]),
    row("aardvark", "rdf:type", "animal", ["taught"]),
  ];
  assert.deepEqual(isaObjectsOf(rows), ["mammal", "animal"]);
});

test("digestTermFromRows reduces a fan-out to a bounded, sourced paragraph", () => {
  const wanted = [
    row("aardvark", "rdfs:subClassOf", "mammal", ["referenceLive"], { provenance: "research:Aardvark@0" }),
    row("aardvark", "mgx:atLocation", "Africa", ["referenceLive"], { provenance: "research:Aardvark@0" }),
    row("aardvark", "mgx:capableOf", "dig", ["corpus"], { provenance: "corpus:conceptnet" }),
  ];
  const noise = ["entity", "abstraction", "thing"].map((c) => row("aardvark", "rdfs:subClassOf", c, ["entailed"]));
  const termRows = [...wanted, ...noise];
  // A store where entity/abstraction/thing are shared by nearly every subject,
  // so each sits well over the uninformative-class share threshold.
  const bulk = [];
  for (let i = 0; i < 200; i += 1) for (const c of ["entity", "abstraction", "thing"]) bulk.push(row(`s${i}`, "rdfs:subClassOf", c, ["entailed"]));
  const article = digestTermFromRows("aardvark", termRows, [...termRows, ...bulk], { budget: 5 });
  const prose = article.paragraphs.join("\n");
  assert.match(article.paragraphs[0], /^An? aardvarks? (is|are) /);
  assert.match(prose, /mammal/i);
  assert.match(prose, /Africa/i);
  for (const n of ["entity", "abstraction", "thing"]) assert.ok(!prose.toLowerCase().includes(n), `"${n}" leaked: ${prose}`);
  assert.equal(article.detail.factCount, termRows.length);
  assert.equal(article.detail.escapes.facts, "show the facts");
  assert.ok(article.sources.some((s) => s.provenance === "research:Aardvark@0"));
});

test("digestTermFromRows is null-safe on an empty term", () => {
  const article = digestTermFromRows("nothing", [], [], { budget: 5 });
  // With no rows the pipeline still returns an article shape (empty narrative),
  // never throws — the surface decides whether to fall back.
  assert.ok(article === null || article.kind === "term-article");
});
