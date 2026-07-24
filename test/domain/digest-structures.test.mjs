// The sentence-structure bank: the committed TOML validates and renders one
// clause per relation family, and an invalid row is dropped rather than coerced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { buildStructureTable, renderStructure } from "../../src/domain/digest/structures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BANK = join(HERE, "..", "..", "data", "templates", "constructions", "digest-sentence-structures.toml");
const bankRows = parseToml(readFileSync(BANK, "utf8")).structure;
const table = buildStructureTable(bankRows);

const fact = (predicate, object) => ({ subject: "aardvark", predicate, object });

test("the committed bank parses into a usable structure table", () => {
  assert.ok(table.size >= 6);
  assert.ok(table.has("isa:single"));
  assert.ok(table.has("capableOf:single"));
});

test("an isa single renders with the right indefinite article", () => {
  const out = renderStructure(table, "isa", [fact("rdfs:subClassOf", "mammal")], { term: "aardvark" });
  assert.equal(out.text, "An aardvark is a mammal.");
  assert.deepEqual(out.rows.map((r) => r.object), ["mammal"]);
});

test("several isa facts merge into one pluralized clause", () => {
  const facts = [fact("rdfs:subClassOf", "mammal"), fact("rdfs:subClassOf", "burrowing animal")];
  const out = renderStructure(table, "isa", facts, { term: "aardvark" });
  assert.equal(out.text, "Aardvarks are a mammal and a burrowing animal.");
});

test("a chained isa renders the ancestry after the head class", () => {
  const out = renderStructure(table, "isa", [fact("rdfs:subClassOf", "mammal")], {
    term: "aardvark", form: "chained", chain: ["mammal", "vertebrate", "animal"],
  });
  assert.equal(out.text, "An aardvark is a mammal, and so a vertebrate and an animal.");
});

test("capableOf renders a bare verb after the pronoun", () => {
  const out = renderStructure(table, "capableOf", [fact("mgx:capableOf", "dig")], { term: "aardvark" });
  assert.equal(out.text, "It can dig.");
});

test("location renders the place after the pronoun", () => {
  const out = renderStructure(table, "location", [fact("mgx:atLocation", "Africa")], { term: "aardvark" });
  assert.equal(out.text, "It is found in Africa.");
});

test("a family with no fact renders nothing", () => {
  assert.equal(renderStructure(table, "isa", [], { term: "aardvark" }), null);
});

test("buildStructureTable drops an unknown family and keeps the first of a duplicate", () => {
  const built = buildStructureTable([
    { family: "nonsense", form: "single", template: "{TERM}" },
    { family: "isa", form: "single", template: "first {A_TERM}." },
    { family: "isa", form: "single", template: "second {A_TERM}." },
  ]);
  assert.ok(!built.has("nonsense:single"));
  assert.equal(built.get("isa:single").template, "first {A_TERM}.");
});
