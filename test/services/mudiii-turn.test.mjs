// mudiii-turn.test.mjs — direct unit coverage for mudiiiTurn's own gameConfig
// threading, the three layout openers, the exclusivity declines against the
// other lanes sharing planState's slot, the addressed teach-frame (agents and
// the food channel spider-fly has no equivalent of), the food-placement verb,
// the belief and orientation asides, and pillsForMudiii — all driven through
// the lane function directly rather than the full chat session/corpus lane
// (the games/mudiii corpus lane covers end-to-end wiring once chat.mjs
// dispatches to this lane).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  mudiiiTurn, pillsForMudiii, oneStepDirectionBetween, believedFactSentence,
  parseTownSquareTeachLine, planTaughtTownSquareTriple, townSquareTeachConfirmation,
} from "../../src/services/mudiii-turn.mjs";
import { DEFAULT_GAME_CONFIG } from "../../src/domain/game-config.mjs";
import { loadMemory, readFactRows, appendFacts } from "../../src/adapters/memory/core.mjs";

async function withMemoryDir(prefix, fn) {
  const memoryDir = await mkdtemp(join(tmpdir(), prefix));
  try {
    return await fn(memoryDir);
  } finally {
    await rm(memoryDir, { recursive: true, force: true });
  }
}

// ---- opening moves, one per shipped layout ----------------------------------

test("mudiiiTurn's opening move threads a custom gameConfig into startTownSquareGame's own written facts", () => withMemoryDir("tmct-mudiii-turn-config-", async (memoryDir) => {
  const gameConfig = {
    ...DEFAULT_GAME_CONFIG,
    mudiii: { ...DEFAULT_GAME_CONFIG.mudiii, predatorInitialMass: 99 },
  };
  const planHolder = { state: null };
  const result = await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {}, gameConfig });
  assert.ok(result, "the opener is claimed by the mudiii lane");

  const rows = readFactRows(await loadMemory(memoryDir));
  assert.ok(
    rows.some((r) => r.subject === "fox-1@turn0" && r.predicate === "mgx:hasMass" && r.object === "99"),
    "the custom predatorInitialMass reaches the freshly-started game's own written facts",
  );
}));

test("mudiiiTurn defaults to DEFAULT_GAME_CONFIG when no gameConfig is passed", () => withMemoryDir("tmct-mudiii-turn-default-", async (memoryDir) => {
  const planHolder = { state: null };
  const result = await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
  assert.ok(result);
  const rows = readFactRows(await loadMemory(memoryDir));
  assert.ok(
    rows.some((r) => r.subject === "fox-1@turn0" && r.predicate === "mgx:hasMass" && r.object === String(DEFAULT_GAME_CONFIG.mudiii.predatorInitialMass)),
    "with no gameConfig override, the shipped default predatorInitialMass is what lands in the store",
  );
}));

test("visit the town square: the headline layout's own opening line, and neither cast member is the player's", () => withMemoryDir("tmct-mudiii-turn-open-headline-", async (memoryDir) => {
  const planHolder = { state: null };
  const result = await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
  assert.match(result.text, /fox prowls the town square/i);
  assert.match(result.text, /Neither is yours to move/i);
  assert.equal(planHolder.state.mudiii.world, "town-square");
}));

test("watch the fox and the goblins: the role-named alias for the headline layout", () => withMemoryDir("tmct-mudiii-turn-open-alias-", async (memoryDir) => {
  const planHolder = { state: null };
  const result = await mudiiiTurn("watch the fox and the goblins", { planHolder, memoryDir, env: {} });
  assert.ok(result);
  assert.equal(planHolder.state.mudiii.world, "town-square");
}));

test("visit the market square / watch the market day: the market layout's own opener and opening line", () => withMemoryDir("tmct-mudiii-turn-open-market-", async (memoryDir) => {
  const planHolder = { state: null };
  const result = await mudiiiTurn("watch the market day", { planHolder, memoryDir, env: {} });
  assert.match(result.text, /market day in the town square/i);
  assert.equal(planHolder.state.mudiii.world, "town-square-market");
}));

test("visit the chapel corner: the chapel layout's own opener and opening line, with two foxes", () => withMemoryDir("tmct-mudiii-turn-open-chapel-", async (memoryDir) => {
  const planHolder = { state: null };
  const result = await mudiiiTurn("visit the chapel corner", { planHolder, memoryDir, env: {} });
  assert.match(result.text, /chapel corner/i);
  assert.equal(planHolder.state.mudiii.world, "town-square-chapel");
  const rows = readFactRows(await loadMemory(memoryDir));
  assert.ok(rows.some((r) => r.subject === "fox-2"), "the chapel layout casts two foxes");
}));

test("play mudiii: not this lane's opener at all — stays unclaimed so chat's own last-resort decline can name it", () => withMemoryDir("tmct-mudiii-turn-play-mudiii-", async (memoryDir) => {
  const planHolder = { state: null };
  const result = await mudiiiTurn("play mudiii", { planHolder, memoryDir, env: {} });
  assert.equal(result, null, "the bare word \"mudiii\" is deliberately not in this lane's opener vocabulary");
}));

