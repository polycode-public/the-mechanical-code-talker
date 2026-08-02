// `tmct extract` (src/services/extract-facts.mjs) tests — sentence splitting,
// the honest recognized/skipped split, the --repo write path, and the default
// stdout/--out JSONL path (kept separate, per the verb's own design: --repo
// mutates a real tmct memory; the default path never mutates anything real).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main, ingestText, optimisticTriples, clauseCandidates } from "../../src/services/extract-facts.mjs";
import { splitSentences } from "../../src/services/sentences.mjs";
import { loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";
import { SOURCE_PRIOR } from "../../src/domain/memory/trust.mjs";

const FIXTURE_TEXT = [
  "Every module is a component.", // recognized: universal class-membership
  "Remember that dogs are mammals.", // recognized: teach-lane property frame
  "Grace mentors Alan.", // recognized: bare general-verb frame
  "Is this a real sentence?", // unrecognized: a question
  "The quick brown fox jumps over something vague.", // unrecognized: ordinary prose
  "Once upon a time, in a land far away, there lived a king.", // unrecognized: narrative fragment
].join(" ");

test("splitSentences: wink-nlp sentence-boundary detection, not a naive regex split", () => {
  const sentences = splitSentences(FIXTURE_TEXT);
  assert.equal(sentences.length, 6);
  assert.equal(sentences[0], "Every module is a component.");
  assert.equal(sentences[3], "Is this a real sentence?");
  // honest edge cases: blank/empty input never throws, just yields nothing
  assert.deepEqual(splitSentences(""), []);
  assert.deepEqual(splitSentences("   "), []);
});

test("extract-facts-from-text: default (no --repo) path — ephemeral, prints JSONL to stdout, mutates nothing real", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-extract-fixture-"));
  const file = join(dir, "sample.txt");
  await writeFile(file, FIXTURE_TEXT, "utf8");

  const logged = [];
  const originalLog = console.log;
  console.log = (line) => logged.push(line);
  let result;
  try {
    result = await main([file]);
  } finally {
    console.log = originalLog;
    await rm(dir, { recursive: true, force: true });
  }

  // Honest partial extraction: 6 sentences found, only the 3 recognized shapes
  // become facts — nothing fabricated for the other 3.
  assert.equal(result.sentences, 6);
  assert.equal(result.recognized, 3);
  assert.equal(result.extracted.length, 3);

  const rows = logged.map((l) => JSON.parse(l));
  assert.equal(rows.length, 3);
  const bySubject = Object.fromEntries(rows.map((r) => [r.subject, r]));
  assert.equal(bySubject.module.object, "component");
  assert.equal(bySubject.module.provenance, "extracted:sample.txt");
  assert.ok(rows.every((r) => r.provenance === "extracted:sample.txt"));
  // Never fabricated: no row's sentence is one of the unrecognized ones.
  const sentences = rows.map((r) => r.sentence);
  assert.ok(!sentences.includes("Is this a real sentence?"));
  assert.ok(!sentences.includes("The quick brown fox jumps over something vague."));
  assert.ok(!sentences.includes("Once upon a time, in a land far away, there lived a king."));
});

