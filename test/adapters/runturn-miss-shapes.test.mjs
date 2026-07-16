// Miss-shape branches only the bare runTurn library surface can reach.
// Sessions always carry a memory store, so the memory-facts lane claims
// these queries first there; a library caller with no memoryDir still gets
// the tailored hints pinned here. shortMissHint itself is a pure helper.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { runTurn, shortMissHint, WALL_MISS_RE } from "../../src/chat.mjs";
import { parseEntities } from "../../src/codegraph.mjs";
import * as source from "../../src/adapters/source.mjs";

const CONFIG = { graphFile: fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url)) };
let GRAPH;
async function graph() { return (GRAPH ||= parseEntities(await source.fetchEntities(CONFIG))); }

test("shortMissHint keeps the honest opening, drops the grammar wall, and tailors the example to the query's keywords", () => {
  const wall = /which <functions\|classes\|modules>/;
  const imp = shortMissHint("does the frobnicator import things");
  assert.match(imp, WALL_MISS_RE, "graded opening preserved");
  assert.match(imp, /Type \/help for all query shapes\.$/);
  assert.doesNotMatch(imp, wall, "the full grammar cheat-sheet is gone");
  assert.match(imp, /import/, "an import-flavoured query gets an import example");
  assert.match(shortMissHint("who calls stuff around here"), /calls <name>/, "a call-flavoured query gets a call example");
  assert.match(shortMissHint("explain the class hierarchy"), /inherit from|subclasses/, "hierarchy gets an inherit example");
});

test("a membership question with a broken article gets the article hint, not the wall (no-memory library surface)", async () => {
  const { answer } = await runTurn("is a algorithm information", { config: CONFIG, graph: await graph() });
  assert.match(answer, WALL_MISS_RE);
  assert.match(answer, /article before the kind/);
  assert.doesNotMatch(answer, /which <functions\|classes\|modules>/);
});

test("orientation examples degrade: an empty graph keeps the identity-led empty orientation, a null graph keeps the generic pair", async () => {
  const empty = await runTurn("what can you do", { config: CONFIG, graph: { individuals: [], relations: [], byId: new Map() } });
  assert.match(empty.answer, /I'm tmct/i, "an empty graph's orientation leads with identity, not an apology");
  assert.match(empty.answer, /--repo <path>/, "and still carries the --repo exit");
  const nul = await runTurn("what can you do", { config: CONFIG, graph: null });
  assert.match(nul.answer, /which modules import walk\.mjs/, "a null (unknown) graph keeps the generic example1");
  assert.match(nul.answer, /what calls buildContextBundle/, "and the generic example2");
});
