// One character telling another about something, or examining something
// itself, leaves a DURABLE fact behind rather than a one-tick decision: an
// mgx:knows-about edge the hearer carries from that turn on, tagged to whoever
// vouched for it. personKnowledgeLines reads it back with no new code, because
// it is the same predicate the shipped worlds already use for staff knowledge.
// "what food do you know about" reads the same edges, filtered to whatever
// class chain reaches "food", scoped to the asking character alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getWorldsPackProvider, clearWorldsPackCache } from "../../src/adapters/corpus/worlds-pack.mjs";
import {
  recordTold, recordExamined, personKnowledgeLines, foldWorldState, worldActionRows,
  adventureTurn,
} from "../../src/services/adventure.mjs";
import { worldProvenanceTag } from "../../src/domain/worlds-pack.mjs";
import { provenanceTagToSource } from "../../src/domain/memory/trust.mjs";
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
  const dir = await mkdtemp(join(tmpdir(), `tmct-mud-know-${name}-`));
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

const knowsAboutRows = (rows) => rows.filter((r) => r.predicate === "mgx:knows-about");

const planHolderFor = () => ({ state: { adventure: { world: WORLD } } });
const askFood = (dir, line, actingSubject) =>
  adventureTurn(line, { planHolder: planHolderFor(), memoryDir: dir, actingSubject });

test("being told about a thing writes the hearer a knows-about fact tagged to the teller", async () => {
  await withMudGarden("told", async (dir) => {
    await recordTold(dir, { asker: "vole-1", teller: "mole-1", thing: "burrow-1", k: 4 });

    const { rows, state } = await rowsAndState(dir);
    const written = knowsAboutRows(rows);
    assert.equal(written.length, 1, "exactly one fact is written per telling");
    assert.deepEqual(
      { subject: written[0].subject, object: written[0].object, provenance: written[0].provenance },
      { subject: "vole-1", object: "burrow-1", provenance: "mud:mole-1:turn4" },
      "the hearer is the subject; the teller is named in the provenance",
    );

    const { aboutTopics } = personKnowledgeLines(rows, state, "vole-1");
    assert.ok(aboutTopics.includes("burrow-1"), "the told thing reads back as one of the hearer's topics");
  });
});

test("a character never told about a thing does not know it", async () => {
  await withMudGarden("bystander", async (dir) => {
    await recordTold(dir, { asker: "vole-1", teller: "mole-1", thing: "burrow-1", k: 2 });

    const { rows, state } = await rowsAndState(dir);
    assert.ok(personKnowledgeLines(rows, state, "vole-1").aboutTopics.includes("burrow-1"));
    assert.ok(
      !personKnowledgeLines(rows, state, "mole-1").aboutTopics.includes("burrow-1"),
      "standing in the same garden is not the same as being told",
    );
  });
});

test("examining a thing makes the observer its own source for it", async () => {
  await withMudGarden("examined", async (dir) => {
    await recordExamined(dir, { observer: "mole-1", thing: "basket", k: 7 });

    const { rows, state } = await rowsAndState(dir);
    const written = knowsAboutRows(rows);
    assert.equal(written.length, 1);
    assert.deepEqual(
      { subject: written[0].subject, object: written[0].object, provenance: written[0].provenance },
      { subject: "mole-1", object: "basket", provenance: "mud:mole-1:turn7" },
      "the observer stands in both the subject and the provenance",
    );

    assert.ok(personKnowledgeLines(rows, state, "mole-1").aboutTopics.includes("basket"));
    assert.ok(!personKnowledgeLines(rows, state, "vole-1").aboutTopics.includes("basket"));
  });
});

test("one character accumulates knowledge from several sources across turns", async () => {
  await withMudGarden("accumulate", async (dir) => {
    await recordTold(dir, { asker: "vole-1", teller: "mole-1", thing: "burrow-1", k: 1 });
    await recordTold(dir, { asker: "vole-1", teller: "badger-1", thing: "carrot", k: 6 });
    await recordExamined(dir, { observer: "vole-1", thing: "stone", k: 9 });

    const { rows, state } = await rowsAndState(dir);
    const { aboutTopics } = personKnowledgeLines(rows, state, "vole-1");
    assert.deepEqual(
      [...aboutTopics].sort(),
      ["burrow-1", "carrot", "stone"],
      "an earlier telling is not overwritten by a later one",
    );

    assert.deepEqual(
      knowsAboutRows(rows).map((r) => r.provenance).sort(),
      ["mud:badger-1:turn6", "mud:mole-1:turn1", "mud:vole-1:turn9"],
      "each claim keeps the character who vouched for it",
    );
  });
});

