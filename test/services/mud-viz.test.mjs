// mud-viz: renderMudHtml is a pure string builder over an embedded world
// payload and character roster, mirroring adventure-viz.test.mjs's own
// style — these tests pin the page's STRUCTURE (four window containers, the
// rail's controls, the explanatory note, the omniscient world map), plus
// the pure render-glue functions the page splices into its own inline
// script: speciesOfCharacter, mudRoomSceneObjects, carriedItemsFor,
// levelsOf, levelBands, charactersInRoom.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderMudHtml, speciesOfCharacter, mudRoomSceneObjects, carriedItemsFor,
  levelsOf, levelBands, charactersInRoom,
} from "../../src/services/mud-viz.mjs";
import { foldWorldState } from "../../src/services/adventure.mjs";

const CHARACTERS = [
  { id: "mole-1", slot: "nw", species: "mole" },
  { id: "vole-1", slot: "ne", species: "vole" },
  { id: "badger-2", slot: "sw", species: "badger" },
  { id: "groundhog-1", slot: "se", species: "groundhog" },
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

test("renderMudHtml: renders one window container per character, in slot order", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  for (const slot of ["nw", "ne", "sw", "se"]) {
    assert.match(html, new RegExp(`id="window-${slot}"`), `window-${slot} is present`);
    assert.match(html, new RegExp(`class="mud-window"[^>]*id="window-${slot}"`), `window-${slot} carries the mud-window class`);
  }
});

test("renderMudHtml: the rail carries auto/turns/delay/max-turns/reset controls", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  assert.match(html, /id="autoToggle"/);
  assert.match(html, /id="globalTurnCount"/);
  assert.match(html, /id="delaySlider"/);
  assert.match(html, /id="maxTurnsSlider"/);
  assert.match(html, /id="resetBtn"/);
});

test("renderMudHtml: the explanatory note names MUDII and Colossal Cave Adventure", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  assert.match(html, /MUDII/);
  assert.match(html, /mudii\.co\.uk/);
  assert.match(html, /Colossal Cave Adventure/);
  assert.match(html, /Multi Underground creature Dig/);
});

test("renderMudHtml: the omniscient world map container is present, distinct from any one window", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  assert.match(html, /id="worldMap"/);
  assert.match(html, /id="worldMapBands"/);
});

test("renderMudHtml: each window carries its own character id and chat dock ids", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  for (const c of CHARACTERS) {
    assert.match(html, new RegExp(`data-character="${c.id}"`));
    assert.match(html, new RegExp(`id="window-${c.slot}-chatlog"`));
    assert.match(html, new RegExp(`id="window-${c.slot}-chatform"`));
  }
});

test("renderMudHtml: embeds the world payload and character roster as page data", () => {
  const html = renderMudHtml({ worldPayload: WORLD_PAYLOAD, characters: CHARACTERS });
  assert.match(html, /MUD_PAGE_DATA/);
  assert.match(html, /mud-garden/);
  assert.match(html, /badger-2/);
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
  const rows = [
    { subject: "garden", predicate: "mgx:has-exit-down", object: "burrow-1" },
    { subject: "burrow-1", predicate: "mgx:has-exit-up", object: "garden" },
    { subject: "burrow-1", predicate: "mgx:has-exit-east", object: "sett-1" },
    { subject: "sett-1", predicate: "mgx:has-exit-west", object: "burrow-1" },
  ];
  const state = foldWorldState(rows);
  const levels = levelsOf(state, "garden");
  assert.equal(levels.get("garden"), 0);
  assert.equal(levels.get("burrow-1"), -1);
  assert.equal(levels.get("sett-1"), -1, "a lateral exit does not change depth");
});

test("levelBands: groups rooms by level, deepest last", () => {
  const levels = new Map([["garden", 0], ["burrow-1", -1], ["sett-1", -1]]);
  const bands = levelBands(levels);
  assert.deepEqual(bands, [
    { level: 0, rooms: ["garden"] },
    { level: -1, rooms: ["burrow-1", "sett-1"] },
  ]);
});

test("charactersInRoom: only the characters actually placed in that room", () => {
  const rows = [
    { subject: "mole-1", predicate: "mgx:currently-in", object: "garden" },
    { subject: "vole-1", predicate: "mgx:currently-in", object: "burrow-1" },
  ];
  const state = foldWorldState(rows);
  assert.deepEqual(charactersInRoom(state, "garden", ["mole-1", "vole-1"]), ["mole-1"]);
});
