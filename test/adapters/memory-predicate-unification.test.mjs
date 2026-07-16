// The teach lane mints a fact predicate from the verb's lemma ("fire causes
// smoke" -> mgx:cause) while the corpus vocabulary spells the same relation as
// mgx:causes. These pin the closed table in hash.mjs that folds the two onto
// one predicate, so both spellings content-address to a single fact.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normFactPredicate, factIdForTriple } from "../../src/domain/hash.mjs";
import { appendFact, appendFacts, loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";

const SESSION = "01890000-0000-7000-8000-0000000abcde";
const TS = "2026-07-16T10:00:00.000Z";

const tmpRepo = () => mkdtemp(join(tmpdir(), "tmct-pred-unify-"));

test("normFactPredicate folds every minted lemma onto the curated corpus predicate", () => {
  assert.equal(normFactPredicate("mgx:cause"), "mgx:causes");
  assert.equal(normFactPredicate("mgx:desire"), "mgx:desires");
  assert.equal(normFactPredicate("mgx:want"), "mgx:desires");
  assert.equal(normFactPredicate("mgx:require"), "mgx:hasPrerequisite");
  assert.equal(normFactPredicate("mgx:involve"), "mgx:hasSubevent");
});

test("normFactPredicate leaves an already-curated predicate, an unlisted mint and casing alone", () => {
  assert.equal(normFactPredicate("mgx:causes"), "mgx:causes");
  assert.equal(normFactPredicate("mgx:eat"), "mgx:eat");
  assert.equal(normFactPredicate("mgx:rest-on"), "mgx:rest-on");
  assert.equal(normFactPredicate("rdfs:subClassOf"), "rdfs:subClassOf");
  assert.equal(normFactPredicate("  mgx:cause  "), "mgx:causes");
});

test("a relation that inverts its arguments stays out of the table — folding it would store a lie", () => {
  assert.equal(normFactPredicate("mgx:own"), "mgx:own");
  assert.equal(normFactPredicate("mgx:create"), "mgx:create");
});

test("the minted and the curated spelling content-address to the same fact id", () => {
  assert.equal(factIdForTriple("fire", "mgx:cause", "smoke"), factIdForTriple("fire", "mgx:causes", "smoke"));
  assert.notEqual(factIdForTriple("fire", "mgx:cause", "smoke"), factIdForTriple("fire", "mgx:eat", "smoke"));
});

test("a taught 'fire causes smoke' and the corpus fact merge into one fact under the corpus predicate", async () => {
  const dir = await tmpRepo();
  try {
    const taught = await appendFact(dir, {
      subject: "fire", predicate: "mgx:cause", object: "smoke",
      provenance: `teach:chat:${SESSION}@${TS}`, createdAt: TS,
    });
    const corpus = await appendFact(dir, {
      subject: "fire", predicate: "mgx:causes", object: "smoke",
      provenance: "corpus:human /r/Causes", createdAt: TS,
    });
    assert.equal(taught.id, corpus.id);

    const rows = readFactRows(await loadMemory(dir)).filter((r) => r.subject === "fire");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].predicate, "mgx:causes");
    assert.ok(rows[0].provenance.includes(`teach:chat:${SESSION}@${TS}`));
    assert.ok(rows[0].provenance.includes("corpus:human /r/Causes"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the batch seed path folds the minted spelling exactly as the single append does", async () => {
  const dir = await tmpRepo();
  try {
    const { ids } = await appendFacts(dir, [
      { subject: "a cake", predicate: "mgx:require", object: "flour", provenance: `teach:chat:${SESSION}@${TS}` },
      { subject: "cake", predicate: "mgx:hasPrerequisite", object: "flour", provenance: "corpus:human /r/HasPrerequisite" },
    ]);
    assert.equal(ids[0], ids[1]); // one id — an upsert, never two facts

    const rows = readFactRows(await loadMemory(dir)).filter((r) => r.subject === "cake");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].predicate, "mgx:hasPrerequisite");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
