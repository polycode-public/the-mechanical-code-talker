// The sqlite backend against the published memory-backend conformance kit, and
// the pin that its stored bytes never move.
//
// The dump pin is the stricter of the two. Backend C's tables are a real
// storage format with two deliberate orderings in them — individuals keep a
// stable `ord`, and a changed edge moves to the END of its group — so the
// checked-in dump is the whole store, schema and rows, built from a fixed
// script under a frozen clock. Any change to what sqlite writes shows up here
// as a diff. Regenerate it only when the storage format itself is meant to
// move: delete the file and run this test.
//
// The kit's fixture rows are deliberately not tmct records (made-up classes,
// terms no record implies), so they land in the verbatim `unmapped_rows` lane.
// The checks below the kit are the other half: a real payload's rows go to the
// store's own tables, come back byte for byte, and a store that never sees a
// verbatim row never grows the table for one.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  appendFact, appendFacts, createSqliteMemoryStore, createSqliteRowBackend, closeSqliteMemoryStore,
  loadMemory, readFactRows, removeFacts, factGroupId,
} from "../../src/adapters/memory/core.mjs";
import { runMemoryBackendConformance, collectRows } from "../../src/tools/memory-backend-conformance.mjs";
import { dumpSqliteStore, populateSqliteStore, withFrozenClock } from "./memory-sqlite-storage.mjs";

const DUMP_FILE = fileURLToPath(new URL("./memory-sqlite-storage-dump.txt", import.meta.url));

const kitDir = mkdtempSync(join(tmpdir(), "tmct-sqlite-kit-"));
const kitBackends = [];
let kitStores = 0;

after(async () => {
  for (const backend of kitBackends) await backend.close();
  await rm(kitDir, { recursive: true, force: true });
});

runMemoryBackendConformance("the sqlite backend", () => {
  const backend = createSqliteRowBackend(join(kitDir, `store-${++kitStores}.sqlite`));
  kitBackends.push(backend);
  return backend;
});

async function withSqliteStore(run) {
  const dir = await mkdtemp(join(tmpdir(), "tmct-sqlite-rows-"));
  const handle = await createSqliteMemoryStore(join(dir, "graph.sqlite"));
  try {
    return await run(handle);
  } finally {
    closeSqliteMemoryStore(handle);
    await rm(dir, { recursive: true, force: true });
  }
}

const tableNames = (handle) =>
  handle.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);

test("a populated store's schema and rows match the checked-in dump byte for byte", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-sqlite-dump-"));
  const handle = await createSqliteMemoryStore(join(dir, "graph.sqlite"));
  try {
    const dump = await withFrozenClock(async () => {
      await populateSqliteStore(handle);
      return dumpSqliteStore(handle);
    });

    let expected = null;
    try {
      expected = await readFile(DUMP_FILE, "utf8");
    } catch (e) {
      if (e?.code !== "ENOENT") throw e;
    }
    if (expected === null) {
      await writeFile(DUMP_FILE, dump);
      assert.fail(`no stored dump to compare against — wrote a fresh one to ${DUMP_FILE}; review it and run again`);
    }
    assert.equal(dump, expected);
  } finally {
    closeSqliteMemoryStore(handle);
    await rm(dir, { recursive: true, force: true });
  }
});

