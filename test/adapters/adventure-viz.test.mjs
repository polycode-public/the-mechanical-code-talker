// adventure-viz: renderAdventureHtml is a pure string builder over an
// embedded world payload — these tests pin the page's STRUCTURE (mirroring
// spider-fly-viz.test.mjs's own style) plus the pure render-glue functions
// the page splices into its own inline script — spriteClassForObject,
// roomSceneObjects, pillsForRoom — and the caption builder.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderAdventureHtml, spriteClassForObject, roomSceneObjects, roomCaptionText, pillsForRoom,
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

// ---- renderAdventureHtml: page structure ------------------------------------

const WORLD_PAYLOAD = { name: "ashcombe-hall", facts: [], rules: [], opening: "the adventure begins." };

test("renderAdventureHtml: the room stage, sprite row and caption are present", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.match(html, /id="roomFrame"/);
  assert.match(html, /id="spriteRow"/);
  assert.match(html, /id="caption"/);
  assert.match(html, /id="goalLine"/);
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

test("renderAdventureHtml: the sprite layer resolves each object's class through the shared registry", () => {
  const html = renderAdventureHtml({ worldPayload: WORLD_PAYLOAD });
  assert.match(html, /resolveSpriteForClass/);
  assert.match(html, /SPRITE_REGISTRY/);
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
