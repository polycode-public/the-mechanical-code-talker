// mud-editor: the burrow's text<->fact bridge. The property that matters most
// is invertibility — every sentence the renderer writes parses back to the
// triple it came from, so re-syncing an untouched document writes nothing and
// retracts nothing. These tests pin that against the SHIPPED world (not a
// fixture, so a new predicate in the corpus that the table cannot say shows up
// here as an unrecognized line), then the three families that sync differently,
// then the honest miss.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getWorldsPackProvider, clearWorldsPackCache } from "../../src/adapters/corpus/worlds-pack.mjs";
import { foldWorldState, worldActionRows } from "../../src/services/adventure.mjs";
import {
  createInMemoryStore, appendFacts, loadMemory, readFactRows,
} from "../../src/adapters/memory/core.mjs";
import {
  renderMudEditorText, parseMudEditorLine, parseMudEditorText, planMudEditorSync,
  planTaughtMudTriple, editableMudOtherRows, wordBeforeCursor,
} from "../../src/services/mud-editor.mjs";

async function shippedMudGarden() {
  clearWorldsPackCache();
  const world = await getWorldsPackProvider({}).load("mud-garden");
  const rows = world.facts.map((f, i) => ({ ...f, id: `row-${i}`, provenance: "world:mud-garden" }));
  return { rows, state: foldWorldState(worldActionRows(rows)) };
}

test("every sentence the shipped world renders parses back, and re-syncing it writes nothing", async () => {
  const { rows, state } = await shippedMudGarden();
  const text = renderMudEditorText(rows, state);
  assert.ok(text.split("\n").length > 40, "the whole world is on the page, not a handful of lines");

  const { triples, unrecognized } = parseMudEditorText(text);
  assert.deepEqual(unrecognized, [], "the renderer never writes a line its own parser cannot read");

  const { toAppend, toRemoveIds } = planMudEditorSync(rows, state, triples);
  assert.deepEqual(toAppend, [], "an untouched document appends nothing");
  assert.deepEqual(toRemoveIds, [], "and retracts nothing");
});

test("the dig knobs the world tunes itself with are all readable and writable as sentences", async () => {
  const { rows, state } = await shippedMudGarden();
  const lines = renderMudEditorText(rows, state).split("\n");
  for (const expected of [
    "The burrow digs 6 rooms out from the garden.",
    "One dig in 5 in underground-space opens a den.",
    "One den in 3 in underground-space is lived in.",
    "Digging in underground-space turns up at most 2 things.",
    "Digging in underground-space turns up carrot.",
    "A den in underground-space is lived in by mouse.",
    "Mole-1 loses 0.06 mass a turn.",
  ]) {
    assert.ok(lines.includes(expected), `the editor shows "${expected}"`);
  }
});

test("a count phrase never reads as a spawned kind — the more specific line wins", () => {
  assert.deepEqual(
    parseMudEditorLine("Digging in underground-space turns up at most 2 things."),
    { subject: "underground-space", predicate: "mgx:dig-spawn-max", object: "2", kind: "other" },
  );
  assert.deepEqual(
    parseMudEditorLine("Digging in underground-space turns up worm."),
    { subject: "underground-space", predicate: "mgx:dig-spawns", object: "worm", kind: "other" },
  );
});

test("a specific phrase never falls through to the bare is-a reading", () => {
  assert.equal(parseMudEditorLine("Basket is a container.").predicate, "mgx:is-container");
  assert.equal(parseMudEditorLine("Carrot is a kind of food.").predicate, "rdfs:subClassOf");
  assert.equal(parseMudEditorLine("Garden is where the burrow starts.").predicate, "mgx:is-origin");
  assert.equal(parseMudEditorLine("Fox-1 hunts the other animals.").predicate, "mgx:is-predator");
  assert.equal(parseMudEditorLine("Burrow-1 is a room.").predicate, "rdf:type");
});

