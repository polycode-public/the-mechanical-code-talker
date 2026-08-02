// Captures the marketing screenshots public/index.html's feature plates
// show, plus the manifest that documents how they were captured: filename,
// viewport, the PNG's own pixel dimensions, a sha256, and the package version
// the capture ran against.
//
// Builds a fresh site snapshot the same way the e2e suite does (see
// test-e2e/helpers/demo-site.mjs) so every plate always shows the current design,
// never a build left over from an earlier session. Run via `npm run
// gen:screenshots`.
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

import { buildDemoSiteSnapshot, repoRoot } from "../test-e2e/helpers/demo-site.mjs";
import { serveDirectory } from "../test-e2e/helpers/static-server.mjs";

const VIEWPORT = { width: 1024, height: 600 };
const READY_TIMEOUT_MS = 30_000;
// A short paint settle after the readiness signal below — never a substitute
// for it, just insurance against a transition still mid-frame.
const SETTLE_MS = 250;

// mud.html is the one page whose plate needs to look busy rather than just
// loaded (both animals mid-simulation, not two idle panes at boot), so its own
// ready check drives the simulation forward before the shot fires. The turn
// count is a floor chosen so the shot always shows multiple turns in both
// panes; the timeout budgets for that floor at the page's default 650ms
// auto-play delay, spread across two characters ticking independently rather
// than one at a time.
const MUD_BUSY_TURN_THRESHOLD = 12;
const MUD_BUSY_TIMEOUT_MS = 30_000;

// mudiii.html carries the same busy-plate requirement as mud, on top of a
// heavier boot: an 800 KB three.js bundle and 1.1 MB of models load before
// the scene's own ready() signal ever fires, so both of its timeouts get
// real headroom rather than reusing READY_TIMEOUT_MS/MUD_BUSY_TIMEOUT_MS.
const MUDIII_BUSY_TURN_THRESHOLD = 12;
// One tween's worth after scrolling, so the shot lands on settled meshes
// rather than mid-step: the scene eases a one-cell move over 250ms.
const SCENE_SETTLE_MS = 1_200;
const MUDIII_READY_TIMEOUT_MS = 60_000;
const MUDIII_BUSY_TIMEOUT_MS = 60_000;

// Same order the home page lists its claim blocks and feature plates in.
const PAGE_ORDER = ["chat", "spider-fly", "plan", "adventure", "ledger", "code", "ingest", "sprites", "research", "mud", "mudiii"];

/** Each page's own boot signal, mirrored from its e2e file rather than a
 *  blind timeout: the composer/board/dashboard/catalog element the page
 *  itself only shows once it has finished loading. */
