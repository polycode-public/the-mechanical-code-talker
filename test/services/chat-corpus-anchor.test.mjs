// The corpus-anchored grounding tier: a term a shipped corpus bundle's own
// isa row (rdfs:subClassOf/rdf:type, sourceTypes including "corpus") already
// names as a class is anchorable for the mint fallbacks even when nothing
// was ever taught about it. appendFacts with a "corpus:<bundle> ..."
// provenance tag drives provenanceTagToSource to sourceTypes:["corpus"],
// exactly what a real wordnet-xl/ConceptNet import would carry — building
// the fixture this way (rather than a full corpus load) keeps these in the
// unit ring.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runTurn, isAnchorableTerm, buildIsaTermIndex } from "../../src/services/chat.mjs";
import { appendFacts, loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";
import { loadLexicon } from "../../src/domain/grammar/lexicon.mjs";
import { clearCache } from "../../src/adapters/source.mjs";

const lex = loadLexicon();
const CORPUS_ISA = "corpus:wordnet-xl /r/IsA";

async function withCorpusStore(facts, fn) {
  const dir = await mkdtemp(join(tmpdir(), "tmct-corpus-anchor-"));
  try {
    if (facts.length) await appendFacts(dir, facts);
    return await fn(dir);
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
}

async function rows(dir) {
  return readFactRows(await loadMemory(dir));
}

test("a term with only a corpus isa fact anchors a new taught class fact", async () => {
  await withCorpusStore(
    [{ subject: "p", predicate: "rdfs:subClassOf", object: "letter", provenance: CORPUS_ISA }],
    async (dir) => {
      const taught = await runTurn("p is a kind of alphabet letter", { memoryDir: dir, sessionId: "t1" });
      assert.equal(taught.record.miss, false);
      const stored = await rows(dir);
      assert.ok(stored.some((f) => f.subject === "p" && f.predicate === "rdfs:subClassOf" && f.object === "alphabet letter"));
    },
  );
});

test("a sentence with two brand-new terms is still refused when the store carries a full corpus", async () => {
  await withCorpusStore(
    [{ subject: "p", predicate: "rdfs:subClassOf", object: "letter", provenance: CORPUS_ISA }],
    async (dir) => {
      const before = (await rows(dir)).length;
      const miss = await runTurn("florb is a kind of glorp", { memoryDir: dir, sessionId: "t2" });
      assert.equal(miss.record.miss, true);
      assert.equal((await rows(dir)).length, before, "neither brand-new term is stored");
    },
  );
});

test("the grounding nudge still names both sides when neither is anchored under any tier", async () => {
  await withCorpusStore(
    [{ subject: "p", predicate: "rdfs:subClassOf", object: "letter", provenance: CORPUS_ISA }],
    async (dir) => {
      const miss = await runTurn("florb is a glorp", { memoryDir: dir, sessionId: "t3" });
      assert.equal(miss.record.miss, true);
      assert.match(miss.answer, /I don't know "florb" or "glorp" yet\. Try grounding each one first/);
    },
  );
});

test("a corpus-anchored object anchors a brand-new subject", async () => {
  await withCorpusStore(
    [{ subject: "b", predicate: "rdfs:subClassOf", object: "consonant", provenance: CORPUS_ISA }],
    async (dir) => {
      const taught = await runTurn("florb is a kind of consonant", { memoryDir: dir, sessionId: "t4" });
      assert.equal(taught.record.miss, false);
      const stored = await rows(dir);
      assert.ok(stored.some((f) => f.subject === "florb" && f.predicate === "rdfs:subClassOf" && f.object === "consonant"));
    },
  );
});

test("a sentence whose two terms are both corpus-anchored stores rather than hitting the miss wall", async () => {
  await withCorpusStore(
    [
      { subject: "p", predicate: "rdfs:subClassOf", object: "letter", provenance: CORPUS_ISA },
      { subject: "b", predicate: "rdfs:subClassOf", object: "consonant", provenance: CORPUS_ISA },
    ],
    async (dir) => {
      const taught = await runTurn("p is a kind of consonant", { memoryDir: dir, sessionId: "t5" });
      assert.equal(taught.record.miss, false);
      const stored = await rows(dir);
      assert.ok(stored.some((f) => f.subject === "p" && f.predicate === "rdfs:subClassOf" && f.object === "consonant"));
    },
  );
});

test("a bare unquantified property claim on a corpus-anchored subject is still refused", async () => {
  await withCorpusStore(
    [{ subject: "dog", predicate: "rdfs:subClassOf", object: "mammal", provenance: CORPUS_ISA }],
    async (dir) => {
      const before = await rows(dir);
      const r = await runTurn("dog is curly", { memoryDir: dir, sessionId: "t6" });
      assert.doesNotMatch(r.answer, /noted — remembered/, "corpus-anchoring the subject alone must never unlock the bare property mint");
      assert.equal((await rows(dir)).length, before.length, "the fact store is untouched");
    },
  );
});

test("a bare unquantified property claim on a lexicon-only subject is still refused", async () => {
  await withCorpusStore([], async (dir) => {
    const r = await runTurn("module is curly", { memoryDir: dir, sessionId: "t7" });
    assert.doesNotMatch(r.answer, /noted — remembered/);
    assert.match(r.answer, /I don't recognize "curly" as a word I know/);
    assert.equal((await rows(dir)).length, 0);
  });
});

test("an every-quantified adjective claim teaches on a corpus-anchored subject", async () => {
  await withCorpusStore(
    [{ subject: "p", predicate: "rdfs:subClassOf", object: "letter", provenance: CORPUS_ISA }],
    async (dir) => {
      const taught = await runTurn("every p is curly", { memoryDir: dir, sessionId: "t8" });
      assert.equal(taught.record.miss, false);
      const stored = await rows(dir);
      const hit = stored.find((f) => f.subject === "p" && f.predicate === "mgx:hasProperty" && f.object === "curly");
      assert.ok(hit);
      assert.equal(hit.quantifier, "every");
    },
  );
});

test("the refusal names only terms unknown under every tier — an anchored subject drops out of the residue list", async () => {
  await withCorpusStore(
    [{ subject: "p", predicate: "rdfs:subClassOf", object: "letter", provenance: CORPUS_ISA }],
    async (dir) => {
      const miss = await runTurn("p is a florp", { memoryDir: dir, sessionId: "t9" });
      assert.equal(miss.record.miss, true);
      assert.match(miss.answer, /I don't recognize "florp" as a word I know/);
      assert.doesNotMatch(miss.answer, /"p"/, "the corpus-anchored term must not be named as unrecognized");
    },
  );
});

test("a refusal whose every unrecognized word is anchored reports a shape problem, not a vocabulary one", async () => {
  await withCorpusStore(
    [
      { subject: "p", predicate: "rdfs:subClassOf", object: "letter", provenance: CORPUS_ISA },
      { subject: "q", predicate: "rdfs:subClassOf", object: "letter", provenance: CORPUS_ISA },
    ],
    async (dir) => {
      const miss = await runTurn("remember that the p thing is the q thing", { memoryDir: dir, sessionId: "t10" });
      assert.equal(miss.record.miss, true);
      assert.match(miss.answer, /I know those words — I just couldn't read that sentence as a fact I can store\./);
      assert.doesNotMatch(miss.answer, /I don't recognize/);
    },
  );
});

test("teaching the triple a corpus row already holds unions the sources and keeps the corpus provenance", async () => {
  await withCorpusStore(
    [{ subject: "p", predicate: "rdfs:subClassOf", object: "letter", provenance: CORPUS_ISA }],
    async (dir) => {
      const taught = await runTurn("p is a letter", { memoryDir: dir, sessionId: "t11" });
      assert.equal(taught.record.miss, false);
      const stored = await rows(dir);
      assert.equal(stored.length, 1, "the taught claim upserts onto the existing corpus row, not a second row");
      const [row] = stored;
      assert.ok(row.sourceTypes.includes("corpus"));
      assert.ok(row.sourceTypes.includes("teach"));
      assert.match(row.provenance, /corpus:wordnet-xl/);
    },
  );
});

test("teaching a new fact about a corpus term leaves the corpus row untouched", async () => {
  await withCorpusStore(
    [{ subject: "p", predicate: "rdfs:subClassOf", object: "letter", provenance: CORPUS_ISA }],
    async (dir) => {
      const before = (await rows(dir))[0];
      const taught = await runTurn("p is a kind of glyph", { memoryDir: dir, sessionId: "t12" });
      assert.equal(taught.record.miss, false);
      const after = await rows(dir);
      const corpusRow = after.find((f) => f.object === "letter");
      assert.ok(corpusRow);
      assert.equal(corpusRow.id, before.id);
      assert.deepEqual(corpusRow.sourceTypes, before.sourceTypes);
      assert.equal(corpusRow.provenance, before.provenance);
      assert.ok(after.some((f) => f.subject === "p" && f.object === "glyph"), "the new claim lands as its own row");
    },
  );
});

test("a corpus fact that is not isa-family never anchors its terms", async () => {
  await withCorpusStore(
    [{ subject: "p", predicate: "mgx:relatedTo", object: "letter", provenance: "corpus:wordnet-xl /r/RelatedTo" }],
    async (dir) => {
      const miss = await runTurn("p is a kind of florb", { memoryDir: dir, sessionId: "t13" });
      assert.equal(miss.record.miss, true, "mgx:relatedTo is not an isa predicate, so neither side anchors");
    },
  );
});

test("an isa fact from a web source never anchors its terms", async () => {
  await withCorpusStore(
    [{ subject: "p", predicate: "rdfs:subClassOf", object: "letter", provenance: "web:example.com/p" }],
    async (dir) => {
      const miss = await runTurn("p is a kind of florb", { memoryDir: dir, sessionId: "t14" });
      assert.equal(miss.record.miss, true, "a web-sourced isa row is not the corpus band this tier anchors on");
    },
  );
});

test("buildIsaTermIndex produces the same taught/corpus-anchored Sets regardless of row order", () => {
  const facts = [
    { subject: "p", predicate: "rdfs:subClassOf", object: "letter", sourceTypes: ["corpus"] },
    { subject: "dog", predicate: "rdfs:subClassOf", object: "mammal", sourceTypes: ["operator"] },
    { subject: "x", predicate: "mgx:relatedTo", object: "y", sourceTypes: ["corpus"] }, // non-isa, ignored
  ];
  const forward = buildIsaTermIndex(facts);
  const reversed = buildIsaTermIndex([...facts].reverse());
  assert.deepEqual([...forward.taught].sort(), [...reversed.taught].sort());
  assert.deepEqual([...forward.corpusAnchored].sort(), [...reversed.corpusAnchored].sort());
  assert.deepEqual([...forward.taught].sort(), ["dog", "mammal"]);
  assert.deepEqual([...forward.corpusAnchored].sort(), ["letter", "p"]);
});

test("the isa term index rebuilds once a write nulls the shared fact-rows cache — never serves a stale answer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-corpus-anchor-cache-"));
  try {
    const cache = { rows: null };
    assert.equal(await isAnchorableTerm("newletterterm", lex, dir, cache), false, "not yet anchored");
    await appendFacts(dir, [{ subject: "newletterterm", predicate: "rdfs:subClassOf", object: "newglyphterm", provenance: CORPUS_ISA }]);
    // Same cache, no invalidation yet: still reads the index built before the
    // write — this is what identity-keying is FOR, not a bug being asserted.
    assert.equal(await isAnchorableTerm("newletterterm", lex, dir, cache), false, "stale index, same rows identity");
    cache.rows = null; // the exact invalidation every mid-turn write path in chat.mjs performs
    assert.equal(await isAnchorableTerm("newletterterm", lex, dir, cache), true, "rows identity changed — the index rebuilt and now sees the write");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