test("a second opener mid-game declines and the running game stands", () => withMemoryDir("tmct-mudiii-turn-open-twice-", async (memoryDir) => {
  const planHolder = { state: null };
  await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
  const result = await mudiiiTurn("visit the chapel corner", { planHolder, memoryDir, env: {} });
  assert.match(result.text, /already running/i);
  assert.equal(planHolder.state.mudiii.world, "town-square", "the running world never switched underneath the decline");
}));

// ---- exclusivity: the shared plan slot holds one thing at a time ------------

test("an opener arriving mid-number-game / mid-adventure / mid-spider-fly-game is declined by name and the other lane's state stands", () => withMemoryDir("tmct-mudiii-turn-exclusive-", async (memoryDir) => {
  const cases = [
    [{ game: { lo: 1, hi: 100 } }, /guess-the-number game is active/i],
    [{ adventure: { world: "ashcombe-hall" } }, /an adventure is running/i],
    [{ spiderFly: { turn: 0 } }, /spider-and-fly game is running/i],
  ];
  for (const [state, expected] of cases) {
    const planHolder = { state };
    const result = await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
    assert.match(result.text, expected);
    assert.deepEqual(planHolder.state, state, "the sibling lane's own state is untouched");
  }
}));

test("an opener arriving while a plan frame holds the slot is declined by name and the plan survives", () => withMemoryDir("tmct-mudiii-turn-plan-active-", async (memoryDir) => {
  const state = { goals: [{ predicate: "on", subject: "disk-1", object: "peg-b" }], actions: [] };
  const planHolder = { state };
  const result = await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
  assert.match(result.text, /a plan is in progress/i);
  assert.deepEqual(planHolder.state, state);
}));

test("without a live mudiii game, a bare line that is not an opener returns null (not this lane's turn)", () => withMemoryDir("tmct-mudiii-turn-pregame-null-", async (memoryDir) => {
  const planHolder = { state: null };
  const result = await mudiiiTurn("tick", { planHolder, memoryDir, env: {} });
  assert.equal(result, null);
}));

// ---- stop --------------------------------------------------------------------

test("stop watching ends the game and says the board's facts stay remembered", () => withMemoryDir("tmct-mudiii-turn-stop-", async (memoryDir) => {
  const planHolder = { state: null };
  await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
  const result = await mudiiiTurn("stop watching", { planHolder, memoryDir, env: {} });
  assert.match(result.text, /town square game ends here/i);
  assert.match(result.text, /stays remembered/i);
  assert.equal(planHolder.state, null);
}));

// ---- tick ----------------------------------------------------------------

test("the bare tick command advances one turn, moving the cast on their own", () => withMemoryDir("tmct-mudiii-turn-tick-", async (memoryDir) => {
  const planHolder = { state: null };
  await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
  const result = await mudiiiTurn("tick", { planHolder, memoryDir, env: {} });
  assert.match(result.text, /^Turn 1 —/);
  assert.match(result.text, /fox-1 is now at cell-\d+-\d+/);
  assert.equal(planHolder.state.mudiii.turn, 1);
}));

test("next turn / advance are recognized aliases for tick", () => withMemoryDir("tmct-mudiii-turn-tick-aliases-", async (memoryDir) => {
  const planHolder = { state: null };
  await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
  const r1 = await mudiiiTurn("next turn", { planHolder, memoryDir, env: {} });
  assert.match(r1.text, /^Turn 1 —/);
  const r2 = await mudiiiTurn("advance", { planHolder, memoryDir, env: {} });
  assert.match(r2.text, /^Turn 2 —/);
}));

// ---- the addressed teach-frame: agents and the food channel -----------------

async function openGameAt(memoryDir, { foxCell, goblinCell }) {
  const planHolder = { state: null };
  await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
  await appendFacts(memoryDir, [
    { subject: "fox-1@turn1", predicate: "mgx:currently-in", object: foxCell, provenance: "test:mudiii-turn" },
    { subject: "goblin-1@turn1", predicate: "mgx:currently-in", object: goblinCell, provenance: "test:mudiii-turn" },
  ]);
  return planHolder;
}

test("an addressed spatial told-fact changes the addressee's belief on the very next tick", () => withMemoryDir("tmct-mudiii-turn-teach-", async (memoryDir) => {
  const planHolder = await openGameAt(memoryDir, { foxCell: "cell-2-2", goblinCell: "cell-9-9" });
  const result = await mudiiiTurn("@fox the goblin is east", { planHolder, memoryDir, env: {} });
  assert.match(result.text, /told the fox-1 the goblin-1 is at cell-3-2/);
  assert.match(result.text, /fox-1 is now at cell-3-2/, "the fox believed the told position and moved onto it");
}));

