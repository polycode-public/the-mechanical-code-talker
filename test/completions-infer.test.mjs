// completions-infer.test.mjs — Stage 1 (of the PLAN_COMPLETIONS.md pipeline numbering; third
// file by staging index — completions-stage0/stage2 cover Stage 1+2 and Stage 4) verification
// for src/completions/infer.mjs's cross-group inference.
//
// Stage 1's own exit criterion ("every asserted inference cites a concrete licensing test,
// zero fabricated relationships on a hand-labeled set") is made concrete here exactly the way
// Stage 0/2's own tests made THEIR exit criteria concrete: a hand-labeled fixture (eight small
// text groups over a small taught fact graph, five expected relations across all 28 possible
// group pairs, every other pair hand-labeled "nothing should fire") plus a determinism
// double-run diff.
//
// Fixture design (see the inline comments by each group below for the specific mechanism each
// one exercises):
//   g:ahab-john / g:family-tree     -> SUPPORTS   (share entities ahab+john; a taught
//                                                   `ahab mgx:father john` fact confirms it)
//   g:widget-notice / g:widget-warns -> CONTRADICTS (share entity "widget" + token "deprecated";
//                                                   one side negates, the other doesn't)
//   g:buffer-kind / g:cache-impl    -> EXEMPLIFIES + ELABORATES (cache is a taught
//                                                   rdfs:subClassOf instance of buffer, AND
//                                                   cache-impl's entity set is a proper
//                                                   superset of buffer-kind's)
//   g:router-basic / g:router-deepdive -> ELABORATES only (deepdive's entity set is a proper
//                                                   superset of basic's; no ISA fact ties them,
//                                                   so no exemplifies)
// Every other one of the 28 possible pairs shares no graph-grounded entity at all (or, for the
// buffer/cache <-> router pairs, shares nothing) and so is hand-labeled "nothing fires" —
// asserted by checking the full output set, not just the five expected pairs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { appendFact, loadMemory } from "../src/memory/core.mjs";
import { inferRelations } from "../src/completions/infer.mjs";

async function tmpRepo() {
  return mkdtemp(join(tmpdir(), "tmct-completions-infer-"));
}

async function seedFacts(dir) {
  // supports fixture: ahab/john connected by a taught relation
  await appendFact(dir, { subject: "ahab", predicate: "mgx:father", object: "john", provenance: "teach:chat" });
  // grounds "widget" as a graph-known term (property literal, not an ISA edge — deliberately
  // inert for the exemplifies test) so the contradicts fixture's shared entity is real
  await appendFact(dir, { subject: "widget", predicate: "mgx:hasProperty", object: "legacy", provenance: "teach:chat" });
  // exemplifies + elaborates fixture: cache IS-A buffer
  await appendFact(dir, { subject: "cache", predicate: "rdfs:subClassOf", object: "buffer", provenance: "teach:chat" });
  // elaborates-only fixture: router grounded plainly (no ISA edge -> no exemplifies possible),
  // middleware/throttling grounded so router-deepdive's entity set is a proper superset of
  // router-basic's
  await appendFact(dir, { subject: "router", predicate: "mgx:hasProperty", object: "network", provenance: "teach:chat" });
  await appendFact(dir, { subject: "middleware", predicate: "mgx:hasProperty", object: "pipeline", provenance: "teach:chat" });
  await appendFact(dir, { subject: "throttling", predicate: "mgx:hasProperty", object: "pipeline", provenance: "teach:chat" });
}

const GROUPS = [
  {
    id: "g:ahab-john",
    members: [{ id: "b1", text: "Ahab is the father of john. Ahab raised john from childhood." }],
  },
  {
    id: "g:family-tree",
    members: [{ id: "b2", text: "The family tree lists ahab and john among its earliest members. Ahab and john are central to the record." }],
  },
  {
    id: "g:widget-notice",
    members: [{ id: "b3", text: "The widget is deprecated for the new release. Users should migrate soon." }],
  },
  {
    id: "g:widget-warns",
    members: [{ id: "b4", text: "The widget is not deprecated in this build. Ship it as usual." }],
  },
  {
    id: "g:buffer-kind",
    members: [{ id: "b5", text: "A buffer is a general storage abstraction." }],
  },
  {
    id: "g:cache-impl",
    members: [{ id: "b6", text: "The cache is a specific kind of buffer used for fast lookups. Cache eviction matters." }],
  },
  {
    id: "g:router-basic",
    members: [{ id: "b7", text: "The router forwards requests to handlers." }],
  },
  {
    id: "g:router-deepdive",
    members: [{ id: "b8", text: "The router forwards requests to handlers using middleware chains and throttling policies." }],
  },
];

