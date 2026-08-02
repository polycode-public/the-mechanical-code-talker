// mudiii-viz: renderMudiiiHtml is a pure string builder over an embedded
// world payload, agent roster and asset manifest, mirroring mud-viz.test.mjs's
// own style — these tests pin the page's STRUCTURE (the deck's controls,
// including the foxes/goblins-relabelled sliders and the two new controls
// this page adds over mud.html's own deck; the deliberate absence of every
// P2P surface; the board opening already playing), plus the pure render-glue
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
  mapDotsFor, mapBlocksFor, hudCardFieldsFor, clipForAction,
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
  assert.match(html, /id="delaySlider" min="80" max="2000" step="20" value="220"/);
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

test("renderMudiiiHtml: each scenario carries its own board size, and the page reads the picked one", () => {
  const second = { ...WORLD_PAYLOAD, name: "harbour-square" };
  const html = renderMudiiiHtml({
    worldPayload: WORLD_PAYLOAD,
    agents: AGENTS,
    scenarios: [
      { label: "market square", worldPayload: WORLD_PAYLOAD, agents: AGENTS, gridSize: 10 },
      { label: "harbour square", worldPayload: second, agents: AGENTS, gridSize: 14 },
    ],
  });
  const dataBlock = /const MUDIII_PAGE_DATA = (\{[\s\S]*?\});\s*<\/script>/.exec(html);
  const data = JSON.parse(dataBlock[1]);
  assert.deepEqual(data.scenarios.map((s) => s.gridSize), [10, 14]);
  assert.equal(data.gridSize, 10, "the page-level default is the opening square's own size");
  assert.match(html, /gridSizeOf = function \(\) \{ return scenario\(\)\.gridSize \|\| DATA\.gridSize; \}/);
  assert.match(html, /const size = gridSizeOf\(\);[\s\S]*mapDotsFor\(agentsList\(\), itemsList\(\), size\)/, "the map panel scales to the picked square");
});

test("renderMudiiiHtml: a scenario naming no board size falls back to the page default", () => {
  const html = renderMudiiiHtml({
    worldPayload: WORLD_PAYLOAD,
    agents: AGENTS,
    scenarios: [{ label: "market square", worldPayload: WORLD_PAYLOAD, agents: AGENTS }],
  });
  const dataBlock = /const MUDIII_PAGE_DATA = (\{[\s\S]*?\});\s*<\/script>/.exec(html);
  const data = JSON.parse(dataBlock[1]);
  assert.equal(data.scenarios[0].gridSize, undefined);
  assert.equal(data.gridSize, GRID_SIZE);
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
    /callScene\("boot", \{ propPlacements: props, assetManifest: DATA\.assetManifest, gridSize: gridSizeOf\(\), cellSize: 1 \}\)/,
  );
});

