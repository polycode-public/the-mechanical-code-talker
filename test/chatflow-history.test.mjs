// chatflow-history.test.mjs — SKILL_CHAT_PLAYTEST regression transcript. A natural
// "what moves with this file / who touched it" history conversation that USED to
// dead-end now FLOWS: every turn answers or gives an honest empty with a receipt.
//
// The dead-end this pins (ROUTING, no grammar rigidity):
//   CO-CHANGE phrased the plainest way — "what does X change together with" (the
//   phrasing the mini-webapp README itself prints, and the exact verb the relation
//   renders as) — resolved to "couldn't resolve one of the terms"; "what changes
//   together with X" hit the grammar wall. The cochange verb synonyms carried
//   "co-changes with" / "moves together with" but not the bare "change(s) together
//   with". interpret/normalize.mjs now rewrites both onto the working "co-changes
//   with X" canonical.
//
// Driven against the SHIPPED examples/mini-webapp graph (its one cochange edge is
// src/core/model.mjs — src/core/store.mjs), so the answers are real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { driveTurns } from "./helpers/session.mjs";

const GRAPH = new URL("../examples/mini-webapp/.tmct/graph.json", import.meta.url).pathname;
const drive = (queries) => driveTurns({ graphFile: GRAPH }, queries);

test("history flow: the change-coupling conversation flows end to end (was a dead-end)", async () => {
  const turns = [
    "who touched src/core/store.mjs",                    // churn — already worked
    "what does src/core/store.mjs change together with",  // README phrasing — was a dead-end
    "what changes together with src/core/store.mjs",      // subject-first phrasing — was a wall
    "what co-changes with src/core/store.mjs",            // canonical — already worked
  ];
  const rs = await drive(turns);

  for (let i = 0; i < rs.length; i += 1) {
    assert.equal(rs[i].record.miss, false, `turn ${i} "${turns[i]}" must not miss`);
    assert.doesNotMatch(rs[i].answer, /couldn't parse this as a graph question/, `turn ${i} no grammar wall`);
    assert.doesNotMatch(rs[i].answer, /couldn't resolve one of the terms/, `turn ${i} no unresolved-terms dead-end`);
  }

  // the three cochange phrasings all reach the one coupled module — and agree with
  // the canonical "co-changes with", so the routing is a true synonym, not a guess.
  assert.match(rs[1].answer, /src\/core\/model\.mjs/, "README phrasing resolves the coupled module");
  assert.equal(rs[1].answer, rs[3].answer, "'change together with' == 'co-changes with'");
  assert.equal(rs[2].answer, rs[3].answer, "'changes together with' == 'co-changes with'");
});

test("co-change routing: an uncoupled module is an honest empty with a receipt, never a wall", async () => {
  // the cochange edge is stored subject=model → object=store, so asking the SUBJECT
  // side ("what does model change together with") has no object-side match: an honest
  // empty carrying its traversal receipt is FLOW, not the grammar wall.
  const [r] = await drive(["what does src/core/model.mjs change together with"]);
  assert.doesNotMatch(r.answer, /couldn't parse this as a graph question/, "not the grammar wall");
  assert.doesNotMatch(r.answer, /couldn't resolve one of the terms/, "not the unresolved-terms dead-end");
  // (0.8.2 WS1: the receipt left the honest-empty prose — it rides the turn's
  // detail, where why/verbose re-renders still surface it.)
  assert.match(r.last.detail.traversal, /cochange edges/, "honest empty carries its receipt in detail");
});