const READY_CHECKS = {
  chat: (page) => page.waitForFunction(() => {
    const input = document.querySelector("#composerInput");
    return input && !input.disabled;
  }, null, { timeout: READY_TIMEOUT_MS }),
  "spider-fly": (page) => page.waitForFunction(
    () => !document.querySelector("#chatq")?.disabled,
    null,
    { timeout: READY_TIMEOUT_MS },
  ),
  plan: (page) => page.locator("#board .block").first().waitFor({ state: "visible", timeout: READY_TIMEOUT_MS }),
  adventure: (page) => page.waitForFunction(
    () => document.querySelector("#chatq") && !document.querySelector("#chatq").disabled,
    null,
    { timeout: READY_TIMEOUT_MS },
  ),
  ledger: (page) => page.locator(".dash").waitFor({ state: "visible", timeout: READY_TIMEOUT_MS }),
  code: (page) => page.locator("#ledger .row").first().waitFor({ state: "visible", timeout: READY_TIMEOUT_MS }),
  ingest: async (page) => {
    await page.waitForFunction(() => window.tmctIngestReady instanceof Promise, null, { timeout: READY_TIMEOUT_MS });
    await page.evaluate(() => window.tmctIngestReady);
  },
  sprites: (page) => page.locator(".card").first().waitFor({ state: "visible", timeout: READY_TIMEOUT_MS }),
  research: async (page) => {
    await page.waitForFunction(() => window.tmctResearchReady instanceof Promise, null, { timeout: READY_TIMEOUT_MS });
    await page.evaluate(() => window.tmctResearchReady);
  },
  // Every other ready check above only waits for boot. This one also drives
  // the simulation itself: relying on auto-play's own turn-by-turn rolls to
  // eventually open a second room before the shot fires would make the wait
  // unbounded, so it digs one by hand first, then starts both panes playing
  // and waits for a real busy state. Which two animals are cast is drawn live
  // on every load, so the dig goes through the room's own compass ring (which
  // offers only what this room actually allows) rather than a typed command
  // that would depend on who happens to be standing where.
  mud: async (page) => {
    await page.waitForFunction(
      () => !document.querySelector("#window-a-chatq")?.disabled,
      null,
      { timeout: READY_TIMEOUT_MS },
    );

    // A real page.click() scrolls the control it targets into view, which can
    // leave the panes and the survey above it out of the eventual screenshot
    // — dispatching the click straight to the DOM fires the same listener
    // without moving the page.
    const clickFirst = (selector) => page.evaluate((sel) => {
      const node = document.querySelector(sel);
      if (node) node.click();
      return Boolean(node);
    }, selector);

    // Above ground the only way on is the shaft, so walk down before digging
    // when the ring offers no dig at all.
    if (!await clickFirst(".dir-pill.dig")) {
      if (await clickFirst('.dir-pill[aria-label="go down"]')) {
        await page.waitForFunction(() => document.querySelectorAll(".dir-pill.dig").length > 0, null, { timeout: READY_TIMEOUT_MS });
        await clickFirst(".dir-pill.dig");
      }
    }
    await page.waitForFunction(
      () => document.querySelectorAll("#worldMapBoard .room").length > 2,
      null,
      { timeout: READY_TIMEOUT_MS },
    );

    await clickFirst("#autoToggle");

    await page.waitForFunction(
      (threshold) => {
        const turnText = document.querySelector("#globalTurnCount")?.textContent ?? "";
        return Number((turnText.match(/\d+/) ?? ["0"])[0]) >= threshold;
      },
      MUD_BUSY_TURN_THRESHOLD,
      { timeout: MUD_BUSY_TIMEOUT_MS },
    );
    // Auto-play stays running into the capture on purpose — this plate is
    // meant to show the simulation mid-motion, not paused for the shot. The
    // scroll position, on the other hand, needs pinning: the typed commands
    // above can leave the page scrolled to wherever the chat input sits.
    await page.evaluate(() => window.scrollTo(0, 0));
  },
  // mudiii.html runs a live three.js animation loop from the moment it boots,
  // so "networkidle" (used by every ready check above via the default in
  // capturePage) would never resolve — same reason ingest and research use
  // "load" instead, see GOTO_WAIT_UNTIL below. The scene exposes its own
  // readiness signal (window.mudiiiScene.ready()) rather than a DOM element,
  // because the composer input is enabled well before the 3D scene has
  // finished loading its models and placed its cast.
  mudiii: async (page) => {
    await page.waitForFunction(() => window.mudiiiScene?.ready() === true, null, { timeout: MUDIII_READY_TIMEOUT_MS });

    const startingCell = await page.evaluate(() => window.mudiiiScene?.cellOf("fox-1") ?? null);

    // The cast is drawn from the resting board before any turn runs, so this
    // is what "the square is populated" looks like at rest.
    await page.waitForFunction(
      () => document.querySelectorAll("#hudRow .hud-card").length > 0,
      null,
      { timeout: MUDIII_READY_TIMEOUT_MS },
    );

    // A real page.click() scrolls the control into view, which can leave the
    // 3D canvas out of the eventual screenshot — dispatching the click
    // straight to the DOM fires the same listener without moving the page.
    await page.evaluate(() => document.querySelector("#autoToggle")?.click());

    await page.waitForFunction(
      (threshold) => {
        const turnText = document.querySelector("#globalTurnCount")?.textContent ?? "";
        return Number((turnText.match(/\d+/) ?? ["0"])[0]) >= threshold;
      },
      MUDIII_BUSY_TURN_THRESHOLD,
      { timeout: MUDIII_BUSY_TIMEOUT_MS },
    );

    // The turn counter above proves the simulation advanced, not that any
    // mesh actually moved: seededWander can hold an agent on its starting
    // cell for a turn or two. Waiting for fox-1's own cell to change from its
    // starting value is what proves the shot won't land on an empty step.
    await page.waitForFunction(
      (before) => window.mudiiiScene?.cellOf("fox-1") !== before,
      startingCell,
      { timeout: MUDIII_BUSY_TIMEOUT_MS },
    );

    // The only page that does NOT scroll back to the top for its shot. Its
    // deck alone fills the viewport, which would make the plate a picture of
    // some sliders; centring the 3D stage puts the square in frame together
    // with the HUD cards under it, where each animal states what it is doing
    // and what it has actually seen. That pairing is the page's whole point.
    await page.evaluate(() => document.querySelector("#sceneStage")?.scrollIntoView({ block: "center" }));
    await page.waitForTimeout(SCENE_SETTLE_MS);
  },
};

