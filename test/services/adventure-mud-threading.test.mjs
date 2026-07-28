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
  worldDigestRows, personRoomReport,
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
    const dug = await run(dir, { verb: "dig", direction: "north" }, "mole-1");
    assert.equal(dug.miss, false);
    assert.match(dug.text, /you dig north and open up a new room\./);

    const state = await foldOf(dir);
    assert.equal(state.exits.get("garden").get("north"), "garden-north", "the id scheme is <room>-<direction>");
    assert.equal(state.exits.get("garden-north").get("south"), "garden", "the way back is written too");
    assert.equal(state.placements.get("mole-1").object, "garden", "digging spends the turn without moving the digger");

    const { rows } = await rowsAndState(dir);
    assert.ok(
      rows.some((r) => r.subject === "garden-north" && r.predicate === "rdf:type" && r.object === "room"),
      "the dug room is typed as a room",
    );
    const spawned = [...state.placements]
      .filter(([, p]) => p.object === "garden-north" && p.predicate === "mgx:located-in")
      .map(([thing]) => thing);
    assert.ok(spawned.length <= 2, `a dig spawns a bounded number of objects, got ${spawned.length}`);
    for (const thing of spawned) {
      assert.match(thing, /-garden-north$/, "a spawned object's id names the room it was dug into");
    }
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
    await run(dir, { verb: "dig", direction: "east" }, "vole-1");
    const walked = await run(dir, { verb: "go", direction: "east" }, "vole-1");
    assert.equal(walked.miss, false);
    const state = await foldOf(dir);
    assert.equal(state.placements.get("vole-1").object, "garden-east");
    assert.equal(state.placements.get("mole-1").object, "garden", "the other character never followed");
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
  assert.deepEqual(state.masses.get("mole-1"), { value: 11, turn: 2 });
  assert.deepEqual(state.masses.get("vole-1"), { value: 6, turn: 0 });
  assert.equal(state.masses.has("badger-1"), false, "a mass that isn't a number is no mass at all");
  assert.equal(state.turnCount, 2);
});
