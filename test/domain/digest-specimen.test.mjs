// Acceptance: a store that reads back as the 72-line aardvark fan-out reduces,
// through the whole pure pipeline (select -> structures -> compose -> article),
// to a bounded, readable paragraph — the wanted facts lead, the mis-sensed and
// uninformative branches drop out, and every stored fact stays reachable behind
// the escape. The bank is the real committed TOML, not a fixture.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { buildStructureTable } from "../../src/domain/digest/structures.mjs";
import { digestTerm } from "../../src/domain/digest/index.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BANK = join(HERE, "..", "..", "data", "templates", "constructions", "digest-sentence-structures.toml");
const table = buildStructureTable(parseToml(readFileSync(BANK, "utf8")).structure);

const row = (predicate, object, sourceTypes, over = {}) => ({
  id: `${predicate}:${object}`, subject: "aardvark", predicate, object,
  sourceTypes, provenance: over.provenance || sourceTypes[0], trust: over.trust ?? 0.4,
  environments: sourceTypes.includes("entailed") ? [["premise"]] : [],
});

// The store behind the specimen's second "what is an aardvark".
function specimenStore() {
  const wanted = [
    row("rdfs:subClassOf", "mammal", ["referenceLive"], { provenance: "research:Aardvark@0" }),
    row("mgx:atLocation", "Africa", ["referenceLive"], { provenance: "research:Aardvark@0" }),
    row("mgx:capableOf", "dig", ["corpus"], { provenance: "corpus:conceptnet" }),
    row("rdfs:subClassOf", "vertebrate", ["entailed"]),
    row("rdfs:subClassOf", "animal", ["entailed"]),
  ];
  // The mis-sensed and off-topic isa branches the specimen shows.
  const misSensed = [
    row("rdfs:subClassOf", "medium", ["extracted"], { provenance: "extracted:aardvark", trust: 0.45 }),
    row("rdfs:subClassOf", "state", ["entailed"]),
    row("rdfs:subClassOf", "software", ["entailed"]),
    row("rdfs:subClassOf", "legal document", ["entailed"]),
  ];
  // The correct-but-useless top classes, plus the long fan-out tail.
  const uninformative = ["entity", "abstraction", "thing", "concept"].map((c) => row("rdfs:subClassOf", c, ["entailed"]));
  const tail = [];
  for (let i = 0; i < 59; i += 1) tail.push(row("rdfs:subClassOf", `broad-class-${i}`, ["entailed"]));

  const rows = [...wanted, ...misSensed, ...uninformative, ...tail];
  const classSubjectCounts = { mammal: 4, vertebrate: 6, animal: 9, medium: 3, state: 3, software: 2, "legal document": 2 };
  for (const c of ["entity", "abstraction", "thing", "concept"]) classSubjectCounts[c] = 170;
  for (let i = 0; i < 59; i += 1) classSubjectCounts[`broad-class-${i}`] = 120;

  const subClassEdges = [
    ["mammal", "vertebrate"], ["vertebrate", "animal"], ["animal", "organism"], ["organism", "entity"],
    ["medium", "environment"], ["environment", "region"], ["region", "entity"],
    ["state", "government"], ["government", "organization"], ["organization", "entity"],
    ["software", "information"], ["information", "entity"],
    ["legal document", "document"], ["document", "artifact"], ["artifact", "entity"],
    ["abstraction", "entity"], ["thing", "entity"], ["concept", "abstraction"],
  ];
  return { rows, store: { totalSubjects: 200, classSubjectCounts, subClassEdges } };
}

test("the 72-line fan-out reduces to a bounded, readable paragraph", () => {
  const { rows, store } = specimenStore();
  const article = digestTerm("aardvark", rows, store, table, {
    budget: 5, chains: { mammal: ["mammal", "vertebrate", "animal"] },
  });
  const prose = article.paragraphs.join("\n");

  // Bounded: a handful of sentences, not 72 lines.
  const sentenceCount = (prose.match(/[.!?](\s|$)/g) || []).length;
  assert.ok(sentenceCount <= 4, `expected a short digest, got ${sentenceCount} sentences:\n${prose}`);

  // The digest opens by naming the term, and says the facts a reader wants.
  assert.match(article.paragraphs[0], /^Aardvarks? (is|are) /);
  assert.match(prose, /mammal/i);
  assert.match(prose, /found in Africa/i);
  assert.match(prose, /can dig/i);
});

test("the mis-sensed and uninformative branches never reach the narrative", () => {
  const { rows, store } = specimenStore();
  const prose = digestTerm("aardvark", rows, store, table, { budget: 5 }).paragraphs.join("\n").toLowerCase();
  for (const noise of ["medium", "software", "government", "legal document", "entity", "abstraction", "broad-class"]) {
    assert.ok(!prose.includes(noise), `"${noise}" leaked into the narrative:\n${prose}`);
  }
});

test("nothing is destroyed: every stored fact stays reachable behind the escape", () => {
  const { rows, store } = specimenStore();
  const article = digestTerm("aardvark", rows, store, table, { budget: 5 });
  assert.equal(article.detail.factCount, rows.length);
  assert.equal(article.detail.escapes.facts, "show the facts");
});

test("every narrative sentence traces to stored fact rows with provenance", () => {
  const { rows, store } = specimenStore();
  const article = digestTerm("aardvark", rows, store, table, { budget: 5 });
  assert.ok(article.provenanceRows.length > 0);
  for (const r of article.provenanceRows) {
    assert.ok(r.id && r.subject === "aardvark");
    assert.ok((r.sourceTypes || []).length > 0);
  }
  assert.ok(article.sources.some((s) => s.provenance === "research:Aardvark@0"));
});
