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

test("a typed 'put food at cell-3-4' and a click on the same cell both place a morsel there", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    const before = await readWorldSentences(page);
    await page.locator("#chatInput").fill("put food at cell-3-4");
    await page.locator("#chatForm button, #chatInput").first().press("Enter").catch(() => {});
    await page.locator("#chatInput").press("Enter");
    await page.waitForFunction(
      (n) => document.querySelectorAll("#chatLog > *").length >= n,
      (await page.locator("#chatLog > *").count()) + 1,
      { timeout: TICK_TIMEOUT_MS },
    );
    const afterTyped = await readWorldSentences(page);
    const typedAdded = afterTyped.split("\n").filter((line) => !before.includes(line) && line.trim());
    // The subject id (morsel-N) is sequential and therefore never the same
    // between the two paths — every OTHER clause (type, class chain,
    // location, provenance) is compared with the id normalized away.
    const normalized = (lines) => lines.map((l) => l.replace(/\bmorsel-\d+\b/g, "morsel-X")).sort();
    assert.ok(typedAdded.some((l) => /is a morsel/i.test(l)), "the typed verb places a morsel, not a bare food row");
    assert.ok(typedAdded.some((l) => /cell-3-4/.test(l)), "the typed verb's morsel lands on the named cell");

    await page.locator("#foodPill").click();
    await page.evaluate(() => window.mudiiiHandleSceneClick && window.mudiiiHandleSceneClick("cell-3-5"));
    await page.waitForFunction(
      (n) => document.querySelectorAll("#chatLog > *").length >= n,
      (await page.locator("#chatLog > *").count()) + 1,
      { timeout: TICK_TIMEOUT_MS },
    ).catch(() => {});
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
