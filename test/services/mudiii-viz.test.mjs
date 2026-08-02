// mudiii-viz: renderMudiiiHtml is a pure string builder over an embedded
// world payload, agent roster and asset manifest, mirroring mud-viz.test.mjs's
// own style — these tests pin the page's STRUCTURE (the deck's controls,
// including the foxes/goblins-relabelled sliders and the two new controls
// this page adds over mud.html's own deck; the deliberate absence of every
// P2P surface; nothing auto-playing on load), plus the pure render-glue
// functions the page splices into its own inline script.
//
// Driven from test/fixtures/mudiii-ticks.json (the frozen engine/viz
// interface — see its own `_readme`) and data/mudiii-assets.json (the asset
// manifest), so these tests need no engine build at all.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renderMudiiiHtml, agentCardMarkup, roleOfAgentId, cellToWorld, cellFromGroundPoint,
  propPlacementsFrom, occupiedCells, blockedCellReason, cameraRigFor, nextCameraSelection,
  mapDotsFor, hudCardFieldsFor, clipForAction,
} from "../../src/services/mudiii-viz.mjs";
import { DEFAULT_GAME_CONFIG } from "../../src/domain/game-config.mjs";
import FIXTURE from "../fixtures/mudiii-ticks.json" with { type: "json" };
import ASSET_MANIFEST from "../../data/mudiii-assets.json" with { type: "json" };

const GRID_SIZE = FIXTURE.gridSize;
const MUDIII_CONFIG = DEFAULT_GAME_CONFIG.mudiii;
const ASSETS = ASSET_MANIFEST.assets;
const FOX_CLIPS = ASSETS.find((a) => a.key === "fox").clips;
const GOBLIN_CLIPS = ASSETS.find((a) => a.key === "goblin").clips;

const AGENTS = [
  { id: "fox-1", role: "predator" },
  { id: "goblin-1", role: "prey" },
  { id: "goblin-2", role: "prey" },
  { id: "goblin-3", role: "prey" },
];

const WORLD_PAYLOAD = {
  name: "town-square",
  facts: FIXTURE.propFacts,
  rules: [],
  opening: "a market town square",
};

function flattenInitialAgents() {
  return Object.entries(FIXTURE.initial.agents).map(([id, a]) => ({ id, ...a }));
}

// ---- renderMudiiiHtml: structure --------------------------------------

test("renderMudiiiHtml: the deck carries play/turns/reset/edit controls, same ids as mud.html", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /id="autoToggle"/);
  assert.match(html, /id="globalTurnCount"/);
  assert.match(html, /id="resetBtn"/);
  assert.match(html, /id="editModeBtn"/);
  assert.match(html, /id="deckInfoBtn"/);
});

test("renderMudiiiHtml: the foxes slider is playerCountSlider, an index into [1,2,4], default 2", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /id="playerCountSlider" min="0" max="2" step="1"\s+value="1"/, "index 1 of [1,2,4] is 2, the default");
  assert.match(html, />foxes\s*<input/s, "the visible label is foxes, not players");
  assert.doesNotMatch(html, />\s*players\s*</, "the word players never appears as a visible label");
});

test("renderMudiiiHtml: the goblins slider is npcCountSlider, 1..10, default 2", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /id="npcCountSlider" min="1" max="10" step="1"\s+value="2"/);
  assert.match(html, />goblins\s*<input/s, "the visible label is goblins, not npcs");
});

test("renderMudiiiHtml: delay and max-turns sliders match mud.html's own ranges and defaults", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /id="delaySlider" min="80" max="2000" step="20" value="650"/);
  assert.match(html, /id="maxTurnsSlider" min="20" max="2000" step="20" value="400"/);
});

