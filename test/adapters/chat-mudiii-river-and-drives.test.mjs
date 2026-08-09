// The two chat surfaces the mudiii family reaches past its three grid
// layouts: the closed opener that loads the layout-less river-crossing puzzle
// world, and the ask templates over the agent-trait rows the actor card's own
// sentence table reads and writes. Both run through a real session so the
// plan slot threads turn to turn exactly as the shell drives it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runTurn } from "../../src/services/chat.mjs";
import { appendFacts } from "../../src/adapters/memory/core.mjs";
import { driveSessionTurns, stripGoalLine } from "../helpers/session.mjs";

async function freshRepo() {
  return mkdtemp(join(tmpdir(), "tmct-mudiii-river-"));
}

/** Drive `lines` through one session rooted in a throwaway repo, with the
 *  goal/canonical trailers stripped so every assertion reads the answer body. */
async function say(lines) {
  const dir = await freshRepo();
  try {
    return await driveSessionTurns({ repoPath: dir }, lines, { strip: stripGoalLine });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("the river-crossing opener loads the puzzle world and names where the whole party stands", async () => {
  const [opened] = await say(["open the river crossing"]);
  assert.match(opened.answer, /a farmer stands on the east bank/);
  assert.match(opened.answer, /^on bank-east: cabbage-1, farmer-1, fox-1, goat-1\.$/m);
});

test("every sibling in the river opener vocabulary opens the same world", async () => {
  const lines = [
    "start the river crossing",
    "solve the river crossing puzzle",
    "let's open the river crossing",
    "begin the river crossing game",
    "watch the river",
  ];
  for (const line of lines) {
    const [opened] = await say([line]);
    assert.match(opened.answer, /^on bank-east: cabbage-1, farmer-1, fox-1, goat-1\.$/m, `opener: ${line}`);
  }
});

test("the three grid layouts keep their own openers and their own opening lines", async () => {
  const cases = [
    ["visit the town square", /a fox prowls the town square/],
    ["watch the market day", /market day in the town square/],
    ["visit the chapel corner", /chapel corner/],
  ];
  for (const [line, expected] of cases) {
    const [opened] = await say([line]);
    assert.match(opened.answer, expected, `opener: ${line}`);
  }
});

test("the opening arrangement prunes to the one crossing the drive facts leave legal", async () => {
  const [, options] = await say(["open the river crossing", "what can I do?"]);
  assert.match(options.answer, /^one crossing is legal from here: ferry goat-1 onto bank-west\./);
});

test("the puzzle's goal aside composes both constraints from the world's own consumes and guards rows", async () => {
  const [, goal] = await say(["open the river crossing", "what is the goal?"]);
  assert.match(goal.answer, /ferry every passenger onto bank-west/);
  assert.match(goal.answer, /never leave fox alone with goat unless farmer is there/);
  assert.match(goal.answer, /never leave goat alone with cabbage unless farmer is there/);
});

test("a town-square board verb on the puzzle world declines by name rather than answering against nothing", async () => {
  const [, food] = await say(["open the river crossing", "put food at cell-3-4"]);
  assert.equal(food.record.miss, true);
  assert.match(food.answer, /has no grid and nobody to address/);
});

test("closing the puzzle frees the slot and the same opener works again", async () => {
  const [, closed, reopened] = await say([
    "open the river crossing", "stop watching", "open the river crossing",
  ]);
  assert.match(closed.answer, /puzzle closes here/);
  assert.match(reopened.answer, /^on bank-east: cabbage-1, farmer-1, fox-1, goat-1\.$/m);
});

test("a drive ask answers from the stored row and cites it, in both directions", async () => {
  const [, forward, inverse] = await say([
    "open the river crossing", "who does the cabbage evade", "who evades the goat",
  ]);
  assert.equal(forward.record.miss, false);
  assert.equal(forward.answer, "goat — cabbage evades goat (source: world:river-crossing).");
  assert.equal(inverse.answer, "cabbage — cabbage evades goat (source: world:river-crossing).");
});

test("an appetite ask reads the same consumes row the crossing constraint is derived from", async () => {
  const [, eats] = await say(["open the river crossing", "what does the fox want to eat"]);
  assert.equal(eats.answer, "goat — fox eats goat (source: world:river-crossing).");
});

test("a drive with several stated objects names every one of them, each cited", async () => {
  const [, guards] = await say(["open the river crossing", "who does the farmer guard"]);
  assert.equal(
    guards.answer,
    "fox, goat — farmer guards fox (source: world:river-crossing); farmer guards goat (source: world:river-crossing).",
  );
});

test("an undeclared drive reads as absent, never as a default inferred from a stated one", async () => {
  const [, pursue] = await say(["open the river crossing", "what does the fox pursue"]);
  assert.equal(pursue.record.miss, true);
  assert.equal(pursue.answer, "nothing on record says what fox pursues.");
});

test("an inverse ask about a term no row states the predicate of stays a miss", async () => {
  const [, guarded] = await say(["open the river crossing", "who guards the cabbage"]);
  assert.equal(guarded.record.miss, true);
  assert.equal(guarded.answer, "nothing on record says who guards cabbage.");
});

test("an ask about an instance says which class answered when the instance states nothing itself", async () => {
  const [, inherited] = await say(["open the river crossing", "what does fox-1 eat"]);
  assert.equal(inherited.answer, "goat — from fox-1's fox class: fox eats goat (source: world:river-crossing).");
});

test("the town square's own numbers read back through the same table", async () => {
  const [, mass, vision, drain, pursues] = await say([
    "visit the town square",
    "how much does the goblin weigh",
    "how far can the fox see",
    "how much does the goblin lose each turn",
    "what does the fox pursue",
  ]);
  assert.equal(mass.answer, "8 — goblin weighs 8 (source: world:town-square).");
  assert.equal(vision.answer, "4 — fox sees 4 cells (source: world:town-square).");
  assert.equal(drain.answer, "0.06 — goblin loses 0.06 each turn (source: world:town-square).");
  assert.equal(pursues.answer, "goblin — fox pursues goblin (source: world:town-square).");
});

test("the drive ask is its own lane, and needs no game open to read the rows", async () => {
  const dir = await freshRepo();
  try {
    await appendFacts(dir, [
      { subject: "wolf", predicate: "mgx:consumes", object: "goat", provenance: "test:pen" },
    ]);
    const r = await runTurn("what does the wolf eat", { config: null, memoryDir: dir });
    assert.equal(r.lane, "ask-agent-trait");
    assert.equal(r.record.miss, false);
    assert.match(r.answer, /^goat — wolf eats goat \(source: test:pen\)\./);
    assert.equal(r.detail.matches.length, 1);
    assert.equal(r.detail.matches[0].predicate, "mgx:consumes");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a store holding no agent traits at all leaves the question to the lanes that owned it", async () => {
  const [cold] = await say(["what does the fox eat"]);
  assert.equal(cold.lane, undefined);
  assert.doesNotMatch(cold.answer, /nothing on record says/);
});
