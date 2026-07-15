// Regression for a real-world repro against a `tmct init`-seeded repo (not the
// plain empty store the inference corpus lane's relation rows use): the default
// human-persona corpus already carries the ConceptNet `father rdfs:subClassOf
// parent` IsA fact, so teaching "a father is a kind of parent" MERGES into
// that pre-existing corpus fact (appendFact's duplicate-fact upsert) instead
// of storing a second row. The merged fact then carries BOTH a `corpus` and
// an `operator` sourceType. The alias-chase edge-builders used to require a
// fact to carry NO corpus/web source at all to count as "taught", so the
// merged fact was wrongly excluded — breaking the father->parent alias chase,
// and with it the grandparent/grandfather chases and the reverse "who"
// query, all of which depend on it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import { runTurn } from "../src/chat.mjs";
import { loadMemory, readFactRows } from "../src/memory/core.mjs";
import { clearCache } from "../src/source.mjs";
import { freshBootstrapRepo } from "./helpers/seeded-fixture.mjs";

const CONFIG = {};

test("corpus-collision: the operator's own family-tree repro resolves against a tmct-init-seeded repo, where 'father is a kind of parent' merges into a pre-existing corpus fact", async () => {
  const dir = await freshBootstrapRepo("tmct-tr-collision-");
  try {
    const sid = "collision1";
    await runTurn("ahab is the father of john", { config: CONFIG, memoryDir: dir, sessionId: sid });
    await runTurn("john is the father of ishmael", { config: CONFIG, memoryDir: dir, sessionId: sid });
    // Collides with the pre-seeded corpus's own father/parent IsA fact — a
    // merge, not a fresh row.
    await runTurn("a father is a kind of parent", { config: CONFIG, memoryDir: dir, sessionId: sid });
    await runTurn("remember that ahab is male", { config: CONFIG, memoryDir: dir, sessionId: sid });
    await runTurn("a grandparent is a parent of a parent", { config: CONFIG, memoryDir: dir, sessionId: sid });
    await runTurn("a grandfather is a grandparent who is male", { config: CONFIG, memoryDir: dir, sessionId: sid });

    // The father/parent fact really did merge (one row, two sourceTypes) —
    // confirms this test actually exercises the collision, not a fresh fact.
    const rows = readFactRows(await loadMemory(dir));
    const aliasFact = rows.find((r) => r.predicate === "rdfs:subClassOf" && r.subject === "father" && r.object === "parent");
    assert.ok(aliasFact, "the father subClassOf parent fact exists");
    assert.ok(aliasFact.sourceTypes?.includes("corpus"), "the alias fact carries a corpus source (pre-seeded)");
    assert.ok(aliasFact.sourceTypes?.includes("operator"), "the alias fact ALSO carries the operator's taught source (merged, not duplicated)");

    const grandparent = await runTurn("is ahab a grandparent of ishmael", { config: CONFIG, memoryDir: dir });
    assert.match(grandparent.answer, /^yes —/, `grandparent chase must resolve, got: ${grandparent.answer}`);

    const grandfather = await runTurn("is ahab the grandfather of ishmael", { config: CONFIG, memoryDir: dir });
    assert.match(grandfather.answer, /^yes —/, `grandfather chase must resolve, got: ${grandfather.answer}`);

    const who = await runTurn("who is the parent of ishmael", { config: CONFIG, memoryDir: dir });
    assert.doesNotMatch(who.answer, /I don't know a relation or rule called/, `reverse 'who' query must not decline, got: ${who.answer}`);
    assert.match(who.answer, /^john —/, `reverse 'who' query must name john, got: ${who.answer}`);

    // The citation for the collided alias fact shows BOTH provenances
    // together (the fact's own merged provenance string), not just one.
    assert.match(grandparent.answer, /father is a kind of parent/, "cites the alias fact");
    assert.match(aliasFact.provenance, /corpus/, "merged provenance string retains the corpus source");
    assert.match(aliasFact.provenance, /(ace:chat|teach:chat)/, "merged provenance string retains the operator source");
    assert.ok(aliasFact.provenance.includes(" | "), "the two sources are concatenated, neither silently dropped");
  } finally {
    clearCache();
    await rm(dir, { recursive: true, force: true });
  }
});