test("renderMudiiiHtml: one town square ships no scenario dropdown", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.doesNotMatch(html, /id="scenarioSelect"/);
  assert.match(html, /"scenarios":\[\{/, "the one world still travels as a scenario");
});

test("renderMudiiiHtml: several town squares ship a dropdown, opening on the first", () => {
  const second = { ...WORLD_PAYLOAD, name: "harbour-square" };
  const html = renderMudiiiHtml({
    worldPayload: WORLD_PAYLOAD,
    agents: AGENTS,
    scenarios: [
      { label: "market square (1 fox, 3 goblins)", worldPayload: WORLD_PAYLOAD, agents: AGENTS },
      { label: "harbour square (1 fox, 1 goblin)", worldPayload: second, agents: [AGENTS[0], AGENTS[1]] },
    ],
  });
  assert.match(html, /id="scenarioSelect"/);
  assert.match(html, /<option value="0" selected>market square \(1 fox, 3 goblins\)<\/option>/);
  assert.match(html, /<option value="1">harbour square \(1 fox, 1 goblin\)<\/option>/);
});

test("renderMudiiiHtml: the camera control ships three modes, follow selected by default", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /id="cameraMode"/);
  assert.match(html, /data-mode="follow" aria-pressed="true"/);
  assert.match(html, /data-mode="pov" aria-pressed="false"/);
  assert.match(html, /data-mode="overhead" aria-pressed="false"/);
});

test("renderMudiiiHtml: the agent-follow select ships one option per opening agent", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /id="agentSelect"/);
  for (const a of AGENTS) {
    assert.match(html, new RegExp(`<option value="${a.id}">${a.id}</option>`));
  }
});

test("renderMudiiiHtml: a food pill arms click-to-place-food, carrying its own command", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /id="foodPill" data-command="place food" aria-pressed="false"/);
  assert.match(html, /class="pill affordance" id="foodPill"/);
});

test("renderMudiiiHtml: the 3D stage, the map panel and the HUD row are all present", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /id="sceneStage"/);
  assert.match(html, /id="sceneCanvas"/);
  assert.match(html, /id="sceneStatus" role="status"/);
  assert.match(html, /id="mapPanel"/);
  assert.match(html, /id="hudRow"/);
});

test("renderMudiiiHtml: one shared chat log and one shared input, never one per agent", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /id="chatLog"/);
  assert.match(html, /id="chatInput"/);
  assert.equal((html.match(/id="chatLog"/g) || []).length, 1);
  assert.equal((html.match(/id="chatInput"/g) || []).length, 1);
  assert.doesNotMatch(html, /window-a-chatlog|window-b-chatlog/, "no per-character panes");
});

test("renderMudiiiHtml: booting calls window.mudiiiScene.boot with the resolved prop placements and asset manifest", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS, assetManifest: ASSETS });
  assert.match(
    html,
    /callScene\("boot", \{ propPlacements: props, assetManifest: DATA\.assetManifest, gridSize: DATA\.gridSize, cellSize: 1 \}\)/,
  );
});

test("renderMudiiiHtml: every tick calls window.mudiiiScene.applyTick with the raw tick-payload shape", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(
    html,
    /callScene\("applyTick", \{ agents: result\.agents, items: result\.items, ecology: result\.ecology \}\)/,
  );
});

test("renderMudiiiHtml: window.mudiiiScene.setCamera is reached on boot, every tick's fallback, camera-mode clicks and the follow select", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  const bodyOf = (header) => {
    const match = new RegExp(`${header}[\\s\\S]*?\\n  \\}`).exec(html);
    assert.ok(match, `${header} is in the page script`);
    return match[0];
  };
  // Boot reaches it through applyTickResult, the one path that draws a board —
  // the opening one and every tick's alike, so the camera can never be rigged
  // against a board the scene was never told about.
  const boot = bodyOf("async function boot\\(\\) \\{");
  assert.match(boot, /applyTickResult\(opening\)/, "boot draws the opening board through the tick path");
  assert.match(bodyOf("function applyTickResult\\(result\\) \\{"), /callScene\("setCamera", camera\)/);
  assert.match(bodyOf('el\\("cameraMode"\\)\\.addEventListener'), /callScene\("setCamera", camera\)/);
  assert.match(bodyOf('el\\("agentSelect"\\)\\.addEventListener'), /callScene\("setCamera", camera\)/);
});

test("renderMudiiiHtml: boot draws the opening board from session.board(), never a fabricated cast with null cells", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  const boot = /async function boot\(\) \{[\s\S]*?\n  \}/.exec(html);
  assert.ok(boot, "boot() is in the page script");
  assert.match(boot[0], /await session\.board\(\)/, "boot asks the engine where everything stands");
  assert.doesNotMatch(boot[0], /cell: null/, "no agent is seeded at a null cell for the scene to fail to place");
  assert.match(boot[0], /camera\.selectedId = Object\.keys\(opening\.agents/, "the follow target comes from the board the engine minted");
});

