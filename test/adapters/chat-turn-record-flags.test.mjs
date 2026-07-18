// The turn record's miss flag is a boolean on every path — including the one
// that only a memory-less session walks: an answer rescued by the relaxation
// cascade (noise wrappers dropped) must record miss=false, never a null
// leaked by a short-circuited gate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { runTurn } from "../../src/services/chat.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";
import * as source from "../../src/adapters/source.mjs";

const FIXTURE = fileURLToPath(new URL("../fixtures/entities.fixture.json", import.meta.url));
const CONFIG = { graphFile: FIXTURE };
let GRAPH;
async function graph() { return (GRAPH ||= parseEntities(await source.fetchEntities(CONFIG))); }

test("a relaxation-rescued answer in a memory-less session records miss=false, a real boolean", async () => {
  const r = await runTurn("hey tmct, how many classes are there thanks", { config: CONFIG, graph: await graph() });
  assert.match(r.answer, /3 classes\./);
  assert.equal(r.record.miss, false, "the record's miss flag is boolean false, not null");
});

test("a genuine miss in a memory-less session still records miss=true", async () => {
  const r = await runTurn("wibble the wobble sideways maybe?", { config: CONFIG, graph: await graph() });
  assert.equal(r.record.miss, true);
});