test("reopening the store rebuilds the same dump, so nothing about it depends on the writing connection", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-sqlite-dump-reopen-"));
  const dbPath = join(dir, "graph.sqlite");
  try {
    const first = await createSqliteMemoryStore(dbPath);
    const written = await withFrozenClock(async () => {
      await populateSqliteStore(first);
      return dumpSqliteStore(first);
    });
    closeSqliteMemoryStore(first);

    const second = await createSqliteMemoryStore(dbPath);
    try {
      assert.equal(dumpSqliteStore(second), written);
    } finally {
      closeSqliteMemoryStore(second);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a store written through the payload path reads back as rows over its own tables, and grows no verbatim table", async () => {
  await withSqliteStore(async (handle) => {
    await populateSqliteStore(handle);
    const rows = await handle.readRows();

    assert.deepEqual(tableNames(handle).includes("unmapped_rows"), false, "nothing here needed the verbatim lane");
    const individuals = handle.db.prepare("SELECT COUNT(*) AS n FROM individuals").get().n;
    const groups = handle.db.prepare("SELECT COUNT(*) AS n FROM relations").get().n;
    assert.equal(rows.length, individuals + groups, "one row per individual and one per edge group");

    const byKey = new Map(rows.map((row) => [row.rowKey, row]));
    const fact = readFactRows(await loadMemory(handle)).find((r) => r.object === "cellar");
    const factRow = byKey.get(`${fact.id}@src:teach-chat:s1`);
    assert.equal(factRow.rowClass, "fact");
    assert.equal(factRow.term, "lamp", "a fact row is indexed on its subject's canonical term");
    assert.equal(JSON.parse(factRow.json).individual.id, factRow.rowKey);

    const statedBy = byKey.get("edge-group:mgx:statedBy");
    assert.equal(statedBy.rowClass, "edge-group");
    assert.equal(JSON.parse(statedBy.json).group.prop, "mgx:statedBy");
  });
});

test("the rows a store hands back are exactly the rows it takes: writing them all again changes nothing", async () => {
  await withSqliteStore(async (handle) => {
    await withFrozenClock(async () => {
      await populateSqliteStore(handle);
      const before = await handle.readRows();
      const dump = dumpSqliteStore(handle);

      await handle.putRows(before);

      assert.deepEqual(tableNames(handle).includes("unmapped_rows"), false, "every row round-tripped through its own table");
      const after = await handle.readRows();
      const sortByKey = (rows) => [...rows].sort((a, b) => (a.rowKey < b.rowKey ? -1 : 1));
      assert.deepEqual(sortByKey(after), sortByKey(before));
      assert.equal(dumpSqliteStore(handle), dump, "rewriting the same rows leaves the stored bytes untouched");
    });
  });
});

test("readRowsByTerm answers the fact rows on one subject's term", async () => {
  await withSqliteStore(async (handle) => {
    await appendFacts(handle, [
      { subject: "dog", predicate: "mgx:capableOf", object: "bark", provenance: "corpus:human /r/CapableOf" },
      { subject: "dog", predicate: "mgx:hasA", object: "tail", provenance: "corpus:human /r/HasA" },
      { subject: "cat", predicate: "mgx:capableOf", object: "purr", provenance: "corpus:human /r/CapableOf" },
    ]);
    const rows = await handle.readRowsByTerm("dog");
    assert.deepEqual(
      rows.map((row) => JSON.parse(row.json).individual.attributes.find((a) => a.key === "object").value).sort(),
      ["bark", "tail"],
    );
    for (const row of rows) assert.equal(row.rowClass, "fact");
    assert.deepEqual(await handle.readRowsByTerm("goldfish"), []);
  });
});

test("deleting a fact row through the row contract takes its projection and its head with it", async () => {
  await withSqliteStore(async (handle) => {
    await appendFacts(handle, [
      { subject: "dog", predicate: "mgx:capableOf", object: "bark", provenance: "corpus:human /r/CapableOf" },
      { subject: "dog", predicate: "mgx:hasA", object: "tail", provenance: "corpus:human /r/HasA" },
    ]);
    const rows = await handle.readRows();
    const gone = rows.find((row) => row.rowClass === "fact" && row.json.includes('"value":"bark"'));

    await handle.deleteRows([gone.rowKey]);

    assert.equal(handle.db.prepare("SELECT id FROM facts WHERE id = ?").get(gone.rowKey), undefined);
    const heads = handle.db.prepare("SELECT triple_hash FROM fact_heads").all().map((r) => r.triple_hash);
    assert.deepEqual(heads.includes(factGroupId(gone.rowKey)), false, "the group lost its last record, so its head went too");
    const left = readFactRows(await loadMemory(handle));
    assert.deepEqual(left.map((r) => r.object), ["tail"]);
  });
});

test("a bookkeeping row lives beside the payload without ever reaching it", async () => {
  await withSqliteStore(async (handle) => {
    await appendFact(handle, { subject: "dog", predicate: "mgx:capableOf", object: "bark", provenance: "corpus:human /r/CapableOf" });
    await handle.putRows([{
      rowKey: "bookkeeping:research-queue:tariff",
      rowClass: "bookkeeping",
      term: "",
      json: JSON.stringify({ kind: "research-queue", key: "tariff", value: { asked: 1 } }),
    }]);

    assert.ok(tableNames(handle).includes("unmapped_rows"), "a row the tables cannot rebuild gets the verbatim lane");
    const rows = await collectRows(handle.readRows());
    const stored = rows.find((row) => row.rowKey === "bookkeeping:research-queue:tariff");
    assert.equal(stored.rowClass, "bookkeeping");
    assert.equal(JSON.parse(stored.json).key, "tariff");

    const memory = await loadMemory(handle);
    assert.deepEqual(memory.individuals.some((i) => i.id.startsWith("bookkeeping:")), false);
    assert.equal(readFactRows(memory).length, 1);

    // And the payload path leaves it alone: a later write must not delete it as
    // absent from the payload.
    await appendFact(handle, { subject: "cat", predicate: "mgx:capableOf", object: "purr", provenance: "corpus:human /r/CapableOf" });
    const after = await collectRows(handle.readRows());
    assert.ok(after.some((row) => row.rowKey === "bookkeeping:research-queue:tariff"));
  });
});

test("a store read as rows and the same store read as a payload never disagree about what it holds", async () => {
  await withSqliteStore(async (handle) => {
    await populateSqliteStore(handle);
    await removeFacts(handle, [readFactRows(await loadMemory(handle)).find((r) => r.object === "hall").id]);

    const memory = await loadMemory(handle);
    const rows = await handle.readRows();
    const rowIds = rows.filter((row) => row.rowClass !== "edge-group").map((row) => row.rowKey).sort();
    assert.deepEqual(rowIds, memory.individuals.map((i) => i.id).sort());
    assert.deepEqual(
      rows.filter((row) => row.rowClass === "edge-group").map((row) => row.rowKey).sort(),
      memory.objectProperties.map((g) => `edge-group:${g.prop}`).sort(),
    );
  });
});