test("renderMudiiiHtml: every tick calls window.mudiiiScene.applyTick with the raw tick-payload shape", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(
    html,
    /callScene\("applyTick", \{\s*agents: result\.agents, items: result\.items, ecology: result\.ecology, rungs: result\.rungs,\s*\}\)/,
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

test("renderMudiiiHtml: a chat turn reads the board back, so a frame that ran a real turn redraws the page", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  const sendCommand = /function sendCommand\(line\) \{([\s\S]*?)\n  \}/.exec(html);
  assert.ok(sendCommand, "sendCommand is in the page script");
  assert.match(sendCommand[1], /await session\.board\(\)/, "the board is re-read after every chat turn");
  assert.match(sendCommand[1], /applyTickResult\(board\)/, "and drawn through the one path a tick takes");
  assert.match(
    sendCommand[1],
    /serializeTick\(async function \(\) \{[\s\S]*applyTickResult\(board\)/,
    "the turn and the read-back share one queue slot, so a deck tick cannot land between them",
  );
});

test("renderMudiiiHtml: the turn counter is read off the engine's own payload, never counted twice by the page", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  const apply = /function applyTickResult\(result\) \{([\s\S]*?)\n  \}/.exec(html);
  assert.ok(apply, "applyTickResult is in the page script");
  assert.match(apply[1], /globalTurn = result\.turn/, "the one place the page's counter is set");

  const runOneTick = /async function runOneTick\(\) \{([\s\S]*?)\n  \}/.exec(html);
  assert.ok(runOneTick, "runOneTick is in the page script");
  assert.doesNotMatch(runOneTick[1], /globalTurn \+= 1/, "the page keeps no rival tally");
  assert.match(runOneTick[1], /session\.tick\(\)/, "the engine is asked for a turn, not told which one");

  const boot = /async function boot\(\) \{([\s\S]*?)\n  \}/.exec(html);
  assert.ok(boot, "boot() is in the page script");
  assert.doesNotMatch(boot[1], /globalTurn = opening\.turn/, "the opening board sets it through the same path a tick does");
});

test("renderMudiiiHtml: every P2P surface mud.html carries is deliberately absent here", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.doesNotMatch(html, /id="statePill"/);
  assert.doesNotMatch(html, /id="shareBtn"/);
  assert.doesNotMatch(html, /id="joinOpenBtn"/);
  assert.doesNotMatch(html, /wave-btn/);
});

test("renderMudiiiHtml: the ring walks the followed agent, and every press spends a whole-world turn", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /<div class="dir-ring" id="driveRing"/);
  for (const point of ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"]) {
    assert.match(html, new RegExp(`data-drive="${point}"`), `the ring carries ${point}`);
  }
  assert.match(html, /await session\.driveAgent\(followed, direction\)/);
  assert.match(html, /the whole square moved with it/, "the status says a press cost a turn, so it never reads as a free nudge");
  assert.match(html, /the turn was spent anyway/, "a refused press cost the same turn");
  assert.match(html, /ring\.hidden = !followed;/, "with nobody followed there is nothing to walk and no facing to show");
});

test("renderMudiiiHtml: the ring lights one glyph, and it is the followed agent's own facing", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /data-drive="north" title="walk north" aria-label="walk north" aria-pressed="false">▲ N</);
  assert.match(html, /data-drive="east"[^>]*>E ▶</);
  assert.match(html, /data-drive="northwest"[^>]*>↖</);
  assert.match(
    html,
    /buttons\[i\]\.getAttribute\("data-drive"\) === facing \? "true" : "false"/,
    "exactly the facing glyph is lit, never every step the board happens to grant",
  );
  assert.match(html, /\.dir-pill\[aria-pressed="true"\] \{/, "and the lit glyph has a rule to show it with");
});

test("renderMudiiiHtml: an unarmed ground click walks toward the cell along the world's own exits", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /if \(!foodArmed\) \{ walkFollowedTo\(cellId\); return; \}/, "the click no longer dead-ends when nothing is armed");
  assert.match(html, /callScene\("flashCell", target\)/);
  assert.match(html, /routeBetweenCells\(snap\.rows, from, target\)/, "the route is the exit table's answer, not a straight line");
  assert.match(html, /callScene\("clearRoute"\);\s*setSceneStatus\("no way through to "/, "an unreachable cell is declined visibly");
  assert.match(html, /callScene\("showRoute", route\.cells\)/);
  assert.match(html, /await drivePress\(route\.directions\[0\]\)/, "and the first step is taken through the same drive path");
});

test("clipForAction: a hand-driven step walks rather than falling to idle", () => {
  assert.equal(clipForAction("predator", "driven", { idle: "Idle", walk: "Walk", run: "Run" }), "Walk");
  assert.equal(clipForAction("prey", "driven", { idle: "Idle", walk: "Walk" }), "Walk");
});

