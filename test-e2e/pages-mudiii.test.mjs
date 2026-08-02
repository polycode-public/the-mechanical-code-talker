// mudiii.html's own town square, in a real browser: nothing plays until the
// deck's play control is pressed, pressing it and waiting five ticks moves
// at least one agent to a new cell and advances the shared turn counter, a
// click on a blocked cell writes nothing and leaves the food pill armed, and
// a typed "put food at cell-3-4" and the same click both land the same kind
// of fact set. Mirrors pages-mud.test.mjs's own fixture setup and assertion
// style.
//
// Every model-dependent assertion is gated on `public/models/` actually
// being on disk — a sibling wave-2 track copies it in from
// data/mudiii-assets.json's own manifest, and until it lands this file still
// proves the simulation itself runs (cells change, the counter advances, the
// map panel's own dots move) without needing a single GLB. The core
// three-scripts contract this page depends on — src/services/mudiii-viz.mjs
// (the page shell), src/services/mudiii-scene.mjs (this track, see its own
// header), scripts/build-three-vendor.mjs (public/vendor/three.js) — also
// has to be present on whichever tree runs this file; see the coordinator's
// own report on when each lands.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { rmSync } from "node:fs";
import path from "node:path";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot, repoRoot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

const READY_TIMEOUT_MS = 30_000;
const TICK_TIMEOUT_MS = 20_000;

let siteDir;
let server;
let browser;
let modelsPresent;

before(async () => {
  // public/models is not checked out in every worktree yet (see this file's
  // own header) — buildDemoSiteSnapshot's own TRACKED_SITE_FILES already
  // names it, so a missing directory throws ENOENT on the copy step rather
  // than merely 404ing per file. Recorded once here so every test below can
  // gate its model-dependent assertions without re-deriving it.
  modelsPresent = existsSync(path.join(repoRoot, "public", "models"));
  siteDir = buildDemoSiteSnapshot();
  server = await serveDirectory(siteDir);
  // Recent Chromium refuses software WebGL outright unless explicitly told
  // it is allowed — without this flag the canvas stays a silent black
  // square rather than failing loudly, which is a much harder thing to
  // debug than a launch flag.
  browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-gl=swiftshader"] });
});

after(async () => {
  await browser?.close();
  await server?.close();
  if (siteDir) rmSync(siteDir, { recursive: true, force: true });
});

/** Open mudiii.html and wait for its own session to finish booting — the
 *  chat input starts disabled and flips once boot() resolves, the same
 *  signal every other tmct page's own chat input uses. Third-party hosts are
 *  blocked and same-origin console errors/failed requests are tracked. */
