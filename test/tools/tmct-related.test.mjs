// tmct_related driven through dispatchTool over a seeded memory graph: the
// synonym group answers as skos:altLabel, the relatedTo edge as skos:related,
// and a term the store holds no relation facts for misses honestly — the tool
// never invents a neighbour.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatchTool } from "../../src/tools/server.mjs";
import { ToolError } from "../../src/adapters/config.mjs";
import { appendFact, openConfiguredMemoryBackend } from "../../src/adapters/memory/core.mjs";

const stubSource = { fetchEntities: async () => ({ objectProperties: [], individuals: [] }) };

/** A temp repo whose CONFIGURED memory store (sqlite by default — the store the
 *  tool's fall-through reads) holds a synonym pair, a relatedTo edge, and one
 *  plain isa fact — so "table" is a term the store knows but holds no relation
 *  facts for (the essential near-miss). */
async function repoWithRelationFacts() {
  const dir = await mkdtemp(join(tmpdir(), "tmct-related-"));
  const { dir: mem, close } = await openConfiguredMemoryBackend(dir);
  try {
    await appendFact(mem, { subject: "couch", predicate: "mgx:synonym", object: "sofa", provenance: "corpus:conceptnet" });
    await appendFact(mem, { subject: "sofa", predicate: "mgx:relatedTo", object: "cushion", provenance: "corpus:conceptnet" });
    await appendFact(mem, { subject: "table", predicate: "rdfs:subClassOf", object: "furniture", provenance: "corpus:conceptnet" });
  } finally {
    await close();
  }
  return { dir, config: { graphFile: join(dir, ".tmct", "graph.json") } };
}

test("a term in a synonym group answers with its synonyms and its related concepts", async () => {
  const { dir, config } = await repoWithRelationFacts();
  try {
    const out = await dispatchTool("tmct_related", { term: "sofa" }, { config, source: stubSource });
    assert.match(out, /couch \[concept:couch\]/, "the concept and its prefLabel are named");
    assert.match(out, /synonyms \(skos:altLabel\): couch/, "the synonym group minus the queried term");
    assert.match(out, /related \(skos:related\): cushion/, "the relatedTo neighbour");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("the queried term is never listed as its own synonym", async () => {
  const { dir, config } = await repoWithRelationFacts();
  try {
    const out = await dispatchTool("tmct_related", { term: "couch" }, { config, source: stubSource });
    assert.match(out, /synonyms \(skos:altLabel\): sofa/);
    assert.doesNotMatch(out, /synonyms[^\n]*couch/, "couch asked, so couch is not an answer");
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a term the store knows but holds no relation facts for misses honestly", async () => {
  const { dir, config } = await repoWithRelationFacts();
  try {
    await assert.rejects(
      dispatchTool("tmct_related", { term: "table" }, { config, source: stubSource }),
      (e) => {
        assert.ok(e instanceof ToolError, "a clean tool miss, not a raw error");
        assert.match(e.message, /no synonym or related facts for "table"/);
        assert.doesNotMatch(e.message, /couch|sofa|cushion/, "never a guessed neighbour");
        return true;
      },
    );
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("an unknown term misses honestly with the same refusal", async () => {
  const { dir, config } = await repoWithRelationFacts();
  try {
    await assert.rejects(
      dispatchTool("tmct_related", { term: "zz-nowhere" }, { config, source: stubSource }),
      (e) => {
        assert.ok(e instanceof ToolError);
        assert.match(e.message, /no synonym or related facts for "zz-nowhere"/);
        assert.doesNotMatch(e.message, /couch|sofa|cushion/, "never a guessed neighbour");
        return true;
      },
    );
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a repo with no memory store at all misses honestly rather than erroring raw", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-related-empty-"));
  try {
    const config = { graphFile: join(dir, ".tmct", "graph.json") };
    await assert.rejects(
      dispatchTool("tmct_related", { term: "sofa" }, { config, source: stubSource }),
      (e) => e instanceof ToolError && /no synonym or related facts/.test(e.message),
    );
  } finally { await rm(dir, { recursive: true, force: true }); }
});