test("renderMudiiiHtml: the board opens playing, and a reduced-motion visitor gets it drawn but still", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  const bootBlock = /async function boot\(\) \{([\s\S]*?)\n  \}/.exec(html);
  assert.ok(bootBlock, "boot() is in the page script");
  assert.match(bootBlock[1], /if \(!prefersReducedMotion\(\)\) \{\s*autoOn = true;\s*ensureTicker\(\)\.play\(\);/,
    "boot starts the ticker itself, unless motion was asked to stop");
  assert.match(bootBlock[1], /applyTickResult\(opening\);[\s\S]*prefersReducedMotion/,
    "the opening board is drawn before anything starts ticking over it");
  assert.match(html, /const prefersReducedMotion = function prefersReducedMotion\(/,
    "the media-query read is spliced into the page rather than re-implemented");
  assert.match(html, /wireDeck\(\);\s*wirePillComplete\(\);\s*boot\(\);\s*\}\)\(\);/, "boot still runs once at the very end");
});

test("renderMudiiiHtml: a reset draws its own cast and starts it, so the deck's play state never lies", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  const bootBlock = /async function boot\(\) \{([\s\S]*?)\n  \}/.exec(html);
  assert.match(bootBlock[1], /autoOn = false;\s*if \(ticker\) \{ ticker\.pause\(\); ticker = null; \}/,
    "a reboot stops whatever was running before it draws anything");
  assert.match(
    html,
    /el\("resetBtn"\)\.addEventListener\("click", function \(\) \{ boot\(\); \}\)/,
    "reset is the same boot path, so it lands on the same play state",
  );
});

test("renderMudiiiHtml: the page script has no Math.random — two loads of a square cast identically", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.doesNotMatch(html, /Math\.random/, "a shuffled draw makes a board impossible to reload");
});

test("renderMudiiiHtml: the cast is minted by count off the scenario's own id prefix, never sliced from its opening list", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  const bootBlock = /async function boot\(\) \{([\s\S]*?)\n  \}/.exec(html);
  assert.match(bootBlock[1], /mintRoster\(rosterPrefixFor\(s, "predator"\), chosenFoxCount\(\)\)/);
  assert.match(bootBlock[1], /mintRoster\(rosterPrefixFor\(s, "prey"\), chosenGoblinCount\(\)\)/);
  const mint = /function mintRoster\(prefix, count\) \{([\s\S]*?)\n  \}/.exec(html);
  assert.ok(mint, "mintRoster is in the page script");
  assert.match(mint[1], /prefix \+ "-" \+ i/, "the ids match the <prefix>-1..N the engine mints at seeded cells");
  const prefix = /function rosterPrefixFor\(s, role\) \{([\s\S]*?)\n  \}/.exec(html);
  assert.ok(prefix, "rosterPrefixFor is in the page script");
  assert.match(prefix[1], /roleOfAgentId\(first\.id\)/, "the prefix comes off the scenario, not a hardcoded fox");
  assert.doesNotMatch(html, /function pickRoster\(/, "the slice-from-the-opening-cast draw is gone");
});

test("renderMudiiiHtml: the follow control closes while the board plays, driven by the ticker's own state", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  const onRender = /onRender: function \(state\) \{([\s\S]*?)\n      \}/.exec(html);
  assert.ok(onRender, "the ticker's onRender is in the page script");
  assert.match(onRender[1], /playBtn\.setAttribute\("aria-pressed", state\.playing/,
    "the play control reads the ticker's own state");
  assert.match(onRender[1], /el\("agentSelect"\)\.disabled = state\.playing;/,
    "the follow control reads that same state, so the two can never disagree");
  assert.match(onRender[1], /el\("agentSelectHint"\)\.hidden = !state\.playing;/);
  assert.doesNotMatch(
    /el\("agentSelect"\)\.addEventListener\("change"[\s\S]*?\n  \}/.exec(html)[0],
    /playing|autoOn/,
    "the change handler keeps no second notion of whether the board is running",
  );
});