test("the told-fact channel extends to food: \"@goblin the crumb is at cell-x-y\" is read the same as an agent claim", () => withMemoryDir("tmct-mudiii-turn-teach-food-", async (memoryDir) => {
  const planHolder = { state: null };
  await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
  await appendFacts(memoryDir, [
    { subject: "goblin-1@turn1", predicate: "mgx:currently-in", object: "cell-6-6", provenance: "test:mudiii-turn" },
    { subject: "crumb-9", predicate: "rdf:type", object: "crumb", provenance: "test:mudiii-turn" },
    { subject: "crumb-9@turn1", predicate: "mgx:currently-in", object: "cell-6-7", provenance: "test:mudiii-turn" },
  ]);
  const result = await mudiiiTurn("@goblin the crumb is at cell-6-7", { planHolder, memoryDir, env: {} });
  assert.match(result.text, /told the goblin-1 the crumb-9 is at cell-6-7/);
}));

test("a told cell off the board and a bare address with no readable position both decline honestly rather than guessing", () => withMemoryDir("tmct-mudiii-turn-teach-declines-", async (memoryDir) => {
  const planHolder = { state: null };
  await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
  const offBoard = await mudiiiTurn("@fox the goblin is at cell-99-99", { planHolder, memoryDir, env: {} });
  assert.match(offBoard.text, /falls off the edge of the 12x12 board/);
  assert.equal(offBoard.miss, true);
  const bareAddress = await mudiiiTurn("@fox hello there", { planHolder, memoryDir, env: {} });
  assert.match(bareAddress.text, /couldn't read a position from that/);
  assert.equal(bareAddress.miss, true);
}));

test("addressing an agent that isn't on the board declines by name rather than guessing", () => withMemoryDir("tmct-mudiii-turn-teach-no-such-agent-", async (memoryDir) => {
  const planHolder = { state: null };
  await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
  const result = await mudiiiTurn("@fox-9 the goblin is east", { planHolder, memoryDir, env: {} });
  assert.match(result.text, /no live fox on the board to address/);
  assert.equal(result.miss, true);
}));

// ---- the food verb ---------------------------------------------------------

test("put food at cell-x-y places a morsel and confirms, without running a tick", () => withMemoryDir("tmct-mudiii-turn-food-put-", async (memoryDir) => {
  const planHolder = { state: null };
  await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
  const result = await mudiiiTurn("put food at cell-3-4", { planHolder, memoryDir, env: {} });
  assert.match(result.text, /a morsel now sits at cell-3-4/);
  assert.equal(result.miss, undefined);
  assert.equal(planHolder.state.mudiii.turn, 0, "placing food does not itself advance the turn counter");
  const rows = readFactRows(await loadMemory(memoryDir));
  assert.ok(rows.some((r) => r.predicate === "mgx:placed-by" && r.object === "player"), "provenance names the player as the one who placed it");
}));

test("drop a morsel at cell-x-y: the secondary alias, free while the mudiii game alone holds the slot", () => withMemoryDir("tmct-mudiii-turn-food-drop-", async (memoryDir) => {
  const planHolder = { state: null };
  await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
  const result = await mudiiiTurn("drop a morsel at cell-5-5", { planHolder, memoryDir, env: {} });
  assert.match(result.text, /a morsel now sits at cell-5-5/);
}));

test("food placement on a blocked (prop) cell is refused with a reason", () => withMemoryDir("tmct-mudiii-turn-food-blocked-", async (memoryDir) => {
  const planHolder = { state: null };
  await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
  const result = await mudiiiTurn("put food at cell-8-1", { planHolder, memoryDir, env: {} }); // house-1 sits here
  assert.match(result.text, /cell-8-1 is blocked/);
  assert.equal(result.miss, true);
}));

test("food placement off the board is refused with a reason naming the board's own extent", () => withMemoryDir("tmct-mudiii-turn-food-offboard-", async (memoryDir) => {
  const planHolder = { state: null };
  await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
  const result = await mudiiiTurn("put food at cell-99-99", { planHolder, memoryDir, env: {} });
  assert.match(result.text, /off the board — this square runs cell-1-1 to cell-12-12/);
  assert.equal(result.miss, true);
}));

test("food placement on a cell already holding an item is refused, naming what's already there", () => withMemoryDir("tmct-mudiii-turn-food-occupied-", async (memoryDir) => {
  const planHolder = { state: null };
  await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
  await mudiiiTurn("put food at cell-3-4", { planHolder, memoryDir, env: {} });
  const result = await mudiiiTurn("put food at cell-3-4", { planHolder, memoryDir, env: {} });
  assert.match(result.text, /cell-3-4 already holds morsel-1/);
  assert.equal(result.miss, true);
}));

test("food placement on a cell an animal is standing on is ALLOWED — dropping a morsel at a predator's feet is the trap", () => withMemoryDir("tmct-mudiii-turn-food-on-agent-", async (memoryDir) => {
  const planHolder = await openGameAt(memoryDir, { foxCell: "cell-6-6", goblinCell: "cell-1-1" });
  const result = await mudiiiTurn("put food at cell-6-6", { planHolder, memoryDir, env: {} });
  assert.match(result.text, /a morsel now sits at cell-6-6/);
  assert.equal(result.miss, undefined, "an occupied-by-an-animal cell is not a decline — that's the whole mechanic");
}));

test("the food verb is not recognized outside a live mudiii game", () => withMemoryDir("tmct-mudiii-turn-food-pregame-", async (memoryDir) => {
  const planHolder = { state: null };
  const result = await mudiiiTurn("put food at cell-3-4", { planHolder, memoryDir, env: {} });
  assert.equal(result, null);
}));

// ---- the observable-facts read: "what does the goblin see?" -----------------

test("what does the fox see?: a goblin within vision radius reads as observed, at its real cell", () => withMemoryDir("tmct-mudiii-turn-see-near-", async (memoryDir) => {
  const planHolder = await openGameAt(memoryDir, { foxCell: "cell-5-5", goblinCell: "cell-6-5" });
  const result = await mudiiiTurn("what does the fox see?", { planHolder, memoryDir, env: {} });
  assert.match(result.text, /fox-1 sees:/);
  assert.match(result.text, /goblin-1 is at cell-6-5\./);
}));

test("what does the goblin see?: a fox beyond vision radius reads as not observed — belief, never ground truth", () => withMemoryDir("tmct-mudiii-turn-see-far-", async (memoryDir) => {
  const planHolder = await openGameAt(memoryDir, { foxCell: "cell-1-1", goblinCell: "cell-12-12" });
  const result = await mudiiiTurn("what does the goblin see?", { planHolder, memoryDir, env: {} });
  assert.match(result.text, /goblin-1 sees:/);
  assert.match(result.text, /fox-1 has not been observed\./);
}));

test("what does the goblin see?: read-only — no tick runs, the turn counter is untouched", () => withMemoryDir("tmct-mudiii-turn-see-readonly-", async (memoryDir) => {
  const planHolder = await openGameAt(memoryDir, { foxCell: "cell-5-5", goblinCell: "cell-5-6" });
  const before = readFactRows(await loadMemory(memoryDir)).length;
  await mudiiiTurn("what does the goblin see?", { planHolder, memoryDir, env: {} });
  const after = readFactRows(await loadMemory(memoryDir)).length;
  assert.equal(after, before, "no new facts were written by a see-question");
  assert.equal(planHolder.state.mudiii.turn, 0);
}));

test("what does the crab see?: an unrecognized kind never matches", () => withMemoryDir("tmct-mudiii-turn-see-crab-", async (memoryDir) => {
  const planHolder = await openGameAt(memoryDir, { foxCell: "cell-5-5", goblinCell: "cell-5-6" });
  const result = await mudiiiTurn("what does the crab see?", { planHolder, memoryDir, env: {} });
  assert.equal(result, null);
}));

// ---- the provenance read: "who put that there?" -----------------------------

test("who put morsel-1 there?: names the player who placed it", () => withMemoryDir("tmct-mudiii-turn-who-placed-item-", async (memoryDir) => {
  const planHolder = { state: null };
  await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
  await mudiiiTurn("put food at cell-3-4", { planHolder, memoryDir, env: {} });
  const result = await mudiiiTurn("who put morsel-1 there?", { planHolder, memoryDir, env: {} });
  assert.match(result.text, /player put morsel-1 at cell-3-4/);
  assert.equal(result.miss, undefined);
}));

test("who placed food at cell-3-4?: the same read, addressed by cell instead of item id", () => withMemoryDir("tmct-mudiii-turn-who-placed-cell-", async (memoryDir) => {
  const planHolder = { state: null };
  await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
  await mudiiiTurn("put food at cell-3-4", { planHolder, memoryDir, env: {} });
  const result = await mudiiiTurn("who placed food at cell-3-4?", { planHolder, memoryDir, env: {} });
  assert.match(result.text, /player put morsel-1 at cell-3-4/);
  assert.equal(result.miss, undefined);
}));

test("who put crumb-9 there?: spawned food carries no placedBy row, so the lane declines rather than guessing", () => withMemoryDir("tmct-mudiii-turn-who-placed-spawned-", async (memoryDir) => {
  const planHolder = { state: null };
  await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
  await appendFacts(memoryDir, [
    { subject: "crumb-9", predicate: "rdf:type", object: "crumb", provenance: "test:mudiii-turn" },
    { subject: "crumb-9@turn1", predicate: "mgx:currently-in", object: "cell-6-7", provenance: "test:mudiii-turn" },
  ]);
  const result = await mudiiiTurn("who put crumb-9 there?", { planHolder, memoryDir, env: {} });
  assert.match(result.text, /crumb-9 was never placed/);
  assert.equal(result.miss, true);
}));

test("who put morsel-4 there?: an item id not on the board declines by name rather than guessing", () => withMemoryDir("tmct-mudiii-turn-who-placed-missing-item-", async (memoryDir) => {
  const planHolder = { state: null };
  await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
  const result = await mudiiiTurn("who put morsel-4 there?", { planHolder, memoryDir, env: {} });
  assert.match(result.text, /no live morsel on the board/);
  assert.equal(result.miss, true);
}));

test("who put food at cell-9-9?: an empty cell declines rather than guessing", () => withMemoryDir("tmct-mudiii-turn-who-placed-empty-cell-", async (memoryDir) => {
  const planHolder = { state: null };
  await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
  const result = await mudiiiTurn("who put food at cell-9-9?", { planHolder, memoryDir, env: {} });
  assert.match(result.text, /no food at cell-9-9/);
  assert.equal(result.miss, true);
}));

test("who is the fox?: an unrelated who-question is not captured by the who-placed recognizer", () => withMemoryDir("tmct-mudiii-turn-who-placed-unrelated-", async (memoryDir) => {
  const planHolder = { state: null };
  await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
  const result = await mudiiiTurn("who is the fox?", { planHolder, memoryDir, env: {} });
  assert.equal(result, null);
}));

// ---- orientation asides -------------------------------------------------

test("where is the goblin / where am I / what can I do / what is the goal — the live board's own orientation asides", () => withMemoryDir("tmct-mudiii-turn-asides-", async (memoryDir) => {
  const planHolder = { state: null };
  await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
  const ask = (line) => mudiiiTurn(line, { planHolder, memoryDir, env: {} });

  const where = await ask("where is the goblin?");
  assert.match(where.text, /goblin-\d+ at cell-\d+-\d+/);

  const whereMe = await ask("where am I?");
  assert.match(whereMe.text, /no piece here/i);

  const options = await ask("what can I do?");
  assert.match(options.text, /tick/i);
  assert.match(options.text, /@fox/i);
  assert.match(options.text, /put food/i);

  const goal = await ask("what is the goal?");
  assert.match(goal.text, /fox hunts the goblins/i);
}));

test("what is the fox's goal? / what is the goal of the goblin?: role-specific objectives", () => withMemoryDir("tmct-mudiii-turn-goal-agent-", async (memoryDir) => {
  const planHolder = { state: null };
  await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
  const foxGoal = await mudiiiTurn("what is the fox's goal?", { planHolder, memoryDir, env: {} });
  assert.match(foxGoal.text, /fox hunts goblins for their mass/i);
  const goblinGoal = await mudiiiTurn("what is the goal of the goblin?", { planHolder, memoryDir, env: {} });
  assert.match(goblinGoal.text, /goblins forage for crumbs and morsels/i);
}));

test("an unaddressed plain question falls through to the ordinary lanes, board untouched", () => withMemoryDir("tmct-mudiii-turn-fallthrough-", async (memoryDir) => {
  const planHolder = { state: null };
  await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
  const result = await mudiiiTurn("what is the capital of France", { planHolder, memoryDir, env: {} });
  assert.equal(result, null);
}));

// ---- the teach lane --------------------------------------------------------

const TEACH_ON = { ...DEFAULT_GAME_CONFIG, mudiii: { ...DEFAULT_GAME_CONFIG.mudiii, teach: true } };

// The shape world-teach.mjs's own confirmation() writes: "noted — <claim> now."
const CONFIRMATION_SHAPE = /^noted — .+ now\.$/;

test("the town-square sentence table reads each of its five predicates, and nothing outside it", () => {
  assert.deepEqual(parseTownSquareTeachLine("Fox-1 is at cell-3-4."), {
    kind: "placement", predicate: "mgx:currently-in", kindWord: "fox", num: "1", object: "cell-3-4",
  });
  assert.deepEqual(parseTownSquareTeachLine("the goblin weighs 4.5"), {
    kind: "mass", predicate: "mgx:hasMass", kindWord: "goblin", num: null, object: "4.5",
  });
  assert.deepEqual(parseTownSquareTeachLine("The fox feels angry."), {
    kind: "mood", predicate: "mgx:feels", kindWord: "fox", num: null, object: "angry",
  });
  assert.deepEqual(parseTownSquareTeachLine("Goblin-2 faces north."), {
    kind: "facing", predicate: "mgx:facing", kindWord: "goblin", num: "2", object: "north",
  });
  assert.deepEqual(parseTownSquareTeachLine("The baker put morsel-1 there."), {
    kind: "placed-by", predicate: "mgx:placed-by", kindWord: "morsel", num: "1", object: "baker",
  });

  assert.equal(parseTownSquareTeachLine("the fox feels peckish."), null, "a mood outside the engine's own four words does not parse");
  assert.equal(parseTownSquareTeachLine("the fox faces up."), null, "a direction the grid has no delta for does not parse");
  assert.equal(parseTownSquareTeachLine("the well is at cell-6-7."), null, "scenery is not teachable — moving a prop would leave every exit fact stale");
  assert.equal(parseTownSquareTeachLine("the crumb feels happy."), null, "an inert item has no mood to teach");
  assert.equal(parseTownSquareTeachLine("@fox the goblin is east"), null, "the addressed teach-frame keeps its own recognizer");
});

test("planTaughtTownSquareTriple appends a differing fact and nothing at all for one the board already holds", () => {
  const state = {
    placements: new Map([["fox-1", { cell: "cell-2-2" }]]),
    mass: new Map([["goblin-1", { value: 8 }]]),
    mood: new Map(), facing: new Map(), placedBy: new Map([["morsel-1", { by: "player" }]]),
  };
  const moved = planTaughtTownSquareTriple(state, { subject: "fox-1", predicate: "mgx:currently-in", object: "cell-5-5", kind: "placement" });
  assert.equal(moved.toAppend.length, 1);
  assert.match(moved.reason, /fox-1 moves from cell-2-2 to cell-5-5/);

  const same = planTaughtTownSquareTriple(state, { subject: "fox-1", predicate: "mgx:currently-in", object: "cell-2-2", kind: "placement" });
  assert.deepEqual(same.toAppend, []);
  assert.match(same.reason, /already stands at cell-2-2/);

  const sameMass = planTaughtTownSquareTriple(state, { subject: "goblin-1", predicate: "mgx:hasMass", object: "8", kind: "mass" });
  assert.deepEqual(sameMass.toAppend, [], "a mass restated as the same number is not a write");

  const firstMood = planTaughtTownSquareTriple(state, { subject: "fox-1", predicate: "mgx:feels", object: "angry", kind: "mood" });
  assert.equal(firstMood.toAppend.length, 1, "a family the board holds nothing for yet is always a write");

  const samePlacer = planTaughtTownSquareTriple(state, { subject: "morsel-1", predicate: "mgx:placed-by", object: "player", kind: "placed-by" });
  assert.deepEqual(samePlacer.toAppend, []);
});

test("townSquareTeachConfirmation says every family back in world-teach's own noted-now shape", () => {
  for (const kind of ["placement", "mass", "mood", "facing", "placed-by"]) {
    const said = townSquareTeachConfirmation({ subject: "fox-1", object: "cell-3-4", kind });
    assert.match(said, CONFIRMATION_SHAPE, `the ${kind} confirmation keeps the shared shape`);
  }
});

test("teach off: a declarative sentence about the board takes the ordinary path, and writes nothing", () => withMemoryDir("tmct-mudiii-turn-teach-off-", async (memoryDir) => {
  const planHolder = { state: null };
  await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {} });
  const before = readFactRows(await loadMemory(memoryDir)).length;

  const result = await mudiiiTurn("Fox-1 is at cell-4-4.", { planHolder, memoryDir, env: {} });
  assert.equal(result, null, "with the switch off the lane never claims the sentence");
  assert.equal(readFactRows(await loadMemory(memoryDir)).length, before, "and nothing reached the store");
}));

