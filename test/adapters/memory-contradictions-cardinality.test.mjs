// findContradictions predicate cardinality: predicates the resolver table
// classifies `merge` never report as contradictions on object count; a
// predicate on the default `contradiction` strategy keeps the full contract.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HAS_A_PREDICATE, CAPABLE_OF_PREDICATE, MULTI_VALUED_PREDICATES,
  loadMemory, appendFact, findContradictions,
} from "../../src/adapters/memory/core.mjs";
import { negatedPredicate } from "../../src/domain/memory/capability.mjs";
import { resolutionStrategyFor, RESOLUTION_MERGE, RESOLUTION_CONTRADICTION } from "../../src/domain/memory/resolution.mjs";

const tmpRepo = () => mkdtemp(join(tmpdir(), "tmct-card-"));

// A functional relation — one subject has one of these — so a second object is
// a real disagreement rather than a second true fact.
const SINGLE_VALUED = "mgx:father";

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
    await appendFact(dir, { subject: "rover", predicate: SINGLE_VALUED, object: "bruno", provenance: "ace:chat@2026-07-05T00:00:00.000Z" });
    await appendFact(dir, { subject: "rover", predicate: SINGLE_VALUED, object: "rex", provenance: "corpus:conceptnet /r/IsA" });
    const m = await loadMemory(dir);
    const groups = findContradictions(m);
    assert.equal(groups.length, 1, "the single-valued contract is unchanged");
    assert.deepEqual(groups[0].map((r) => r.object), ["bruno", "rex"], "both objects kept, higher-trust first");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a mixed store reports only the single-valued disagreement, never the multi-valued facts", async () => {
  const dir = await tmpRepo();
  try {
    await appendFact(dir, { subject: "bird", predicate: CAPABLE_OF_PREDICATE, object: "fly", provenance: "ace:chat@2026-07-05T00:00:00.000Z" });
    await appendFact(dir, { subject: "bird", predicate: CAPABLE_OF_PREDICATE, object: "sing", provenance: "corpus:conceptnet /r/CapableOf" });
    await appendFact(dir, { subject: "wren", predicate: SINGLE_VALUED, object: "bruno", provenance: "ace:chat@2026-07-05T00:00:00.000Z" });
    await appendFact(dir, { subject: "wren", predicate: SINGLE_VALUED, object: "rex", provenance: "corpus:conceptnet /r/IsA" });
    const m = await loadMemory(dir);
    const groups = findContradictions(m);
    assert.equal(groups.length, 1);
    assert.equal(groups[0][0].predicate, SINGLE_VALUED);
    assert.ok(groups[0].every((r) => r.predicate === SINGLE_VALUED), "no capableOf row leaks into the group");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a contradiction group orders its objects by codepoint, so a locale cannot reorder them", async () => {
  const dir = await tmpRepo();
  try {
    // An accented object is where locale and codepoint part company: en
    // collation files "résumé" beside "resume", while its codepoint (U+00E9)
    // sorts after every plain letter. Same trust on both, so the tiebreak is
    // the whole answer, and two machines reading one store have to agree.
    const provenance = "corpus:conceptnet /r/IsA";
    await appendFact(dir, { subject: "chapter", predicate: SINGLE_VALUED, object: "résumé", provenance });
    await appendFact(dir, { subject: "chapter", predicate: SINGLE_VALUED, object: "resumes", provenance });
    const groups = findContradictions(await loadMemory(dir));
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].map((r) => r.object), ["resumes", "résumé"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("the exemption list is the resolver table's merge row, at both polarities", () => {
  for (const p of MULTI_VALUED_PREDICATES) {
    assert.equal(resolutionStrategyFor(p), RESOLUTION_MERGE, `${p} resolves by merge`);
  }
  for (const p of [HAS_A_PREDICATE, CAPABLE_OF_PREDICATE, "mgx:atLocation", "mgx:hasProperty", "rdfs:subClassOf"]) {
    assert.ok(MULTI_VALUED_PREDICATES.has(p), `${p} is exempt`);
    assert.ok(MULTI_VALUED_PREDICATES.has(negatedPredicate(p)), `so is its negative twin ${negatedPredicate(p)}`);
  }
  assert.equal(resolutionStrategyFor(SINGLE_VALUED), RESOLUTION_CONTRADICTION, "an unclassified predicate keeps the keep-both contract");
  assert.ok(!MULTI_VALUED_PREDICATES.has(SINGLE_VALUED));
});

test("a second mgx:atLocation object is a second true fact, not a disagreement", async () => {
  const dir = await tmpRepo();
  try {
    await appendFact(dir, { subject: "dog", predicate: "mgx:atLocation", object: "a kennel", provenance: "corpus:conceptnet /r/AtLocation" });
    await appendFact(dir, { subject: "dog", predicate: "mgx:atLocation", object: "a park", provenance: "corpus:conceptnet /r/AtLocation" });
    assert.deepEqual(findContradictions(await loadMemory(dir)), [], "'likely to find a dog in a kennel' and 'in a park' are both true");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("two negative capabilities on one subject are two claims, not a self-contradiction", async () => {
  const dir = await tmpRepo();
  try {
    const cannot = negatedPredicate(CAPABLE_OF_PREDICATE);
    await appendFact(dir, { subject: "penguin", predicate: cannot, object: "fly", provenance: "ace:chat@2026-07-05T00:00:00.000Z" });
    await appendFact(dir, { subject: "penguin", predicate: cannot, object: "sing", provenance: "ace:chat@2026-07-05T00:00:00.000Z" });
    assert.deepEqual(findContradictions(await loadMemory(dir)), []);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
