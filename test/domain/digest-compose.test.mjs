// Composition orders the selected facts into sentences and paragraphs: the lead
// names the term, later sentences refer back with a pronoun, paragraphs respect
// the sentence cap, and every sentence keeps the rows behind it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { buildStructureTable } from "../../src/domain/digest/structures.mjs";
import { composeTermDigest } from "../../src/domain/digest/compose.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BANK = join(HERE, "..", "..", "data", "templates", "constructions", "digest-sentence-structures.toml");
const table = buildStructureTable(parseToml(readFileSync(BANK, "utf8")).structure);

const sel = (family, predicate, object) => ({
  family, row: { id: `${predicate}:${object}`, subject: "aardvark", predicate, object },
});

test("the lead sentence names the term, the next refers back as 'It'", () => {
  const selection = {
    term: "aardvark",
    selected: [sel("isa", "rdfs:subClassOf", "mammal"), sel("location", "mgx:atLocation", "Africa")],
  };
  const out = composeTermDigest(selection, table);
  assert.equal(out.sentences[0].text, "An aardvark is a mammal.");
  assert.equal(out.sentences[1].text, "It is found in Africa.");
});

test("with no isa lead, the first description sentence still names the term", () => {
  const selection = { term: "aardvark", selected: [sel("capableOf", "mgx:capableOf", "dig")] };
  const out = composeTermDigest(selection, table);
  assert.equal(out.sentences[0].text, "An aardvark can dig.");
});

test("definition and description land in separate paragraphs", () => {
  const selection = {
    term: "aardvark",
    selected: [sel("isa", "rdfs:subClassOf", "mammal"), sel("capableOf", "mgx:capableOf", "dig")],
  };
  const out = composeTermDigest(selection, table);
  assert.equal(out.paragraphs.length, 2);
  assert.equal(out.paragraphs[0].text, "An aardvark is a mammal.");
  assert.equal(out.paragraphs[1].text, "It can dig.");
});

test("a paragraph never exceeds the sentence cap", () => {
  const selection = {
    term: "aardvark",
    selected: [
      sel("location", "mgx:atLocation", "Africa"),
      sel("partOf", "mgx:partOf", "ecosystem"),
      sel("capableOf", "mgx:capableOf", "dig"),
      sel("usedFor", "mgx:usedFor", "study"),
    ],
  };
  const out = composeTermDigest(selection, table, { maxSentencesPerParagraph: 2 });
  assert.ok(out.paragraphs.every((p) => p.sentences.length <= 2));
});

test("every composed sentence carries the fact rows it was built from", () => {
  const selection = { term: "aardvark", selected: [sel("isa", "rdfs:subClassOf", "mammal")] };
  const out = composeTermDigest(selection, table);
  assert.equal(out.sentences[0].rows[0].id, "rdfs:subClassOf:mammal");
  assert.equal(out.provenanceRows.length, 1);
});

test("a lone isa fact with an ancestry chain renders the chained form", () => {
  const selection = { term: "aardvark", selected: [sel("isa", "rdfs:subClassOf", "mammal")] };
  const out = composeTermDigest(selection, table, { chains: { mammal: ["mammal", "vertebrate", "animal"] } });
  assert.equal(out.sentences[0].text, "An aardvark is a mammal, and so a vertebrate and an animal.");
});
