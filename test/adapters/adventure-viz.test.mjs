// adventure-viz: renderAdventureHtml is a pure string builder over an
// embedded world payload — these tests pin the page's STRUCTURE (mirroring
// spider-fly-viz.test.mjs's own style) plus the pure render-glue functions
// the page splices into its own inline script — spriteClassForObject,
// visibleRoomOf, roomSceneObjects, carriedItems, visitedRoomGraph,
// goalStatusLines, pillsForRoom — and the caption builder. allRoomIds/
// suggestionsForTerm and the world editor's own markup (textarea, whole map,
// room detail, legend) get their live end-to-end behavior exercised in
// e2e/pages-adventure-edit.test.mjs; the assertions here are the fast,
// structural pins.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderAdventureHtml, spriteClassForObject, visibleRoomOf, roomSceneObjects, carriedItems,
  visitedRoomGraph, allRoomIds, goalStatusLines, roomCaptionText, pillsForRoom, suggestionsForTerm,
  spriteAncestryRows, factsForSubject, scenePlacement, roomSceneLayout, roomKindForRoom,
} from "../../src/services/adventure-viz.mjs";
import { foldWorldState } from "../../src/services/adventure.mjs";

// A small fixture room: a study with a fixed desk, a locked cabinet
// (container), a lamp lying about, and the player themself — mirroring
// Ashcombe Hall's own shapes closely enough to exercise every branch.
const ROWS = [
  { subject: "player", predicate: "rdf:type", object: "adventurer" },
  { subject: "player", predicate: "mgx:currently-in", object: "study" },
  { subject: "study", predicate: "rdf:type", object: "room" },
  { subject: "desk", predicate: "rdf:type", object: "furniture" },
  { subject: "desk", predicate: "mgx:fixed-in", object: "study" },
  { subject: "cabinet", predicate: "rdf:type", object: "furniture" },
  { subject: "cabinet", predicate: "mgx:is-container", object: "true" },
  { subject: "cabinet", predicate: "mgx:stands-locked-in", object: "study" },
  { subject: "lamp", predicate: "rdf:type", object: "portable" },
  { subject: "lamp", predicate: "mgx:located-in", object: "study" },
  // A letter hidden inside an unopened container never appears.
  { subject: "letter", predicate: "rdf:type", object: "portable" },
  { subject: "letter", predicate: "mgx:hidden-in", object: "cabinet" },
];

test("spriteClassForObject: an mgx:is-container fact wins over the object's own rdf:type — the cabinet reads as a container, not plain furniture", () => {
  assert.equal(spriteClassForObject(ROWS, "cabinet"), "container");
});

test("spriteClassForObject: a plain typed object resolves to its own rdf:type", () => {
  assert.equal(spriteClassForObject(ROWS, "desk"), "furniture");
  assert.equal(spriteClassForObject(ROWS, "lamp"), "portable");
});

test("spriteClassForObject: an object with no type fact at all falls back to 'portable'", () => {
  assert.equal(spriteClassForObject(ROWS, "mystery-thing"), "portable");
});

test("spriteAncestryRows: synthesizes a subClassOf edge from the object's own name to its declared class", () => {
  const withAncestry = spriteAncestryRows(ROWS, "cabinet");
  assert.ok(withAncestry.some((r) => r.subject === "cabinet" && r.predicate === "rdfs:subClassOf" && r.object === "container"));
  assert.equal(withAncestry.length, ROWS.length + 1, "a single synthetic row is appended, the original rows are untouched");
});

test("spriteAncestryRows: a no-op when the subject's own name already equals its declared class (nothing to synthesize)", () => {
  const rows = [{ subject: "portable", predicate: "rdf:type", object: "portable" }];
  assert.equal(spriteAncestryRows(rows, "portable"), rows);
});

test("factsForSubject: returns only the rows belonging to the named subject", () => {
  assert.deepEqual(factsForSubject(ROWS, "lamp"), [
    { subject: "lamp", predicate: "rdf:type", object: "portable" },
    { subject: "lamp", predicate: "mgx:located-in", object: "study" },
  ]);
  assert.deepEqual(factsForSubject(ROWS, "nobody-home"), []);
});

test("roomSceneObjects: draws every subject actually visible in the room, sorted, excluding the player", () => {
  const state = foldWorldState(ROWS);
  const objects = roomSceneObjects(ROWS, state, "study");
  assert.deepEqual(objects, [
    { subject: "cabinet", spriteClass: "container" },
    { subject: "desk", spriteClass: "furniture" },
    { subject: "lamp", spriteClass: "portable" },
  ]);
});

test("roomSceneObjects: a hidden object inside a closed container never appears — drawing exactly what the text digest already says", () => {
  const state = foldWorldState(ROWS);
  const objects = roomSceneObjects(ROWS, state, "study");
  assert.ok(!objects.some((o) => o.subject === "letter"), "the letter stays undrawn while the cabinet is closed");
});

test("roomSceneObjects: an object revealed by opening its container appears, positioned in the container's own room", () => {
  const opened = [
    ...ROWS,
    { subject: "cabinet@turn1", predicate: "mgx:is-open", object: "true" },
    { subject: "letter@turn1", predicate: "mgx:located-in", object: "cabinet" },
  ];
  const state = foldWorldState(opened);
  const objects = roomSceneObjects(opened, state, "study");
  assert.ok(objects.some((o) => o.subject === "letter" && o.spriteClass === "portable"), "the letter is now drawn once the cabinet is truly open");
});