test("a line in no phrase the table knows is an honest miss, never a guessed triple", () => {
  assert.equal(parseMudEditorLine("the larder smells faintly of onions"), null);
  const { triples, unrecognized } = parseMudEditorText("Garden is a room.\nwho left the gate open\n");
  assert.equal(triples.length, 1);
  assert.deepEqual(unrecognized, [{ line: 2, text: "who left the gate open" }]);
});

test("placement, openness and mass are appended rather than retracted, and only when they change", () => {
  const rows = [
    { id: "a", subject: "mole-1", predicate: "mgx:currently-in", object: "garden" },
    { id: "b", subject: "basket", predicate: "mgx:is-open", object: "true" },
    { id: "c", subject: "mole-1", predicate: "mgx:hasMass", object: "8" },
  ];
  const state = foldWorldState(rows);

  const unchanged = planMudEditorSync(rows, state, parseMudEditorText(
    "Mole-1 stands in the garden.\nBasket is open.\nMole-1 weighs 8.\n",
  ).triples);
  assert.deepEqual(unchanged.toAppend, [], "re-asserting the same three lines is a no-op, not three duplicates");
  assert.deepEqual(unchanged.toRemoveIds, [], "and none of the three is ever a retraction");

  const moved = planMudEditorSync(rows, state, parseMudEditorText(
    "Mole-1 stands in the sett-1.\nBasket is closed.\nMole-1 weighs 3.\n",
  ).triples);
  assert.equal(moved.toAppend.length, 3, "each of the three changed, so each is written");
  assert.deepEqual(moved.toRemoveIds, [], "still nothing retracted — the fold reads the newest write");
  assert.equal(moved.editTurn, state.turnCount + 1);
  assert.deepEqual(
    moved.toAppend.map((t) => t.subject).sort(),
    ["basket@turn1", "mole-1@turn1", "mole-1@turn1"].sort(),
    "each fold-versioned row carries its own turn stamp, not a bare subject",
  );
});

test("one subject's placement, openness and mass are tracked apart, not collapsed into one", () => {
  const rows = [{ id: "a", subject: "basket", predicate: "mgx:fixed-in", object: "garden" }];
  const state = foldWorldState(rows);
  const { toAppend } = planMudEditorSync(rows, state, parseMudEditorText(
    "Basket is fixed in the sett-1.\nBasket is closed.\nBasket weighs 5.\n",
  ).triples);
  assert.equal(toAppend.length, 3, "all three land — no family silences another for the same subject");
  assert.ok(toAppend.every((t) => t.subject === "basket@turn1"), "all three stamp the same base subject at the same edit turn");
});

test("the superseding placement is stamped one turn past the world's own count, so it outranks by rank and not by arriving last", () => {
  const rows = [
    { id: "a", subject: "mole-1", predicate: "mgx:currently-in", object: "garden" },
    { id: "b", subject: "mole-1@turn4", predicate: "mgx:currently-in", object: "sett-1" },
  ];
  const state = foldWorldState(rows);
  assert.equal(state.turnCount, 4);
  const { toAppend, editTurn } = planMudEditorSync(rows, state, parseMudEditorText("Mole-1 stands in the garden.\n").triples);
  assert.equal(editTurn, 5);
  assert.deepEqual(toAppend.map((t) => t.subject), ["mole-1@turn5"]);
});

test("a world on a later epoch stamps its edit into that epoch, so the recast still outranks the run it replaced", () => {
  const rows = [
    { id: "a", subject: "mole-1", predicate: "mgx:currently-in", object: "garden" },
    { id: "b", subject: "world", predicate: "mgx:world-epoch", object: "2" },
  ];
  const state = foldWorldState(rows);
  assert.equal(state.epoch, 2);
  const { toAppend } = planMudEditorSync(rows, state, parseMudEditorText("Mole-1 stands in the sett-1.\n").triples);
  assert.deepEqual(toAppend.map((t) => t.subject), ["mole-1@epoch2@turn1"]);
});