test("renderMudiiiHtml: every window.mudiiiScene call is guarded — a missing or throwing scene never takes the page down", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  const callScene = /function callScene\(method\) \{([\s\S]*?)\n  \}/.exec(html);
  assert.ok(callScene, "callScene is in the page script");
  assert.match(callScene[1], /typeof scene\[method\] !== "function"/);
  assert.match(callScene[1], /try \{/);
  assert.match(callScene[1], /catch \(err\)/);
});

test("renderMudiiiHtml: a scene click routes food placement through tmct.turn, never session.placeFood directly", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  const handler = /window\.mudiiiHandleSceneClick = function \(cellId\) \{([\s\S]*?)\n  \};/.exec(html);
  assert.ok(handler, "the scene-click handler is in the page script");
  assert.match(handler[1], /sendCommand\("put food at " \+ cellId\)/, "the same lane verb a typed command would use");
  assert.doesNotMatch(handler[1], /session\.placeFood/, "no separate write path for the click");
  assert.match(handler[1], /blockedCellReason\(cellId, props, agentsList\(\)\)/, "the blocked-cell refusal is still a client-side pre-check");
});

test("renderMudiiiHtml: sendCommand appends both the typed line and the answer to the chat log", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  const sendCommand = /function sendCommand\(line\) \{([\s\S]*?)\n  \}/.exec(html);
  assert.ok(sendCommand);
  assert.match(sendCommand[1], /appendChat\("u", line\)/);
  assert.match(sendCommand[1], /appendChat\("a", res\.answer\)/);
  assert.match(sendCommand[1], /tmct\.turn\(line\)/);
});

test("renderMudiiiHtml: every P2P surface mud.html carries is deliberately absent here", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.doesNotMatch(html, /id="statePill"/);
  assert.doesNotMatch(html, /id="shareBtn"/);
  assert.doesNotMatch(html, /id="joinOpenBtn"/);
  assert.doesNotMatch(html, /wave-btn/);
  assert.doesNotMatch(html, /dir-ring/, "the compass ring dies with the free camera");
});

test("renderMudiiiHtml: nothing auto-plays on load — boot() never starts the ticker", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  const bootBlock = /async function boot\(\) \{([\s\S]*?)\n  \}/.exec(html);
  assert.ok(bootBlock, "boot() is in the page script");
  assert.doesNotMatch(bootBlock[1], /\.play\(\)/, "boot draws the opening state and stops there");
  assert.match(html, /wireDeck\(\);\s*wirePillComplete\(\);\s*boot\(\);\s*\}\)\(\);/, "boot runs once at the very end, unattended by a play call");
});

test("renderMudiiiHtml: the asset manifest is embedded as page data, and no fact row carries a file path", () => {
  const html = renderMudiiiHtml({
    worldPayload: WORLD_PAYLOAD, agents: AGENTS, assetManifest: ASSETS,
  });
  const dataBlock = /const MUDIII_PAGE_DATA = (\{[\s\S]*?\});\s*<\/script>/.exec(html);
  assert.ok(dataBlock, "the page data block is present");
  const data = JSON.parse(dataBlock[1]);
  assert.ok(data.assetManifest.some((row) => row.destPath), "the manifest itself legitimately carries destPath");
  for (const scenario of data.scenarios) {
    for (const fact of scenario.worldPayload.facts) {
      assert.equal(typeof fact.object, "string");
      assert.doesNotMatch(fact.object, /\.glb$/, `fact row for ${fact.subject} carries a file path`);
    }
  }
});

test("renderMudiiiHtml: mgx:model rows resolve against the manifest client-side, via propPlacementsFrom", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS, assetManifest: ASSETS });
  assert.match(html, /const propPlacementsFrom = /, "spliced into the page script");
});

// ---- pill-complete adoption --------------------------------------------

