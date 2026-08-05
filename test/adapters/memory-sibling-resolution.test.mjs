// memory/resolution.mjs — the resolver table, the observation-time chain, and
// the latest-observation-wins / first-claim-wins ladders, plus how
// findContradictions consumes all three over a real store.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendFact, loadMemory, findContradictions, readFactRows } from "../../src/adapters/memory/core.mjs";
import {
  resolutionStrategyFor, effectiveObservedAt, resolveSiblingGroups,
  RESOLUTION_MERGE, RESOLUTION_LATEST_OBSERVATION_WINS, RESOLUTION_FIRST_CLAIM_WINS, RESOLUTION_CONTRADICTION,
} from "../../src/domain/memory/resolution.mjs";

const tmpRepo = () => mkdtemp(join(tmpdir(), "tmct-resolve-"));

/** One object-group as the resolver reads it: an object, an aggregate trust,
 *  and the assertion records that carry the time. */
const group = (object, trust, assertions) => ({ object, trust, assertions });
const said = (sourceType, assertedAt, extra = {}) => ({ sourceType, assertedAt, ...extra });

test("the resolver table classifies each predicate family, defaulting to contradiction", () => {
  assert.equal(resolutionStrategyFor("mgx:hasA"), RESOLUTION_MERGE);
  assert.equal(resolutionStrategyFor("mgx:atLocation"), RESOLUTION_MERGE);
  assert.equal(resolutionStrategyFor("rdfs:subClassOf"), RESOLUTION_MERGE);
  assert.equal(resolutionStrategyFor("mgxneg:capableOf"), RESOLUTION_MERGE, "negative twins merge too");
  assert.equal(resolutionStrategyFor("mgx:currently-in"), RESOLUTION_LATEST_OBSERVATION_WINS);
  assert.equal(resolutionStrategyFor("mgx:display-name"), RESOLUTION_LATEST_OBSERVATION_WINS);
  assert.equal(resolutionStrategyFor("mgx:has-exit-north"), RESOLUTION_LATEST_OBSERVATION_WINS, "the exit family is generated, not enumerated");
  assert.equal(resolutionStrategyFor("mgx:playedBy"), RESOLUTION_FIRST_CLAIM_WINS);
  assert.equal(resolutionStrategyFor("mgx:hasFirstSubevent"), RESOLUTION_CONTRADICTION, "'the FIRST thing you do' is functional by meaning");
  assert.equal(resolutionStrategyFor("mgx:whatever-nobody-classified"), RESOLUTION_CONTRADICTION);
  assert.equal(resolutionStrategyFor(""), RESOLUTION_CONTRADICTION);
});

test("a stored observation time wins the chain, whatever kind of source stored it", () => {
  assert.equal(
    effectiveObservedAt({ sourceType: "corpus", observedAt: "2019-01-01T00:00:00.000Z", createdAt: "2026-07-05T00:00:00.000Z" }),
    "2019-01-01T00:00:00.000Z",
  );
});

test("an agent-kind source with no stored observation falls back to its own assertion time", () => {
  assert.equal(
    effectiveObservedAt({ sourceType: "teach", assertedAt: "2026-07-05T00:00:00.000Z", createdAt: "2026-07-09T00:00:00.000Z" }),
    "2026-07-05T00:00:00.000Z",
    "the tag's own embedded moment, not this store's ingestion stamp",
  );
  assert.equal(
    effectiveObservedAt({ sourceType: "operator", createdAt: "2026-07-09T00:00:00.000Z" }),
    "2026-07-09T00:00:00.000Z",
    "createdAt only when the tag embedded nothing",
  );
});

test("a document-kind or activity-kind source never falls back to its ingestion time", () => {
  for (const sourceType of ["corpus", "corpusWeak", "reference", "web", "extracted", "entailed", ""]) {
    assert.equal(
      effectiveObservedAt({ sourceType, assertedAt: "2026-07-05T00:00:00.000Z", createdAt: "2026-07-09T00:00:00.000Z" }),
      undefined,
      `${sourceType || "an unattributed record"} says nothing about when anyone witnessed it`,
    );
  }
});