test("roomSceneObjects: an object in a different room is never drawn here", () => {
  const elsewhere = [...ROWS, { subject: "key", predicate: "rdf:type", object: "portable" }, { subject: "key", predicate: "mgx:located-in", object: "drawing-room" }];
  const state = foldWorldState(elsewhere);
  const objects = roomSceneObjects(elsewhere, state, "study");
  assert.ok(!objects.some((o) => o.subject === "key"));
});

test("visibleRoomOf: a room-typed subject resolves to itself", () => {
  const state = foldWorldState(ROWS);
  assert.equal(visibleRoomOf(ROWS, state, "study"), "study");
});

test("visibleRoomOf: a hidden object resolves to null, regardless of its own placement's own room", () => {
  const state = foldWorldState(ROWS);
  assert.equal(visibleRoomOf(ROWS, state, "letter"), null);
});

test("visibleRoomOf: a carried object resolves to null — carrying has no room", () => {
  const carried = [...ROWS, { subject: "lamp@turn1", predicate: "mgx:located-in", object: "player" }];
  const state = foldWorldState(carried);
  assert.equal(visibleRoomOf(carried, state, "lamp"), null);
});

// ---- carriedItems -----------------------------------------------------------

test("carriedItems: every object placed with the player, sorted, each with its sprite class", () => {
  const carried = [
    ...ROWS,
    { subject: "lamp@turn1", predicate: "mgx:located-in", object: "player" },
    { subject: "letter@turn2", predicate: "mgx:located-in", object: "player" },
  ];
  const state = foldWorldState(carried);
  assert.deepEqual(carriedItems(carried, state), [
    { subject: "lamp", spriteClass: "portable" },
    { subject: "letter", spriteClass: "portable" },
  ]);
});

test("carriedItems: an empty inventory is a plain empty array, never a fabricated entry", () => {
  const state = foldWorldState(ROWS);
  assert.deepEqual(carriedItems(ROWS, state), []);
});

// ---- scenePlacement -----------------------------------------------------------

test("scenePlacement: a current mgx:on-top-of row resolves to the surface plane, stacked on its own target", () => {
  const rows = [...ROWS, { subject: "lamp", predicate: "mgx:on-top-of", object: "desk" }];
  const state = foldWorldState(rows);
  assert.deepEqual(scenePlacement(rows, state, "lamp"), { plane: "surface", stackedOn: "desk" });
});

test("scenePlacement: a current mgx:on-plane row resolves to that plane verbatim, with no stack target", () => {
  const rows = [...ROWS, { subject: "lamp", predicate: "mgx:on-plane", object: "wall" }];
  const state = foldWorldState(rows);
  assert.deepEqual(scenePlacement(rows, state, "lamp"), { plane: "wall", stackedOn: null });
});

test("scenePlacement: a class default reached via rdf:type + rdfs:subClassOf ancestor walk, when neither instance predicate is set", () => {
  const rows = [
    { subject: "portrait", predicate: "rdf:type", object: "furniture" },
    { subject: "portrait", predicate: "mgx:located-in", object: "study" },
    { subject: "portrait", predicate: "rdfs:subClassOf", object: "painting" },
    { subject: "painting", predicate: "mgx:default-plane", object: "wall" },
  ];
  const state = foldWorldState(rows);
  assert.deepEqual(scenePlacement(rows, state, "portrait"), { plane: "wall", stackedOn: null });
});

test("scenePlacement: a directly-taxonomized individual's own rdfs:subClassOf default wins over its generic rdf:type's default, even when the rdf:type row is written first — Ashcombe Hall's own portrait is both 'furniture' (floor) and subClassOf 'painting' (wall), and must land on the wall", () => {
  const rows = [
    { subject: "portrait", predicate: "rdf:type", object: "furniture" },
    { subject: "portrait", predicate: "mgx:fixed-in", object: "drawing-room" },
    { subject: "portrait", predicate: "rdfs:subClassOf", object: "painting" },
    { subject: "furniture", predicate: "mgx:default-plane", object: "floor" },
    { subject: "painting", predicate: "mgx:default-plane", object: "wall" },
  ];
  const state = foldWorldState(rows);
  assert.deepEqual(scenePlacement(rows, state, "portrait"), { plane: "wall", stackedOn: null }, "the specific taxonomic fact outranks the coarse rendering class, regardless of which fact row came first");
});

test("scenePlacement: an object with no instance predicate and no class default falls to the floor", () => {
  const state = foldWorldState(ROWS);
  assert.deepEqual(scenePlacement(ROWS, state, "desk"), { plane: "floor", stackedOn: null });
});

test("scenePlacement: taking an object off its resting place invalidates the stale on-top-of row with no extra write — the same staleness rule foldWorldState already applies to placements", () => {
  const rows = [
    ...ROWS,
    { subject: "lamp", predicate: "mgx:on-top-of", object: "desk" },
    { subject: "lamp@turn1", predicate: "mgx:located-in", object: "player" },
  ];
  const state = foldWorldState(rows);
  assert.deepEqual(scenePlacement(rows, state, "lamp"), { plane: "floor", stackedOn: null }, "the turn-0 on-top-of row is older than the turn-1 placement, so it no longer applies");
});