test("renderMudiiiHtml: pill-complete wraps the chat input and its CSS lands after this page's own pill rules", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /id="chatInput-pc-ghost"/);
  assert.match(html, /id="chatInput-pc-status"/);
  const ownPillRuleAt = html.indexOf(".pill.affordance[aria-pressed");
  const pillCompleteCssAt = html.indexOf("--pc-ghost-color");
  assert.ok(ownPillRuleAt > -1 && pillCompleteCssAt > -1);
  assert.ok(ownPillRuleAt < pillCompleteCssAt, "PILL_COMPLETE_CSS is interpolated last, after this page's own pill rules");
});

test("renderMudiiiHtml: exactly the three splice-safe functions are spliced under their own names, never pillCompleteMarkup", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /const matchPills = /);
  assert.match(html, /const pillCandidates = /);
  assert.match(html, /const createPillComplete = /);
  assert.doesNotMatch(html, /const pillCompleteMarkup = /, "pillCompleteMarkup runs once at render time, never spliced");
});

test("renderMudiiiHtml: pill buttons carry data-command, so the rail promotes to createPillComplete's combobox", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /'<button type="button" class="pill" data-command="' \+ esc\(p\.command\)/, "renderChatPills stamps data-command on every pill");
});

// ---- edit mode reuses mud-editor.mjs -----------------------------------

test("renderMudiiiHtml: edit mode reuses mud-editor.mjs's renderMudEditorText unchanged", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /const renderMudEditorText = /);
  assert.match(html, /id="editorText"/);
  assert.match(html, /id="mudiiiEditStage"/);
});

// ---- roleOfAgentId ------------------------------------------------------

test("roleOfAgentId: strips the trailing instance number, the same idPrefix the manifest keys under", () => {
  assert.equal(roleOfAgentId("fox-1"), "fox");
  assert.equal(roleOfAgentId("goblin-3"), "goblin");
  assert.equal(roleOfAgentId(FIXTURE.roles.predator.idPrefix + "-1"), FIXTURE.roles.predator.idPrefix);
});

// ---- cellToWorld / cellFromGroundPoint ----------------------------------

test("cellToWorld: opposite corners sit symmetrically around the origin", () => {
  const corner = cellToWorld("cell-1-1", GRID_SIZE, 1);
  const opposite = cellToWorld(`cell-${GRID_SIZE}-${GRID_SIZE}`, GRID_SIZE, 1);
  assert.deepEqual(corner, { x: -5.5, z: -5.5 });
  assert.deepEqual(opposite, { x: 5.5, z: 5.5 });
  assert.equal(corner.x + opposite.x, 0);
  assert.equal(corner.z + opposite.z, 0);
});

test("cellToWorld: null for a malformed cell id or a non-positive gridSize", () => {
  assert.equal(cellToWorld("not-a-cell", GRID_SIZE, 1), null);
  assert.equal(cellToWorld("cell-1-1", 0, 1), null);
});

test("cellFromGroundPoint: the exact inverse of cellToWorld, round-tripped over the whole board", () => {
  for (let x = 1; x <= GRID_SIZE; x += 1) {
    for (let y = 1; y <= GRID_SIZE; y += 1) {
      const cell = `cell-${x}-${y}`;
      assert.equal(cellFromGroundPoint(cellToWorld(cell, GRID_SIZE, 1), GRID_SIZE, 1), cell);
    }
  }
});

test("cellFromGroundPoint: clamps a point past the board's own edge onto the nearest cell", () => {
  assert.equal(cellFromGroundPoint({ x: -999, z: -999 }, GRID_SIZE, 1), "cell-1-1");
  assert.equal(cellFromGroundPoint({ x: 999, z: 999 }, GRID_SIZE, 1), `cell-${GRID_SIZE}-${GRID_SIZE}`);
});

// ---- propPlacementsFrom --------------------------------------------------

test("propPlacementsFrom: every prop in the fixture resolves its cell, model and rotation", () => {
  const placements = propPlacementsFrom(FIXTURE.propFacts, ASSETS);
  const byId = Object.fromEntries(placements.map((p) => [p.id, p]));
  assert.equal(byId["house-1"].cell, "cell-8-1");
  assert.equal(byId["house-1"].model, "house-1");
  assert.equal(byId["house-1"].rotation, "180");
  assert.equal(byId["house-1"].asset.destPath, "public/models/props/house_1.glb");
  assert.equal(byId["well-1"].asset.key, "well");
});

