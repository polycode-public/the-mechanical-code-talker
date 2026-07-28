// mud-viz: renderMudHtml is a pure string builder over an embedded world
// payload and character roster, mirroring adventure-viz.test.mjs's own
// style — these tests pin the page's STRUCTURE (the default cast's
// character-agnostic panes, the deck's controls including the players
// slider, the explanatory note, the omniscient burrow survey), plus the pure
// render-glue functions the page splices into its own inline script: speciesOfCharacter, mudRoomSceneObjects, carriedItemsFor,
// levelsOf, charactersInRoom, burrowGraph, diggableDirections, itemLabel,
// isCreature.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderMudHtml, paneMarkup, speciesOfCharacter, mudRoomSceneObjects, carriedItemsFor,
  levelsOf, charactersInRoom, burrowGraph, diggableDirections, itemLabel, isCreature,
} from "../../src/services/mud-viz.mjs";
import { foldWorldState } from "../../src/services/adventure.mjs";

const CHARACTERS = [
  { id: "mole-1", species: "mole" },
  { id: "vole-1", species: "vole" },
  { id: "badger-2", species: "badger" },
  { id: "groundhog-1", species: "groundhog" },
];

const WORLD_PAYLOAD = {
  name: "mud-garden",
  facts: [
    { subject: "garden", predicate: "rdf:type", object: "room" },
    { subject: "garden", predicate: "rdf:type", object: "outdoor-space" },
    { subject: "burrow-1", predicate: "rdf:type", object: "room" },
    { subject: "garden", predicate: "mgx:has-exit-down", object: "burrow-1" },
    { subject: "burrow-1", predicate: "mgx:has-exit-up", object: "garden" },
    { subject: "mole-1", predicate: "rdf:type", object: "adventurer" },
    { subject: "mole-1", predicate: "mgx:currently-in", object: "garden" },
    { subject: "carrot", predicate: "rdf:type", object: "carrot" },
    { subject: "carrot", predicate: "mgx:located-in", object: "garden" },
  ],
  rules: [],
  opening: "a vegetable garden",
};

const BURROW_ROWS = [
  { subject: "garden", predicate: "rdf:type", object: "room" },
  { subject: "garden", predicate: "rdf:type", object: "outdoor-space" },
  { subject: "burrow-1", predicate: "rdf:type", object: "room" },
  { subject: "burrow-1", predicate: "rdf:type", object: "underground-space" },
  { subject: "sett-1", predicate: "rdf:type", object: "room" },
  { subject: "sett-1", predicate: "rdf:type", object: "underground-space" },
  { subject: "garden", predicate: "mgx:has-exit-down", object: "burrow-1" },
  { subject: "burrow-1", predicate: "mgx:has-exit-up", object: "garden" },
  { subject: "burrow-1", predicate: "mgx:has-exit-east", object: "sett-1" },
  { subject: "sett-1", predicate: "mgx:has-exit-west", object: "burrow-1" },
  { subject: "mole-1", predicate: "mgx:currently-in", object: "garden" },
  { subject: "root-burrow-1-south", predicate: "mgx:located-in", object: "mole-1" },
];

test("renderMudHtml: ships the default cast's panes, character-agnostic, and no more", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  for (const slot of ["a", "b"]) {
    assert.match(html, new RegExp(`id="window-${slot}"`), `window-${slot} is present`);
    assert.match(html, new RegExp(`class="mud-window pane-${slot}"[^>]*id="window-${slot}"`), `window-${slot} carries the mud-window class`);
  }
  assert.doesNotMatch(html, /id="window-c"/, "the shipped stage holds the default two, whatever the roster holds");
  assert.match(html, /id="mudStage" data-panes="2"/, "the grid lays out against the count the stage declares");
  assert.match(html, /id="window-a" data-slot="a" data-character=""/, "a pane binds its character at boot, not at build time");
});

test("renderMudHtml: a roster smaller than the default cast ships only the panes it can fill", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: [CHARACTERS[0]] });
  assert.match(html, /id="mudStage" data-panes="1"/);
  assert.match(html, /id="window-a"/);
  assert.doesNotMatch(html, /id="window-b"/, "no pane is shipped for an animal the roster does not have");
});

