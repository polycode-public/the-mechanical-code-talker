// The pure runTurn library surface (no session handle): a caller who passes
// only config gets the relation force through its own lazy graph load, and a
// caller with no memory store still gets the opinion nudge. Sessions preload
// the graph and always carry memory, so these two branches are pinned here
// rather than in the corpus lanes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { runTurn } from "../../src/services/chat.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import * as source from "../../src/adapters/source.mjs";

const CONFIG = { graphFile: fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url)) };

test("runTurn with config only (no preloaded graph) lazily loads the graph for the relation force", async () => {
  source.clearCache();
  const r = await runTurn("what about imports", { config: CONFIG });
  assert.match(r.answer, /^To import is to bring another module's definitions/);
  assert.match(r.answer, /import edges/);
});

test("runTurn with no memory store gives the opinion nudge for a code-quality question", async () => {
  source.clearCache();
  const graph = parseEntities(await source.fetchEntities(CONFIG));
  const r = await runTurn("is the code good", { config: CONFIG, graph });
  assert.match(r.answer, /don't hold opinions/);
});
