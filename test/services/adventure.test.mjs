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
import { foldWorldState, worldDigestRows } from "../../src/services/adventure.mjs";
import { driveSessionTurns } from "../helpers/session.mjs";
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

test("the world-state fold takes the newest @turnN snapshot per subject and derives the turn counter", () => {
  const rows = [
    { subject: "player", predicate: "mgx:currently-in", object: "study" },
    { subject: "player@turn1", predicate: "mgx:currently-in", object: "library" },
    { subject: "player@turn2", predicate: "mgx:currently-in", object: "kitchen" },
    { subject: "cabinet", predicate: "mgx:stands-locked-in", object: "study" },
    { subject: "cabinet@turn3", predicate: "mgx:fixed-in", object: "study" },
    { subject: "portrait@turn2", predicate: "mgx:is-open", object: "true" },
    { subject: "study", predicate: "mgx:has-exit-north", object: "library" },
  ];
  const state = foldWorldState(rows);
  assert.equal(state.turnCount, 3);
  assert.deepEqual(state.placements.get("player"), { predicate: "mgx:currently-in", object: "kitchen", turn: 2 });
  assert.deepEqual(state.placements.get("cabinet"), { predicate: "mgx:fixed-in", object: "study", turn: 3 });
  assert.equal(state.openness.get("portrait").open, true);
  assert.equal(state.exits.get("study").get("north"), "library");
});

test("the digest view folds placements, phrases the predicates, and keeps hidden contents and puzzle wiring out", () => {
  const rows = [
    { subject: "cabinet", predicate: "mgx:stands-locked-in", object: "study" },
    { subject: "key", predicate: "mgx:hidden-in", object: "portrait" },
    { subject: "cabinet", predicate: "mgx:unlocks-with", object: "key" },
    { subject: "housekeeper", predicate: "mgx:acts-on-turn", object: "3" },
    { subject: "lamp", predicate: "mgx:located-in", object: "study" },
    { subject: "lamp@turn2", predicate: "mgx:located-in", object: "player" },
    { subject: "letter@turn3", predicate: "mgx:located-in", object: "housekeeper" },
    { subject: "housekeeper", predicate: "rdf:type", object: "person" },
    { subject: "study", predicate: "mgx:has-exit-north", object: "library" },
    { subject: "player", predicate: "rdf:type", object: "adventurer" },
  ];
  const view = worldDigestRows(rows, foldWorldState(rows));
  const sentences = view.map((r) => `${r.subject} ${r.predicate} ${r.object}`);
  assert.ok(sentences.includes("Cabinet stands locked in the study"));
  assert.ok(sentences.includes("Player carries the lamp"), "a carried object reads as carries, not located-in player");
  assert.ok(sentences.includes("Housekeeper carries the letter"), "an NPC holding an object reads as carries too");
  assert.ok(sentences.includes("Study has an exit north to the library"));
  assert.ok(sentences.includes("Player is an adventurer"), "typing rows keep vowel-aware articles");
  assert.ok(!sentences.some((s) => /hidden/.test(s)), "hidden placements stay out of the view");
  assert.ok(!sentences.some((s) => /unlocks-with|acts-on-turn/.test(s)), "puzzle wiring stays out of the view");
});

test("a stopped world resumes in a later session exactly where the written snapshots left it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-adventure-resume-"));
  try {
    const first = await driveSessionTurns(
      { repoPath: dir, env: { TMCT_NO_SEED: "1" } },
      ["play ashcombe hall", "take the lamp", "go north", "stop playing"],
    );
    assert.match(String(first[2].answer), /[Nn]ow in the library/);
    const second = await driveSessionTurns(
      { repoPath: dir, env: { TMCT_NO_SEED: "1" } },
      ["play ashcombe hall", "what am i carrying"],
    );
    assert.match(String(second[0].answer), /back in the adventure — you are in the library/);
    assert.match(String(second[1].answer), /[Pp]layer carries the lamp/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
