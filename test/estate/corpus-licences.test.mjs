// corpus/LICENSES.json is the machine-readable licence rollup for everything
// committed under corpus/ and data/. These tests keep it honest: every corpus
// directory (and data/) must be covered by at least one entry, every entry
// must point at real files, and every entry must carry the full field set.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

async function loadRollup() {
  return JSON.parse(await readFile(join(REPO_ROOT, "corpus", "LICENSES.json"), "utf8"));
}

test("every corpus/ subdirectory and data/ has a LICENSES.json entry", async () => {
  const rollup = await loadRollup();
  const paths = rollup.entries.map((e) => e.path);
  const dirents = await readdir(join(REPO_ROOT, "corpus"), { withFileTypes: true });
  const corpusDirs = dirents.filter((d) => d.isDirectory()).map((d) => d.name);
  assert.ok(corpusDirs.length >= 5, `expected several corpus directories, found ${corpusDirs.length}`);
  for (const dir of corpusDirs) {
    const covered = paths.some((p) => p === `corpus/${dir}/` || p.startsWith(`corpus/${dir}/`));
    assert.ok(covered, `corpus/${dir}/ has no entry in corpus/LICENSES.json`);
  }
  assert.ok(
    paths.some((p) => p === "data/" || p.startsWith("data/")),
    "data/ has no entry in corpus/LICENSES.json",
  );
});

test("every entry's path and notice file exist, and fields are complete", async () => {
  const rollup = await loadRollup();
  assert.ok(Array.isArray(rollup.entries) && rollup.entries.length > 0, "entries array is missing or empty");
  for (const entry of rollup.entries) {
    for (const field of ["path", "upstream", "license", "shareAlike", "notice"]) {
      assert.ok(field in entry, `entry ${entry.path ?? "(no path)"} is missing "${field}"`);
    }
    assert.equal(typeof entry.shareAlike, "boolean", `${entry.path}: shareAlike must be a boolean`);
    assert.match(entry.license, /^[A-Za-z0-9.\-]+$/, `${entry.path}: license should be a bare SPDX id`);
    await assert.doesNotReject(access(join(REPO_ROOT, entry.path)), `${entry.path} does not exist`);
    await assert.doesNotReject(access(join(REPO_ROOT, entry.notice)), `${entry.path}: notice file ${entry.notice} does not exist`);
  }
});

test("share-alike is flagged exactly where the licence requires it", async () => {
  const rollup = await loadRollup();
  for (const entry of rollup.entries) {
    const requiresShareAlike = /-SA-/i.test(entry.license) || /GPL/i.test(entry.license);
    assert.equal(
      entry.shareAlike,
      requiresShareAlike,
      `${entry.path}: license ${entry.license} implies shareAlike=${requiresShareAlike}`,
    );
  }
});

test("the tier2 manifest records a licence for every committed tier2 jsonl", async () => {
  const manifest = JSON.parse(await readFile(join(REPO_ROOT, "corpus", "tier2", "manifest.json"), "utf8"));
  const indexed = new Map(
    [...manifest.corpuses, ...(manifest.examples ?? [])].map((c) => [c.file, c.license]),
  );
  const files = (await readdir(join(REPO_ROOT, "corpus", "tier2"))).filter((f) => f.endsWith(".jsonl"));
  for (const file of files) {
    assert.ok(indexed.has(file), `corpus/tier2/${file} has no manifest entry`);
    assert.ok(indexed.get(file), `corpus/tier2/${file} has no licence in the manifest`);
  }
  for (const bundle of manifest.examples ?? []) {
    assert.match(bundle.license, /CC-BY-4\.0/, `${bundle.file}: example sentences are CC-BY-4.0 source text`);
  }
});
