// A module path like `src/core/store.mjs` must survive sentence splitting
// whole. wink's own boundary detector breaks it into "src/core/store." + "mjs",
// so the file-teaching callers (tmct extract, tmct import) route text through
// splitSentencesPreservingPaths, which only trusts wink on a line that carries
// a real terminator-then-space-then-word boundary.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  splitSentencesPreservingPaths,
  carriesASentenceBoundary,
} from "../../src/services/sentences.mjs";
import { main as extractMain } from "../../src/services/extract-facts.mjs";
import { importDefinitionFile } from "../../src/services/import-file.mjs";

test("carriesASentenceBoundary: true only for a terminator followed by whitespace and a word", () => {
  assert.equal(carriesASentenceBoundary("Dogs are mammals. Cats are mammals."), true);
  assert.equal(carriesASentenceBoundary("src/core/store.mjs"), false);
  assert.equal(carriesASentenceBoundary("The entrypoint is src/core/store.mjs today"), false);
});

test("splitSentencesPreservingPaths: a bare module path stays one sentence", () => {
  assert.deepEqual(splitSentencesPreservingPaths("src/core/store.mjs"), ["src/core/store.mjs"]);
  assert.deepEqual(
    splitSentencesPreservingPaths("The entrypoint is src/core/store.mjs today"),
    ["The entrypoint is src/core/store.mjs today"],
  );
});

test("splitSentencesPreservingPaths: real multi-sentence boundaries still split, paths on their own line stay whole", () => {
  assert.deepEqual(
    splitSentencesPreservingPaths("Dogs are mammals. Cats are mammals."),
    ["Dogs are mammals.", "Cats are mammals."],
  );
  assert.deepEqual(
    splitSentencesPreservingPaths("Dogs are mammals.\nsrc/core/store.mjs is a module"),
    ["Dogs are mammals.", "src/core/store.mjs is a module"],
  );
});

test("extract-facts: a bare module path is counted as one sentence, not split across its extension dot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-extract-path-"));
  const file = join(dir, "paths.txt");
  await writeFile(file, "src/core/store.mjs\n", "utf8");
  const originalLog = console.log;
  console.log = () => {};
  let result;
  try {
    result = await extractMain([file]);
  } finally {
    console.log = originalLog;
    await rm(dir, { recursive: true, force: true });
  }
  assert.equal(result.sentences, 1);
});

test("import-file: a bare module path is taught or declined whole, never as a src/core/store. + mjs fragment pair", async () => {
  const root = await mkdtemp(join(tmpdir(), "tmct-import-path-"));
  const rel = "defs.txt";
  await writeFile(join(root, rel), "src/core/store.mjs\n", "utf8");
  let result;
  try {
    result = await importDefinitionFile(root, rel);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  assert.equal(result.sentences, 1);
  const seen = [...result.taught, ...result.declined.map((d) => d.sentence)];
  assert.ok(seen.includes("src/core/store.mjs"), "the whole path is one processed sentence");
  assert.ok(!seen.includes("src/core/store."), "no fragment ending at the extension dot");
  assert.ok(!seen.includes("mjs"), "no orphaned extension fragment");
});