async function openMudiiiPage() {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  const failedRequests = [];

  await page.route("**/*", (route) => {
    if (route.request().url().startsWith(server.origin)) return route.continue();
    return route.abort();
  });
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const source = msg.location()?.url ?? "";
    if (source && !source.startsWith(server.origin)) return;
    consoleErrors.push(msg.text());
  });
  page.on("requestfailed", (req) => {
    if (req.url().startsWith(server.origin)) failedRequests.push(req.url());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(`${server.origin}/mudiii.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.querySelector("#chatInput") && !document.querySelector("#chatInput").disabled,
    null,
    { timeout: READY_TIMEOUT_MS },
  );
  return { context, page, consoleErrors, failedRequests };
}

const turnCountOf = async (page) =>
  Number(((await page.locator("#globalTurnCount").textContent()).match(/\d+/) ?? ["0"])[0]);

/** Every agent the HUD row currently draws, id -> its authoritative stored
 *  cell, read through `window.mudiiiScene.cellOf` — a JS handle rather than
 *  a pixel position, so this survives a software renderer and even a
 *  scene-load failure (a HUD card still carries `data-agent` with no 3D
 *  scene behind it). */
const agentCellsOf = (page) => page.evaluate(() => {
  const out = {};
  for (const card of document.querySelectorAll("#hudRow .hud-card[data-agent]")) {
    const id = card.getAttribute("data-agent");
    if (!id) continue;
    out[id] = window.mudiiiScene && typeof window.mudiiiScene.cellOf === "function" ? window.mudiiiScene.cellOf(id) : null;
  }
  return out;
});

test("the page boots with nothing playing, and no console error along the way", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    assert.equal(await page.locator("#autoToggle").getAttribute("aria-pressed"), "false", "the deck's play control starts off");
    assert.equal(await turnCountOf(page), 0, "no turn has run at all on load");
    assert.equal(await page.locator("#foodPill").getAttribute("aria-pressed"), "false", "the food pill starts unarmed");
    assert.ok(await page.locator("#hudRow .hud-card").count() > 0, "the opening cast is drawn before any turn runs");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error booting the town square with nothing playing");
  } finally {
    await context.close();
  }
});

test("pressing play and waiting five ticks moves at least one agent and advances the shared counter", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    const before = await agentCellsOf(page);
    await page.locator("#autoToggle").click();
    await page.waitForFunction((n) => {
      const m = (document.querySelector("#globalTurnCount")?.textContent ?? "").match(/\d+/);
      return m && Number(m[0]) >= n;
    }, 5, { timeout: TICK_TIMEOUT_MS });
    await page.locator("#autoToggle").click();

    assert.ok(await turnCountOf(page) >= 5, "the shared turn counter advanced across five ticks");

    const after = await agentCellsOf(page);
    const moved = Object.keys(before).filter((id) => before[id] !== after[id] && after[id] != null);
    assert.ok(moved.length > 0, "at least one live agent's own stored cell changed across the run");

    const mapDots = await page.locator("#mapPanelBoard .map-dot").count();
    assert.ok(mapDots > 0, "the map panel draws a dot for the live cast, independent of whether the 3D scene loaded");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error running five ticks");
  } finally {
    await context.close();
  }
});

test("the 3D scene canvas boots without a console error, when the model catalogue is present", { skip: !modelsPresent }, async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    await page.waitForFunction(
      () => window.mudiiiScene && typeof window.mudiiiScene.ready === "function" && window.mudiiiScene.ready(),
      null,
      { timeout: READY_TIMEOUT_MS },
    );
    assert.deepEqual(failedRequests, [], "every model request the scene makes resolves — this is what catches a missing model");
    assert.deepEqual(consoleErrors, [], "no console error loading the scene's own assets");
  } finally {
    await context.close();
  }
});

// The world direction each facing word means, mirrored from cameraRigFor's
// own FACING_VECTOR table (mudiii-viz.mjs) — the convention yawForFacing's
// own header says a rotated mesh has to match.
const FACING_VECTOR = { north: { x: 0, z: -1 }, south: { x: 0, z: 1 }, east: { x: 1, z: 0 }, west: { x: -1, z: 0 } };

/** Every HUD-drawn agent's own stored cell and applied Y rotation this
 *  instant, id -> { cell, yaw } — the same two live reads a screenshot-based
 *  eyeball check would otherwise stand in for. */
const agentCellsAndYawOf = (page) => page.evaluate(() => {
  const out = {};
  for (const card of document.querySelectorAll("#hudRow .hud-card[data-agent]")) {
    const id = card.getAttribute("data-agent");
    if (!id || !window.mudiiiScene) continue;
    out[id] = { cell: window.mudiiiScene.cellOf(id), yaw: window.mudiiiScene.yawOf(id) };
  }
  return out;
});

function cellToXY(cell) {
  const m = /^cell-(\d+)-(\d+)$/.exec(cell || "");
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

/** The cardinal word a one-cell move from `a` to `b` travelled, or null for
 *  anything that is not exactly one orthogonal step (a multi-cell jump, a
 *  diagonal, or holding still). */
function directionOfHop(a, b) {
  const from = cellToXY(a), to = cellToXY(b);
  if (!from || !to) return null;
  const dx = to.x - from.x, dy = to.y - from.y;
  if (dx === 1 && dy === 0) return "east";
  if (dx === -1 && dy === 0) return "west";
  if (dx === 0 && dy === 1) return "south";
  if (dx === 0 && dy === -1) return "north";
  return null;
}

test("every agent that takes a one-cell step renders facing the way it actually travelled, when the model catalogue is present", { skip: !modelsPresent }, async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    await page.waitForFunction(
      () => window.mudiiiScene && typeof window.mudiiiScene.ready === "function" && window.mudiiiScene.ready(),
      null,
      { timeout: READY_TIMEOUT_MS },
    );
    let prev = await agentCellsAndYawOf(page);
    const samples = [];
    await page.locator("#autoToggle").click();
    // A generous tick budget: the samples this test cares about are whatever
    // single-cell hops actually happen along the way, not a forced direction
    // (the engine's own movement choices are a sibling track's, not driven
    // here), so this runs long enough to almost certainly see every cardinal
    // at least once across the live roster.
    for (let tick = 1; tick <= 16; tick += 1) {
      await page.waitForFunction((n) => {
        const m = (document.querySelector("#globalTurnCount")?.textContent ?? "").match(/\d+/);
        return m && Number(m[0]) >= n;
      }, tick, { timeout: TICK_TIMEOUT_MS });
      const cur = await agentCellsAndYawOf(page);
      for (const id of Object.keys(cur)) {
        const before = prev[id];
        const after = cur[id];
        if (!before || !after || !before.cell || !after.cell) continue;
        const direction = directionOfHop(before.cell, after.cell);
        if (!direction) continue;
        samples.push({ id, direction, yaw: after.yaw });
      }
      prev = cur;
    }
    await page.locator("#autoToggle").click();

    assert.ok(samples.length > 0, "at least one live agent took a one-cell step across the run");
    for (const sample of samples) {
      const modelForward = { x: Math.sin(sample.yaw), z: Math.cos(sample.yaw) };
      const wanted = FACING_VECTOR[sample.direction];
      const dot = modelForward.x * wanted.x + modelForward.z * wanted.z;
      assert.ok(
        dot > 0.9,
        `${sample.id} stepped ${sample.direction} but its applied yaw (${sample.yaw}) faces a different way (dot ${dot})`,
      );
    }

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error stepping the cast around the square");
  } finally {
    await context.close();
  }
});

/** Every HUD-drawn agent id's own mesh reading, id -> { height, minY,
 *  targetHeight } | null, read through window.mudiiiScene.meshHeightOf —
 *  the live group's own measured world-space box, not a second, locally
 *  invented number. */
const meshHeightsOf = (page) => page.evaluate(() => {
  const out = {};
  for (const card of document.querySelectorAll("#hudRow .hud-card[data-agent]")) {
    const id = card.getAttribute("data-agent");
    if (!id) continue;
    out[id] = window.mudiiiScene && typeof window.mudiiiScene.meshHeightOf === "function"
      ? window.mudiiiScene.meshHeightOf(id)
      : null;
  }
  return out;
});

/** Waits until every HUD-drawn agent has a real, positive mesh height —
 *  each agent's own model load is asynchronous, so a bare read right after
 *  a slider reboot, a tick or a Reset can still catch one mid-load. */
async function waitForEveryMeshHeight(page, timeout) {
  await page.waitForFunction(() => {
    const cards = document.querySelectorAll("#hudRow .hud-card[data-agent]");
    if (!cards.length) return false;
    for (const card of cards) {
      const id = card.getAttribute("data-agent");
      const reading = window.mudiiiScene && typeof window.mudiiiScene.meshHeightOf === "function"
        ? window.mudiiiScene.meshHeightOf(id)
        : null;
      if (!reading || !reading.height) return false;
    }
    return true;
  }, null, { timeout });
}

/** Every HUD-drawn agent's mesh sits within +-20% of its own manifest
 *  targetHeight and within 0.05 of the ground. Agents past the first of their
 *  kind once shared one parsed model, so each was measured through another
 *  agent's group mid-flourish and came out a different wrong size. */
function assertEveryMeshWithinTolerance(heights, label) {
  const ids = Object.keys(heights);
  assert.ok(ids.length > 0, `${label}: at least one HUD-drawn agent to check`);
  for (const id of ids) {
    const reading = heights[id];
    assert.ok(reading, `${label}: ${id} has a mesh height reading`);
    assert.ok(reading.targetHeight, `${label}: ${id} has a manifest targetHeight to compare against`);
    const ratio = reading.height / reading.targetHeight;
    assert.ok(
      ratio > 0.8 && ratio < 1.2,
      `${label}: ${id} mesh height ${reading.height} is within +-20% of target ${reading.targetHeight} (ratio ${ratio.toFixed(3)})`,
    );
    assert.ok(
      Math.abs(reading.minY) < 0.05,
      `${label}: ${id} mesh's lowest point sits within 0.05 of the ground (minY ${reading.minY})`,
    );
  }
}