test("the world an edited store folds to is the same one whichever order its rows arrive in — forward, reversed, and in content-address order", async () => {
  const dir = createInMemoryStore();
  clearWorldsPackCache();
  const world = await getWorldsPackProvider({}).load("mud-garden");
  await appendFacts(dir, world.facts.map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object, provenance: "world:mud-garden" })));
  const rows = readFactRows(await loadMemory(dir));
  const state = foldWorldState(rows);
  const text = renderMudEditorText(rows, state);
  const edited = text
    .replace("Mole-1 stands in the garden.", "Mole-1 stands in the sett-1.")
    .replace("Mole-1 weighs 8.", "Mole-1 weighs 5.")
    .replace("Basket is open.", "Basket is closed.");
  const { toAppend, editTurn } = planMudEditorSync(rows, state, parseMudEditorText(edited).triples);
  await appendFacts(dir, toAppend.map((f) => ({
    subject: f.subject, predicate: f.predicate, object: f.object,
    provenance: f.kind === "other" ? "world:mud-garden" : `world:mud-garden:turn${editTurn}`,
  })));

  const freshRows = readFactRows(await loadMemory(dir));
  const byContentAddress = [...freshRows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const orderings = [
    ["forward", freshRows],
    ["reversed", [...freshRows].reverse()],
    ["content-address order", byContentAddress],
  ];
  const readable = (world) => JSON.stringify({
    placements: [...world.placements].map(([s, p]) => [s, p.predicate, p.object]).sort(),
    positions: [...world.positions].map(([s, p]) => [s, p.predicate, p.object]).sort(),
    openness: [...world.openness].map(([s, o]) => [s, o.open]).sort(),
    masses: [...world.masses].map(([s, m]) => [s, m.value]).sort(),
    turnCount: world.turnCount,
    epoch: world.epoch,
  });
  const [, forwardRows] = orderings[0];
  const expected = readable(foldWorldState(forwardRows));
  for (const [name, order] of orderings) {
    const folded = foldWorldState(order);
    assert.equal(folded.placements.get("mole-1").object, "sett-1", `the placement edit still rules in ${name}`);
    assert.equal(folded.masses.get("mole-1").value, 5, `and so does the mass edit in ${name}`);
    assert.equal(folded.openness.get("basket").open, false, `and so does the openness edit in ${name}`);
    assert.equal(readable(folded), expected, `the whole folded world is identical in ${name}`);
  }
});

test("changing a raw fact retracts the row it replaced, since the engine reads those unfolded", () => {
  const rows = [
    { id: "type", subject: "carrot", predicate: "rdfs:subClassOf", object: "food" },
    { id: "reach", subject: "garden", predicate: "mgx:dig-reach", object: "6" },
  ];
  const state = foldWorldState(rows);
  const { toAppend, toRemoveIds } = planMudEditorSync(rows, state, parseMudEditorText(
    "Carrot is a kind of food.\nThe burrow digs 2 rooms out from the garden.\n",
  ).triples);
  assert.deepEqual(toAppend.map((t) => t.object), ["2"], "only the changed knob is written");
  assert.deepEqual(toRemoveIds, ["reach"], "and the old reach is genuinely retracted, not left alongside");
});

test("a flag row reading false is neither shown nor diffable, so an edit elsewhere cannot delete it", () => {
  const rows = [
    { id: "off", subject: "basket", predicate: "mgx:is-container", object: "false" },
    { id: "on", subject: "crate", predicate: "mgx:is-container", object: "true" },
  ];
  assert.deepEqual(editableMudOtherRows(rows).map((r) => r.id), ["on"]);
  const { toRemoveIds } = planMudEditorSync(rows, foldWorldState(rows), parseMudEditorText("Crate is a container.\n").triples);
  assert.deepEqual(toRemoveIds, [], "the unrenderable false row survives a clean parse of the rest");
});

