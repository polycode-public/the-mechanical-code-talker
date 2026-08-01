// world-teach: a declarative sentence read as a fact against the live world.
// The properties that matter are the gates (a question never reaches a write,
// a subject that names nothing is declined rather than stored, a place the
// world doesn't have is declined by name with the real ones listed), the
// stamping (every fold-versioned write is a turn snapshot, or it ranks as
// turn 0 and loses to anything already played), and the provenance — which is
// what keeps a world teach and a chat teach apart while still letting the
// world teach fold.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getWorldsPackProvider, clearWorldsPackCache } from "../../src/adapters/corpus/worlds-pack.mjs";
import { worldProvenanceTag } from "../../src/domain/worlds-pack.mjs";
import { appendFacts, appendRule, loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";
import { foldWorldState, worldActionRows } from "../../src/services/adventure.mjs";
import { parseEditorLine, planTaughtTriple } from "../../src/services/adventure-editor.mjs";
import { parseMudEditorLine, planTaughtMudTriple } from "../../src/services/mud-editor.mjs";
import { worldTeachTurn } from "../../src/services/world-teach.mjs";
import { mudSyncableFacts } from "../../src/domain/p2p/sync-filter.mjs";
import { isMudStatePredicate } from "../../src/services/adventure.mjs";

const WORLD = "ashcombe-hall";

async function loadInto(dir, name) {
  clearWorldsPackCache();
  const world = await getWorldsPackProvider({}).load(name);
  assert.ok(world, `the ${name} world ships in the pack`);
  const tag = worldProvenanceTag(world.name);
  await appendFacts(dir, world.facts.map((f) => ({
    subject: f.subject, predicate: f.predicate, object: f.object, provenance: tag,
  })));
  for (const rule of world.rules) {
    await appendRule(dir, { name: rule.name, kind: rule.ruleKind, slots: rule.slots, provenance: tag });
  }
}

async function withWorld(label, body, name = WORLD) {
  const dir = await mkdtemp(join(tmpdir(), `tmct-world-teach-${label}-`));
  try {
    await loadInto(dir, name);
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function rowsAndState(dir) {
  const rows = readFactRows(await loadMemory(dir));
  return { rows, state: foldWorldState(worldActionRows(rows)) };
}

const teach = async (dir, line, { world = WORLD, actingSubject = "player" } = {}) => {
  const { rows, state } = await rowsAndState(dir);
  return worldTeachTurn(line, {
    parseLine: parseEditorLine, planTriple: planTaughtTriple,
    rows, state, memoryDir: dir, world, actingSubject,
  });
};

const taughtRows = (rows) => rows.filter((r) => String(r.provenance || "").includes(":taught:turn"));

// ---- the gates ----------------------------------------------------------------

test("a question mark stands the whole teach down, so the ask cascade keeps its own line", async () => {
  await withWorld("question-mark", async (dir) => {
    assert.equal(await teach(dir, "Candle is in the study?"), null);
    assert.deepEqual(taughtRows((await rowsAndState(dir)).rows), [], "and nothing reached the store");
  });
});

test("an interrogative lead stands the teach down even with no question mark", async () => {
  await withWorld("interrogative", async (dir) => {
    for (const line of ["is the lamp in the study", "where is the lamp", "wat is a hrose"]) {
      assert.equal(await teach(dir, line), null, `"${line}" is a question, not an assertion`);
    }
    assert.deepEqual(taughtRows((await rowsAndState(dir)).rows), []);
  });
});

test("a subject that refers to nothing is declined by name rather than stored against a pronoun", async () => {
  await withWorld("expletive", async (dir) => {
    const answer = await teach(dir, "There is a book in the study");
    assert.equal(answer.miss, true);
    assert.match(answer.text, /"there" doesn't name anything/);
    assert.match(answer.text, /candle is in the study/, "the decline shows the plain form that would work");
    assert.deepEqual(taughtRows((await rowsAndState(dir)).rows), [], "the generic type fallback never reified 'there'");

    const pronoun = await teach(dir, "It is in the study");
    assert.equal(pronoun.miss, true);
    assert.match(pronoun.text, /"it" doesn't name anything/);
  });
});

test("a placement into a room the world doesn't have names the real rooms instead of shrugging", async () => {
  await withWorld("unknown-room", async (dir) => {
    const answer = await teach(dir, "Statue is in the ballroom");
    assert.equal(answer.miss, true);
    assert.match(answer.text, /I don't know a place called "ballroom"/);
    for (const room of ["cellar", "drawing-room", "kitchen", "library", "study"]) {
      assert.ok(answer.text.includes(room), `the decline lists the real ${room}`);
    }
    assert.deepEqual(taughtRows((await rowsAndState(dir)).rows), []);
  });
});

test("a line no sentence in the table can say falls through, world untouched", async () => {
  await withWorld("fallthrough", async (dir) => {
    assert.equal(await teach(dir, "the housekeeper seems tired today"), null);
    assert.deepEqual(taughtRows((await rowsAndState(dir)).rows), []);
  });
});

// ---- minting ------------------------------------------------------------------

test("a noun the world has never heard of is minted placed, portable and named, and the take verb accepts it", async () => {
  await withWorld("mint", async (dir) => {
    const answer = await teach(dir, "Candle is in the study.");
    assert.equal(answer.miss, false);
    assert.match(answer.text, /^noted — there's a candle in the study now\./);
    assert.match(answer.text, /You can: .*take candle/, "the affordance rail offers the new thing on the same redraw");

    const { rows, state } = await rowsAndState(dir);
    const minted = taughtRows(rows).map((r) => [r.subject, r.predicate, r.object]).sort();
    assert.deepEqual(minted, [
      ["candle", "mgx:display-name", "candle"],
      ["candle", "rdf:type", "candle"],
      ["candle", "rdf:type", "portable"],
      ["candle@turn1", "mgx:located-in", "study"],
    ], "its own class drives the sprite, portable is what take reads, and only the placement is stamped");
    assert.deepEqual(
      { ...state.placements.get("candle") },
      { predicate: "mgx:located-in", object: "study", turn: 1, epoch: 0 },
      "and the fold reads it as placed this turn",
    );
  });
});

test("a minted id never renames something the world already answers to", async () => {
  await withWorld("mint-collision", async (dir) => {
    // "book" is already a class AND (via the library's default contents) a
    // placed individual, so a teach about it moves that individual.
    const first = await teach(dir, "Book is in the study");
    assert.equal(first.miss, false);
    const { rows } = await rowsAndState(dir);
    assert.deepEqual(
      taughtRows(rows).map((r) => [r.subject, r.predicate, r.object]),
      [["book@turn1", "mgx:located-in", "study"]],
      "an existing individual is moved, never minted a second time",
    );

    // "portable" names a class but no individual, so it IS minted — under a
    // numbered id, because the bare one is already spoken for.
    const second = await teach(dir, "Portable is in the cellar");
    assert.equal(second.miss, false);
    const after = taughtRows((await rowsAndState(dir)).rows).map((r) => r.subject);
    assert.ok(after.includes("portable-1"), `expected a numbered mint, got ${after.join(", ")}`);
    assert.equal(after.includes("portable"), false, "the class keeps its own name");
  });
});

// ---- stamping and provenance ---------------------------------------------------

test("a taught placement is stamped at turnCount + 1, so it outranks whatever was already played", async () => {
  await withWorld("stamping", async (dir) => {
    // Two played turns first, so an unstamped write would rank below them.
    await appendFacts(dir, [
      { subject: "lamp@turn1", predicate: "mgx:located-in", object: "player", provenance: `${worldProvenanceTag(WORLD)}:turn1` },
      { subject: "player@turn2", predicate: "mgx:currently-in", object: "library", provenance: `${worldProvenanceTag(WORLD)}:turn2` },
    ]);
    const before = (await rowsAndState(dir)).state;
    assert.equal(before.turnCount, 2);

    const answer = await teach(dir, "Lamp is in the cellar");
    assert.equal(answer.miss, false);
    const { rows, state } = await rowsAndState(dir);
    assert.deepEqual(
      taughtRows(rows).map((r) => r.subject),
      ["lamp@turn3"],
      "the write carries the next turn's stamp, not a bare subject",
    );
    assert.equal(state.placements.get("lamp").object, "cellar", "so the fold reads the taught placement as current");
    assert.equal(state.turnCount, 3, "a teach spends a turn number");
  });
});

test("a world teach carries its own provenance, folds into the playable state, and reads as the world's own Source", async () => {
  await withWorld("provenance", async (dir) => {
    await teach(dir, "Candle is in the study.");
    const { rows } = await rowsAndState(dir);
    const written = taughtRows(rows);
    assert.ok(written.length > 0);
    for (const row of written) {
      assert.equal(row.provenance, `world:${WORLD}:taught:turn1`, "the tag names the world, the act and the turn");
      assert.ok(row.sourceIds.includes(`src:corpus:${WORLD}`), "and scores on the world's existing Source, no model change");
    }
    assert.equal(
      worldActionRows(rows).some((r) => r.subject === "candle@turn1"),
      true,
      "the world: prefix is what lets the fold see it, where a teach:chat: row is filtered out",
    );
  });
});

test("a taught row replicates through the p2p sync filter, the same as a played turn's", async () => {
  await withWorld("sync", async (dir) => {
    await teach(dir, "Candle is in the study.");
    const { rows } = await rowsAndState(dir);
    const written = taughtRows(rows);
    const syncable = mudSyncableFacts(written, isMudStatePredicate);
    assert.deepEqual(
      syncable.map((r) => [r.subject, r.predicate]).sort(),
      [["candle", "mgx:display-name"], ["candle", "rdf:type"], ["candle", "rdf:type"], ["candle@turn1", "mgx:located-in"]],
      "a shared sandbox shows everyone what somebody wrote into the world — deliberate, not incidental",
    );
  });
});

// ---- general semantics ---------------------------------------------------------

test("a world-authored object moves where the sentence says, because the newer write simply wins", async () => {
  await withWorld("move", async (dir) => {
    const before = (await rowsAndState(dir)).state.placements.get("book");
    assert.equal(before.object, "library", "the world places its own book in the library");

    const answer = await teach(dir, "Book is in the study");
    assert.equal(answer.miss, false);
    assert.match(answer.text, /^noted — the book is in the study now\./);
    const { state } = await rowsAndState(dir);
    assert.equal(state.placements.get("book").object, "study");
  });
});

test("re-asserting a fact the world already holds is true, writes nothing, and says so", async () => {
  await withWorld("no-op", async (dir) => {
    const answer = await teach(dir, "Lamp is in the study");
    assert.equal(answer.miss, false);
    assert.match(answer.text, /^the world already said that/);
    assert.deepEqual(answer.taught, []);
    assert.deepEqual(taughtRows((await rowsAndState(dir)).rows), []);
  });
});

test("a locked cabinet opens on a sentence, with no invariant layer to refuse it", async () => {
  await withWorld("openness", async (dir) => {
    const answer = await teach(dir, "Cabinet is open.");
    assert.equal(answer.miss, false);
    const { state } = await rowsAndState(dir);
    assert.equal(state.openness.get("cabinet").open, true);
  });
});

// ---- the burrow's own table ----------------------------------------------------

test("the burrow's sentence table is injected, so the manor's generic placement phrase is not one of its sentences", async () => {
  await withWorld("mud", async (dir) => {
    const mudTeach = async (line) => {
      const { rows, state } = await rowsAndState(dir);
      return worldTeachTurn(line, {
        parseLine: parseMudEditorLine, planTriple: planTaughtMudTriple,
        rows, state, memoryDir: dir, world: "mud-garden", actingSubject: "mole-1",
      });
    };
    assert.equal(await mudTeach("Pebble is in the garden."), null, "the burrow has no generic 'X is in the Y.'");
    const answer = await mudTeach("Pebble lies in the garden.");
    assert.equal(answer.miss, false);
    assert.match(answer.text, /^noted — there's a pebble in the garden now\./);
  }, "mud-garden");
});
