// corpus/wordnet/manifest.json and corpus/tier2/manifest.json pin the byte
// length and sha256 of every file they list, but until now nothing checked
// that pin against the actual committed bytes — child-pack/reference-pack/
// prose-corpus all have this guard, wordnet and tier2 did not. Both corpuses
// are always committed (no maintainer-only build step gating them), so this
// runs unconditionally, no skip guard.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const MANIFEST_DIRS = [
  join(REPO_ROOT, "corpus", "wordnet"),
  join(REPO_ROOT, "corpus", "tier2"),
];

function assertManifestMatchesDisk(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  for (const entry of manifest.corpuses) {
    const body = readFileSync(join(dir, entry.file));
    assert.equal(body.length, entry.bytes, `${dir}/${entry.file}: byte count drifted from the manifest`);
    assert.equal(createHash("sha256").update(body).digest("hex"), entry.sha256, `${dir}/${entry.file}: sha256 drifted from the manifest`);
  }
}

for (const dir of MANIFEST_DIRS) {
  test(`${dir.replace(`${REPO_ROOT}/`, "")}: every listed file matches its manifest's byte length and sha256`, () => {
    assertManifestMatchesDisk(dir);
  });
}

test("the guard actually catches drift: a one-byte edit to a committed corpus file fails the check", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-corpus-manifest-drift-"));
  try {
    const manifest = { corpuses: [{ file: "sample.jsonl", bytes: 5, sha256: createHash("sha256").update("hello").digest("hex") }] };
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
    writeFileSync(join(dir, "sample.jsonl"), "hello");
    assert.doesNotThrow(() => assertManifestMatchesDisk(dir), "the fixture starts in sync");

    writeFileSync(join(dir, "sample.jsonl"), "hellx"); // one byte changed, length unchanged
    assert.throws(() => assertManifestMatchesDisk(dir), /sha256 drifted/, "a same-length, different-content edit is still caught");

    writeFileSync(join(dir, "sample.jsonl"), "hell"); // now length changed too
    assert.throws(() => assertManifestMatchesDisk(dir), /byte count drifted/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
