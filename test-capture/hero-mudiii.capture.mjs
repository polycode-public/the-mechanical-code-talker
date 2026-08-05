// Records the silent hero clip of mudiii.html playing itself: about 75 seconds
// of the town square running, seen from three cameras, with a few visitor
// actions along the way. Writes clips/hero-mudiii.webm at the repo root.
//
// Target site: a local snapshot built the way the e2e suite builds one, or the
// deployed site when TMCT_E2E_BASE_URL is set (test-e2e/helpers' own switch —
// the CI capture job inherits it from the deployed-e2e base template).
//
// Nothing here asserts. A capture that cannot reach a live square exits
// non-zero instead, so a CI job never uploads a clip of a blank page.
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { chromium } from "playwright";

import { buildDemoSiteSnapshot, repoRoot } from "../test-e2e/helpers/demo-site.mjs";
import { serveDirectory } from "../test-e2e/helpers/static-server.mjs";

// The hero video element and the OG poster behind it are both 2:1, so the
// capture is shot at that shape rather than cropped to it afterwards. The
// window is the same shape one size up: the deck, the map panel and the whole
// 3D stage only fit together in a taller window, and playwright scales the
// page down to the recorded size with no letterboxing while the shape matches.
const WINDOW = { width: 1600, height: 800 };
const FRAME = { width: 1280, height: 640 };
const CLIP_PATH = path.join(repoRoot, "clips", "hero-mudiii.webm");

// The three.js bundle and the model catalogue load before the scene reports
// itself ready, so boot gets its own generous budget.
const BOOT_TIMEOUT_MS = 90_000;
const ACTION_TIMEOUT_MS = 20_000;

// Where each beat starts, in milliseconds from the first frame of real play.
// The clip ends at CLIP_END_MS, which keeps the whole capture inside the
// 60-90s window a hero loop is written for.
const CLIP_END_MS = 75_000;
const BEATS = [
  { at: 12_000, note: "look down on the whole square", run: pickCamera("overhead") },
  { at: 26_000, note: "follow a fox instead of its prey", run: followAPredator },
  { at: 38_000, note: "ride along at eye level", run: pickCamera("pov") },
  { at: 46_000, note: "drop food on the square", run: placeFood },
  { at: 58_000, note: "tell a fox where the goblin is", run: teachASighting },
  { at: 64_000, note: "move to another square", run: switchSquare },
];

const wait = (page, ms) => page.waitForTimeout(ms);

/** Fire a control's own click listener without moving the page. A real
 *  page.click() scrolls its target into view first, and every control here
 *  lives in the deck above the square — one press and the clip becomes a film
 *  of some sliders. */
const press = (page, selector) => page.evaluate((target) => {
  document.querySelector(target)?.click();
}, selector);

const attribute = (page, selector, name) => page.evaluate(
  ([target, attr]) => document.querySelector(target)?.getAttribute(attr) ?? null,
  [selector, name],
);

function pickCamera(mode) {
  return (page) => press(page, `#cameraMode button[data-mode="${mode}"]`);
}

const playing = (page) => attribute(page, "#autoToggle", "aria-pressed").then((v) => v === "true");

/** Stop the board and wait for it to report itself stopped. The follow control
 *  and the scenario list only open on a still board. */
async function pauseBoard(page) {
  if (await playing(page)) await press(page, "#autoToggle");
  await page.waitForFunction(
    () => document.querySelector("#autoToggle")?.getAttribute("aria-pressed") === "false",
    null,
    { timeout: ACTION_TIMEOUT_MS },
  );
}

/** Start the board again and wait until it says so. */
async function resumeBoard(page) {
  if (!(await playing(page))) await press(page, "#autoToggle");
  await page.waitForFunction(
    () => document.querySelector("#autoToggle")?.getAttribute("aria-pressed") === "true",
    null,
    { timeout: ACTION_TIMEOUT_MS },
  );
}

/** The page opens riding a goblin, so the opening run is a chase seen from the
 *  hunted side. Halfway through the clip the camera swaps to a hunter. */
