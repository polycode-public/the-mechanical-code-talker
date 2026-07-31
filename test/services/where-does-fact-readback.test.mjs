// "where does ann live" fronts the subject with an auxiliary verb the same
// way "where is ann" doesn't. WHERE_IS_FACT_RE only matched the copula form,
// so the auxiliary-fronted question fell through to the code-graph miss
// cascade instead of reading the same taught locative fact — even though
// ask.mjs's own term parsing for this shape (splitAuxFrontedWhereVerb) was
// fixed separately. These pin the chat.mjs taught-fact reader side of it.
import { test } from "node:test";
import assert from "node:assert/strict";

import { runTurn } from "../../src/services/chat.mjs";
import { createInMemoryStore } from "../../src/adapters/memory/core.mjs";

test("a taught locative fact answers both 'where is X' and 'where does X verb'", async () => {
  const memoryDir = createInMemoryStore();
  const taught = await runTurn("ann lives in paris", { graph: null, memoryDir, env: {} });
  const isForm = await runTurn("where is ann", { graph: null, memoryDir, env: {}, focus: taught.focus, last: taught.last });
  assert.match(isForm.answer, /ann lives in paris/);
  const doesForm = await runTurn("where does ann live", { graph: null, memoryDir, env: {}, focus: taught.focus, last: taught.last });
  assert.match(doesForm.answer, /ann lives in paris/);
});

test("'where did X verb' and 'where do X verb' read the same taught fact", async () => {
  const memoryDir = createInMemoryStore();
  const taught = await runTurn("bob works in london", { graph: null, memoryDir, env: {} });
  const did = await runTurn("where did bob work", { graph: null, memoryDir, env: {}, focus: taught.focus, last: taught.last });
  assert.match(did.answer, /bob works in london/);
  const doForm = await runTurn("where do bob work", { graph: null, memoryDir, env: {}, focus: taught.focus, last: taught.last });
  assert.match(doForm.answer, /bob works in london/);
});

test("an untaught subject still misses honestly through the auxiliary-fronted form", async () => {
  const memoryDir = createInMemoryStore();
  const { answer } = await runTurn("where does zorblatt live", { graph: null, memoryDir, env: {} });
  assert.doesNotMatch(answer, /zorblatt lives/);
});
