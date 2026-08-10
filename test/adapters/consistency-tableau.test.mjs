// Phase-5 consistency surfacing: findConsistencyViolations (syllogise.mjs)
// only reads type/subclass/disjointness edges, so a DL tableau clash (a
// cardinality clash, E5's own flagship) and an EL-saturation-proved
// unsatisfiable class both sit outside it. chat.mjs's findWiderConsistencyClash
// runs both READ-ONLY, beside the cheaper check rather than folded into it,
// and stays silent on a budget-exhausted subject rather than clearing it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runTurn, findWiderConsistencyClash } from "../../src/services/chat.mjs";
import { appendFacts, loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";

async function tmpRepo() {
  return mkdtemp(join(tmpdir(), "tmct-consistency-tableau-"));
}

const bicycleWithWheelsFacts = [
  { subject: "beryl", predicate: "rdf:type", object: "bicycle" },
  { subject: "bicycle", predicate: "rdfs:subClassOf", object: "min-wheel" },
  { subject: "min-wheel", predicate: "owl:onProperty", object: "has" },
  { subject: "min-wheel", predicate: "owl:onClass", object: "wheel" },
  { subject: "min-wheel", predicate: "owl:minCardinality", object: "2" },
  { subject: "bicycle", predicate: "rdfs:subClassOf", object: "max-wheel" },
  { subject: "max-wheel", predicate: "owl:onProperty", object: "has" },
  { subject: "max-wheel", predicate: "owl:onClass", object: "wheel" },
  { subject: "max-wheel", predicate: "owl:maxCardinality", object: "0" },
];

const DEFAULT_REASONING = {
  proveSteps: 5000, proveBranches: 256, proveNodes: 512,
  classifyBudget: 2000, classifyRounds: 64,
};

test("E5: a min/max cardinality clash reports through 'what do you know about' with both restrictions named", async () => {
  const dir = await tmpRepo();
  try {
    await appendFacts(dir, bicycleWithWheelsFacts);
    const { answer, record } = await runTurn("what do you know about beryl", { memoryDir: dir });
    assert.match(answer, /I can't answer that — what I've been told about beryl is inconsistent:/);
    assert.match(answer, /min-wheel minCardinality 2/);
    assert.match(answer, /max-wheel maxCardinality 0/);
    assert.equal(record.miss, false, "a definite finding, not a miss");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("an EL-saturation-proved unsatisfiable class reports through 'what do you know about', with no individual involved", async () => {
  const dir = await tmpRepo();
  try {
    await appendFacts(dir, [
      { subject: "siamese", predicate: "rdfs:subClassOf", object: "cat" },
      { subject: "siamese", predicate: "rdfs:subClassOf", object: "dog" },
      { subject: "cat", predicate: "owl:disjointWith", object: "dog" },
    ]);
    const { answer, record } = await runTurn("what do you know about siamese", { memoryDir: dir });
    assert.match(answer, /I can't answer that — "siamese" can never have any members:/);
    assert.equal(record.miss, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a consistent store answers plainly — the wider check finds nothing to report", async () => {
  const dir = await tmpRepo();
  try {
    await appendFacts(dir, [
      { subject: "rex", predicate: "rdf:type", object: "dog" },
      { subject: "dog", predicate: "rdfs:subClassOf", object: "mammal" },
    ]);
    const { answer, record } = await runTurn("what do you know about rex", { memoryDir: dir });
    assert.doesNotMatch(answer, /I can't answer that/);
    assert.equal(record.miss, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("findWiderConsistencyClash: a budget too small to finish the tableau check omits the subject, never a false clean bill", async () => {
  const dir = await tmpRepo();
  try {
    await appendFacts(dir, bicycleWithWheelsFacts);
    const rows = readFactRows(await loadMemory(dir));
    const tightReasoning = { ...DEFAULT_REASONING, proveSteps: 1, proveBranches: 1, proveNodes: 1 };
    const result = await findWiderConsistencyClash(rows, new Set(["beryl"]), tightReasoning);
    assert.equal(result, null, "a budget-exhausted subject is omitted, not reported as either clean or clashing");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("findWiderConsistencyClash: the full budget finds E5's clash directly, citing both restrictions", async () => {
  const dir = await tmpRepo();
  try {
    await appendFacts(dir, bicycleWithWheelsFacts);
    const rows = readFactRows(await loadMemory(dir));
    const result = await findWiderConsistencyClash(rows, new Set(["beryl"]), DEFAULT_REASONING);
    assert.match(result, /min-wheel minCardinality 2/);
    assert.match(result, /max-wheel maxCardinality 0/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
