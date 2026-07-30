// Several characters acting independently in ONE shared world: every state
// reader and writer takes the acting subject as a parameter, so two animals
// standing in the same garden never read each other's position, inventory or
// room contents as their own. The mud-garden world is the fixture — two typed
// adventurers, a multi-level burrow, food, and the dig/eat/put families.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getWorldsPackProvider, clearWorldsPackCache } from "../../src/adapters/corpus/worlds-pack.mjs";
import {
  runWorldCommand, foldWorldState, worldActionRows, roomAffordances,
  worldDigestRows, personRoomReport, personKnowledgeLines,
  diggableDirections, roomDistanceFromOrigin,
  recordMassDrain, isOutOfPlay, outOfPlayReasonOf,
} from "../../src/services/adventure.mjs";
import { worldProvenanceTag } from "../../src/domain/worlds-pack.mjs";
import { appendFacts, appendRule, loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";

const WORLD = "mud-garden";

async function loadMudGardenInto(dir) {
  clearWorldsPackCache();
  const world = await getWorldsPackProvider({}).load(WORLD);
  assert.ok(world, "the mud-garden world ships in the pack");
  const tag = worldProvenanceTag(world.name);
  await appendFacts(dir, world.facts.map((f) => ({
    subject: f.subject, predicate: f.predicate, object: f.object, provenance: tag,
  })));
  for (const rule of world.rules) {
    await appendRule(dir, { name: rule.name, kind: rule.ruleKind, slots: rule.slots, provenance: tag });
  }
}

async function withMudGarden(name, body) {
  const dir = await mkdtemp(join(tmpdir(), `tmct-mud-${name}-`));
  try {
    await loadMudGardenInto(dir);
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const run = (dir, cmd, actingSubject) =>
  runWorldCommand(cmd, { world: WORLD, memoryDir: dir, actingSubject });

async function foldOf(dir) {
  return foldWorldState(worldActionRows(readFactRows(await loadMemory(dir))));
}

async function rowsAndState(dir) {
  const rows = readFactRows(await loadMemory(dir));
  return { rows, state: foldWorldState(worldActionRows(rows)) };
}

test("two acting subjects move independently through one shared world", async () => {
  await withMudGarden("independent", async (dir) => {
    const before = await foldOf(dir);
    assert.equal(before.placements.get("mole-1").object, "garden");
    assert.equal(before.placements.get("vole-1").object, "garden");

    const moved = await run(dir, { verb: "go", direction: "down" }, "mole-1");
    assert.match(moved.text, /you go down\. Now in the burrow-1\./);
    assert.equal(moved.miss, false);

    const after = await foldOf(dir);
    assert.equal(after.placements.get("mole-1").object, "burrow-1", "the mover changed rooms");
    assert.equal(after.placements.get("vole-1").object, "garden", "the other character stayed exactly where it was");

    const voleLook = await run(dir, { verb: "look" }, "vole-1");
    assert.match(voleLook.text, /you are in the garden|garden/i);
    const moleLook = await run(dir, { verb: "look" }, "mole-1");
    assert.match(moleLook.note, /burrow-1/, "each character's look reads its OWN room");
  });
});

test("a character with no placement of its own is declined, never given another character's room", async () => {
  await withMudGarden("stranger", async (dir) => {
    const stranger = await run(dir, { verb: "look" }, "badger-1");
    assert.equal(stranger.miss, true);
    assert.match(stranger.text, /no written player position/);
  });
});

test("dig mints a room with exits both ways and leaves the digger where it stood", async () => {
  await withMudGarden("dig", async (dir) => {
    await run(dir, { verb: "go", direction: "west" }, "badger-2");
    const dug = await run(dir, { verb: "dig", direction: "south" }, "badger-2");
    assert.equal(dug.miss, false);
    assert.match(dug.text, /you dig south and open up a new room\./);

    const state = await foldOf(dir);
    assert.equal(state.exits.get("burrow-1").get("south"), "burrow-1-south", "the id scheme is <room>-<direction>");
    assert.equal(state.exits.get("burrow-1-south").get("north"), "burrow-1", "the way back is written too");
    assert.equal(state.placements.get("badger-2").object, "burrow-1", "digging spends the turn without moving the digger");

    const { rows } = await rowsAndState(dir);
    assert.ok(
      rows.some((r) => r.subject === "burrow-1-south" && r.predicate === "rdf:type" && r.object === "room"),
      "the dug room is typed as a room",
    );
    assert.ok(
      rows.some((r) => r.subject === "burrow-1-south" && r.predicate === "rdf:type" && r.object === "underground-space"),
      "a room dug sideways out of the burrow is underground too",
    );
    const spawned = [...state.placements]
      .filter(([, p]) => p.object === "burrow-1-south" && p.predicate === "mgx:located-in")
      .map(([thing]) => thing);
    assert.ok(spawned.length <= 2, `a plain dig spawns a bounded number of objects, got ${spawned.length}`);
    for (const thing of spawned) {
      assert.match(thing, /^[a-z]+-\d+$/, "a spawned object reads as its kind and a small number, never a room path");
      assert.equal(
        rows.find((r) => r.subject === thing && r.predicate === "mgx:display-name")?.object,
        thing.replace(/-\d+$/, ""),
        "and carries the plain kind as the name to show it by",
      );
    }
  });
});

test("some digs break into a den: a food store, and sometimes a resident to ask about it", async () => {
  await withMudGarden("dig-den", async (dir) => {
    const dug = await run(dir, { verb: "dig", direction: "north" }, "badger-2");
    assert.equal(dug.miss, false);
    assert.match(dug.text, /you dig north and break into a den somebody hollowed out\./);
    assert.match(dug.text, /Stored in it: the carrot-1, the root-1, the worm-1\./);
    assert.match(dug.text, /The mouse-1 lives here/);

    const { rows, state } = await rowsAndState(dir);
    assert.ok(
      rows.some((r) => r.subject === "sett-1-north" && r.predicate === "rdf:type" && r.object === "den"),
      "the room carries the den class the world declares, on top of its ordinary room typing",
    );
    assert.equal(
      state.masses.get("carrot-1").value, 3,
      "a dug instance copies the mass its own class declares, so eating it is worth what a carrot is worth",
    );
    assert.equal(
      state.placements.get("mouse-1").predicate, "mgx:currently-in",
      "the resident is placed like the rest of the cast, so it can be talked to",
    );
    assert.deepEqual(
      personKnowledgeLines(rows, state, "mouse-1").aboutTopics, ["carrot-1", "root-1", "worm-1"],
      "and knows what its own den holds, which is what a visitor comes to ask about",
    );
  });
});

test("digging stops at the world's own boundary rather than sprawling on forever", async () => {
  await withMudGarden("dig-boundary", async (dir) => {
    const tag = worldProvenanceTag(WORLD);
    // A straight line of rooms running east from the sett, laid down directly
    // so each one's distance from the garden is a fixed, stated number rather
    // than whatever a run of seeded digs happens to produce. The sett itself
    // already stands two exits out, so far-3 through far-6 are three to six.
    const chain = ["sett-1", "far-3", "far-4", "far-5", "far-6"];
    const links = [];
    for (let i = 1; i < chain.length; i += 1) {
      links.push({ subject: chain[i], predicate: "rdf:type", object: "room", provenance: tag });
      links.push({ subject: chain[i], predicate: "rdf:type", object: "underground-space", provenance: tag });
      links.push({ subject: chain[i - 1], predicate: "mgx:has-exit-east", object: chain[i], provenance: tag });
      links.push({ subject: chain[i], predicate: "mgx:has-exit-west", object: chain[i - 1], provenance: tag });
    }
    await appendFacts(dir, links);

    const { rows, state } = await rowsAndState(dir);
    assert.equal(roomDistanceFromOrigin(rows, state, "far-6"), 6, "far-6 sits six exits from the garden");
    assert.deepEqual(
      diggableDirections(rows, state, "far-6"), [],
      "a room at the boundary offers no dig at all, so nothing suggests one the verb would refuse",
    );
    assert.ok(
      diggableDirections(rows, state, "far-5").includes("north"),
      "one room short of it still has a frontier",
    );

    await appendFacts(dir, [{
      subject: "badger-2@turn40", predicate: "mgx:currently-in", object: "far-6", provenance: `${tag}:turn40`,
    }]);
    const declined = await run(dir, { verb: "dig", direction: "north" }, "badger-2");
    assert.equal(declined.miss, true);
    assert.match(declined.text, /far edge of the burrow/);
    assert.match(declined.note, /distance from the origin/);
  });
});

test("dig follows the room's own kind: sideways underground, straight down from the surface", async () => {
  await withMudGarden("dig-kinds", async (dir) => {
    const sideways = await run(dir, { verb: "dig", direction: "north" }, "mole-1");
    assert.equal(sideways.miss, true, "the garden is open ground — there is nothing to tunnel north through");
    assert.match(sideways.text, /open ground/);

    const sky = await run(dir, { verb: "dig", direction: "up" }, "mole-1");
    assert.equal(sky.miss, true);
    assert.match(sky.text, /sky above the garden/);

    const deeper = await run(dir, { verb: "dig", direction: "down" }, "badger-2");
    assert.equal(deeper.miss, true, "the burrow runs one level deep");
    assert.match(deeper.text, /one level deep/);

    const surfaced = await run(dir, { verb: "dig", direction: "up" }, "badger-2");
    assert.equal(surfaced.miss, false, "digging up out of the burrow breaks the surface");
    const { rows } = await rowsAndState(dir);
    assert.ok(
      rows.some((r) => r.subject === "sett-1-up" && r.predicate === "rdf:type" && r.object === "outdoor-space"),
      "and the room it opens is above ground",
    );
  });
});

test("walking into the fox's den ends that animal's run", async () => {
  await withMudGarden("fox", async (dir) => {
    const down = await run(dir, { verb: "go", direction: "down" }, "mole-1");
    assert.equal(down.miss, false);

    const eaten = await run(dir, { verb: "go", direction: "north" }, "mole-1");
    assert.equal(eaten.miss, false);
    assert.match(eaten.text, /the fox-1 is waiting\. It eats the mole-1/);

    const state = await foldOf(dir);
    assert.equal(state.placements.get("mole-1").object, "eaten", "the mole is out of the world, not standing in the den");
    assert.equal(state.placements.get("vole-1").object, "garden", "and nobody else is touched by it");

    const after = await run(dir, { verb: "look" }, "mole-1");
    assert.equal(after.miss, true);
    assert.match(after.text, /has been eaten — it takes no more turns/);
  });
});

test("a character whose mass runs out starves, and is out of play the same way an eaten one is", async () => {
  await withMudGarden("starve", async (dir) => {
    const first = await recordMassDrain(dir, { world: WORLD, subject: "vole-1", drainPerTurn: 2 });
    assert.deepEqual(first, { mass: 4, starved: false }, "the vole's 6 less the 2 a turn costs it");

    await recordMassDrain(dir, { world: WORLD, subject: "vole-1", drainPerTurn: 2 });
    const last = await recordMassDrain(dir, { world: WORLD, subject: "vole-1", drainPerTurn: 2 });
    assert.deepEqual(last, { mass: 0, starved: true });

    const state = await foldOf(dir);
    assert.equal(state.placements.get("vole-1").object, "starved", "it is placed out of play, not left standing in the garden");
    assert.equal(isOutOfPlay(state, "vole-1"), true);
    assert.equal(outOfPlayReasonOf(state, "vole-1"), "starved", "and the reason tells starving apart from being eaten");
    assert.equal(state.placements.get("mole-1").object, "garden", "nobody else is touched by it");

    const after = await run(dir, { verb: "look" }, "vole-1");
    assert.equal(after.miss, true);
    assert.match(after.text, /the vole-1 has starved — it takes no more turns/);

    const drainedAgain = await recordMassDrain(dir, { world: WORLD, subject: "vole-1", drainPerTurn: 2 });
    assert.deepEqual(drainedAgain, { mass: 0, starved: false }, "a starved character is charged nothing further");
  });
});

test("a subject the world writes no mass for is charged nothing and never starves", async () => {
  await withMudGarden("starve-massless", async (dir) => {
    const drained = await recordMassDrain(dir, { world: WORLD, subject: "basket", drainPerTurn: 2 });
    assert.deepEqual(drained, { mass: null, starved: false });
    const state = await foldOf(dir);
    assert.equal(state.placements.get("basket").object, "garden");
  });
});

test("dig declines rather than overwriting an exit that already stands", async () => {
  await withMudGarden("dig-collide", async (dir) => {
    const declined = await run(dir, { verb: "dig", direction: "down" }, "mole-1");
    assert.equal(declined.miss, true);
    assert.equal(declined.text, "there's already an exit down from the garden.");

    const state = await foldOf(dir);
    assert.equal(state.exits.get("garden").get("down"), "burrow-1", "the standing exit is untouched");
  });
});

test("a dug room is reachable by the ordinary go verb on the turn after the dig", async () => {
  await withMudGarden("dig-then-go", async (dir) => {
    await run(dir, { verb: "dig", direction: "east" }, "groundhog-1");
    const walked = await run(dir, { verb: "go", direction: "east" }, "groundhog-1");
    assert.equal(walked.miss, false);
    const state = await foldOf(dir);
    assert.equal(state.placements.get("groundhog-1").object, "sett-1-east");
    assert.equal(state.placements.get("badger-2").object, "sett-1", "the other character never followed");
  });
});

test("eating food moves its mass onto the eater and takes the food out of the world", async () => {
  await withMudGarden("eat", async (dir) => {
    const eaten = await run(dir, { verb: "eat", object: "carrot" }, "vole-1");
    assert.equal(eaten.miss, false);
    assert.match(eaten.text, /you eat the carrot\./);

    const state = await foldOf(dir);
    assert.equal(state.masses.get("vole-1").value, 9, "the vole's 6 plus the carrot's 3");
    assert.equal(state.masses.get("mole-1").value, 8, "the other character's mass is untouched");
    assert.notEqual(state.placements.get("carrot").object, "garden", "the carrot left the garden");

    const { rows, state: fresh } = await rowsAndState(dir);
    assert.ok(
      !roomAffordances(rows, fresh, "garden", "mole-1").includes("take carrot"),
      "an eaten thing is no longer offered as a room affordance",
    );
    assert.ok(
      !worldDigestRows(rows, fresh, "mole-1").some((r) => /carrot/i.test(`${r.subject} ${r.object}`)),
      "an eaten thing is out of the room digest entirely",
    );
  });
});

test("eat declines by name on a thing that is present but not food", async () => {
  await withMudGarden("eat-nonfood", async (dir) => {
    const declined = await run(dir, { verb: "eat", object: "stone" }, "mole-1");
    assert.equal(declined.miss, true);
    assert.equal(declined.text, "the stone isn't food.");
    const state = await foldOf(dir);
    assert.equal(state.placements.get("stone").object, "garden", "a declined eat writes nothing");
  });
});

test("eat declines by name on food that is in another room", async () => {
  await withMudGarden("eat-absent", async (dir) => {
    const declined = await run(dir, { verb: "eat", object: "seed" }, "mole-1");
    assert.equal(declined.miss, true);
    assert.equal(declined.text, "I don't see a seed here.");
  });
});

test("eat declines a character already at half its reference mass", async () => {
  await withMudGarden("eat-full", async (dir) => {
    await appendFacts(dir, [{
      subject: "mole-1@turn9", predicate: "mgx:hasMass", object: "15",
      provenance: `${worldProvenanceTag(WORLD)}:turn9`,
    }]);
    const declined = await run(dir, { verb: "eat", object: "carrot" }, "mole-1");
    assert.equal(declined.miss, true);
    assert.equal(declined.text, "you're too full to eat the carrot.");
  });
});

test("a carried thing can be eaten without dropping it first", async () => {
  await withMudGarden("eat-carried", async (dir) => {
    await run(dir, { verb: "take", object: "carrot" }, "vole-1");
    const eaten = await run(dir, { verb: "eat", object: "carrot" }, "vole-1");
    assert.equal(eaten.miss, false);
    const state = await foldOf(dir);
    assert.equal(state.masses.get("vole-1").value, 9);
  });
});

test("put places a carried thing into an open container standing in the room", async () => {
  await withMudGarden("put", async (dir) => {
    await run(dir, { verb: "take", object: "stone" }, "mole-1");
    const put = await run(dir, { verb: "put", object: "stone", indirectObject: "basket" }, "mole-1");
    assert.equal(put.miss, false);
    assert.match(put.text, /you put the stone in the basket\./);

    const state = await foldOf(dir);
    assert.deepEqual(
      { predicate: state.placements.get("stone").predicate, object: state.placements.get("stone").object },
      { predicate: "mgx:located-in", object: "basket" },
    );
  });
});

test("put declines by name when the thing isn't carried, the target is absent, or the target is shut", async () => {
  await withMudGarden("put-declines", async (dir) => {
    const notCarried = await run(dir, { verb: "put", object: "stone", indirectObject: "basket" }, "mole-1");
    assert.equal(notCarried.miss, true);
    assert.equal(notCarried.text, "you're not carrying the stone.");

    await run(dir, { verb: "take", object: "stone" }, "mole-1");

    const absent = await run(dir, { verb: "put", object: "stone", indirectObject: "bucket-1" }, "mole-1");
    assert.equal(absent.miss, true);
    assert.equal(absent.text, "I don't see a bucket-1 here.");

    await run(dir, { verb: "close", object: "basket" }, "mole-1");
    const shut = await run(dir, { verb: "put", object: "stone", indirectObject: "basket" }, "mole-1");
    assert.equal(shut.miss, true);
    assert.equal(shut.text, "the basket is closed.");
  });
});

test("put declines by name when the target holds nothing at all", async () => {
  await withMudGarden("put-noncontainer", async (dir) => {
    await run(dir, { verb: "take", object: "stone" }, "mole-1");
    const declined = await run(dir, { verb: "put", object: "stone", indirectObject: "carrot" }, "mole-1");
    assert.equal(declined.miss, true);
    assert.equal(declined.text, "the carrot doesn't hold things.");
  });
});

test("a thing one character carries is out of the room for every other character too", async () => {
  await withMudGarden("carried-visibility", async (dir) => {
    const taken = await run(dir, { verb: "take", object: "stone" }, "vole-1");
    assert.equal(taken.miss, false);

    const { rows, state } = await rowsAndState(dir);

    assert.ok(
      !roomAffordances(rows, state, "garden", "mole-1").includes("take stone"),
      "the mole is never offered a stone the vole is holding",
    );
    assert.ok(
      roomAffordances(rows, state, "garden", "vole-1").includes("take carrot"),
      "what really is loose in the room stays on offer",
    );

    const seenByMole = await run(dir, { verb: "take", object: "stone" }, "mole-1");
    assert.equal(seenByMole.miss, true);
    assert.equal(seenByMole.text, "I don't see a stone here.");

    assert.ok(
      !personRoomReport(rows, state, "vole-1", "mole-1").includes("stone"),
      "a room report never lists a carried thing as standing in the room",
    );

    const digest = worldDigestRows(rows, state, "mole-1");
    assert.ok(
      digest.some((r) => r.subject === "Vole-1" && r.predicate === "carries the" && r.object === "stone"),
      "the holder reads as carrying it, not as a place the stone sits in",
    );
    assert.ok(
      !digest.some((r) => r.subject === "Mole-1" && r.predicate === "carries the" && r.object === "stone"),
      "the acting character is not credited with another character's load",
    );
  });
});

test("each character's inventory is its own", async () => {
  await withMudGarden("inventory", async (dir) => {
    await run(dir, { verb: "take", object: "stone" }, "vole-1");
    const state = await foldOf(dir);
    const carriedBySubject = (subject) => [...state.placements]
      .filter(([, p]) => p.predicate === "mgx:located-in" && p.object === subject)
      .map(([thing]) => thing);
    assert.deepEqual(carriedBySubject("vole-1"), ["stone"]);
    assert.deepEqual(carriedBySubject("mole-1"), []);
  });
});

test("the mass fold takes the newest snapshot per subject and ignores an unparsable value", () => {
  const state = foldWorldState([
    { subject: "mole-1", predicate: "mgx:hasMass", object: "8" },
    { subject: "mole-1@turn2", predicate: "mgx:hasMass", object: "11" },
    { subject: "vole-1", predicate: "mgx:hasMass", object: "6" },
    { subject: "badger-1", predicate: "mgx:hasMass", object: "heavy" },
  ]);
  assert.deepEqual(state.masses.get("mole-1"), { value: 11, turn: 2, epoch: 0 });
  assert.deepEqual(state.masses.get("vole-1"), { value: 6, turn: 0, epoch: 0 });
  assert.equal(state.masses.has("badger-1"), false, "a mass that isn't a number is no mass at all");
  assert.equal(state.turnCount, 2);
});