test("scenePlacement: a fresher on-top-of snapshot than the current placement still wins", () => {
  const rows = [
    ...ROWS,
    { subject: "lamp@turn1", predicate: "mgx:on-top-of", object: "desk" },
  ];
  const state = foldWorldState(rows);
  assert.deepEqual(scenePlacement(rows, state, "lamp"), { plane: "surface", stackedOn: "desk" }, "the turn-1 position is at least as new as the turn-0 placement");
});

// ---- roomSceneLayout ----------------------------------------------------------

const STACK_ROWS = [
  { subject: "player", predicate: "rdf:type", object: "adventurer" },
  { subject: "player", predicate: "mgx:currently-in", object: "study" },
  { subject: "study", predicate: "rdf:type", object: "room" },
  { subject: "desk", predicate: "rdf:type", object: "furniture" },
  { subject: "desk", predicate: "mgx:fixed-in", object: "study" },
  { subject: "lamp", predicate: "rdf:type", object: "portable" },
  { subject: "lamp", predicate: "mgx:located-in", object: "study" },
  { subject: "lamp", predicate: "mgx:on-top-of", object: "desk" },
  { subject: "key", predicate: "rdf:type", object: "portable" },
  { subject: "key", predicate: "mgx:located-in", object: "study" },
  { subject: "key", predicate: "mgx:on-top-of", object: "lamp" },
  { subject: "portrait", predicate: "rdf:type", object: "furniture" },
  { subject: "portrait", predicate: "mgx:fixed-in", object: "study" },
  { subject: "portrait", predicate: "rdfs:subClassOf", object: "painting" },
  { subject: "painting", predicate: "mgx:default-plane", object: "wall" },
  { subject: "candle", predicate: "rdf:type", object: "portable" },
  { subject: "candle", predicate: "mgx:located-in", object: "study" },
  { subject: "candle", predicate: "mgx:on-top-of", object: "shelf" },
];

test("roomSceneLayout: a transitive on-top-of chain resolves to one stack, top item first, floor base last", () => {
  const state = foldWorldState(STACK_ROWS);
  const layout = roomSceneLayout(STACK_ROWS, state, "study");
  const chain = layout.floor.find((s) => s.items.some((i) => i.subject === "desk"));
  assert.deepEqual(chain.items.map((i) => i.subject), ["key", "lamp", "desk"]);
});

test("roomSceneLayout: a wall-mounted object (its class default, via ancestor walk) renders in the wall band, not a floor stack", () => {
  const state = foldWorldState(STACK_ROWS);
  const layout = roomSceneLayout(STACK_ROWS, state, "study");
  assert.deepEqual(layout.wall, [{ subject: "portrait", spriteClass: "furniture" }]);
  assert.ok(!layout.floor.some((s) => s.items.some((i) => i.subject === "portrait")));
});

test("roomSceneLayout: an item resting on a base that isn't itself visible in the room demotes to its own single-item floor stack", () => {
  const state = foldWorldState(STACK_ROWS);
  const layout = roomSceneLayout(STACK_ROWS, state, "study");
  const candleStack = layout.floor.find((s) => s.items.some((i) => i.subject === "candle"));
  assert.deepEqual(candleStack.items.map((i) => i.subject), ["candle"], "the shelf it names was never placed in this room, so candle stands on its own");
});

test("roomSceneLayout: floor stacks and the wall band both come out in a fixed, deterministic order", () => {
  const state = foldWorldState(STACK_ROWS);
  const layout = roomSceneLayout(STACK_ROWS, state, "study");
  const bases = layout.floor.map((s) => s.items[s.items.length - 1].subject);
  assert.deepEqual(bases, [...bases].sort(), "floor stacks sort by their own base subject");
  const again = roomSceneLayout(STACK_ROWS, state, "study");
  assert.deepEqual(layout, again, "the same input always lays out the same way");
});

test("roomSceneLayout: an empty room yields an empty wall band and no floor stacks, never a fabricated one", () => {
  const rows = [{ subject: "garden", predicate: "rdf:type", object: "room" }, { subject: "player", predicate: "mgx:currently-in", object: "garden" }];
  const state = foldWorldState(rows);
  assert.deepEqual(roomSceneLayout(rows, state, "garden"), { wall: [], floor: [] });
});

test("roomSceneLayout: a furniture-typed painting still lands on the wall, not the floor, when furniture's own default conflicts with painting's — Ashcombe Hall's own portrait/furniture shape", () => {
  const rows = [
    { subject: "drawing-room", predicate: "rdf:type", object: "room" },
    { subject: "player", predicate: "mgx:currently-in", object: "drawing-room" },
    { subject: "portrait", predicate: "rdf:type", object: "furniture" },
    { subject: "portrait", predicate: "mgx:fixed-in", object: "drawing-room" },
    { subject: "portrait", predicate: "rdfs:subClassOf", object: "painting" },
    { subject: "furniture", predicate: "mgx:default-plane", object: "floor" },
    { subject: "painting", predicate: "mgx:default-plane", object: "wall" },
  ];
  const state = foldWorldState(rows);
  const layout = roomSceneLayout(rows, state, "drawing-room");
  assert.deepEqual(layout.wall, [{ subject: "portrait", spriteClass: "furniture" }]);
  assert.deepEqual(layout.floor, [], "the portrait never lands on the floor despite its own generic rdf:type furniture");
});

// ---- roomKindForRoom ----------------------------------------------------------