test("renderMudiiiHtml: the follow hint is associated with the select it describes", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /id="agentSelect"[\s\S]{0,120}aria-describedby="agentSelectHint"/);
  assert.match(html, /<span class="deck-hint" id="agentSelectHint" hidden>pause to swap<\/span>/);
});

test("renderMudiiiHtml: picking a new agent after a despawn fallback resumes the mode the fallback took", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  const applyTick = /function applyTickResult\(result\) \{([\s\S]*?)\n  \}/.exec(html);
  assert.ok(applyTick, "applyTickResult is in the page script");
  assert.match(applyTick[1], /if \(nextCamera\.status && camera\.mode !== "overhead"\) cameraModeBeforeFallback = camera\.mode;/);

  const onChange = /el\("agentSelect"\)\.addEventListener\("change", function \(\) \{([\s\S]*?)\n  \}/.exec(html);
  assert.ok(onChange, "the follow select's change handler is in the page script");
  assert.match(onChange[1], /const mode = cameraModeBeforeFallback \|\| camera\.mode;/);
  assert.match(onChange[1], /cameraModeBeforeFallback = null;/);
  assert.match(onChange[1], /callScene\("setCamera", camera\);\s*$/, "the scene is told last, once the new state is settled");

  const onCameraMode = /el\("cameraMode"\)\.addEventListener\("click", function \(e\) \{([\s\S]*?)\n  \}/.exec(html);
  assert.ok(onCameraMode, "the camera-mode click handler is in the page script");
  assert.match(onCameraMode[1], /cameraModeBeforeFallback = null;/,
    "a visitor who deliberately picks overhead stays there");
});

test("renderMudiiiHtml: the belief cards sit below the chat, so the command box is reachable without scrolling past them", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  const chatAt = html.indexOf('class="mudiii-chat"');
  const hudAt = html.indexOf('id="hudRow"');
  const mainEndsAt = html.indexOf("</main>");
  assert.ok(chatAt > 0 && hudAt > 0 && mainEndsAt > 0);
  assert.ok(chatAt < hudAt, "the chat comes first in the document");
  assert.ok(hudAt < mainEndsAt, "the HUD row is still inside main");
  assert.match(html, /body\.editing [^{]*\.hud-row[^{]*\{ display: none; \}/,
    "edit mode still hides the row wherever it sits");
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

test("renderMudiiiHtml: claim pills carry data-command, so the rail promotes to createPillComplete's combobox", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /data-role="dyn-claim"/, "the deception rail renders claim pills");
  assert.match(html, /data-command="/, "a claim pill carries the sentence it submits");
});

test("renderMudiiiHtml: address pills switch the addressee and carry no submittable command", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /data-role="dyn-addr"/);
  assert.match(html, /selectedAddresseeId = btn\.getAttribute\("data-id"\)/, "clicking an address pill only moves the rail's own addressee");
  assert.match(html, /pillsForMudiii\(agentsById, itemsById, selectedAddresseeId/, "the rail is the engine's own pure function, never a page reimplementation");
});

test("renderMudiiiHtml: a true and a false claim pill are told apart by a CSS glyph, never by the submitted text", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /\.pill\[data-role="dyn-claim"\]\[data-truth="true"\]::before \{ content: "\\2713 "/);
  assert.match(html, /\.pill\[data-role="dyn-claim"\]\[data-truth="false"\]::before \{ content: "\\2715 "/);
  assert.match(html, /\[data-truth="false"\] \{ border-style: dashed; border-color: var\(--alert\); \}/);
});

test("renderMudiiiHtml: the rail seeds only verbs mudiii-turn.mjs actually parses, and never 'look'", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /const SEED_COMMANDS = \["tick", "what does the fox see", "where is the goblin", "what can I do"\]/);
  assert.doesNotMatch(html, /command: "look"/, "the town square has no look verb");
  assert.doesNotMatch(html, /"@" \+ id \+ " look"/, "and no per-agent look either");
});