test("teach on: the same sentence writes a stamped fact and confirms in world-teach's own shape", () => withMemoryDir("tmct-mudiii-turn-teach-on-", async (memoryDir) => {
  const planHolder = { state: null };
  await mudiiiTurn("visit the town square", { planHolder, memoryDir, env: {}, gameConfig: TEACH_ON });

  const result = await mudiiiTurn("Fox-1 is at cell-4-4.", { planHolder, memoryDir, env: {}, gameConfig: TEACH_ON });
  assert.equal(result.text, "noted — fox-1 is at cell-4-4 now.");
  assert.match(result.text, CONFIRMATION_SHAPE);
  assert.equal(result.miss, false);

  const rows = readFactRows(await loadMemory(memoryDir));
  const written = rows.find((r) => r.subject === "fox-1@turn1" && r.predicate === "mgx:currently-in");
  assert.ok(written, "the placement is stamped at the next tick's own turn, so the fold ranks it above the opening roster");
  assert.equal(written.object, "cell-4-4");
  assert.match(written.provenance, /:taught:turn1$/, "it carries the same taught provenance a placed morsel does");
}));

test("a taught fact changes what the board itself reports back", () => withMemoryDir("tmct-mudiii-turn-teach-observable-", async (memoryDir) => {
  const planHolder = { state: null };
  const ask = (line) => mudiiiTurn(line, { planHolder, memoryDir, env: {}, gameConfig: TEACH_ON });
  await ask("visit the town square");

  await ask("Fox-1 is at cell-4-4.");
  const where = await ask("where is the fox?");
  assert.match(where.text, /fox-1 at cell-4-4/, "the where-aside reads the taught position off the live fold");

  await ask("put food at cell-5-5");
  await ask("The baker put morsel-1 there.");
  const who = await ask("who put morsel-1 there?");
  assert.match(who.text, /baker put morsel-1 at cell-5-5/, "the provenance read names the taught placer, not the player who really placed it");

  await ask("Goblin-1 weighs 3.");
  const seen = readFactRows(await loadMemory(memoryDir));
  assert.ok(seen.some((r) => r.subject === "goblin-1@turn1" && r.predicate === "mgx:hasMass" && r.object === "3"));
}));