test("roomKindForRoom: rdf:type outdoor-space reads as outdoor", () => {
  const rows = [{ subject: "garden", predicate: "rdf:type", object: "room" }, { subject: "garden", predicate: "rdf:type", object: "outdoor-space" }];
  assert.equal(roomKindForRoom(rows, "garden"), "outdoor");
});

test("roomKindForRoom: rdf:type underground-space reads as underground", () => {
  const rows = [{ subject: "cellar", predicate: "rdf:type", object: "room" }, { subject: "cellar", predicate: "rdf:type", object: "underground-space" }];
  assert.equal(roomKindForRoom(rows, "cellar"), "underground");
});

test("roomKindForRoom: every other room, including one with no space typing at all, defaults to indoor", () => {
  assert.equal(roomKindForRoom(ROWS, "study"), "indoor");
  assert.equal(roomKindForRoom([], "nowhere"), "indoor");
});

// ---- visitedRoomGraph --------------------------------------------------------

// A small three-room house, mirroring Ashcombe Hall's own north/south chain:
// study <-north/south-> library <-north/south-> drawing-room, plus a spare
// unconnected exit (down, to a cellar) off the study, so a hint has something
// to point at without the cellar ever becoming a node.
const MAP_ROWS = [
  { subject: "player", predicate: "rdf:type", object: "adventurer" },
  { subject: "player", predicate: "mgx:currently-in", object: "library" },
  { subject: "study", predicate: "rdf:type", object: "room" },
  { subject: "library", predicate: "rdf:type", object: "room" },
  { subject: "drawing-room", predicate: "rdf:type", object: "room" },
  { subject: "cellar", predicate: "rdf:type", object: "room" },
  { subject: "study", predicate: "mgx:has-exit-north", object: "library" },
  { subject: "library", predicate: "mgx:has-exit-south", object: "study" },
  { subject: "library", predicate: "mgx:has-exit-north", object: "drawing-room" },
  { subject: "drawing-room", predicate: "mgx:has-exit-south", object: "library" },
  { subject: "study", predicate: "mgx:has-exit-down", object: "cellar" },
];

test("visitedRoomGraph: a room with a north exit to another visited room sits one row above it", () => {
  const state = foldWorldState(MAP_ROWS);
  const graph = visitedRoomGraph(state, ["study", "library"]);
  const study = graph.nodes.find((n) => n.id === "study");
  const library = graph.nodes.find((n) => n.id === "library");
  assert.equal(study.y, library.y + 1, "study (south of library) sits one row below it");
  assert.equal(study.x, library.x, "a pure north/south edge never shifts column");
});

test("visitedRoomGraph: the current room is flagged, from the player's own placement", () => {
  const state = foldWorldState(MAP_ROWS);
  const graph = visitedRoomGraph(state, ["study", "library"]);
  assert.equal(graph.nodes.find((n) => n.id === "library").current, true);
  assert.equal(graph.nodes.find((n) => n.id === "study").current, false);
});

test("visitedRoomGraph: an edge only exists between two rooms BOTH already visited", () => {
  const state = foldWorldState(MAP_ROWS);
  const graph = visitedRoomGraph(state, ["study", "library"]);
  assert.equal(graph.nodes.length, 2, "the drawing-room is never drawn as a node — it hasn't been visited");
  assert.ok(!graph.nodes.some((n) => n.id === "drawing-room"));
  assert.ok(graph.edges.some((e) => (e.from === "study" && e.to === "library") || (e.from === "library" && e.to === "study")));
});

test("visitedRoomGraph: an exit toward an unvisited room is a direction-only hint, never a filled node", () => {
  const state = foldWorldState(MAP_ROWS);
  const graph = visitedRoomGraph(state, ["study"]);
  assert.equal(graph.nodes.length, 1);
  assert.ok(graph.hints.some((h) => h.from === "study" && h.direction === "north"), "the known-but-unvisited exit north to the library shows up as a hint");
  assert.ok(graph.hints.some((h) => h.from === "study" && h.direction === "down"), "the exit down to the cellar shows up as a hint too");
  assert.ok(!graph.hints.some((h) => h.direction === "north" && "room" in h), "a hint never carries the unvisited room's own name");
});

test("visitedRoomGraph: two rooms visited but not reachable from each other lay out as separate, non-overlapping blocks", () => {
  const disconnected = [
    ...MAP_ROWS,
    { subject: "attic", predicate: "rdf:type", object: "room" },
  ];
  const state = foldWorldState(disconnected);
  const graph = visitedRoomGraph(state, ["study", "attic"]);
  assert.equal(graph.nodes.length, 2);
  const study = graph.nodes.find((n) => n.id === "study");
  const attic = graph.nodes.find((n) => n.id === "attic");
  assert.notEqual(study.x, attic.x, "disconnected components never share a column");
  assert.equal(graph.edges.length, 0, "no edge is invented between rooms with no shared exit fact");
});

// ---- allRoomIds — edit mode's whole-map feed --------------------------------

test("allRoomIds: every room the world types as 'room', regardless of whether it's been visited", () => {
  assert.deepEqual(new Set(allRoomIds(MAP_ROWS)), new Set(["study", "library", "drawing-room", "cellar"]));
});

test("allRoomIds: feeding it straight into visitedRoomGraph draws every defined room, not just a visited subset", () => {
  const state = foldWorldState(MAP_ROWS);
  const graph = visitedRoomGraph(state, allRoomIds(MAP_ROWS));
  assert.deepEqual(new Set(graph.nodes.map((n) => n.id)), new Set(["study", "library", "drawing-room", "cellar"]));
});