test("renderMudiiiHtml: the map panel draws its grid, its buildings and a key for the colours", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /const mapBlocksFor = /, "the block geometry is spliced beside the dot geometry");
  assert.match(html, /blocks\.map[\s\S]*class="map-block"[\s\S]*\+ dots\.map/, "blocks are drawn before dots, so a dot sits on top of a building");
  assert.match(html, /setProperty\("--map-cell-pct", \(100 \/ size\) \+ "%"\)/, "the drawn grid is stepped by the live board size");
  assert.match(html, /repeating-linear-gradient\(90deg, rgba\(233,217,182,\.22\) 0 1px, transparent 1px var\(--map-cell-pct\)\)/);
  assert.match(html, /class="map-legend"/);
  assert.match(html, /map-swatch map-swatch-predator/);
  assert.match(html, /map-swatch map-swatch-prey/);
  assert.match(html, /map-swatch map-swatch-food/);
  assert.doesNotMatch(html, /class="map-dot[^"]*"><\/i>/, "the legend uses plain swatches, never the absolutely-positioned dot class");
});

test("renderMudiiiHtml: the map names the cast beside each dot, and leaves items to the key", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /if \(d\.kind !== "predator" && d\.kind !== "prey"\) return dot;/);
  assert.match(html, /<span class="map-label mono" style="left:/);
  assert.match(html, /\.map-label \{[\s\S]*pointer-events: none;/, "a label never steals a click meant for the board");
});

test("renderMudiiiHtml: the map board stays square in landscape, capped rather than stretched", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /\.map-panel-board \{\s*position: relative;[\s\S]*aspect-ratio: 1;/);
  assert.doesNotMatch(html, /aspect-ratio: auto/, "no breakpoint gives up the square the dot percentages assume");
  assert.match(html, /\.map-panel-board \{ flex: 0 0 auto; width: min\(100%, 108px\); min-height: 0; margin: 0 auto; \}/);
});

test("renderMudiiiHtml: the deck carries a teach box, hinting a sentence this square can parse", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /<input type="checkbox" id="teachToggle">/);
  assert.match(html, /The fox is at cell-3-4\./, "the hint is the town square's own vocabulary");
  assert.doesNotMatch(html, /lies in the garden/, "never the manor's sentence, which this lane cannot read");
  assert.match(html, /getTeachEnabled: function \(\) \{ return el\("teachToggle"\)\.checked; \}/, "read fresh, so ticking it mid-session lands on the next line");
});

test("renderMudiiiHtml: the chat placeholder is a line the town square can read", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /placeholder="@fox the goblin is east"/);
});

test("renderMudiiiHtml: a pill click appends to the input rather than replacing what is typed", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /function appendToChatInput/);
  assert.match(html, /input\.value = \(head \? head \+ " " : ""\) \+ text;/, "the new text lands after a separating space");
  assert.doesNotMatch(html, /chatInput"\)\.value = btn\.textContent/, "no rail on this page overwrites the input the way adventure's and mud's do");
});

// ---- edit mode reuses mud-editor.mjs -----------------------------------

test("renderMudiiiHtml: the editor's suggestion rail is populated and wired, not dead markup", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /const wordBeforeCursor = /);
  assert.match(html, /function renderSuggestionPills\(\)/);
  assert.match(html, /el\("editorPills"\)\.addEventListener\("click"/, "clicking a suggestion inserts it");
  assert.match(html, /function onEditorChanged\(\) \{ scheduleSuggestions\(\); scheduleSync\(\); \}/);
  assert.match(html, /el\("editorText"\)\.addEventListener\("input", onEditorChanged\);/);
  assert.doesNotMatch(html, /addEventListener\("input", scheduleSync\)/, "the bare sync-only listener is gone");
  assert.match(html, /renderSuggestionPills\(\);\s*renderEditPlacements\(\);/, "the rail is drawn once on entering edit mode");
});

