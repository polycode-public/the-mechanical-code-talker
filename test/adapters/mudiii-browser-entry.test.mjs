// mudiii-browser-entry: casting a town square. The page names its cast
// ("fox-1", "goblin-3") because its dropdown and HUD are keyed on names; the
// engine casts by count, because minting is the only place cells are chosen.
// These tests pin the translation between the two, and the opening board the
// page reads back once the mint has happened — the read that puts every mesh
// on the board before the first turn rather than after it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMudiiiSession, townSquareRosterArgs, pickMudiiiRoster, driveRequest, routeBetweenCells,
} from "../../src/surfaces/web/mudiii-browser-entry.mjs";
import { roleOfId, foldTownSquareState } from "../../src/services/predator-prey.mjs";
import { renderMudEditorText, gridWorldEditorState } from "../../src/services/mud-editor.mjs";
import { TOWN_SQUARE_LAYOUTS, worldFactRows } from "../../src/domain/town-square-world.mjs";
import { loadMemory, readFactRows } from "../../src/adapters/memory/core.mjs";

const LAYOUT = TOWN_SQUARE_LAYOUTS["town-square"];
const roleOf = (id) => roleOfId(id);

const worldPayload = {
  name: "town-square",
  facts: [...worldFactRows(LAYOUT)].map((f) => ({ subject: f.subject, predicate: f.predicate, object: f.object })),
  rules: [],
  opening: "a town square",
};

test("townSquareRosterArgs counts a cast the page named, so the engine seeds cells for exactly that many", () => {
  assert.deepEqual(
    townSquareRosterArgs(["fox-1", "goblin-1", "goblin-3"], roleOf),
    { predatorCount: 1, preyCount: 2 },
  );
});

test("townSquareRosterArgs reads the role off a [{ id, role }] row rather than re-deriving it from the id", () => {
  assert.deepEqual(
    townSquareRosterArgs([{ id: "fox-1", role: "predator" }, { id: "fox-2", role: "predator" }], roleOf),
    { predatorCount: 2, preyCount: 0 },
  );
});

test("townSquareRosterArgs passes a keyed roster through untouched, so a fixture can still pin its own cells", () => {
  const pinned = { "fox-1": { role: "predator", cell: "cell-2-2" } };
  assert.deepEqual(townSquareRosterArgs(pinned, roleOf), { agents: pinned });
});

test("townSquareRosterArgs asks for nothing when no cast was named, leaving the layout's own counts to stand", () => {
  assert.deepEqual(townSquareRosterArgs([], roleOf), {});
  assert.deepEqual(townSquareRosterArgs(null, roleOf), {});
});

