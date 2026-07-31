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

const rowsFor = (rows, predicate) => rows.filter((r) => r.predicate === predicate);

test("a wave writes a room-scoped fact the world's own fold never reads as state", async () => {
  const session = await createMudSession(worldPayload, { characters: ["mole-1"] });
  const before = await session.snapshot();

  assert.equal(await session.wave("mole-1"), "garden", "it waves in the room it is standing in");
  const after = await session.snapshot();
  const waves = rowsFor(after.rows, "mgx:waved");
  assert.equal(waves.length, 1);
  assert.equal(waves[0].subject, "mole-1");
  assert.equal(waves[0].object, "garden");
  assert.equal(
    after.state.placements.get("mole-1").object,
    before.state.placements.get("mole-1").object,
    "a gesture moves nothing",
  );
  assert.equal(after.state.turnCount, before.state.turnCount, "and costs no turn");
});

test("waving twice supersedes the first wave, so the live tag is the fresher one and the older is kept behind it", async () => {
  const session = await createMudSession(worldPayload, { characters: ["mole-1"] });
  await session.wave("mole-1");
  const first = rowsFor((await session.snapshot()).rows, "mgx:waved")[0].provenance;
  await session.wave("mole-1");
  const waves = rowsFor((await session.snapshot()).rows, "mgx:waved");
  assert.equal(waves.length, 1, "the same character waving in the same room is the same fact id");
  // One waver is one hop, so its record holds one tag: its CURRENT belief. The
  // repeat wave replaces it rather than piling up, which is what keeps
  // "currently waving" a recency read over a single timestamp.
  assert.equal(waves[0].provenance.split(" | ").length, 1);
  assert.notEqual(waves[0].provenance, first, "and the live tag is the later wave's");
  assert.ok(Date.parse(waves[0].createdAt ?? waves[0].assertions[0].createdAt) > Date.parse(first.split("@").pop()));

  // the first wave is not discarded — it moves behind the head, linked both ways
  const { loadMemory } = await import("../../src/adapters/memory/core.mjs");
  const m = await loadMemory(session.memoryDir);
  const demoted = m.individuals.filter((i) => i.class === "Fact" && /#v1$/.test(i.id));
  const attrOf = (ind, prop) => ind.attributes.find((a) => a.prop === prop)?.value;
  assert.equal(demoted.length, 1, "exactly one superseded wave");
  assert.equal(attrOf(demoted[0], "mgx:factProvenance"), first, "kept unmutated");
  assert.equal(attrOf(demoted[0], "mgx:supersededBy"), waves[0].assertions[0].id);
  assert.equal(attrOf(m.individuals.find((i) => i.id === waves[0].assertions[0].id), "mgx:supersedes"), demoted[0].id);
});

test("a recast session seeds its epoch marker, so a peer's leftover snapshots from the old run fold as history", async () => {
  const session = await createMudSession(worldPayload, { characters: ["mole-1"] });
  assert.equal((await session.snapshot()).state.epoch, 0, "an unrecast boot writes no marker and stays on epoch 0");

  const recast = await createMudSession(worldPayload, { characters: ["mole-1"], epoch: 2 });
  const opening = await recast.snapshot();
  assert.equal(opening.state.epoch, 2, "the marker travels as an ordinary world row");
  assert.equal(opening.state.turnCount, 0, "the new run has played nothing yet");
  const marker = opening.rows.find((r) => r.predicate === "mgx:world-epoch");
  assert.equal(marker.object, "2");
  assert.match(marker.provenance, /^world:mud-garden/, "seeded with the world's own tag, so the state fold reads it");

  // The convergence case a rebind creates: a peer that never recast syncs its
  // old run's snapshots into this store. They merge (facts are add-only) but
  // can no longer outrank the fresh seed.
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

test("a claim is one add-only fact per animal, and two claims on one animal both stand", async () => {
  const session = await createMudSession(worldPayload, { characters: ["mole-1", "badger-2"] });
  assert.equal(await session.claimCharacters(["mole-1", "badger-2"], "alpha"), 2);
  await session.claimCharacters(["mole-1"], "beta");

  const claims = rowsFor((await session.snapshot()).rows, "mgx:playedBy");
  assert.deepEqual(
    claims.filter((r) => r.subject === "mole-1").map((r) => r.object).sort(),
    ["alpha", "beta"],
    "nothing is overwritten — both claims stand and every reader settles them the same way",
  );
  assert.deepEqual(claims.filter((r) => r.subject === "badger-2").map((r) => r.object), ["alpha"]);
});

test("neither a claim nor a wave can move a character or open a room", async () => {
  const session = await createMudSession(worldPayload, { characters: ["mole-1"] });
  await session.claimCharacters(["mole-1"], "alpha");
  await session.wave("mole-1");
  const snap = await session.snapshot();
  assert.equal(snap.state.placements.get("mole-1").object, "garden");
  assert.equal(snap.state.exits.get("garden").size, 1, "the garden still has exactly the one shaft it was written with");
});
