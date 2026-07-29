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
import { foldWorldState, runNpcPass, roomAffordances, worldDigestRows, currentPosition, worldActionRows, personKnowledgeLines, personRoomReport } from "../../src/services/adventure.mjs";
import { driveSessionTurns } from "../helpers/session.mjs";
import { worldProvenanceTag } from "../../src/domain/worlds-pack.mjs";
import { appendFacts, appendRule, loadMemory, openMemoryBackend, readFactRows, readRuleRows } from "../../src/adapters/memory/core.mjs";
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

test("a position is current until the subject is placed anew, then goes stale with no extra write", () => {
  const rows = [
    { subject: "lamp", predicate: "mgx:located-in", object: "study" },
    { subject: "lamp", predicate: "mgx:on-top-of", object: "desk" },
    { subject: "lamp@turn4", predicate: "mgx:located-in", object: "player" },
  ];
  const state = foldWorldState(rows);
  const before = foldWorldState(rows.slice(0, 2));
  assert.deepEqual(currentPosition(before, "lamp"), { predicate: "mgx:on-top-of", object: "desk", turn: 0 },
    "on the desk while it still rests in the study");
  assert.equal(currentPosition(state, "lamp"), null, "taking the lamp (turn 4) supersedes the turn-0 position with no retraction row");
});

test("worldActionRows keeps world-sourced and provenance-free rows, drops taught and merged-corpus rows", () => {
  const rows = [
    { subject: "letter", predicate: "mgx:hidden-in", object: "cabinet", provenance: "world:ashcombe-hall" },
    { subject: "letter", predicate: "mgx:located-in", object: "garden", provenance: "teach:chat:local" },
    { subject: "hand", predicate: "rdf:type", object: "view" },
    { subject: "flower", predicate: "mgx:atLocation", object: "garden", provenance: "corpus:conceptnet" },
  ];
  const kept = worldActionRows(rows);
  assert.deepEqual(kept.map((r) => r.predicate), ["mgx:hidden-in", "rdf:type"],
    "the world's own row and the hand-built view row survive; the taught note and the merged corpus row do not");
});

test("personKnowledgeLines resolves live pointers — a hidden thing revealed, a person located, the quest named", () => {
  const rows = [
    { subject: "gardener", predicate: "rdf:type", object: "person" },
    { subject: "gardener", predicate: "mgx:knows-where", object: "letter" },
    { subject: "gardener", predicate: "mgx:knows-where", object: "butler" },
    { subject: "gardener", predicate: "mgx:knows-objective", object: "letter" },
    { subject: "gardener", predicate: "mgx:knows-about", object: "garden" },
    { subject: "butler", predicate: "rdf:type", object: "person" },
    { subject: "butler", predicate: "mgx:currently-in", object: "drawing-room" },
    { subject: "letter", predicate: "mgx:hidden-in", object: "cabinet" },
  ];
  const state = foldWorldState(rows);
  const { lines, aboutTopics } = personKnowledgeLines(rows, state, "gardener");
  assert.ok(lines.includes("the letter is in the cabinet."), "a hidden thing's place is revealed through talk");
  assert.ok(lines.includes("you'll find the butler in the drawing-room."), "a person is located");
  assert.ok(lines.includes("the letter is what you're after — find it and carry it, and the adventure is won."),
    "the objective's own quest line states the same win condition goalStatusLines checks — carrying it, nothing about leaving the house");
  assert.deepEqual(aboutTopics, ["garden"], "about-topics come back for the caller to digest");
});

test("personRoomReport states who and what shares a person's room and each container's status", () => {
  const rows = [
    { subject: "butler", predicate: "rdf:type", object: "person" },
    { subject: "butler", predicate: "mgx:currently-in", object: "drawing-room" },
    { subject: "portrait", predicate: "mgx:fixed-in", object: "drawing-room" },
    { subject: "portrait", predicate: "mgx:is-container", object: "true" },
    { subject: "drawing-room", predicate: "rdf:type", object: "room" },
  ];
  const state = foldWorldState(rows);
  const report = personRoomReport(rows, state, "butler");
  assert.match(report, /here in the drawing-room: the portrait\./);
  assert.match(report, /the portrait is closed\./);
});