test("propPlacementsFrom: a model the manifest carries no key for resolves with asset: null, not a guess", () => {
  // A world may name a model the asset manifest has no key for. That resolves
  // to a null asset and stays null — the renderer shows nothing rather than
  // substituting a lookalike, because a silently swapped mesh is worse than a
  // visible gap. The unknown key is minted here rather than borrowed from the
  // fixture, so the fixture stays free to name only real keys.
  const rows = [
    { subject: "shrine-1", predicate: "rdf:type", object: "prop" },
    { subject: "shrine-1", predicate: "mgx:currently-in", object: "cell-5-5" },
    { subject: "shrine-1", predicate: "mgx:model", object: "wayside-shrine" },
  ];
  const placements = propPlacementsFrom(rows, ASSETS);
  const shrine = placements.find((p) => p.id === "shrine-1");
  assert.ok(shrine);
  assert.equal(shrine.model, "wayside-shrine");
  assert.equal(shrine.asset, null);
});

test("propPlacementsFrom: every model the shipped fixture names is a real manifest key", () => {
  // The complement of the test above, and the one that would have caught the
  // fixture naming "market-stall" while the manifest carried only
  // "market-stall-1" and "market-stall-2".
  const keys = new Set(ASSETS.map((a) => a.key));
  for (const p of propPlacementsFrom(FIXTURE.propFacts, ASSETS)) {
    assert.ok(keys.has(p.model), `fixture prop ${p.id} names model "${p.model}", which is not a manifest key`);
    assert.ok(p.asset, `fixture prop ${p.id} should resolve to a manifest row`);
  }
});

test("propPlacementsFrom: sorted by id, and drops any subject missing a cell or a model", () => {
  const rows = [
    { subject: "b-prop", predicate: "rdf:type", object: "prop" },
    { subject: "b-prop", predicate: "mgx:currently-in", object: "cell-2-2" },
    { subject: "b-prop", predicate: "mgx:model", object: "well" },
    { subject: "a-prop", predicate: "rdf:type", object: "prop" },
    { subject: "a-prop", predicate: "mgx:currently-in", object: "cell-1-1" },
    { subject: "a-prop", predicate: "mgx:model", object: "well" },
    { subject: "incomplete-prop", predicate: "rdf:type", object: "prop" },
    { subject: "incomplete-prop", predicate: "mgx:currently-in", object: "cell-3-3" },
    { subject: "fox-1", predicate: "mgx:currently-in", object: "cell-2-9" },
  ];
  const placements = propPlacementsFrom(rows, ASSETS);
  assert.deepEqual(placements.map((p) => p.id), ["a-prop", "b-prop"]);
});

// ---- occupiedCells / blockedCellReason ----------------------------------

test("occupiedCells: the union of every agent's and every item's own cell", () => {
  const agents = [{ id: "fox-1", cell: "cell-2-9" }, { id: "goblin-1", cell: "cell-7-4" }];
  const items = [{ id: "crumb-1", cell: "cell-5-5" }];
  const cells = occupiedCells(agents, items);
  assert.deepEqual([...cells].sort(), ["cell-2-9", "cell-5-5", "cell-7-4"]);
});

test("blockedCellReason: a prop blocks movement and names the cell", () => {
  const props = propPlacementsFrom(FIXTURE.propFacts, ASSETS);
  assert.equal(blockedCellReason("cell-8-1", props, []), "cell-8-1 is blocked");
});

test("blockedCellReason: a live agent blocks movement, but a loose item never does", () => {
  const agents = [{ id: "fox-1", cell: "cell-2-9" }];
  assert.equal(blockedCellReason("cell-2-9", [], agents), "cell-2-9 is blocked");
  assert.equal(blockedCellReason("cell-5-5", [], agents), null, "a clear cell is never blocked");
});

// ---- cameraRigFor ---------------------------------------------------------

test("cameraRigFor: overhead looks straight down at the board's own centre, agent or none", () => {
  const rig = cameraRigFor("overhead", null, GRID_SIZE);
  assert.deepEqual(rig.lookAt, { x: 0, y: 0, z: 0 });
  assert.equal(rig.position.x, 0);
  assert.equal(rig.position.z, 0);
  assert.ok(rig.position.y > 0);
});

