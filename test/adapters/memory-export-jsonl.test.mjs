// The memory-store fact serializer: every stored Fact becomes one JSONL line in
// `tmct extract`'s { subject, predicate, object, provenance } shape, provenance
// verbatim, quantifier only when set. Proven against both the in-memory backend
// and a real SQLite store, so the CLI export path (which reads the configured
// backend) serializes the same bytes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createInMemoryStore, appendFact, appendFacts, loadMemory,
  createSqliteMemoryStore, closeSqliteMemoryStore,
} from "../../src/adapters/memory/core.mjs";
import {
  serializeFactsJsonl, factRowsToJsonl, factRowToExportRecord,
} from "../../src/adapters/memory/export-jsonl.mjs";

const parseLines = (jsonl) => jsonl.split("\n").filter(Boolean).map((l) => JSON.parse(l));

test("an empty store serializes to the empty string, never a stray newline", async () => {
  const store = createInMemoryStore();
  assert.equal(serializeFactsJsonl(await loadMemory(store)), "");
});

test("every stored Fact becomes one JSONL line in the extract shape, provenance verbatim", async () => {
  const store = createInMemoryStore();
  await appendFact(store, { subject: "zorble", predicate: "rdfs:subClassOf", object: "animal", provenance: "teach:chat:sess@ts" });
  await appendFacts(store, [
    { subject: "dog", predicate: "rdfs:subClassOf", object: "mammal", provenance: "corpus:conceptnet" },
    { subject: "cat", predicate: "rdf:type", object: "pet", provenance: "corpus:seon" },
  ]);

  const jsonl = serializeFactsJsonl(await loadMemory(store));
  const lines = jsonl.split("\n");
  assert.equal(lines.at(-1), "", "a non-empty export ends in a single trailing newline");
  const records = parseLines(jsonl);
  assert.equal(records.length, 3);

  const zorble = records.find((r) => r.subject === "zorble");
  assert.deepEqual(zorble, { subject: "zorble", predicate: "rdfs:subClassOf", object: "animal", provenance: "teach:chat:sess@ts" });
  assert.ok(records.every((r) => r.provenance.length > 0), "every line carries its provenance");
});

test("a plural class-membership quantifier rides along; a fact without one omits the field", async () => {
  const withQuant = factRowToExportRecord({ subject: "s", predicate: "rdf:type", object: "o", provenance: "p", quantifier: "some" });
  assert.equal(withQuant.quantifier, "some");
  const without = factRowToExportRecord({ subject: "s", predicate: "rdf:type", object: "o", provenance: "p", quantifier: "" });
  assert.ok(!("quantifier" in without), "an empty quantifier is left off the record entirely");
});

test("factRowsToJsonl round-trips: every emitted line parses back to its own record", () => {
  const rows = [
    { subject: "a", predicate: "rdfs:subClassOf", object: "b", provenance: "corpus:seon" },
    { subject: "c", predicate: "rdf:type", object: "d", provenance: "teach:chat:x", quantifier: "" },
  ];
  const records = parseLines(factRowsToJsonl(rows));
  assert.deepEqual(records, [
    { subject: "a", predicate: "rdfs:subClassOf", object: "b", provenance: "corpus:seon" },
    { subject: "c", predicate: "rdf:type", object: "d", provenance: "teach:chat:x" },
  ]);
});

test("the sqlite backend serializes the identical JSONL as the in-memory backend for the same fact sequence", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-export-sqlite-"));
  const handle = await createSqliteMemoryStore(join(dir, "graph.sqlite"));
  try {
    const facts = [
      { subject: "zorble", predicate: "rdfs:subClassOf", object: "animal", provenance: "teach:chat:sess@ts" },
      { subject: "dog", predicate: "rdfs:subClassOf", object: "mammal", provenance: "corpus:conceptnet" },
    ];
    for (const f of facts) await appendFact(handle, f);
    const sqliteJsonl = serializeFactsJsonl(await loadMemory(handle));

    const mem = createInMemoryStore();
    for (const f of facts) await appendFact(mem, f);
    const memJsonl = serializeFactsJsonl(await loadMemory(mem));

    const sort = (jsonl) => parseLines(jsonl).sort((a, b) => a.subject.localeCompare(b.subject));
    assert.deepEqual(sort(sqliteJsonl), sort(memJsonl), "the sqlite export matches the in-memory export fact-for-fact");
    assert.equal(sort(sqliteJsonl).length, 2);
  } finally {
    closeSqliteMemoryStore(handle);
    await rm(dir, { recursive: true, force: true });
  }
});
