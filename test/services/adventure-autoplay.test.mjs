// adventure-autoplay: goal inference (explore/fetch/win/stalled) over the
// generic mgx:is-objective marker, and the exposure constraint the whole
// feature rests on — auto-play may only reason over rooms it has actually
// moved into this run, never the full omniscient fact store.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createInMemoryStore, appendFacts, appendRule, loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";
import { foldWorldState } from "../../src/services/adventure.mjs";
import { exposedFacts, runAdventureAutoplayTick } from "../../src/services/adventure-autoplay.mjs";

// ---- a small, hand-built fixture world: A - B - C - D in a line, each room
// linked both ways, mirroring Ashcombe Hall's own go/take rule shapes so
// adventureTurn's runWorldCommand can actually execute the moves this test
// drives. Player starts in A; a portable objective sits directly in whichever
// room a test names (never behind a container puzzle — that multi-step case
// is explicitly out of scope for this increment, see PLAN_GAMES_UPLIFT_V2.md
// Part B's own non-goals).
const GO_RULES = [
  { name: "go", ruleKind: "action-signature", slots: { subjectClass: "adventurer", targetClass: "room" } },
  { name: "go", ruleKind: "action-effect", slots: { predicate: "currently-in", subjectRole: "subject", objectRole: "target" } },
];
const TAKE_RULES = [
  { name: "take", ruleKind: "action-signature", slots: { subjectClass: "portable", targetClass: "adventurer" } },
  { name: "take", ruleKind: "action-effect", slots: { predicate: "located-in", subjectRole: "subject", objectRole: "target" } },
];

async function seedLineWorld({ objectiveRoom = null, extraFacts = [] } = {}) {
  const dir = createInMemoryStore();
  const facts = [
    { subject: "player", predicate: "rdf:type", object: "adventurer" },
    { subject: "player", predicate: "mgx:currently-in", object: "a" },
    { subject: "a", predicate: "rdf:type", object: "room" },
    { subject: "b", predicate: "rdf:type", object: "room" },
    { subject: "c", predicate: "rdf:type", object: "room" },
    { subject: "d", predicate: "rdf:type", object: "room" },
    { subject: "a", predicate: "mgx:has-exit-east", object: "b" },
    { subject: "b", predicate: "mgx:has-exit-west", object: "a" },
    { subject: "b", predicate: "mgx:has-exit-east", object: "c" },
    { subject: "c", predicate: "mgx:has-exit-west", object: "b" },
    { subject: "c", predicate: "mgx:has-exit-east", object: "d" },
    { subject: "d", predicate: "mgx:has-exit-west", object: "c" },
    ...extraFacts,
  ];
  if (objectiveRoom) {
    facts.push({ subject: "prize", predicate: "rdf:type", object: "portable" });
    facts.push({ subject: "prize", predicate: "mgx:located-in", object: objectiveRoom });
    facts.push({ subject: "prize", predicate: "mgx:is-objective", object: "true" });
  }
  await appendFacts(dir, facts.map((f) => ({ ...f, provenance: "test:line-world" })));
  for (const rule of [...GO_RULES, ...TAKE_RULES]) {
    await appendRule(dir, { name: rule.name, kind: rule.ruleKind, slots: rule.slots, provenance: "test:line-world" });
  }
  return dir;
}

const planHolderFor = () => ({ state: { adventure: { world: "line-world" } } });

// ---- exposedFacts ------------------------------------------------------------

test("exposedFacts: the objective marker is exposed unconditionally, even from turn 0, regardless of where it sits", () => {
  const rows = [
    { subject: "prize", predicate: "mgx:located-in", object: "d" },
    { subject: "prize", predicate: "mgx:is-objective", object: "true" },
    { subject: "d", predicate: "rdf:type", object: "room" },
  ];
  const exposed = exposedFacts(rows, new Set(["a"]));
  assert.ok(exposed.some((r) => r.predicate === "mgx:is-objective"), "the marker itself is always exposed");
  assert.ok(!exposed.some((r) => r.predicate === "mgx:located-in" && r.subject === "prize"), "its true room is NOT exposed until 'd' is visited");
});

test("exposedFacts: every fact about the player is exposed unconditionally", () => {
  const rows = [
    { subject: "player", predicate: "mgx:currently-in", object: "c" },
    { subject: "c", predicate: "rdf:type", object: "room" },
  ];
  assert.ok(exposedFacts(rows, new Set(["a"])).some((r) => r.subject === "player"));
});