test("cameraRigFor: follow sits behind the agent, opposite its facing, and looks at it", () => {
  const rig = cameraRigFor("follow", { cell: "cell-6-6", facing: "north" }, GRID_SIZE);
  const world = cellToWorld("cell-6-6", GRID_SIZE, 1);
  assert.deepEqual(rig.lookAt, { x: world.x, y: 0.8, z: world.z });
  assert.ok(rig.position.z > world.z, "north-facing agent is followed from the south, behind it");
});

test("cameraRigFor: pov sits at the agent's own cell, looking the way it faces", () => {
  const rig = cameraRigFor("pov", { cell: "cell-6-6", facing: "east" }, GRID_SIZE);
  const world = cellToWorld("cell-6-6", GRID_SIZE, 1);
  assert.equal(rig.position.x, world.x);
  assert.equal(rig.position.z, world.z);
  assert.ok(rig.lookAt.x > world.x, "east-facing agent looks east");
});

test("cameraRigFor: null for follow/pov with no agent, or an agent standing on no cell", () => {
  assert.equal(cameraRigFor("follow", null, GRID_SIZE), null);
  assert.equal(cameraRigFor("pov", { cell: null, facing: "north" }, GRID_SIZE), null);
});

// ---- nextCameraSelection: all five cases --------------------------------

test("nextCameraSelection: nothing followed stays nothing followed, no status", () => {
  const next = nextCameraSelection({ mode: "overhead", selectedId: null, status: null }, flattenInitialAgents(), []);
  assert.deepEqual(next, { mode: "overhead", selectedId: null, status: null });
});

test("nextCameraSelection: the followed agent is still on the board — unchanged, no status", () => {
  const agents = flattenInitialAgents();
  const next = nextCameraSelection({ mode: "pov", selectedId: "fox-1", status: null }, agents, []);
  assert.deepEqual(next, { mode: "pov", selectedId: "fox-1", status: null });
});

test("nextCameraSelection: the followed agent was this turn's eat-agent prey — falls back to overhead, naming both", () => {
  // Turn 9 of the fixture's own expectedTape: fox-1 eats goblin-1.
  const agents = flattenInitialAgents().filter((a) => a.id !== "goblin-1");
  const ecology = [{ type: "eat-agent", predator: "fox-1", prey: "goblin-1", cell: "cell-8-2", massGained: 1 }];
  const next = nextCameraSelection({ mode: "follow", selectedId: "goblin-1", status: null }, agents, ecology);
  assert.equal(next.mode, "overhead");
  assert.equal(next.selectedId, null);
  assert.equal(next.status, "fox-1 ate goblin-1 — switching to overhead");
});

test("nextCameraSelection: the followed agent starved this turn — falls back to overhead, naming it", () => {
  // Turn 10 of the fixture's own expectedTape: goblin-3 starves.
  const agents = flattenInitialAgents().filter((a) => a.id !== "goblin-3");
  const ecology = [{ type: "starve", agent: "goblin-3", cell: "cell-11-12" }];
  const next = nextCameraSelection({ mode: "follow", selectedId: "goblin-3", status: null }, agents, ecology);
  assert.equal(next.mode, "overhead");
  assert.equal(next.selectedId, null);
  assert.equal(next.status, "goblin-3 starved — switching to overhead");
});

test("nextCameraSelection: the followed agent is simply missing, no ecology event to explain it — a generic fallback, never silence", () => {
  const next = nextCameraSelection({ mode: "follow", selectedId: "goblin-9", status: null }, flattenInitialAgents(), []);
  assert.equal(next.mode, "overhead");
  assert.equal(next.selectedId, null);
  assert.equal(next.status, "goblin-9 left the board — switching to overhead");
});

// ---- mapDotsFor -----------------------------------------------------------

test("mapDotsFor: one dot per agent and per item, as percentage coordinates", () => {
  const agents = [{ id: "fox-1", role: "predator", cell: "cell-2-9" }];
  const items = [{ id: "crumb-1", kind: "crumb", cell: "cell-6-6" }];
  const dots = mapDotsFor(agents, items, GRID_SIZE);
  assert.deepEqual(dots, [
    { id: "fox-1", kind: "predator", xPct: (1.5 / GRID_SIZE) * 100, yPct: (8.5 / GRID_SIZE) * 100 },
    { id: "crumb-1", kind: "crumb", xPct: (5.5 / GRID_SIZE) * 100, yPct: (5.5 / GRID_SIZE) * 100 },
  ]);
});

