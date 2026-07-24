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
import { composeTermDigest, chunk, groupIsaByParent, closerRootsFor } from "../../src/domain/digest/compose.mjs";

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

test("a few isa facts still merge into one verbatim clause below the split threshold", () => {
  const isa = (o) => sel("isa", "rdfs:subClassOf", o);
  const two = composeTermDigest({ term: "aardvark", selected: [isa("mammal"), isa("reptile")] }, table);
  assert.equal(two.sentences[0].text, "Aardvarks are a mammal and a reptile.");
  const four = composeTermDigest({
    term: "aardvark", selected: [isa("mammal"), isa("reptile"), isa("bird"), isa("fish")],
  }, table);
  assert.equal(four.sentences[0].text, "Aardvarks are a mammal, a reptile, a bird, and a fish.");
  // Below the split threshold the whole family is one sentence, never a run-on split.
  assert.equal(four.sentences.filter((s) => s.family === "isa").length, 1);
});

test("chunk splits into runs of at most the given size, keeping order", () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([1, 2, 3], 5), [[1, 2, 3]]);
  assert.deepEqual(chunk([], 3), []);
  assert.deepEqual(chunk([1, 2], 0), [[1], [2]]); // a bad size falls back to 1
});

test("groupIsaByParent buckets shared parents and pools the singletons and unchained", () => {
  const r = (o) => ({ id: o, object: o });
  const rows = [r("a"), r("b"), r("c"), r("d"), r("e")];
  const chains = {
    a: ["a", "mammal", "animal"],
    b: ["b", "mammal", "animal"],
    c: ["c", "reptile", "animal"], // singleton parent -> leftover
    d: ["d", "mammal", "animal"],
    // e has no chain -> leftover
  };
  const groups = groupIsaByParent(rows, chains);
  // One real group (mammal, three members) then the shared leftover pool.
  assert.equal(groups.length, 2);
  assert.equal(groups[0].parent, "mammal");
  assert.deepEqual(groups[0].rows.map((x) => x.object), ["a", "b", "d"]);
  assert.equal(groups[1].parent, null);
  assert.deepEqual(groups[1].rows.map((x) => x.object), ["c", "e"]);
});

test("closerRootsFor ranks the roots the chains reach and keeps the backing rows", () => {
  const r = (o) => ({ id: o, object: o });
  const used = [r("a"), r("b"), r("c")];
  const chains = {
    a: ["a", "mammal", "animal"],
    b: ["b", "reptile", "animal"],
    c: ["c", "oak", "plant"],
  };
  const { roots, rows } = closerRootsFor(chains, used, 1);
  assert.deepEqual(roots, ["animal"]); // reached by two chains, beats plant's one
  assert.deepEqual(rows.map((x) => x.object).sort(), ["a", "b"]);
});

test("above the threshold, the isa run-on splits into opener, grouped body and closer", () => {
  const isa = (o) => sel("isa", "rdfs:subClassOf", o);
  const selected = ["p0", "p1", "g2", "g3", "g4", "g5", "g6", "leftA", "leftB"].map(isa);
  const chains = {
    p0: ["p0", "mammal", "animal"], p1: ["p1", "mammal", "animal"],
    g2: ["g2", "rodent", "animal"], g3: ["g3", "rodent", "animal"], g4: ["g4", "rodent", "animal"],
    g5: ["g5", "rodent", "animal"], g6: ["g6", "rodent", "animal"],
    // leftA / leftB have no ancestry -> shared leftover pool
  };
  const out = composeTermDigest({ term: "aardvark", selected }, table, { chains });

  const isaSentences = out.sentences.filter((s) => s.family === "isa");
  assert.equal(isaSentences[0].role, "names-term"); // exactly one opener, first
  assert.equal(isaSentences[isaSentences.length - 1].role, "closes-isa"); // exactly one closer, last
  assert.equal(isaSentences.filter((s) => s.role === "names-term").length, 1);
  assert.equal(isaSentences.filter((s) => s.role === "closes-isa").length, 1);

  const body = isaSentences.filter((s) => s.role === "describes-isa");
  // Five 'rodent' facts chunk into 4 + 1, and the two unchained pool into one -> 3 body sentences.
  assert.equal(body.length, 3);
  for (const s of body) assert.ok(s.rows.length <= 4, `a body sentence listed ${s.rows.length} objects`);

  // The closer names the shared root, not a raw fact object.
  assert.match(isaSentences[isaSentences.length - 1].text, /animal/);

  // Nothing selected goes unspoken: every isa object appears behind some isa sentence.
  const spoken = new Set(isaSentences.flatMap((s) => s.rows.map((r) => r.object)));
  for (const o of ["p0", "p1", "g2", "g3", "g4", "g5", "g6", "leftA", "leftB"]) assert.ok(spoken.has(o), `${o} unspoken`);
});