test("teach on: re-asserting what the board already holds writes nothing and says so", () => withMemoryDir("tmct-mudiii-turn-teach-restate-", async (memoryDir) => {
  const planHolder = { state: null };
  const ask = (line) => mudiiiTurn(line, { planHolder, memoryDir, env: {}, gameConfig: TEACH_ON });
  await ask("visit the town square");
  await ask("Fox-1 is at cell-4-4.");
  const before = readFactRows(await loadMemory(memoryDir)).length;

  const again = await ask("Fox-1 is at cell-4-4.");
  assert.equal(again.text, "the board already says that.");
  assert.equal(again.miss, false, "restating a true fact is not a miss");
  assert.equal(readFactRows(await loadMemory(memoryDir)).length, before, "and it appends no duplicate row");
}));

test("teach on: a subject nothing live answers to, a cell off the board and a cell inside a building all decline by name", () => withMemoryDir("tmct-mudiii-turn-teach-declines-", async (memoryDir) => {
  const planHolder = { state: null };
  const ask = (line) => mudiiiTurn(line, { planHolder, memoryDir, env: {}, gameConfig: TEACH_ON });
  await ask("visit the town square");

  const noSubject = await ask("Fox-9 is at cell-4-4.");
  assert.match(noSubject.text, /no live fox on the board/);
  assert.equal(noSubject.miss, true);

  const offBoard = await ask("Fox-1 is at cell-99-99.");
  assert.match(offBoard.text, /off the board — this square runs cell-1-1 to cell-12-12/);
  assert.equal(offBoard.miss, true);

  const blocked = await ask("Fox-1 is at cell-8-1."); // house-1 stands here
  assert.match(blocked.text, /cell-8-1 is blocked/);
  assert.equal(blocked.miss, true);

  const rows = readFactRows(await loadMemory(memoryDir));
  assert.ok(!rows.some((r) => r.subject.startsWith("fox-9")), "a declined teach mints nothing the board could not draw");
}));

