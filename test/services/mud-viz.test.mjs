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
  provenanceStamps, peerTerm, claimantOf, wavingCharacters, nodeNameFor, offerBlobIn,
} from "../../src/services/mud-viz.mjs";
import { foldWorldState, isMudStatePredicate } from "../../src/services/adventure.mjs";

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

test("renderMudHtml: one burrow ships no scenario dropdown at all", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  assert.doesNotMatch(html, /id="scenarioSelect"/, "nothing to pick between, so nothing to pick with");
  assert.match(html, /"scenarios":\[\{/, "the one world still travels as a scenario, so the page has one code path");
});

test("renderMudHtml: several burrows ship a dropdown beside reset, opening on the first", () => {
  const second = { ...WORLD_PAYLOAD, name: "mud-hollow", opening: "a mossy hollow" };
  const html = renderMudHtml({
    worldPayload: WORLD_PAYLOAD,
    characters: CHARACTERS,
    scenarios: [
      { label: "mud garden (4 rooms, 1 fox)", worldPayload: WORLD_PAYLOAD, characters: CHARACTERS },
      { label: "mud hollow (3 rooms, nothing hunting)", worldPayload: second, characters: [CHARACTERS[0]] },
    ],
  });
  assert.match(html, /id="scenarioSelect"/);
  assert.ok(
    html.indexOf('id="resetBtn"') < html.indexOf('id="scenarioSelect"'),
    "the dropdown sits next to reset, after it",
  );
  assert.match(html, /<option value="0" selected>mud garden \(4 rooms, 1 fox\)<\/option>/);
  assert.match(html, /<option value="1">mud hollow \(3 rooms, nothing hunting\)<\/option>/);
  assert.match(html, /"name":"mud-hollow"/, "the alternate's whole world travels with the page");
});

test("renderMudHtml: a scenario with no label of its own reads by its world name", () => {
  const html = renderMudHtml({
    worldPayload: WORLD_PAYLOAD,
    characters: CHARACTERS,
    scenarios: [
      { worldPayload: WORLD_PAYLOAD, characters: CHARACTERS },
      { worldPayload: { ...WORLD_PAYLOAD, name: "mud-warren" }, characters: CHARACTERS },
    ],
  });
  assert.match(html, /<option value="0" selected>mud garden<\/option>/);
  assert.match(html, /<option value="1">mud warren<\/option>/);
});

test("renderMudHtml: picking a burrow recasts through the same boot reset and the sliders run", () => {
  const html = renderMudHtml({
    worldPayload: WORLD_PAYLOAD,
    characters: CHARACTERS,
    scenarios: [
      { worldPayload: WORLD_PAYLOAD, characters: CHARACTERS },
      { worldPayload: { ...WORLD_PAYLOAD, name: "mud-warren" }, characters: CHARACTERS },
    ],
  });
  assert.match(html, /scenarioSelect\.addEventListener\("change"/, "the settle event, not every keystroke");
  assert.match(html, /scenarioIndex = picked;/);
  assert.match(html, /await boot\("a different burrow opened/, "the same boot the sliders and reset call");
  assert.match(html, /liveRoom\.rebind\(\{ memoryDir: opened\.memoryDir/, "a live shared room re-binds to the new burrow's store instead of dropping");
  assert.match(
    html,
    /createMudSession\(scenario\(\)\.worldPayload/,
    "the session opens over whichever burrow is picked, never a fixed one",
  );
  assert.match(html, /roster = rosterOf\(scenario\(\)\)/, "each burrow casts from its own animals");
  assert.match(html, /rootRoom = rootRoomOf\(scenario\(\)\)/, "the survey lays out from the picked burrow's own origin");
});

test("renderMudHtml: edit mode follows the burrow that is loaded, not the one the page shipped", () => {
  const html = renderMudHtml({
    worldPayload: WORLD_PAYLOAD,
    characters: CHARACTERS,
    scenarios: [
      { worldPayload: WORLD_PAYLOAD, characters: CHARACTERS },
      { worldPayload: { ...WORLD_PAYLOAD, name: "mud-warren" }, characters: CHARACTERS },
    ],
  });
  assert.match(
    html,
    /rowsForWorld\(rows, scenario\(\)\.worldPayload\.name\)/,
    "the editor's provenance filter reads the loaded burrow",
  );
  assert.match(html, /if \(wasEditing\) await exitEditMode\(\);/, "a half-typed edit lands in the burrow it was typed over");
  assert.match(html, /if \(wasEditing\) await enterEditMode\(\);/, "the editor reopens on the burrow that just loaded");
});

test("renderMudHtml: a recast keeps the link — the room re-binds one epoch on, and only a failed re-bind drops", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  assert.match(html, /const liveRoom = room;/, "the live room is held across the async re-open");
  assert.match(html, /\(await session\.snapshot\(\)\)\.state\.epoch \+ 1/,
    "the next epoch is read off the store every peer converged on, one past it");
  assert.match(html, /characters: everyone\(\), epoch: nextEpoch/, "the new session opens on that epoch");
  assert.match(html, /worldName: worldName, myDisplayName: myDisplayName/, "the room's identity rides the rebind unchanged");
  assert.match(html, /the burrow recast \\u2014 still linked\./, "the wire note says the link held");
  assert.match(html, /dropRoom\("the link didn't survive the recast/, "a failed rebind falls back to the drop, and says so");
  const rebindBlock = /if \(liveRoom\) \{([\s\S]*?)\n    \}/.exec(html);
  assert.ok(rebindBlock, "the rebind block is in the page script");
  assert.ok(
    rebindBlock[1].indexOf("renderWire();") < rebindBlock[1].indexOf('el("wireStateNote").textContent'),
    "renderWire restates the stock note, so the recast reason is written after it, never before",
  );
});

test("renderMudHtml: a dropped room's reason survives the redraw that follows it", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  const dropRoom = /function dropRoom\(note\) \{([\s\S]*?)\n  \}/.exec(html);
  assert.ok(dropRoom, "dropRoom is in the page script");
  const body = dropRoom[1];
  assert.ok(
    body.indexOf("renderWire();") < body.indexOf('el("wireStateNote").textContent = note'),
    "renderWire restates the idle note, so the reason is written after it, never before",
  );
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

test("renderMudHtml: the deck offers an edit control, and the edit stage it swaps the panes for", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  assert.match(html, /id="editModeBtn"/, "the deck carries the way in");
  assert.match(html, /id="editorText"/, "the world's facts are editable as text");
  assert.match(html, /id="editMapBoard"/, "the survey redraws from the edit buffer, not the live session");
  assert.match(html, /id="roomDetailPanel"/, "a clicked room says what stands in it");
  assert.match(html, /id="editLegend"/, "and the legend names the classes this world really uses");
  assert.match(html, /body\.editing \.mud-stage, body\.editing \.deck-row \.world-map \{ display: none; \}/,
    "editing hides the panes and the live survey, so two burrows are never on screen at once");
});

test("renderMudHtml: nothing can take a turn while the world is being rewritten", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  assert.match(html, /setPlayControlsEnabled\(false\)/, "entering the editor disables every control that starts a turn");
  assert.match(html, /session\.applyEdit/, "and the sync itself goes through the shared tick queue's own write path");
});

test("renderMudHtml: a pane's fate badge reads the engine's own reason rather than assuming one", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  assert.match(html, /outOfPlayReason/, "which ending it was comes from the engine");
  assert.match(html, /banner\.textContent = fate \+/,
    "and the badge prints that reason, so a starved animal never reads as eaten");
  assert.match(html, /fate === "starved"/,
    "the fox's pounce only plays for the ending it belongs to");
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

test("renderMudHtml: the deck carries share and join, and the panel they open", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  assert.match(html, /id="shareBtn"/, "one control mints an invite");
  assert.match(html, /id="joinOpenBtn"/, "and one takes an invite that arrived some other way");
  assert.match(html, /id="statePill"/, "the deck says in one word whether the burrow is shared");
  for (const id of ["netPanel", "shareLink", "replyBox", "inviteBox", "replyOut", "nodeList", "nodeNameInput", "worldNameInput"]) {
    assert.match(html, new RegExp(`id="${id}"`), `the panel carries ${id}`);
  }
  assert.match(html, /id="joinCard"/, "a link that arrives as a link still lands on its own card");
  assert.match(html, /\.join-card\[hidden\][^{]*\{ display: none/, "and a hidden overlay is really hidden, not merely marked so");
});

test("renderMudHtml: every pane can wave, and has somewhere to say who plays it", () => {
  const html = paneMarkup("a");
  assert.match(html, /id="window-a-wave"/, "the hand sits with the pane's own quick commands");
  assert.match(html, /class="pill wave-btn"/);
  assert.match(html, /id="window-a-node" hidden/, "the origin-node line starts empty, for an unshared burrow has none");
});

test("renderMudHtml: the page reads its sync filter off the engine rather than naming predicates itself", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  assert.match(html, /mudSyncableFacts\(rows, isState, extraPredicates\)/, "the predicate check is handed over, never inlined");
  assert.match(html, /window\.tmctMud\.isMudStatePredicate/, "and it comes from the world engine's own export");
  assert.match(html, /window\.tmctMud\.P2P_PREDICATES/, "alongside the P2P layer's own four");
});

// ---- the shared burrow's own readers ----------------------------------------
// A claim, a wave and a node name are ordinary facts, so every reader below
// takes plain rows and settles the question the same way on every machine.

const claim = (character, peer, at) => ({
  subject: character, predicate: "mgx:playedBy", object: peer, provenance: `ace:p2p:${character}@${at}`,
});
const waved = (character, room, at) => ({
  subject: character, predicate: "mgx:waved", object: room, provenance: `ace:p2p:${character}-${room}@${at}`,
});

test("provenanceStamps reads every assertion time a joined provenance carries", () => {
  const joined = "ace:p2p:mole-1@2026-07-29T10:00:00.000Z | teach:peer:mossy-acorn@2026-07-29T10:00:05.500Z";
  assert.deepEqual(
    provenanceStamps(joined),
    [Date.parse("2026-07-29T10:00:00.000Z"), Date.parse("2026-07-29T10:00:05.500Z")],
  );
  assert.deepEqual(provenanceStamps(""), [], "a fact with no provenance carries no time");
  assert.deepEqual(provenanceStamps("world:mud-garden"), [], "an untimed world tag carries none either");
});

test("peerTerm normalizes a peer id the way the fact store stores it", () => {
  assert.equal(peerTerm("peer:AB12-CD34"), "ab12-cd34", "the CURIE prefix is stripped and the id lowercased");
  assert.equal(peerTerm("ab12-cd34"), "ab12-cd34", "an already-stored term reads back unchanged");
  assert.equal(peerTerm(null), "");
});

test("claimantOf settles two claims on one character by the oldest, never the newest", () => {
  const rows = [
    claim("mole-1", "alpha", "2026-07-29T10:00:03.000Z"),
    claim("mole-1", "beta", "2026-07-29T10:00:01.000Z"),
  ];
  assert.equal(claimantOf(rows, "mole-1"), "beta", "the first hand on the animal keeps it");
  assert.equal(claimantOf(rows, "vole-1"), null, "an animal nobody claimed has no owner");
});

test("claimantOf reads a claim through the tag a peer relabelled it with on the wire", () => {
  const rows = [{
    subject: "mole-1",
    predicate: "mgx:playedBy",
    object: "alpha",
    provenance: "teach:peer:mossy-acorn@2026-07-29T10:00:01.000Z",
  }, claim("mole-1", "beta", "2026-07-29T10:00:02.000Z")];
  assert.equal(claimantOf(rows, "mole-1"), "alpha");
});

test("claimantOf breaks a dead heat the same way on every machine", () => {
  const rows = [
    claim("mole-1", "zeta", "2026-07-29T10:00:00.000Z"),
    claim("mole-1", "alpha", "2026-07-29T10:00:00.000Z"),
  ];
  assert.equal(claimantOf(rows, "mole-1"), "alpha", "the lower peer term wins, so no two pages disagree");
  assert.equal(claimantOf([...rows].reverse(), "mole-1"), "alpha", "and the row order it arrived in cannot change that");
});

test("a repeated claim by one peer never overtakes an older claim by another", () => {
  const rows = [
    claim("mole-1", "alpha", "2026-07-29T10:00:01.000Z"),
    {
      subject: "mole-1",
      predicate: "mgx:playedBy",
      object: "beta",
      provenance: "ace:p2p:mole-1@2026-07-29T10:00:02.000Z | ace:p2p:mole-1@2026-07-29T10:09:00.000Z",
    },
  ];
  assert.equal(claimantOf(rows, "mole-1"), "alpha", "a claim is settled on its first assertion, not its latest");
});

test("wavingCharacters reads a wave by recency, and an old wave simply stops being current", () => {
  const now = Date.parse("2026-07-29T10:00:10.000Z");
  const rows = [
    waved("mole-1", "garden", "2026-07-29T10:00:07.000Z"),
    waved("vole-1", "garden", "2026-07-29T09:59:00.000Z"),
  ];
  assert.deepEqual(wavingCharacters(rows, now), ["mole-1"]);
  assert.deepEqual(wavingCharacters(rows, now, 120000), ["mole-1", "vole-1"], "a wider window reads both");
});

test("waving again after the window has passed reads as waving, through the newest tag on the same fact", () => {
  const now = Date.parse("2026-07-29T10:00:10.000Z");
  const rows = [{
    subject: "mole-1",
    predicate: "mgx:waved",
    object: "garden",
    provenance: "ace:p2p:mole-1-garden@2026-07-29T09:50:00.000Z | ace:p2p:mole-1-garden@2026-07-29T10:00:08.000Z",
  }];
  assert.deepEqual(wavingCharacters(rows, now), ["mole-1"], "the recency read takes the newest tag on the fact");
});

test("offerBlobIn reads the offer out of a whole link or takes a bare blob as it stands", () => {
  assert.equal(offerBlobIn("https://example.test/mud.html?offer=BLOB123&world=w1&name=mossy-acorn"), "BLOB123");
  assert.equal(offerBlobIn("BLOB123"), "BLOB123", "a bare blob is already the thing");
  assert.equal(offerBlobIn("https://example.test/mud.html?world=w1&offer=BLOB123"), "BLOB123", "wherever it sits in the query");
  assert.equal(offerBlobIn("  https://example.test/mud.html?offer=A%2BB  "), "A+B", "and it arrives decoded");
  assert.equal(offerBlobIn(""), "");
});

test("nodeNameFor takes a peer's latest name, and falls back to a short id while none has arrived", () => {
  const rows = [
    { subject: "abc12345-6789", predicate: "mgx:nodeName", object: "mossy-acorn", provenance: "ace:p2p:abc@2026-07-29T10:00:01.000Z" },
    { subject: "abc12345-6789", predicate: "mgx:nodeName", object: "quiet-badger", provenance: "ace:p2p:abc@2026-07-29T10:00:09.000Z" },
  ];
  assert.equal(nodeNameFor(rows, "peer:ABC12345-6789"), "quiet-badger", "a rename is an add, and the latest wins");
  assert.equal(nodeNameFor(rows, "peer:ffffffff-0000"), "ffffffff", "a label never waits for a name to arrive");
});

test("isMudStatePredicate accepts what a turn writes and refuses the chrome around it", () => {
  for (const predicate of [
    "mgx:currently-in", "mgx:located-in", "mgx:hidden-in", "mgx:on-top-of", "mgx:is-open",
    "mgx:hasMass", "mgx:knows-about", "mgx:display-name", "rdf:type",
    "mgx:has-exit-north", "mgx:has-exit-down", "mgx:world-epoch",
  ]) {
    assert.equal(isMudStatePredicate(predicate), true, `${predicate} is live world state`);
  }
  for (const predicate of ["mgx:playedBy", "mgx:waved", "mgx:nodeName", "mgx:worldName", "mgx:is-predator", ""]) {
    assert.equal(isMudStatePredicate(predicate), false, `${predicate} is not world state a turn folds`);
  }
});