test("an unparseable stored observation time falls through the chain rather than poisoning it", () => {
  assert.equal(effectiveObservedAt({ sourceType: "teach", observedAt: "sometime", assertedAt: "2026-07-05T00:00:00.000Z" }), "2026-07-05T00:00:00.000Z");
  assert.equal(effectiveObservedAt({ sourceType: "corpus", observedAt: "sometime", createdAt: "2026-07-09T00:00:00.000Z" }), undefined);
});

test("latest-observation-wins: a dated group beats an undated one even at lower trust", () => {
  const dated = group("cellar", 0.5, [said("teach", "2019-01-01T00:00:00.000Z")]);
  const undated = group("hall", 1, [said("corpus", "2026-07-09T00:00:00.000Z")]);
  const { winner, contested } = resolveSiblingGroups([undated, dated], RESOLUTION_LATEST_OBSERVATION_WINS);
  assert.equal(winner.object, "cellar", "an undated corpus row cannot outrank a dated witness");
  assert.equal(contested, false, "time ordered it, so nothing is reported");
});

test("latest-observation-wins: the newest observation wins, and its group scores by its newest record", () => {
  const older = group("hall", 1, [said("teach", "2026-07-01T00:00:00.000Z")]);
  const newer = group("cellar", 0.6, [
    said("teach", "2020-01-01T00:00:00.000Z"),
    said("teach", "2026-07-05T00:00:00.000Z"),
  ]);
  const { winner, ranked, contested } = resolveSiblingGroups([older, newer], RESOLUTION_LATEST_OBSERVATION_WINS);
  assert.equal(winner.object, "cellar");
  assert.deepEqual(ranked.map((r) => r.object), ["cellar", "hall"]);
  assert.equal(contested, false);
});

test("latest-observation-wins: equal instants fall to trust, and that is contested", () => {
  const at = "2026-07-05T00:00:00.000Z";
  const weak = group("hall", 0.7, [said("teach", at)]);
  const strong = group("cellar", 0.95, [said("teach", at)]);
  const { winner, contested } = resolveSiblingGroups([weak, strong], RESOLUTION_LATEST_OBSERVATION_WINS);
  assert.equal(winner.object, "cellar", "the page still gets one deterministic answer");
  assert.equal(contested, true, "but time could not order it, so it is still reported");
});

test("latest-observation-wins: all-undated groups fall to trust, and that is contested", () => {
  const weak = group("hall", 0.7, [said("corpus", "2026-07-05T00:00:00.000Z")]);
  const strong = group("cellar", 0.9, [said("corpus", "2026-07-01T00:00:00.000Z")]);
  const { winner, contested } = resolveSiblingGroups([weak, strong], RESOLUTION_LATEST_OBSERVATION_WINS);
  assert.equal(winner.object, "cellar");
  assert.equal(contested, true);
});

test("latest-observation-wins: an exact trust tie falls to the codepoint-smallest object, never locale order", () => {
  const at = "2026-07-05T00:00:00.000Z";
  const upper = group("Zebra", 0.9, [said("teach", at)]);
  const lower = group("apple", 0.9, [said("teach", at)]);
  const { winner, contested } = resolveSiblingGroups([lower, upper], RESOLUTION_LATEST_OBSERVATION_WINS);
  assert.equal(winner.object, "Zebra", "'Z' sorts before 'a' by codepoint — locale order would flip this");
  assert.ok("Zebra".localeCompare("apple") > 0, "and locale order really would flip it");
  assert.equal(contested, true);
});

test("first-claim-wins: the oldest claim takes the slot, and an undated group never wins the race", () => {
  const early = group("ada", 0.9, [said("teach", "2026-07-01T00:00:00.000Z")]);
  const late = group("grace", 0.9, [said("teach", "2026-07-05T00:00:00.000Z")]);
  const undated = group("alan", 1, [said("corpus", "2020-01-01T00:00:00.000Z")]);
  const { winner, ranked, contested } = resolveSiblingGroups([late, undated, early], RESOLUTION_FIRST_CLAIM_WINS);
  assert.equal(winner.object, "ada");
  assert.deepEqual(ranked.map((r) => r.object), ["ada", "grace", "alan"], "undated ranks last in both directions");
  assert.equal(contested, false);
});

