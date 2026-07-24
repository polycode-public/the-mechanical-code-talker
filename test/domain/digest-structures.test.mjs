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

test("buildStructureTable drops an unknown family and collects distinct wordings as variants", () => {
  const built = buildStructureTable([
    { family: "nonsense", form: "single", template: "{TERM}" },
    { family: "isa", form: "single", template: "first {A_TERM}." },
    { family: "isa", form: "single", template: "second {A_TERM}." },
  ]);
  assert.ok(!built.has("nonsense:single"));
  assert.deepEqual(built.get("isa:single").templates, ["first {A_TERM}.", "second {A_TERM}."]);
});

test("buildStructureTable folds an exact-string duplicate but keeps a distinct wording", () => {
  const built = buildStructureTable([
    { family: "isa", form: "single", template: "the {A_TERM}." },
    { family: "isa", form: "single", template: "the {A_TERM}." },
    { family: "isa", form: "single", template: "another {A_TERM}." },
  ]);
  assert.deepEqual(built.get("isa:single").templates, ["the {A_TERM}.", "another {A_TERM}."]);
});

test("the bank carries the new group and closer isa forms", () => {
  assert.ok(table.has("isa:group"));
  assert.ok(table.has("isa:closer"));
});

test("an isa group names the shared parent and the facts under it", () => {
  const facts = [fact("rdfs:subClassOf", "burrowing animal"), fact("rdfs:subClassOf", "nocturnal creature")];
  const out = renderStructure(table, "isa", facts, { term: "aardvark", form: "group", parent: "mammal" });
  assert.equal(out.family, "isa");
  assert.equal(out.form, "group");
  assert.match(out.text, /mammal/);
  assert.match(out.text, /burrowing animal/);
  assert.match(out.text, /nocturnal creature/);
  assert.deepEqual(out.rows.map((r) => r.object), ["burrowing animal", "nocturnal creature"]);
});

test("a closer renders override root words while its rows stay the real facts", () => {
  const facts = [fact("rdfs:subClassOf", "mammal"), fact("rdfs:subClassOf", "vertebrate")];
  const out = renderStructure(table, "isa", facts, {
    term: "aardvark", form: "closer", objectsOverride: ["animal", "organism"],
  });
  assert.match(out.text, /animal/);
  assert.match(out.text, /organism/);
  // The spoken words are the roots, but provenance still traces to the real facts.
  assert.deepEqual(out.rows.map((r) => r.object), ["mammal", "vertebrate"]);
  assert.ok(!/mammal/.test(out.text) && !/vertebrate/.test(out.text));
});

test("variant selection is deterministic for a fixed seed and can vary across seeds", () => {
  const facts = [fact("rdfs:subClassOf", "x"), fact("rdfs:subClassOf", "y")];
  const render = (seed) => renderStructure(table, "isa", facts, {
    term: "aardvark", form: "group", parent: "mammal", variantSeed: seed,
  }).text;
  // Same inputs, same output, every time.
  assert.equal(render("mammal"), render("mammal"));
  // Across the whole variant pool at least two distinct seeds pick different wordings.
  const seen = new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(render));
  assert.ok(seen.size >= 2, `expected the group pool to offer variety, saw ${seen.size} wording(s)`);
});

test("a single-wording key renders that wording for any term or seed", () => {
  // isa:several has one wording in the committed bank, so the pick is stable.
  const facts = [fact("rdfs:subClassOf", "mammal"), fact("rdfs:subClassOf", "reptile")];
  const a = renderStructure(table, "isa", facts, { term: "aardvark", variantSeed: "x" });
  const b = renderStructure(table, "isa", facts, { term: "badger", variantSeed: "y" });
  assert.equal(a.text, "Aardvarks are a mammal and a reptile.");
  assert.equal(b.text, "Badgers are a mammal and a reptile.");
});