test("roomAffordances branches each visible object onto exactly the verb that would accept it", () => {
  const rows = [
    { subject: "study", predicate: "rdf:type", object: "room" },
    { subject: "study", predicate: "mgx:has-exit-north", object: "library" },
    { subject: "study", predicate: "mgx:has-exit-down", object: "cellar" },
    { subject: "cabinet", predicate: "mgx:stands-locked-in", object: "study" },
    { subject: "cabinet", predicate: "mgx:is-container", object: "true" },
    { subject: "portrait", predicate: "mgx:fixed-in", object: "study" },
    { subject: "portrait", predicate: "mgx:is-container", object: "true" },
    { subject: "desk", predicate: "mgx:fixed-in", object: "study" },
    { subject: "lamp", predicate: "mgx:located-in", object: "study" },
    { subject: "housekeeper", predicate: "mgx:currently-in", object: "study" },
    { subject: "housekeeper", predicate: "rdf:type", object: "person" },
    { subject: "player", predicate: "mgx:currently-in", object: "study" },
  ];
  const state = foldWorldState(rows);
  // Objects branch in ALPHABETICAL subject order (cabinet, desk, housekeeper,
  // lamp, portrait — player is skipped), not narrative order.
  assert.deepEqual(roomAffordances(rows, state, "study"), [
    "go north", "go down",
    "unlock cabinet",       // stands-locked-in + container
    "examine desk",         // fixed-in, not a container
    "talk to housekeeper",
    "take lamp",            // located-in, portable
    "open portrait",        // fixed-in + container, not yet open
  ]);
});

test("roomAffordances never offers an action a container's own state would refuse", () => {
  const rows = [
    { subject: "drawing-room", predicate: "rdf:type", object: "room" },
    { subject: "portrait", predicate: "mgx:fixed-in", object: "drawing-room" },
    { subject: "portrait", predicate: "mgx:is-container", object: "true" },
    { subject: "portrait@turn3", predicate: "mgx:is-open", object: "true" },
  ];
  const state = foldWorldState(rows);
  assert.deepEqual(
    roomAffordances(rows, state, "drawing-room"), [],
    "an already-open fixed-in container offers neither 'open' (it would decline 'already open') nor any other verb",
  );
});