test("mapDotsFor: an entry with no parseable cell is dropped, never drawn at a guessed position", () => {
  const dots = mapDotsFor([{ id: "fox-1", cell: null }], [], GRID_SIZE);
  assert.deepEqual(dots, []);
});

// ---- hudCardFieldsFor ------------------------------------------------------

test("hudCardFieldsFor: scales mass against the role's own initial mass, from the resolved mudiii config", () => {
  const fields = hudCardFieldsFor({ id: "fox-1", role: "predator", mass: 10, goal: "hunting", plan: ["north", "north"], belief: { "goblin-1": "cell-7-4" } }, MUDIII_CONFIG);
  assert.equal(fields.massPct, 50, "10 of a predator's 20 initial mass is 50%");
  assert.equal(fields.planText, "north → north");
  assert.deepEqual(fields.beliefEntries, [["goblin-1", "cell-7-4"]]);
});

test("hudCardFieldsFor: an empty plan reads \"holding\", the same word spider-fly-viz.mjs's own HUD uses", () => {
  const fields = hudCardFieldsFor({ id: "goblin-2", role: "prey", mass: 4, plan: [] }, MUDIII_CONFIG);
  assert.equal(fields.planText, "holding");
  assert.equal(fields.massPct, 50, "4 of a prey's 8 initial mass is 50%");
});

test("hudCardFieldsFor: a role the config carries no ceiling for gets massPct: null, never a guessed percentage", () => {
  const fields = hudCardFieldsFor({ id: "crumb-1", role: "food", mass: 1 }, MUDIII_CONFIG);
  assert.equal(fields.massPct, null);
});

// ---- clipForAction ----------------------------------------------------

test("clipForAction: a predator's eat-agent plays its attack clip", () => {
  assert.equal(clipForAction("predator", "eat-agent", FOX_CLIPS), "Attack");
});

test("clipForAction: a prey's eat-agent (the instant it is caught) plays its death clip", () => {
  assert.equal(clipForAction("prey", "eat-agent", GOBLIN_CLIPS), "Death");
});

test("clipForAction: goblin.glb ships no eat clip, so eat-item falls back to idle rather than a guessed name", () => {
  assert.equal(GOBLIN_CLIPS.eat, undefined, "confirms the manifest's own gap this test exercises");
  assert.equal(clipForAction("prey", "eat-item", GOBLIN_CLIPS), "Idle");
});

test("clipForAction: fox.glb's own eat clip is used when present", () => {
  assert.equal(clipForAction("predator", "eat-item", FOX_CLIPS), "Eating");
});

test("clipForAction: chase/evade both play the run clip; wander/forage both play walk", () => {
  assert.equal(clipForAction("predator", "chase", FOX_CLIPS), "Gallop");
  assert.equal(clipForAction("prey", "evade", GOBLIN_CLIPS), "Run");
  assert.equal(clipForAction("predator", "wander", FOX_CLIPS), "Walk");
  assert.equal(clipForAction("prey", "forage", GOBLIN_CLIPS), "Walk");
});

test("clipForAction: an array-valued clip (both rigs' own hit list) returns its first entry", () => {
  assert.ok(Array.isArray(FOX_CLIPS.hit));
  assert.equal(clipForAction("predator", "starve", FOX_CLIPS), "Death");
});

// ---- agentCardMarkup ----------------------------------------------------

test("agentCardMarkup: one card's whole markup, keyed on the slot alone, character-agnostic", () => {
  const html = agentCardMarkup("2");
  assert.match(html, /class="hud-card" id="hud-2" data-slot="2" data-agent=""/);
  assert.match(html, /id="hud-2-id"/);
  assert.match(html, /id="hud-2-role"/);
  assert.match(html, /id="hud-2-meter-fill"/);
  assert.match(html, /id="hud-2-goal"/);
  assert.match(html, /id="hud-2-plan"/);
  assert.match(html, /id="hud-2-belief"/);
});
