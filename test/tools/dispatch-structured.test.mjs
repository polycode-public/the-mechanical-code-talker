// The structured half of the tool contract, over the memory-store tools: a handler that
// already holds the structure of its own answer hands it to dispatchToolStructured as
// `data`, while dispatchTool's string stays exactly what it was. These tools write and
// read a real configured memory store, so they live outside the fast tier.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatchTool, dispatchToolStructured } from "../../src/tools/server.mjs";
import { appendFact, openConfiguredMemoryBackend } from "../../src/adapters/memory/core.mjs";
import { ingestText } from "../../src/services/extract-facts.mjs";

const stubSource = { fetchEntities: async () => ({ objectProperties: [], individuals: [] }) };

async function repoWithRelationFacts() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-structured-related-"));
  const { dir: mem, close } = await openConfiguredMemoryBackend(dir);
  try {
    await appendFact(mem, { subject: "couch", predicate: "mgx:synonym", object: "sofa", provenance: "corpus:conceptnet" });
    await appendFact(mem, { subject: "sofa", predicate: "mgx:relatedTo", object: "cushion", provenance: "corpus:conceptnet" });
  } finally {
    await close();
  }
  return { dir, config: { graphFile: join(dir, ".tmct", "graph.json") } };
}

test("tmct_related hands over the SKOS concept view a caller would otherwise parse out of the sentence", async () => {
  const { dir, config } = await repoWithRelationFacts();
  try {
    const { content, data } = await dispatchToolStructured("tmct_related", { term: "sofa" }, { config, source: stubSource });
    assert.equal(data.conceptId, "concept:couch");
    assert.equal(data.prefLabel, "couch");
    assert.deepEqual(data.synonyms, ["couch"], "the synonym group minus the queried term");
    assert.deepEqual(data.related.map((c) => c.prefLabel), ["cushion"]);
    assert.match(content, /synonyms \(skos:altLabel\): couch/, "the prose says the same thing");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("tmct_related's string entry is unchanged by the handler gaining structure", async () => {
  const { dir, config } = await repoWithRelationFacts();
  try {
    const text = await dispatchTool("tmct_related", { term: "sofa" }, { config, source: stubSource });
    const { content } = await dispatchToolStructured("tmct_related", { term: "sofa" }, { config, source: stubSource });
    assert.equal(text, content);
    assert.match(text, /^couch \[concept:couch\]\n/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("tmct_ingest reports its grounded triples as data, counts included", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-structured-ingest-"));
  const config = { graphFile: join(dir, ".tmct", "graph.json") };
  try {
    const { content, data } = await dispatchToolStructured(
      "tmct_ingest",
      { text: "Every module is a component." },
      { config, source: stubSource, ingest: ingestText },
    );
    assert.equal(data.sentences, 1);
    assert.equal(data.recognized, 1);
    assert.equal(data.skipped, 0);
    assert.equal(data.grounded, 1);
    assert.deepEqual(data.extracted.map((f) => [f.subject, f.predicate, f.object]), [["module", "rdfs:subClassOf", "component"]]);
    assert.match(content, /1 recognized/, "the prose reports the same counts");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("tmct_ingest without the injected recognizer keeps its honest prose and adds no data", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-structured-noseam-"));
  const config = { graphFile: join(dir, ".tmct", "graph.json") };
  try {
    const { content, data } = await dispatchToolStructured("tmct_ingest", { text: "Every module is a component." }, { config, source: stubSource });
    assert.match(content, /isn't wired into this context/);
    assert.equal(data, undefined);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
