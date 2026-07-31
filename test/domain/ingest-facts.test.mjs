// ingest-facts: the pure projection from an ingest session's stored rows to a
// graph `ask()` can traverse, plus the provenance filter that decides which
// rows are the visitor's own. The last test drives the REAL recognizer end to
// end — pasted prose in, a grounded answer out — because the projection's
// whole job is to make that round trip work.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ingestFactGraphPayload,
  ingestedFactRows,
  isIngestedFactRow,
  CLASSING_PREDICATES,
} from "../../src/domain/ingest-facts.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { ask } from "../../src/domain/ask.mjs";
import { createIngestSession } from "../../src/surfaces/web/ingest-browser-entry.mjs";
import { loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";

test("isIngestedFactRow keeps what a session brought in and drops the corpus bands it booted with", () => {
  assert.equal(isIngestedFactRow({ provenance: "teach:chat:abc@2026-01-01T00:00:00.000Z" }), true);
  assert.equal(isIngestedFactRow({ provenance: "optimistic-extract:page" }), true);
  assert.equal(isIngestedFactRow({ provenance: "extracted:notes.txt" }), true);
  assert.equal(isIngestedFactRow({ provenance: "corpus:conceptnet /r/IsA" }), false);
  assert.equal(isIngestedFactRow({ provenance: "corpus-weak:seon" }), false);
  assert.equal(isIngestedFactRow({ provenance: "" }), false);
  assert.equal(isIngestedFactRow(null), false);
});

test("ingestedFactRows keeps a row whose joined provenance carries a taught tag beside a corpus one", () => {
  const rows = [
    { subject: "beagle", predicate: "rdfs:subClassOf", object: "dog", provenance: "corpus:conceptnet | teach:chat:abc@2026-01-01T00:00:00.000Z" },
    { subject: "cat", predicate: "rdfs:subClassOf", object: "mammal", provenance: "corpus:conceptnet" },
  ];
  assert.deepEqual(ingestedFactRows(rows).map((r) => r.subject), ["beagle"]);
});

test("ingestFactGraphPayload classes a term by its own taxonomy row and leaves an unclassed term unclassed", () => {
  const payload = ingestFactGraphPayload([
    { subject: "beagle", predicate: "rdfs:subClassOf", object: "dog" },
    { subject: "beagles", predicate: "mgx:hasA", object: "floppy ears" },
  ]);
  assert.deepEqual(payload.individuals, [
    { id: "beagle", label: "beagle", class: "dog" },
    { id: "dog", label: "dog" },
    { id: "beagles", label: "beagles" },
    { id: "floppy ears", label: "floppy ears" },
  ]);
});

test("ingestFactGraphPayload carries every row as an edge under its own predicate, deduplicated", () => {
  const payload = ingestFactGraphPayload([
    { subject: "beagle", predicate: "rdfs:subClassOf", object: "dog" },
    { subject: "beagle", predicate: "rdfs:subClassOf", object: "dog" },
    { subject: "paris", predicate: "mgx:capital", object: "france" },
  ]);
  assert.deepEqual(payload.objectProperties, [
    { prop: "rdfs:subClassOf", predicate: "rdfs:subClassOf", examples: [{ subject: "beagle", object: "dog" }] },
    { prop: "mgx:capital", predicate: "mgx:capital", examples: [{ subject: "paris", object: "france" }] },
  ]);
});

test("a term taught two parents keeps the one stated first, so the class never depends on row order luck", () => {
  const rows = [
    { subject: "beagle", predicate: "rdfs:subClassOf", object: "dog" },
    { subject: "beagle", predicate: "rdfs:subClassOf", object: "pet" },
  ];
  assert.equal(ingestFactGraphPayload(rows).individuals[0].class, "dog");
  assert.equal(ingestFactGraphPayload([...rows].reverse()).individuals[0].class, "pet");
});

test("rdf:type classes a subject the same way rdfs:subClassOf does", () => {
  assert.ok(CLASSING_PREDICATES.includes("rdf:type"));
  const payload = ingestFactGraphPayload([{ subject: "fido", predicate: "rdf:type", object: "beagle" }]);
  assert.equal(payload.individuals[0].class, "beagle");
});

test("an empty row set projects into an empty graph rather than throwing", () => {
  assert.deepEqual(ingestFactGraphPayload([]), { individuals: [], objectProperties: [] });
  assert.deepEqual(ingestFactGraphPayload(), { individuals: [], objectProperties: [] });
  assert.deepEqual(ingestedFactRows(), []);
});

test("tmct.ask over a real ingest session's projection lists what the prose actually grounded, and misses honestly otherwise", async () => {
  const session = createIngestSession();
  await session.ingest("A beagle is a kind of dog. A poodle is a kind of dog. Fido is a beagle.");
  const rows = ingestedFactRows(readFactRows(await loadMemory(session.memoryDir)));
  const graph = parseEntities(ingestFactGraphPayload(rows));

  const dogs = ask(graph, "list dogs");
  assert.equal(dogs.tmct_ask.miss, false);
  assert.deepEqual(dogs.tmct_ask.matches.map((m) => m.id).sort(), ["beagle", "poodle"]);

  const count = ask(graph, "how many dogs are there");
  assert.equal(count.tmct_ask.miss, false);
  assert.match(count.content, /^2\b/);

  assert.equal(ask(graph, "list beagles").tmct_ask.matches.map((m) => m.id).join(), "fido");
  assert.equal(ask(graph, "list unicorns").tmct_ask.miss, true);
});