test("every HUD agent's mesh is correctly sized and seated at the largest cast, on load, after ticks and after Reset", { skip: !modelsPresent }, async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    // Drive both sliders to their own max before rebooting — the largest
    // cast is where the shared-cache bug compounds the hardest, and a
    // clamped roster still reports its own real count through aria-valuetext
    // rather than the slider's own requested value. The page updates
    // aria-valuetext from `input` and reboots from `change` — a real drag
    // fires both, so this dispatches both on each slider rather than only
    // the one event that happens to trigger a reboot.
    await page.evaluate(() => {
      const fox = document.getElementById("playerCountSlider");
      const npc = document.getElementById("npcCountSlider");
      fox.value = fox.max;
      npc.value = npc.max;
      fox.dispatchEvent(new Event("input", { bubbles: true }));
      npc.dispatchEvent(new Event("input", { bubbles: true }));
      fox.dispatchEvent(new Event("change", { bubbles: true }));
      npc.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForFunction(() => {
      const fox = document.getElementById("playerCountSlider");
      const npc = document.getElementById("npcCountSlider");
      const foxCount = Number((fox.getAttribute("aria-valuetext") || "").match(/\d+/)?.[0] || 0);
      const npcCount = Number((npc.getAttribute("aria-valuetext") || "").match(/\d+/)?.[0] || 0);
      const cards = document.querySelectorAll("#hudRow .hud-card[data-agent]").length;
      return foxCount + npcCount > 0 && cards === foxCount + npcCount;
    }, null, { timeout: READY_TIMEOUT_MS });
    await waitForEveryMeshHeight(page, READY_TIMEOUT_MS);
    assertEveryMeshWithinTolerance(await meshHeightsOf(page), "on load, largest cast");

    await page.locator("#autoToggle").click();
    await page.waitForFunction((n) => {
      const m = (document.querySelector("#globalTurnCount")?.textContent ?? "").match(/\d+/);
      return m && Number(m[0]) >= n;
    }, 4, { timeout: TICK_TIMEOUT_MS });
    await page.locator("#autoToggle").click();
    await waitForEveryMeshHeight(page, READY_TIMEOUT_MS);
    assertEveryMeshWithinTolerance(await meshHeightsOf(page), "after four ticks");

    // The Reset path is where the warm loader cache bites hardest: every
    // agent re-requests the very same URL a second time, this time into an
    // already-warm cache.
    //
    // Wait on the turn counter and a non-empty cast, never on the cast size
    // held before the Reset. Prey arrive from the perimeter while the board
    // plays, so the cast is usually larger by then than the seeded roster a
    // Reset returns to.
    await page.locator("#resetBtn").click();
    await page.waitForFunction(
      () => document.querySelectorAll("#hudRow .hud-card[data-agent]").length > 0
        && (document.querySelector("#globalTurnCount")?.textContent ?? "").includes("turns: 0"),
      null,
      { timeout: READY_TIMEOUT_MS },
    );
    await waitForEveryMeshHeight(page, READY_TIMEOUT_MS);
    assertEveryMeshWithinTolerance(await meshHeightsOf(page), "after Reset");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error sizing and seating the largest cast across load, ticks and Reset");
  } finally {
    await context.close();
  }
});