test("a character's testimony resolves to that character's own Source, apart from the world's", async () => {
  const told = provenanceTagToSource("mud:mole-1:turn4");
  assert.deepEqual(told, { kind: "corpus", name: "mud:mole-1" });
  assert.notDeepEqual(
    told, provenanceTagToSource(`${worldProvenanceTag(WORLD)}:turn4`),
    "what an animal says is not credited to the world it stands in",
  );
});

test("asking what food you know about reports only the food-classed things you were told or examined", async () => {
  await withMudGarden("food-query", async (dir) => {
    await appendFacts(dir, [{
      subject: "apple-1", predicate: "rdf:type", object: "food", provenance: worldProvenanceTag(WORLD),
    }]);
    await recordTold(dir, { asker: "vole-1", teller: "mole-1", thing: "carrot", k: 1 });
    await recordExamined(dir, { observer: "vole-1", thing: "apple-1", k: 2 });
    await recordTold(dir, { asker: "vole-1", teller: "badger-1", thing: "stone", k: 3 });

    const result = await askFood(dir, "what food do you know about", "vole-1");
    assert.equal(result.text, "you know about: the carrot, the apple-1.");
    assert.equal(result.miss, false, "a populated answer is a real answer, never a miss");
  });
});

test("a character with no known food gets the honest empty answer, not a guess", async () => {
  await withMudGarden("food-none", async (dir) => {
    const result = await askFood(dir, "what food do you know about", "vole-1");
    assert.equal(result.text, "you don't know of any food yet.");
    assert.equal(result.miss, false, "an honest 'nothing known' is still an on-topic answer");
  });
});

test("the inverted phrasing answers the same food query", async () => {
  await withMudGarden("food-phrasing", async (dir) => {
    await recordExamined(dir, { observer: "mole-1", thing: "carrot", k: 1 });
    const result = await askFood(dir, "what do you know about food", "mole-1");
    assert.equal(result.text, "you know about: the carrot.");
  });
});

test("a character's food query never leaks another character's own separately-told food knowledge", async () => {
  await withMudGarden("food-isolation", async (dir) => {
    await appendFacts(dir, [{
      subject: "bread-1", predicate: "rdf:type", object: "food", provenance: worldProvenanceTag(WORLD),
    }]);
    await recordExamined(dir, { observer: "mole-1", thing: "bread-1", k: 1 });
    await recordTold(dir, { asker: "vole-1", teller: "mole-1", thing: "carrot", k: 2 });

    const voleResult = await askFood(dir, "what food do you know about", "vole-1");
    assert.equal(voleResult.text, "you know about: the carrot.", "the vole reports its own food knowledge only");
    assert.doesNotMatch(voleResult.text, /bread-1/, "the mole's own examined food never leaks into the vole's answer");

    const moleResult = await askFood(dir, "what food do you know about", "mole-1");
    assert.equal(moleResult.text, "you know about: the bread-1.");
  });
});

test("testimony never folds into the playable world state", async () => {
  await withMudGarden("no-fold", async (dir) => {
    const before = await rowsAndState(dir);
    await recordTold(dir, { asker: "vole-1", teller: "mole-1", thing: "stone", k: 3 });

    const { rows, state } = await rowsAndState(dir);
    assert.equal(
      state.placements.get("stone").object, before.state.placements.get("stone").object,
      "hearing about the stone leaves the stone exactly where it stood",
    );
    assert.equal(state.turnCount, before.state.turnCount, "a telling does not advance the world's turn counter");
    assert.equal(
      worldActionRows(rows).filter((r) => r.predicate === "mgx:knows-about" && r.object === "stone").length, 0,
      "the testimony row is filtered out of the state fold's input",
    );
    assert.ok(personKnowledgeLines(rows, state, "vole-1").aboutTopics.includes("stone"), "yet it still reads back");
  });
});
