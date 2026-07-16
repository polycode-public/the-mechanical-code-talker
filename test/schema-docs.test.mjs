// schema-docs.mjs tests: (1) a drift guard — every entity class / prop token actually
// emitted by graph-build.mjs's buildEntities has a documented entry, so the schema docs
// can't silently go stale as the graph grows; (2) ingestSchemaDocs()'s correctness and
// idempotence; (3) a regression proof that ingestion never displaces real extracted data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CLASS_DOCS, PREDICATE_DOCS, ingestSchemaDocs } from "../src/schema-docs.mjs";
import { buildEntities } from "../src/adapters/graph-build.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const EXTRACT_SRC = join(here, "..", "src", "adapters", "graph-build.mjs");

test("drift guard: every `class: \"X\"` individual literal in graph-build.mjs has a CLASS_DOCS entry", async () => {
  const src = await readFile(EXTRACT_SRC, "utf8");
  const used = new Set([...src.matchAll(/class:\s*"([A-Za-z]+)"/g)].map((m) => m[1]));
  assert.ok(used.size > 0, "sanity: the regex actually found classes in graph-build.mjs");
  const documented = new Set(CLASS_DOCS.map((c) => c.name));
  for (const name of used) {
    assert.ok(documented.has(name), `graph-build.mjs emits class "${name}" with no CLASS_DOCS entry`);
  }
});

test("drift guard: every `prop: \"X\"` attribute/edge literal in graph-build.mjs has a PREDICATE_DOCS entry", async () => {
  const src = await readFile(EXTRACT_SRC, "utf8");
  const used = new Set([...src.matchAll(/prop:\s*"([a-zA-Z:]+)"/g)].map((m) => m[1]));
  assert.ok(used.size > 10, "sanity: the regex actually found a realistic number of prop tokens");
  const documented = new Set(PREDICATE_DOCS.map((p) => p.prop));
  for (const prop of used) {
    assert.ok(documented.has(prop), `graph-build.mjs emits prop "${prop}" with no PREDICATE_DOCS entry`);
  }
});

test("CLASS_DOCS / PREDICATE_DOCS: every entry has real, non-trivial description text", () => {
  for (const c of CLASS_DOCS) {
    assert.ok(c.name && typeof c.name === "string");
    assert.ok(c.description && c.description.length >= 20, `${c.name}'s description is too short/missing`);
  }
  for (const p of PREDICATE_DOCS) {
    assert.ok(p.prop && typeof p.prop === "string");
    assert.ok(p.description && p.description.length >= 20, `${p.prop}'s description is too short/missing`);
  }
  // no duplicate props (each documented exactly once)
  const props = PREDICATE_DOCS.map((p) => p.prop);
  assert.equal(new Set(props).size, props.length, "PREDICATE_DOCS has a duplicate prop entry");
});

function fakeEntities() {
  return {
    classes: [{ name: "Module", count: 1, sample: ["a.py"] }],
    vocabulary: [{ prop: "mgx:importsNamespace", predicate: "imports" }], // no note — should be backfilled
    individuals: [{ id: "mod:a.py", label: "a.py", class: "Module", derived_from: [], mentions: [], attributes: [] }],
  };
}

test("ingestSchemaDocs: backfills classes[].description and vocabulary[].note without overwriting existing text", () => {
  const e = fakeEntities();
  e.vocabulary.push({ prop: "seon:hasSuperType", predicate: "inherits", note: "a human already wrote this" });
  ingestSchemaDocs(e);
  assert.equal(e.classes[0].description, CLASS_DOCS.find((c) => c.name === "Module").description);
  assert.equal(e.vocabulary[0].note, PREDICATE_DOCS.find((p) => p.prop === "mgx:importsNamespace").description);
  assert.equal(e.vocabulary[1].note, "a human already wrote this", "an existing note must never be overwritten");
});

test("ingestSchemaDocs: appends one SchemaClass + one SchemaPredicate individual per documented term", () => {
  const e = fakeEntities();
  ingestSchemaDocs(e);
  const schemaClasses = e.individuals.filter((i) => i.class === "SchemaClass");
  const schemaPredicates = e.individuals.filter((i) => i.class === "SchemaPredicate");
  assert.equal(schemaClasses.length, CLASS_DOCS.length);
  assert.equal(schemaPredicates.length, PREDICATE_DOCS.length);
  const commitDoc = schemaClasses.find((i) => i.label === "Commit");
  assert.ok(commitDoc, "the Commit class must be documented and queryable");
  assert.match(commitDoc.attributes.find((a) => a.key === "doc").value, /git commit/i);
  const cochangeDoc = schemaPredicates.find((i) => i.label === "cochange");
  assert.ok(cochangeDoc, "cochange must be queryable by its human-facing kind name, not just its raw prop token");
  assert.equal(cochangeDoc.attributes.find((a) => a.key === "token").value, "mgx:changeCoupledWith");
});

test("ingestSchemaDocs: real code individuals are never displaced, and the real Module individual is untouched", () => {
  const e = fakeEntities();
  const before = JSON.stringify(e.individuals[0]);
  ingestSchemaDocs(e);
  assert.equal(JSON.stringify(e.individuals[0]), before, "the real Module individual must be byte-identical");
  assert.ok(e.individuals.some((i) => i.id === "mod:a.py"), "the real Module individual must still be present");
});

test("ingestSchemaDocs: idempotent — calling it twice does not duplicate schema individuals", () => {
  const e = fakeEntities();
  ingestSchemaDocs(e);
  const countAfterOnce = e.individuals.length;
  ingestSchemaDocs(e);
  assert.equal(e.individuals.length, countAfterOnce, "a second call must not append duplicate schema individuals");
});

test("buildEntities → ingestSchemaDocs end-to-end: the real typed graph is unaffected by schema-doc ingestion", () => {
  const MODULES = [{ path: "pkg/a.py", dotted: "pkg.a", imports: [], calls: [],
    defines: [{ name: "helper", kind: "function", lineno: 3, decorators: [] }] }];
  const e1 = buildEntities(MODULES, [], { generatedAt: "t" });
  const e2 = buildEntities(MODULES, [], { generatedAt: "t" });
  ingestSchemaDocs(e2);
  const realIndividuals = (arr) => arr.filter((i) => i.class !== "SchemaClass" && i.class !== "SchemaPredicate");
  assert.deepEqual(realIndividuals(e2.individuals), realIndividuals(e1.individuals),
    "ingesting schema docs must not change a single real (Module/Function/...) individual");
  assert.deepEqual(e2.objectProperties, e1.objectProperties,
    "ingesting schema docs must not touch the real edge set");
});