// The full expected relation set — every pair not named here must produce nothing (checked by
// comparing the ENTIRE output, not by spot-checking these five in isolation).
const EXPECTED = [
  { from: "g:ahab-john", to: "g:family-tree", relation: "supports" },
  { from: "g:widget-notice", to: "g:widget-warns", relation: "contradicts" },
  { from: "g:cache-impl", to: "g:buffer-kind", relation: "exemplifies" },
  { from: "g:cache-impl", to: "g:buffer-kind", relation: "elaborates" },
  { from: "g:router-deepdive", to: "g:router-basic", relation: "elaborates" },
].sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.relation.localeCompare(b.relation));

test("Stage 1 exit criterion: inferRelations() fires EXACTLY the hand-labeled relations, zero fabrication, on a fixture spanning all four relation kinds", async () => {
  const dir = await tmpRepo();
  try {
    await seedFacts(dir);
    const memory = await loadMemory(dir);
    const result = await inferRelations(GROUPS, memory);

    const shape = result.map((r) => ({ from: r.from, to: r.to, relation: r.relation }))
      .sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.relation.localeCompare(b.relation));
    assert.deepEqual(shape, EXPECTED, "exactly the hand-labeled relations fire — nothing more, nothing less");

    // every hit that DOES fire carries auditable evidence (PLAN_COMPLETIONS.md §2)
    for (const r of result) {
      assert.equal(typeof r.licensingTest, "string");
      assert.ok(r.licensingTest.length > 0, "every asserted relation names the concrete test that licensed it");
      assert.ok(r.evidence && typeof r.evidence === "object", "every asserted relation carries cited evidence");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("supports: evidence cites the exact shared entities, relation name, and resolveRelationChase citation", async () => {
  const dir = await tmpRepo();
  try {
    await seedFacts(dir);
    const memory = await loadMemory(dir);
    const result = await inferRelations(GROUPS, memory);
    const hit = result.find((r) => r.relation === "supports");
    assert.ok(hit, "supports must fire for the ahab/john pair");
    assert.equal(hit.evidence.relationName, "father");
    assert.equal(hit.evidence.subject, "ahab");
    assert.equal(hit.evidence.object, "john");
    assert.deepEqual(hit.evidence.sharedEntities, ["ahab", "john"]);
    assert.deepEqual(hit.evidence.citation, ["ahab mgx:father john"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("contradicts: evidence cites the shared entity, shared token, and one negated + one affirmed sentence", async () => {
  const dir = await tmpRepo();
  try {
    await seedFacts(dir);
    const memory = await loadMemory(dir);
    const result = await inferRelations(GROUPS, memory);
    const hit = result.find((r) => r.relation === "contradicts");
    assert.ok(hit, "contradicts must fire for the widget pair");
    assert.equal(hit.evidence.entity, "widget");
    assert.equal(hit.evidence.aspect, "deprecated");
    assert.ok(/not deprecated/.test(hit.evidence.negatedSentence));
    assert.ok(!/not deprecated/.test(hit.evidence.affirmedSentence));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("exemplifies: evidence cites the general class term, the instance term, and the taught ISA fact", async () => {
  const dir = await tmpRepo();
  try {
    await seedFacts(dir);
    const memory = await loadMemory(dir);
    const result = await inferRelations(GROUPS, memory);
    const hit = result.find((r) => r.relation === "exemplifies");
    assert.ok(hit, "exemplifies must fire for the buffer/cache pair");
    assert.equal(hit.evidence.generalTerm, "buffer");
    assert.equal(hit.evidence.instanceTerm, "cache");
    assert.equal(hit.evidence.citation, "cache rdfs:subClassOf buffer");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("elaborates: evidence cites the wider and narrower entity sets, and the wider is a PROPER superset", async () => {
  const dir = await tmpRepo();
  try {
    await seedFacts(dir);
    const memory = await loadMemory(dir);
    const result = await inferRelations(GROUPS, memory);
    const hit = result.find((r) => r.relation === "elaborates" && r.from === "g:router-deepdive");
    assert.ok(hit, "elaborates must fire for the router-basic/router-deepdive pair");
    assert.deepEqual(hit.evidence.narrowerEntities, ["router"]);
    assert.ok(hit.evidence.widerEntities.includes("router"));
    assert.ok(hit.evidence.widerEntities.length > hit.evidence.narrowerEntities.length);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("determinism: two runs over the identical groups + fixed memory produce byte-identical output", async () => {
  const dir = await tmpRepo();
  try {
    await seedFacts(dir);
    const memory = await loadMemory(dir);
    const run1 = await inferRelations(GROUPS, memory);
    const run2 = await inferRelations(GROUPS, memory);
    assert.deepEqual(run2, run1, "identical inputs must yield byte-identical inferred relations — any diff is a determinism bug");
    assert.ok(run1.length > 0, "the fixture must actually exercise something real, not an empty no-op");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("inferRelations(): fewer than two groups, or no groups, never throws and returns []", async () => {
  const dir = await tmpRepo();
  try {
    const memory = await loadMemory(dir);
    assert.deepEqual(await inferRelations([], memory), []);
    assert.deepEqual(await inferRelations(null, memory), []);
    assert.deepEqual(await inferRelations([GROUPS[0]], memory), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
