// memory-stats.test.mjs — exportFactsJsonl, the one-line "the session's
// whole store as JSONL" wrapper shared across chat/ledger/ingest/research's
// browser entries.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryStore, appendFact, appendFacts } from "../../src/adapters/memory/core.mjs";
import { memoryStats, exportFactsJsonl } from "../../src/surfaces/web/memory-stats.mjs";

test("exportFactsJsonl: an empty store serializes to the empty string", async () => {
  const memoryDir = createInMemoryStore();
  assert.equal(await exportFactsJsonl(memoryDir), "");
});

test("exportFactsJsonl: every stored fact becomes one JSONL line, provenance verbatim", async () => {
  const memoryDir = createInMemoryStore();
  await appendFact(memoryDir, { subject: "zorble", predicate: "rdfs:subClassOf", object: "animal", provenance: "teach:chat:sess@ts" });
  await appendFacts(memoryDir, [
    { subject: "dog", predicate: "rdfs:subClassOf", object: "mammal", provenance: "corpus:conceptnet" },
  ]);
  const jsonl = await exportFactsJsonl(memoryDir);
  const records = jsonl.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(records.length, 2);
  const zorble = records.find((r) => r.subject === "zorble");
  assert.equal(zorble.predicate, "rdfs:subClassOf");
  assert.equal(zorble.object, "animal");
  assert.equal(zorble.provenance, "teach:chat:sess@ts");
});

test("exportFactsJsonl reads the same live store memoryStats reads — the export and the stats panel never disagree on what's stored", async () => {
  const memoryDir = createInMemoryStore();
  await appendFacts(memoryDir, [
    { subject: "a", predicate: "rdf:type", object: "thing", provenance: "corpus:seon" },
    { subject: "b", predicate: "rdf:type", object: "thing", provenance: "teach:chat:sess@ts" },
  ]);
  const stats = await memoryStats(memoryDir);
  const records = (await exportFactsJsonl(memoryDir)).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(stats.total, records.length);
});