test("roomAffordances structurally excludes anything with no real placement fact — background corpus colour is never offered as a prop", () => {
  const rows = [
    { subject: "garden", predicate: "rdf:type", object: "room" },
    { subject: "garden", predicate: "mgx:hasA", object: "flower" },
    { subject: "vegetable", predicate: "mgx:atLocation", object: "garden" },
    { subject: "player", predicate: "mgx:currently-in", object: "garden" },
  ];
  const state = foldWorldState(rows);
  assert.deepEqual(
    roomAffordances(rows, state, "garden"), [],
    "flower/vegetable have no placement fact at all, so they can never be enumerated — not filtered out, structurally absent",
  );
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

test("the NPC pass is turn-gated, sorted, exit-checked and capped at one move per NPC", () => {
  const rows = [
    { subject: "housekeeper", predicate: "mgx:is-npc", object: "true" },
    { subject: "housekeeper", predicate: "rdf:type", object: "person" },
    { subject: "housekeeper", predicate: "mgx:currently-in", object: "kitchen" },
    { subject: "housekeeper", predicate: "mgx:acts-on-turn", object: "3" },
    { subject: "housekeeper", predicate: "mgx:acts-toward", object: "library" },
    { subject: "gardener", predicate: "mgx:is-npc", object: "true" },
    { subject: "gardener", predicate: "rdf:type", object: "person" },
    { subject: "gardener", predicate: "mgx:currently-in", object: "cellar" },
    { subject: "gardener", predicate: "mgx:acts-on-turn", object: "3" },
    { subject: "gardener", predicate: "mgx:acts-toward", object: "library" },
    { subject: "kitchen", predicate: "mgx:has-exit-west", object: "library" },
    { subject: "library", predicate: "rdf:type", object: "room" },
  ];
  const families = new Map([["go", [
    { kind: "action-signature", slots: { subjectClass: "person", targetClass: "room" } },
    { kind: "action-effect", slots: { predicate: "currently-in", subjectRole: "subject", objectRole: "target" } },
  ]]]);
  const state = foldWorldState(rows);
  const off = runNpcPass({ rows, state, k: 2, families, playerRoomAfter: "kitchen" });
  assert.deepEqual(off, { writes: [], lines: [] }, "no NPC acts off its scheduled turn");
  const on = runNpcPass({ rows, state, k: 3, families, playerRoomAfter: "library" });
  assert.deepEqual(on.writes, [
    { subject: "housekeeper@turn3", predicate: "mgx:currently-in", object: "library" },
  ], "the housekeeper moves; the gardener's cellar has no exit to the library, so it stays");
  assert.deepEqual(on.lines, ["the housekeeper walks in."]);
  const unseen = runNpcPass({ rows, state, k: 3, families, playerRoomAfter: "garden" });
  assert.equal(unseen.writes.length, 1, "the move is written whether or not the player is present");
  assert.deepEqual(unseen.lines, [], "nothing is announced to a player who isn't there");
});

test("the worked example writes every intermediate graph state, and the housekeeper's turn-3 move stands in readFactRows", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-adventure-worked-"));
  try {
    const turns = await driveSessionTurns(
      { repoPath: dir, env: { TMCT_NO_SEED: "1" } },
      [
        "play ashcombe hall", "look", "go north", "go north", "look",
        "take the portrait", "open the portrait", "take the key", "go south",
        "look", "go south", "unlock the cabinet with the key", "open the cabinet",
        "take the letter",
      ],
    );
    assert.match(String(turns[13].answer), /you take the letter/, "the win condition lands");
    const backend = await openMemoryBackend(dir, "");
    const rows = readFactRows(await loadMemory(backend.dir));
    await backend.close();
    const has = (subject, predicate, object) =>
      rows.some((r) => r.subject === subject && r.predicate === predicate && r.object === object);
    // The turn ledger: state-changing commands only (the failed take and the
    // looks advance nothing), each step's effect written as that turn's rows.
    assert.ok(has("player@turn1", "mgx:currently-in", "library"));
    assert.ok(has("player@turn2", "mgx:currently-in", "drawing-room"));
    assert.ok(has("portrait@turn3", "mgx:is-open", "true"));
    assert.ok(has("key@turn3", "mgx:located-in", "portrait"), "opening the portrait frees the hidden key");
    assert.ok(has("housekeeper@turn3", "mgx:currently-in", "library"),
      "the housekeeper's scheduled move is in the written graph whether or not the player saw it");
    assert.ok(has("key@turn4", "mgx:located-in", "player"));
    assert.ok(has("player@turn5", "mgx:currently-in", "library"));
    assert.ok(has("player@turn6", "mgx:currently-in", "study"));
    assert.ok(has("cabinet@turn7", "mgx:fixed-in", "study"), "unlocking releases the lock; the cabinet stays fixed");
    assert.ok(has("cabinet@turn8", "mgx:is-open", "true"));
    assert.ok(has("letter@turn8", "mgx:located-in", "cabinet"));
    assert.ok(has("letter@turn9", "mgx:located-in", "player"), "the win condition's own graph row");
    assert.ok(!rows.some((r) => r.subject.startsWith("portrait@") && r.predicate === "mgx:located-in"),
      "the declined take-the-portrait wrote nothing");
    assert.ok(!rows.some((r) => /@turn(1[0-9]|[1-9][0-9])/.test(r.subject)), "nine state-changing commands, nine turns, nothing more");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
