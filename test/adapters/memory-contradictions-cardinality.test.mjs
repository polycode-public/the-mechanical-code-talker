// findContradictions predicate cardinality: multi-valued has/can predicates
// (MULTI_VALUED_PREDICATES) never report as contradictions on object count;
// single-valued predicates keep the full contradiction contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HAS_A_PREDICATE, CAPABLE_OF_PREDICATE, MULTI_VALUED_PREDICATES,
  loadMemory, appendFact, findContradictions,
} from "../../src/adapters/memory/core.mjs";

const tmpRepo = () => mkdtemp(join(tmpdir(), "tmct-card-"));

test("two mgx:hasA objects and two mgx:capableOf objects on one subject are facts, not contradictions", async () => {
  const dir = await tmpRepo();
  try {
    await appendFact(dir, { subject: "dog", predicate: HAS_A_PREDICATE, object: "legs", provenance: "ace:chat@2026-07-05T00:00:00.000Z" });
    await appendFact(dir, { subject: "dog", predicate: HAS_A_PREDICATE, object: "a tail", provenance: "corpus:conceptnet /r/HasA" });
    await appendFact(dir, { subject: "dog", predicate: CAPABLE_OF_PREDICATE, object: "bark", provenance: "ace:chat@2026-07-05T00:00:00.000Z" });
    await appendFact(dir, { subject: "dog", predicate: CAPABLE_OF_PREDICATE, object: "swim", provenance: "corpus:conceptnet /r/CapableOf" });
    const m = await loadMemory(dir);
    assert.equal(findContradictions(m).length, 0, "multi-valued predicates never contradict on object count");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("two differing objects on a single-valued predicate still report as a contradiction", async () => {
  const dir = await tmpRepo();
  try {
    await appendFact(dir, { subject: "sky", predicate: "mgx:hasProperty", object: "blue", provenance: "ace:chat@2026-07-05T00:00:00.000Z" });
    await appendFact(dir, { subject: "sky", predicate: "mgx:hasProperty", object: "grey", provenance: "corpus:conceptnet /r/HasProperty" });
    const m = await loadMemory(dir);
    const groups = findContradictions(m);
    assert.equal(groups.length, 1, "the single-valued contract is unchanged");
    assert.deepEqual(groups[0].map((r) => r.object), ["blue", "grey"], "both objects kept, higher-trust first");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a mixed store reports only the single-valued disagreement, never the multi-valued facts", async () => {
  const dir = await tmpRepo();
  try {
    await appendFact(dir, { subject: "bird", predicate: CAPABLE_OF_PREDICATE, object: "fly", provenance: "ace:chat@2026-07-05T00:00:00.000Z" });
    await appendFact(dir, { subject: "bird", predicate: CAPABLE_OF_PREDICATE, object: "sing", provenance: "corpus:conceptnet /r/CapableOf" });
    await appendFact(dir, { subject: "bird", predicate: "mgx:hasProperty", object: "small", provenance: "ace:chat@2026-07-05T00:00:00.000Z" });
    await appendFact(dir, { subject: "bird", predicate: "mgx:hasProperty", object: "huge", provenance: "corpus:conceptnet /r/HasProperty" });
    const m = await loadMemory(dir);
    const groups = findContradictions(m);
    assert.equal(groups.length, 1);
    assert.equal(groups[0][0].predicate, "mgx:hasProperty");
    assert.ok(groups[0].every((r) => r.predicate === "mgx:hasProperty"), "no capableOf row leaks into the group");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the exemption list is closed: exactly the has/can family", () => {
  assert.deepEqual([...MULTI_VALUED_PREDICATES].sort(), [CAPABLE_OF_PREDICATE, HAS_A_PREDICATE].sort());
});
