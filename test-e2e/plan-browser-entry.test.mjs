// The live plan-browser session's engine-level behavior contract, run as
// plain ESM under Node: createPlanSession (the same entry the browser
// bundle wraps) over the real chat turn engine. What the "it plans, and
// shows the work" page's live controls and chat-assert dock promise a
// visitor is asserted here without a browser in the loop — a fresh N-disk
// puzzle solves on session creation, a taught goal revision changes the
// NEXT solve without re-teaching the board, and the max-search-depth
// override lets a follow-up "solve it" recover from an honest miss without
// tearing the session down.
import { test } from "node:test";
import assert from "node:assert/strict";

import { createPlanSession } from "../src/surfaces/web/plan-browser-entry.mjs";
import { planToPageData, renderInputsFromPlan } from "../src/services/plan-viz.mjs";
import { planToPddl } from "../src/services/plan-pddl.mjs";

/** Walk the "rests on" support chain from `member` (the SAME transitive walk
 *  compileGoal's own isGoal uses, domain.mjs) — a small disk resting on a
 *  bigger one that itself rests on the target peg still satisfies "every
 *  disk rests on peg-c", so a direct-row check would be the wrong test. */
function restsOnEventually(rows, member, target) {
  let current = member;
  const seen = new Set();
  for (let hop = 0; hop <= rows.length; hop += 1) {
    if (seen.has(current)) return false;
    seen.add(current);
    const row = rows.find((r) => r.subject === current);
    if (!row) return false;
    if (row.object === target) return true;
    current = row.object;
  }
  return false;
}

test("createPlanSession: a fresh 3-disk puzzle solves on creation with a real, ready-to-render plan", async () => {
  const session = await createPlanSession({ diskCount: 3 });
  assert.ok(session.plan, "the default puzzle solves");
  assert.equal(session.plan.actions.length, 7);
  assert.equal(session.plan.states.length, 8);
  assert.equal(session.plan.goal.text, "every disk rests on peg-c");
  assert.ok(session.plan.becauseText && session.plan.becauseText.length > 0, "becauseText is folded onto the returned plan");
  const final = session.plan.states.at(-1);
  for (const disk of ["disk-1", "disk-2", "disk-3"]) {
    assert.ok(restsOnEventually(final, disk, "peg-c"), `${disk} does not end up resting on peg-c`);
  }
});

test("createPlanSession: teaching a new goal through chat, then 'solve it', produces a genuinely different plan — the live teach-then-resolve round trip", async () => {
  const session = await createPlanSession({ diskCount: 3 });
  const original = session.plan;
  assert.ok(restsOnEventually(original.states.at(-1), "disk-1", "peg-c"));

  const revise = await session.turn("actually, the goal is that every disk rests on peg-b.");
  assert.match(revise.answer, /noted.*peg-b/s);

  const resolved = await session.turn("solve it.");
  assert.ok(resolved.plan, "the revised goal still finds a plan");
  assert.equal(resolved.plan.goal.text, "every disk rests on peg-b");
  const final = resolved.plan.states.at(-1);
  for (const disk of ["disk-1", "disk-2", "disk-3"]) {
    assert.ok(restsOnEventually(final, disk, "peg-b"), `${disk} does not end up on peg-b, not the original peg-c`);
  }
  assert.notDeepEqual(
    resolved.plan.actions.map((a) => a.target),
    original.actions.map((a) => a.target),
    "the re-solved plan actually targets different pegs than the original",
  );
});

test("createPlanSession: a max-depth override on turn() re-solves the SAME board without re-teaching it", async () => {
  // 7 moves are needed; a max depth of 1 is an honest miss.
  const session = await createPlanSession({ diskCount: 3, maxDepth: 1 });
  assert.equal(session.plan, null, "too shallow a search finds nothing");

  const shallow = await session.turn("solve it.", { maxDepth: 1 });
  assert.match(shallow.answer, /no plan found within 1 move/);
  assert.equal(shallow.plan, null);

  const deep = await session.turn("solve it.", { maxDepth: 300 });
  assert.ok(deep.plan, "raising max depth on the SAME board recovers a plan");
  assert.equal(deep.plan.actions.length, 7);
});

test("createPlanSession: an ordinary board question answers off the live board, no plan required", async () => {
  const session = await createPlanSession({ diskCount: 3 });
  const result = await session.turn("what moves are legal now?");
  assert.match(result.answer, /legal move/);
});

test("createPlanSession: a solved plan round-trips cleanly through planToPageData and planToPddl", async () => {
  const session = await createPlanSession({ diskCount: 3 });
  const { rendersAs, sizeOrder } = renderInputsFromPlan(session.plan);
  const pageData = planToPageData({ plan: session.plan, rendersAs, sizeOrder });
  assert.equal(pageData.layouts.length, 8);
  assert.equal(pageData.actions.length, 7);

  const pddl = planToPddl(session.plan);
  assert.match(pddl, /\(mgx:rest-on disk-1 disk-2\)/);
  assert.match(pddl, /\(rdf:type disk-1 disk\)/);
  assert.ok(!/undefined/.test(pddl));
});

test("importing plan-browser-entry.mjs publishes globalThis.tmct with the live-session factory as its open() verb and the pure page helpers on tmct.page", async () => {
  await import("../src/surfaces/web/plan-browser-entry.mjs");
  assert.equal(typeof globalThis.tmct.open, "function");
  assert.equal(typeof globalThis.tmct.page.planToPageData, "function");
  assert.equal(typeof globalThis.tmct.page.planToPddl, "function");
  assert.equal(typeof globalThis.tmct.page.renderInputsFromPlan, "function");
  assert.equal(typeof globalThis.tmct.page.computeBlocksLayout, "function");
});

test("createPlanSession: a smaller puzzle (1 disk) is trivially solved with a single move", async () => {
  const session = await createPlanSession({ diskCount: 1 });
  assert.ok(session.plan);
  assert.equal(session.plan.actions.length, 1);
  assert.equal(session.plan.actions[0].subject, "disk-1");
  assert.equal(session.plan.actions[0].target, "peg-c");
});

test("createPlanSession: the puzzle's own disk/peg inventory answers through the chat dock, tracks the disk count, and nonsense still misses", async () => {
  const session = await createPlanSession({ diskCount: 4 });
  const yesNo = await session.turn("does the puzzle have 4 disks?");
  assert.match(yesNo.answer, /yes — .*puzzle has 4 disks/);
  const described = await session.turn("what is the puzzle?");
  assert.match(described.answer, /puzzle has 4 disks/);
  assert.match(described.answer, /puzzle has 3 pegs/);
  const miss = await session.turn("what is the flux capacitor?");
  assert.match(miss.answer, /I don't know "flux capacitor"/);
});
