// agent-editor: the actor card's own text<->fact bridge, mudiii's third
// sentence table (mud-editor.mjs owns placement/openness/class/exit/dig,
// mudiii-turn.mjs's TOWN_SQUARE_TEACH_PATTERNS owns the drive-knob teach
// sentences, this owns AGENT_TRAIT_PREDICATES). The property that matters
// most, same as mud-editor.mjs's own suite: every sentence the renderer
// writes parses back to the triple it came from, and the sync it plans
// never reaches past the one subject it was asked to edit.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderAgentEditorText, renderAgentClassText, parseAgentEditorLine, parseAgentEditorText,
  planAgentEditorSync, agentTraitSentence,
} from "../../src/services/agent-editor.mjs";
import { instanceFactsFrom } from "../../src/domain/agent-traits.mjs";
import { appendFacts, createInMemoryStore, loadMemory, readFactRows, removeFacts } from "../../src/adapters/memory/core.mjs";

const GOBLIN_CLASS_ROWS = [
  { subject: "goblin", predicate: "rdfs:subClassOf", object: "creature" },
  { subject: "goblin", predicate: "mgx:display-name", object: "goblin" },
  { subject: "goblin", predicate: "mgx:model", object: "goblin" },
  { subject: "goblin", predicate: "mgx:hasMass", object: "8" },
  { subject: "goblin", predicate: "mgx:mass-drain-per-turn", object: "0.06" },
  { subject: "goblin", predicate: "mgx:vision-radius", object: "3" },
  { subject: "goblin", predicate: "mgx:evades", object: "fox" },
  { subject: "goblin", predicate: "mgx:consumes", object: "crumb" },
  { subject: "goblin", predicate: "mgx:consumes", object: "morsel" },
];

async function storeWithSpawnedGoblins() {
  const store = createInMemoryStore();
  await appendFacts(store, GOBLIN_CLASS_ROWS.map((f) => ({ ...f, provenance: "world:test" })));
  const classRows = readFactRows(await loadMemory(store));
  const spawnGoblin1 = instanceFactsFrom(classRows, "goblin", "goblin-1");
  const spawnGoblin2 = instanceFactsFrom(classRows, "goblin", "goblin-2");
  await appendFacts(store, spawnGoblin1.map((f) => ({ ...f, provenance: "spawn:goblin:goblin-1@epoch0" })));
  await appendFacts(store, spawnGoblin2.map((f) => ({ ...f, provenance: "spawn:goblin:goblin-2@epoch0" })));
  return store;
}

test("every sentence rendered for a freshly spawned instance parses back, and re-syncing it writes and retracts nothing", async () => {
  const store = await storeWithSpawnedGoblins();
  const rows = readFactRows(await loadMemory(store));
  const text = renderAgentEditorText(rows, "goblin-1");
  assert.ok(text.split("\n").length > 5, "the instance's own copied traits are all on the page");

  const { triples, unrecognized } = parseAgentEditorText(text);
  assert.deepEqual(unrecognized, [], "the renderer never writes a line its own parser cannot read, comments included");

  const { toAppend, toRemoveIds } = planAgentEditorSync(rows, "goblin-1", triples);
  assert.deepEqual(toAppend, [], "an untouched document appends nothing");
  assert.deepEqual(toRemoveIds, [], "and retracts nothing");
});

test("a line in no phrase the table knows is an honest miss, never a guessed triple", () => {
  assert.equal(parseAgentEditorLine("goblin-1 flies over the square"), null);
  const { triples, unrecognized } = parseAgentEditorText("goblin-1 eats crumb.\nthe weather looks fair today\n");
  assert.equal(triples.length, 1);
  assert.deepEqual(unrecognized, [{ line: 2, text: "the weather looks fair today" }]);
});

test("a comment line is neither a triple nor an honest miss — it is simply not read", () => {
  const { triples, unrecognized } = parseAgentEditorText(
    "goblin-1 eats crumb.\n\n# inherited from goblin (edit the class to change these for every goblin):\n# goblin evades fox.\n",
  );
  assert.equal(triples.length, 1);
  assert.deepEqual(unrecognized, [], "the comment block never reads as an unrecognized line");
});

test("every AGENT_TRAIT_PREDICATES sentence round-trips through the table", () => {
  const cases = [
    ["mgx:consumes", "crumb", "goblin-1 eats crumb."],
    ["mgx:display-name", "goblin", "goblin-1 is called goblin."],
    ["mgx:evades", "fox", "goblin-1 evades fox."],
    ["mgx:guards", "wolf", "goblin-1 guards wolf."],
    ["mgx:hasMass", "8", "goblin-1 weighs 8."],
    ["mgx:is-predator", "true", "goblin-1 is a predator."],
    ["mgx:mass-drain-per-turn", "0.06", "goblin-1 loses 0.06 each turn."],
    ["mgx:model", "goblin", "goblin-1 looks like goblin."],
    ["mgx:pursues", "cabbage", "goblin-1 pursues cabbage."],
    ["mgx:vision-radius", "3", "goblin-1 sees 3 cells."],
  ];
  for (const [predicate, object, sentence] of cases) {
    assert.equal(agentTraitSentence("goblin-1", predicate, object), sentence, predicate);
    assert.deepEqual(parseAgentEditorLine(sentence), { subject: "goblin-1", predicate, object }, sentence);
  }
});

