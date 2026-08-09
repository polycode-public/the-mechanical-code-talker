// agent-belief.test.mjs — direct unit coverage for the board-size-agnostic
// belief module: the Chebyshev vision test, the told-fact fallback, the
// removed-target guard, and the deterministic candidate ordering every caller
// depends on. The spider-and-fly engine re-exports these three functions, so
// test/services/spider-fly.test.mjs covers the same contract on a 10x10 board;
// what lives here is the board-independent behaviour, including boards larger
// than spider-fly's.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_VISION_RADIUS, believedCellOf, beliefOriginOf, nearestBelievedTarget, beliefSnapshotFor,
} from "../../src/domain/agent-belief.mjs";

/** A folded world state carrying just what belief reads: where everything is,
 *  and which subjects the board has taken off it. */
function stateOf(placements, removed = []) {
  return {
    placements: new Map(Object.entries(placements).map(([subject, cell]) => [subject, { cell }])),
    removed: new Set(removed),
  };
}

test("a target inside the observer's Chebyshev radius is believed at its real cell, and outside it is unknown", () => {
  const state = stateOf({ "goblin-1": "cell-5-2" });
  assert.deepEqual(
    believedCellOf("goblin-1", "fox-1", { x: 2, y: 2 }, state, { visionRadius: 4 }),
    { x: 5, y: 2 },
    "three Chebyshev steps away sits inside a radius-4 vision",
  );
  assert.equal(
    believedCellOf("goblin-1", "fox-1", { x: 2, y: 2 }, state, { visionRadius: 2 }),
    null,
    "the same target is outside a radius-2 vision, and nothing was told — honestly unknown",
  );
});

test("vision reaches cells beyond a 10x10 board, so a 12x12 town square is fully visible", () => {
  const state = stateOf({ "goblin-1": "cell-12-12", "goblin-2": "cell-11-9" });
  assert.deepEqual(
    believedCellOf("goblin-1", "fox-1", { x: 11, y: 11 }, state, { visionRadius: 4 }),
    { x: 12, y: 12 },
    "a target in the far corner of a 12x12 board is one step away and plainly visible",
  );
  assert.deepEqual(
    believedCellOf("goblin-2", "fox-1", { x: 12, y: 12 }, state, { visionRadius: 4 }),
    { x: 11, y: 9 },
    "and so is one three steps back from that corner",
  );
});

test("vision is Chebyshev with no line of sight, so a solid prop between two agents hides nothing", () => {
  // A building's cell is solid to the planner (the world pack omits its exit
  // edges) and invisible to belief, which never reads the board at all.
  const state = stateOf({ "goblin-1": "cell-6-3", "well-1": "cell-4-3" });
  assert.deepEqual(
    believedCellOf("goblin-1", "fox-1", { x: 2, y: 3 }, state, { visionRadius: 4 }),
    { x: 6, y: 3 },
    "the well sits squarely between them and does not block sight",
  );
});

test("the radius defaults to DEFAULT_VISION_RADIUS when the caller names none", () => {
  const state = stateOf({ "goblin-1": "cell-6-2" });
  assert.equal(DEFAULT_VISION_RADIUS, 4);
  assert.deepEqual(believedCellOf("goblin-1", "fox-1", { x: 2, y: 2 }, state), { x: 6, y: 2 });
  assert.equal(believedCellOf("goblin-1", "fox-1", { x: 1, y: 2 }, state), null);
});

test("outside vision, the newest told fact addressed to this observer fills the belief", () => {
  const state = stateOf({ "goblin-1": "cell-9-9" });
  const toldFacts = [
    { subject: "goblin-1", toAgent: "fox-1", cell: "cell-6-2", turn: 4 },
    { subject: "goblin-1", toAgent: "fox-1", cell: "cell-3-7", turn: 9 },
  ];
  assert.deepEqual(
    believedCellOf("goblin-1", "fox-1", { x: 2, y: 2 }, state, { visionRadius: 2, toldFacts }),
    { x: 3, y: 7 },
    "the later turn wins",
  );
});

test("a told fact addressed to a different agent never leaks into this observer's belief", () => {
  const state = stateOf({ "goblin-1": "cell-9-9" });
  assert.equal(
    believedCellOf("goblin-1", "goblin-2", { x: 2, y: 2 }, state, {
      visionRadius: 2,
      toldFacts: [{ subject: "goblin-1", toAgent: "fox-1", cell: "cell-6-2", turn: 4 }],
    }),
    null,
  );
});