async function followAPredator(page) {
  await pickCamera("follow")(page);
  await pauseBoard(page);
  await page.evaluate(() => {
    const select = document.getElementById("agentSelect");
    const fox = [...select.options].map((o) => o.value).find((id) => id.startsWith("fox-"));
    if (!fox) return;
    select.value = fox;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await resumeBoard(page);
}

/** Arm the food pill and drop a morsel on the square, seen from above so the
 *  morsel and whoever goes for it are both in frame. The pill disarms itself
 *  once a morsel actually lands, so a cell the board refuses (a building, an
 *  occupied square) leaves it armed and the next cell is tried. */
async function placeFood(page) {
  await pickCamera("overhead")(page);
  for (const cell of ["cell-5-5", "cell-6-6", "cell-4-6", "cell-7-4"]) {
    if ((await attribute(page, "#foodPill", "aria-pressed")) !== "true") await press(page, "#foodPill");
    await page.evaluate((target) => window.mudiiiHandleSceneClick?.(target), cell);
    await wait(page, 600);
    if ((await attribute(page, "#foodPill", "aria-pressed")) === "false") return;
  }
  await press(page, "#foodPill");
}

/** One typed line, so the clip shows the square being talked to rather than
 *  only clicked at. A sighting addressed to a hunter spends a turn like any
 *  other, and the belief lands on that hunter's own HUD card. */
async function teachASighting(page) {
  await page.evaluate(() => {
    const ids = [...document.querySelectorAll("#hudRow .hud-card[data-agent]")]
      .map((card) => card.getAttribute("data-agent"));
    const fox = ids.find((id) => id.startsWith("fox-"));
    const goblin = ids.find((id) => id.startsWith("goblin-"));
    if (!fox || !goblin) return;
    document.getElementById("chatInput").value = `@${fox} the ${goblin} is at cell-5-5`;
    document.getElementById("chatForm").requestSubmit();
  });
}

/** Swap to the next square on the list, if the build ships more than one, and
 *  leave it playing. boot() turns the play control on as its last act. */
async function switchSquare(page) {
  const count = await page.locator("#scenarioSelect option").count();
  if (count < 2) return;
  await pauseBoard(page);
  await page.evaluate(() => {
    const select = document.getElementById("scenarioSelect");
    select.value = "1";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(
    () => document.querySelector("#autoToggle")?.getAttribute("aria-pressed") === "true",
    null,
    { timeout: BOOT_TIMEOUT_MS },
  );
  await pickCamera("overhead")(page);
}

/** Frame the square. When the deck and the whole 3D stage fit in the window
 *  together, the top of the page is the shot: controls, the map panel and the
 *  square, all at once. When they do not, the stage alone is worth the frame.
 *  Re-applied after every beat, because a control that reboots the square can
 *  leave the page scrolled somewhere else. */
const frameTheSquare = (page) => page.evaluate(() => {
  const stage = document.querySelector("#sceneStage");
  if (!stage) return;
  const bottom = stage.getBoundingClientRect().bottom + window.scrollY;
  if (bottom <= window.innerHeight) window.scrollTo(0, 0);
  else stage.scrollIntoView({ block: "center" });
});

/** Wait until the square is drawn, its cast is on the HUD and the board is
 *  running under its own steam. Each signal is the page's own, so nothing here
 *  is a blind sleep. */
async function waitForLiveSquare(page) {
  await page.waitForFunction(
    () => document.querySelector("#chatInput") && !document.querySelector("#chatInput").disabled,
    null,
    { timeout: BOOT_TIMEOUT_MS },
  );
  await page.waitForFunction(
    () => document.querySelectorAll("#hudRow .hud-card").length > 0,
    null,
    { timeout: BOOT_TIMEOUT_MS },
  );
  await page.waitForFunction(
    () => window.mudiiiScene && typeof window.mudiiiScene.ready === "function" && window.mudiiiScene.ready() === true,
    null,
    { timeout: BOOT_TIMEOUT_MS },
  );
  await resumeBoard(page);
  await page.waitForFunction(
    () => {
      const turns = (document.querySelector("#globalTurnCount")?.textContent ?? "").match(/\d+/);
      return turns && Number(turns[0]) >= 1;
    },
    null,
    { timeout: ACTION_TIMEOUT_MS },
  );
}

async function main() {
  const siteDir = buildDemoSiteSnapshot();
  const server = await serveDirectory(siteDir);
  const videoDir = mkdtempSync(path.join(tmpdir(), "tmct-capture-"));
  // Chromium refuses software WebGL unless told it is allowed, and a CI runner
  // has no GPU — without these flags the canvas records as a black square.
  const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader", "--use-gl=swiftshader"] });
  const context = await browser.newContext({
    viewport: WINDOW,
    recordVideo: { dir: videoDir, size: FRAME },
  });
  const page = await context.newPage();
  const video = page.video();

  try {
    // The scene's own animation loop and its rolling model fetches mean the
    // network never truly goes idle, so this waits on "load" and then on the
    // page's own readiness signals.
    await page.goto(`${server.origin}/mudiii.html`, { waitUntil: "load", timeout: BOOT_TIMEOUT_MS });
    await waitForLiveSquare(page);
    await frameTheSquare(page);
    await wait(page, 1_200);

    const startedAt = Date.now();
    for (const beat of BEATS) {
      const untilBeat = beat.at - (Date.now() - startedAt);
      if (untilBeat > 0) await wait(page, untilBeat);
      console.log(`${String(Math.round((Date.now() - startedAt) / 1000)).padStart(2, " ")}s ${beat.note}`);
      await beat.run(page);
      await frameTheSquare(page);
    }
    const untilEnd = CLIP_END_MS - (Date.now() - startedAt);
    if (untilEnd > 0) await wait(page, untilEnd);
    console.log(`${Math.round((Date.now() - startedAt) / 1000)}s done`);
  } finally {
    await context.close();
    await browser.close();
    await server.close();
    if (siteDir) rmSync(siteDir, { recursive: true, force: true });
  }

  const recorded = await video.path();
  mkdirSync(path.dirname(CLIP_PATH), { recursive: true });
  rmSync(CLIP_PATH, { force: true });
  // Copied rather than moved: the recording lands in the system temp
  // directory, which is a different filesystem from the repo on some runners.
  copyFileSync(recorded, CLIP_PATH);
  rmSync(videoDir, { recursive: true, force: true });
  const megabytes = (statSync(CLIP_PATH).size / 1024 / 1024).toFixed(2);
  console.log(`wrote ${CLIP_PATH} (${megabytes} MB, ${FRAME.width}x${FRAME.height})`);
}

await main();
