// The fact read-back's digest lead: a long undifferentiated "what is X" answer
// opens with a bounded, deterministic digest paragraph over the same stored
// facts, and holds the full fact list behind the "show the facts"/"more"
// escape. A short answer stays a plain list. Driven through runTurn against a
// real memory-seeded store, with a code graph loaded so the vocabulary reader
// runs (a graph-less session answers the code-graph wall instead).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTurn } from "../../src/services/chat.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import { appendFact } from "../../src/adapters/memory/core.mjs";
import * as source from "../../src/adapters/source.mjs";

const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };
let GRAPH;
async function graph() { return (GRAPH ||= parseEntities(await source.fetchEntities(CONFIG))); }

async function seeded(facts) {
  const dir = await mkdtemp(join(tmpdir(), "tmct-digest-readback-"));
  for (const f of facts) await appendFact(dir, f);
  return { dir, close: () => rm(dir, { recursive: true, force: true }) };
}

const P = "corpus:human /r/x";

test("a long term answer leads with the digest and holds the facts behind the escape", async () => {
  const { dir, close } = await seeded([
    { subject: "aardvark", predicate: "rdfs:subClassOf", object: "mammal", provenance: "corpus:human /r/IsA" },
    { subject: "aardvark", predicate: "rdfs:subClassOf", object: "vertebrate", provenance: P },
    { subject: "aardvark", predicate: "rdfs:subClassOf", object: "animal", provenance: P },
    { subject: "aardvark", predicate: "mgx:atLocation", object: "Africa", provenance: "corpus:human /r/AtLocation" },
    { subject: "aardvark", predicate: "mgx:capableOf", object: "dig", provenance: "corpus:human /r/CapableOf" },
    { subject: "aardvark", predicate: "mgx:hasA", object: "snout", provenance: P },
    { subject: "aardvark", predicate: "mgx:hasA", object: "claws", provenance: P },
    { subject: "aardvark", predicate: "mgx:hasA", object: "tongue", provenance: P },
    { subject: "aardvark", predicate: "mgx:hasA", object: "tail", provenance: P },
  ]);
  try {
    const turn = await runTurn("what is an aardvark", { config: CONFIG, graph: await graph(), memoryDir: dir });
    const text = turn.answer;
    // The digest leads: a copula sentence naming the term, not an "i learned:" list.
    assert.match(text, /aardvarks? (is|are) /i);
    assert.match(text, /mammal/i);
    assert.match(text, /found in africa/i);
    assert.match(text, /can dig/i);
    // The escape names the full count and holds every line on the pending pager.
    assert.match(text, /Say 'show the facts' for all 9 stored facts\./);
    assert.equal(turn.detail.pending.items.length, 9);
  } finally {
    await close();
  }
});

test("'show the facts' after a digest pages the full held fact list", async () => {
  const { dir, close } = await seeded([
    { subject: "aardvark", predicate: "rdfs:subClassOf", object: "mammal", provenance: "corpus:human /r/IsA" },
    { subject: "aardvark", predicate: "rdfs:subClassOf", object: "vertebrate", provenance: P },
    { subject: "aardvark", predicate: "rdfs:subClassOf", object: "animal", provenance: P },
    { subject: "aardvark", predicate: "mgx:atLocation", object: "Africa", provenance: "corpus:human /r/AtLocation" },
    { subject: "aardvark", predicate: "mgx:capableOf", object: "dig", provenance: "corpus:human /r/CapableOf" },
    { subject: "aardvark", predicate: "mgx:hasA", object: "snout", provenance: P },
    { subject: "aardvark", predicate: "mgx:hasA", object: "claws", provenance: P },
    { subject: "aardvark", predicate: "mgx:hasA", object: "tongue", provenance: P },
    { subject: "aardvark", predicate: "mgx:hasA", object: "tail", provenance: P },
  ]);
  try {
    const g = await graph();
    const first = await runTurn("what is an aardvark", { config: CONFIG, graph: g, memoryDir: dir });
    const second = await runTurn("show the facts", { config: CONFIG, graph: g, memoryDir: dir, last: first });
    // The escape reveals the detail the digest held: the mgx:hasA lines the
    // narrative left out are now shown.
    assert.match(second.answer, /snout/);
    assert.match(second.answer, /claws/);
  } finally {
    await close();
  }
});

test("a short term answer stays a plain fact list, no digest lead", async () => {
  const { dir, close } = await seeded([
    { subject: "wren", predicate: "rdfs:subClassOf", object: "bird", provenance: "corpus:human /r/IsA" },
    { subject: "wren", predicate: "mgx:capableOf", object: "sing", provenance: "corpus:human /r/CapableOf" },
  ]);
  try {
    const turn = await runTurn("what is a wren", { config: CONFIG, graph: await graph(), memoryDir: dir });
    assert.ok(!/Say 'show the facts'/.test(turn.answer), "no digest escape on a short answer");
    assert.match(turn.answer, /wren is a kind of bird/i);
  } finally {
    await close();
  }
});