test("an id-named cast is actually placed on the board — never written as array indices with no cell", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tmct-mudiii-entry-cast-"));
  try {
    const session = await createMudiiiSession(worldPayload, { agents: ["fox-1", "goblin-1", "goblin-2"], epoch: 0 });
    const state = foldTownSquareState(readFactRows(await loadMemory(session.memoryDir)));
    assert.deepEqual([...state.placements.keys()].filter((id) => /^fox-\d+$/.test(id)), ["fox-1"]);
    assert.deepEqual([...state.placements.keys()].filter((id) => /^goblin-\d+$/.test(id)).sort(), ["goblin-1", "goblin-2"]);
    assert.deepEqual([...state.placements.keys()].filter((id) => /^\d+$/.test(id)), [], "no array index was ever written as a subject");
    for (const id of ["fox-1", "goblin-1", "goblin-2"]) {
      assert.match(state.placements.get(id).cell, /^cell-\d+-\d+$/, `${id} stands on a real cell`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("session.board() hands back the opening cast at real cells, with no turn spent", async () => {
  const session = await createMudiiiSession(worldPayload, { agents: ["fox-1", "goblin-1", "goblin-2"], epoch: 0 });
  const board = await session.board();
  assert.equal(board.turn, 0);
  assert.deepEqual(board.ecology, []);
  assert.deepEqual(Object.keys(board.agents).sort(), ["fox-1", "goblin-1", "goblin-2"]);
  for (const [id, agent] of Object.entries(board.agents)) {
    assert.match(agent.cell, /^cell-\d+-\d+$/, `${id} reports a cell the scene can place a mesh on`);
  }
});

test("session.board() and session.tick() agree on the field set a renderer reads", async () => {
  const session = await createMudiiiSession(worldPayload, { agents: ["fox-1", "goblin-1"], epoch: 0 });
  const board = await session.board();
  const tick = await session.tick();
  assert.deepEqual(Object.keys(board).sort(), ["agents", "ecology", "epoch", "items", "turn"]);
  assert.deepEqual(
    Object.keys(board.agents["fox-1"]).sort(),
    Object.keys(tick.agents["fox-1"]).sort(),
  );
});

test("session.tick() counts its own turns, and session.board() reports the same count without spending one", async () => {
  const session = await createMudiiiSession(worldPayload, { agents: ["fox-1", "goblin-1"], epoch: 0 });
  assert.equal((await session.board()).turn, 0);
  assert.equal((await session.tick()).turn, 1);
  assert.equal((await session.tick()).turn, 2);
  assert.equal((await session.board()).turn, 2, "a resting read repeats the last turn played");
});

test("a chat turn that runs a tick moves the count the page then reads back off the board", async () => {
  const session = await createMudiiiSession(worldPayload, { agents: ["fox-1", "goblin-1"], epoch: 0 });
  await session.tick();
  await session.turn("@fox-1 the goblin-1 is east");
  assert.equal((await session.board()).turn, 2, "the chat frame's own tick is counted like any other");
});

test("a grid fold's placements survive the trip into the editor's own state shape", () => {
  const fold = {
    placements: new Map([["fox-1", { cell: "cell-5-5", turn: 3, epoch: 0 }]]),
    mass: new Map([["fox-1", { value: 20, turn: 3, epoch: 0 }]]),
  };
  const editorState = gridWorldEditorState(fold);
  assert.deepEqual(editorState.placements.get("fox-1"), { predicate: "mgx:currently-in", object: "cell-5-5" });
  assert.deepEqual(editorState.masses.get("fox-1"), { value: 20 });
  assert.equal(editorState.openness.size, 0, "a board has nothing to open");
});

test("edit mode says where a placed morsel stands, not merely that one exists", async () => {
  const session = await createMudiiiSession(worldPayload, { agents: ["fox-1", "goblin-1"], epoch: 0 });
  await session.turn("put food at cell-3-4");
  const snap = await session.snapshot();
  const lines = renderMudEditorText(snap.rows, gridWorldEditorState(snap.state)).split("\n");
  assert.ok(lines.some((l) => /morsel-1 is a morsel/i.test(l)), "the morsel's own kind is a sentence");
  assert.ok(lines.some((l) => /morsel-1 stands in the cell-3-4/i.test(l)), "and so is where it stands");
  assert.ok(lines.some((l) => /fox-1 stands in the cell-\d+-\d+/i.test(l)), "every agent's cell is a sentence too");
});

test("syncing the editor's own unchanged text back writes nothing and retracts nothing", async () => {
  const session = await createMudiiiSession(worldPayload, { agents: ["fox-1", "goblin-1"], epoch: 0 });
  await session.turn("put food at cell-3-4");
  const snap = await session.snapshot();
  const text = renderMudEditorText(snap.rows, gridWorldEditorState(snap.state));
  const result = await session.applyEdit(text);
  assert.deepEqual(result.unrecognized, [], "every sentence the renderer wrote reads back");
  assert.equal(result.added, 0, "a placement already true is not re-appended on every sync");
});

test("a ring press reads as a step ahead, a step back, or a turn on the spot", () => {
  const at = { cell: "cell-5-5", facing: "north" };
  assert.deepEqual(driveRequest("up", at), { cell: "cell-5-4", facing: "north" });
  assert.deepEqual(driveRequest("forward", at), { cell: "cell-5-4", facing: "north" });
  assert.deepEqual(driveRequest("down", at), { cell: "cell-5-6", facing: "north" }, "a step back leaves the facing alone");
  assert.deepEqual(driveRequest("left", at), { facing: "west" }, "a turn names no cell, so the agent holds");
  assert.deepEqual(driveRequest("right", at), { facing: "east" });
  assert.deepEqual(driveRequest("up-right", at), { facing: "northeast" }, "the diagonals turn forty-five");
  assert.deepEqual(driveRequest("up-left", at), { facing: "northwest" });
  assert.deepEqual(driveRequest("down-right", at), { facing: "southeast" });
  assert.deepEqual(driveRequest("down-left", at), { facing: "southwest" });
  assert.equal(driveRequest("sideways", at), null, "a press this ring does not carry asks for nothing");
  assert.equal(driveRequest("", at), null);
});

test("a press forward while facing a diagonal holds, because the grid carries no diagonal exit", () => {
  assert.deepEqual(driveRequest("up", { cell: "cell-5-5", facing: "northeast" }), { facing: "northeast" });
  assert.deepEqual(driveRequest("right", { cell: "cell-5-5", facing: "northeast" }), { facing: "southeast" });
});

test("driveRequest also takes a compass point straight, so a caller can ask in absolutes", () => {
  const at = { cell: "cell-5-5", facing: "north" };
  assert.deepEqual(driveRequest("west", at), { cell: "cell-4-5", facing: "west" });
  assert.deepEqual(driveRequest("southeast", at), { facing: "southeast" }, "no exit runs diagonally, so this is a turn");
});

test("session.driveAgent walks the followed agent one cell and hands back a whole tick", async () => {
  const session = await createMudiiiSession(worldPayload, { agents: ["fox-1", "goblin-1"], epoch: 0 });
  const before = await session.board();
  const facing = before.agents["fox-1"].facing;
  const result = await session.driveAgent("fox-1", "up");
  assert.equal(result.turn, 1, "a press spends a turn like any other");
  assert.deepEqual(Object.keys(result.driven).sort(), ["accepted", "agent", "cell", "direction", "facing", "from"]);
  assert.equal(result.driven.accepted, true);
  assert.equal(result.rungs["fox-1"], "driven");
  assert.equal(result.driven.from, before.agents["fox-1"].cell);
  assert.equal(result.agents["fox-1"].cell, result.driven.cell);
  assert.notEqual(result.driven.cell, result.driven.from, "up is a step, so the fox stands somewhere new");
  assert.equal(result.driven.facing, facing, "a step straight ahead keeps the facing it started with");
  assert.ok(result.rungs["goblin-1"], "and the rest of the board took the same turn");
});

test("a press on an agent that is not on the board still advances the world", async () => {
  const session = await createMudiiiSession(worldPayload, { agents: ["fox-1"], epoch: 0 });
  const result = await session.driveAgent("fox-99", "up");
  assert.equal(result.driven.accepted, false);
  assert.equal(result.driven.from, null);
  assert.equal(result.turn, 1);
  assert.ok(result.agents["fox-1"], "the world moved on without the press");
});

test("a hand-driven turn on the spot survives into the board the page draws next", async () => {
  const session = await createMudiiiSession(worldPayload, { agents: ["fox-1"], epoch: 0 });
  const result = await session.driveAgent("fox-1", "right");
  assert.equal(result.driven.accepted, true, "a turn needs no exit, so it is always a legal move");
  assert.equal(result.driven.cell, result.driven.from, "and it spends the turn where it stands");
  const board = await session.board();
  assert.equal(board.agents["fox-1"].facing, result.driven.facing);
});

test("pickMudiiiRoster draws without repeats and never more than the pool holds", () => {
  const drawn = pickMudiiiRoster(["fox-1", "fox-2", "fox-3"], { count: 5, random: () => 0 });
  assert.equal(drawn.length, 3);
  assert.equal(new Set(drawn).size, 3);
});

test("teaching is off unless the page says otherwise, and the flag is read fresh every turn", async () => {
  let teaching = false;
  const session = await createMudiiiSession(worldPayload, {
    agents: ["fox-1", "goblin-1"], epoch: 0, getTeachEnabled: () => teaching,
  });
  const before = await session.turn("The fox is at cell-3-4.");
  assert.doesNotMatch(before.answer, /noted|stored|wrote/i, "with teaching off the square does not take the sentence as a fact");

  teaching = true;
  const after = await session.turn("The fox is at cell-3-4.");
  assert.notEqual(after.answer, before.answer, "ticking the box mid-session changes what the very next line means");
  const state = foldTownSquareState(readFactRows(await loadMemory(session.memoryDir)));
  assert.equal(state.placements.get("fox-1").cell, "cell-3-4", "the taught cell is where the fox now stands");
});

test("routeBetweenCells walks the world's own exit facts, and returns one direction per hop", async () => {
  const route = routeBetweenCells(worldPayload.facts, "cell-2-2", "cell-4-2");
  assert.ok(route, "two open cells on the same row are connected");
  assert.equal(route.cells[0], "cell-2-2");
  assert.equal(route.cells[route.cells.length - 1], "cell-4-2");
  assert.equal(route.directions.length, route.cells.length - 1, "one direction per hop between the cells");
  for (const direction of route.directions) {
    assert.ok(["north", "south", "east", "west"].includes(direction), `${direction} is a step the board grants`);
  }
});

test("routeBetweenCells declines rather than drawing a route to a cell nothing reaches", async () => {
  assert.equal(routeBetweenCells(worldPayload.facts, "cell-2-2", "cell-99-99"), null);
  assert.equal(routeBetweenCells(worldPayload.facts, "not-a-cell", "cell-2-2"), null);
  assert.equal(routeBetweenCells([], "cell-2-2", "cell-4-2"), null, "no exit facts, no route");
});
