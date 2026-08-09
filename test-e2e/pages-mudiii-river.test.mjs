// mudiii.html's river-crossing scenario, in a real browser: the fourth
// dropdown entry opens paused (a puzzle solves by search, it does not play
// itself), names its four passengers on the follow control, and its actor
// card and outlook panel show the crossing plan a bounded search found over
// the world's own drive facts. Editing the fox's own appetite for the goat
// live-redraws that plan with no turn spent: retracting it widens the
// search, restoring it and adding a second appetite exhausts every legal
// opening, and undoing both returns the original crossing byte-identically.
// Mirrors pages-mudiii.test.mjs's own fixture setup and assertion style.
import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { chromium } from "playwright";
import { buildDemoSiteSnapshot } from "./helpers/demo-site.mjs";
import { serveDirectory } from "./helpers/static-server.mjs";

const READY_TIMEOUT_MS = 30_000;
const SYNC_TIMEOUT_MS = 20_000;
const PHONE_WIDTHS = [375, 320];

let siteDir;
let server;
let browser;

before(async () => {
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

/** Open mudiii.html and wait for its opening (chase) board to finish
 *  booting, the same signal pages-mudiii.test.mjs's own openMudiiiPage
 *  waits on. Third-party hosts are blocked and same-origin console
 *  errors/failed requests are tracked for the whole session, river switch
 *  included. */
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
  await page.waitForFunction(
    () => document.querySelector("#autoToggle")?.getAttribute("aria-pressed") === "true",
    null,
    { timeout: READY_TIMEOUT_MS },
  );
  return { context, page, consoleErrors, failedRequests };
}

/** Stop the board and wait until it is actually still — pauseBoard's own
 *  shape from pages-mudiii.test.mjs. Checked before clicking rather than
 *  clicked blindly: a blind click toggles a paused board back to playing
 *  just as readily as it stops a playing one, which is exactly the mistake
 *  gen-screenshots.mjs's own mudiii ready check had to learn to avoid. */
async function pauseBoard(page) {
  if (await page.locator("#autoToggle").getAttribute("aria-pressed") === "true") {
    await page.locator("#autoToggle").click();
  }
  await page.waitForFunction(
    () => document.querySelector("#autoToggle")?.getAttribute("aria-pressed") === "false",
    null,
    { timeout: SYNC_TIMEOUT_MS },
  );
}

/** Switch the deck to the river-crossing scenario and wait for its own
 *  puzzle boot to finish. A puzzle scenario opens paused by design — nothing
 *  moves on its own — so waiting for the play control to read "true" the
 *  way pages-mudiii.test.mjs's switchScenario does for a chase square would
 *  hang forever. bootPuzzle's own last act is naming itself in the scene
 *  status, so that is the ready signal here instead. */
async function openRiverScenario(page) {
  await pauseBoard(page);
  await page.evaluate(() => {
    const index = MUDIII_PAGE_DATA.scenarios.findIndex((s) => /river/i.test(s.label || ""));
    const select = document.getElementById("scenarioSelect");
    select.value = String(index);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForFunction(
    () => /puzzle/i.test(document.querySelector("#sceneStatus")?.textContent || ""),
    null,
    { timeout: READY_TIMEOUT_MS },
  );
}

/** Enter edit mode and wait for it to take — the actor card and the outlook
 *  panel are both `body.editing`-gated, the same as the world editor. */
async function enterEditMode(page) {
  await page.locator("#editModeBtn").click();
  await page.waitForFunction(() => document.body.classList.contains("editing"), null, { timeout: READY_TIMEOUT_MS });
}

test("the river scenario opens paused with zero console or page errors, naming its four passengers on the follow control", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    await openRiverScenario(page);

    assert.equal(await page.locator("#autoToggle").getAttribute("aria-pressed"), "false", "a solved-by-search puzzle opens paused, never playing itself");
    assert.equal(await page.locator("#puzzleNote").isHidden(), false, "the puzzle note explains why nothing moves on its own");

    const ids = await page.$$eval("#agentSelect option", (opts) => opts.map((o) => o.value));
    assert.deepEqual(ids, ["cabbage-1", "farmer-1", "fox-1", "goat-1"], "the follow control lists exactly the river's own four passengers");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error opening the river scenario");
  } finally {
    await context.close();
  }
});

test("the crossing plan is the classic seven moves, goat first and goat last, and the belief panel never fabricates a belief table for a world with no vision model", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    await openRiverScenario(page);
    await enterEditMode(page);
    await page.selectOption("#agentSelect", "farmer-1");

    const planText = await page.locator("#outlookPuzzlePlanText").textContent();
    assert.match(planText, /found 7 moves \(shortest\)/, "the classic optimum");
    const moveLines = planText.split("\n").slice(1).map((l) => l.trim());
    assert.equal(moveLines.length, 7, "seven crossings");
    assert.match(moveLines[0], /^1\. ferry goat-1 onto bank-west$/, "the goat crosses first");
    assert.match(moveLines[6], /^7\. ferry goat-1 onto bank-west$/, "the goat crosses last");

    // farmer-1 has no roster entry to hold a belief map over — the river
    // world has no grid cells or vision radii for a belief to be computed
    // from at all — so the panel states that plainly rather than drawing an
    // empty or invented row.
    const beliefRows = await page.locator("#outlookBeliefBody tr").count();
    assert.equal(beliefRows, 1, "one placeholder row, never a fabricated belief per passenger");
    assert.match(
      await page.locator("#outlookBeliefBody").textContent(),
      /follow an agent above to see what it believes/i,
    );

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error reading the crossing plan and the belief panel");
  } finally {
    await context.close();
  }
});