test("a merge or contradiction predicate has nothing for the time ladder to resolve", () => {
  assert.equal(resolveSiblingGroups([group("a", 1, [])], RESOLUTION_MERGE), null);
  assert.equal(resolveSiblingGroups([group("a", 1, [])], RESOLUTION_CONTRADICTION), null);
});

test("a single group is never contested, and an empty one resolves to nothing", () => {
  const only = resolveSiblingGroups([group("hall", 0.9, [said("corpus", "2026-07-05T00:00:00.000Z")])], RESOLUTION_LATEST_OBSERVATION_WINS);
  assert.equal(only.winner.object, "hall");
  assert.equal(only.contested, false);
  const none = resolveSiblingGroups([], RESOLUTION_LATEST_OBSERVATION_WINS);
  assert.equal(none.winner, null);
  assert.equal(none.contested, false);
});

test("dated succession on a state predicate stops reading as a disagreement", async () => {
  const dir = await tmpRepo();
  try {
    await appendFact(dir, { subject: "lantern", predicate: "mgx:currently-in", object: "hall", provenance: "teach:chat:s1@2026-07-01T00:00:00.000Z" });
    await appendFact(dir, { subject: "lantern", predicate: "mgx:currently-in", object: "cellar", provenance: "teach:chat:s2@2026-07-05T00:00:00.000Z" });
    const m = await loadMemory(dir);
    assert.deepEqual(findContradictions(m), [], "the lantern moved; it was never in two places at once");
    const rows = readFactRows(m).filter((r) => r.subject === "lantern");
    assert.equal(rows.length, 2, "both states are kept — resolution is a read, never a delete");
    const { winner } = resolveSiblingGroups(rows, RESOLUTION_LATEST_OBSERVATION_WINS);
    assert.equal(winner.object, "cellar", "and the newest observation is what renders");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a state predicate no clock can order is still reported, so nothing resolves silently", async () => {
  const dir = await tmpRepo();
  try {
    await appendFact(dir, { subject: "lantern", predicate: "mgx:currently-in", object: "hall", provenance: "corpus:conceptnet /r/AtLocation" });
    await appendFact(dir, { subject: "lantern", predicate: "mgx:currently-in", object: "cellar", provenance: "corpus:seon /r/AtLocation" });
    const groups = findContradictions(await loadMemory(dir));
    assert.equal(groups.length, 1, "two undated corpus rows cannot be ordered by observation");
    assert.deepEqual(groups[0].map((r) => r.object).sort(), ["cellar", "hall"], "both kept");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a registration's losing claim is not a contradiction — the earlier claim simply took the slot", async () => {
  const dir = await tmpRepo();
  try {
    await appendFact(dir, { subject: "mouse", predicate: "mgx:playedBy", object: "ada", provenance: "teach:chat:s1@2026-07-01T00:00:00.000Z" });
    await appendFact(dir, { subject: "mouse", predicate: "mgx:playedBy", object: "grace", provenance: "teach:chat:s2@2026-07-05T00:00:00.000Z" });
    const m = await loadMemory(dir);
    assert.deepEqual(findContradictions(m), []);
    const rows = readFactRows(m).filter((r) => r.subject === "mouse");
    assert.equal(resolveSiblingGroups(rows, RESOLUTION_FIRST_CLAIM_WINS).winner.object, "ada");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a member taught into two collections merges — belonging to both at once is not a disagreement", async () => {
  const dir = await tmpRepo();
  try {
    await appendFact(dir, { subject: "p", predicate: "mgx:memberOf", object: "alphabet", provenance: "teach:chat:s1@2026-07-01T00:00:00.000Z" });
    await appendFact(dir, { subject: "p", predicate: "mgx:memberOf", object: "roman-alphabet", provenance: "teach:chat:s2@2026-07-05T00:00:00.000Z" });
    const m = await loadMemory(dir);
    assert.deepEqual(findContradictions(m), [], "p belongs to both collections at once — not a contradiction");
    const rows = readFactRows(m).filter((r) => r.subject === "p");
    assert.equal(rows.length, 2, "both memberships are kept");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
