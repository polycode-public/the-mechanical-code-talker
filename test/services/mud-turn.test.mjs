// One character's whole turn, driven end to end: it investigates where it
// stands, walks only toward food it has really been told about or seen, digs at
// the frontier on a seeded roll, and (when none of that came to anything) sets
// off for a room it has never stood in. Every decision is reproducible from
// (character, turn, room, decision), so the same starting store always plays
// out the same way. A character with no food fact still takes no food walk —
// that stays the honest answer — and the explore step it falls through to makes
// a different claim entirely, about where the character itself has been.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getWorldsPackProvider, clearWorldsPackCache } from "../../src/adapters/corpus/worlds-pack.mjs";
import { runMudTurn } from "../../src/services/mud-turn.mjs";
import {
  recordTold, recordExamined, personKnowledgeLines, foldWorldState, worldActionRows,
} from "../../src/services/adventure.mjs";
import { worldProvenanceTag } from "../../src/domain/worlds-pack.mjs";
import { DEFAULT_GAME_CONFIG } from "../../src/domain/game-config.mjs";
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
  const dir = await mkdtemp(join(tmpdir(), `tmct-mud-turn-${name}-`));
  try {
    await loadMudGardenInto(dir);
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function rowsAndState(dir) {
  const rows = readFactRows(await loadMemory(dir));
  return { rows, state: foldWorldState(worldActionRows(rows)) };
}

async function topicsOf(dir, character) {
  const { rows, state } = await rowsAndState(dir);
  return personKnowledgeLines(rows, state, character).aboutTopics;
}

const knowsAboutRows = (rows) => rows.filter((r) => r.predicate === "mgx:knows-about");

const turn = (dir, character, k) => runMudTurn(character, { world: WORLD, memoryDir: dir, k });

const stepsOf = (result, step) => result.actions.filter((a) => a.step === step);
const kindsOf = (result, step) => stepsOf(result, step).map((a) => a.kind);

/** Walk `character` back to `room` between turns. A turn with nothing else to
 *  do sets off for a room the character has never stood in, so a test about two
 *  animals talking has to put them back beside each other itself. */
async function standBeside(dir, character, room, k) {
  await appendFacts(dir, [{
    subject: `${character}@turn${k}`, predicate: "mgx:currently-in", object: room,
    provenance: `${worldProvenanceTag(WORLD)}:turn${k}`,
  }]);
}

/** A carrot placed in the burrow, so a character told about it has somewhere
 *  real to walk. The garden's own carrot is moved out of the way first, so the
 *  only food it can know about is a room away. */
async function plantCarrotInBurrow(dir) {
  await appendFacts(dir, [
    { subject: "carrot-2", predicate: "rdf:type", object: "carrot", provenance: worldProvenanceTag(WORLD) },
    { subject: "carrot-2", predicate: "mgx:located-in", object: "burrow-1", provenance: worldProvenanceTag(WORLD) },
    { subject: "carrot-2", predicate: "mgx:hasMass", object: "3", provenance: worldProvenanceTag(WORLD) },
  ]);
}

test("a character that knows of no food takes no directed walk, and says so rather than wandering", async () => {
  await withMudGarden("no-food-knowledge", async (dir) => {
    const before = await rowsAndState(dir);
    assert.deepEqual(
      personKnowledgeLines(before.rows, before.state, "mole-1").aboutTopics, [],
      "the world ships the mole no knowledge of its own",
    );
    assert.ok(before.state.exits.get("garden").has("down"), "there IS an exit out of the garden to walk through");

    const played = await turn(dir, "mole-1", 1);

    assert.deepEqual(kindsOf(played, "walk"), ["none"], "the walk step fires, and takes no step");
    assert.match(
      stepsOf(played, "walk")[0].reason, /knows of no food/,
      "the reason names missing knowledge, not a missing exit",
    );
    assert.equal(
      played.actions.some((a) => a.step === "walk" && a.kind === "go"), false,
      "no go command is issued from the walk step",
    );
  });
});

test("a character told where food is walks one step toward it", async () => {
  await withMudGarden("walk-toward-told-food", async (dir) => {
    await plantCarrotInBurrow(dir);
    await recordTold(dir, { asker: "vole-1", teller: "mole-1", thing: "carrot-2", k: 1 });

    const played = await turn(dir, "vole-1", 2);

    const walk = stepsOf(played, "walk");
    assert.equal(walk.length, 1);
    assert.deepEqual(
      { kind: walk[0].kind, direction: walk[0].direction, toward: walk[0].toward, miss: walk[0].miss },
      { kind: "go", direction: "down", toward: "burrow-1", miss: false },
      "the burrow is one hop down, so the first step of the path is down",
    );

    const { state } = await rowsAndState(dir);
    assert.equal(state.placements.get("vole-1").object, "burrow-1", "the vole really moved");
    assert.equal(state.placements.get("mole-1").object, "garden", "the character that did not act stayed put");
    assert.equal(played.roomAfter, "burrow-1");
  });
});

test("a character walks only one hop of a longer path per turn", async () => {
  await withMudGarden("one-hop-per-turn", async (dir) => {
    const tag = worldProvenanceTag(WORLD);
    await appendFacts(dir, [
      { subject: "burrow-2", predicate: "rdf:type", object: "room", provenance: tag },
      { subject: "burrow-1", predicate: "mgx:has-exit-down", object: "burrow-2", provenance: tag },
      { subject: "burrow-2", predicate: "mgx:has-exit-up", object: "burrow-1", provenance: tag },
      { subject: "carrot-3", predicate: "rdf:type", object: "carrot", provenance: tag },
      { subject: "carrot-3", predicate: "mgx:located-in", object: "burrow-2", provenance: tag },
    ]);
    await recordTold(dir, { asker: "vole-1", teller: "mole-1", thing: "carrot-3", k: 1 });

    const first = await turn(dir, "vole-1", 2);
    assert.equal(stepsOf(first, "walk")[0].toward, "burrow-2", "the goal is two hops away");
    assert.equal(stepsOf(first, "walk")[0].hops, 2);
    assert.equal((await rowsAndState(dir)).state.placements.get("vole-1").object, "burrow-1");

    const second = await turn(dir, "vole-1", 3);
    assert.equal(stepsOf(second, "walk")[0].direction, "down");
    assert.equal((await rowsAndState(dir)).state.placements.get("vole-1").object, "burrow-2");
  });
});

test("food a character knows about but cannot reach leaves the walk with nothing to follow", async () => {
  await withMudGarden("unreachable-food", async (dir) => {
    const tag = worldProvenanceTag(WORLD);
    await appendFacts(dir, [
      { subject: "far-room", predicate: "rdf:type", object: "room", provenance: tag },
      { subject: "carrot-9", predicate: "rdf:type", object: "carrot", provenance: tag },
      { subject: "carrot-9", predicate: "mgx:located-in", object: "far-room", provenance: tag },
    ]);
    await recordTold(dir, { asker: "mole-1", teller: "vole-1", thing: "carrot-9", k: 1 });

    const played = await turn(dir, "mole-1", 2);

    assert.equal(kindsOf(played, "walk")[0], "none");
    assert.match(
      stepsOf(played, "walk")[0].reason, /reachable/,
      "the reason separates unreachable food from having no food fact at all",
    );
  });
});

test("asking the character standing beside you writes what it says as your own provenanced fact", async () => {
  await withMudGarden("ask-and-tell", async (dir) => {
    await plantCarrotInBurrow(dir);
    await recordExamined(dir, { observer: "mole-1", thing: "carrot-2", k: 1 });
    assert.deepEqual(await topicsOf(dir, "vole-1"), [], "the vole starts knowing nothing");

    const played = await turn(dir, "vole-1", 5);

    const ask = played.actions.find((a) => a.kind === "ask");
    assert.ok(ask, "the investigate step produced an ask");
    assert.deepEqual({ teller: ask.teller, thing: ask.thing }, { teller: "mole-1", thing: "carrot-2" });

    const { rows } = await rowsAndState(dir);
    const heard = knowsAboutRows(rows).find((r) => r.subject === "vole-1" && r.object === "carrot-2");
    assert.ok(heard, "the vole now carries a knows-about fact for what it was told");
    assert.equal(heard.provenance, "mud:mole-1:turn5", "the teller and the turn are both in the provenance");

    assert.ok((await topicsOf(dir, "vole-1")).includes("carrot-2"));
    assert.ok(played.learned.includes("carrot-2"), "the turn reports what the character learned");

    // Being told sent the vole down the burrow after the carrot; walk it back
    // beside the mole so the second turn faces the same room-mate as the first.
    await appendFacts(dir, [{
      subject: "vole-1@turn30", predicate: "mgx:currently-in", object: "garden",
      provenance: `${worldProvenanceTag(WORLD)}:turn30`,
    }]);
    const again = await turn(dir, "vole-1", 31);
    assert.equal(
      again.actions.some((a) => a.kind === "ask"), false,
      "a room-mate it has met and drained of food news is not worth speaking to again",
    );
    assert.ok(
      stepsOf(again, "investigate").some((a) => a.kind === "none" && /already heard everything/.test(a.reason)),
      "and the step says why it stayed quiet instead of repeating the same exchange",
    );
    const { rows: afterRows } = await rowsAndState(dir);
    assert.equal(
      knowsAboutRows(afterRows).filter((r) => r.subject === "vole-1" && r.object === "carrot-2").length, 1,
      "an exchange with nothing new in it writes no second testimony row",
    );
  });
});

test("an animal greets a room-mate it hasn't met, and names what it did or didn't learn", async () => {
  await withMudGarden("ask-skips", async (dir) => {
    const beside = await turn(dir, "vole-1", 1);
    const greeting = beside.actions.find((a) => a.kind === "ask");
    assert.ok(greeting, "the mole is standing right there, so the vole speaks to it");
    assert.equal(greeting.teller, "mole-1");
    assert.equal(greeting.thing, null, "the mole knows no food yet, so it tells nothing");
    assert.match(greeting.text, /greets the mole-1, but hears nothing new about food/);
    const { rows: saidRows } = await rowsAndState(dir);
    assert.deepEqual(
      knowsAboutRows(saidRows).filter((r) => r.provenance.startsWith("mud:mole-1:")), [],
      "and an empty answer leaves no testimony crediting the mole for anything",
    );

    await appendFacts(dir, [{
      subject: "vole-1@turn20", predicate: "mgx:currently-in", object: "burrow-1",
      provenance: `${worldProvenanceTag(WORLD)}:turn20`,
    }]);
    const alone = await turn(dir, "vole-1", 21);
    assert.equal(alone.room, "burrow-1", "the vole is now the only animal in the burrow");
    assert.equal(alone.actions.some((a) => a.kind === "ask"), false);
    assert.ok(
      stepsOf(alone, "investigate").some((a) => a.kind === "none" && /no other character/.test(a.reason)),
      "with nobody there, the reason is the empty room, not an empty answer",
    );
  });
});

test("the same empty greeting never repeats, and talking resumes the moment the room-mate learns a food", async () => {
  await withMudGarden("greet-once-then-news", async (dir) => {
    await plantCarrotInBurrow(dir);

    const met = await turn(dir, "vole-1", 1);
    assert.ok(met.actions.some((a) => a.kind === "ask"), "the first meeting is a real exchange");

    await standBeside(dir, "vole-1", "garden", 10);
    const second = await turn(dir, "vole-1", 11);
    assert.equal(
      second.actions.some((a) => a.kind === "ask"), false,
      "with nothing new to hear, the pair does not trade the same greeting again",
    );

    await recordExamined(dir, { observer: "mole-1", thing: "carrot-2", k: 20 });
    await standBeside(dir, "vole-1", "garden", 21);
    const resumed = await turn(dir, "vole-1", 22);
    const heard = resumed.actions.find((a) => a.kind === "ask");
    assert.ok(heard, "a room-mate that has learned a food is worth speaking to again");
    assert.deepEqual({ teller: heard.teller, thing: heard.thing }, { teller: "mole-1", thing: "carrot-2" });
  });
});

test("an unexamined thing in the room becomes durably known after a turn", async () => {
  await withMudGarden("examine", async (dir) => {
    assert.deepEqual(await topicsOf(dir, "mole-1"), []);

    const played = await turn(dir, "mole-1", 3);

    const examined = played.actions.find((a) => a.kind === "examine");
    assert.ok(examined, "the investigate step examined something");
    assert.ok(
      ["basket", "carrot", "stone"].includes(examined.thing),
      `it examined a thing really standing in the garden, got ${examined.thing}`,
    );

    const { rows } = await rowsAndState(dir);
    const seen = knowsAboutRows(rows).find((r) => r.subject === "mole-1" && r.object === examined.thing);
    assert.ok(seen);
    assert.equal(seen.provenance, "mud:mole-1:turn3", "an observer is its own source for what it looked at");
    assert.ok((await topicsOf(dir, "mole-1")).includes(examined.thing));
  });
});

test("a character never re-examines a thing it already knows about", async () => {
  await withMudGarden("no-re-examine", async (dir) => {
    for (const thing of ["basket", "carrot", "stone"]) {
      await recordExamined(dir, { observer: "mole-1", thing, k: 1 });
    }
    const played = await turn(dir, "mole-1", 2);

    assert.equal(played.actions.some((a) => a.kind === "examine"), false);
    assert.ok(
      stepsOf(played, "investigate").some((a) => a.kind === "none" && /unexamined/.test(a.reason)),
    );
    const { rows } = await rowsAndState(dir);
    assert.deepEqual(
      knowsAboutRows(rows).filter((r) => r.subject === "mole-1").map((r) => r.object).sort(),
      ["basket", "carrot", "stone", "vole-1"],
      "the three props keep one row each, and the only row added is the room-mate the mole greeted",
    );
  });
});

test("the same starting store plays the same turn out identically every time", async () => {
  const play = async (name) => {
    let result = null;
    let written = null;
    await withMudGarden(name, async (dir) => {
      await plantCarrotInBurrow(dir);
      await recordTold(dir, { asker: "vole-1", teller: "mole-1", thing: "carrot-2", k: 1 });
      result = await turn(dir, "vole-1", 2);
      const { rows } = await rowsAndState(dir);
      written = rows.map((r) => `${r.subject}\t${r.predicate}\t${r.object}\t${r.provenance}`);
    });
    return { result, written };
  };

  const first = await play("determinism-a");
  const second = await play("determinism-b");

  assert.deepEqual(second.result, first.result, "the returned turn is identical, text and all");
  assert.deepEqual(second.written, first.written, "and so is every fact row the turn left behind");
});

test("two characters playing several turns never inherit each other's knowledge unasked", async () => {
  await withMudGarden("no-cross-contamination", async (dir) => {
    await recordExamined(dir, { observer: "mole-1", thing: "seed", k: 0 });

    for (let k = 1; k <= 4; k += 1) {
      await turn(dir, "mole-1", k);
      await turn(dir, "vole-1", k);
    }

    const { rows } = await rowsAndState(dir);
    for (const row of knowsAboutRows(rows)) {
      assert.ok(
        ["mole-1", "vole-1"].includes(row.subject),
        `only the two acting characters accumulate knowledge, got ${row.subject}`,
      );
      for (const tag of row.provenance.split(" | ")) {
        const teller = tag.replace(/^mud:/, "").replace(/:turn\d+(?::gone)?$/, "");
        assert.ok(
          row.subject === teller || ["mole-1", "vole-1"].includes(teller),
          `every claim names a real character as its source, got ${tag}`,
        );
      }
    }

    // seed sits in the burrow and is not food, so the ask step never offers
    // it: the vole can only come to know it by standing in the burrow itself.
    const voleKnowsSeed = (await topicsOf(dir, "vole-1")).includes("seed");
    const voleVisitedBurrow = rows.some((r) => /^vole-1@turn\d+$/.test(r.subject) && r.object === "burrow-1");
    assert.equal(
      voleKnowsSeed && !voleVisitedBurrow, false,
      "the vole never picked up the mole's private knowledge of the seed by proximity",
    );
  });
});

test("a character at an edge with no walk to take digs, and only ever one direction per turn", async () => {
  // The badger starts in the sett, under the soil: the only room kind with a
  // frontier to dig at. Above ground the one dig is straight down, and the
  // garden's own way down is already open.
  await withMudGarden("edge-dig", async (dir) => {
    const dug = [];
    for (let k = 1; k <= 12; k += 1) {
      const played = await turn(dir, "badger-2", k);
      for (const action of stepsOf(played, "edge")) {
        if (action.kind === "dig") dug.push({ k, direction: action.direction, reason: action.reason });
      }
      assert.ok(
        stepsOf(played, "edge").filter((a) => a.kind !== "none").length <= 1,
        "at most one edge action fires per turn",
      );
      const movedAndDug = played.actions.some((a) => a.step === "walk" && a.kind === "go")
        && played.actions.some((a) => a.step === "edge" && a.kind !== "none");
      assert.equal(movedAndDug, false, "a turn that walked never also spends the move budget at the edge");
    }

    assert.ok(dug.length > 0, "over twelve turns at the sett's frontier, at least one dig fires");
    const { state } = await rowsAndState(dir);
    for (const { direction } of dug) {
      assert.ok(
        state.exits.get("sett-1")?.has(direction) || [...state.exits.keys()].some((r) => r.endsWith(`-${direction}`)),
        `the ${direction} dig really opened a room`,
      );
    }
  });
});

test("a character above ground never rolls a dig it would only be refused for", async () => {
  await withMudGarden("surface-no-dig", async (dir) => {
    for (let k = 1; k <= 12; k += 1) {
      const played = await turn(dir, "mole-1", k);
      if (played.room !== "garden") break;
      assert.equal(
        stepsOf(played, "edge").some((a) => a.kind === "dig"), false,
        "the garden's only dig is down, and the way down is already open",
      );
    }
  });
});

test("both dig reasons are reachable, and the lateral frontier is the one that draws two rolls", async () => {
  await withMudGarden("dig-reasons", async (dir) => {
    const reasons = new Set();
    for (let k = 1; k <= 24; k += 1) {
      for (const character of ["badger-2", "groundhog-1"]) {
        const played = await turn(dir, character, k);
        for (const action of stepsOf(played, "edge")) {
          if (action.kind === "dig") reasons.add(action.reason);
        }
      }
    }
    assert.ok(reasons.has("edge-follow"), "the lateral edge-follow roll fires");
    assert.ok(reasons.has("explore"), "the plain exploratory roll fires too, on its own seed");
  });
});

test("a turn with nothing else left sets off for a room the character has never stood in", async () => {
  await withMudGarden("explore-unvisited", async (dir) => {
    // The garden's own way down is already open and nothing above ground can be
    // dug, so the mole has no walk and no roll — the exact turn that used to
    // end in a shrug.
    const played = await turn(dir, "mole-1", 1);

    assert.deepEqual(kindsOf(played, "walk"), ["none"], "it still takes no food walk");
    assert.deepEqual(kindsOf(played, "edge"), ["none"], "and no roll comes up at the edge");
    const explore = stepsOf(played, "explore")[0];
    assert.deepEqual(
      { kind: explore.kind, direction: explore.direction, toward: explore.toward, reason: explore.reason },
      { kind: "go", direction: "down", toward: "burrow-1", reason: "unvisited" },
      "so it goes to the one room it has never been in",
    );
    assert.equal((await rowsAndState(dir)).state.placements.get("mole-1").object, "burrow-1");
  });
});

test("the explore step never walks into a room a predator is standing in", async () => {
  await withMudGarden("explore-avoids-predator", async (dir) => {
    // Standing in the burrow, the fox's den is an unvisited room one hop north
    // — the nearest one there is. Nothing else is reachable until the sett.
    await appendFacts(dir, [{
      subject: "mole-1@turn5", predicate: "mgx:currently-in", object: "burrow-1",
      provenance: `${worldProvenanceTag(WORLD)}:turn5`,
    }]);

    for (let k = 6; k <= 10; k += 1) {
      const played = await turn(dir, "mole-1", k);
      for (const action of stepsOf(played, "explore")) {
        assert.notEqual(action.toward, "fox-den", "the den is never the room it sets out for");
      }
      const { state } = await rowsAndState(dir);
      assert.notEqual(state.placements.get("mole-1").object, "eaten", "and it is never eaten on an explore step");
    }
  });
});

test("a character that runs out of mass starves on the turn it happens, and is declined after", async () => {
  await withMudGarden("starve-through-a-turn", async (dir) => {
    const starving = { ...DEFAULT_GAME_CONFIG.mud, moleMassDecrementPerTurn: 5 };
    const play = (k) => runMudTurn("mole-1", { world: WORLD, memoryDir: dir, k, mudConfig: starving });

    const first = await play(1);
    assert.equal(first.mass, 3, "the mole's 8 less the 5 a turn costs it");
    assert.equal(first.outOfPlay, undefined, "still playing at three");

    const last = await play(2);
    assert.equal(last.mass, 0);
    assert.deepEqual(
      { outOfPlay: last.outOfPlay, reason: last.outOfPlayReason }, { outOfPlay: true, reason: "starved" },
      "the turn it runs out is the turn it goes out of play, and it says which way",
    );
    assert.match(last.text, /runs out of mass and starves/);
    assert.ok(last.actions.length, "and that turn still played out — the mass is charged at the end of it");

    const after = await play(3);
    assert.deepEqual(
      { outOfPlay: after.outOfPlay, reason: after.outOfPlayReason, actions: after.actions },
      { outOfPlay: true, reason: "starved", actions: [] },
      "every later turn is declined outright",
    );
    assert.match(after.text, /the mole-1 has starved\. It takes no more turns\./);
  });
});

test("an eaten character reports being eaten, not starved", async () => {
  await withMudGarden("eaten-reason", async (dir) => {
    await appendFacts(dir, [{
      subject: "mole-1@turn5", predicate: "mgx:currently-in", object: "eaten",
      provenance: `${worldProvenanceTag(WORLD)}:turn5`,
    }]);
    const played = await turn(dir, "mole-1", 6);
    assert.deepEqual({ outOfPlay: played.outOfPlay, reason: played.outOfPlayReason }, { outOfPlay: true, reason: "eaten" });
    assert.match(played.text, /has been eaten/);
  });
});

test("a character stops walking after food that has already been eaten", async () => {
  await withMudGarden("stale-food-knowledge", async (dir) => {
    await plantCarrotInBurrow(dir);
    await recordTold(dir, { asker: "mole-1", teller: "vole-1", thing: "carrot-2", k: 1 });
    await appendFacts(dir, [{
      subject: "carrot-2@turn2", predicate: "mgx:located-in", object: "eaten",
      provenance: `${worldProvenanceTag(WORLD)}:turn2`,
    }]);

    const played = await turn(dir, "mole-1", 3);

    assert.equal(kindsOf(played, "walk")[0], "none");
    assert.match(
      stepsOf(played, "walk")[0].reason, /already been eaten/,
      "the reason names the eaten meal rather than blaming the map",
    );
    assert.equal(
      played.actions.some((a) => a.step === "edge" && a.reason === "exit-toward-food"), false,
      "and no exit is gambled on to reach something that no longer exists",
    );
  });
});

test("a character with no placement is declined rather than dropped into somebody else's room", async () => {
  await withMudGarden("stranger", async (dir) => {
    const played = await turn(dir, "badger-1", 1);
    assert.deepEqual(played.actions, []);
    assert.equal(played.room, null);
    assert.match(played.text, /no written position/);
  });
});