test("a mass sentence's own full stop never leaks into the parsed number", () => {
  assert.deepEqual(
    parseAgentEditorLine("goblin-1 weighs 8."),
    { subject: "goblin-1", predicate: "mgx:hasMass", object: "8" },
  );
  assert.deepEqual(
    parseAgentEditorLine("goblin-1 weighs 8.5."),
    { subject: "goblin-1", predicate: "mgx:hasMass", object: "8.5" },
  );
});

test("mgx:is-predator has no sentence in the false direction, so it is neither rendered nor diffable", () => {
  assert.equal(agentTraitSentence("goblin-1", "mgx:is-predator", "false"), null);
});

test("the inherited block names the class a trait came from, once the instance stops declaring it itself", async () => {
  const store = await storeWithSpawnedGoblins();
  const allRows = readFactRows(await loadMemory(store));
  const ownEvadesRow = allRows.find((r) => r.subject === "goblin-1" && r.predicate === "mgx:evades");
  await removeFacts(store, [ownEvadesRow.id]);
  const rows = readFactRows(await loadMemory(store));

  const text = renderAgentEditorText(rows, "goblin-1");
  assert.doesNotMatch(text, /^goblin-1 evades fox\.$/m, "the retracted row is no longer the instance's own");
  assert.match(text, /# inherited from goblin \(edit the class to change these for every goblin\):/);
  assert.match(text, /# goblin evades fox\./, "the inherited line names the class's own value");
});

test("an instance that owns every one of its traits reports having nothing left to inherit, by name", () => {
  const rows = [
    { id: "t", subject: "goblin-1", predicate: "rdf:type", object: "goblin" },
    { id: "n", subject: "goblin-1", predicate: "mgx:display-name", object: "goblin" },
  ];
  const text = renderAgentEditorText(rows, "goblin-1");
  assert.match(text, /# inherited from goblin \(edit the class to change these for every goblin\):/);
  assert.match(text, /# goblin has no other stated drives\./);
});

test("a class-tab render prints the class's own rows only, never an instance's and no inherited footer", async () => {
  const store = await storeWithSpawnedGoblins();
  const rows = readFactRows(await loadMemory(store));
  const classText = renderAgentClassText(rows, "goblin");
  assert.match(classText, /^goblin evades fox\.$/m);
  assert.match(classText, /^goblin eats crumb\.$/m);
  assert.doesNotMatch(classText, /goblin-1/, "an instance's own copy never leaks into the class's own text");
  assert.doesNotMatch(classText, /# inherited/, "a class has nothing further up its own chain rendered here");
});

test("planAgentEditorSync touches no row of another instance, even when a pasted line names one", async () => {
  const store = await storeWithSpawnedGoblins();
  const rows = readFactRows(await loadMemory(store));
  const ownText = renderAgentEditorText(rows, "goblin-1");
  const { triples } = parseAgentEditorText(`${ownText}\ngoblin-2 eats crumb.\ngoblin-2 weighs 99.`);
  const { toAppend, toRemoveIds } = planAgentEditorSync(rows, "goblin-1", triples);
  assert.deepEqual(toAppend, [], "goblin-1's own document is unchanged, and the goblin-2 lines are not for this subject");
  assert.deepEqual(toRemoveIds, [], "nothing of goblin-1's is retracted either");

  const goblin2RowsBefore = rows.filter((r) => r.subject === "goblin-2").map((r) => [r.predicate, r.object]).sort();
  const goblin2RowsAfter = readFactRows(await loadMemory(store))
    .filter((r) => r.subject === "goblin-2").map((r) => [r.predicate, r.object]).sort();
  assert.deepEqual(goblin2RowsAfter, goblin2RowsBefore, "goblin-2's rows are byte-identical — the plan never even considered them");
});

test("planAgentEditorSync writes an added trait and retracts a removed one, scoped to the one instance edited", async () => {
  const store = await storeWithSpawnedGoblins();
  const rows = readFactRows(await loadMemory(store));
  const edited = renderAgentEditorText(rows, "goblin-1")
    .split("\n")
    .filter((l) => l !== "goblin-1 evades fox.")
    .concat("goblin-1 evades cabbage.")
    .join("\n");
  const { triples, unrecognized } = parseAgentEditorText(edited);
  assert.deepEqual(unrecognized, []);
  const { toAppend, toRemoveIds } = planAgentEditorSync(rows, "goblin-1", triples);
  assert.deepEqual(toAppend, [{ subject: "goblin-1", predicate: "mgx:evades", object: "cabbage" }]);
  const removedRow = rows.find((r) => r.subject === "goblin-1" && r.predicate === "mgx:evades" && r.object === "fox");
  assert.deepEqual(toRemoveIds, [removedRow.id]);
});
