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
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { createSqliteMemoryStore, closeSqliteMemoryStore } from "../../src/adapters/memory/core.mjs";
import { dumpSqliteStore, populateSqliteStore, withFrozenClock } from "./memory-sqlite-storage.mjs";

const DUMP_FILE = fileURLToPath(new URL("./memory-sqlite-storage-dump.txt", import.meta.url));

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