test("paneMarkup: one slot's whole pane, keyed on the slot alone", () => {
  const html = paneMarkup("d");
  assert.match(html, /class="mud-window pane-d" id="window-d" data-slot="d" data-character=""/);
  assert.match(html, /id="window-d-chatlog"/);
  assert.match(html, /id="window-d-dir-north"/);
});

test("renderMudHtml: the deck carries play/turns/players/npcs/delay/max-turns/reset controls", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  assert.match(html, /id="autoToggle"/);
  assert.match(html, /id="globalTurnCount"/);
  assert.match(html, /id="playerCountSlider"/);
  assert.match(html, /id="npcCountSlider"/);
  assert.match(html, /id="delaySlider"/);
  assert.match(html, /id="maxTurnsSlider"/);
  assert.match(html, /id="resetBtn"/);
});

test("renderMudHtml: the players slider runs on the three counts, starting at two", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  assert.match(html, /<label class="deck-slider">players/, "the control says what it picks");
  assert.match(html, /id="playerCountSlider" min="0" max="2" step="1"\s+value="1"/, "three detents, the middle one on load");
  for (const count of [1, 2, 4]) {
    assert.match(html, new RegExp(`<option value="\\d" label="${count}">`), `${count} is one of the detents`);
  }
  assert.match(html, /"playerCounts":\[1,2,4\]/, "the page script picks the count off the same list");
  assert.match(html, /"defaultPlayerCount":2/);
  assert.match(html, /"paneSlots":\["a","b","c","d"\]/, "there is a slot for every count the slider offers");
});

test("renderMudHtml: the npcs slider runs one to ten, starting at two, and adds no pane", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  assert.match(html, /<label class="deck-slider">npcs/, "the control says what it picks");
  assert.match(html, /id="npcCountSlider" min="1" max="10" step="1"\s+value="2"/, "a plain count, defaulting to two");
  assert.match(html, /aria-valuetext="2 npcs"/);
  assert.match(html, /<datalist id="npcCountTicks">/, "the range carries its own detent ticks");
  assert.match(html, /"defaultNpcCount":2/, "the page script boots the same count the markup shows");
  assert.match(html, /id="mudStage" data-panes="2"/, "the npcs never take a pane of their own");
  assert.match(html, /class="key-npcs"/, "the survey keys them together, apart from the panes' own colours");
});

test("renderMudHtml: the stage is rebuilt in the browser from the same pane builder the page ships", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  assert.match(html, /const paneMarkup = function paneMarkup/, "paneMarkup is spliced into the page script");
  assert.match(html, /stage\.setAttribute\("data-panes"/, "a boot restates the count for the grid");
  assert.match(html, /\.mud-stage\[data-panes="1"\]/, "a single character gets its own layout, not a half-empty grid");
  assert.match(html, /--actor-c:/, "a four-strong cast has four colours to tell its animals apart");
  assert.match(html, /--actor-d:/);
  assert.match(html, /\.mud-window\.pane-d \{ border-top-color: var\(--actor-d\); \}/);
});

test("renderMudHtml: the page leads with the deck, not a headline", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  assert.doesNotMatch(html, /Multiple actors, one shared world/);
  assert.ok(
    html.indexOf('id="autoToggle"') < html.indexOf('id="window-a"'),
    "the controls come before the panes in document order",
  );
});

test("renderMudHtml: nothing in the page script auto-plays a pane on load", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  assert.doesNotMatch(html, /tickers\[[^\]]+\]\.play\(\)/, "no ticker is played outside a click handler");
});

test("renderMudHtml: the explanatory note names MUDII and Colossal Cave Adventure", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  assert.match(html, /MUDII/);
  assert.match(html, /mudii\.co\.uk/);
  assert.match(html, /Colossal Cave Adventure/);
  assert.match(html, /Multi Underground creature Dig/);
});

test("renderMudHtml: the omniscient burrow survey is present, distinct from any one pane", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  assert.match(html, /id="worldMap"/);
  assert.match(html, /id="worldMapBoard"/);
});