// ingest.html's own e2e file loads with "load" rather than "networkidle" —
// every other page uses "networkidle" in its own file, so each page keeps the
// wait style its own test already trusts. mudiii.html joins them for the same
// reason: its live animation loop and rolling model fetches mean the network
// never truly goes idle.
const GOTO_WAIT_UNTIL = { ingest: "load", research: "load", mudiii: "load" };

/** Read a PNG's pixel dimensions straight out of its IHDR chunk (bytes 16-23,
 *  big-endian width then height) — the only two fields this file needs, so
 *  reading them by hand costs nothing a PNG-decoding dependency would. */
export function readPngDimensions(buffer) {
  const isPng = buffer.length >= 24
    && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47;
  if (!isPng) throw new Error("not a PNG buffer");
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function capturePage(browser, origin, name) {
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();
  try {
    await page.route("**/*", (route) => {
      if (route.request().url().startsWith(origin)) return route.continue();
      return route.abort();
    });
    await page.goto(`${origin}/${name}.html`, { waitUntil: GOTO_WAIT_UNTIL[name] ?? "networkidle" });
    await READY_CHECKS[name](page);
    await page.waitForTimeout(SETTLE_MS);
    return await page.screenshot({ type: "png" });
  } finally {
    await context.close();
  }
}

async function main() {
  const { version } = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8"));
  const outDir = join(repoRoot, "public", "screenshots");
  mkdirSync(outDir, { recursive: true });

  const siteDir = buildDemoSiteSnapshot();
  const server = await serveDirectory(siteDir);
  const browser = await chromium.launch();
  const pages = [];
  try {
    for (const name of PAGE_ORDER) {
      const png = await capturePage(browser, server.origin, name);
      const dims = readPngDimensions(png);
      if (dims.width !== VIEWPORT.width || dims.height !== VIEWPORT.height) {
        throw new Error(`${name}.png captured at ${dims.width}x${dims.height}, expected ${VIEWPORT.width}x${VIEWPORT.height}`);
      }
      const file = `${name}.png`;
      writeFileSync(join(outDir, file), png);
      pages.push({
        page: name,
        file,
        viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
        png: { width: dims.width, height: dims.height },
        sha256: createHash("sha256").update(png).digest("hex"),
      });
      console.log(`captured ${file} (${dims.width}x${dims.height})`);
    }
  } finally {
    await browser.close();
    await server.close();
    rmSync(siteDir, { recursive: true, force: true });
  }

  const manifest = {
    tmctVersion: version,
    viewport: { width: VIEWPORT.width, height: VIEWPORT.height },
    pages,
  };
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`wrote ${join(outDir, "manifest.json")}`);
}

// Only run when invoked directly (`npm run gen:screenshots`), not when the
// estate guard imports readPngDimensions from this module.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
