// `tmct extract` (src/services/extract-facts.mjs) tests — sentence splitting,
// the honest recognized/skipped split, the --repo write path, and the default
// stdout/--out JSONL path (kept separate, per the verb's own design: --repo
// mutates a real tmct memory; the default path never mutates anything real).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main, ingestText, optimisticTriples } from "../../src/services/extract-facts.mjs";
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
