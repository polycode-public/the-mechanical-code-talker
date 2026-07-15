// scripts/extract-facts-from-text.mjs tests — sentence splitting, the honest
// recognized/skipped split, the --repo write path, and the default
// stdout/--out JSONL path (kept separate, per the tool's own design: --repo
// mutates a real tmct memory; the default path never mutates anything real).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { splitSentences, main } from "../../scripts/extract-facts-from-text.mjs";
import { loadMemory, readFactRows } from "../../src/memory/core.mjs";

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
