// chatflow-coverage.test.mjs — SKILL_CHAT_PLAYTEST regression transcript. A
// natural "what's covered / what's untested" conversation that USED to hit the
// grammar wall now FLOWS end to end: every turn answers (miss:false) or gives an
// honest empty with a receipt, no "couldn't parse this as a graph question".
//
// The dead-ends this pins (all ROUTING, no grammar rigidity):
//   the PREDICATIVE qualifier form — "which modules are untested", "what functions
//   are tested", "which methods are public" — hit the grammar wall while the
//   ATTRIBUTIVE "untested modules" / "public methods" already answered (and, worse,
//   the wall's OWN hint suggested "which functions are tested", a shape it could not
//   then serve). interpret/normalize.mjs now rewrites the predicative form onto the
//   working attributive filter; the "…are NOT tested" set-complement is untouched.
//
// Driven against the SHIPPED examples/mini-webapp graph — the exact graph the
// playtest chatted — so the answers are real, not fixture-mocked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { runTurn } from "../src/chat.mjs";
import { clearCache } from "../src/source.mjs";

const GRAPH = new URL("../examples/mini-webapp/.tmct/graph.json", import.meta.url).pathname;

/** Drive turns through the real runTurn path, carrying `last` so discourse anaphora
 *  / "what about X" resolve exactly as the shell would. Read-only (queries only). */
async function drive(queries) {
  const config = { graphFile: GRAPH };
  const out = [];
  let last = null;
  for (const q of queries) {
    clearCache();
    const r = await runTurn(q, { config, last });
    out.push(r);
    last = r.last;
  }
  return out;
}

test("coverage flow: the testing/coverage conversation flows end to end (was 3 grammar walls)", async () => {
  const turns = [
    "what are the tests",                        // relation force — already worked
    "which modules are untested",                // predicative qualifier — was a wall
    "what functions are tested",                 // predicative qualifier — was a wall
    "which modules are not tested",              // set-complement path — must stay working
    "what tests cover src/handlers/tasks.mjs",   // explicit tests-of — already worked
  ];
  const rs = await drive(turns);

  // EVERY turn flows: answers, and never the grammar wall / unknown-qualifier.
  for (let i = 0; i < rs.length; i += 1) {
    assert.equal(rs[i].record.miss, false, `turn ${i} "${turns[i]}" must not miss`);
    assert.doesNotMatch(rs[i].answer, /couldn't parse this as a graph question/, `turn ${i} no grammar wall`);
    assert.doesNotMatch(rs[i].answer, /unknown qualifier/, `turn ${i} no unknown-qualifier`);
  }

  // the relation force still opens the topic with its three-band answer.
  assert.match(rs[0].answer, /^A test is code that exercises/, "relation force definition band");
  // predicative "which modules are untested" reaches the untested list (the same set
  // the set-complement "are not tested" returns — they must agree).
  assert.match(rs[1].answer, /src\/core\/validate\.mjs/, "untested list names an uncovered module");
  assert.equal(rs[1].answer, rs[3].answer, "predicative 'are untested' == set-complement 'are not tested'");
  // predicative "what functions are tested" reaches the tested-functions list.
  assert.match(rs[2].answer, /saveStore\(\)/, "tested-functions list names a covered function");
  // explicit tests-of still resolves to the covering test module.
  assert.match(rs[4].answer, /test\/tasks\.test\.mjs/, "tests-of resolves to the covering test");
});

test("predicative qualifiers: every qualifier adjective routes off the grammar wall onto a real answer", async () => {
  // each predicative form now answers (miss:false) with the expected members — it USED
  // to hit the grammar wall. (The rewritten string can pick a different-but-equivalent
  // renderer than the bare attributive twin — some strategies read ctx.raw — so we pin
  // the ANSWER's content, the load-bearing part, not byte-equality to the twin.)
  for (const [predicative, member] of [
    ["which modules are untested", /src\/core\/validate\.mjs/],
    ["what functions are tested", /saveStore\(\)/],
    ["which methods are public", /Task\.complete\(\)/],
    ["which modules are covered", /src\/core\/store\.mjs/],
  ]) {
    const [pred] = await drive([predicative]);
    assert.equal(pred.record.miss, false, `"${predicative}" now answers`);
    assert.doesNotMatch(pred.answer, /couldn't parse this as a graph question/, `"${predicative}" is not a wall`);
    assert.match(pred.answer, member, `"${predicative}" names the expected member`);
  }
  // an EMPTY qualifier class is an honest empty, not a wall (genuine absence flows).
  const [abstract] = await drive(["which classes are abstract"]);
  assert.equal(abstract.record.miss, true, "no abstract classes exist — honestly empty");
  assert.doesNotMatch(abstract.answer, /couldn't parse this as a graph question/, "…but never the grammar wall");
});

test("predicative discipline: 'which modules are NOT tested' keeps its set-complement handler", async () => {
  // the negation form must NOT be seized by the predicative-qualifier rewrite (the
  // QUALIFIER has to sit immediately after are/is); it keeps its own complement path.
  const [neg] = await drive(["which modules are not tested"]);
  assert.equal(neg.record.miss, false, "the set-complement negation still answers");
  assert.match(neg.answer, /src\/core\/validate\.mjs/, "and returns the untested set");
});