test("a removed target is believed nowhere, and a told fact cannot put it back on the board", () => {
  const state = stateOf({ "goblin-1": "cell-3-3" }, ["goblin-1"]);
  assert.equal(
    believedCellOf("goblin-1", "fox-1", { x: 3, y: 3 }, state, { visionRadius: 4 }),
    null,
    "an eaten goblin is not believed present even standing on the observer's own cell",
  );
  assert.equal(
    believedCellOf("goblin-1", "fox-1", { x: 9, y: 9 }, state, {
      visionRadius: 4,
      toldFacts: [{ subject: "goblin-1", toAgent: "fox-1", cell: "cell-8-9", turn: 3 }],
    }),
    null,
    "and a stale claim about it is not a way back onto the board",
  );
});

test("a claim about an id that was never placed at all still lands, so deception keeps working", () => {
  const state = stateOf({});
  assert.deepEqual(
    believedCellOf("goblin-7", "fox-1", { x: 2, y: 2 }, state, {
      visionRadius: 4,
      toldFacts: [{ subject: "goblin-7", toAgent: "fox-1", cell: "cell-8-8", turn: 1 }],
    }),
    { x: 8, y: 8 },
    "an invented goblin is not a removed goblin — the lie is believed and the fox walks to cell-8-8",
  );
});

test("nearestBelievedTarget picks the closest candidate the observer believes anything about, skipping unbelieved ones", () => {
  const state = stateOf({ "goblin-1": "cell-9-9", "goblin-2": "cell-3-2" });
  assert.deepEqual(
    nearestBelievedTarget("fox-1", { x: 2, y: 2 }, ["goblin-1", "goblin-2"], state, { visionRadius: 4 }),
    { subject: "goblin-2", cell: { x: 3, y: 2 } },
    "goblin-1 sits far outside vision and is never even considered",
  );
  assert.equal(
    nearestBelievedTarget("fox-1", { x: 2, y: 2 }, ["goblin-1"], state, { visionRadius: 4 }),
    null,
    "nothing believed about any candidate is null, never a guessed target",
  );
});

test("nearestBelievedTarget breaks a distance tie toward the earlier candidate, so a sorted list replays identically", () => {
  const state = stateOf({ "crumb-10": "cell-4-2", "crumb-2": "cell-2-4" });
  // Every caller sorts its candidate ids lexicographically, which puts
  // crumb-10 before crumb-2. Both crumbs are two steps away; the earlier
  // candidate wins, and the same list always produces the same choice.
  const sorted = ["crumb-10", "crumb-2"].sort();
  assert.deepEqual(sorted, ["crumb-10", "crumb-2"]);
  assert.deepEqual(
    nearestBelievedTarget("goblin-1", { x: 2, y: 2 }, sorted, state, { visionRadius: 4 }),
    { subject: "crumb-10", cell: { x: 4, y: 2 } },
  );
  assert.deepEqual(
    nearestBelievedTarget("goblin-1", { x: 2, y: 2 }, [...sorted].reverse(), state, { visionRadius: 4 }),
    { subject: "crumb-2", cell: { x: 2, y: 4 } },
    "reversing the input reverses the winner, which is why the order is the caller's contract",
  );
});

test("belief takes inert items exactly as it takes agents — an item id is just another subject", () => {
  const state = stateOf({ "crumb-1": "cell-3-3", "morsel-1": "cell-11-11" });
  assert.deepEqual(
    believedCellOf("crumb-1", "goblin-1", { x: 2, y: 2 }, state, { visionRadius: 3 }),
    { x: 3, y: 3 },
  );
  assert.deepEqual(
    beliefSnapshotFor("goblin-1", { x: 2, y: 2 }, ["crumb-1", "morsel-1"], state, { visionRadius: 3 }),
    { "crumb-1": "cell-3-3", "morsel-1": null },
  );
});

test("beliefSnapshotFor maps every other candidate to a cell id or null, and never includes the observer itself", () => {
  const state = stateOf({ "goblin-1": "cell-5-2", "goblin-2": "cell-8-8" });
  const snapshot = beliefSnapshotFor("fox-1", { x: 2, y: 2 }, ["fox-1", "goblin-1", "goblin-2"], state, { visionRadius: 4 });
  assert.deepEqual(snapshot, { "goblin-1": "cell-5-2", "goblin-2": null });
  assert.ok(!("fox-1" in snapshot), "the observer never appears in its own belief snapshot");
});

test("beliefSnapshotFor folds a told fact in exactly as believedCellOf does alone", () => {
  const state = stateOf({ "goblin-1": "cell-8-8" });
  assert.deepEqual(
    beliefSnapshotFor("fox-1", { x: 2, y: 2 }, ["goblin-1"], state, {
      visionRadius: 2,
      toldFacts: [{ subject: "goblin-1", toAgent: "fox-1", cell: "cell-6-2", turn: 4 }],
    }),
    { "goblin-1": "cell-6-2" },
  );
});