test("exposedFacts: an exit fact belongs to the room whose subject it is — exposed once that room itself is exposed, not before", () => {
  const rows = [
    { subject: "a", predicate: "rdf:type", object: "room" },
    { subject: "b", predicate: "rdf:type", object: "room" },
    { subject: "a", predicate: "mgx:has-exit-east", object: "b" },
    { subject: "b", predicate: "mgx:has-exit-west", object: "a" },
  ];
  const exposedFromA = exposedFacts(rows, new Set(["a"]));
  assert.ok(exposedFromA.some((r) => r.subject === "a" && r.predicate === "mgx:has-exit-east"));
  assert.ok(!exposedFromA.some((r) => r.subject === "b" && r.predicate === "mgx:has-exit-west"), "b's own exit is unknown until b is visited");
});

test("exposedFacts: a hidden object becomes exposed only once its container is truly open, with no special case needed", () => {
  const rows = [
    { subject: "a", predicate: "rdf:type", object: "room" },
    { subject: "chest", predicate: "mgx:fixed-in", object: "a" },
    { subject: "chest", predicate: "mgx:is-container", object: "true" },
    { subject: "gem", predicate: "mgx:hidden-in", object: "chest" },
  ];
  const closed = exposedFacts(rows, new Set(["a"]));
  assert.ok(!closed.some((r) => r.subject === "gem"), "still hidden — the chest is closed");

  const opened = exposedFacts(
    [...rows, { subject: "chest@turn1", predicate: "mgx:is-open", object: "true" }, { subject: "gem@turn1", predicate: "mgx:located-in", object: "chest" }],
    new Set(["a"]),
  );
  assert.ok(opened.some((r) => r.subject === "gem@turn1"), "revealed once the chest is truly open, in an exposed room");
});

// ---- runAdventureAutoplayTick: explore / fetch / win / stalled ---------------

test("explore: with no objective in the world, auto-play picks the lowest-sorted unexposed exit from the current room", async () => {
  const dir = await seedLineWorld();
  const planHolder = planHolderFor();
  const result = await runAdventureAutoplayTick(dir, { exposedRoomIds: new Set(["a"]), planHolder });
  assert.equal(result.done, false);
  assert.equal(result.stalled, false);
  assert.ok(result.exposedRoomIds.has("b"), "moved into b, the only exit from a");
  const rows = readFactRows(await loadMemory(dir));
  const state = foldWorldState(rows);
  assert.equal(state.placements.get("player")?.object, "b");
});

test("explore: once every exit from the current room is already exposed, auto-play backtracks toward the nearest room with an unexposed exit", async () => {
  // A branching fixture: a-b-c in a line, plus a second exit off b (north to
  // e) that was never taken. The player is standing in c — a dead end in
  // exposed terms, since c's only exit (west, back to b) is already
  // exposed — while b, already visited, still has its own unexposed exit.
  const dir = createInMemoryStore();
  await appendFacts(dir, [
    { subject: "player", predicate: "rdf:type", object: "adventurer" },
    { subject: "player", predicate: "mgx:currently-in", object: "c" },
    { subject: "a", predicate: "rdf:type", object: "room" },
    { subject: "b", predicate: "rdf:type", object: "room" },
    { subject: "c", predicate: "rdf:type", object: "room" },
    { subject: "e", predicate: "rdf:type", object: "room" },
    { subject: "a", predicate: "mgx:has-exit-east", object: "b" },
    { subject: "b", predicate: "mgx:has-exit-west", object: "a" },
    { subject: "b", predicate: "mgx:has-exit-east", object: "c" },
    { subject: "c", predicate: "mgx:has-exit-west", object: "b" },
    { subject: "b", predicate: "mgx:has-exit-north", object: "e" },
    { subject: "e", predicate: "mgx:has-exit-south", object: "b" },
  ].map((f) => ({ ...f, provenance: "test:branch-world" })));
  for (const rule of [...GO_RULES, ...TAKE_RULES]) {
    await appendRule(dir, { name: rule.name, kind: rule.ruleKind, slots: rule.slots, provenance: "test:branch-world" });
  }

  const planHolder = planHolderFor();
  const result = await runAdventureAutoplayTick(dir, { exposedRoomIds: new Set(["a", "b", "c"]), planHolder });
  assert.equal(result.stalled, false);
  assert.match(result.goal, /backtracking/);
  const rows = readFactRows(await loadMemory(dir));
  assert.equal(foldWorldState(rows).placements.get("player")?.object, "b", "stepped back toward b, the nearest room with an unexposed exit (north to e)");
});