test("renderMudHtml: each pane carries its own chat dock and compass slots", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  for (const slot of ["a", "b"]) {
    assert.match(html, new RegExp(`id="window-${slot}-chatlog"`));
    assert.match(html, new RegExp(`id="window-${slot}-chatform"`));
    for (const direction of ["north", "south", "east", "west", "up", "down"]) {
      assert.match(html, new RegExp(`id="window-${slot}-dir-${direction}"`), `${slot} has a ${direction} slot`);
    }
  }
});

test("renderMudHtml: embeds the world payload and the whole roster as page data", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  assert.match(html, /MUD_PAGE_DATA/);
  assert.match(html, /mud-garden/);
  assert.match(html, /badger-2/, "the roster the page may draw from is embedded whole");
});

test("renderMudHtml: each pane carries the out-of-play banner a taken character falls back to", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  for (const slot of ["a", "b"]) {
    assert.match(html, new RegExp(`id="window-${slot}-fate"`), `${slot} can say what became of its character`);
  }
  assert.match(html, /reason === "starved" \? "starved" : "eaten"/, "the banner names the fate that actually happened");
  assert.match(html, /fate === "starved" \|\| reduceMotion/, "and a starved animal is never shown a predator's pounce");
  assert.match(html, /\.mud-window\.out-of-play \.pane-controls button \{ display: none; \}/,
    "an eaten character is never offered a control that would advance a turn the engine declines");
});

test("renderMudHtml: the page reads the engine's own seams rather than re-deriving them", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  assert.match(html, /tmctMud\.pickMudRoster/, "one roster draw feeds both the panes and the session opened for them");
  assert.match(html, /tmctMud\.castInRoom/, "who stands in the room comes from the engine, so the caption and the talk pills agree");
  assert.match(html, /tmctMud\.displayNameOf/, "a pouch label comes from the world's own display-name fact");
  assert.match(html, /turnsTaken\(\)/, "a pane shows its character's own turn count, not the shared one");
  assert.match(html, /tmctMud\.outOfPlayReasonOf\(/, "how a run ended is read from the engine every redraw, never guessed");
  assert.match(html, /tmctMud\.expandMudRoster/, "the extra animals are minted by the engine, not named in the page");
});

test("speciesOfCharacter: strips the trailing instance number", () => {
  assert.equal(speciesOfCharacter("mole-1"), "mole");
  assert.equal(speciesOfCharacter("groundhog-1"), "groundhog");
  assert.equal(speciesOfCharacter("badger-2"), "badger");
});

test("mudRoomSceneObjects: excludes the viewing character but keeps a room-mate and a loose object", () => {
  const rows = [
    { subject: "garden", predicate: "rdf:type", object: "room" },
    { subject: "mole-1", predicate: "mgx:currently-in", object: "garden" },
    { subject: "vole-1", predicate: "mgx:currently-in", object: "garden" },
    { subject: "carrot", predicate: "rdf:type", object: "carrot" },
    { subject: "carrot", predicate: "mgx:located-in", object: "garden" },
  ];
  const state = foldWorldState(rows);
  const objects = mudRoomSceneObjects(rows, state, "garden", "mole-1");
  const subjects = objects.map((o) => o.subject);
  assert.ok(!subjects.includes("mole-1"), "the viewer itself is excluded");
  assert.ok(subjects.includes("vole-1"), "a room-mate still shows");
  assert.ok(subjects.includes("carrot"), "a loose object still shows");
});

test("carriedItemsFor: only the named character's own carried things, sorted", () => {
  const rows = [
    { subject: "carrot", predicate: "mgx:located-in", object: "mole-1" },
    { subject: "seed", predicate: "mgx:located-in", object: "mole-1" },
    { subject: "stone", predicate: "mgx:located-in", object: "vole-1" },
  ];
  const state = foldWorldState(rows);
  const carried = carriedItemsFor(rows, state, "mole-1").map((i) => i.subject);
  assert.deepEqual(carried, ["carrot", "seed"]);
});

test("levelsOf: garden is level 0, a down exit is level -1, a lateral exit stays on the same level", () => {
  const state = foldWorldState(BURROW_ROWS);
  const levels = levelsOf(state, "garden");
  assert.equal(levels.get("garden"), 0);
  assert.equal(levels.get("burrow-1"), -1);
  assert.equal(levels.get("sett-1"), -1, "a lateral exit does not change depth");
});