test("allRoomIds: a world with no rooms at all yields an empty list, never a fabricated one", () => {
  assert.deepEqual(allRoomIds([{ subject: "cabinet", predicate: "rdf:type", object: "furniture" }]), []);
});

// ---- goalStatusLines ----------------------------------------------------------

const OBJECTIVE_ROWS = [...ROWS, { subject: "letter", predicate: "mgx:is-objective", object: "true" }];

test("goalStatusLines: an objective not yet exposed at all reads as the opening-line-level knowledge only", () => {
  const state = foldWorldState(OBJECTIVE_ROWS);
  const lines = goalStatusLines(OBJECTIVE_ROWS, state, []);
  assert.deepEqual(lines, [{ subject: "letter", status: "unknown", text: "there's a sought-after letter somewhere." }]);
});

test("goalStatusLines: never claims a known room before the room holding the object has actually been visited", () => {
  const opened = [
    ...OBJECTIVE_ROWS,
    { subject: "cabinet@turn1", predicate: "mgx:is-open", object: "true" },
    { subject: "letter@turn1", predicate: "mgx:located-in", object: "cabinet" },
  ];
  const state = foldWorldState(opened);
  const lines = goalStatusLines(opened, state, []); // study never visited
  assert.deepEqual(lines, [{ subject: "letter", status: "unknown", text: "there's a sought-after letter somewhere." }]);
});

test("goalStatusLines: exposed with a known room but not yet carried reads 'last known: ... is in the ...'", () => {
  const opened = [
    ...OBJECTIVE_ROWS,
    { subject: "cabinet@turn1", predicate: "mgx:is-open", object: "true" },
    { subject: "letter@turn1", predicate: "mgx:located-in", object: "cabinet" },
  ];
  const state = foldWorldState(opened);
  const lines = goalStatusLines(opened, state, ["study"]);
  assert.deepEqual(lines, [{ subject: "letter", status: "known", text: "last known: the letter is in the study." }]);
});

test("goalStatusLines: carried reuses runAdventureAutoplayTick's own win phrasing, regardless of visited rooms", () => {
  const carried = [
    ...OBJECTIVE_ROWS,
    { subject: "cabinet@turn1", predicate: "mgx:is-open", object: "true" },
    { subject: "letter@turn1", predicate: "mgx:located-in", object: "cabinet" },
    { subject: "letter@turn2", predicate: "mgx:located-in", object: "player" },
  ];
  const state = foldWorldState(carried);
  const lines = goalStatusLines(carried, state, []);
  assert.deepEqual(lines, [{ subject: "letter", status: "carried", text: "carrying the letter — the adventure is won." }]);
});

test("goalStatusLines: one line per distinct objective marker, each with its own independent status", () => {
  const twoGoals = [
    ...OBJECTIVE_ROWS,
    { subject: "key", predicate: "mgx:is-objective", object: "true" },
  ];
  const state = foldWorldState(twoGoals);
  const lines = goalStatusLines(twoGoals, state, []);
  assert.equal(lines.length, 2);
  assert.deepEqual(new Set(lines.map((l) => l.subject)), new Set(["letter", "key"]));
});

test("goalStatusLines: a world with no objective marker at all yields no lines", () => {
  const state = foldWorldState(ROWS);
  assert.deepEqual(goalStatusLines(ROWS, state, []), []);
});

test("roomCaptionText: built only from worldDigestRows' own rows about the room and what's placed in it", () => {
  const state = foldWorldState(ROWS);
  const caption = roomCaptionText(ROWS, state, "study");
  assert.match(caption, /Desk is fixed in the study\./);
  assert.match(caption, /Lamp is in the study\./);
  assert.ok(!/[Ll]etter/.test(caption), "a hidden fact never surfaces in the caption either");
});

test("roomCaptionText: a room with no recorded facts about itself falls to the honest 'nothing more written down' floor — and never restates the player's own trivial 'you are here'", () => {
  const rows = [{ subject: "player", predicate: "mgx:currently-in", object: "garden" }];
  const state = foldWorldState(rows);
  assert.equal(roomCaptionText(rows, state, "garden"), "Nothing more about the garden is written down yet.");
});

test("pillsForRoom: reflects roomAffordances' own output faithfully for the current room, in the same order", () => {
  const state = foldWorldState(ROWS);
  assert.deepEqual(pillsForRoom(ROWS, state, "study"), ["unlock cabinet", "examine desk", "take lamp"]);
});

test("pillsForRoom: a room with nothing placed in it offers no pills at all", () => {
  const rows = [{ subject: "garden", predicate: "rdf:type", object: "room" }, { subject: "player", predicate: "mgx:currently-in", object: "garden" }];
  const state = foldWorldState(rows);
  assert.deepEqual(pillsForRoom(rows, state, "garden"), []);
});

test("pillsForRoom: refreshes as the room's own state changes — unlocking a container swaps its pill for open's", () => {
  const locked = [
    { subject: "study", predicate: "rdf:type", object: "room" },
    { subject: "cabinet", predicate: "mgx:is-container", object: "true" },
    { subject: "cabinet", predicate: "mgx:stands-locked-in", object: "study" },
  ];
  assert.deepEqual(pillsForRoom(locked, foldWorldState(locked), "study"), ["unlock cabinet"]);

  const unlocked = [...locked, { subject: "cabinet@turn1", predicate: "mgx:fixed-in", object: "study" }];
  assert.deepEqual(pillsForRoom(unlocked, foldWorldState(unlocked), "study"), ["open cabinet"]);
});

