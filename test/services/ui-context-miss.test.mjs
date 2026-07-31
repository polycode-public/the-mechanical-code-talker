// A dead-end names the exit the SURFACE can actually take. A terminal session
// can run `tmct index`/`tmct init` or pass `--repo`; a page has no filesystem
// and no argv, so naming those commands there sends the reader after something
// that page cannot do. `uiContext` ("cli" by default, "browser" from the web
// turn sessions) picks between the two wordings.
import { test } from "node:test";
import assert from "node:assert/strict";

import { runTurn, answerCount, vocabExampleHint } from "../../src/services/chat.mjs";
import { createInMemoryStore } from "../../src/adapters/memory/core.mjs";
import { parseEntities } from "../../src/domain/codegraph.mjs";

const CLI_COMMANDS = /tmct index|tmct init|--repo|npm run example:mini/;

const emptyCodeGraph = () => parseEntities({ individuals: [], objectProperties: [] });

async function pageTurn(line, { vocabHint = "" } = {}) {
  const memoryDir = createInMemoryStore();
  const { answer } = await runTurn(line, {
    graph: emptyCodeGraph(), memoryDir, env: {}, uiContext: "browser", vocabHint,
  });
  return answer;
}

async function cliTurn(line, { vocabHint = "" } = {}) {
  const memoryDir = createInMemoryStore();
  const { answer } = await runTurn(line, {
    graph: emptyCodeGraph(), memoryDir, env: {}, vocabHint,
  });
  return answer;
}

test("a code question on a memory-only page misses without naming a CLI command", async () => {
  const answer = await pageTurn("which modules import walk.mjs");
  assert.doesNotMatch(answer, CLI_COMMANDS);
  assert.match(answer, /no code graph is loaded/i);
});

test("the same code question in a terminal keeps the CLI remedy", async () => {
  assert.match(await cliTurn("which modules import walk.mjs"), /tmct init/);
});

test("an uncountable kind on a page says the page holds facts only, never 'tmct index'", async () => {
  const answer = await pageTurn("how many widgets are there");
  assert.doesNotMatch(answer, CLI_COMMANDS);
  assert.match(answer, /I can't count "widgets"/);
});

test("answerCount's empty-graph miss keeps the CLI remedy by default and drops it for a page", () => {
  const empty = { individuals: [], byId: new Map(), relations: [], truncated: [], proseIndex: {} };
  assert.match(answerCount(empty, "count soup"), CLI_COMMANDS);
  assert.doesNotMatch(answerCount(empty, "count soup", { uiContext: "browser" }), CLI_COMMANDS);
});

test("the arithmetic decline offers a repo only in a terminal", async () => {
  assert.doesNotMatch(await pageTurn("whats 2+2"), CLI_COMMANDS);
  assert.match(await cliTurn("whats 2+2"), /--repo/);
});

test("the empty-memory summary offers `tmct init` only in a terminal", async () => {
  assert.doesNotMatch(await pageTurn("what do you know"), CLI_COMMANDS);
  assert.match(await cliTurn("what do you know"), /tmct init/);
});

test("vocabExampleHint keeps the teach pointer on both surfaces and the seed command on neither when seeded", () => {
  assert.match(vocabExampleHint(false), /tmct init/);
  assert.match(vocabExampleHint(false), /teach me directly/);
  assert.doesNotMatch(vocabExampleHint(false, "browser"), CLI_COMMANDS);
  assert.match(vocabExampleHint(false, "browser"), /teach me directly/i);
  assert.equal(vocabExampleHint(true), vocabExampleHint(true, "browser"));
});