test("charactersInRoom: only the characters actually placed in that room", () => {
  const rows = [
    { subject: "mole-1", predicate: "mgx:currently-in", object: "garden" },
    { subject: "vole-1", predicate: "mgx:currently-in", object: "burrow-1" },
  ];
  const state = foldWorldState(rows);
  assert.deepEqual(charactersInRoom(state, "garden", ["mole-1", "vole-1"]), ["mole-1"]);
});

test("burrowGraph: lays rooms out from their own exit directions, deeper rooms lower", () => {
  const state = foldWorldState(BURROW_ROWS);
  const graph = burrowGraph(state, ["garden", "burrow-1", "sett-1"], "garden");
  const at = (id) => graph.nodes.find((n) => n.id === id);
  assert.equal(at("garden").y, 0, "the surface room anchors the top row");
  assert.equal(at("burrow-1").y, 1, "a room dug down sits one row below the room it was dug from");
  assert.equal(at("sett-1").y, at("burrow-1").y, "an east exit keeps the row");
  assert.equal(at("sett-1").x, at("burrow-1").x + 1, "and moves one column right");
  assert.equal(at("garden").level, 0);
  assert.equal(at("burrow-1").level, -1);
  assert.equal(graph.edges.length, 2, "one edge per connected pair, not one per direction");
});

test("burrowGraph: two rooms dug the same way out of one room never share a cell", () => {
  const rows = [
    ...BURROW_ROWS,
    { subject: "burrow-1", predicate: "mgx:has-exit-south", object: "burrow-1-south" },
    { subject: "burrow-1-south", predicate: "mgx:has-exit-north", object: "burrow-1" },
    { subject: "burrow-1", predicate: "mgx:has-exit-down", object: "burrow-1-down" },
    { subject: "burrow-1-down", predicate: "mgx:has-exit-up", object: "burrow-1" },
  ];
  const state = foldWorldState(rows);
  const graph = burrowGraph(state, ["garden", "burrow-1", "sett-1", "burrow-1-south", "burrow-1-down"], "garden");
  const cells = graph.nodes.map((n) => `${n.x},${n.y}`);
  assert.equal(new Set(cells).size, cells.length, "every room lands on its own square");
});

test("burrowGraph: an exit toward a room outside the set is a direction-only hint", () => {
  const state = foldWorldState(BURROW_ROWS);
  const graph = burrowGraph(state, ["garden", "burrow-1"], "garden");
  assert.deepEqual(graph.hints, [{ from: "burrow-1", direction: "east" }]);
  assert.ok(!graph.nodes.some((n) => n.id === "sett-1"), "the unknown room itself is never drawn");
});

test("diggableDirections: outdoors digs down only, underground digs every side with no exit yet", () => {
  const state = foldWorldState(BURROW_ROWS);
  assert.deepEqual(diggableDirections(BURROW_ROWS, state, "garden"), [], "the garden's one vertical way is already open");
  assert.deepEqual(
    diggableDirections(BURROW_ROWS, state, "burrow-1"),
    ["north", "south", "west", "down"],
    "underground, every side without an exit is open soil",
  );
});

test("diggableDirections: an outdoor room with no shaft yet offers the dig down", () => {
  const rows = [
    { subject: "meadow", predicate: "rdf:type", object: "room" },
    { subject: "meadow", predicate: "rdf:type", object: "outdoor-space" },
  ];
  assert.deepEqual(diggableDirections(rows, foldWorldState(rows), "meadow"), ["down"]);
});

test("itemLabel: a dug object drops the room path it was minted from", () => {
  const roomIds = ["garden", "burrow-1", "burrow-1-south"];
  assert.equal(itemLabel("root-burrow-1-south", roomIds), "root");
  assert.equal(itemLabel("carrot", roomIds), "carrot", "a hand-authored prop is already a name");
  assert.equal(itemLabel("worm-1", roomIds), "worm-1", "a numbered instance keeps its number");
});

test("isCreature: an animal is placed with currently-in, a prop is not", () => {
  const state = foldWorldState(BURROW_ROWS);
  assert.equal(isCreature(state, "mole-1"), true);
  assert.equal(isCreature(state, "root-burrow-1-south"), false);
});