test("renderMudiiiHtml: an edit reboots the 3D scene and puts back the camera and the cast", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /async function rebuildSceneFromEdit\(\)/);
  assert.match(html, /props = propPlacementsFrom\(editRows, DATA\.assetManifest\);/, "the meshes are rebuilt from the edited facts");
  assert.match(
    html,
    /await callScene\("boot",[\s\S]*?\);\s*callScene\("setCamera", camera\);\s*callScene\("applyTick", \{ agents: agentsById, items: itemsById, ecology: \[\] \}\);/,
    "boot resets the camera and clears the agent groups, so both are restored right after it",
  );
  assert.match(html, /await rebuildSceneFromEdit\(\);/);
});

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

// ---- mapBlocksFor ----------------------------------------------------------

test("mapBlocksFor: one block per prop, filling its cell from the cell's own corner", () => {
  const blocks = mapBlocksFor([{ id: "well-1", cell: "cell-2-9" }], GRID_SIZE);
  assert.deepEqual(blocks, [{
    id: "well-1",
    xPct: (1 / GRID_SIZE) * 100,
    yPct: (8 / GRID_SIZE) * 100,
    sizePct: 100 / GRID_SIZE,
  }]);
});

test("mapBlocksFor: a block's corner sits half a cell before the dot that shares its cell", () => {
  const [block] = mapBlocksFor([{ id: "well-1", cell: "cell-4-4" }], GRID_SIZE);
  const [dot] = mapDotsFor([{ id: "fox-1", role: "predator", cell: "cell-4-4" }], [], GRID_SIZE);
  assert.ok(Math.abs((dot.xPct - block.xPct) - block.sizePct / 2) < 1e-9, "the dot is centred on the cell the block fills");
  assert.ok(Math.abs((dot.yPct - block.yPct) - block.sizePct / 2) < 1e-9);
});

test("mapBlocksFor: a placement with no parseable cell is dropped, never drawn at a guessed position", () => {
  assert.deepEqual(mapBlocksFor([{ id: "well-1", cell: null }, { id: "cart-1" }], GRID_SIZE), []);
  assert.deepEqual(mapBlocksFor([{ id: "well-1", cell: "cell-1-1" }], 0), []);
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

test("agentCardMarkup: the belief line sits inside a button that controls its own detail panel", () => {
  const html = agentCardMarkup("2");
  assert.match(html, /<button type="button" class="hud-belief-toggle" id="hud-2-belief-toggle"/);
  assert.match(html, /aria-expanded="false" aria-controls="hud-2-detail"/);
  assert.match(html, /<div class="hud-detail mono" id="hud-2-detail" hidden><\/div>/);
  assert.match(html, /aria-controls="hud-2-detail"[\s\S]*id="hud-2-belief"/, "the summary id the HUD writes into is kept, inside the toggle");
});

test("renderMudiiiHtml: which belief panel is open is keyed on the agent id, never left in the DOM", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /const expandedAgents = new Set\(\);/);
  assert.match(html, /const id = card && card\.getAttribute\("data-agent"\);/, "the toggle reads the agent off the card, not the slot");
  assert.match(html, /if \(expandedAgents\.has\(id\)\) expandedAgents\.delete\(id\); else expandedAgents\.add\(id\);/, "the set is keyed on that id");
  assert.match(html, /const expanded = expandedAgents\.has\(id\);/, "and every render re-applies it");
});

test("renderMudiiiHtml: the belief summary is capped, and the full list comes from believedFactSentence", () => {
  const html = renderMudiiiHtml({ worldPayload: WORLD_PAYLOAD, agents: AGENTS });
  assert.match(html, /const BELIEF_SUMMARY_LIMIT = 3;/);
  assert.match(html, /entries\.slice\(0, BELIEF_SUMMARY_LIMIT\)/);
  assert.match(html, /\+ rest \+ " more"/, "what is cut is counted, never silently dropped");
  assert.match(html, /const believedFactSentence = /, "the detail panel reuses the lane's own sentence");
});