test("extract-facts-from-text: --out writes the same JSONL to a file instead of stdout", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-extract-out-"));
  const file = join(dir, "sample.txt");
  const outFile = join(dir, "facts.jsonl");
  await writeFile(file, FIXTURE_TEXT, "utf8");

  const logged = [];
  const originalLog = console.log;
  console.log = (line) => logged.push(line);
  let result;
  try {
    result = await main([file, "--out", outFile]);
  } finally {
    console.log = originalLog;
  }

  try {
    // Nothing on stdout when --out is given.
    assert.equal(logged.length, 0);
    const body = await readFile(outFile, "utf8");
    const lines = body.trim().split("\n").filter(Boolean);
    assert.equal(lines.length, result.extracted.length);
    assert.equal(lines.length, 3);
    for (const line of lines) {
      const row = JSON.parse(line);
      assert.ok(row.subject && row.predicate && row.object, "round-trips subject/predicate/object");
      assert.equal(row.provenance, "extracted:sample.txt");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("extract-facts-from-text: --repo writes straight into that repo's tmct memory, tagged and trust-scored", async () => {
  const repoDir = await mkdtemp(join(tmpdir(), "tmct-extract-repo-"));
  const file = join(repoDir, "sample.txt");
  await writeFile(file, FIXTURE_TEXT, "utf8");

  try {
    const result = await main([file, "--repo", repoDir]);
    assert.equal(result.recognized, 3);

    const mem = await loadMemory(repoDir);
    const rows = readFactRows(mem);
    assert.equal(rows.length, 3);

    const moduleRow = rows.find((r) => r.subject === "module");
    assert.ok(moduleRow, "the recognized fact landed in the repo's own memory");
    // Additive: the recognizer's own ace:/teach: provenance survives ALONGSIDE
    // the new extracted: audit tag — never replaced.
    assert.match(moduleRow.provenance, /ace:chat:/);
    assert.match(moduleRow.provenance, /extracted:sample\.txt/);
    assert.ok(moduleRow.sourceTypes.includes("extracted"));
    assert.ok(moduleRow.trust > 0, "trust is computed, not hand-set");
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

// ---- the optimistic fuzzy tier -------------------------------------------

test("optimisticTriples: a copula between two nouns yields an isa candidate; prose without a clean pair yields none", () => {
  assert.deepEqual(optimisticTriples("In the wild, an otter is a small mammal."),
    [{ subject: "otter", predicate: "rdfs:subClassOf", object: "mammal" }]);
  assert.deepEqual(optimisticTriples("Dogs are friendly animals of course."),
    [{ subject: "dog", predicate: "rdfs:subClassOf", object: "animal" }]);
  // an adjective/preposition either side of the verb is never mistaken for the entity
  assert.deepEqual(optimisticTriples("The quick brown fox jumps over something vague."), []);
  // too short to hold a triple
  assert.deepEqual(optimisticTriples("Hello there."), []);
});

test("ingestText: the optimistic tier stores a strict-skipped candidate under its own low-trust source kind", async () => {
  const repoDir = await mkdtemp(join(tmpdir(), "tmct-ingest-opt-"));
  try {
    const strict = await ingestText("In the wild, an otter is a small mammal.", { memoryDir: repoDir, sourceTag: "wild.txt" });
    assert.equal(strict.recognized, 0, "the leading clause makes this a strict skip");
    assert.equal(strict.optimistic.length, 0, "optimistic is off by default");

    const opt = await ingestText("In the wild, an otter is a small mammal.", { memoryDir: repoDir, sourceTag: "wild.txt", optimistic: true });
    assert.equal(opt.optimistic.length, 1);
    assert.equal(opt.optimistic[0].subject, "otter");
    assert.equal(opt.optimistic[0].provenance, "optimistic-extract:wild.txt");

    const rows = readFactRows(await loadMemory(repoDir));
    const otter = rows.find((r) => r.subject === "otter" && r.object === "mammal");
    assert.ok(otter, "the candidate landed in the store");
    assert.ok(otter.sourceTypes.includes("optimisticExtract"));
    // it carries NO operator/teach tag, so it stays at its own low prior — below
    // even a lone curated pack article
    assert.ok(!otter.sourceTypes.includes("operator") && !otter.sourceTypes.includes("teach"));
    assert.ok(otter.trust <= SOURCE_PRIOR.optimisticExtract, `${otter.trust} is at or below the optimistic prior`);
    assert.ok(otter.trust < SOURCE_PRIOR.reference, "a fuzzy candidate ranks below a curated pack article");
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test("ingestText: ephemeral (no memoryDir) grounds facts and mutates nothing on disk", async () => {
  const result = await ingestText("Every module is a component. Grace mentors Alan.");
  assert.equal(result.recognized, 2);
  assert.equal(result.extracted.length, 2);
  assert.ok(result.extracted.every((f) => /^extracted:/.test(f.provenance)));
});

test("ingestText: a leading ordinal adverb threads a capability across two sentences", async () => {
  const result = await ingestText("First a cell grows. Then it splits.");
  assert.equal(result.recognized, 2, "both the lead sentence and the threaded pronoun sentence ground");
  const has = (s, p, o) => result.extracted.some((f) => f.subject === s && f.predicate === p && f.object === o);
  assert.ok(has("cell", "mgx:capableOf", "grow"), '"First a cell grows." grounds cell capableOf grow');
  assert.ok(has("cell", "mgx:capableOf", "split"), '"Then it splits." carries the cell subject and grounds split');
  assert.ok(!result.extracted.some((f) => f.subject === "it"), "the pronoun is never stored as a subject");
});

test("ingestText: a leading temporal adverb before a habitual clause grounds it", async () => {
  const result = await ingestText("First a seed sprouts. Then it flowers.");
  const has = (s, p, o) => result.extracted.some((f) => f.subject === s && f.predicate === p && f.object === o);
  assert.ok(has("seed", "mgx:capableOf", "sprout"), "the ordinal lead-in is stripped before the habitual match");
  assert.ok(has("seed", "mgx:capableOf", "flower"), "the threaded pronoun sentence grounds the second capability");
});

// ---- clause candidates ---------------------------------------------------

test("clauseCandidates: whole sentence first, then verb-bearing clauses of a marker split", () => {
  const cands = clauseCandidates("They are one department because both want to sell products");
  assert.equal(cands[0], "They are one department because both want to sell products", "the whole sentence leads");
  assert.ok(cands.includes("They are one department"), "the head clause is a fallback");
  assert.ok(cands.includes("both want to sell products"), "the because-clause is a fallback");
  // a sentence with no clause marker offers only itself
  assert.deepEqual(clauseCandidates("A quasar is a bright object"), ["A quasar is a bright object"]);
  // a fragment under three tokens, or one with no verb, is never offered
  const short = clauseCandidates("cats and dogs");
  assert.deepEqual(short, ["cats and dogs"], "a verbless two-token clause is dropped");
});

// ---- the Simple-English-Wikipedia Sales paragraph ------------------------

const SALES_PARAGRAPH =
  "Sales are activities related to selling or the number of goods sold in a period.[3] "
  + "Sales are closely connected with marketing. "
  + "They are often seen as one department, because both want to sell products. "
  + "Sales and marketing have the same goal.";

test("ingestText: the Sales paragraph yields the decomposed facts and never a garbled pronoun fact", async () => {
  const repoDir = await mkdtemp(join(tmpdir(), "tmct-ingest-sales-"));
  try {
    const result = await ingestText(SALES_PARAGRAPH, { memoryDir: repoDir, sourceTag: "sales.txt" });
    const rows = readFactRows(await loadMemory(repoDir));
    const has = (s, p, o) => rows.some((f) => f.subject === s && f.predicate === p && f.object === o);

    // the copula-NP decomposition: class membership + the trailing relation
    assert.ok(has("sales", "rdfs:subClassOf", "activity"), "sales is a kind of activity");
    assert.ok(has("sales", "mgx:related-to", "selling"), "sales is related to selling");
    // the participle + preposition frame, adverb skipped
    assert.ok(has("sales", "mgx:connected-with", "marketing"), "sales is connected with marketing");
    // the shared-attribute frame (sentence 4)
    assert.ok(has("sales", "mgx:same-goal-as", "marketing"), "sales shares a goal with marketing");
    assert.ok(result.recognized >= 3, "at least three sentences are recognized");

    // the because-clause sentence may honestly skip, but the pronoun carry must
    // never mint a garbled "they"/department fact
    assert.ok(!rows.some((f) => f.subject === "they" || f.subject === "it"), "no pronoun subject is ever stored");
    assert.ok(!rows.some((f) => /department|product/.test(f.object)), "the because-clause never garbles into a fact");
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test("ingestText: citation markers are stripped before grounding", async () => {
  const repoDir = await mkdtemp(join(tmpdir(), "tmct-ingest-cite-"));
  try {
    await ingestText("Sales are closely connected with marketing.[3]", { memoryDir: repoDir, sourceTag: "c.txt" });
    const rows = readFactRows(await loadMemory(repoDir));
    assert.ok(rows.some((f) => f.subject === "sales" && f.object === "marketing"), "the [3] never blocks the read");
    assert.ok(!rows.some((f) => /\[|\]|3/.test(f.object)), "no citation residue rode into a stored term");
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test("ingestText: an imperative or a listing request still declines, never a fabricated fact", async () => {
  assert.equal((await ingestText("Tell me a joke.")).recognized, 0, "an imperative grounds nothing");
  assert.equal((await ingestText("List modules in nope.")).recognized, 0, "a listing request grounds nothing");
});

test("ingestText: --canonical renders each ingested fact as a triple linked back into the store", async () => {
  const repoDir = await mkdtemp(join(tmpdir(), "tmct-ingest-canon-"));
  try {
    const result = await ingestText("Every module is a component. Every component is a unit.", { memoryDir: repoDir, canonical: true });
    assert.ok(Array.isArray(result.canonical));
    assert.equal(result.canonical.length, result.extracted.length);
    // "component" is both an object (of module) and a subject (of unit), so its
    // canonical line names the other fact it links to
    const componentLine = result.canonical.find((l) => l.startsWith("module "));
    assert.match(componentLine, /module subClassOf component/);
    assert.match(componentLine, /links to/);
  } finally {
    await rm(repoDir, { recursive: true, force: true });
  }
});

test("optimisticTriples: the isa scan never crosses a clause or a prepositional complement", () => {
  // A copula inside a subordinate frame is not "X is-a Y" — the nouns either
  // side belong to different clauses.
  assert.deepEqual(
    optimisticTriples("One big reason life can exist here is that Earth has a lot of water on its surface."),
    [],
  );
  // A locative "is in" is placement, not class membership.
  assert.deepEqual(
    optimisticTriples("Most of Earth's water is in the oceans, which cover most of the planet's surface."),
    [],
  );
  // A passive participle after the copula is not class membership either.
  assert.deepEqual(
    optimisticTriples("Most of this land is grouped into large continents, like North America and Africa."),
    [],
  );
  // The clean copula frames those guards must not touch.
  assert.deepEqual(
    optimisticTriples("Earth is the third planet from the Sun and the only place known where life exists."),
    [{ subject: "earth", predicate: "rdfs:subClassOf", object: "planet" }],
  );
  // The relative clause "that has lava" predicates about the SENTENCE subject:
  // the isa AND the relation verb it grounds both come out of one sentence.
  assert.deepEqual(
    optimisticTriples("A volcano is a mountain that has lava coming out from a magma chamber under the ground."),
    [
      { subject: "volcano", predicate: "rdfs:subClassOf", object: "mountain" },
      { subject: "volcano", predicate: "tmct:has", object: "lava" },
    ],
  );
});

test("optimisticTriples: a compound noun is captured whole, never reduced to its modifier", () => {
  // "string instrument" is the class; "string" alone is its modifier and a
  // wrong fact ("a violin is a kind of string"). The "which has four strings"
  // relative clause binds to the sentence subject, so a true relation fact comes
  // out alongside the isa.
  assert.deepEqual(
    optimisticTriples("The violin is a string instrument which has four strings and is played with a bow."),
    [
      { subject: "violin", predicate: "rdfs:subClassOf", object: "string instrument" },
      { subject: "violin", predicate: "tmct:has", object: "string" },
    ],
  );
  // The subject side captures its run the same way.
  assert.deepEqual(
    optimisticTriples("A guinea pig is a small rodent."),
    [{ subject: "guinea pig", predicate: "rdfs:subClassOf", object: "rodent" }],
  );
  // Single-word entities keep the plain lemma fold.
  assert.deepEqual(
    optimisticTriples("A dog is an animal."),
    [{ subject: "dog", predicate: "rdfs:subClassOf", object: "animal" }],
  );
});

test("optimisticTriples: an attributive hyphenated adjective is skipped; the real head noun after a modifier list is the class", () => {
  // wink tokenizes "medium-sized" as medium/NOUN + "-"/PUNCT + sized/VERB and
  // never re-fuses it, so a naive noun-run stops at "medium" and mints the wrong
  // class. The object scan must walk past the whole coordinate modifier list
  // ("medium-sized, burrowing, nocturnal") to the real head noun "mammal".
  assert.deepEqual(
    optimisticTriples("The aardvark is a medium-sized, burrowing, nocturnal mammal."),
    [{ subject: "aardvark", predicate: "rdfs:subClassOf", object: "mammal" }],
  );
  // A hyphenated compound whose second half is not a VERB/ADJ (mother-in-law:
  // NOUN + "-" + ADP) never triggers the attributive walk. This sentence's
  // pre-existing "law ⊑ teacher" read (a separate subject-side truncation, not
  // fixed here) is confirmed unchanged, so the new check did not make it worse.
  assert.deepEqual(
    optimisticTriples("My mother-in-law is a teacher."),
    [{ subject: "law", predicate: "rdfs:subClassOf", object: "teacher" }],
  );
});

test("optimisticTriples: a partitive container is composition, never a class; a classifier reads through", () => {
  // "a large body of ice" states what a glacier is made of, not what kind of
  // thing it is — no isa at all.
  assert.deepEqual(optimisticTriples("A glacier is a large body of ice and snow."), []);
  assert.deepEqual(optimisticTriples("A lake is a large body of water."), []);
  // A classifier head reads through to the real class.
  assert.deepEqual(
    optimisticTriples("A dog is a type of mammal."),
    [{ subject: "dog", predicate: "rdfs:subClassOf", object: "mammal" }],
  );
  // A plain content head before "of" keeps the outer class.
  assert.deepEqual(
    optimisticTriples("Chess is a game of skill."),
    [{ subject: "chess", predicate: "rdfs:subClassOf", object: "game" }],
  );
});

test("optimisticTriples: a naming periphrasis stays copular; the copula's own modal chain is crossable", () => {
  assert.deepEqual(
    optimisticTriples("An identifier can be termed as a name given to something unique, an object, or a set of objects."),
    [{ subject: "identifier", predicate: "rdfs:subClassOf", object: "name" }],
  );
  // "is grouped into" has no "as" — still a passive complement, still no isa.
  assert.deepEqual(
    optimisticTriples("Most of this land is grouped into large continents, like North America."),
    [],
  );
});

test("optimisticTriples: a verb-tier of-chain subject climbs to its head, never the inner noun", () => {
  // The nearest noun left of "creates" is the of-chain's inner noun ("snow");
  // the grammatical subject is its head ("weight"), reached by a two-hop climb
  // through "of all of the".
  assert.deepEqual(
    optimisticTriples("The weight of all of the snow creates pressure."),
    [{ subject: "weight", predicate: "tmct:creates", object: "pressure" }],
  );
  // The same climb over a single "of".
  assert.deepEqual(
    optimisticTriples("The pressure of the ice creates heat."),
    [{ subject: "pressure", predicate: "tmct:creates", object: "heat" }],
  );
  // A classifier head reads THROUGH — "a kind of X" outer never becomes the
  // subject, so the inner noun is kept.
  assert.deepEqual(
    optimisticTriples("A kind of snow creates pressure."),
    [{ subject: "snow", predicate: "tmct:creates", object: "pressure" }],
  );
});

test("optimisticTriples: a copula-subject of-chain with no readable head abstains, never the inner-noun confusion", () => {
  // "The top of the mountain is a crater" is not "mountain ⊑ crater": the
  // subject is "top", which the tagger reads as a modifier, so no readable head
  // fronts the of-chain and the frame abstains rather than store the inner noun.
  assert.deepEqual(optimisticTriples("The top of the mountain is a crater."), []);
});

test("optimisticTriples: a non-relative multi-verb sentence contributes a fact per clause", () => {
  // Two coordinated clauses, each with its own nearest-entity-leftward subject:
  // one sentence, two facts, neither in a relative frame.
  assert.deepEqual(
    optimisticTriples("A furnace produces heat and a pump creates pressure."),
    [
      { subject: "furnace", predicate: "tmct:produces", object: "heat" },
      { subject: "pump", predicate: "tmct:creates", object: "pressure" },
    ],
  );
});

test("optimisticTriples: a relation-verb run-on stays bounded, never shatters into noise", () => {
  const triples = optimisticTriples(
    "A machine uses power and has parts and contains gears and produces motion and creates force and needs oil.",
  );
  assert.ok(triples.length <= 4, `bounded to at most four triples, got ${triples.length}`);
  assert.deepEqual(triples[0], { subject: "machine", predicate: "tmct:uses", object: "power" });
});

test("optimisticTriples: the widened tiers leave every abstention and clean-isa guard exactly as before", () => {
  // The abstention guards — each must still ground nothing.
  for (const s of [
    "One big reason life can exist here is that Earth has a lot of water on its surface.",
    "Most of Earth's water is in the oceans, which cover most of the planet's surface.",
    "Most of this land is grouped into large continents, like North America and Africa.",
    "A glacier is a large body of ice and snow.",
    "A lake is a large body of water.",
    "The quick brown fox jumps over something vague.",
  ]) {
    assert.deepEqual(optimisticTriples(s), [], `still abstains: ${s}`);
  }
  // The clean single-isa frames — each still exactly one class fact and nothing
  // more (no spurious relation triple crept in behind the copula).
  assert.deepEqual(optimisticTriples("In the wild, an otter is a small mammal."),
    [{ subject: "otter", predicate: "rdfs:subClassOf", object: "mammal" }]);
  assert.deepEqual(optimisticTriples("A guinea pig is a small rodent."),
    [{ subject: "guinea pig", predicate: "rdfs:subClassOf", object: "rodent" }]);
  assert.deepEqual(optimisticTriples("A dog is a type of mammal."),
    [{ subject: "dog", predicate: "rdfs:subClassOf", object: "mammal" }]);
  assert.deepEqual(optimisticTriples("Chess is a game of skill."),
    [{ subject: "chess", predicate: "rdfs:subClassOf", object: "game" }]);
  assert.deepEqual(
    optimisticTriples("An identifier can be termed as a name given to something unique, an object, or a set of objects."),
    [{ subject: "identifier", predicate: "rdfs:subClassOf", object: "name" }]);
});

test("a skip held up by an ungrounded term is reported as that, not as an unrecognized shape", async () => {
  // "A wombat is a marsupial." is the same shape as "A kestrel is a bird.",
  // which IS recognized. The difference is the vocabulary, so the summary has
  // to name the terms rather than blame the sentence.
  const result = await ingestText("A kestrel is a bird. A wombat is a marsupial.");
  assert.equal(result.recognized, 1, "the grounded sentence still lands");
  assert.equal(result.skipped, 1);
  assert.deepEqual([...result.ungroundedTerms].sort(), ["marsupial", "wombat"]);
});

test("a skip that really is an unrecognized shape names no ungrounded term", async () => {
  const result = await ingestText("Tell me a joke.");
  assert.equal(result.recognized, 0);
  assert.deepEqual(result.ungroundedTerms, []);
});
