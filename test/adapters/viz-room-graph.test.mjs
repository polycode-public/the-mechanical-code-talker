// viz-room-graph.test.mjs — directedGridLayout/roomGraphSvg, unifying
// mud-viz.mjs's burrowGraph/burrowSvg and adventure-viz.mjs's
// visitedRoomGraph/its own inline roomMapSvg into one parametrized pair.
import { test } from "node:test";
import assert from "node:assert/strict";
import { directedGridLayout, roomGraphSvg, levelsOf } from "../../src/services/viz-room-graph.mjs";

function exitState(pairs) {
  const exits = new Map();
  for (const [from, direction, to] of pairs) {
    if (!exits.has(from)) exits.set(from, new Map());
    exits.get(from).set(direction, to);
  }
  return { exits, placements: new Map() };
}

test("directedGridLayout: a simple line of rooms lays out one row apart per exit direction", () => {
  const state = exitState([
    ["garden", "south", "burrow"],
    ["burrow", "north", "garden"],
    ["burrow", "down", "den"],
    ["den", "up", "burrow"],
  ]);
  const graph = directedGridLayout(state, ["garden", "burrow", "den"]);
  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
  assert.equal(byId.burrow.y, byId.garden.y + 1);
  assert.equal(byId.den.y, byId.burrow.y + 1);
  assert.equal(byId.garden.x, byId.burrow.x, "a purely vertical chain stays in one column");
  assert.equal(graph.edges.length, 2, "one edge per undirected room pair, not two");
});

test("directedGridLayout: an exit toward a room outside roomIds becomes a hint, never a node", () => {
  const state = exitState([
    ["garden", "south", "burrow"],
    ["burrow", "east", "unexplored-den"],
  ]);
  const graph = directedGridLayout(state, ["garden", "burrow"]);
  assert.deepEqual(graph.nodes.map((n) => n.id).sort(), ["burrow", "garden"]);
  assert.deepEqual(graph.hints, [{ from: "burrow", direction: "east" }]);
});

test("directedGridLayout: opts.root places that room first and attaches .level via an up/down BFS", () => {
  const state = exitState([
    ["garden", "down", "burrow"],
    ["burrow", "up", "garden"],
    ["burrow", "south", "tunnel"],
    ["tunnel", "north", "burrow"],
  ]);
  const graph = directedGridLayout(state, ["garden", "burrow", "tunnel"], { root: "garden" });
  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
  assert.equal(byId.garden.level, 0);
  assert.equal(byId.burrow.level, -1, "a down exit drops the level by one");
  assert.equal(byId.tunnel.level, -1, "a sideways exit keeps the level unchanged");
});

test("directedGridLayout: without opts.root, nodes carry no .level at all", () => {
  const state = exitState([["a", "south", "b"]]);
  const graph = directedGridLayout(state, ["a", "b"]);
  for (const n of graph.nodes) assert.ok(!("level" in n));
});

test("directedGridLayout: opts.actingSubject marks that subject's own room .current, and nothing else", () => {
  const state = exitState([["a", "south", "b"]]);
  state.placements.set("player", { object: "b" });
  const graph = directedGridLayout(state, ["a", "b"], { actingSubject: "player" });
  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
  assert.equal(byId.a.current, false);
  assert.equal(byId.b.current, true);
});

test("directedGridLayout: opts.nudgeCollisions pushes a second room landing on the same cell to the right instead of overlapping it", () => {
  // Digging down AND south from "burrow" would otherwise place both targets
  // at the same (x, y) relative to burrow — a real mud-garden shape.
  const state = exitState([
    ["burrow", "down", "den"],
    ["den", "up", "burrow"],
    ["burrow", "south", "nook"],
    ["nook", "north", "burrow"],
  ]);
  const withNudge = directedGridLayout(state, ["burrow", "den", "nook"], { nudgeCollisions: true });
  const byId = Object.fromEntries(withNudge.nodes.map((n) => [n.id, n]));
  assert.notDeepEqual({ x: byId.den.x, y: byId.den.y }, { x: byId.nook.x, y: byId.nook.y });
});

test("directedGridLayout: disconnected components lay out as separate side-by-side blocks", () => {
  const state = exitState([["a", "south", "b"], ["c", "south", "d"]]);
  const graph = directedGridLayout(state, ["a", "b", "c", "d"]);
  const byId = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
  assert.ok(byId.c.x > byId.a.x && byId.c.x > byId.b.x, "the second component starts to the right of the first");
  assert.equal(graph.edges.length, 2);
});

test("levelsOf: an unreachable room from root is absent from the map", () => {
  const state = exitState([["a", "south", "b"]]);
  const levels = levelsOf(state, "a");
  assert.equal(levels.get("a"), 0);
  assert.equal(levels.get("b"), 0);
  assert.equal(levels.has("z"), false);
});

test("roomGraphSvg: an empty graph renders as an empty string, so `roomGraphSvg(...) || fallback` reads naturally", () => {
  assert.equal(roomGraphSvg({ nodes: [], edges: [], hints: [] }), "");
});

test("roomGraphSvg: the manor-board style (clickable) marks the selected and current room", () => {
  const graph = { nodes: [{ id: "hall", x: 0, y: 0, current: true }, { id: "study", x: 1, y: 0 }], edges: [{ from: "hall", to: "study", direction: "east" }], hints: [] };
  const html = roomGraphSvg(graph, { clickable: true, selectedRoomId: "study" });
  assert.match(html, /class="room-node current clickable"/);
  assert.match(html, /class="room-node clickable selected" data-room="study"/);
  assert.doesNotMatch(html, /class="burrow"/);
});

test("roomGraphSvg: the burrow style (turf) draws a ground line only when level 0 genuinely separates from the rest", () => {
  const graph = {
    nodes: [{ id: "garden", x: 0, y: 0, level: 0 }, { id: "den", x: 0, y: 1, level: -1 }],
    edges: [{ from: "garden", to: "den", direction: "down" }],
    hints: [],
  };
  const html = roomGraphSvg(graph, { turf: true, wrapClass: "burrow" });
  assert.match(html, /class="turf"/);
  assert.match(html, /class="tunnel shaft"/);
  assert.match(html, /^<div class="burrow">/);
});

test("roomGraphSvg: turf style with occupants draws one titled dot per occupant", () => {
  const graph = { nodes: [{ id: "garden", x: 0, y: 0 }], edges: [], hints: [] };
  const html = roomGraphSvg(graph, { turf: true, occupants: { garden: [{ character: "mole-1", color: "#123456" }] } });
  assert.match(html, /class="occupant"/);
  assert.match(html, /<title>mole-1<\/title>/);
});

test("roomGraphSvg: opts.here overrides a node's own .current field", () => {
  const graph = { nodes: [{ id: "a", x: 0, y: 0, current: true }, { id: "b", x: 1, y: 0 }], edges: [], hints: [] };
  const html = roomGraphSvg(graph, { clickable: true, here: "b" });
  assert.match(html, /data-room="a"[^>]*>/);
  const aNode = html.match(/<g class="([^"]*)" data-room="a">/)[1];
  const bNode = html.match(/<g class="([^"]*)" data-room="b">/)[1];
  assert.doesNotMatch(aNode, /current/);
  assert.match(bNode, /current/);
});

test("roomGraphSvg escapes room ids so a maliciously-taught room name can't break out of the markup", () => {
  const graph = { nodes: [{ id: "<script>", x: 0, y: 0 }], edges: [], hints: [] };
  const html = roomGraphSvg(graph, { clickable: true });
  assert.doesNotMatch(html, /<script>/);
});