test("a click on a blocked cell writes nothing and leaves the food pill armed", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    await page.locator("#foodPill").click();
    assert.equal(await page.locator("#foodPill").getAttribute("aria-pressed"), "true", "the pill reports itself armed");

    const chatLinesBefore = await page.locator("#chatLog > *").count();

    // A prop's own cell is always blocked (propPlacementsFrom/blockedCellReason,
    // mudiii-viz.mjs) — house-1 sits at cell-8-1 in every scenario's own
    // opening layout, per data/mudiii-assets.json's committed props table.
    await page.evaluate(() => window.mudiiiHandleSceneClick && window.mudiiiHandleSceneClick("cell-8-1"));
    await page.waitForFunction(
      () => (document.getElementById("sceneStatus")?.textContent ?? "").length > 0,
      null,
      { timeout: TICK_TIMEOUT_MS },
    );
    assert.match(await page.locator("#sceneStatus").textContent(), /blocked/, "the refusal names the cell as blocked");
    assert.equal(await page.locator("#foodPill").getAttribute("aria-pressed"), "true", "a refused click never disarms the pill");
    assert.equal(await page.locator("#chatLog > *").count(), chatLinesBefore, "a refused click writes no chat line and no fact");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error refusing a click on a blocked cell");
  } finally {
    await context.close();
  }
});