// ---- suggestionsForTerm — edit mode's cursor-driven pills --------------------

test("suggestionsForTerm: a taught synonym and related concept both surface, the queried term itself excluded", () => {
  const rows = [
    { subject: "lamp", predicate: "mgx:synonym", object: "lantern" },
    { subject: "lamp", predicate: "mgx:relatedTo", object: "light" },
  ];
  assert.deepEqual(suggestionsForTerm(rows, "lamp"), ["lantern", "light"]);
});

test("suggestionsForTerm: the vertical is-a ancestor chain contributes too, nearest-first, the term itself dropped", () => {
  const rows = [
    { subject: "poodle", predicate: "rdfs:subClassOf", object: "dog" },
    { subject: "dog", predicate: "rdfs:subClassOf", object: "animal" },
  ];
  assert.deepEqual(suggestionsForTerm(rows, "poodle"), ["dog", "animal"]);
});

test("suggestionsForTerm: an honest empty list when the term mints no concept and has no ancestors — never a fabricated suggestion", () => {
  assert.deepEqual(suggestionsForTerm([{ subject: "cabinet", predicate: "rdf:type", object: "furniture" }], "cabinet"), []);
  assert.deepEqual(suggestionsForTerm([], "anything"), []);
});

test("suggestionsForTerm: a blank term is an honest empty list, never a lookup against nothing", () => {
  assert.deepEqual(suggestionsForTerm([{ subject: "lamp", predicate: "mgx:synonym", object: "lantern" }], ""), []);
  assert.deepEqual(suggestionsForTerm([{ subject: "lamp", predicate: "mgx:synonym", object: "lantern" }], "   "), []);
});

// ---- renderAdventureHtml: page structure ------------------------------------

const WORLD_PAYLOAD = { name: "ashcombe-hall", facts: [], rules: [], opening: "the adventure begins." };

test("renderAdventureHtml: the room stage, sprite row and caption are present", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.match(html, /id="roomFrame"/);
  assert.match(html, /id="spriteRow"/);
  assert.match(html, /id="caption"/);
  assert.match(html, /id="goalLine"/);
});

test("renderAdventureHtml: the world's own opening prose renders as a page note, escaped, right after the titlebar", () => {
  const html = renderAdventureHtml({ worldPayload: { ...WORLD_PAYLOAD, opening: 'a <script>alert(1)</script> opening line' } });
  const noteMatch = html.match(/<\/div>\s*<p class="page-note">([\s\S]*?)<\/p>/);
  assert.ok(noteMatch, "a .page-note paragraph follows the titlebar");
  assert.ok(!noteMatch[1].includes("<script>"), "the opening text is escaped, never raw HTML");
  assert.match(html, /body\.preview[^{]*\.page-note \{ display: none; \}/, "the note is hidden in preview mode");
});

test("renderAdventureHtml: boot() no longer copies the opening into #status — the page note carries it instead", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.doesNotMatch(html, /statusEl\.textContent = ADVENTURE\.world\.opening/);
});

test("renderAdventureHtml: quest, the room frame, the controls row, the goal/status lines and the satchel appear in that order in the left column", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  const leftBlock = html.match(/<div class="stage-left">[\s\S]*?<\/div>\s*<\/div>\s*<aside/)[0];
  const order = ["panel goals", 'id="roomFrame"', 'id="playControls"', 'id="goalLine"', 'id="status"', "panel carrying"]
    .map((needle) => leftBlock.indexOf(needle));
  assert.ok(order.every((i) => i !== -1), "every expected element is present in the left column");
  for (let i = 1; i < order.length; i++) assert.ok(order[i - 1] < order[i], "the left column keeps quest, room, controls, goal/status, satchel in that order");
});

test("renderAdventureHtml: the 2/3-1/3 stage grid, the command box and the manor map both sit inside .stage-left, the aside keeps only chatlog/pills/caption", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.match(html, /\.stage \{[^}]*grid-template-columns: minmax\(0, 2fr\) minmax\(280px, 1fr\)/);
  const leftBlock = html.match(/<div class="stage-left">[\s\S]*?<\/div>\s*<\/div>\s*<aside/)[0];
  assert.match(leftBlock, /panel command/, "the command box lives in the left column");
  assert.match(leftBlock, /speak to the manor/);
  assert.match(leftBlock, /id="chatform"/, "the chat entry form moved into the command box");
  assert.match(leftBlock, /panel roommap/, "the manor map moved into the left column, last");
  assert.ok(leftBlock.indexOf("panel command") < leftBlock.indexOf("panel roommap"), "the command box sits between the satchel and the map");
  const asideBlock = html.match(/<aside class="side"[\s\S]*?<\/aside>/)[0];
  assert.match(asideBlock, /id="chatlog"/);
  assert.match(asideBlock, /id="pills"/);
  assert.match(asideBlock, /id="caption"/);
  assert.ok(!asideBlock.includes("chatform"), "the chat entry form no longer lives in the aside");
  assert.ok(!asideBlock.includes("roommap"), "the map no longer lives in the aside");
});