test("a turn snapshot is never rendered as a fact of its own", () => {
  const rows = [
    { id: "a", subject: "mole-1", predicate: "mgx:currently-in", object: "garden" },
    { id: "b", subject: "mole-1@turn4", predicate: "mgx:currently-in", object: "sett-1" },
    { id: "c", subject: "garden@turn4", predicate: "rdf:type", object: "room" },
  ];
  const text = renderMudEditorText(rows, foldWorldState(rows));
  assert.ok(text.includes("Mole-1 stands in the sett-1."), "the fold's own answer is the one shown");
  assert.equal(text.includes("@turn"), false, "and no snapshot subject reaches the page");
});

test("the mesh a thing draws with and how far it is turned both round-trip through the sentence table", () => {
  const rows = [
    { id: "m", subject: "cart", predicate: "mgx:model", object: "barrow" },
    { id: "r", subject: "cart", predicate: "mgx:rotation", object: "90" },
    { id: "n", subject: "cart", predicate: "mgx:display-name", object: "handcart" },
  ];
  const text = renderMudEditorText(rows, foldWorldState(rows));
  const lines = text.split("\n");
  assert.ok(lines.includes("Cart is modelled as barrow."));
  assert.ok(lines.includes("Cart is turned 90 degrees."));
  assert.ok(lines.includes("Cart is shown as handcart."), "the reading name keeps its own sentence, apart from the mesh");

  const { triples, unrecognized } = parseMudEditorText(text);
  assert.deepEqual(unrecognized, []);
  assert.deepEqual(
    triples.map((t) => [t.subject, t.predicate, t.object]).sort(),
    [["cart", "mgx:display-name", "handcart"], ["cart", "mgx:model", "barrow"], ["cart", "mgx:rotation", "90"]],
    "every rendered sentence parses back to the triple it came from",
  );
  const { toAppend, toRemoveIds } = planMudEditorSync(rows, foldWorldState(rows), triples);
  assert.deepEqual([toAppend, toRemoveIds], [[], []], "re-syncing an untouched document writes and retracts nothing");
});

test("a negative rotation still reads as a number, not as a fresh class", () => {
  assert.deepEqual(
    parseMudEditorLine("Gate is turned -45 degrees."),
    { subject: "gate", predicate: "mgx:rotation", object: "-45", kind: "other" },
  );
  assert.deepEqual(
    parseMudEditorLine("Gate is turned 1 degree."),
    { subject: "gate", predicate: "mgx:rotation", object: "1", kind: "other" },
  );
});

test("planTaughtMudTriple: one sentence appends what it changes and never plans a retraction", () => {
  const rows = [
    { id: "a", subject: "mole-1", predicate: "mgx:currently-in", object: "garden" },
    { id: "b", subject: "mole-1", predicate: "mgx:hasMass", object: "8" },
    { id: "c", subject: "basket", predicate: "mgx:is-container", object: "true" },
  ];
  const state = foldWorldState(rows);
  const moved = { subject: "mole-1", predicate: "mgx:currently-in", object: "sett-1", kind: "placement" };
  const plan = planTaughtMudTriple(rows, state, moved);
  assert.deepEqual(plan.toAppend, [moved]);
  assert.equal("toRemoveIds" in plan, false);

  assert.deepEqual(
    planTaughtMudTriple(rows, state, { subject: "mole-1", predicate: "mgx:hasMass", object: "8", kind: "mass" }).toAppend,
    [],
    "a mass already folded to the same number is not written again",
  );
  assert.equal(
    planTaughtMudTriple(rows, state, { subject: "mole-1", predicate: "mgx:hasMass", object: "5", kind: "mass" }).toAppend.length,
    1,
  );
  assert.deepEqual(
    planTaughtMudTriple(rows, state, { subject: "basket", predicate: "mgx:is-container", object: "true", kind: "other" }).toAppend,
    [],
    "a raw fact the world already carries is not written twice",
  );
});

test("the word before the cursor is the term a suggestion is asked for", () => {
  assert.equal(wordBeforeCursor("Digging in underground-space", 28), "underground-space");
  assert.equal(wordBeforeCursor("Mole-1 stands in the ", 21), "");
});