test("editing the fox's own appetite for the goat live-redraws the crossing plan: shorter without it, an honest miss with a second appetite added, and byte-identical once restored", async () => {
  const { context, page, consoleErrors, failedRequests } = await openMudiiiPage();
  try {
    await openRiverScenario(page);
    await enterEditMode(page);
    await page.selectOption("#agentSelect", "fox-1");
    await page.locator("#actorTabClass").click();

    const originalPlanText = await page.locator("#outlookPuzzlePlanText").textContent();
    const originalClassText = await page.locator("#actorEditorText").inputValue();
    assert.match(originalClassText, /^fox eats goat\.$/m, "the fox's own class carries its appetite for the goat as an editable line");

    // Delete the fox's appetite for the goat: the derived constraint drops,
    // the search widens, and the crossing gets shorter.
    const withoutGoatAppetite = originalClassText
      .split("\n")
      .filter((line) => line.trim() !== "fox eats goat.")
      .join("\n");
    await page.locator("#actorEditorText").fill(withoutGoatAppetite);
    await page.waitForFunction(
      (orig) => {
        const t = document.querySelector("#outlookPuzzlePlanText")?.textContent || "";
        return t.length > 0 && t !== orig;
      },
      originalPlanText,
      { timeout: SYNC_TIMEOUT_MS },
    );
    const shortenedPlanText = await page.locator("#outlookPuzzlePlanText").textContent();
    const shortenedMatch = /found (\d+) moves? \(shortest\)/.exec(shortenedPlanText);
    assert.ok(shortenedMatch, "a crossing plan still exists with one fewer constraint");
    assert.ok(Number(shortenedMatch[1]) < 7, `expected fewer than 7 moves, got ${shortenedMatch[1]}`);

    // Restore the goat appetite and add a second one, for the cabbage: every
    // pair is now mutually exclusive, so the panel reports the honest miss
    // rather than a shortened or invented plan.
    const withBothAppetites = `${originalClassText}\nfox eats cabbage.`;
    await page.locator("#actorEditorText").fill(withBothAppetites);
    await page.waitForFunction(
      () => /no plan found within \d+ moves/.test(document.querySelector("#outlookPuzzlePlanText")?.textContent || ""),
      null,
      { timeout: SYNC_TIMEOUT_MS },
    );
    assert.match(await page.locator("#outlookPuzzlePlanText").textContent(), /^puzzle plan — no plan found within \d+ moves$/);

    // Undo both edits: the world's own unedited rows recompute the original
    // seven-move crossing, byte-identically.
    await page.locator("#actorEditorText").fill(originalClassText);
    await page.waitForFunction(
      (orig) => document.querySelector("#outlookPuzzlePlanText")?.textContent === orig,
      originalPlanText,
      { timeout: SYNC_TIMEOUT_MS },
    );
    assert.equal(await page.locator("#outlookPuzzlePlanText").textContent(), originalPlanText, "restoring the fox's own rows returns the original crossing byte-identically");

    assert.deepEqual(failedRequests, [], "every same-origin request the page makes resolves");
    assert.deepEqual(consoleErrors, [], "no console error retracting, widening and restoring the fox's own appetite");
  } finally {
    await context.close();
  }
});

for (const width of PHONE_WIDTHS) {
  test(`the river scenario's actor card and outlook panel have no horizontal overflow at ${width}px`, async () => {
    const context = await browser.newContext({ viewport: { width, height: 812 } });
    const page = await context.newPage();
    await page.route("**/*", (route) => {
      if (route.request().url().startsWith(server.origin)) return route.continue();
      return route.abort();
    });
    try {
      await page.goto(`${server.origin}/mudiii.html`, { waitUntil: "networkidle" });
      await page.waitForFunction(
        () => document.querySelector("#chatInput") && !document.querySelector("#chatInput").disabled,
        null,
        { timeout: READY_TIMEOUT_MS },
      );
      await page.waitForFunction(
        () => document.querySelector("#autoToggle")?.getAttribute("aria-pressed") === "true",
        null,
        { timeout: READY_TIMEOUT_MS },
      );
      await openRiverScenario(page);
      await enterEditMode(page);
      await page.selectOption("#agentSelect", "farmer-1");

      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      assert.ok(
        scrollWidth <= clientWidth + 1,
        `the river scenario's edit view is ${scrollWidth}px wide inside a ${clientWidth}px viewport`,
      );
    } finally {
      await context.close();
    }
  });
}