/** The world's own facts as plain sentences, via edit mode's textarea — the
 *  same round-trip mud.html's own editor exposes, used here purely as a
 *  read: opening it, reading the buffer, then leaving without changing
 *  anything. */
async function readWorldSentences(page) {
  await page.locator("#editModeBtn").click();
  await page.waitForFunction(
    () => document.body.classList.contains("editing") && (document.getElementById("editorText")?.value ?? "").length > 0,
    null,
    { timeout: READY_TIMEOUT_MS },
  );
  const text = await page.locator("#editorText").inputValue();
  await page.locator("#editModeBtn").click();
  await page.waitForFunction(() => !document.body.classList.contains("editing"), null, { timeout: READY_TIMEOUT_MS });
  return text;
}

/** Run `act` and wait for the chat to carry the whole exchange it starts —
 *  the echoed command line and the answer under it, two entries. The baseline
 *  is counted BEFORE anything is sent, because the echo lands the instant the
 *  command is submitted: counted afterwards, it already includes the line it
 *  is supposed to be waiting for, and the wait can only ever time out.
 *  `prepare` runs first without being counted, for filling the input. */
async function sendAndSettle(page, act, { prepare = null } = {}) {
  if (prepare) await prepare();
  const before = await page.locator("#chatLog > *").count();
  await act();
  await page.waitForFunction(
    (n) => document.querySelectorAll("#chatLog > *").length >= n,
    before + 2,
    { timeout: TICK_TIMEOUT_MS },
  );
}

test("a typed 'put food at cell-3-4' and a click on the same cell both place a morsel there", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    const before = await readWorldSentences(page);
    await sendAndSettle(page, () => page.locator("#chatInput").press("Enter"), {
      prepare: () => page.locator("#chatInput").fill("put food at cell-3-4"),
    });
    const afterTyped = await readWorldSentences(page);
    const typedAdded = afterTyped.split("\n").filter((line) => !before.includes(line) && line.trim());
    // The subject id (morsel-N) is sequential and therefore never the same
    // between the two paths — every OTHER clause (type, class chain,
    // location, provenance) is compared with the id normalized away. The match
    // is case-insensitive because a sentence capitalizes its own subject
    // ("Morsel-1 stands in the cell-3-4."), and an id left un-normalized makes
    // the two sides differ for the one reason this comparison exists to ignore.
    const normalized = (lines) => lines.map((l) => l.replace(/\bmorsel-\d+\b/gi, "morsel-X")).sort();
    assert.ok(typedAdded.some((l) => /is a morsel/i.test(l)), "the typed verb places a morsel, not a bare food row");
    assert.ok(typedAdded.some((l) => /cell-3-4/.test(l)), "the typed verb's morsel lands on the named cell");

    await page.locator("#foodPill").click();
    await sendAndSettle(page, () =>
      page.evaluate(() => window.mudiiiHandleSceneClick && window.mudiiiHandleSceneClick("cell-3-5")));
    const afterClicked = await readWorldSentences(page);
    const clickAdded = afterClicked.split("\n").filter((line) => !afterTyped.includes(line) && line.trim());
    assert.ok(clickAdded.some((l) => /is a morsel/i.test(l)), "the click places the same KIND of fact — a morsel — as the typed verb");
    assert.deepEqual(
      normalized(typedAdded.filter((l) => !/cell-3-4/.test(l))),
      normalized(clickAdded.filter((l) => !/cell-3-5/.test(l))),
      "with cell and subject id normalized away, the typed verb and the click add the same shape of fact set",
    );

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error placing food by chat and by click");
  } finally {
    await context.close();
  }
});