test("teach on: a question is never read as a claim, however closely it matches the table", () => withMemoryDir("tmct-mudiii-turn-teach-question-", async (memoryDir) => {
  const planHolder = { state: null };
  const ask = (line) => mudiiiTurn(line, { planHolder, memoryDir, env: {}, gameConfig: TEACH_ON });
  await ask("visit the town square");
  const before = readFactRows(await loadMemory(memoryDir)).length;

  assert.equal(await ask("Fox-1 is at cell-4-4?"), null, "a trailing question mark stands the teach lane down");
  const whoPlaced = await ask("who put morsel-1 there?");
  assert.match(whoPlaced.text, /no live morsel on the board/, "the who-placed read still reaches its own recognizer");
  assert.equal(readFactRows(await loadMemory(memoryDir)).length, before);
}));

test("teach on: the lane's own verbs still win over the sentence table", () => withMemoryDir("tmct-mudiii-turn-teach-precedence-", async (memoryDir) => {
  const planHolder = { state: null };
  const ask = (line) => mudiiiTurn(line, { planHolder, memoryDir, env: {}, gameConfig: TEACH_ON });
  await ask("visit the town square");

  const placed = await ask("put food at cell-3-4");
  assert.match(placed.text, /a morsel now sits at cell-3-4/);

  const ticked = await ask("tick");
  assert.match(ticked.text, /^Turn 1 —/);

  const addressed = await ask("@fox the goblin is east");
  assert.match(addressed.text, /told the fox-1/);
}));