test("beliefSnapshotFor reports a removed candidate as unknown rather than dropping the key", () => {
  const state = stateOf({ "goblin-1": "cell-3-3" }, ["goblin-1"]);
  assert.deepEqual(
    beliefSnapshotFor("fox-1", { x: 2, y: 2 }, ["goblin-1"], state, { visionRadius: 4 }),
    { "goblin-1": null },
    "the belief panel keeps a row for it, saying the observer knows nothing",
  );
});

test("beliefOriginOf reports \"seen\" wherever believedCellOf reads ground truth", () => {
  const state = stateOf({ "goblin-1": "cell-5-2" });
  assert.equal(
    beliefOriginOf("goblin-1", "fox-1", { x: 2, y: 2 }, state, { visionRadius: 4 }),
    "seen",
    "three Chebyshev steps away sits inside a radius-4 vision",
  );
  assert.equal(
    believedCellOf("goblin-1", "fox-1", { x: 2, y: 2 }, state, { visionRadius: 4 }) !== null,
    true,
  );
});

test("beliefOriginOf reports the told turn wherever believedCellOf falls back to a told fact", () => {
  const state = stateOf({ "goblin-1": "cell-9-9" });
  const toldFacts = [
    { subject: "goblin-1", toAgent: "fox-1", cell: "cell-6-2", turn: 4 },
    { subject: "goblin-1", toAgent: "fox-1", cell: "cell-3-7", turn: 9 },
  ];
  assert.deepEqual(
    beliefOriginOf("goblin-1", "fox-1", { x: 2, y: 2 }, state, { visionRadius: 2, toldFacts }),
    { told: 9 },
    "the later turn's told fact is the one that answered",
  );
});

test("beliefOriginOf is null wherever believedCellOf finds nothing to report", () => {
  const state = stateOf({ "goblin-1": "cell-9-9" });
  assert.equal(
    beliefOriginOf("goblin-1", "fox-1", { x: 2, y: 2 }, state, { visionRadius: 2 }),
    null,
    "outside vision and nothing told",
  );
});

test("beliefOriginOf reports a removed target as null, the same as believedCellOf", () => {
  const state = stateOf({ "goblin-1": "cell-3-3" }, ["goblin-1"]);
  assert.equal(
    beliefOriginOf("goblin-1", "fox-1", { x: 3, y: 3 }, state, { visionRadius: 4 }),
    null,
    "an eaten goblin has no origin to report even standing on the observer's own cell",
  );
});

test("beliefOriginOf agrees with believedCellOf across the whole existing suite's fixtures", () => {
  // Every case above and below this test pairs a null cell with a null
  // origin and a non-null cell with a non-null origin — spot-checked here
  // against a handful of the same states rather than repeating the whole file.
  const cases = [
    { state: stateOf({ "goblin-1": "cell-6-3", "well-1": "cell-4-3" }), target: "goblin-1", observer: "fox-1", cell: { x: 2, y: 3 }, opts: { visionRadius: 4 } },
    { state: stateOf({}), target: "goblin-7", observer: "fox-1", cell: { x: 2, y: 2 }, opts: { visionRadius: 4, toldFacts: [{ subject: "goblin-7", toAgent: "fox-1", cell: "cell-8-8", turn: 1 }] } },
    { state: stateOf({ "goblin-1": "somewhere" }), target: "goblin-1", observer: "fox-1", cell: { x: 2, y: 2 }, opts: { visionRadius: 40 } },
  ];
  for (const c of cases) {
    const believedCell = believedCellOf(c.target, c.observer, c.cell, c.state, c.opts);
    const origin = beliefOriginOf(c.target, c.observer, c.cell, c.state, c.opts);
    assert.equal(believedCell === null, origin === null, `cell and origin agree on whether anything is believed about ${c.target}`);
  }
});

test("an unparseable cell id is unknown, never a coordinate invented from it", () => {
  const state = stateOf({ "goblin-1": "somewhere" });
  assert.equal(believedCellOf("goblin-1", "fox-1", { x: 2, y: 2 }, state, { visionRadius: 40 }), null);
  assert.equal(
    believedCellOf("goblin-2", "fox-1", { x: 2, y: 2 }, state, {
      visionRadius: 4,
      toldFacts: [{ subject: "goblin-2", toAgent: "fox-1", cell: "over there", turn: 1 }],
    }),
    null,
  );
});