/** Switch the deck's scenario dropdown to the square whose label matches
 *  `pattern`, and wait for the new square's own opening cast to be drawn.
 *  Returns the picked scenario's embedded board size. The wait is on an
 *  agent id only that square casts, because boot() draws the HUD after it
 *  has the engine's own opening board — a count alone can match the square
 *  being left behind. */
async function switchScenario(page, pattern, waitForAgentId) {
  const gridSize = await page.evaluate((source) => {
    const index = MUDIII_PAGE_DATA.scenarios.findIndex((s) => new RegExp(source, "i").test(s.label || ""));
    if (index < 0) return null;
    const select = document.getElementById("scenarioSelect");
    select.value = String(index);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    return MUDIII_PAGE_DATA.scenarios[index].gridSize;
  }, pattern.source);
  await page.waitForFunction(
    (id) => !!document.querySelector(`#hudRow .hud-card[data-agent="${id}"]`),
    waitForAgentId,
    { timeout: READY_TIMEOUT_MS },
  );
  return gridSize;
}

/** Every map-panel dot's own left/top percentage, back-solved into the cell
 *  coordinate `size` would have produced. mapDotsFor draws a cell at
 *  `((n - 0.5) / size) * 100`%, so a board drawn at the wrong size back-solves
 *  to a fraction rather than a whole cell. */
const mapDotCellsUnder = (page, size) => page.evaluate((gridSize) => {
  const cellFrom = (pct) => Number(pct.replace("%", "")) * gridSize / 100 + 0.5;
  return [...document.querySelectorAll("#mapPanelBoard .map-dot")].map((dot) => ({
    id: dot.getAttribute("title"),
    x: cellFrom(dot.style.left),
    y: cellFrom(dot.style.top),
  }));
}, size);

test("switching to the 14x14 chapel yard redraws the board at its own size and places food outside a 12-cell square", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    const gridSize = await switchScenario(page, /chapel/, "fox-2");
    assert.equal(gridSize, 14, "the chapel yard's own board size travels with its scenario");

    const dots = await mapDotCellsUnder(page, 14);
    assert.ok(dots.length > 0, "the map panel draws the chapel yard's opening cast");
    const onACell = (n) => Math.abs(n - Math.round(n)) < 0.001;
    for (const dot of dots) {
      assert.ok(
        onACell(dot.x) && onACell(dot.y),
        `${dot.id} sits on a whole cell of the 14-square board, not a fraction of a 12-square one (${dot.x}, ${dot.y})`,
      );
      // Round before bounding: the browser serializes the inline percentage
      // with fewer digits than it was written with, so a dot on the last cell
      // back-solves to 14.000004 and fails a bare <= 14.
      const cell = { x: Math.round(dot.x), y: Math.round(dot.y) };
      assert.ok(
        cell.x >= 1 && cell.x <= 14 && cell.y >= 1 && cell.y <= 14,
        `${dot.id} is on the board (cell-${cell.x}-${cell.y})`,
      );
    }
    assert.ok(
      dots.some((d) => Math.round(d.x) > 12 || Math.round(d.y) > 12),
      "at least one of the chapel yard's own opening cast stands past the 12-square board's edge",
    );

    // cell-13-13 exists on the chapel yard alone.
    const before = await readWorldSentences(page);
    await page.locator("#foodPill").click();
    await sendAndSettle(page, () =>
      page.evaluate(() => window.mudiiiHandleSceneClick && window.mudiiiHandleSceneClick("cell-13-13")));
    const added = (await readWorldSentences(page)).split("\n").filter((line) => !before.includes(line) && line.trim());
    assert.ok(added.some((l) => /is a morsel/i.test(l)), "the click places a morsel");
    assert.ok(added.some((l) => /cell-13-13/.test(l)), "the morsel lands on the cell clicked, never clamped back onto a 12-square board");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error switching squares and placing food on the far corner");
  } finally {
    await context.close();
  }
});
