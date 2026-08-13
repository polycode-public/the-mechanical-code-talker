// mud-browser-entry: casting more animals than the world hand-authors. The
// roster grows by numbering more instances of the species it already names,
// each minted individual arrives with the authored one's own type, room and
// mass, and the shared session opens for it exactly like an authored
// character — its own window, its own scripted turn, its own placement in the
// one omniscient snapshot.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createMudSession, expandMudRoster, mintedCharacterFacts, worldFactsForCast,
} from "../../src/surfaces/web/mud-browser-entry.mjs";
import { personKnownFoodLines, foldWorldState, worldActionRows } from "../../src/services/adventure.mjs";
import { readFactRows, loadMemory } from "../../src/adapters/memory/core.mjs";

const ROSTER = ["mole-1", "vole-1", "badger-2", "groundhog-1"];

const worldPayload = {
  name: "mud-garden",
  facts: [
    { subject: "garden", predicate: "rdf:type", object: "room" },
    { subject: "garden", predicate: "rdf:type", object: "outdoor-space" },
    { subject: "garden", predicate: "mgx:is-origin", object: "true" },
    { subject: "burrow-1", predicate: "rdf:type", object: "room" },
    { subject: "burrow-1", predicate: "rdf:type", object: "underground-space" },
    { subject: "garden", predicate: "mgx:has-exit-down", object: "burrow-1" },
    { subject: "burrow-1", predicate: "mgx:has-exit-up", object: "garden" },
    { subject: "mole-1", predicate: "rdf:type", object: "adventurer" },
    { subject: "mole-1", predicate: "mgx:currently-in", object: "garden" },
    { subject: "mole-1", predicate: "mgx:hasMass", object: "8" },
    { subject: "badger-2", predicate: "rdf:type", object: "adventurer" },
    { subject: "badger-2", predicate: "mgx:currently-in", object: "burrow-1" },
    { subject: "badger-2", predicate: "mgx:hasMass", object: "9" },
    { subject: "carrot", predicate: "rdf:type", object: "carrot" },
    { subject: "carrot", predicate: "mgx:located-in", object: "garden" },
  ],
  rules: [
    { name: "go", ruleKind: "action-signature", slots: { subjectClass: "adventurer", targetClass: "room" } },
    { name: "go", ruleKind: "action-effect", slots: { predicate: "currently-in", subjectRole: "subject", objectRole: "target" } },
    { name: "dig", ruleKind: "action-signature", slots: { subjectClass: "adventurer", targetClass: "room" } },
  ],
  opening: "a vegetable garden",
};

test("expandMudRoster: keeps the authored ids, then numbers more of the same species without colliding", () => {
  const grown = expandMudRoster(ROSTER, 9);
  assert.deepEqual(grown.slice(0, 4), ROSTER, "the authored animals come first, with their own numbers");
  assert.equal(grown.length, 9);
  assert.equal(new Set(grown).size, 9, "no id is minted twice, and none shadows an authored one");
  for (const id of grown.slice(4)) {
    assert.match(id, /^(?:mole|vole|badger|groundhog)-\d+$/, "an extra is another instance of a species the roster already names");
  }
  assert.ok(grown.includes("badger-1"), "a number the authored badger left free is used before a fresh round starts");
});

test("expandMudRoster: a size the roster already meets adds nothing, and an empty roster grows nothing", () => {
  assert.deepEqual(expandMudRoster(ROSTER, 2), ROSTER, "shrinking is not this function's job");
  assert.deepEqual(expandMudRoster([], 5), []);
});

test("mintedCharacterFacts: an unplaced character copies its species' authored type, room and mass", () => {
  const minted = mintedCharacterFacts(worldPayload.facts, ["mole-4"]);
  assert.deepEqual(minted, [
    { subject: "mole-4", predicate: "rdf:type", object: "adventurer" },
    { subject: "mole-4", predicate: "mgx:currently-in", object: "garden" },
    { subject: "mole-4", predicate: "mgx:hasMass", object: "8" },
  ]);
});

test("mintedCharacterFacts: an authored character mints nothing, and a species the world never authors is skipped", () => {
  assert.deepEqual(mintedCharacterFacts(worldPayload.facts, ["mole-1", "badger-2"]), []);
  assert.deepEqual(mintedCharacterFacts(worldPayload.facts, ["meerkat-1"]), []);
});

test("worldFactsForCast: an authored animal nobody is playing is left out of the world, props and rooms untouched", () => {
  const opened = worldFactsForCast(worldPayload.facts, ["mole-1"]);
  const subjects = new Set(opened.map((f) => f.subject));
  assert.ok(subjects.has("mole-1"), "the animal in play is placed");
  assert.ok(!subjects.has("badger-2"), "the animal nobody drives is not in the world at all");
  assert.ok(subjects.has("carrot") && subjects.has("garden"), "the props and rooms are the world, not the cast");
});

test("worldFactsForCast: a minted character can copy an authored animal the cast itself leaves out", () => {
  const opened = worldFactsForCast(worldPayload.facts, ["badger-5"]);
  const badgerRows = opened.filter((f) => f.subject.startsWith("badger"));
  assert.deepEqual(badgerRows.map((f) => f.subject), ["badger-5", "badger-5", "badger-5"]);
  assert.equal(badgerRows.find((f) => f.predicate === "mgx:currently-in").object, "burrow-1");
});