test("renderAdventureHtml: the room frame carries the wall band, the floor band and the adventurer's own pinned-right slot", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.match(html, /id="wallRow"/);
  assert.match(html, /id="floorRow"/);
  assert.match(html, /id="youSlot"/);
  assert.match(html, /\.you-slot \{[^}]*margin-left: auto/, "the adventurer's slot pins to the right edge of the room");
  assert.match(html, /\.sprite-stack \{[^}]*flex-direction: column/, "a stack renders as a column, top item first");
});

test("renderAdventureHtml: redraw() builds the scene from roomSceneLayout and renders the player's own card alone into #youSlot", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.match(html, /const roomSceneLayout = /, "the layout helper is spliced in, not re-implemented");
  assert.match(html, /roomSceneLayout\(snap\.rows, snap\.state, snap\.here\)/);
  assert.match(html, /youSlotEl\.innerHTML = spriteCardHtml\("you", "adventurer"/);
});

test("renderAdventureHtml: every stacked item but the floor base renders as a compact, label-less card, so a resting item's own name/badge chrome never reads as a gap between it and what it rests on", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.match(html, /function stackedSpriteCardHtml\(/);
  assert.ok(!/stackedSpriteCardHtml[\s\S]{0,300}sprite-label/.test(html), "the compact card never carries the name/badge block");
  const floorRowBlock = html.match(/floorRowEl\.innerHTML = [\s\S]*?\}\);/)[0];
  assert.match(floorRowBlock, /baseIndex/, "the base (floor-standing) item in each stack is rendered differently from the items resting on it");
  assert.match(floorRowBlock, /stackedSpriteCardHtml/);
});

test("renderAdventureHtml: the room frame carries a room-kind attribute and a top-right room-kind icon, both filled every redraw", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.match(html, /id="roomKindIcon"/);
  assert.match(html, /const roomKindForRoom = /, "the room-kind helper is spliced in, not re-implemented");
  assert.match(html, /roomFrameEl\.setAttribute\("data-room-kind", roomKindForRoom\(snap\.rows, snap\.here\)\)/);
  assert.match(html, /\.room-frame\[data-room-kind="outdoor"\]/);
  assert.match(html, /\.room-frame\[data-room-kind="underground"\]/);
});

test("renderAdventureHtml: a double-click on a pill fills the input and submits it, leaving the plain click's fill-only behavior untouched", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.match(html, /pillsEl\.addEventListener\("dblclick"/);
  assert.match(html, /pillsEl\.addEventListener\("click"/);
  const clickBlock = html.match(/pillsEl\.addEventListener\("click"[\s\S]*?\}\);/)[0];
  assert.ok(!clickBlock.includes("requestSubmit"), "a single click never submits");
  const dblclickBlock = html.match(/pillsEl\.addEventListener\("dblclick"[\s\S]*?\}\);/)[0];
  assert.match(dblclickBlock, /chatformEl\.requestSubmit\(\)/);
});

test("renderAdventureHtml: the chat dock's log, pills row and input form are all present", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.match(html, /id="chatlog"/);
  assert.match(html, /id="pills"/);
  assert.match(html, /id="chatform"/);
  assert.match(html, /id="chatq"/);
});

test("renderAdventureHtml: the pill row reads the room's affordances through the shared tmctAdventure global, not a re-implementation", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.match(html, /tmctAdventure\.roomAffordances/);
  assert.match(html, /renderPills\(/);
});

test("renderAdventureHtml: the play/pause/step/reset controls are all present", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.match(html, /id="playBtn"/);
  assert.match(html, /id="stepBtn"/);
  assert.match(html, /id="resetBtn"/);
  assert.match(html, /id="turnLabel"/);
});

test("renderAdventureHtml: the sprite layer resolves each object through the property-aware resolver, falling back to the shared registry", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.match(html, /resolveSpriteAsset/);
  assert.match(html, /SPRITE_REGISTRY/);
});

test("renderAdventureHtml: an object resolves by its OWN name (via a synthetic ancestry edge to its declared class), not just its declared class", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.match(html, /spriteAncestryRows/);
  assert.match(html, /factsForSubject/);
});

test("renderAdventureHtml: the sprite template set is embedded as page data, defaulting to an empty array", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  const m = /const ADVENTURE = (.*);/.exec(html);
  const data = JSON.parse(m[1]);
  assert.deepEqual(data.spriteTemplates, []);
});

test("renderAdventureHtml: a passed-in spriteTemplates array is embedded verbatim", () => {
  const templates = [{ classes: ["cabinet"], svg: "<svg>cabinet</svg>" }];
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD, spriteTemplates: templates });
  const m = /const ADVENTURE = (.*);/.exec(html);
  const data = JSON.parse(m[1]);
  assert.deepEqual(data.spriteTemplates, templates);
});

test("renderAdventureHtml: the world payload is embedded, not fetched separately", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  const m = /const ADVENTURE = (.*);/.exec(html);
  assert.ok(m, "const ADVENTURE = ...; not found in the rendered page");
  const data = JSON.parse(m[1]);
  assert.equal(data.world.name, "ashcombe-hall");
});

