// corpus/wordnet/manifest.json and corpus/tier2/manifest.json pin the byte
// length and sha256 of every file they list, but until now nothing checked
// that pin against the actual committed bytes — child-pack/reference-pack/
// prose-corpus all have this guard, wordnet and tier2 did not. Both corpuses
// are always committed (no maintainer-only build step gating them), so this
// runs unconditionally, no skip guard.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanAssertions } from "../../corpus/conceptnet/filter-dump.mjs";

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

// corpus/conceptnet/slice.jsonl carried no manifest, no hash pin and no
// row-count guard, unlike child/wordnet/tier2/reference/prose — so a re-cut
// could change it silently. This block is the same guard, on the child-pack
// manifest's shape (dump/seed/files/counts) rather than wordnet/tier2's flat
// corpuses list.

const CONCEPTNET_DIR = join(REPO_ROOT, "corpus", "conceptnet");

test("corpus/conceptnet: slice.jsonl matches its manifest's byte length and sha256", () => {
  const manifest = JSON.parse(readFileSync(join(CONCEPTNET_DIR, "manifest.json"), "utf8"));
  for (const entry of manifest.files) {
    const body = readFileSync(join(CONCEPTNET_DIR, entry.file));
    assert.equal(body.length, entry.bytes, `${entry.file}: byte count drifted from the manifest`);
    assert.equal(createHash("sha256").update(body).digest("hex"), entry.sha256, `${entry.file}: sha256 drifted from the manifest`);
  }
});

test("corpus/conceptnet: the manifest pins the dump it was cut from and records its seed files, all present on disk", () => {
  const manifest = JSON.parse(readFileSync(join(CONCEPTNET_DIR, "manifest.json"), "utf8"));
  assert.ok(manifest.dump?.url && manifest.dump?.mirror && manifest.dump?.version && manifest.dump?.sha256, "the manifest pins the dump it was built from");
  assert.deepEqual(manifest.seed.files, [
    "corpus/conceptnet/fetch-slice.mjs",
    "corpus/conceptnet/filter-dump.mjs",
    "corpus/conceptnet/commonsenseqa-seed.mjs",
  ]);
  for (const file of manifest.seed.files) assert.ok(existsSync(join(REPO_ROOT, file)), `${file} exists`);
});

test("corpus/conceptnet: the manifest's edge count and per-relation counts match the committed slice", () => {
  const manifest = JSON.parse(readFileSync(join(CONCEPTNET_DIR, "manifest.json"), "utf8"));
  const lines = readFileSync(join(CONCEPTNET_DIR, "slice.jsonl"), "utf8").split("\n").filter((l) => l.trim());
  assert.equal(lines.length, manifest.counts.edges, "counts.edges matches the committed row count");
  const byRel = new Map();
  let prev = null;
  for (const line of lines) {
    const row = JSON.parse(line);
    byRel.set(row.rel, (byRel.get(row.rel) || 0) + 1);
    if (prev) {
      const cmp = prev.rel.localeCompare(row.rel) || prev.start.localeCompare(row.start) || prev.end.localeCompare(row.end);
      assert.ok(cmp <= 0, `slice.jsonl stays sorted by (rel, start, end): ${JSON.stringify(prev)} then ${JSON.stringify(row)}`);
    }
    prev = row;
  }
  assert.deepEqual(Object.fromEntries(byRel), manifest.counts.relations, "counts.relations matches the committed slice's own relation mix");
});

test("corpus/conceptnet: scanAssertions is a pure function of its dump lines and seeds — same input, same matched rows, twice", async () => {
  const lines = [
    "a1\t/r/IsA\t/c/en/dog\t/c/en/animal\t{\"weight\":2}",
    "a2\t/r/AtLocation\t/c/en/magazine\t/c/en/bookstore\t{\"weight\":3}",
    "a3\t/r/RelatedTo\t/c/en/dog\t/c/en/cat\t{\"weight\":1}",
    "a4\t/r/HasContext\t/c/en/dog\t/c/en/biology\t{\"weight\":1}", // ace=none, still admitted by scanAssertions (budget trim decides tier)
    "a5\t/r/DerivedFrom\t/c/en/computer\t/c/en/compute\t{\"weight\":1}", // no endpoint in seeds — dropped
  ];
  const seeds = new Set(["dog", "magazine"]);
  const first = await scanAssertions([...lines], { seeds });
  const second = await scanAssertions([...lines], { seeds });
  assert.deepEqual(second.rows, first.rows, "two scans of the same dump lines and seeds return the same matched rows in the same order");
  assert.equal(first.scanned, lines.length);
  assert.deepEqual(first.rows.map((r) => r.rel).sort(), ["/r/AtLocation", "/r/HasContext", "/r/IsA", "/r/RelatedTo"], "the un-seeded row is dropped, everything else survives the scan");
});
