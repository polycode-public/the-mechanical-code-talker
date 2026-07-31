// A general-verb teach mints its predicate from wink's lemma of the verb, and
// the read-back inflects that lemma again. Wink lemmatises a bare token with no
// sentence around it, so a surface that is both a plural noun and a 3rd-person
// singular verb ("lives", "halves", "shelves") comes back as the noun singular
// ("life", "half", "shelf") and the round trip renders "ann lifes in paris".
// These pin the verb reading for that spelling, and pin the neighbours wink
// already reads correctly so the correction can't overreach.
import { test } from "node:test";
import assert from "node:assert/strict";

import { runTurn } from "../../src/services/chat.mjs";
import { createInMemoryStore } from "../../src/adapters/memory/core.mjs";

async function teach(sentence) {
  const memoryDir = createInMemoryStore();
  const { answer } = await runTurn(sentence, { graph: null, memoryDir, env: {} });
  return answer;
}

test("a '-ves' verb round-trips through the teach confirmation as the verb, not the '-f' noun", async () => {
  const answer = await teach("ann lives in paris");
  assert.match(answer, /^noted — remembered: ann lives in paris/);
  assert.doesNotMatch(answer, /lifes/);
});

test("the other '-ves' verbs wink reads as nouns keep their verb spelling too", async () => {
  assert.match(await teach("bob shelves the books"), /^noted — remembered: bob shelves books/);
  assert.match(await teach("liz halves the cake"), /^noted — remembered: liz halves cake/);
});

test("a '-ves' verb wink already lemmatises correctly is left alone", async () => {
  assert.match(await teach("carl leaves the office"), /^noted — remembered: carl leaves office/);
  assert.match(await teach("dan moves the box"), /^noted — remembered: dan moves box/);
  assert.match(await teach("kim waves the flag"), /^noted — remembered: kim waves flag/);
  assert.match(await teach("ivy solves the puzzle"), /^noted — remembered: ivy solves puzzle/);
});

test("verbs outside the '-ves' spelling still round-trip as they did", async () => {
  assert.match(await teach("gina teaches the class"), /^noted — remembered: gina teaches class/);
  assert.match(await teach("hal carries the crate"), /^noted — remembered: hal carries crate/);
});

test("a taught '-ves' verb fact reads back on a later turn in the same spelling", async () => {
  const memoryDir = createInMemoryStore();
  const first = await runTurn("ann lives in paris", { graph: null, memoryDir, env: {} });
  assert.match(first.answer, /ann lives in paris/);
  const recall = await runTurn("what do you know about ann", {
    graph: null, memoryDir, env: {}, focus: first.focus, last: first.last,
  });
  assert.match(recall.answer, /ann lives in paris/);
  assert.doesNotMatch(recall.answer, /lifes/);
});