// ---- oneStepDirectionBetween -------------------------------------------

test("oneStepDirectionBetween names the compass direction for an exact one-cell cardinal step, and null for anything else", () => {
  assert.equal(oneStepDirectionBetween({ x: 5, y: 5 }, { x: 5, y: 4 }), "north");
  assert.equal(oneStepDirectionBetween({ x: 5, y: 5 }, { x: 5, y: 6 }), "south");
  assert.equal(oneStepDirectionBetween({ x: 5, y: 5 }, { x: 6, y: 5 }), "east");
  assert.equal(oneStepDirectionBetween({ x: 5, y: 5 }, { x: 4, y: 5 }), "west");
  assert.equal(oneStepDirectionBetween({ x: 5, y: 5 }, { x: 5, y: 5 }), null);
  assert.equal(oneStepDirectionBetween({ x: 5, y: 5 }, { x: 6, y: 6 }), null, "a diagonal neighbor has no cardinal direction");
});

// ---- believedFactSentence -------------------------------------------------

test("believedFactSentence: an observed/told cell reads as a position, a null belief reads as not observed", () => {
  assert.equal(believedFactSentence("fox-1", "cell-3-4"), "fox-1 is at cell-3-4.");
  assert.equal(believedFactSentence("crumb-2", null), "crumb-2 has not been observed.");
});