test("win: the objective is already carried — done, no further move, no write", async () => {
  const dir = await seedLineWorld({ objectiveRoom: "a" });
  await appendFacts(dir, [{ subject: "prize@turn1", predicate: "mgx:located-in", object: "player", provenance: "test:setup" }]);
  const before = readFactRows(await loadMemory(dir)).length;
  const planHolder = planHolderFor();
  const result = await runAdventureAutoplayTick(dir, { exposedRoomIds: new Set(["a"]), planHolder });
  assert.equal(result.done, true);
  assert.equal(result.stalled, false);
  const after = readFactRows(await loadMemory(dir)).length;
  assert.equal(after, before, "a win tick writes nothing — no move to make");
});

test("fetch: the objective's room is exposed but not co-located — auto-play paths toward it over the exposed exit-graph, one step per tick", async () => {
  const dir = await seedLineWorld({ objectiveRoom: "c" });
  const planHolder = planHolderFor();
  // b and c are both already exposed (as if auto-play had already explored
  // there), but the objective's placement only becomes visible once c is
  // exposed too — matches how exposedFacts would have picked it up.
  let result = await runAdventureAutoplayTick(dir, { exposedRoomIds: new Set(["a", "b", "c"]), planHolder });
  assert.equal(result.stalled, false);
  assert.match(result.goal, /heading toward the c/);
  let rows = readFactRows(await loadMemory(dir));
  assert.equal(foldWorldState(rows).placements.get("player")?.object, "b", "one step per tick, toward c");

  result = await runAdventureAutoplayTick(dir, { exposedRoomIds: result.exposedRoomIds, planHolder });
  rows = readFactRows(await loadMemory(dir));
  assert.equal(foldWorldState(rows).placements.get("player")?.object, "c");

  result = await runAdventureAutoplayTick(dir, { exposedRoomIds: result.exposedRoomIds, planHolder });
  assert.match(result.goal, /taking the prize/);
  rows = readFactRows(await loadMemory(dir));
  assert.equal(foldWorldState(rows).placements.get("player")?.object, "c", "take doesn't move the player");
  assert.ok(rows.some((r) => r.predicate === "mgx:located-in" && r.object === "player" && r.subject.startsWith("prize")), "the take committed");

  result = await runAdventureAutoplayTick(dir, { exposedRoomIds: result.exposedRoomIds, planHolder });
  assert.equal(result.done, true, "the following tick sees it carried and reports the win");
});

test("stalled: the whole reachable-and-exposed world is exhausted with no objective ever found", async () => {
  const dir = await seedLineWorld(); // no mgx:is-objective fact anywhere
  const planHolder = planHolderFor();
  const result = await runAdventureAutoplayTick(dir, { exposedRoomIds: new Set(["a", "b", "c", "d"]), planHolder });
  assert.equal(result.stalled, true);
  assert.equal(result.done, false);
  const before = readFactRows(await loadMemory(dir)).length;
  await runAdventureAutoplayTick(dir, { exposedRoomIds: result.exposedRoomIds, planHolder });
  const after = readFactRows(await loadMemory(dir)).length;
  assert.equal(after, before, "a stalled tick never fabricates a move");
});

test("exposure never leaks: the objective's TRUE room is known to the full store but not yet exposed — auto-play explores rather than beelining to it", async () => {
  const dir = await seedLineWorld({ objectiveRoom: "d" }); // d is the objective's real room
  const planHolder = planHolderFor();
  // exposedRoomIds covers only the starting room — auto-play has not walked
  // anywhere yet, even though the full store already knows the prize sits in d.
  const result = await runAdventureAutoplayTick(dir, { exposedRoomIds: new Set(["a"]), planHolder });
  assert.equal(result.stalled, false);
  assert.equal(result.done, false);
  assert.match(result.goal, /exploring/, "never a 'heading toward d' fetch — the room isn't exposed yet");
  const rows = readFactRows(await loadMemory(dir));
  assert.equal(foldWorldState(rows).placements.get("player")?.object, "b", "one exploratory step, not a beeline to d");
});

test("a world with no player position at all reports an honest stall, never a fabricated move", async () => {
  const dir = createInMemoryStore();
  const planHolder = planHolderFor();
  const result = await runAdventureAutoplayTick(dir, { exposedRoomIds: new Set(), planHolder });
  assert.equal(result.stalled, true);
  assert.equal(result.done, false);
});
