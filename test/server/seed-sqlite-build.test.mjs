// scripts/build-seed-sqlite.mjs replays a JSON seed's facts through
// createSqliteMemoryStore's own write path (appendFacts -> mutateMemory ->
// persistSqlitePayload), rather than copying the JSON file's bytes. This
// suite proves that replay is faithful at fixture scale (the sqlite file
// reads back the same triples the JSON route reads back) and that the
// builder's own clock-freeze/VACUUM normalization makes the output bytes
// stable across repeated builds of the same input.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  factsFromJsonSeed, writeSqliteSeed, sha256File,
} from "../../scripts/build-seed-sqlite.mjs";
import {
  createInMemoryStore, loadMemory, readFactRows,
  createSqliteMemoryStore, closeSqliteMemoryStore, appendFacts,
} from "../../src/adapters/memory/core.mjs";

async function withTempDir(run) {
  const dir = await mkdtemp(join(tmpdir(), "tmct-seed-sqlite-"));
  try {
    return await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A small fixture JSON seed built the same way build-chat-seed.mjs/
 *  build-seed.mjs build the real ones: appendFacts into an in-memory store,
 *  then serialize what the store actually holds. Two sources on the same
 *  triple (a corpus tag and a teach tag) so the round trip below has to
 *  carry more than one assertion per group, not just the single-source case
 *  every real corpus band happens to produce. */
async function buildFixtureJsonSeed(jsonPath) {
  const handle = createInMemoryStore();
  await appendFacts(handle, [
    { subject: "dog", predicate: "IsA", object: "animal", provenance: "corpus:seon", createdAt: "2026-01-01T00:00:00.000Z" },
    { subject: "cat", predicate: "IsA", object: "animal", provenance: "corpus:seon", createdAt: "2026-01-01T00:00:00.000Z" },
    { subject: "dog", predicate: "capableOf", object: "bark", provenance: "corpus:seon", createdAt: "2026-01-01T00:00:00.000Z" },
  ]);
  await appendFacts(handle, [
    { subject: "dog", predicate: "IsA", object: "animal", provenance: "teach:chat:s1@2026-01-01T00:05:00.000Z", createdAt: "2026-01-01T00:05:00.000Z" },
  ]);
  const payload = await loadMemory(handle);
  await writeFile(jsonPath, JSON.stringify(payload));
  return payload;
}

const sortedFactRows = (memory) =>
  readFactRows(memory)
    .map((row) => ({
      subject: row.subject,
      predicate: row.predicate,
      object: row.object,
      provenance: row.provenance,
      sourceIds: [...row.sourceIds].sort(),
    }))
    .sort((a, b) => (a.subject + a.predicate + a.object).localeCompare(b.subject + b.predicate + b.object));

test("build-seed-sqlite: a fixture JSON seed replayed through writeSqliteSeed reads back the same triples as the JSON route, including a multi-source group", async () => {
  await withTempDir(async (dir) => {
    const jsonPath = join(dir, "fixture-seed.json");
    await buildFixtureJsonSeed(jsonPath);

    const { facts, factCount } = await factsFromJsonSeed(jsonPath);
    assert.equal(factCount, 3, "three distinct triples, one of them multi-source");
    assert.equal(facts.length, 4, "one appendFacts row per asserting record, not per triple");

    const sqlitePath = join(dir, "fixture-seed.sqlite");
    const writeRes = await writeSqliteSeed(sqlitePath, facts);
    assert.equal(writeRes.appended, 4, "every prepared record actually wrote a Fact");

    const handle = await createSqliteMemoryStore(sqlitePath);
    try {
      const sqliteMemory = await loadMemory(handle);
      const jsonMemory = await loadMemory({ backend: "memory", payload: JSON.parse(await readFile(jsonPath, "utf8")) });
      assert.deepEqual(sortedFactRows(sqliteMemory), sortedFactRows(jsonMemory));

      const multiSource = sortedFactRows(sqliteMemory).find((r) => r.subject === "dog" && r.predicate === "IsA");
      assert.equal(multiSource.sourceIds.length, 2, "the dog/IsA/animal triple keeps both its corpus and teach sources");
    } finally {
      closeSqliteMemoryStore(handle);
    }
  });
});

test("build-seed-sqlite: building the same JSON snapshot twice produces byte-identical sqlite output", async () => {
  await withTempDir(async (dir) => {
    const jsonPath = join(dir, "fixture-seed.json");
    await buildFixtureJsonSeed(jsonPath);
    const { facts } = await factsFromJsonSeed(jsonPath);

    const firstPath = join(dir, "first.sqlite");
    const secondPath = join(dir, "second.sqlite");
    await writeSqliteSeed(firstPath, facts);
    await writeSqliteSeed(secondPath, facts);

    const [firstDigest, secondDigest] = await Promise.all([sha256File(firstPath), sha256File(secondPath)]);
    assert.equal(firstDigest, secondDigest, "two builds off the same fact set must hash identically");
  });
});

test("build-seed-sqlite: an empty JSON seed's fact list comes back empty rather than throwing", async () => {
  await withTempDir(async (dir) => {
    const jsonPath = join(dir, "empty-seed.json");
    const handle = createInMemoryStore();
    await writeFile(jsonPath, JSON.stringify(await loadMemory(handle)));
    const { facts, factCount } = await factsFromJsonSeed(jsonPath);
    assert.equal(factCount, 0);
    assert.deepEqual(facts, []);
  });
});