// ---- pillsForMudiii: the chat dock's dynamic deception-pill set, plus the
// food-claim channel spider-fly has no equivalent of -------------------------

test("pillsForMudiii: with one fox and one goblin, address pills are bare and the claim pills read the true adjacent direction plus the point-reflected false cell", () => {
  const agents = { "fox-1": { cell: "cell-2-2" }, "goblin-1": { cell: "cell-3-2" } };
  const { addressPills, claimPills, addresseeId } = pillsForMudiii(agents, {}, null, { gridSize: 12 });
  assert.deepEqual(addressPills, [
    { id: "fox-1", kind: "fox", label: "@fox" },
    { id: "goblin-1", kind: "goblin", label: "@goblin" },
  ]);
  assert.equal(addresseeId, "fox-1", "defaults to the predator when nothing is explicitly addressed");
  assert.equal(claimPills.length, 2, "one true and one false claim pill for the one live goblin");
  const trueClaim = claimPills.find((p) => p.truth === true);
  const falseClaim = claimPills.find((p) => p.truth === false);
  assert.deepEqual(trueClaim, { subjectId: "goblin-1", truth: true, text: "the goblin is east", sentence: "@fox the goblin is east" });
  assert.deepEqual(falseClaim, {
    subjectId: "goblin-1", truth: false,
    text: "the goblin is at cell-10-11", sentence: "@fox the goblin is at cell-10-11",
  });
});

test("pillsForMudiii: a goblin addressee gets claim pills about live food too — the channel spider-fly has none of", () => {
  const agents = { "fox-1": { cell: "cell-2-2" }, "goblin-1": { cell: "cell-5-5" } };
  const items = { "crumb-1": { cell: "cell-6-6" }, "morsel-1": { cell: "cell-1-1" } };
  const { claimPills } = pillsForMudiii(agents, items, "goblin-1", { gridSize: 12 });
  const subjectIds = claimPills.map((p) => p.subjectId);
  assert.ok(subjectIds.includes("fox-1"), "still gets a claim pill about the fox");
  assert.ok(subjectIds.includes("crumb-1"), "and about the crumb");
  assert.ok(subjectIds.includes("morsel-1"), "and about the morsel");
  assert.equal(claimPills.length, 6, "one true and one false pill each for the fox, the crumb and the morsel");
});

test("pillsForMudiii: a fox addressee gets NO food claim pills — a predator never forages, so the pill would have no effect", () => {
  const agents = { "fox-1": { cell: "cell-2-2" }, "goblin-1": { cell: "cell-5-5" } };
  const items = { "crumb-1": { cell: "cell-6-6" } };
  const { claimPills } = pillsForMudiii(agents, items, "fox-1", { gridSize: 12 });
  assert.ok(!claimPills.some((p) => p.subjectId === "crumb-1"));
});

test("pillsForMudiii: address pills switch from bare to numbered once more than one individual of a kind is live", () => {
  const agents = {
    "fox-1": { cell: "cell-2-2" }, "fox-2": { cell: "cell-9-9" },
    "goblin-1": { cell: "cell-3-2" },
  };
  const { addressPills } = pillsForMudiii(agents, {}, null, { gridSize: 12 });
  assert.deepEqual(addressPills, [
    { id: "fox-1", kind: "fox", label: "@fox-1" },
    { id: "fox-2", kind: "fox", label: "@fox-2" },
    { id: "goblin-1", kind: "goblin", label: "@goblin" },
  ]);
});

test("pillsForMudiii: a stale explicitAddresseeId naming an agent no longer on the board falls back to the default addressee", () => {
  const agents = { "fox-1": { cell: "cell-2-2" }, "goblin-1": { cell: "cell-3-2" } };
  const { addresseeId, claimPills } = pillsForMudiii(agents, {}, "fox-9", { gridSize: 12 });
  assert.equal(addresseeId, "fox-1");
  assert.equal(claimPills.length, 2);
});

test("pillsForMudiii: no live agents at all yields empty pill sets, never a thrown error", () => {
  assert.deepEqual(pillsForMudiii({}, {}, null, { gridSize: 12 }), { addressPills: [], claimPills: [], addresseeId: null });
});

test("pillsForMudiii: the false-claim reflection uses the caller's own gridSize, not a fixed board size", () => {
  const agents = { "fox-1": { cell: "cell-2-2" }, "goblin-1": { cell: "cell-5-5" } };
  const { claimPills } = pillsForMudiii(agents, {}, null, { gridSize: 14 }); // the chapel layout's own size
  const falseClaim = claimPills.find((p) => p.truth === false);
  assert.equal(falseClaim.text, "the goblin is at cell-10-10", "the point reflection of (5,5) through a 14-wide board's center is (10,10)");
});
