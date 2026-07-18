// The loaded world's action families ride the shipped taught-action
// mechanism unchanged: instated as ordinary Rule rows, collected by
// actionFamilies, compiled by compileDomain, and enumerable by
// movesFromRules over the world's own written facts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getWorldsPackProvider, clearWorldsPackCache } from "../../src/adapters/corpus/worlds-pack.mjs";
import { worldProvenanceTag } from "../../src/domain/worlds-pack.mjs";
import { appendFacts, appendRule, loadMemory, readFactRows, readRuleRows } from "../../src/adapters/memory/core.mjs";
import { compileDomain, movesFromRules, stateFromFacts } from "../../src/domain/domain.mjs";
import { actionFamilies, capabilityFromActionRules } from "../../src/domain/router/taught.mjs";

async function loadShippedWorldInto(dir) {
  clearWorldsPackCache();
  const world = await getWorldsPackProvider({}).load("ashcombe-hall");
  assert.ok(world, "the shipped world loads");
  const tag = worldProvenanceTag(world.name);
  await appendFacts(dir, world.facts.map((f) => ({
    subject: f.subject, predicate: f.predicate, object: f.object, provenance: tag,
  })));
  for (const rule of world.rules) {
    await appendRule(dir, { name: rule.name, kind: rule.ruleKind, slots: rule.slots, provenance: tag });
  }
  return loadMemory(dir);
}

test("every Ashcombe action family instates as Rule rows the shipped lookup path collects", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-adventure-rules-"));
  try {
    const memory = await loadShippedWorldInto(dir);
    const families = actionFamilies(readRuleRows(memory));
    assert.deepEqual(
      [...families.keys()].sort(),
      ["close", "drop", "give", "go", "open", "take", "unlock"],
      "the seven world-mutating verbs are taught families; look is read-only and rightly absent",
    );
    const go = capabilityFromActionRules("go", families.get("go"));
    assert.deepEqual(
      go.parameters.find((p) => p.name === "subject").classes,
      ["adventurer", "person"],
      "the go family covers the player and the NPC cast alike",
    );
    assert.deepEqual(go.parameters.find((p) => p.name === "target").classes, ["room"]);
    const take = capabilityFromActionRules("take", families.get("take"));
    assert.equal(take.effects.add[0].predicate, "located-in", "rule slots store predicates bare; compileDomain re-attaches mgx:");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("movesFromRules enumerates the loaded world's grounded moves from its own written facts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-adventure-moves-"));
  try {
    const memory = await loadShippedWorldInto(dir);
    const factRows = readFactRows(memory);
    const domain = compileDomain(factRows, readRuleRows(memory));
    assert.deepEqual(domain.classMembers.adventurer, ["player"]);
    assert.deepEqual(domain.classMembers.person, ["butler", "cook", "gardener", "housekeeper"]);
    assert.deepEqual(domain.classMembers.room.length, 6);
    const state = stateFromFacts(factRows, domain);
    const moves = movesFromRules(state, domain);
    const labels = moves.map((m) => m.action.label);
    assert.ok(labels.includes("go player library"), `go grounds the player over rooms, got ${labels.length} moves`);
    assert.ok(labels.includes("go housekeeper library"), "go grounds the NPC cast too");
    assert.ok(labels.includes("take lamp player"), "take grounds portables onto the player");
    assert.ok(labels.includes("drop lamp library"), "drop grounds portables over rooms (a same-place drop is a no-op and rightly absent)");
    assert.ok(labels.includes("give lamp housekeeper"), "give grounds portables over the cast");
    const goMove = moves.find((m) => m.action.label === "go player library");
    assert.ok(
      goMove.nextState.some((r) => r.subject === "player" && r.predicate === "mgx:currently-in" && r.object === "library"),
      "the go effect writes the player's new room into the successor state",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
