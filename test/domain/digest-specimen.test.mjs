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
import DIGEST_CONFIG from "../../src/domain/digest/config.json" with { type: "json" };

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

// A store with many well-grounded isa classes for one term — the case that used
// to crush every object into a single Oxford-comma run-on. The eight good classes
// all sit in one sense cluster under animal → organism; noise classes are common
// enough to be cut as uninformative.
function manyClassStore() {
  const good = ["mammal", "rodent", "insectivore", "burrower", "digger", "vertebrate", "creature", "animal"]
    .map((c) => row("rdfs:subClassOf", c, ["referenceLive"], { provenance: "research:Aardvark@0" }));
  const describe = [
    row("mgx:atLocation", "Africa", ["referenceLive"], { provenance: "research:Aardvark@0" }),
    row("mgx:capableOf", "dig", ["corpus"], { provenance: "corpus:conceptnet" }),
  ];
  const noise = ["entity", "thing"].map((c) => row("rdfs:subClassOf", c, ["entailed"]));
  const tail = [];
  for (let i = 0; i < 40; i += 1) tail.push(row("rdfs:subClassOf", `broad-class-${i}`, ["entailed"]));

  const rows = [...good, ...describe, ...noise, ...tail];
  const classSubjectCounts = {
    mammal: 5, rodent: 3, insectivore: 3, burrower: 3, digger: 3, vertebrate: 6, creature: 8, animal: 9,
  };
  for (const c of ["entity", "thing"]) classSubjectCounts[c] = 180;
  for (let i = 0; i < 40; i += 1) classSubjectCounts[`broad-class-${i}`] = 120;

  const subClassEdges = [
    ["rodent", "mammal"], ["insectivore", "mammal"], ["burrower", "mammal"], ["digger", "mammal"],
    ["mammal", "animal"], ["vertebrate", "animal"], ["creature", "organism"], ["animal", "organism"],
  ];
  const chains = {
    rodent: ["rodent", "mammal", "animal", "organism"],
    insectivore: ["insectivore", "mammal", "animal", "organism"],
    burrower: ["burrower", "mammal", "animal", "organism"],
    digger: ["digger", "mammal", "animal", "organism"],
    mammal: ["mammal", "animal", "organism"],
    vertebrate: ["vertebrate", "animal", "organism"],
    creature: ["creature", "organism"],
    animal: ["animal", "organism"],
  };
  return { rows, store: { totalSubjects: 200, classSubjectCounts, subClassEdges }, chains };
}

test("a term with many isa classes never renders one run-on sentence", () => {
  const { rows, store, chains } = manyClassStore();
  const article = digestTerm("aardvark", rows, store, table, { budget: 12, chains });
  const sentences = article.body.flatMap((p) => p.sentences);
  const cap = DIGEST_CONFIG.maxObjectsPerBodySentence;

  // The old code emitted one isa sentence listing all eight classes; the split
  // spreads them across several bounded sentences.
  const isaSentences = sentences.filter((s) => s.family === "isa");
  assert.ok(isaSentences.length >= 3, `expected the isa run to split, got ${isaSentences.length} isa sentence(s)`);

  // No sentence speaks more than the per-sentence object cap. The closer speaks
  // root words (not its backing facts), so it is measured by its rendered series.
  for (const s of sentences) {
    if (s.role === "closes-isa") continue;
    assert.ok(s.rows.length <= cap, `a ${s.family} sentence listed ${s.rows.length} objects (cap ${cap})`);
  }

  // Bounded relative to the fact count: a handful of sentences over dozens of facts.
  assert.ok(sentences.length <= 10, `expected a bounded digest, got ${sentences.length} sentences`);
  assert.ok(article.detail.factCount >= 40);
  assert.ok(sentences.length * 3 < article.detail.factCount);
});

test("the many-class digest closes by naming a real higher-level ancestor", () => {
  const { rows, store, chains } = manyClassStore();
  const article = digestTerm("aardvark", rows, store, table, { budget: 12, chains });
  const sentences = article.body.flatMap((p) => p.sentences);
  const closer = sentences.find((s) => s.role === "closes-isa");
  assert.ok(closer, "expected a closing sentence");
  // "organism" is the top of every good class's chain in this store.
  assert.match(closer.text, /organism/);
  // The closer keeps real backing facts for provenance.
  assert.ok(closer.rows.length > 0);
  assert.ok(closer.rows.every((r) => r.subject === "aardvark"));
});

test("the many-class split still speaks the wanted description facts", () => {
  const { rows, store, chains } = manyClassStore();
  const prose = digestTerm("aardvark", rows, store, table, { budget: 12, chains }).paragraphs.join("\n");
  assert.match(prose, /Africa/i);
  assert.match(prose, /dig/i);
  for (const noise of ["entity", "thing", "broad-class"]) {
    assert.ok(!prose.toLowerCase().includes(noise), `"${noise}" leaked into the split narrative:\n${prose}`);
  }
});
