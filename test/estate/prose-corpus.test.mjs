// scripts/lib/text-corpus.mjs loads corpus/prose/ — the frozen prose corpus
// that feeds the rescue pass and the coverage harness. The point of freezing it
// was that the corpus must not move unless someone deliberately re-fetches it,
// so the properties worth guarding are determinism and the purity of the
// splitter, not any particular sentence count.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { splitProseSentences, loadProseCorpus, proseCorpusFiles } from "../../scripts/lib/text-corpus.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROSE_DIR = join(REPO_ROOT, "corpus", "prose");

async function withCorpus(files, run) {
  const dir = await mkdtemp(join(tmpdir(), "tmct-prose-"));
  try {
    for (const [path, body] of Object.entries(files)) {
      await mkdir(join(dir, dirname(path)), { recursive: true });
      await writeFile(join(dir, path), body);
    }
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("splits plain prose on sentence-ending punctuation, dropping the terminator", () => {
  assert.deepEqual(
    splitProseSentences("A penguin is a bird. Penguins cannot fly! Can an ostrich fly?"),
    ["A penguin is a bird", "Penguins cannot fly", "Can an ostrich fly"],
  );
});

test("drops fragments shorter than three words", () => {
  assert.deepEqual(splitProseSentences("Yes. A bird is an animal. No."), ["A bird is an animal"]);
});

test("strips fenced code blocks rather than reading them as sentences", () => {
  const text = "A bird is an animal.\n```js\nconst x = 1; foo(); bar();\n```\nA dog is a mammal.";
  assert.deepEqual(splitProseSentences(text), ["A bird is an animal", "A dog is a mammal"]);
});

test("splitProseSentences is pure — the same input always yields the same output", () => {
  const text = "A penguin is a bird. It eats fish and other seafood.";
  assert.deepEqual(splitProseSentences(text), splitProseSentences(text));
});

test("loadProseCorpus reads every .txt recursively and tags each sentence with its file", async () => {
  await withCorpus(
    {
      "sqlite/arch.txt": "A page is a block. The cache holds pages.",
      "wikipedia/Penguin.txt": "A penguin is a bird.",
    },
    async (dir) => {
      assert.deepEqual(await loadProseCorpus(dir), [
        { sentence: "A page is a block", file: "sqlite/arch.txt" },
        { sentence: "The cache holds pages", file: "sqlite/arch.txt" },
        { sentence: "A penguin is a bird", file: "wikipedia/Penguin.txt" },
      ]);
    },
  );
});

test("loadProseCorpus ignores non-.txt files, so a LICENSE-NOTICE is never corpus", async () => {
  await withCorpus(
    { "wikipedia/Penguin.txt": "A penguin is a bird.", "wikipedia/LICENSE-NOTICE": "This text is from Wikipedia and is CC BY-SA 4.0." },
    async (dir) => {
      const rows = await loadProseCorpus(dir);
      assert.deepEqual(rows.map((r) => r.file), ["wikipedia/Penguin.txt"]);
    },
  );
});

test("loadProseCorpus returns a deterministic file-then-position order", async () => {
  await withCorpus(
    { "b/second.txt": "A dog is a mammal.", "a/first.txt": "A penguin is a bird.", "a/also.txt": "A bee is an insect." },
    async (dir) => {
      assert.deepEqual(await proseCorpusFiles(dir), ["a/also.txt", "a/first.txt", "b/second.txt"]);
      assert.deepEqual(await loadProseCorpus(dir), await loadProseCorpus(dir));
    },
  );
});

test("the committed corpus matches its manifest byte-for-byte", async () => {
  const { createHash } = await import("node:crypto");
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(await readFile(join(PROSE_DIR, "manifest.json"), "utf8"));

  for (const entry of manifest.files) {
    const body = await readFile(join(PROSE_DIR, entry.file));
    assert.equal(
      createHash("sha256").update(body).digest("hex"),
      entry.sha256,
      `corpus/prose/${entry.file} does not match its manifest sha256 — the frozen corpus has been edited by hand. `
        + "Re-fetch with `npm run gen:prose-corpus` and commit, or restore the file.",
    );
    assert.equal(body.length, entry.bytes, `corpus/prose/${entry.file}: byte count does not match the manifest`);
  }

  const onDisk = await proseCorpusFiles(PROSE_DIR);
  assert.deepEqual(
    onDisk,
    manifest.files.map((f) => f.file).sort(),
    "corpus/prose/ holds text files the manifest does not list (or vice versa) — the corpus and its provenance record have diverged",
  );
});

test("every committed prose file records the URL it came from", async () => {
  const { readFile } = await import("node:fs/promises");
  const manifest = JSON.parse(await readFile(join(PROSE_DIR, "manifest.json"), "utf8"));
  assert.ok(manifest.fetched, "the manifest records no fetch date");
  for (const entry of manifest.files) {
    assert.match(entry.url, /^https:\/\//, `corpus/prose/${entry.file} has no source URL`);
  }
});