test("renderAdventureHtml: the shared ticker is spliced in, not re-implemented", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.match(html, /const createTicker = /);
  assert.match(html, /createTicker\(\{/);
});

test("renderAdventureHtml: the page references its sibling bundle by a same-origin relative path only", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.match(html, /<script src="\.\/adventure-browser\.bundle\.js"><\/script>/);
  assert.ok(!/(?:src|href)=["']https?:/.test(html), "no external resource loads");
});

test("renderAdventureHtml: preview mode is a runtime query-param switch, not a second build path", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.match(html, /previewMaxTicks/);
  assert.match(html, /get\("preview"\)/);
  assert.match(html, /classList\.toggle\("preview"/);
});

test("renderAdventureHtml: self-contained, both theme schemes present, no color-mix", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.ok(html.includes("prefers-color-scheme: dark"));
  assert.ok(html.includes('data-theme="dark"') && html.includes('data-theme="light"'));
  assert.ok(!html.includes("color-mix("));
});

test("renderAdventureHtml: escapes a custom title", () => {
  const html = renderAdventureHtml({ title: 'a <script>alert(1)</script> title', worldPayload: WORLD_PAYLOAD });
  assert.ok(!html.includes("<script>alert(1)</script> title"));
  assert.match(html, /&lt;script&gt;/);
});

test("renderAdventureHtml: deterministic — byte-identical output for identical input", () => {
  assert.equal(renderAdventureHtml({ worldPayload: WORLD_PAYLOAD }), renderAdventureHtml({ worldPayload: WORLD_PAYLOAD }));
});

// ---- renderAdventureHtml: the world editor's own markup ---------------------
// (the live behavior — seeding, room click, the two-way sync, suggestion
// pills, the legend — is exercised end to end in
// e2e/pages-adventure-edit.test.mjs; these pin the structure only.)

test("renderAdventureHtml: the edit-mode toggle and its whole textarea/map/room-detail/legend panel are all present", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.match(html, /id="editModeBtn"/);
  assert.match(html, /id="editorText"/);
  assert.match(html, /id="editorPills"/);
  assert.match(html, /id="editorStatus"/);
  assert.match(html, /id="editMapWrap"/);
  assert.match(html, /id="roomDetailTitle"/);
  assert.match(html, /id="roomDetailSprites"/);
  assert.match(html, /id="roomDetailCaption"/);
  assert.match(html, /id="legendList"/);
});

test("renderAdventureHtml: the editor's textarea is seeded through renderWorldEditorText, spliced in rather than re-implemented", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.match(html, /const renderWorldEditorText = /);
  assert.match(html, /const wordBeforeCursor = /);
  assert.match(html, /renderWorldEditorText\(editRows, editState\)/);
});

test("renderAdventureHtml: the whole map reuses visitedRoomGraph fed allRoomIds — a parameter, not a second layout", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.match(html, /const allRoomIds = /);
  assert.match(html, /visitedRoomGraph\(state, allRoomIds\(rows\)\)/);
});

test("renderAdventureHtml: edit-mode writes reach the store through session.applyEdit, never a direct memory write from this page", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.match(html, /session\.applyEdit\(/);
});

test("renderAdventureHtml: suggestion pills read the browser bundle's relatedForTerm/classAncestorChain through the shared global", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.match(html, /tmctAdventure\.relatedForTerm/);
  assert.match(html, /tmctAdventure\.classAncestorChain/);
});

test("renderAdventureHtml: the large sprite tier is embedded as page data — no runtime fetch — with the icon tier as a working fallback", () => {
  const largeTemplates = [{ classes: ["cabinet"], svg: "<svg>large cabinet</svg>" }];
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD, largeSpriteTemplates: largeTemplates });
  const m = /const ADVENTURE = (.*);/.exec(html);
  const data = JSON.parse(m[1]);
  assert.deepEqual(data.largeSpriteTemplates, largeTemplates, "the large tier travels as embedded page data");
  assert.doesNotMatch(html, /sprites-pack\/manifest\.json/, "the page no longer fetches the manifest at runtime");
  assert.match(html, /ADVENTURE\.largeSpriteTemplates/);
  assert.match(html, /ADVENTURE\.spriteTemplates/, "the icon tier stays wired as the fallback");
  assert.ok(!/(?:src|href)=["']https?:/.test(html), "still no external resource loads");
});

test("renderAdventureHtml: with no large tier passed, the icon tier is the active set and the embed is an empty array", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  const m = /const ADVENTURE = (.*);/.exec(html);
  const data = JSON.parse(m[1]);
  assert.deepEqual(data.largeSpriteTemplates, []);
});

test("renderAdventureHtml: the manor map draws each room as a named board footprint, the label inside the rectangle", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.match(html, /room-node[\s\S]{0,500}<rect x="/, "a room renders as a rect footprint");
  assert.match(html, /\.roommap \.room-node rect \{ fill: var\(--parchment\)/, "the footprint fills with the parchment token in both schemes");
  assert.match(html, /\.map-viewport \{[^}]*background: var\(--baize\)/, "the board sits on the baize felt");
});

test("renderAdventureHtml: the room scene carries a door plaque naming the current room, filled from the live snapshot", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.match(html, /id="roomName"/);
  assert.match(html, /roomNameEl\.textContent = "the " \+ snap\.here/);
});

test("renderAdventureHtml: every sprite gets a class-badge alongside its own real name — chrome layered over content, not replacing it", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.match(html, /class="class-badge"/);
  assert.match(html, /spriteCardHtml\(/);
  // The badge vocabulary is a genre synonym layer, never a substitute for
  // the sprite's own label — spriteCardHtml always renders BOTH.
  assert.match(html, /CLASS_BADGE = \{/);
});