test("a minted character opens a window of its own, starts where its species starts, and takes a real scripted turn", async () => {
  const characters = ["mole-1", "badger-3"];
  const session = await createMudSession(worldPayload, { characters });
  assert.deepEqual(Object.keys(session.windows).sort(), ["badger-3", "mole-1"]);

  const opening = await session.snapshot();
  assert.equal(opening.state.placements.get("badger-3").object, "burrow-1", "it starts where the authored badger does");
  assert.equal(opening.state.masses.get("badger-3").value, 9, "and weighs what the authored badger weighs");

  const result = await session.windows["badger-3"].autoplayTick(1);
  assert.equal(result.character, "badger-3");
  assert.ok(result.room, "the turn ran in a real room rather than declining");
  assert.equal(session.windows["badger-3"].turnsTaken(), 1);
});

test("a minted character is an ordinary room-mate: the authored one's own look sees it and can talk to it", async () => {
  const session = await createMudSession(worldPayload, { characters: ["mole-1", "mole-2"] });
  const looked = await session.windows["mole-1"].turn("look");
  assert.match(looked.answer, /mole-2/, "the room digest names the minted animal standing in it");
  assert.match(looked.answer, /talk to mole-2/, "and offers the same talk the authored cast would get");
});

test("a character starts already knowing about food already sitting in its own starting room, before any turn runs", async () => {
  const worldWithFoodClass = {
    ...worldPayload,
    facts: [...worldPayload.facts, { subject: "carrot", predicate: "rdfs:subClassOf", object: "food" }],
  };
  const session = await createMudSession(worldWithFoodClass, { characters: ["mole-1", "badger-2"] });
  const rows = readFactRows(await loadMemory(session.memoryDir));
  const state = foldWorldState(worldActionRows(rows));

  assert.deepEqual(
    personKnownFoodLines(rows, state, "mole-1"), ["carrot"],
    "mole-1 starts in the garden, right where the carrot is seeded, so it already knows about it",
  );
  assert.deepEqual(
    personKnownFoodLines(rows, state, "badger-2"), [],
    "badger-2 starts in burrow-1, nowhere near the carrot, so it starts knowing nothing — the honest answer for it",
  );
  assert.equal(
    session.windows["mole-1"].turnsTaken(), 0,
    "the seeded knowledge is not counted as a turn the character took",
  );
});

test("a recast session seeds its epoch marker, so leftover snapshots from the old run fold as history", async () => {
  const session = await createMudSession(worldPayload, { characters: ["mole-1"] });
  assert.equal((await session.snapshot()).state.epoch, 0, "an unrecast boot writes no marker and stays on epoch 0");

  const recast = await createMudSession(worldPayload, { characters: ["mole-1"], epoch: 2 });
  const opening = await recast.snapshot();
  assert.equal(opening.state.epoch, 2, "the marker travels as an ordinary world row");
  assert.equal(opening.state.turnCount, 0, "the new run has played nothing yet");
  const marker = opening.rows.find((r) => r.predicate === "mgx:world-epoch");
  assert.equal(marker.object, "2");
  assert.match(marker.provenance, /^world:mud-garden/, "seeded with the world's own tag, so the state fold reads it");

  // The convergence case: an old run's snapshots merge into this store (facts
  // are add-only) but can no longer outrank the fresh seed.
  const { appendFacts } = await import("../../src/adapters/memory/core.mjs");
  await appendFacts(recast.memoryDir, [
    { subject: "mole-1@turn9", predicate: "mgx:currently-in", object: "burrow-1", provenance: "world:mud-garden:turn9" },
  ]);
  const merged = await recast.snapshot();
  assert.equal(merged.state.placements.get("mole-1").object, "garden",
    "the old run's turn-9 move stays in the graph but never reads as current");

  const result = await recast.windows["mole-1"].autoplayTick(1);
  assert.ok(result.room, "the new run plays on");
  const stamped = (await recast.snapshot()).rows.some((r) => r.subject.includes("@epoch2@turn"));
  assert.ok(stamped, "and its own writes carry the epoch, so they outrank the old run everywhere they merge");
});

// A page's teach checkbox reaches every character's turn as
// `gameConfig.adventure.teach`, read fresh through `getTeachEnabled` rather
// than fixed at open. worldPayload's garden carries mgx:is-origin, so
// originRoomOf reads this as a burrow and liveWorldAnswer picks the mud
// sentence table (parseMudEditorLine/planTaughtMudTriple), which says
// placement as "lies in" rather than the manor's "is in".
test("teach off: a declarative sentence takes chat's own generic teach lane, not world-teach's", async () => {
  const session = await createMudSession(worldPayload, { characters: ["mole-1"], getTeachEnabled: () => false });
  const result = await session.windows["mole-1"].turn("Pebble lies in the garden.");
  assert.ok(!/there's a pebble/i.test(result.answer), "world-teach's own confirmation never fires");
  const snap = await session.snapshot();
  assert.equal(snap.state.placements.has("pebble"), false, "nothing was minted into the live world");
});

// A fresh session per leg (rather than flipping the same session's checkbox
// mid-game, as the adventure test above does): the "off" leg's sentence still
// reaches chat's own generic teach lane, which mints "pebble" under its own
// provenance — a real, unrelated write that would shift world-teach's later
// id-collision fallback to "pebble-1" and obscure what this test checks.
test("teach on: the same sentence mints the thing and confirms in world-teach's own shape", async () => {
  const session = await createMudSession(worldPayload, { characters: ["mole-1"], getTeachEnabled: () => true });
  const result = await session.windows["mole-1"].turn("Pebble lies in the garden.");
  assert.match(result.answer, /^noted — there's a pebble in the garden now\./, "matches confirmation()'s own minted-placement shape");
  const snap = await session.snapshot();
  assert.equal(snap.state.placements.get("pebble")?.object, "garden", "the pebble is written into the live world");
});
