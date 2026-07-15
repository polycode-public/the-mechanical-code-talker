// compare.test.mjs — regression coverage for the scoped-down v1 comparison
// capability (HANDOVER.md 2026-07-12 "no comparison capability" item):
// "how is X different from Y" / "compare X and Y" / "what's the difference
// between X and Y" now reach a real (4f) COMPARE RESCUE lane (src/chat.mjs)
// that resolves both named entities (resolveSymbol) and renders their
// differences (renderCompare, src/codegraph.mjs — reuses describe's own
// edgesFor/relLabel/capJoin, no new graph traversal).
//
// Driven against the SHIPPED examples/mini-webapp graph, whose
// TaskController/UserController both inherit Controller — the natural
// same-kind comparison pair.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { driveTurns } from "./helpers/session.mjs";
import { parseEntities } from "../src/codegraph.mjs";

const GRAPH = new URL("../examples/mini-webapp/.tmct/graph.json", import.meta.url).pathname;
const CONFIG = { graphFile: GRAPH };
const drive = (queries) => driveTurns(CONFIG, queries);
// Focus/anaphora threading (the "what calls it" follow-up test below) needs the
// SAME preloaded `graph` object driveTurns's own `carryFocus` option is built for
// (see test/chatbench-levers.test.mjs's repoDriver — the exact same pattern):
// runAsk's contextId-binding only fires when a live graph is threaded in, not the
// bare config path a single stateless turn uses.
const PRELOADED_GRAPH = parseEntities(JSON.parse(readFileSync(GRAPH, "utf8")));

test("compare: two same-kind Classes (TaskController vs UserController) — real diff, no grammar wall", async () => {
  const rs = await drive([
    "compare TaskController and UserController",
    "how is TaskController different from UserController",
    "how does TaskController differ from UserController",
    "what is the difference between TaskController and UserController",
  ]);
  for (const r of rs) {
    assert.equal(r.record.miss, false, "a resolvable same-kind comparison must not miss");
    assert.equal(r.record.via, "compare");
    assert.doesNotMatch(r.answer, /couldn't parse this as a graph question/, "no grammar wall");
    assert.match(r.answer, /^Comparing TaskController and UserController \(both Class\):/);
    // shared fact: both inherit Controller.
    assert.match(r.answer, /inherits \[seon:hasSuperType\]: TaskController \(1\) -> Controller; UserController \(1\) -> Controller/);
  }
});

test("compare: 'diff' as a casual synonym for 'different'/'difference' (BENCHMARK_CONVERSATION_1.8.14.md item 8), including the no-apostrophe 'whats' contraction", async () => {
  const rs = await drive([
    "how is TaskController diff from UserController",
    "whats the diff between TaskController and UserController",
    "diff between TaskController and UserController",
  ]);
  for (const r of rs) {
    assert.equal(r.record.miss, false, "a resolvable same-kind comparison must not miss");
    assert.equal(r.record.via, "compare");
    assert.doesNotMatch(r.answer, /couldn't parse this as a graph question/, "no grammar wall");
    assert.match(r.answer, /^Comparing TaskController and UserController \(both Class\):/);
  }
});

test("compare: carries the last-named entity forward as focus for a follow-up 'it'", async () => {
  const rs = await driveTurns(CONFIG, [
    "compare TaskController and UserController",
    "what calls it",
  ], { graph: PRELOADED_GRAPH, carryFocus: true });
  assert.equal(rs[0].record.via, "compare");
  assert.doesNotMatch(rs[1].answer, /needs a selected node to refer to/, "the follow-up 'it' resolves — a real focus was carried forward");
});

test("compare: an unresolved entity gets an honest miss, not a forced comparison", async () => {
  const rs = await drive(["compare TaskController and Zarnaxlplorp"]);
  assert.equal(rs[0].record.via, "compare");
  assert.match(rs[0].answer, /"Zarnaxlplorp" doesn't resolve to anything in the current artifact/);
});

test("compare: mismatched kinds (Class vs Module) refuse honestly rather than forcing a comparison", async () => {
  const rs = await drive(["compare TaskController and src/core/model.mjs"]);
  assert.equal(rs[0].record.via, "compare");
  assert.match(rs[0].answer, /I can only compare two entities of the SAME kind/);
  assert.match(rs[0].answer, /"TaskController" is a class/);
  assert.match(rs[0].answer, /"src\/core\/model\.mjs" is a module/);
});

test("compare: the same entity named twice has nothing to compare", async () => {
  const rs = await drive(["compare TaskController and TaskController"]);
  assert.equal(rs[0].record.via, "compare");
  assert.match(rs[0].answer, /resolve to the same entity — nothing to compare/);
});

test("compare: an ordinary ask() query is completely unaffected by the new lane", async () => {
  const rs = await drive(["what depends on src/core/model.mjs"]);
  assert.equal(rs[0].record.miss, false);
  assert.doesNotMatch(rs[0].answer, /^Comparing /);
});
